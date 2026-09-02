export const MCP_PROTOCOL_VERSION = "2026-07-28" as const;

export type McpServerInfo = Readonly<{
	name: string;
	version: string;
}>;

export type McpExecutionResult = Readonly<{
	structuredContent: unknown;
	isError: boolean;
}>;

export type McpToolBinding = Readonly<{
	identity: string;
	kind: "query" | "mutation" | "action";
	tool: Readonly<Record<string, unknown>>;
}>;

export type McpIngress = Readonly<{
	fetch(request: Request): Promise<Response | null>;
}>;

export function createMcpIngress(
	input: Readonly<{
		serverInfo: McpServerInfo;
		tools: readonly McpToolBinding[];
		execute(
			value: Readonly<{
				arguments: unknown;
				identity: string;
				kind: McpToolBinding["kind"];
				signal: AbortSignal;
			}>,
		): Promise<McpExecutionResult>;
	}>,
): McpIngress {
	return Object.freeze({
		fetch: async (request: Request): Promise<Response | null> => {
			const url = new URL(request.url);
			if (url.pathname !== "/_questpie/mcp") return null;
			if (request.method !== "POST") return new Response(null, { status: 405 });
			const origin = request.headers.get("origin");
			if (origin !== null && origin !== url.origin)
				return new Response(null, { status: 403 });
			let message: Readonly<{
				id: string | number;
				method: string;
				params?: Readonly<Record<string, unknown>>;
			}>;
			try {
				message = (await request.json()) as typeof message;
			} catch {
				return protocolError(undefined, -32700, "Parse error", 400);
			}
			const requestedVersion = request.headers.get("mcp-protocol-version");
			if (requestedVersion !== MCP_PROTOCOL_VERSION)
				return protocolError(
					message.id,
					-32022,
					"Unsupported protocol version",
					400,
					{ requested: requestedVersion, supported: [MCP_PROTOCOL_VERSION] },
				);
			const metadata = message.params?.["_meta"] as
				| Readonly<Record<string, unknown>>
				| undefined;
			if (
				request.headers.get("mcp-method") !== message.method ||
				metadata?.["io.modelcontextprotocol/protocolVersion"] !==
					MCP_PROTOCOL_VERSION ||
				typeof metadata?.["io.modelcontextprotocol/clientCapabilities"] !==
					"object"
			)
				return protocolError(
					message.id,
					-32020,
					"Request metadata mismatch",
					400,
				);
			if (
				message.method === "tools/call" &&
				request.headers.get("mcp-name") !== message.params?.name
			)
				return protocolError(
					message.id,
					-32020,
					"Request metadata mismatch",
					400,
				);
			if (message.method === "tools/list")
				return json({
					jsonrpc: "2.0",
					id: message.id,
					result: {
						resultType: "complete",
						tools: input.tools.map(({ tool }) => tool),
						ttlMs: 0,
						cacheScope: "public",
						_meta: {
							"io.modelcontextprotocol/serverInfo": input.serverInfo,
						},
					},
				});
			if (message.method === "tools/call") {
				const name = String(message.params?.name ?? "");
				const binding = input.tools.find(({ tool }) => tool.name === name);
				if (!binding) return protocolError(message.id, -32602, "Unknown tool");
				return sse(request, async (signal) => {
					const outcome = await input.execute({
						identity: binding.identity,
						kind: binding.kind,
						arguments: message.params?.arguments,
						signal,
					});
					return {
						jsonrpc: "2.0",
						id: message.id,
						result: {
							resultType: "complete",
							content: [
								{
									type: "text",
									text: canonicalJson(outcome.structuredContent),
								},
							],
							structuredContent: outcome.structuredContent,
							...(outcome.isError ? { isError: true } : {}),
							_meta: {
								"io.modelcontextprotocol/serverInfo": input.serverInfo,
							},
						},
					};
				});
			}
			if (message.method !== "server/discover")
				return new Response(null, { status: 404 });
			return json({
				jsonrpc: "2.0",
				id: message.id,
				result: {
					resultType: "complete",
					supportedVersions: [MCP_PROTOCOL_VERSION],
					capabilities: { tools: {} },
					ttlMs: 0,
					cacheScope: "public",
					_meta: {
						"io.modelcontextprotocol/serverInfo": input.serverInfo,
					},
				},
			});
		},
	});
}

function sse(
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
					controller.enqueue(
						new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`),
					);
					controller.close();
				})
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

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.entries(value)
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
			.join(",")}}`;
	const result = JSON.stringify(value);
	if (result === undefined) throw new TypeError("noncanonical MCP outcome");
	return result;
}

function json(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}
