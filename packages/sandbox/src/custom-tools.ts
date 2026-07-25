import type { Questpie } from "questpie";
import type { BrokerRpcResponse } from "questpie/executor";

import {
	createWorkloadMcpToolPort,
	mcpPublicErrorCode,
	type McpProgrammaticToolResult,
	type McpPublicErrorCode,
	type McpWorkloadAuditEvent,
	type McpWorkloadAuthorizer,
	type McpWorkloadContextBinder,
	type McpWorkloadHandoff,
	type McpWorkloadToolPort,
} from "@questpie/mcp";

import {
	BROKER_CUSTOM_ARGUMENT_CAP_BYTES,
	BROKER_CUSTOM_LIST_CAP_BYTES,
	BROKER_CUSTOM_RESULT_CAP_BYTES,
} from "./broker-wire.js";
import { normalizeBrokerUrl } from "./server-internals.js";

const DEFAULT_MAX_TOOLS = 64;
const HARD_MAX_TOOLS = 256;
const DEFAULT_MAX_LIST_BYTES = 256 * 1024;
const HARD_MAX_LIST_BYTES = BROKER_CUSTOM_LIST_CAP_BYTES;
const DEFAULT_MAX_ARGUMENT_BYTES = 32 * 1024;
const HARD_MAX_ARGUMENT_BYTES = BROKER_CUSTOM_ARGUMENT_CAP_BYTES;
const DEFAULT_MAX_RESULT_BYTES = 256 * 1024;
const HARD_MAX_RESULT_BYTES = BROKER_CUSTOM_RESULT_CAP_BYTES;
const DEFAULT_MAX_CALLS = 64;
const HARD_MAX_CALLS = 256;
const DEFAULT_TIMEOUT_MS = 5_000;
const HARD_MAX_TIMEOUT_MS = 30_000;
const DEFAULT_CONCURRENCY = 4;
const HARD_MAX_CONCURRENCY = 16;
const DEFAULT_EVIDENCE_TIMEOUT_MS = 250;
const HARD_MAX_EVIDENCE_TIMEOUT_MS = 1_000;
const MAX_ACTIVE_TOOL_SESSIONS = 1_024;
const MAX_EXPIRED_SESSION_CLEANUP_SCAN = 64;

export interface SandboxCustomToolsLimits {
	readonly maxTools?: number;
	readonly maxListBytes?: number;
	readonly maxArgumentBytes?: number;
	readonly maxResultBytes?: number;
	/** Total `tools.list` plus `tools.call` operations allowed in one run. */
	readonly maxCalls?: number;
	readonly timeoutMs?: number;
	readonly concurrency?: number;
}

export interface SandboxCustomToolEvidenceEvent {
	readonly boundary: "sandbox.tool";
	readonly phase: "discovery" | "call";
	readonly toolName?: string;
	readonly result: "succeeded" | "denied" | "failed";
	readonly reason:
		| "completed"
		| "authorization_or_tool_denied"
		| "invalid_request"
		| "limit_exceeded"
		| "timed_out"
		| "execution_failed";
	readonly durationMs: number;
}

export interface SandboxCustomToolEvidenceContext {
	readonly signal: AbortSignal;
}

export interface SandboxCustomToolsConfig {
	readonly authorizer: McpWorkloadAuthorizer;
	readonly contextBinder: McpWorkloadContextBinder;
	/** Existing MCP authorization audit seam; receives no input or result bodies. */
	readonly authorizationAudit?: (
		event: McpWorkloadAuditEvent,
	) => void | Promise<void>;
	readonly handoff?: McpWorkloadHandoff;
	/** Product-neutral terminal evidence. Arguments/results/envelopes are omitted. */
	readonly evidence?: (
		event: SandboxCustomToolEvidenceEvent,
		context: SandboxCustomToolEvidenceContext,
	) => void | Promise<void>;
	readonly evidenceTimeoutMs?: number;
	readonly limits?: SandboxCustomToolsLimits;
}

export interface SandboxCustomToolsRunOptions {
	/** Consumer-owned opaque authorization input. Never sent to the guest. */
	readonly envelope: unknown;
}

declare module "questpie" {
	interface RuntimeConfigExtensions {
		sandboxCustomTools?: SandboxCustomToolsConfig;
	}
}

declare module "questpie/executor" {
	interface ExecutorRunOptions {
		/** Host-only custom-tool authority for this sandbox run. */
		sandboxTools?: SandboxCustomToolsRunOptions;
	}
}

export function sandboxCustomTools(
	config: SandboxCustomToolsConfig,
): SandboxCustomToolsConfig {
	if (!resolveLimits(config)) {
		throw new Error("sandbox custom-tool limits are invalid");
	}
	return config;
}

interface ResolvedLimits {
	maxTools: number;
	maxListBytes: number;
	maxArgumentBytes: number;
	maxResultBytes: number;
	maxCalls: number;
	timeoutMs: number;
	concurrency: number;
	evidenceTimeoutMs: number;
}

interface ToolSession {
	envelope: unknown;
	readonly endpoint: string;
	readonly expiresAt: number;
	port?: McpWorkloadToolPort;
	calls: number;
	inFlight: number;
	revoked: boolean;
}

const sessions = new Map<string, ToolSession>();
const encoder = new TextEncoder();

function closeSession(token: string, session: ToolSession): void {
	session.revoked = true;
	if (sessions.get(token) === session) {
		sessions.delete(token);
	}
	session.port = undefined;
	session.envelope = undefined;
}

function cleanupExpiredSessions(now: number): void {
	const candidates: Array<readonly [string, ToolSession]> = [];
	for (const [token, session] of sessions) {
		candidates.push([token, session]);
		if (candidates.length >= MAX_EXPIRED_SESSION_CLEANUP_SCAN) break;
	}
	for (const [token, session] of candidates) {
		if (session.revoked || now >= session.expiresAt) {
			closeSession(token, session);
		} else if (sessions.get(token) === session) {
			// Rotate live entries so repeated bounded scans eventually visit all slots.
			sessions.delete(token);
			sessions.set(token, session);
		}
	}
}

function boundedPositiveInteger(
	value: number | undefined,
	fallback: number,
	maximum: number,
): number | null {
	if (value === undefined) return fallback;
	return Number.isSafeInteger(value) && value >= 1 && value <= maximum
		? value
		: null;
}

function resolveLimits(
	config: SandboxCustomToolsConfig,
): ResolvedLimits | null {
	const limits = config.limits;
	const maxTools = boundedPositiveInteger(
		limits?.maxTools,
		DEFAULT_MAX_TOOLS,
		HARD_MAX_TOOLS,
	);
	const maxListBytes = boundedPositiveInteger(
		limits?.maxListBytes,
		DEFAULT_MAX_LIST_BYTES,
		HARD_MAX_LIST_BYTES,
	);
	const maxArgumentBytes = boundedPositiveInteger(
		limits?.maxArgumentBytes,
		DEFAULT_MAX_ARGUMENT_BYTES,
		HARD_MAX_ARGUMENT_BYTES,
	);
	const maxResultBytes = boundedPositiveInteger(
		limits?.maxResultBytes,
		DEFAULT_MAX_RESULT_BYTES,
		HARD_MAX_RESULT_BYTES,
	);
	const maxCalls = boundedPositiveInteger(
		limits?.maxCalls,
		DEFAULT_MAX_CALLS,
		HARD_MAX_CALLS,
	);
	const timeoutMs = boundedPositiveInteger(
		limits?.timeoutMs,
		DEFAULT_TIMEOUT_MS,
		HARD_MAX_TIMEOUT_MS,
	);
	const concurrency = boundedPositiveInteger(
		limits?.concurrency,
		DEFAULT_CONCURRENCY,
		HARD_MAX_CONCURRENCY,
	);
	const evidenceTimeoutMs = boundedPositiveInteger(
		config.evidenceTimeoutMs,
		DEFAULT_EVIDENCE_TIMEOUT_MS,
		HARD_MAX_EVIDENCE_TIMEOUT_MS,
	);
	if (
		maxTools === null ||
		maxListBytes === null ||
		maxArgumentBytes === null ||
		maxResultBytes === null ||
		maxCalls === null ||
		timeoutMs === null ||
		concurrency === null ||
		evidenceTimeoutMs === null
	) {
		return null;
	}
	return {
		maxTools,
		maxListBytes,
		maxArgumentBytes,
		maxResultBytes,
		maxCalls,
		timeoutMs,
		concurrency,
		evidenceTimeoutMs,
	};
}

function error(
	code:
		| "bad_args"
		| "bad_method"
		| "unauthorized"
		| "forbidden"
		| "execution_error",
	message: string,
): BrokerRpcResponse {
	return { ok: false, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
	value: Record<string, unknown>,
	required: readonly string[],
	optional: readonly string[] = [],
): boolean {
	const keys = Object.keys(value);
	return (
		required.every((key) => keys.includes(key)) &&
		keys.every((key) => required.includes(key) || optional.includes(key))
	);
}

function jsonBytes(value: unknown): number | null {
	try {
		const serialized = JSON.stringify(value);
		if (serialized === undefined) return null;
		return encoder.encode(serialized).byteLength;
	} catch {
		return null;
	}
}

class DeadlineError extends Error {}
class CancelledError extends Error {}

async function within<T>(
	work: (signal: AbortSignal) => Promise<T>,
	timeoutMs: number,
	parent?: AbortSignal,
	onWorkSettled?: () => void,
): Promise<T> {
	const controller = new AbortController();
	const cancel = () => controller.abort(new CancelledError());
	if (parent?.aborted) cancel();
	else parent?.addEventListener("abort", cancel, { once: true });
	let timer: ReturnType<typeof setTimeout> | undefined;
	const operation = Promise.resolve().then(() => work(controller.signal));
	if (onWorkSettled) {
		void operation.then(onWorkSettled, onWorkSettled);
	}
	try {
		return await Promise.race([
			operation,
			new Promise<T>((_, reject) => {
				timer = setTimeout(() => {
					const deadline = new DeadlineError();
					controller.abort(deadline);
					reject(deadline);
				}, timeoutMs);
				controller.signal.addEventListener(
					"abort",
					() => reject(controller.signal.reason ?? new CancelledError()),
					{ once: true },
				);
				if (controller.signal.aborted) {
					reject(controller.signal.reason ?? new CancelledError());
				}
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
		parent?.removeEventListener("abort", cancel);
	}
}

async function emitEvidence(
	config: SandboxCustomToolsConfig,
	limits: ResolvedLimits,
	event: SandboxCustomToolEvidenceEvent,
): Promise<void> {
	if (!config.evidence) return;
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			Promise.resolve(
				config.evidence(Object.freeze(event), {
					signal: controller.signal,
				}),
			),
			new Promise<void>((resolve) => {
				timer = setTimeout(() => {
					controller.abort();
					resolve();
				}, limits.evidenceTimeoutMs);
			}),
		]);
	} catch {
		// Evidence is observational. It cannot expose details or rewrite authority.
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

export function registerSandboxCustomToolsSession(
	token: string,
	brokerUrl: string,
	envelope: unknown,
	ttlMs: number,
): { revoke(): void } {
	const now = Date.now();
	cleanupExpiredSessions(now);
	const endpoint = normalizeBrokerUrl(brokerUrl);
	if (
		typeof token !== "string" ||
		token.length === 0 ||
		encoder.encode(token).byteLength > 8_192 ||
		endpoint === null ||
		!Number.isSafeInteger(ttlMs) ||
		ttlMs <= 0 ||
		sessions.has(token) ||
		sessions.size >= MAX_ACTIVE_TOOL_SESSIONS
	) {
		throw new Error("sandbox custom-tool session could not be registered");
	}
	const session: ToolSession = {
		envelope,
		endpoint,
		expiresAt: now + Math.min(Math.round(ttlMs), 5 * 60_000),
		calls: 0,
		inFlight: 0,
		revoked: false,
	};
	sessions.set(token, session);
	return {
		revoke() {
			if (session.revoked) return;
			closeSession(token, session);
		},
	};
}

function resolveSession(
	token: string | null | undefined,
	requestUrl: string,
): ToolSession | null {
	if (!token) return null;
	const session = sessions.get(token);
	if (!session || session.revoked) return null;
	if (normalizeBrokerUrl(requestUrl) !== session.endpoint) return null;
	if (Date.now() >= session.expiresAt) {
		closeSession(token, session);
		return null;
	}
	return session;
}

function createToolPort(
	app: Questpie<any>,
	config: SandboxCustomToolsConfig,
	envelope: unknown,
) {
	return createWorkloadMcpToolPort(app as never, {
		envelope,
		authorizer: config.authorizer,
		contextBinder: config.contextBinder,
		audit: config.authorizationAudit,
		handoff: config.handoff,
	});
}

function mcpResultCode(
	result: McpProgrammaticToolResult,
): McpPublicErrorCode | undefined {
	const meta = result["_meta"];
	const detail =
		isRecord(meta) && isRecord(meta["questpie/error"])
			? meta["questpie/error"]
			: undefined;
	const descriptor = detail
		? Object.getOwnPropertyDescriptor(detail, "code")
		: undefined;
	const code =
		descriptor && "value" in descriptor ? descriptor.value : undefined;
	return [
		"access_denied",
		"invalid_input",
		"input_too_large",
		"output_too_large",
		"timeout",
		"cancelled",
		"busy",
		"internal",
	].includes(code as string)
		? (code as McpPublicErrorCode)
		: undefined;
}

export interface HandleSandboxCustomToolsRpcInput {
	readonly app: Questpie<any>;
	readonly config: SandboxCustomToolsConfig | undefined;
	readonly token: string | null | undefined;
	readonly requestUrl: string;
	readonly method: string;
	readonly args: unknown;
	readonly signal?: AbortSignal;
}

export async function handleSandboxCustomToolsRpc({
	app,
	config,
	token,
	requestUrl,
	method,
	args,
	signal,
}: HandleSandboxCustomToolsRpcInput): Promise<BrokerRpcResponse> {
	const session = resolveSession(token, requestUrl);
	if (!session || !config) {
		return error("unauthorized", "sandbox custom tool session is unavailable");
	}
	if (method !== "tools.list" && method !== "tools.call") {
		return error("bad_method", "invalid sandbox custom tool method");
	}

	const limits = resolveLimits(config);
	if (!limits) {
		return error(
			"execution_error",
			"sandbox custom tool configuration is invalid",
		);
	}
	const phase = method === "tools.list" ? "discovery" : "call";
	const started = performance.now();
	let toolName: string | undefined;
	const finish = async (
		result: BrokerRpcResponse,
		evidenceResult: SandboxCustomToolEvidenceEvent["result"],
		reason: SandboxCustomToolEvidenceEvent["reason"],
	) => {
		await emitEvidence(config, limits, {
			boundary: "sandbox.tool",
			phase,
			...(toolName ? { toolName } : {}),
			result: evidenceResult,
			reason,
			durationMs: Math.max(0, Math.round(performance.now() - started)),
		});
		return result;
	};

	if (session.calls >= limits.maxCalls) {
		return finish(
			error("forbidden", "sandbox custom tool limit exceeded"),
			"denied",
			"limit_exceeded",
		);
	}
	session.calls += 1;
	const requestId = session.calls;
	if (session.inFlight >= limits.concurrency) {
		return finish(
			error("forbidden", "sandbox custom tool limit exceeded"),
			"denied",
			"limit_exceeded",
		);
	}

	if (method === "tools.list") {
		if (!isRecord(args) || !hasExactKeys(args, [])) {
			return finish(
				error("bad_args", "invalid sandbox custom tool arguments"),
				"denied",
				"invalid_request",
			);
		}
	} else {
		if (
			!isRecord(args) ||
			!hasExactKeys(args, ["name"], ["arguments"]) ||
			typeof args.name !== "string" ||
			args.name.length === 0 ||
			encoder.encode(args.name).byteLength > 256 ||
			(args.arguments !== undefined && !isRecord(args.arguments))
		) {
			return finish(
				error("bad_args", "invalid sandbox custom tool arguments"),
				"denied",
				"invalid_request",
			);
		}
		toolName = args.name;
		const argumentBytes = jsonBytes(args.arguments ?? {});
		if (argumentBytes === null || argumentBytes > limits.maxArgumentBytes) {
			return finish(
				error("bad_args", "sandbox custom tool arguments are too large"),
				"denied",
				"limit_exceeded",
			);
		}
	}

	session.inFlight += 1;
	try {
		const value = await within(
			async (operationSignal) => {
				const port =
					session.port ??
					(session.port = createToolPort(app, config, session.envelope));
				if (method === "tools.list") {
					const listed = await port.listCustomTools({
						signal: operationSignal,
						requestId,
					});
					if (
						listed.tools.length > limits.maxTools ||
						(jsonBytes(listed) ?? Number.POSITIVE_INFINITY) >
							limits.maxListBytes
					) {
						throw new RangeError("tool list limit exceeded");
					}
					return listed;
				}
				return port.callCustomTool({
					name: toolName!,
					input: (args as Record<string, unknown>).arguments ?? {},
					signal: operationSignal,
					requestId,
				});
			},
			limits.timeoutMs,
			signal,
			() => {
				session.inFlight = Math.max(0, session.inFlight - 1);
			},
		);
		const callResult = value as unknown as McpProgrammaticToolResult;
		if (method === "tools.call" && callResult.isError === true) {
			const code = mcpResultCode(callResult);
			return finish(
				error(
					code === "invalid_input" || code === "input_too_large"
						? "bad_args"
						: code === "access_denied"
							? "forbidden"
							: "execution_error",
					code === "invalid_input" || code === "input_too_large"
						? "invalid sandbox custom tool arguments"
						: code === "access_denied"
							? "sandbox custom tool denied"
							: "sandbox custom tool failed",
				),
				code === "access_denied" ||
					code === "invalid_input" ||
					code === "input_too_large" ||
					code === "busy"
					? "denied"
					: "failed",
				code === "access_denied"
					? "authorization_or_tool_denied"
					: code === "invalid_input" || code === "input_too_large"
						? "invalid_request"
						: code === "timeout" || code === "cancelled"
							? "timed_out"
							: code === "busy" || code === "output_too_large"
								? "limit_exceeded"
								: "execution_failed",
			);
		}
		const resultBytes = jsonBytes(value);
		if (resultBytes === null || resultBytes > limits.maxResultBytes) {
			return finish(
				error("execution_error", "sandbox custom tool result is too large"),
				"failed",
				"limit_exceeded",
			);
		}
		return finish({ ok: true, value }, "succeeded", "completed");
	} catch (caught) {
		const publicCode = mcpPublicErrorCode(caught);
		return finish(
			error(
				publicCode === "invalid_input" || publicCode === "input_too_large"
					? "bad_args"
					: publicCode === "access_denied" || publicCode === "busy"
						? "forbidden"
						: "execution_error",
				caught instanceof DeadlineError || publicCode === "timeout"
					? "sandbox custom tool timed out"
					: caught instanceof CancelledError || publicCode === "cancelled"
						? "sandbox custom tool cancelled"
						: publicCode === "invalid_input" || publicCode === "input_too_large"
							? "invalid sandbox custom tool arguments"
							: publicCode === "access_denied"
								? "sandbox custom tool denied"
								: publicCode === "busy"
									? "sandbox custom tool limit exceeded"
									: "sandbox custom tool failed",
			),
			publicCode === "access_denied" ||
				publicCode === "invalid_input" ||
				publicCode === "input_too_large" ||
				publicCode === "busy"
				? "denied"
				: "failed",
			caught instanceof DeadlineError ||
				caught instanceof CancelledError ||
				publicCode === "timeout" ||
				publicCode === "cancelled"
				? "timed_out"
				: caught instanceof RangeError ||
					  publicCode === "busy" ||
					  publicCode === "output_too_large"
					? "limit_exceeded"
					: publicCode === "invalid_input" || publicCode === "input_too_large"
						? "invalid_request"
						: publicCode === "access_denied"
							? "authorization_or_tool_denied"
							: "execution_failed",
		);
	}
}
