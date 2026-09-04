import { expect, test } from "bun:test";

import { createMcpIngress } from "./protocol";

test("discovers only the exact stateless 2026-07-28 tools capability", async () => {
	const ingress = createMcpIngress({
		serverInfo: { name: "questpie", version: "4.0.0-beta.2" },
		tools: [],
		execute: async () => {
			throw new Error("discovery must not execute an Operation");
		},
	});
	const response = await ingress.fetch(
		new Request("https://support.example/_questpie/mcp", {
			method: "POST",
			headers: {
				accept: "application/json, text/event-stream",
				"content-type": "application/json",
				"mcp-protocol-version": "2026-07-28",
				"mcp-method": "server/discover",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: "discover-1",
				method: "server/discover",
				params: {
					_meta: {
						"io.modelcontextprotocol/protocolVersion": "2026-07-28",
						"io.modelcontextprotocol/clientCapabilities": {},
					},
				},
			}),
		}),
	);

	expect(response?.status).toBe(200);
	expect(await response?.json()).toEqual({
		jsonrpc: "2.0",
		id: "discover-1",
		result: {
			resultType: "complete",
			supportedVersions: ["2026-07-28"],
			capabilities: { tools: {} },
			ttlMs: 0,
			cacheScope: "public",
			_meta: {
				"io.modelcontextprotocol/serverInfo": {
					name: "questpie",
					version: "4.0.0-beta.2",
				},
			},
		},
	});
});

test("lists one public deterministic catalogue with the required cache fields", async () => {
	const tool = Object.freeze({
		identity: "query:tickets.list",
		kind: "query" as const,
		tool: Object.freeze({
			name: "query.tickets.list",
			title: "List tickets",
			description: "List tickets visible to the caller.",
			inputSchema: Object.freeze({
				type: "object",
				additionalProperties: false,
				properties: Object.freeze({}),
			}),
			outputSchema: Object.freeze({ type: "object" }),
			annotations: Object.freeze({ readOnlyHint: true as const }),
		}),
	});
	const ingress = createMcpIngress({
		serverInfo: { name: "questpie", version: "4.0.0-beta.2" },
		tools: [tool],
		execute: async () => {
			throw new Error("listing must not execute or evaluate Policy");
		},
	});
	const response = await ingress.fetch(
		modernRequest("tools/list", {
			id: "list-1",
			params: { _meta: requestMeta() },
		}),
	);

	expect(response?.status).toBe(200);
	expect(await response?.json()).toEqual({
		jsonrpc: "2.0",
		id: "list-1",
		result: {
			resultType: "complete",
			tools: [tool.tool],
			ttlMs: 0,
			cacheScope: "public",
			_meta: {
				"io.modelcontextprotocol/serverInfo": {
					name: "questpie",
					version: "4.0.0-beta.2",
				},
			},
		},
	});
});

test("calls a Query through the canonical executor and returns one complete SSE result", async () => {
	const tool = queryTool();
	const calls: unknown[] = [];
	const ingress = createMcpIngress({
		serverInfo: { name: "questpie", version: "4.0.0-beta.2" },
		tools: [tool],
		execute: async (value) => {
			calls.push(value);
			return {
				structuredContent: {
					callId: "query-call",
					result: [{ id: "ticket-1" }],
				},
				isError: false,
			};
		},
	});
	const response = await ingress.fetch(
		modernRequest("tools/call", {
			id: "call-1",
			name: "query.tickets.list",
			params: {
				_meta: requestMeta(),
				name: "query.tickets.list",
				arguments: {
					input: { first: 10 },
					context: { workspaceId: "workspace-1" },
				},
			},
		}),
	);

	expect(response?.status).toBe(200);
	expect(response?.headers.get("content-type")).toBe("text/event-stream");
	expect(response?.headers.get("x-accel-buffering")).toBe("no");
	const event = await response?.text();
	expect(event?.startsWith("data: ")).toBeTrue();
	expect(JSON.parse(event!.slice(6, -2))).toEqual({
		jsonrpc: "2.0",
		id: "call-1",
		result: {
			resultType: "complete",
			content: [
				{
					type: "text",
					text: '{"callId":"query-call","result":[{"id":"ticket-1"}]}',
				},
			],
			structuredContent: {
				callId: "query-call",
				result: [{ id: "ticket-1" }],
			},
			_meta: {
				"io.modelcontextprotocol/serverInfo": {
					name: "questpie",
					version: "4.0.0-beta.2",
				},
			},
		},
	});
	expect(calls).toEqual([
		{
			identity: "query:tickets.list",
			kind: "query",
			arguments: {
				input: { first: 10 },
				context: { workspaceId: "workspace-1" },
			},
			signal: expect.any(AbortSignal),
		},
	]);
});

test("rejects cross-origin and header/body ambiguity before execution", async () => {
	let executions = 0;
	const ingress = createMcpIngress({
		serverInfo: { name: "questpie", version: "4.0.0-beta.2" },
		tools: [queryTool()],
		execute: async () => {
			executions += 1;
			throw new Error("must not execute");
		},
	});
	const crossOrigin = modernRequest("tools/list", {
		id: "origin-1",
		params: { _meta: requestMeta() },
	});
	crossOrigin.headers.set("origin", "https://attacker.example");
	expect((await ingress.fetch(crossOrigin))?.status).toBe(403);
	const mismatch = modernRequest("tools/call", {
		id: "mismatch-1",
		name: "query.other",
		params: {
			_meta: requestMeta(),
			name: "query.tickets.list",
			arguments: { input: {}, context: {} },
		},
	});
	const response = await ingress.fetch(mismatch);
	expect(response?.status).toBe(400);
	expect(await response?.json()).toEqual({
		jsonrpc: "2.0",
		id: "mismatch-1",
		error: { code: -32020, message: "Request metadata mismatch" },
	});
	expect(executions).toBe(0);
});

test("closes malformed JSON values and unknown methods as JSON-RPC errors", async () => {
	const ingress = createMcpIngress({
		serverInfo: { name: "questpie", version: "4.0.0-beta.2" },
		tools: [],
		execute: async () => {
			throw new Error("invalid protocol requests must not execute");
		},
	});
	const malformed = await ingress.fetch(
		new Request("https://support.example/_questpie/mcp", {
			method: "POST",
			headers: {
				accept: "application/json, text/event-stream",
				"content-type": "application/json",
				"mcp-protocol-version": "2026-07-28",
				"mcp-method": "tools/list",
			},
			body: "null",
		}),
	);
	expect(malformed?.status).toBe(400);
	expect(await malformed?.json()).toEqual({
		jsonrpc: "2.0",
		error: { code: -32600, message: "Invalid request" },
	});

	const unknown = await ingress.fetch(
		modernRequest("resources/list", {
			id: "unknown-1",
			params: { _meta: requestMeta() },
		}),
	);
	expect(unknown?.status).toBe(200);
	expect(await unknown?.json()).toEqual({
		jsonrpc: "2.0",
		id: "unknown-1",
		error: { code: -32601, message: "Method not found" },
	});
});

test("cancels one in-flight execution when the response stream closes and never retries", async () => {
	let executions = 0;
	let observedAbort!: () => void;
	const aborted = new Promise<void>((resolve) => (observedAbort = resolve));
	const ingress = createMcpIngress({
		serverInfo: { name: "questpie", version: "4.0.0-beta.2" },
		tools: [queryTool()],
		execute: async ({ signal }) => {
			executions += 1;
			await new Promise<void>((resolve) =>
				signal.addEventListener("abort", () => {
					observedAbort();
					resolve();
				}),
			);
			return { structuredContent: null, isError: true };
		},
	});
	const response = await ingress.fetch(
		modernRequest("tools/call", {
			id: "cancel-1",
			name: "query.tickets.list",
			params: {
				_meta: requestMeta(),
				name: "query.tickets.list",
				arguments: { input: {}, context: {} },
			},
		}),
	);
	const reader = response!.body!.getReader();
	await reader.cancel();
	await aborted;
	expect(executions).toBe(1);
});

test("refuses MRTR and sanitizes an executor fault without retry", async () => {
	let executions = 0;
	const ingress = createMcpIngress({
		serverInfo: { name: "questpie", version: "4.0.0-beta.2" },
		tools: [queryTool()],
		execute: async () => {
			executions += 1;
			throw new Error("postgres credential and stack");
		},
	});
	const mrtr = await ingress.fetch(
		modernRequest("tools/call", {
			id: "mrtr-1",
			name: "query.tickets.list",
			params: {
				_meta: requestMeta(),
				name: "query.tickets.list",
				arguments: { input: {}, context: {} },
				requestState: { opaque: true },
			},
		}),
	);
	expect(await mrtr?.json()).toEqual({
		jsonrpc: "2.0",
		id: "mrtr-1",
		error: { code: -32602, message: "Invalid params" },
	});
	const fault = await ingress.fetch(
		modernRequest("tools/call", {
			id: "fault-1",
			name: "query.tickets.list",
			params: {
				_meta: requestMeta(),
				name: "query.tickets.list",
				arguments: { input: {}, context: {} },
			},
		}),
	);
	const event = await fault!.text();
	expect(JSON.parse(event.slice(6, -2))).toEqual({
		jsonrpc: "2.0",
		id: "fault-1",
		error: { code: -32603, message: "Internal error" },
	});
	expect(event).not.toContain("postgres");
	expect(executions).toBe(1);
});

function requestMeta() {
	return {
		"io.modelcontextprotocol/protocolVersion": "2026-07-28",
		"io.modelcontextprotocol/clientCapabilities": {},
	};
}

function modernRequest(
	method: string,
	input: Readonly<{
		id: string | number;
		name?: string;
		params: Readonly<Record<string, unknown>>;
	}>,
): Request {
	return new Request("https://support.example/_questpie/mcp", {
		method: "POST",
		headers: {
			accept: "application/json, text/event-stream",
			"content-type": "application/json",
			"mcp-protocol-version": "2026-07-28",
			"mcp-method": method,
			...(input.name === undefined ? {} : { "mcp-name": input.name }),
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: input.id,
			method,
			params: input.params,
		}),
	});
}

function queryTool() {
	return Object.freeze({
		identity: "query:tickets.list",
		kind: "query" as const,
		tool: Object.freeze({
			name: "query.tickets.list",
			inputSchema: Object.freeze({ type: "object" }),
			outputSchema: Object.freeze({ type: "object" }),
			annotations: Object.freeze({ readOnlyHint: true as const }),
		}),
	});
}
