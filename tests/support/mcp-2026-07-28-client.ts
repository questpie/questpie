export const MCP_PROTOCOL_VERSION = "2026-07-28" as const;

export type McpOperationFrame = Readonly<{
	callId: string;
	error?: Readonly<{
		code: string;
		payload?: unknown;
		retryable?: boolean;
	}>;
	result?: unknown;
}>;

export type CurrentProtocolMcpCall = Readonly<{
	arguments: Readonly<Record<string, unknown>>;
	headers?: HeadersInit;
	name: string;
	signal?: AbortSignal;
}>;

export function currentProtocolMcpRequest(
	origin: string,
	input: CurrentProtocolMcpCall,
): Readonly<{ id: string; request: Request }> {
	const id = `mcp:${crypto.randomUUID()}`;
	const headers = new Headers(input.headers);
	headers.set("accept", "application/json, text/event-stream");
	headers.set("content-type", "application/json");
	headers.set("mcp-method", "tools/call");
	headers.set("mcp-name", input.name);
	headers.set("mcp-protocol-version", MCP_PROTOCOL_VERSION);
	headers.set("origin", origin);
	return {
		id,
		request: new Request(`${origin}/_questpie/mcp`, {
			method: "POST",
			...(input.signal === undefined ? {} : { signal: input.signal }),
			headers,
			body: JSON.stringify({
				jsonrpc: "2.0",
				id,
				method: "tools/call",
				params: {
					name: input.name,
					arguments: input.arguments,
					_meta: {
						"io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
						"io.modelcontextprotocol/clientCapabilities": {},
					},
				},
			}),
		}),
	};
}

export async function callCurrentProtocolMcp(
	fetch: (request: Request) => Promise<Response>,
	origin: string,
	input: CurrentProtocolMcpCall,
): Promise<McpOperationFrame> {
	const { id, request } = currentProtocolMcpRequest(origin, input);
	const response = await fetch(request);
	if (
		response.status !== 200 ||
		response.headers.get("content-type") !== "text/event-stream"
	)
		throw new TypeError("MCP call did not return a successful SSE response");
	const event = await response.text();
	if (!event.startsWith("data: ") || !event.endsWith("\n\n"))
		throw new TypeError("MCP call returned an invalid SSE event");
	const envelope = JSON.parse(event.slice(6, -2)) as Readonly<{
		id: unknown;
		result?: Readonly<{ structuredContent?: unknown }>;
	}>;
	if (envelope.id !== id || !envelope.result?.structuredContent)
		throw new TypeError(
			"MCP call did not return correlated structured content",
		);
	return envelope.result.structuredContent as McpOperationFrame;
}
