import type { Principal } from "questpie";

import { readBoundedRequestBody } from "../../operation";
import { parseJsonWithoutDuplicateKeys } from "../strict-json";
import {
	MCP_PROTOCOL_VERSION,
	type McpExecutionResult,
	type McpToolBinding,
} from "./contract";

export { decodeMcpProjection } from "./artifact";
export type { McpExecutionResult, McpToolBinding } from "./contract";

type JsonRecord = Readonly<Record<string, unknown>>;

function protocolError(
	id: string | number | undefined,
	code: number,
	message: string,
	status = 200,
	data?: unknown,
): Response {
	return json(
		{
			jsonrpc: "2.0",
			...(id === undefined ? {} : { id }),
			error: { code, message, ...(data === undefined ? {} : { data }) },
		},
		status,
	);
}

/** Shared `no-store` discipline with the canonical HTTP failure shape. */
const NO_STORE = "private, no-store";

function gateFailure(
	id: string | number | undefined,
	status: number,
	code: number,
	message: string,
	wwwAuthenticate?: string,
): Response {
	return new Response(
		JSON.stringify({
			jsonrpc: "2.0",
			...(id === undefined ? {} : { id }),
			error: { code, message },
		}),
		{
			status,
			headers: {
				"content-type": "application/json; charset=utf-8",
				"cache-control": NO_STORE,
				...(wwwAuthenticate === undefined
					? {}
					: { "www-authenticate": wwwAuthenticate }),
			},
		},
	);
}

/**
 * A real HTTP `401` on an armed gate. `wwwAuthenticate` is app-supplied
 * decoration only — the framework forwards it verbatim, never constructs or
 * interprets it (see `safeCredentialChallenge` for the one validation it
 * does apply: header-value safety, not meaning).
 */
function unauthorized(
	id: string | number | undefined,
	wwwAuthenticate: string | undefined,
): Response {
	return gateFailure(id, 401, -32001, "Unauthorized", wwwAuthenticate);
}

/** The credential provider itself failed (e.g. an outage). Never fail open. */
function credentialProviderUnavailable(
	id: string | number | undefined,
): Response {
	return gateFailure(id, 503, -32002, "Service Unavailable");
}

/** The credential resolution phase missed its deadline. Never fail open. */
function credentialResolutionTimedOut(
	id: string | number | undefined,
): Response {
	return gateFailure(id, 408, -32003, "Request Timeout");
}

export type McpAuthenticationOutcome =
	| Readonly<{ kind: "authenticated"; principal?: Principal }>
	| Readonly<{ kind: "unauthenticated"; wwwAuthenticate?: string }>
	| Readonly<{ kind: "unavailable" }>
	| Readonly<{ kind: "deadline" }>
	| Readonly<{ kind: "deferred" }>;

function json(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

function record(value: unknown): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError("invalid MCP record");
	return value as JsonRecord;
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value === "boolean" || typeof value === "string")
		return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new TypeError("noncanonical MCP number");
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value && typeof value === "object") {
		const source = value as Readonly<Record<string, unknown>>;
		return `{${Object.keys(source)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`)
			.join(",")}}`;
	}
	throw new TypeError("noncanonical MCP value");
}

function accepts(request: Request, mediaType: string): boolean {
	return (request.headers.get("accept") ?? "")
		.split(",")
		.map((value) => value.trim().split(";", 1)[0]?.toLowerCase())
		.includes(mediaType);
}

function contentType(request: Request): boolean {
	return /^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?$/iu.test(
		request.headers.get("content-type") ?? "",
	);
}

function requestSse(
	request: Request,
	produce: (signal: AbortSignal) => Promise<unknown>,
): Response {
	const execution = new AbortController();
	const abort = () => execution.abort();
	request.signal.addEventListener("abort", abort, { once: true });
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			void produce(execution.signal)
				.then((value) => {
					if (execution.signal.aborted) return;
					try {
						controller.enqueue(
							new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`),
						);
						controller.close();
					} catch {
						// Consumer cancellation owns the already selected stream outcome.
					}
				})
				.catch(() => undefined)
				.finally(() => request.signal.removeEventListener("abort", abort));
		},
		cancel() {
			abort();
			request.signal.removeEventListener("abort", abort);
		},
	});
	return new Response(stream, {
		status: 200,
		headers: {
			"content-type": "text/event-stream",
			"x-accel-buffering": "no",
		},
	});
}

export function createMcpIngress(
	input: Readonly<{
		serverInfo: Readonly<{ name: string; version: string }>;
		maximumRequestBytes: number;
		tools: readonly McpToolBinding[];
		/**
		 * Credential preflight. Called only for an armed method
		 * (`requireCredential` for `tools/call`, `protectCatalog` for the
		 * catalogue) — arming is a fixed boolean, never a per-Request return
		 * value. Unarmed: unchanged from ADR-0038. Armed:
		 * `"unauthenticated"`/`"unavailable"`/`"deadline"` short-circuit to a
		 * fail-closed status; `"deferred"` falls through unchanged;
		 * `"authenticated"` may carry the resolved Principal to avoid
		 * resolving it twice.
		 */
		authenticate?(
			request: Request,
			signal: AbortSignal,
		): Promise<McpAuthenticationOutcome>;
		/** Arm the gate on `tools/list`/`server/discover`. */
		protectCatalog?: boolean;
		/** Arm the gate on `tools/call`, including for an anonymous caller. */
		requireCredential?: boolean;
		execute(
			value: Readonly<{
				arguments: unknown;
				identity: string;
				kind: McpToolBinding["kind"];
				request: Request;
				signal: AbortSignal;
				principal?: Principal;
			}>,
		): Promise<McpExecutionResult>;
	}>,
): Readonly<{ fetch(request: Request): Promise<Response | null> }> {
	return Object.freeze({
		fetch: async (request: Request): Promise<Response | null> => {
			const url = new URL(request.url);
			if (url.pathname !== "/_questpie/mcp") return null;
			if (request.method !== "POST") return new Response(null, { status: 405 });
			if (
				!accepts(request, "application/json") ||
				!accepts(request, "text/event-stream") ||
				!contentType(request)
			)
				return protocolError(undefined, -32600, "Invalid request", 400);
			const origin = request.headers.get("origin");
			if (origin !== null && origin !== url.origin)
				return new Response(null, { status: 403 });
			const body = await readBoundedRequestBody(
				request,
				input.maximumRequestBytes,
			);
			if (body.kind !== "body")
				return protocolError(undefined, -32600, "Invalid request", 400);
			let parsed: unknown;
			try {
				parsed = parseJsonWithoutDuplicateKeys(body.text);
			} catch {
				return protocolError(undefined, -32700, "Parse error", 400);
			}
			let envelope: JsonRecord;
			try {
				envelope = record(parsed);
			} catch {
				return protocolError(undefined, -32600, "Invalid request", 400);
			}
			if (
				envelope.jsonrpc !== "2.0" ||
				(typeof envelope.id !== "string" && typeof envelope.id !== "number") ||
				typeof envelope.method !== "string" ||
				(envelope.params !== undefined &&
					(!envelope.params ||
						typeof envelope.params !== "object" ||
						Array.isArray(envelope.params)))
			)
				return protocolError(undefined, -32600, "Invalid request", 400);
			const id = envelope.id;
			const method = envelope.method;
			const params = (envelope.params ?? {}) as JsonRecord;
			const requestedVersion = request.headers.get("mcp-protocol-version");
			if (requestedVersion !== MCP_PROTOCOL_VERSION)
				return protocolError(id, -32022, "Unsupported protocol version", 400, {
					requested: requestedVersion,
					supported: [MCP_PROTOCOL_VERSION],
				});
			const metadata = params["_meta"] as JsonRecord | undefined;
			if (
				request.headers.get("mcp-method") !== method ||
				metadata?.["io.modelcontextprotocol/protocolVersion"] !==
					MCP_PROTOCOL_VERSION ||
				!metadata?.["io.modelcontextprotocol/clientCapabilities"] ||
				typeof metadata["io.modelcontextprotocol/clientCapabilities"] !==
					"object" ||
				Array.isArray(metadata["io.modelcontextprotocol/clientCapabilities"])
			) {
				return protocolError(id, -32020, "Request metadata mismatch", 400);
			}
			if (
				method === "tools/call" &&
				request.headers.get("mcp-name") !== params.name
			) {
				return protocolError(id, -32020, "Request metadata mismatch", 400);
			}
			// Authentication runs after transport/protocol validation (which
			// discloses nothing app-specific and is identical for every caller)
			// and before any method-specific dispatch, so an unauthenticated or
			// invalid caller never learns the catalogue contents or whether a
			// named tool exists. It only runs for a method the caller armed.
			let resolvedPrincipal: Principal | undefined;
			if (
				input.authenticate &&
				((method === "tools/call" && input.requireCredential) ||
					((method === "tools/list" || method === "server/discover") &&
						input.protectCatalog))
			) {
				const authentication = await input.authenticate(
					request,
					request.signal,
				);
				if (authentication.kind === "unauthenticated")
					return unauthorized(id, authentication.wwwAuthenticate);
				if (authentication.kind === "unavailable")
					return credentialProviderUnavailable(id);
				if (authentication.kind === "deadline")
					return credentialResolutionTimedOut(id);
				if (authentication.kind === "authenticated")
					resolvedPrincipal = authentication.principal;
			}
			const serverMetadata = {
				"io.modelcontextprotocol/serverInfo": input.serverInfo,
			};
			if (method === "server/discover")
				return json({
					jsonrpc: "2.0",
					id,
					result: {
						resultType: "complete",
						supportedVersions: [MCP_PROTOCOL_VERSION],
						capabilities: { tools: {} },
						ttlMs: 0,
						cacheScope: "public",
						_meta: serverMetadata,
					},
				});
			if (method === "tools/list") {
				if (params.cursor !== undefined)
					return protocolError(id, -32602, "Invalid params");
				return json({
					jsonrpc: "2.0",
					id,
					result: {
						resultType: "complete",
						tools: input.tools.map(({ tool }) => tool),
						ttlMs: 0,
						cacheScope: "public",
						_meta: serverMetadata,
					},
				});
			}
			if (method !== "tools/call")
				return protocolError(id, -32601, "Method not found");
			if (
				params.inputResponses !== undefined ||
				params.requestState !== undefined
			)
				return protocolError(id, -32602, "Invalid params");
			const name = typeof params.name === "string" ? params.name : "";
			const binding = input.tools.find(({ tool }) => tool.name === name);
			if (!binding) return protocolError(id, -32602, "Unknown tool");
			return requestSse(request, async (signal) => {
				try {
					const outcome = await input.execute({
						identity: binding.identity,
						kind: binding.kind,
						arguments: params.arguments,
						request,
						signal,
						...(resolvedPrincipal === undefined
							? {}
							: { principal: resolvedPrincipal }),
					});
					const text = canonicalJson(outcome.structuredContent);
					return {
						jsonrpc: "2.0",
						id,
						result: {
							resultType: "complete",
							content: [{ type: "text", text }],
							structuredContent: outcome.structuredContent,
							...(outcome.isError ? { isError: true } : {}),
							_meta: serverMetadata,
						},
					};
				} catch {
					return {
						jsonrpc: "2.0",
						id,
						error: { code: -32603, message: "Internal error" },
					};
				}
			});
		},
	});
}
