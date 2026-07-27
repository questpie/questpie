import { randomUUID } from "node:crypto";
import { types as nodeTypes } from "node:util";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AppContext, RequestContext } from "questpie";
import {
	type BrokerJsonValue,
	snapshotBoundedBrokerValue,
} from "questpie/executor";
import { z } from "zod";

import type {
	McpAccessMode,
	McpExecutionConfig,
	McpExecutionDiagnosticEvent,
	McpExecutionLimits,
	McpPublicErrorCode,
	McpTransportKind,
} from "./types.js";

export const DEFAULT_MCP_EXECUTION_LIMITS = Object.freeze({
	maxInputBytes: 64 * 1024,
	maxInputDepth: 16,
	maxOutputDepth: 64,
	maxValueNodes: 10_000,
	maxOutputBytes: 1024 * 1024,
	timeoutMs: 30_000,
	maxConcurrency: 64,
	maxConcurrencyPerPrincipal: 8,
	maxTools: 512,
	maxResources: 512,
}) satisfies Required<McpExecutionLimits>;

const ABSOLUTE_MCP_EXECUTION_LIMITS = Object.freeze({
	maxInputBytes: 1024 * 1024,
	maxInputDepth: 64,
	maxOutputDepth: 64,
	maxValueNodes: 100_000,
	maxOutputBytes: 4 * 1024 * 1024,
	timeoutMs: 5 * 60_000,
	maxConcurrency: 1024,
	maxConcurrencyPerPrincipal: 1024,
	maxTools: 2048,
	maxResources: 2048,
}) satisfies Required<McpExecutionLimits>;

const PUBLIC_ERROR_META_KEY = "questpie/error";
const PUBLIC_ERROR_CODES = new Set<McpPublicErrorCode>([
	"access_denied",
	"invalid_input",
	"input_too_large",
	"output_too_large",
	"timeout",
	"cancelled",
	"busy",
	"internal",
]);

export interface McpHandlerExtra {
	signal: AbortSignal;
	requestId: string | number;
	_meta?: unknown;
}

interface ExecuteOptions<T> {
	operation: string;
	transport: McpTransportKind;
	accessMode: McpAccessMode;
	input: unknown;
	extra: McpHandlerExtra;
	authorize: (control: {
		signal: AbortSignal;
		requestId: string | number;
		correlationId: string;
	}) => Promise<AppContext & Partial<RequestContext>>;
	/** Optional workload-owned stable key for the per-principal bucket. */
	concurrencyKey?: () => string | undefined;
	invoke: (input: {
		ctx: AppContext & Partial<RequestContext>;
		signal: AbortSignal;
		requestId: string | number;
		correlationId: string;
	}) => T | Promise<T>;
}

export class McpPublicError extends Error {
	readonly code: McpPublicErrorCode;
	readonly correlationId: string;

	constructor(code: McpPublicErrorCode, correlationId: string = randomUUID()) {
		super(`${publicMessage(code)} (${code}; correlationId=${correlationId})`);
		this.name = "McpPublicError";
		this.code = code;
		this.correlationId = correlationId;
	}
}

export class McpAccessDeniedError extends Error {
	constructor() {
		super("MCP access denied");
		this.name = "McpAccessDeniedError";
	}
}

/** Read a public boundary code without touching an error message or accessor. */
export function mcpPublicErrorCode(
	error: unknown,
): McpPublicErrorCode | undefined {
	if (!error || typeof error !== "object" || nodeTypes.isProxy(error)) {
		return undefined;
	}
	try {
		const descriptor = Object.getOwnPropertyDescriptor(error, "code");
		return descriptor &&
			"value" in descriptor &&
			typeof descriptor.value === "string" &&
			PUBLIC_ERROR_CODES.has(descriptor.value as McpPublicErrorCode)
			? (descriptor.value as McpPublicErrorCode)
			: undefined;
	} catch {
		return undefined;
	}
}

function positiveInteger(
	value: number | undefined,
	fallback: number,
	maximum: number,
	name: string,
): number {
	if (value === undefined) return fallback;
	if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
		throw new Error(`Invalid MCP execution limit: ${name}`);
	}
	return value;
}

export function resolveMcpExecutionLimits(
	config: McpExecutionConfig | undefined,
): Required<McpExecutionLimits> {
	const limits = {
		maxInputBytes: positiveInteger(
			config?.maxInputBytes,
			DEFAULT_MCP_EXECUTION_LIMITS.maxInputBytes,
			ABSOLUTE_MCP_EXECUTION_LIMITS.maxInputBytes,
			"maxInputBytes",
		),
		maxInputDepth: positiveInteger(
			config?.maxInputDepth,
			DEFAULT_MCP_EXECUTION_LIMITS.maxInputDepth,
			ABSOLUTE_MCP_EXECUTION_LIMITS.maxInputDepth,
			"maxInputDepth",
		),
		maxOutputDepth: positiveInteger(
			config?.maxOutputDepth,
			DEFAULT_MCP_EXECUTION_LIMITS.maxOutputDepth,
			ABSOLUTE_MCP_EXECUTION_LIMITS.maxOutputDepth,
			"maxOutputDepth",
		),
		maxValueNodes: positiveInteger(
			config?.maxValueNodes,
			DEFAULT_MCP_EXECUTION_LIMITS.maxValueNodes,
			ABSOLUTE_MCP_EXECUTION_LIMITS.maxValueNodes,
			"maxValueNodes",
		),
		maxOutputBytes: positiveInteger(
			config?.maxOutputBytes,
			DEFAULT_MCP_EXECUTION_LIMITS.maxOutputBytes,
			ABSOLUTE_MCP_EXECUTION_LIMITS.maxOutputBytes,
			"maxOutputBytes",
		),
		timeoutMs: positiveInteger(
			config?.timeoutMs,
			DEFAULT_MCP_EXECUTION_LIMITS.timeoutMs,
			ABSOLUTE_MCP_EXECUTION_LIMITS.timeoutMs,
			"timeoutMs",
		),
		maxConcurrency: positiveInteger(
			config?.maxConcurrency,
			DEFAULT_MCP_EXECUTION_LIMITS.maxConcurrency,
			ABSOLUTE_MCP_EXECUTION_LIMITS.maxConcurrency,
			"maxConcurrency",
		),
		maxConcurrencyPerPrincipal: positiveInteger(
			config?.maxConcurrencyPerPrincipal,
			DEFAULT_MCP_EXECUTION_LIMITS.maxConcurrencyPerPrincipal,
			ABSOLUTE_MCP_EXECUTION_LIMITS.maxConcurrencyPerPrincipal,
			"maxConcurrencyPerPrincipal",
		),
		maxTools: positiveInteger(
			config?.maxTools,
			DEFAULT_MCP_EXECUTION_LIMITS.maxTools,
			ABSOLUTE_MCP_EXECUTION_LIMITS.maxTools,
			"maxTools",
		),
		maxResources: positiveInteger(
			config?.maxResources,
			DEFAULT_MCP_EXECUTION_LIMITS.maxResources,
			ABSOLUTE_MCP_EXECUTION_LIMITS.maxResources,
			"maxResources",
		),
	};
	if (limits.maxConcurrencyPerPrincipal > limits.maxConcurrency) {
		throw new Error("Invalid MCP execution limit: maxConcurrencyPerPrincipal");
	}
	return Object.freeze(limits);
}

function jsonStringBytes(value: string, maximum: number): number {
	if (maximum < 0) return 1;
	if (maximum < 2 || value.length + 2 > maximum) return maximum + 1;
	let bytes = 2;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code === 0x22 || code === 0x5c) {
			bytes += 2;
		} else if (code <= 0x1f) {
			bytes +=
				code === 0x08 ||
				code === 0x09 ||
				code === 0x0a ||
				code === 0x0c ||
				code === 0x0d
					? 2
					: 6;
		} else if (code <= 0x7f) {
			bytes += 1;
		} else if (code <= 0x7ff) {
			bytes += 2;
		} else if (
			code >= 0xd800 &&
			code <= 0xdbff &&
			index + 1 < value.length &&
			value.charCodeAt(index + 1) >= 0xdc00 &&
			value.charCodeAt(index + 1) <= 0xdfff
		) {
			bytes += 4;
			index += 1;
		} else if (code >= 0xd800 && code <= 0xdfff) {
			bytes += 6;
		} else {
			bytes += 3;
		}
		if (bytes > maximum) return maximum + 1;
	}
	return bytes;
}

function isJsonContainer(value: unknown): value is object {
	if (!value || typeof value !== "object" || nodeTypes.isProxy(value)) {
		return false;
	}
	try {
		const prototype = Object.getPrototypeOf(value);
		return Array.isArray(value)
			? prototype === Array.prototype
			: prototype === Object.prototype || prototype === null;
	} catch {
		return false;
	}
}

function isJsonDate(value: unknown): value is Date {
	if (!(value instanceof Date) || nodeTypes.isProxy(value)) return false;
	try {
		return (
			Object.getPrototypeOf(value) === Date.prototype &&
			Number.isFinite(Date.prototype.getTime.call(value))
		);
	} catch {
		return false;
	}
}

function isArrayIndex(key: string, length: number): boolean {
	const index = Number(key);
	return (
		Number.isSafeInteger(index) &&
		index >= 0 &&
		index < length &&
		String(index) === key
	);
}

export function assertBoundedMcpValue(
	value: unknown,
	limits: {
		maxValueDepth: number;
		maxValueNodes: number;
		maxBytes: number;
	},
	code: Extract<McpPublicErrorCode, "input_too_large" | "output_too_large">,
	correlationId: string = randomUUID(),
): void {
	const pending: Array<{ value: unknown; depth: number }> = [
		{ value, depth: 0 },
	];
	let nodes = 0;
	let bytes = 0;

	while (pending.length > 0) {
		const next = pending.pop()!;
		nodes += 1;
		if (nodes > limits.maxValueNodes || next.depth > limits.maxValueDepth) {
			throw new McpPublicError(code, correlationId);
		}
		const current = next.value;
		if (current === null || typeof current === "boolean") {
			bytes += 5;
		} else if (typeof current === "number") {
			if (typeof current === "number" && !Number.isFinite(current)) {
				throw new McpPublicError(code, correlationId);
			}
			bytes += 32;
		} else if (typeof current === "string") {
			bytes += jsonStringBytes(current, limits.maxBytes - bytes);
		} else if (typeof current === "bigint") {
			bytes += jsonStringBytes(current.toString(), limits.maxBytes - bytes);
		} else if (isJsonDate(current)) {
			bytes += 32;
		} else if (isJsonContainer(current)) {
			let descriptors: PropertyDescriptorMap;
			try {
				descriptors = Object.getOwnPropertyDescriptors(current);
			} catch {
				throw new McpPublicError(code, correlationId);
			}
			const arrayLength = Array.isArray(current) ? current.length : undefined;
			let arrayIndexes = 0;
			bytes += 2;
			for (const [key, descriptor] of Object.entries(descriptors)) {
				if (key === "toJSON") {
					throw new McpPublicError(code, correlationId);
				}
				if (arrayLength !== undefined && isArrayIndex(key, arrayLength)) {
					arrayIndexes += 1;
					if (!("value" in descriptor)) {
						throw new McpPublicError(code, correlationId);
					}
					pending.push({
						value: descriptor.value,
						depth: next.depth + 1,
					});
					continue;
				}
				if (!descriptor.enumerable) continue;
				if (!("value" in descriptor)) {
					throw new McpPublicError(code, correlationId);
				}
				bytes += jsonStringBytes(key, limits.maxBytes - bytes) + 4;
				pending.push({
					value: descriptor.value,
					depth: next.depth + 1,
				});
			}
			if (arrayLength !== undefined) {
				if (arrayLength > limits.maxValueNodes) {
					throw new McpPublicError(code, correlationId);
				}
				const holes = arrayLength - arrayIndexes;
				nodes += holes;
				bytes += Math.max(0, arrayLength - 1) + holes * 4;
			}
		} else if (current !== undefined) {
			throw new McpPublicError(code, correlationId);
		}
		if (nodes > limits.maxValueNodes || bytes > limits.maxBytes) {
			throw new McpPublicError(code, correlationId);
		}
	}
}

export function snapshotBoundedMcpValue(
	value: unknown,
	limits: {
		maxValueDepth: number;
		maxValueNodes: number;
		maxBytes: number;
	},
	code: Extract<McpPublicErrorCode, "input_too_large" | "output_too_large">,
	correlationId: string = randomUUID(),
): BrokerJsonValue {
	const snapshot = snapshotBoundedBrokerValue(
		value === undefined ? null : value,
		limits.maxBytes,
		limits.maxValueDepth,
		limits.maxValueNodes,
	);
	if (!snapshot.ok) throw new McpPublicError(code, correlationId);
	return snapshot.value;
}

function publicMessage(code: McpPublicErrorCode): string {
	return code === "access_denied"
		? "MCP access denied"
		: "MCP operation failed";
}

function classifyError(error: unknown, correlationId: string): McpPublicError {
	if (
		!!error &&
		(typeof error === "object" || typeof error === "function") &&
		nodeTypes.isProxy(error)
	) {
		return new McpPublicError("internal", correlationId);
	}
	if (error instanceof McpPublicError) return error;
	if (error instanceof McpAccessDeniedError || isLegacyAccessDenied(error)) {
		return new McpPublicError("access_denied", correlationId);
	}
	if (error instanceof z.ZodError) {
		return new McpPublicError("invalid_input", correlationId);
	}
	return new McpPublicError("internal", correlationId);
}

function isLegacyAccessDenied(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	try {
		const descriptor = Object.getOwnPropertyDescriptor(error, "message");
		return (
			!!descriptor &&
			"value" in descriptor &&
			descriptor.value === "MCP access denied"
		);
	} catch {
		return false;
	}
}

function diagnosticError(error: unknown) {
	try {
		return Object.freeze({
			kind: error instanceof Error ? ("Error" as const) : ("Unknown" as const),
		});
	} catch {
		return Object.freeze({ kind: "Unknown" as const });
	}
}

function dataProperty(value: unknown, key: string): unknown {
	if (!value || typeof value !== "object" || nodeTypes.isProxy(value)) {
		return undefined;
	}
	try {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		return descriptor && "value" in descriptor ? descriptor.value : undefined;
	} catch {
		return undefined;
	}
}

function principalKey(
	ctx: AppContext & Partial<RequestContext>,
	transport: McpTransportKind,
	accessMode: McpAccessMode,
	workloadConcurrencyKey?: string,
): string {
	if (accessMode === "system") return `${transport}:system`;
	if (
		transport === "workload" &&
		typeof workloadConcurrencyKey === "string" &&
		workloadConcurrencyKey.length > 0
	) {
		return `workload:${workloadConcurrencyKey.slice(0, 256)}`;
	}
	const principal = dataProperty(ctx, "principal");
	const kind = dataProperty(principal, "kind");
	if (kind === "oauth") {
		const tokenId = dataProperty(principal, "tokenId");
		if (typeof tokenId === "string" && tokenId.length > 0) {
			return `oauth:${tokenId.slice(0, 256)}`;
		}
		const clientId = dataProperty(principal, "clientId");
		const user = dataProperty(principal, "user");
		const userId = dataProperty(user, "id");
		return `oauth:${String(clientId).slice(0, 128)}:${String(userId).slice(0, 128)}`;
	}
	if (kind === "user") {
		const session = dataProperty(principal, "session");
		const sessionId = dataProperty(session, "id");
		if (typeof sessionId === "string" && sessionId.length > 0) {
			return `user:${sessionId.slice(0, 256)}`;
		}
	}
	return `${transport}:anonymous`;
}

function safeRequestId(value: string | number): string | number | undefined {
	if (typeof value === "number") {
		return Number.isSafeInteger(value) ? value : undefined;
	}
	return /^[\w.:-]{1,128}$/.test(value) ? value : undefined;
}

export function toMcpToolError(error: unknown): CallToolResult {
	const resolved =
		error instanceof McpPublicError
			? error
			: classifyError(error, randomUUID());
	return {
		isError: true,
		content: [{ type: "text", text: publicMessage(resolved.code) }],
		_meta: {
			[PUBLIC_ERROR_META_KEY]: {
				code: resolved.code,
				correlationId: resolved.correlationId,
			},
		},
	};
}

export class McpExecutionGate {
	active = 0;
	readonly activeByPrincipal = new Map<string, number>();
	diagnosticActive = false;
}

export class McpExecutionBoundary {
	readonly limits: Required<McpExecutionLimits>;

	constructor(
		private readonly config: Readonly<McpExecutionConfig> = {},
		private readonly gate = new McpExecutionGate(),
	) {
		this.limits = resolveMcpExecutionLimits(config);
	}

	private emitDiagnostic(event: McpExecutionDiagnosticEvent): void {
		if (!this.config.onDiagnostic || this.gate.diagnosticActive) return;
		this.gate.diagnosticActive = true;
		Promise.resolve()
			.then(() => this.config.onDiagnostic!(Object.freeze(event)))
			.catch(() => undefined)
			.finally(() => {
				this.gate.diagnosticActive = false;
			});
	}

	private acquireGlobal(correlationId: string): () => void {
		if (this.gate.active >= this.limits.maxConcurrency) {
			throw new McpPublicError("busy", correlationId);
		}
		this.gate.active += 1;
		return () => {
			this.gate.active -= 1;
		};
	}

	private acquirePrincipal(key: string, correlationId: string): () => void {
		const active = this.gate.activeByPrincipal.get(key) ?? 0;
		if (active >= this.limits.maxConcurrencyPerPrincipal) {
			throw new McpPublicError("busy", correlationId);
		}
		this.gate.activeByPrincipal.set(key, active + 1);
		return () => {
			const next = (this.gate.activeByPrincipal.get(key) ?? 1) - 1;
			if (next === 0) this.gate.activeByPrincipal.delete(key);
			else this.gate.activeByPrincipal.set(key, next);
		};
	}

	async execute<T>(options: ExecuteOptions<T>): Promise<T> {
		const startedAt = Date.now();
		const correlationId = randomUUID();
		const requestId = safeRequestId(options.extra.requestId);
		let rawError: unknown;

		try {
			assertBoundedMcpValue(
				options.input,
				{
					maxBytes: this.limits.maxInputBytes,
					maxValueDepth: this.limits.maxInputDepth,
					maxValueNodes: this.limits.maxValueNodes,
				},
				"input_too_large",
				correlationId,
			);
			if (options.extra.signal.aborted) {
				throw new McpPublicError("cancelled", correlationId);
			}

			const releaseGlobal = this.acquireGlobal(correlationId);
			const controller = new AbortController();
			let timedOut = false;
			const cancel = () => controller.abort(options.extra.signal.reason);
			options.extra.signal.addEventListener("abort", cancel, { once: true });
			const timer = setTimeout(() => {
				timedOut = true;
				controller.abort(new Error("MCP execution deadline exceeded"));
			}, this.limits.timeoutMs);

			let releasePrincipal: (() => void) | undefined;
			const work = Promise.resolve().then(async () => {
				const ctx = await options.authorize({
					signal: controller.signal,
					requestId: options.extra.requestId,
					correlationId,
				});
				if (controller.signal.aborted) {
					throw new McpPublicError(
						timedOut ? "timeout" : "cancelled",
						correlationId,
					);
				}
				releasePrincipal = this.acquirePrincipal(
					principalKey(
						ctx,
						options.transport,
						options.accessMode,
						options.concurrencyKey?.(),
					),
					correlationId,
				);
				const result = await options.invoke({
					ctx,
					signal: controller.signal,
					requestId: options.extra.requestId,
					correlationId,
				});
				const resultSnapshot = snapshotBoundedMcpValue(
					result,
					{
						maxBytes: this.limits.maxOutputBytes,
						maxValueDepth: this.limits.maxOutputDepth,
						maxValueNodes: this.limits.maxValueNodes,
					},
					"output_too_large",
					correlationId,
				);
				return resultSnapshot as T;
			});
			const settled = work.finally(() => {
				releasePrincipal?.();
				releaseGlobal();
			});
			void settled.catch(() => undefined);

			const aborted = new Promise<never>((_resolve, reject) => {
				const onAbort = () =>
					reject(
						new McpPublicError(
							timedOut ? "timeout" : "cancelled",
							correlationId,
						),
					);
				if (controller.signal.aborted) onAbort();
				else
					controller.signal.addEventListener("abort", onAbort, { once: true });
			});

			try {
				const result = await Promise.race([settled, aborted]);
				this.emitDiagnostic({
					correlationId,
					...(requestId !== undefined ? { requestId } : {}),
					transport: options.transport,
					operation: options.operation.slice(0, 256),
					durationMs: Date.now() - startedAt,
					outcome: "completed",
				});
				return result;
			} finally {
				clearTimeout(timer);
				options.extra.signal.removeEventListener("abort", cancel);
			}
		} catch (error) {
			rawError = error;
			const publicError = classifyError(error, correlationId);
			this.emitDiagnostic({
				correlationId: publicError.correlationId,
				...(requestId !== undefined ? { requestId } : {}),
				transport: options.transport,
				operation: options.operation.slice(0, 256),
				durationMs: Date.now() - startedAt,
				outcome: "rejected",
				code: publicError.code,
				...(publicError.code === "internal"
					? { internalError: diagnosticError(rawError) }
					: {}),
			});
			throw publicError;
		}
	}
}
