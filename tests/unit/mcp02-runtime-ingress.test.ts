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

test("tools/call always authenticates before execution and returns a real 401 with the app challenge", async () => {
	let executions = 0;
	let authenticateCalls = 0;
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
		authenticate: async () => {
			authenticateCalls += 1;
			return {
				kind: "unauthenticated",
				wwwAuthenticate:
					'Bearer resource_metadata="https://support.example/.well-known/oauth-protected-resource"',
			};
		},
		execute: async () => {
			executions += 1;
			throw new Error("unauthenticated calls must not execute");
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
	expect(response?.status).toBe(401);
	expect(response?.headers.get("content-type")).toBe(
		"application/json; charset=utf-8",
	);
	expect(response?.headers.get("www-authenticate")).toBe(
		'Bearer resource_metadata="https://support.example/.well-known/oauth-protected-resource"',
	);
	expect(await response?.json()).toEqual({
		jsonrpc: "2.0",
		id: "discover-1",
		error: { code: -32001, message: "Unauthorized" },
	});
	expect(authenticateCalls).toBe(1);
	expect(executions).toBe(0);
});

test("tools/call 401 omits www-authenticate when the app declares no challenge", async () => {
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
		authenticate: async () => ({ kind: "unauthenticated" }),
		execute: async () => {
			throw new Error("unauthenticated calls must not execute");
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
	expect(response?.status).toBe(401);
	expect(response?.headers.has("www-authenticate")).toBe(false);
});

test("a deferred authentication outcome falls through to today's execute-owned path unchanged", async () => {
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
		authenticate: async () => ({ kind: "deferred" }),
		execute: async () => {
			executions += 1;
			return {
				structuredContent: { callId: "call-1", result: [] },
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
				arguments: { context: {}, input: {} },
			},
			"query.tickets.list",
		),
	);
	expect(response?.status).toBe(200);
	expect(response?.headers.get("content-type")).toBe("text/event-stream");
	expect(executions).toBe(1);
});

test("tools/list and server/discover stay public without protectCatalog even when authenticate is wired", async () => {
	const binding = {
		identity: "query:tickets.list",
		kind: "query" as const,
		tool: { name: "query.tickets.list" },
	};
	let authenticateCalls = 0;
	const ingress = createMcpIngress({
		serverInfo: { name: "support", version: "4.0.0-beta.2" },
		maximumRequestBytes: 1_048_576,
		tools: [binding],
		authenticate: async () => {
			authenticateCalls += 1;
			return { kind: "unauthenticated" };
		},
		execute: async () => {
			throw new Error("listing must not execute an Operation");
		},
	});
	const list = await ingress.fetch(
		request("tools/list", { _meta: requestMeta }),
	);
	expect(list?.status).toBe(200);
	const discover = await ingress.fetch(
		request("server/discover", { _meta: requestMeta }),
	);
	expect(discover?.status).toBe(200);
	expect(authenticateCalls).toBe(0);
});

test("protectCatalog gates tools/list and server/discover behind the same 401 challenge, still without evaluating Policy", async () => {
	const binding = {
		identity: "query:tickets.list",
		kind: "query" as const,
		tool: { name: "query.tickets.list" },
	};
	const ingress = createMcpIngress({
		serverInfo: { name: "support", version: "4.0.0-beta.2" },
		maximumRequestBytes: 1_048_576,
		tools: [binding],
		protectCatalog: true,
		authenticate: async () => ({
			kind: "unauthenticated",
			wwwAuthenticate: "Bearer",
		}),
		execute: async () => {
			throw new Error("must not execute");
		},
	});
	const list = await ingress.fetch(
		request("tools/list", { _meta: requestMeta }),
	);
	expect(list?.status).toBe(401);
	expect(list?.headers.get("www-authenticate")).toBe("Bearer");
	const discover = await ingress.fetch(
		request("server/discover", { _meta: requestMeta }),
	);
	expect(discover?.status).toBe(401);
	expect(discover?.headers.get("www-authenticate")).toBe("Bearer");
});

test("protectCatalog serves the catalogue once authenticated, unchanged from the public shape", async () => {
	const binding = {
		identity: "query:tickets.list",
		kind: "query" as const,
		tool: { name: "query.tickets.list" },
	};
	const ingress = createMcpIngress({
		serverInfo: { name: "support", version: "4.0.0-beta.2" },
		maximumRequestBytes: 1_048_576,
		tools: [binding],
		protectCatalog: true,
		authenticate: async () => ({ kind: "authenticated" }),
		execute: async () => {
			throw new Error("listing must not execute an Operation");
		},
	});
	const response = await ingress.fetch(
		request("tools/list", { _meta: requestMeta }),
	);
	expect(response?.status).toBe(200);
	expect(await response?.json()).toMatchObject({
		result: { tools: [binding.tool] },
	});
});

test("protocol-version mismatch is rejected before authentication runs, so it never discloses catalogue membership", async () => {
	let authenticateCalls = 0;
	const ingress = createMcpIngress({
		serverInfo: { name: "support", version: "4.0.0-beta.2" },
		maximumRequestBytes: 1_048_576,
		tools: [],
		protectCatalog: true,
		authenticate: async () => {
			authenticateCalls += 1;
			return { kind: "unauthenticated" };
		},
		execute: async () => {
			throw new Error("must not execute");
		},
	});
	const stale = new Request("https://support.example/_questpie/mcp", {
		method: "POST",
		headers: {
			accept: "application/json, text/event-stream",
			"content-type": "application/json",
			"mcp-protocol-version": "2020-01-01",
			"mcp-method": "tools/list",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: "stale-1",
			method: "tools/list",
			params: { _meta: requestMeta },
		}),
	});
	const response = await ingress.fetch(stale);
	expect(response?.status).toBe(400);
	expect(await response?.json()).toMatchObject({
		error: { code: -32022 },
	});
	expect(authenticateCalls).toBe(0);
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
