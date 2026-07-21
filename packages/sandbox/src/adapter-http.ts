import type {
	ExecutorAdapter,
	ExecutorRunOptions,
	ExecutorRunResult,
} from "questpie/executor";

import type { AuthenticatedAgentWorkloadEnvelope } from "@questpie/ai";

import {
	hashAgentWorkloadSandboxSource,
	sealAgentWorkloadSandboxAdmission,
	type AgentWorkloadSandboxAdmissionKey,
} from "./agent-workload-admission.js";
import type {
	AgentWorkloadSandboxBoundary,
	AgentWorkloadSandboxHostContext,
} from "./agent-workload-boundary.js";
import { AgentWorkloadSandboxDeniedError } from "./agent-workload-denial.js";
import { validateEgressHosts } from "./net-validation.js";
import {
	AGENT_WORKLOAD_ADMISSION_HEADER,
	NON_AGENT_ADMISSION_HEADER,
	type SandboxCapabilities,
	type SandboxRunResult,
} from "./types.js";

export interface AgentWorkloadHttpSandboxOptions {
	readonly boundary: AgentWorkloadSandboxBoundary;
	readonly admission: AgentWorkloadSandboxAdmissionKey;
	readonly execution: {
		/** Trusted source resolved for the boundary's pinned Skill revision. */
		readonly source: string;
		readonly timeoutMs: number;
		readonly memoryMb: number;
		readonly inputProjections: AgentWorkloadInputProjectionRegistry;
	};
}

export interface AgentWorkloadInputProjectionReference {
	readonly id: string;
	readonly skillRevisionId: string;
	readonly executionPolicyRevisionId: string;
	readonly sourceSha256: string;
}

export type AgentWorkloadInputProjector = (context: {
	readonly principal: AgentWorkloadSandboxHostContext["principal"];
	readonly disclosure: AgentWorkloadSandboxHostContext["context"]["disclosure"];
}) => unknown | Promise<unknown>;

/** Trusted registry resolved from the Run's pinned immutable revisions. */
export interface AgentWorkloadInputProjectionRegistry {
	resolve(
		reference: AgentWorkloadInputProjectionReference,
	):
		| AgentWorkloadInputProjector
		| null
		| Promise<AgentWorkloadInputProjector | null>;
}

export interface AgentWorkloadHttpRunOptions {
	readonly authority: AuthenticatedAgentWorkloadEnvelope;
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
	/** Explicit fail-closed Agent path. Legacy `run()` never consumes this. */
	agentWorkload?: AgentWorkloadHttpSandboxOptions;
	/** Trusted host service credential for the explicit non-Agent `run()` path. */
	nonAgentAdmissionSecret?: string;
}

const DEFAULT_GUEST_TIMEOUT_MS = 5_000;
const MAX_AGENT_ADMISSION_TTL_MS = 5_000;

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
		const url =
			this.options.url ??
			(typeof process !== "undefined" ? process.env?.SANDBOX_URL : undefined);
		if (!url) {
			throw new Error(
				"HttpSandboxAdapter: no sandbox URL configured. Pass `url` or set SANDBOX_URL.",
			);
		}
		return url.replace(/\/$/, "");
	}

	private async postRun(
		requestBody: string,
		timeoutMs: number,
		headers?: Readonly<Record<string, string>>,
	): Promise<ExecutorRunResult> {
		const fetchTimeoutMs = this.options.fetchTimeoutMs ?? timeoutMs + 10_000;
		const controller = new AbortController();
		const abortTimer = setTimeout(() => controller.abort(), fetchTimeoutMs);

		try {
			const res = await this.fetchImpl(`${this.resolveUrl()}/run`, {
				method: "POST",
				headers: { "content-type": "application/json", ...headers },
				body: requestBody,
				signal: controller.signal,
			});

			const text = await res.text();
			let parsed: SandboxRunResult;
			try {
				parsed = JSON.parse(text) as SandboxRunResult;
			} catch {
				return {
					ok: false,
					error: `sandbox returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`,
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
			const aborted = err instanceof Error && err.name === "AbortError";
			return {
				ok: false,
				error: aborted
					? `sandbox request timed out after ${fetchTimeoutMs}ms`
					: `sandbox request failed: ${err instanceof Error ? err.message : String(err)}`,
				logs: [],
			};
		} finally {
			clearTimeout(abortTimer);
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

		// Untrusted app-bindings: when the executor service minted a per-run token,
		// forward broker coordinates. This remains the explicit non-Agent path.
		const bindings = options.sandboxBindings;
		const nonAgentAdmissionSecret =
			this.options.nonAgentAdmissionSecret ??
			(typeof process !== "undefined"
				? process.env?.SANDBOX_NON_AGENT_ADMISSION_SECRET
				: undefined);
		return this.postRun(
			JSON.stringify({
				mode: "non_agent",
				source: options.source,
				input: options.input ?? null,
				capabilities: sandboxCaps,
				secrets: options.secrets ?? {},
				...(bindings ? { bindings } : {}),
			}),
			timeoutMs,
			nonAgentAdmissionSecret
				? { [NON_AGENT_ADMISSION_HEADER]: nonAgentAdmissionSecret }
				: undefined,
		);
	}

	async runAgentWorkload(
		options: AgentWorkloadHttpRunOptions,
	): Promise<ExecutorRunResult> {
		const configured = this.options.agentWorkload;
		if (!configured) {
			throw new Error(
				"HttpSandboxAdapter: no Agent workload boundary configured.",
			);
		}
		const session = await configured.boundary.open(options.authority);
		const prepared = await session.prepare(
			async ({ principal, guest, context }) => {
				const sourceDigest = await hashAgentWorkloadSandboxSource(
					configured.execution.source,
				);
				if (sourceDigest !== context.execution.sourceSha256) {
					throw new AgentWorkloadSandboxDeniedError();
				}
				let projectedInput: unknown;
				try {
					const projector = await configured.execution.inputProjections.resolve(
						Object.freeze({
							id: context.execution.inputProjectionId,
							skillRevisionId: principal.policies.skillRevisionId,
							executionPolicyRevisionId:
								principal.policies.executionPolicyRevisionId,
							sourceSha256: context.execution.sourceSha256,
						}),
					);
					if (!projector) throw new AgentWorkloadSandboxDeniedError();
					projectedInput = await projector({
						principal,
						disclosure: context.disclosure,
					});
				} catch {
					throw new AgentWorkloadSandboxDeniedError();
				}
				const net = [...guest.handles.network.fetch];
				const importHosts = [...guest.handles.network.import];
				if (this.validateEgress) {
					const egress = await validateEgressHosts([...net, ...importHosts]);
					if (!egress.ok) {
						throw new AgentWorkloadSandboxDeniedError();
					}
				}
				const requestBody = JSON.stringify({
					mode: "agent_workload",
					source: configured.execution.source,
					input: projectedInput ?? null,
					capabilities: {
						net,
						import: importHosts,
						timeoutMs: configured.execution.timeoutMs,
						memoryMb: configured.execution.memoryMb,
					},
					secrets: {},
				});
				return { requestBody, timeoutMs: configured.execution.timeoutMs };
			},
		);
		return session.create(async ({ principal, context }) => {
			const admission = await sealAgentWorkloadSandboxAdmission(
				configured.admission,
				{
					kind: "agent_workload_sandbox_admission",
					version: 1,
					admissionId: crypto.randomUUID(),
					principalId: principal.principalId,
					runId: principal.run.id,
					attemptId: principal.run.attemptId,
					workRequestId: principal.run.workRequestId,
					companyId: principal.scope.companyId,
					anchorSpaceId: principal.scope.anchorSpaceId,
					agentActorId: principal.attribution.agentActorId,
					skillRevisionId: principal.policies.skillRevisionId,
					executionPolicyRevisionId:
						principal.policies.executionPolicyRevisionId,
					sourceSha256: context.execution.sourceSha256,
					inputProjectionId: context.execution.inputProjectionId,
					grantEpoch: principal.epochs.grant,
					revocationEpoch: principal.epochs.revocation,
					workerId: principal.execution.workerId,
					workerLeaseId: principal.execution.workerLeaseId,
					workerLeaseEpoch: principal.execution.workerLeaseEpoch,
					supervisorInstanceId: configured.admission.instanceId,
					expiresAt: new Date(
						Math.min(
							Date.parse(principal.expiresAt),
							Date.now() + MAX_AGENT_ADMISSION_TTL_MS,
						),
					).toISOString(),
				},
				prepared.requestBody,
			);
			return this.postRun(prepared.requestBody, prepared.timeoutMs, {
				[AGENT_WORKLOAD_ADMISSION_HEADER]: admission,
			});
		});
	}
}

/** Factory for the production sandboxed adapter. */
export function httpSandboxAdapter(
	options: HttpSandboxAdapterOptions = {},
): HttpSandboxAdapter {
	return new HttpSandboxAdapter(options);
}
