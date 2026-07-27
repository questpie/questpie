import { describe, expect, it } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { collection } from "questpie";
import { z } from "zod";

import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder.js";
import {
	createMcpServer,
	createWorkloadMcpServer,
	mcpTool,
} from "../src/exports/index.js";

async function connect(server: McpServer) {
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({
		name: "execution-transport-test",
		version: "1.0.0",
	});
	await server.connect(serverTransport);
	await client.connect(clientTransport);
	return {
		client,
		close: async () => {
			await client.close();
			await server.close();
		},
	};
}

function errorCode(result: { _meta?: Record<string, unknown> }) {
	return (result["_meta"]?.["questpie/error"] as { code?: string } | undefined)
		?.code;
}

describe("MCP execution budgets across transports", () => {
	it("rejects over-limit released tool and resource catalogs before registration", async () => {
		const emptyTool = (name: string) =>
			mcpTool(name, { access: true, scopes: false }).handler(async () => ({
				content: [],
			}));
		const first = collection("first")
			.fields(({ f }) => ({ title: f.text() }))
			.access({ read: true });
		const second = collection("second")
			.fields(({ f }) => ({ title: f.text() }))
			.access({ read: true });
		const setup = await buildMockApp({
			collections: { first, second },
			mcpTools: {
				first: emptyTool("custom.first"),
				second: emptyTool("custom.second"),
			},
		});

		try {
			await expect(
				createMcpServer(setup.app, {
					config: { execution: { maxTools: 1 } },
				}),
			).rejects.toThrow("tool count");
			await expect(
				createMcpServer(setup.app, {
					config: {
						crud: {
							collections: {
								first: { operations: { list: true } },
								second: { operations: { list: true } },
							},
						},
						resources: {
							collections: { first: true, second: true },
						},
						execution: { maxResources: 1 },
					},
				}),
			).rejects.toThrow("resource count");
		} finally {
			await setup.cleanup();
		}
	});

	it("uses the same decoded-input and output boundary for HTTP, stdio, and workload", async () => {
		let handlerCalls = 0;
		const setup = await buildMockApp({
			mcpTools: {
				bounded: mcpTool("custom.bounded", {
					access: true,
					scopes: false,
					inputSchema: z.object({ value: z.string() }),
					workload: { capabilities: ["custom.read"] },
				}).handler(async ({ input }) => {
					handlerCalls += 1;
					return {
						content: [{ type: "text", text: input.value.repeat(200) }],
					};
				}),
			},
		});
		const execution = { maxInputBytes: 64, maxOutputBytes: 128 };
		const servers = [
			await createMcpServer(setup.app, {
				transport: "http",
				config: { execution },
			}),
			await createMcpServer(setup.app, {
				transport: "stdio",
				config: {
					execution,
					stdio: { trustedMaintenance: true },
				},
			}),
			await createWorkloadMcpServer(setup.app, {
				envelope: "opaque",
				authorizer: {
					authorize: async () => ({ context: "opaque" }),
				},
				contextBinder: {
					bind: async () => setup.app.createContext({ accessMode: "user" }),
				},
				config: { execution },
			}),
		];

		try {
			for (const server of servers) {
				const { client, close } = await connect(server);
				try {
					expect(
						errorCode(
							await client.callTool({
								name: "custom.bounded",
								arguments: { value: "x".repeat(100) },
							}),
						),
					).toBe("input_too_large");
					expect(
						errorCode(
							await client.callTool({
								name: "custom.bounded",
								arguments: { value: "x" },
							}),
						),
					).toBe("output_too_large");
				} finally {
					await close();
				}
			}
			expect(handlerCalls).toBe(3);
		} finally {
			await setup.cleanup();
		}
	});
});
