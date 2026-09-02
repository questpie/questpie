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
