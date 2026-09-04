import { readBoundedRequestBody } from "../../operation";
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

function parseJson(source: string): unknown {
	let offset = 0;
	const whitespace = () => {
		while (/\s/u.test(source[offset] ?? "")) offset += 1;
	};
	const string = (): string => {
		const start = offset;
		offset += 1;
		while (offset < source.length) {
			const character = source[offset]!;
			offset += 1;
			if (character === "\\") {
				offset += 1;
				continue;
			}
			if (character === '"')
				return JSON.parse(source.slice(start, offset)) as string;
		}
		throw new TypeError("invalid MCP JSON string");
	};
	const value = (): void => {
		whitespace();
		if (source[offset] === "{") {
			offset += 1;
			whitespace();
			const keys = new Set<string>();
			if (source[offset] === "}") {
				offset += 1;
				return;
			}
			while (offset < source.length) {
				whitespace();
				if (source[offset] !== '"')
					throw new TypeError("invalid MCP JSON object");
				const key = string();
				if (keys.has(key)) throw new TypeError("duplicate MCP JSON key");
				keys.add(key);
				whitespace();
				if (source[offset] !== ":")
					throw new TypeError("invalid MCP JSON object");
				offset += 1;
				value();
				whitespace();
				if (source[offset] === "}") {
					offset += 1;
					return;
				}
				if (source[offset] !== ",")
					throw new TypeError("invalid MCP JSON object");
				offset += 1;
			}
			throw new TypeError("invalid MCP JSON object");
		}
		if (source[offset] === "[") {
			offset += 1;
			whitespace();
			if (source[offset] === "]") {
				offset += 1;
				return;
			}
			while (offset < source.length) {
				value();
				whitespace();
				if (source[offset] === "]") {
					offset += 1;
					return;
				}
				if (source[offset] !== ",")
					throw new TypeError("invalid MCP JSON array");
				offset += 1;
			}
			throw new TypeError("invalid MCP JSON array");
		}
		if (source[offset] === '"') {
			string();
			return;
		}
		const start = offset;
		while (offset < source.length && !/[\s,\]}]/u.test(source[offset] ?? ""))
			offset += 1;
		if (start === offset) throw new TypeError("invalid MCP JSON value");
	};
	value();
	whitespace();
	if (offset !== source.length) throw new TypeError("invalid MCP JSON");
	return JSON.parse(source) as unknown;
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
		execute(
			value: Readonly<{
				arguments: unknown;
				identity: string;
				kind: McpToolBinding["kind"];
				request: Request;
				signal: AbortSignal;
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
				parsed = parseJson(body.text);
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
