import { expect, test } from "bun:test";

import { createMcpIngress } from "../../packages/runtime/src/application/mcp";

const requestMeta = {
	"io.modelcontextprotocol/protocolVersion": "2026-07-28",
	"io.modelcontextprotocol/clientCapabilities": {},
};

function request(
	method: string,
	params: Readonly<Record<string, unknown>>,
	name?: string,
) {
	return new Request("https://support.example/_questpie/mcp", {
		method: "POST",
		headers: {
			accept: "application/json, text/event-stream",
			"content-type": "application/json",
			"mcp-protocol-version": "2026-07-28",
			"mcp-method": method,
			...(name === undefined ? {} : { "mcp-name": name }),
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: "discover-1",
			method,
			params,
		}),
	});
}

test("MCP rejects malformed and escaped duplicate JSON as parse errors", async () => {
	const ingress = createMcpIngress({
		serverInfo: { name: "support", version: "4.0.0-beta.2" },
		maximumRequestBytes: 4096,
		tools: [],
		execute: async () => {
			throw new Error("malformed JSON must not execute");
		},
	});
	for (const body of [
		'{"jsonrpc":"2.0","params":{"value":1,"v\\u0061lue":2}}',
		'{"jsonrpc":"2.0","params":{"items":[{"key":1,"key":2}]}}',
		'{"jsonrpc":"2.0","params":{"value":}}',
		'{"jsonrpc":"2.0","params":[1,]}',
		'{"jsonrpc":"2.0","params":{}} false',
	]) {
		const template = request("tools/list", { _meta: requestMeta });
		const response = await ingress.fetch(
			new Request(template.url, {
				method: "POST",
				headers: template.headers,
				body,
			}),
		);
		expect(response?.status).toBe(400);
		expect(await response?.json()).toEqual({
			jsonrpc: "2.0",
			error: { code: -32700, message: "Parse error" },
		});
	}
});

test("discovers only one stateless MCP 2026-07-28 Tools capability", async () => {
	const ingress = createMcpIngress({
		serverInfo: { name: "support", version: "4.0.0-beta.2" },
		maximumRequestBytes: 1_048_576,
		tools: [],
		execute: async () => {
			throw new Error("discovery must not execute an Operation");
		},
	});
	const response = await ingress.fetch(
		request("server/discover", { _meta: requestMeta }),
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
					name: "support",
					version: "4.0.0-beta.2",
				},
			},
		},
	});
});

test("lists the compiled public catalogue without executing or evaluating Policy", async () => {
	const binding = {
		identity: "query:tickets.list",
		kind: "query" as const,
		tool: {
			name: "query.tickets.list",
			inputSchema: { type: "object" },
			outputSchema: { type: "object" },
			annotations: { readOnlyHint: true as const },
		},
	};
	const ingress = createMcpIngress({
		serverInfo: { name: "support", version: "4.0.0-beta.2" },
		maximumRequestBytes: 1_048_576,
		tools: [binding],
		execute: async () => {
			throw new Error("listing must not execute an Operation");
		},
	});
	const response = await ingress.fetch(
		request("tools/list", { _meta: requestMeta }),
	);

	expect(response?.status).toBe(200);
	expect(await response?.json()).toMatchObject({
		jsonrpc: "2.0",
		id: "discover-1",
		result: {
			resultType: "complete",
			tools: [binding.tool],
			ttlMs: 0,
			cacheScope: "public",
		},
	});
});

test("calls one tool once and returns one complete canonical SSE result", async () => {
	let executions = 0;
	const ingress = createMcpIngress({
		serverInfo: { name: "support", version: "4.0.0-beta.2" },
		maximumRequestBytes: 1_048_576,
		tools: [
			{
				identity: "query:tickets.list",
				kind: "query",
				tool: { name: "query.tickets.list" },
			},
		],
		execute: async ({ arguments: args, identity, kind, signal }) => {
			executions += 1;
			expect({ args, identity, kind, aborted: signal.aborted }).toEqual({
				args: { context: { organizationId: "org-1" }, input: { first: 20 } },
				identity: "query:tickets.list",
				kind: "query",
				aborted: false,
			});
			return {
				structuredContent: {
					callId: "query-call-1",
					result: [{ id: "ticket-1" }],
				},
				isError: false,
			};
		},
	});
	const response = await ingress.fetch(
		request(
			"tools/call",
			{
				_meta: requestMeta,
				name: "query.tickets.list",
				arguments: {
					context: { organizationId: "org-1" },
					input: { first: 20 },
				},
			},
			"query.tickets.list",
		),
	);

	expect(response?.status).toBe(200);
	expect(response?.headers.get("content-type")).toBe("text/event-stream");
	const event = await response!.text();
	expect(JSON.parse(event.slice(6, -2))).toMatchObject({
		jsonrpc: "2.0",
		id: "discover-1",
		result: {
			resultType: "complete",
			content: [
				{
					type: "text",
					text: '{"callId":"query-call-1","result":[{"id":"ticket-1"}]}',
				},
			],
			structuredContent: {
				callId: "query-call-1",
				result: [{ id: "ticket-1" }],
			},
		},
	});
	expect(executions).toBe(1);
});

test("rejects Origin and metadata ambiguity before execution", async () => {
	let executions = 0;
	const ingress = createMcpIngress({
		serverInfo: { name: "support", version: "4.0.0-beta.2" },
		maximumRequestBytes: 1_048_576,
		tools: [
			{
				identity: "query:tickets.list",
				kind: "query",
				tool: { name: "query.tickets.list" },
			},
		],
		execute: async () => {
			executions += 1;
			throw new Error("rejected requests must not execute");
		},
	});
	const crossOrigin = request("tools/list", { _meta: requestMeta });
	crossOrigin.headers.set("origin", "https://attacker.example");
	expect((await ingress.fetch(crossOrigin))?.status).toBe(403);

	const mismatch = await ingress.fetch(
		request(
			"tools/call",
			{
				_meta: requestMeta,
				name: "query.tickets.list",
				arguments: { context: {}, input: {} },
			},
			"query.other",
		),
	);
	expect(mismatch?.status).toBe(400);
	expect(await mismatch?.json()).toEqual({
		jsonrpc: "2.0",
		id: "discover-1",
		error: { code: -32020, message: "Request metadata mismatch" },
	});
	expect(executions).toBe(0);
});

test("closes malformed envelopes and unsupported methods without disclosure", async () => {
	const ingress = createMcpIngress({
		serverInfo: { name: "support", version: "4.0.0-beta.2" },
		maximumRequestBytes: 1_048_576,
		tools: [],
		execute: async () => {
			throw new Error("invalid requests must not execute");
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

	const unsupported = await ingress.fetch(
		request("resources/list", { _meta: requestMeta }),
	);
	expect(await unsupported?.json()).toEqual({
		jsonrpc: "2.0",
		id: "discover-1",
		error: { code: -32601, message: "Method not found" },
	});
});

test("cancels the one Execution when the response stream closes and never retries", async () => {
	let executions = 0;
	let resolveAbort!: () => void;
	const aborted = new Promise<void>((resolve) => {
		resolveAbort = resolve;
	});
	const ingress = createMcpIngress({
		serverInfo: { name: "support", version: "4.0.0-beta.2" },
		maximumRequestBytes: 1_048_576,
		tools: [
			{
				identity: "query:tickets.list",
				kind: "query",
				tool: { name: "query.tickets.list" },
			},
		],
		execute: async ({ signal }) => {
			executions += 1;
			await new Promise<void>((resolve) => {
				const onAbort = () => {
					resolveAbort();
					resolve();
				};
				if (signal.aborted) return onAbort();
				signal.addEventListener("abort", onAbort, { once: true });
			});
			return { structuredContent: null, isError: true };
		},
	});
	const response = await ingress.fetch(
		request(
			"tools/call",
			{
				_meta: requestMeta,
				name: "query.tickets.list",
				arguments: { context: {}, input: {} },
			},
			"query.tickets.list",
		),
	);
	const reader = response!.body!.getReader();
	await reader.cancel();
	await aborted;
	expect(executions).toBe(1);
});
