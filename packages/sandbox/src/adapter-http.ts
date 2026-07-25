import type {
	ExecutorAdapter,
	ExecutorRunOptions,
	ExecutorRunResult,
} from "questpie/executor";

import { registerSandboxCustomToolsSession } from "./custom-tools.js";
import { validateEgressHosts } from "./net-validation.js";
import { parseSandboxRunResult } from "./server-internals.js";
import {
	HOST_ADMISSION_HEADER,
	WORKLOAD_ADMISSION_HEADER,
	type SandboxCapabilities,
} from "./types.js";
import {
	sealSandboxWorkloadAdmission,
	type SandboxWorkloadAdmissionKey,
} from "./workload-admission.js";
import {
	SandboxWorkloadDeniedError,
	serializeSandboxWorkloadPolicy,
	snapshotSandboxWorkloadPolicy,
	type SandboxWorkloadAuditContext,
	type SandboxWorkloadAuditEvent,
	type SandboxWorkloadAuthorizer,
	type SandboxWorkloadPolicy,
	type SandboxWorkloadRunOptions,
} from "./workload.js";

export interface WorkloadHttpSandboxOptions {
	readonly authorize: SandboxWorkloadAuthorizer;
	readonly admission: SandboxWorkloadAdmissionKey;
	/** Hard bound around each consumer authorization read. Default 2s, max 5s. */
	readonly authorizationTimeoutMs?: number;
	/** Redacted audit seam. Allowed decisions fail closed when it cannot settle. */
	readonly audit?: (
		event: SandboxWorkloadAuditEvent,
		context: SandboxWorkloadAuditContext,
	) => void | Promise<void>;
	/** Hard bound around the audit callback. Default 250ms, max 1s. */
	readonly auditTimeoutMs?: number;
}

export interface HttpSandboxAdapterOptions {
	/**
	 * Base URL of the standalone Deno sandbox service (`sandbox-server.ts`).
	 * Defaults to `process.env.SANDBOX_URL`. Throws on `run` if neither is set.
	 */
	url?: string;
	/**
	 * Per-request HTTP fetch timeout (ms). A safety margin above the guest
	 * wall-timeout so the server's own kill fires first; if the server is
	 * unreachable this bounds the client wait. Default: guest timeout + 10s.
	 */
	fetchTimeoutMs?: number;
	/** Optional custom `fetch` (e.g. for auth headers / mTLS). */
	fetch?: typeof fetch;
	/**
	 * Validate net/import hosts against the private-IP policy BEFORE sending to
	 * the sandbox (defense-in-depth; the server validates too). Default: true.
	 */
	validateEgress?: boolean;
	/** Consumer-owned fail-closed admission for opaque remote workloads. */
	workload?: WorkloadHttpSandboxOptions;
	/** Trusted host credential for the direct framework `run()` path. */
	hostAdmissionSecret?: string;
}

const DEFAULT_GUEST_TIMEOUT_MS = 5_000;
const MAX_WORKLOAD_ADMISSION_TTL_MS = 5_000;
const DEFAULT_AUTHORIZATION_TIMEOUT_MS = 2_000;
const MAX_AUTHORIZATION_TIMEOUT_MS = 5_000;
const DEFAULT_AUDIT_TIMEOUT_MS = 250;
const MAX_AUDIT_TIMEOUT_MS = 1_000;
const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BODY_BYTES = 2 * 1024 * 1024;

function opaqueBindingToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

class OperationDeadlineError extends Error {}
class OperationCancelledError extends Error {}
class ResponseBodyTooLargeError extends Error {}

async function readResponseTextBounded(
	response: Response,
	maximumBytes: number,
): Promise<string> {
	if (!response.body) return "";
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maximumBytes) {
			await reader.cancel();
			throw new ResponseBodyTooLargeError();
		}
		chunks.push(value);
	}
	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(body);
}

function boundedMs(
	value: number | undefined,
	fallback: number,
	maximum: number,
): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.min(maximum, Math.max(1, Math.round(value)))
		: fallback;
}

async function settleWithin<T>(
	work: (signal: AbortSignal) => T | Promise<T>,
	timeoutMs: number,
	parent?: AbortSignal,
): Promise<T> {
	const controller = new AbortController();
	const onAbort = () => controller.abort(new OperationCancelledError());
	if (parent?.aborted) controller.abort(new OperationCancelledError());
	else parent?.addEventListener("abort", onAbort, { once: true });
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			Promise.resolve().then(() => work(controller.signal)),
			new Promise<T>((_, reject) => {
				timer = setTimeout(() => {
					const error = new OperationDeadlineError();
					controller.abort(error);
					reject(error);
				}, timeoutMs);
				controller.signal.addEventListener(
					"abort",
					() =>
						reject(controller.signal.reason ?? new OperationCancelledError()),
					{ once: true },
				);
				if (controller.signal.aborted) {
					reject(controller.signal.reason ?? new OperationCancelledError());
				}
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
		parent?.removeEventListener("abort", onAbort);
	}
}

/**
 * Production sandboxed `ExecutorAdapter` — POSTs the run to the standalone Deno
 * sandbox service over HTTP. The main app (Bun/Node) holds NO Deno; it only
 * speaks this JSON contract.
 *
 * Use as the `sandboxed` adapter in the executor config:
 *   executor: { sandboxed: httpSandboxAdapter({ url: process.env.SANDBOX_URL }) }
 */
export class HttpSandboxAdapter implements ExecutorAdapter {
	private readonly fetchImpl: typeof fetch;
	private readonly validateEgress: boolean;

	constructor(private readonly options: HttpSandboxAdapterOptions = {}) {
		this.fetchImpl = options.fetch ?? globalThis.fetch;
		this.validateEgress = options.validateEgress ?? true;
	}

	private resolveUrl(): string {
		const raw =
			this.options.url ??
			(typeof process !== "undefined" ? process.env?.SANDBOX_URL : undefined);
		if (!raw) {
			throw new Error(
				"HttpSandboxAdapter: no sandbox URL configured. Pass `url` or set SANDBOX_URL.",
			);
		}
		let url: URL;
		try {
			url = new URL(raw);
		} catch {
			throw new Error(
				"HttpSandboxAdapter: sandbox URL must be canonical HTTP(S).",
			);
		}
		if (
			(url.protocol !== "http:" && url.protocol !== "https:") ||
			url.username.length > 0 ||
			url.password.length > 0 ||
			url.hash.length > 0 ||
			url.search.length > 0 ||
			url.pathname !== "/" ||
			(raw !== url.origin && raw !== `${url.origin}/`)
		) {
			throw new Error(
				"HttpSandboxAdapter: sandbox URL must be canonical HTTP(S).",
			);
		}
		return url.origin;
	}

	private async postRun(
		requestBody: string,
		timeoutMs: number,
		headers?: Readonly<Record<string, string>>,
		signal?: AbortSignal,
		sanitizeTransportErrors = false,
		onResponseStatus?: (status: number) => void,
	): Promise<ExecutorRunResult> {
		const fetchTimeoutMs = this.options.fetchTimeoutMs ?? timeoutMs + 10_000;

		try {
			if (signal?.aborted) {
				return {
					ok: false,
					error: "sandbox request cancelled",
					logs: [],
				};
			}
			const { res, text } = await settleWithin(
				async (requestSignal) => {
					const res = await this.fetchImpl(`${this.resolveUrl()}/run`, {
						method: "POST",
						redirect: "error",
						headers: { "content-type": "application/json", ...headers },
						body: requestBody,
						signal: requestSignal,
					});
					if (!res.ok) {
						await res.body?.cancel();
						return { res, text: "" };
					}
					return {
						res,
						text: await readResponseTextBounded(res, MAX_RESPONSE_BODY_BYTES),
					};
				},
				fetchTimeoutMs,
				signal,
			);
			onResponseStatus?.(res.status);
			if (!res.ok) {
				return {
					ok: false,
					error: sanitizeTransportErrors
						? "sandbox transport failed"
						: `sandbox request failed (HTTP ${res.status})`,
					logs: [],
				};
			}
			let decoded: unknown;
			try {
				decoded = JSON.parse(text);
			} catch {
				return {
					ok: false,
					error: sanitizeTransportErrors
						? "sandbox transport returned invalid response"
						: `sandbox returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`,
					logs: [],
				};
			}
			const parsed = parseSandboxRunResult(decoded);
			if (!parsed) {
				return {
					ok: false,
					error: sanitizeTransportErrors
						? "sandbox transport returned invalid response"
						: "sandbox returned an invalid response",
					logs: [],
				};
			}

			return {
				ok: !!parsed.ok,
				output: parsed.output,
				error: parsed.error,
				logs: Array.isArray(parsed.logs) ? parsed.logs : [],
				timedOut: parsed.timedOut,
				ms: parsed.ms,
			};
		} catch (err) {
			return {
				ok: false,
				error:
					signal?.aborted || err instanceof OperationCancelledError
						? "sandbox request cancelled"
						: err instanceof OperationDeadlineError
							? sanitizeTransportErrors
								? "sandbox transport timed out"
								: `sandbox request timed out after ${fetchTimeoutMs}ms`
							: err instanceof ResponseBodyTooLargeError
								? sanitizeTransportErrors
									? "sandbox transport returned invalid response"
									: "sandbox returned an invalid response"
								: sanitizeTransportErrors
									? "sandbox transport failed"
									: `sandbox request failed: ${err instanceof Error ? err.message : String(err)}`,
				logs: [],
			};
		}
	}

	async run(options: ExecutorRunOptions): Promise<ExecutorRunResult> {
		const caps = options.capabilities ?? {};
		const net = caps.net ?? [];
		const importHosts = caps.import ?? [];
		const timeoutMs = caps.timeoutMs ?? DEFAULT_GUEST_TIMEOUT_MS;

		// Defense-in-depth: reject private-IP egress before even contacting the
		// sandbox (the server re-checks). Surfaces a clear error to the caller.
		if (this.validateEgress) {
			const egress = await validateEgressHosts([...net, ...importHosts]);
			if (!egress.ok) {
				return {
					ok: false,
					error: `egress blocked: ${egress.reason}`,
					logs: [],
				};
			}
		}

		const sandboxCaps: SandboxCapabilities = {
			net,
			import: importHosts,
			timeoutMs,
			memoryMb: caps.memoryMb ?? 128,
		};

		// Untrusted app-bindings: when the executor service minted a scoped token,
		// forward broker coordinates. This remains the explicit trusted-host path.
		const bindings =
			options.sandboxBindings ??
			(options.sandboxTools && options.brokerUrl
				? { url: options.brokerUrl, token: opaqueBindingToken() }
				: undefined);
		if (options.sandboxTools && !bindings) {
			return {
				ok: false,
				error: "sandbox custom tools require broker bindings",
				logs: [],
			};
		}
		const toolsSession =
			options.sandboxTools && bindings
				? registerSandboxCustomToolsSession(
						bindings.token,
						bindings.url,
						options.sandboxTools.envelope,
						timeoutMs + 30_000,
					)
				: undefined;
		const hostAdmissionSecret =
			this.options.hostAdmissionSecret ??
			(typeof process !== "undefined"
				? process.env?.SANDBOX_HOST_ADMISSION_SECRET
				: undefined);
		try {
			return await this.postRun(
				JSON.stringify({
					mode: "host",
					source: options.source,
					input: options.input ?? null,
					capabilities: sandboxCaps,
					secrets: options.secrets ?? {},
					...(bindings ? { bindings } : {}),
				}),
				timeoutMs,
				hostAdmissionSecret
					? { [HOST_ADMISSION_HEADER]: hostAdmissionSecret }
					: undefined,
			);
		} finally {
			toolsSession?.revoke();
		}
	}

	async runWorkload(
		options: SandboxWorkloadRunOptions,
	): Promise<ExecutorRunResult> {
		if (options.signal?.aborted) {
			return {
				ok: false,
				error: "sandbox request cancelled",
				logs: [],
			};
		}
		const configured = this.options.workload;
		if (!configured) {
			throw new SandboxWorkloadDeniedError();
		}
		const authorizationTimeoutMs = boundedMs(
			configured.authorizationTimeoutMs,
			DEFAULT_AUTHORIZATION_TIMEOUT_MS,
			MAX_AUTHORIZATION_TIMEOUT_MS,
		);
		const auditTimeoutMs = boundedMs(
			configured.auditTimeoutMs,
			DEFAULT_AUDIT_TIMEOUT_MS,
			MAX_AUDIT_TIMEOUT_MS,
		);
		const audit = async (
			event: SandboxWorkloadAuditEvent,
			required: boolean,
		): Promise<void> => {
			if (!configured.audit) return;
			try {
				await settleWithin(
					(signal) => configured.audit!(Object.freeze(event), { signal }),
					auditTimeoutMs,
					options.signal,
				);
			} catch {
				if (required) throw new SandboxWorkloadDeniedError();
			}
		};
		const authorize = async (
			phase: "prepare" | "dispatch",
		): Promise<SandboxWorkloadPolicy> => {
			if (options.signal?.aborted) {
				await audit(
					{
						boundary: "sandbox.workload",
						phase,
						decision: "denied",
						reason: "cancelled",
					},
					false,
				);
				throw new SandboxWorkloadDeniedError();
			}
			let resolved: unknown;
			try {
				resolved = await settleWithin(
					(signal) => configured.authorize(options.envelope, { phase, signal }),
					authorizationTimeoutMs,
					options.signal,
				);
			} catch (error) {
				await audit(
					{
						boundary: "sandbox.workload",
						phase,
						decision: "denied",
						reason:
							options.signal?.aborted ||
							error instanceof OperationCancelledError
								? "cancelled"
								: error instanceof OperationDeadlineError
									? "authorization_timed_out"
									: "authorization_failed",
					},
					false,
				);
				throw new SandboxWorkloadDeniedError();
			}
			const policy = snapshotSandboxWorkloadPolicy(resolved);
			if (!policy) {
				await audit(
					{
						boundary: "sandbox.workload",
						phase,
						decision: "denied",
						reason: "policy_invalid",
					},
					false,
				);
				throw new SandboxWorkloadDeniedError();
			}
			return policy;
		};

		const prepared = await authorize("prepare");
		if (this.validateEgress) {
			let egress;
			try {
				egress = await settleWithin(
					(signal) =>
						validateEgressHosts(
							[...prepared.capabilities.net, ...prepared.capabilities.import],
							{
								signal,
								timeoutMs: authorizationTimeoutMs,
								concurrency: 4,
							},
						),
					authorizationTimeoutMs,
					options.signal,
				);
			} catch {
				await audit(
					{
						boundary: "sandbox.workload",
						phase: "prepare",
						decision: "denied",
						reason: options.signal?.aborted ? "cancelled" : "egress_denied",
					},
					false,
				);
				throw new SandboxWorkloadDeniedError();
			}
			if (!egress.ok) {
				await audit(
					{
						boundary: "sandbox.workload",
						phase: "prepare",
						decision: "denied",
						reason: "egress_denied",
					},
					false,
				);
				throw new SandboxWorkloadDeniedError();
			}
		}
		const current = await authorize("dispatch");
		if (
			serializeSandboxWorkloadPolicy(prepared) !==
				serializeSandboxWorkloadPolicy(current) ||
			prepared.sandboxTools?.envelope !== current.sandboxTools?.envelope
		) {
			await audit(
				{
					boundary: "sandbox.workload",
					phase: "dispatch",
					decision: "denied",
					reason: "policy_changed",
				},
				false,
			);
			throw new SandboxWorkloadDeniedError();
		}
		await audit(
			{
				boundary: "sandbox.workload",
				phase: "dispatch",
				decision: "allowed",
				reason: "authorization_succeeded",
			},
			true,
		);

		let result: ExecutorRunResult;
		let responseStatus: number | undefined;
		try {
			if (options.signal?.aborted) {
				result = {
					ok: false,
					error: "sandbox request cancelled",
					logs: [],
				};
			} else {
				const requestBody = JSON.stringify({
					mode: "workload",
					source: current.source,
					input: current.input ?? null,
					capabilities: current.capabilities,
					secrets: current.secrets ?? {},
					...(current.bindings ? { bindings: current.bindings } : {}),
				});
				if (
					new TextEncoder().encode(requestBody).byteLength >
					MAX_REQUEST_BODY_BYTES
				) {
					throw new SandboxWorkloadDeniedError();
				}
				const now = Date.now();
				const expiresAt = new Date(
					Math.min(
						current.validUntil
							? Date.parse(current.validUntil)
							: Number.POSITIVE_INFINITY,
						now + MAX_WORKLOAD_ADMISSION_TTL_MS,
					),
				).toISOString();
				const admission = await sealSandboxWorkloadAdmission(
					configured.admission,
					{
						kind: "sandbox_workload_admission",
						version: 1,
						admissionId: crypto.randomUUID(),
						supervisorInstanceId: configured.admission.instanceId,
						expiresAt,
					},
					requestBody,
				);
				const toolsSession =
					current.sandboxTools && current.bindings
						? registerSandboxCustomToolsSession(
								current.bindings.token,
								current.bindings.url,
								current.sandboxTools.envelope,
								current.capabilities.timeoutMs + 30_000,
							)
						: undefined;
				try {
					result = await this.postRun(
						requestBody,
						current.capabilities.timeoutMs,
						{ [WORKLOAD_ADMISSION_HEADER]: admission },
						options.signal,
						true,
						(status) => {
							responseStatus = status;
						},
					);
				} finally {
					toolsSession?.revoke();
				}
			}
		} catch {
			await audit(
				{
					boundary: "sandbox.workload",
					phase: "transport",
					decision: "denied",
					reason: "transport_failed",
				},
				false,
			);
			throw new SandboxWorkloadDeniedError();
		}
		const terminal =
			responseStatus !== undefined &&
			(responseStatus < 200 || responseStatus >= 300)
				? ("transport_denied" as const)
				: result.error === "sandbox request cancelled"
					? ("transport_cancelled" as const)
					: result.error === "sandbox transport timed out"
						? ("transport_timed_out" as const)
						: result.error === "sandbox transport returned invalid response"
							? ("transport_invalid_response" as const)
							: result.error === "sandbox transport failed"
								? ("transport_failed" as const)
								: ("transport_completed" as const);
		await audit(
			{
				boundary: "sandbox.workload",
				phase: "transport",
				decision: terminal === "transport_completed" ? "allowed" : "denied",
				reason: terminal,
			},
			false,
		);
		return result;
	}
}

/** Factory for the production sandboxed adapter. */
export function httpSandboxAdapter(
	options: HttpSandboxAdapterOptions = {},
): HttpSandboxAdapter {
	return new HttpSandboxAdapter(options);
}
