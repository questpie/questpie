import { describe, expect, it } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { collection, route } from "questpie";
import { z } from "zod";

import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder.js";
import {
	createWorkloadMcpServer,
	mcpTool,
	type WorkloadMcpServerOptions,
} from "../src/exports/index.js";

async function connect(server: McpServer) {
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({
		name: "workload-authorization-test",
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

function contextBinder(app: any, additions: Record<string, unknown> = {}) {
	return {
		bind: async () => ({
			...(await app.createContext({ accessMode: "user" })),
			...additions,
		}),
	};
}

describe("MCP workload authorization", () => {
	it("reauthorizes discovery and every call with only opaque consumer context and named capability facts", async () => {
		let allowed = true;
		let handlerCalls = 0;
		const requests: unknown[] = [];
		const setup = await buildMockApp({
			mcpTools: {
				readTask: mcpTool("tasks.get", {
					inputSchema: z.object({ taskId: z.string() }),
					annotations: { readOnlyHint: true },
					workload: { capabilities: ["tasks.read"] },
				}).handler(async ({ input }) => {
					handlerCalls += 1;
					return {
						content: [{ type: "text", text: input.taskId }],
						structuredContent: { taskId: input.taskId },
					};
				}),
			},
		});
		const envelope = { opaque: "consumer-owned" };
		const server = await createWorkloadMcpServer(setup.app, {
			envelope,
			authorizer: {
				authorize: async (request) => {
					requests.push(request);
					return allowed ? { context: { opaque: "authorized" } } : null;
				},
			},
			contextBinder: contextBinder(setup.app),
		});
		const { client, close } = await connect(server);

		try {
			expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
				["tasks.get"],
			);
			expect(
				(
					await client.callTool({
						name: "tasks.get",
						arguments: { taskId: "task-1" },
					})
				).structuredContent,
			).toEqual({ taskId: "task-1" });

			allowed = false;
			expect((await client.listTools()).tools).toEqual([]);
			expect(
				await client.callTool({
					name: "tasks.get",
					arguments: { taskId: "task-2" },
				}),
			).toEqual({
				isError: true,
				content: [{ type: "text", text: "MCP access denied" }],
			});
			expect(handlerCalls).toBe(1);
			expect(requests).toEqual([
				{
					phase: "discovery",
					envelope,
					tool: {
						kind: "custom",
						name: "tasks.get",
						operation: "execute",
						intent: "read",
						transport: "workload",
						capabilities: ["tasks.read"],
					},
				},
				{
					phase: "call",
					envelope,
					tool: {
						kind: "custom",
						name: "tasks.get",
						operation: "execute",
						intent: "read",
						transport: "workload",
						capabilities: ["tasks.read"],
					},
				},
				{
					phase: "discovery",
					envelope,
					tool: {
						kind: "custom",
						name: "tasks.get",
						operation: "execute",
						intent: "read",
						transport: "workload",
						capabilities: ["tasks.read"],
					},
				},
				{
					phase: "call",
					envelope,
					tool: {
						kind: "custom",
						name: "tasks.get",
						operation: "execute",
						intent: "read",
						transport: "workload",
						capabilities: ["tasks.read"],
					},
				},
			]);
		} finally {
			await close();
			await setup.cleanup();
		}
	}, 15_000);

	it("fails closed for an absent, throwing, or malformed authorizer and never invokes the tool", async () => {
		let handlerCalls = 0;
		const setup = await buildMockApp({
			mcpTools: {
				protected: mcpTool("protected.read", {
					workload: { capabilities: ["protected.read"] },
				}).handler(async () => {
					handlerCalls += 1;
					return { content: [{ type: "text", text: "secret" }] };
				}),
				undeclared: mcpTool("ambient.system", {}).handler(async () => {
					handlerCalls += 1;
					return { content: [{ type: "text", text: "ambient" }] };
				}),
			},
		});

		try {
			await expect(
				createWorkloadMcpServer(setup.app, undefined as never),
			).rejects.toThrow("MCP access denied");
			await expect(
				createWorkloadMcpServer(setup.app, {
					envelope: {},
					authorizer: {} as never,
				}),
			).rejects.toThrow("MCP access denied");
			await expect(
				createWorkloadMcpServer(setup.app, {
					envelope: {},
					authorizer: {
						authorize: async () => ({ context: "opaque" }),
					},
				} as never),
			).rejects.toThrow("MCP access denied");

			for (const authorize of [
				async () => {
					throw new Error("consumer secret");
				},
				async () => ({ allowed: true }) as never,
			]) {
				const server = await createWorkloadMcpServer(setup.app, {
					envelope: { opaque: true },
					authorizer: { authorize },
					contextBinder: contextBinder(setup.app),
				});
				const { client, close } = await connect(server);
				try {
					expect((await client.listTools()).tools).toEqual([]);
					expect(
						await client.callTool({
							name: "protected.read",
							arguments: {},
						}),
					).toEqual({
						isError: true,
						content: [{ type: "text", text: "MCP access denied" }],
					});
				} finally {
					await close();
				}
			}
			expect(handlerCalls).toBe(0);
			const undeclared = await createWorkloadMcpServer(setup.app, {
				envelope: "opaque",
				authorizer: {
					authorize: async () => ({ context: "opaque" }),
				},
				contextBinder: contextBinder(setup.app),
			});
			const undeclaredConnection = await connect(undeclared);
			try {
				expect(
					(
						await undeclaredConnection.client.callTool({
							name: "ambient.system",
							arguments: {},
						})
					).isError,
				).toBe(true);
				expect(handlerCalls).toBe(0);
			} finally {
				await undeclaredConnection.close();
			}
		} finally {
			await setup.cleanup();
		}
	}, 15_000);

	it("requires the authorizer to approve the explicit handoff capability", async () => {
		let handlerCalls = 0;
		let handoffCalls = 0;
		const requests: unknown[] = [];
		const setup = await buildMockApp({
			mcpTools: {
				update: mcpTool("tasks.update", {
					workload: {
						capabilities: ["tasks.write"],
						handoff: "tasks.commit",
					},
				}).handler(async () => {
					handlerCalls += 1;
					return { content: [{ type: "text", text: "unexpected" }] };
				}),
			},
		});
		const server = await createWorkloadMcpServer(setup.app, {
			envelope: "opaque",
			authorizer: {
				authorize: async (request) => {
					requests.push(request);
					return request.tool.handoff === "tasks.commit"
						? null
						: { context: "opaque" };
				},
			},
			contextBinder: contextBinder(setup.app),
			handoff: {
				execute: async ({ invoke }) => {
					handoffCalls += 1;
					return invoke();
				},
			},
		});
		const { client, close } = await connect(server);

		try {
			expect((await client.listTools()).tools).toEqual([]);
			expect(
				await client.callTool({ name: "tasks.update", arguments: {} }),
			).toEqual({
				isError: true,
				content: [{ type: "text", text: "MCP access denied" }],
			});
			expect(requests).toEqual([
				{
					phase: "discovery",
					envelope: "opaque",
					tool: {
						kind: "custom",
						name: "tasks.update",
						operation: "execute",
						intent: "effect",
						transport: "workload",
						capabilities: ["tasks.write"],
						handoff: "tasks.commit",
					},
				},
				{
					phase: "call",
					envelope: "opaque",
					tool: {
						kind: "custom",
						name: "tasks.update",
						operation: "execute",
						intent: "effect",
						transport: "workload",
						capabilities: ["tasks.write"],
						handoff: "tasks.commit",
					},
				},
			]);
			expect(handlerCalls).toBe(0);
			expect(handoffCalls).toBe(0);
		} finally {
			await close();
			await setup.cleanup();
		}
	}, 15_000);

	it("uses only the consumer-bound context for access checks and handler execution", async () => {
		const seenBindings: unknown[] = [];
		const seenHandlers: unknown[] = [];
		const setup = await buildMockApp({
			mcpTools: {
				read: mcpTool("tenant.read", {
					access: ({ ctx, transport }) =>
						(ctx as any).tenantId === "tenant-a" && transport === "workload",
					annotations: { readOnlyHint: true },
					workload: { capabilities: ["tenant.read"] },
				}).handler(async ({ ctx, request, accessMode, transport }) => {
					seenHandlers.push({
						tenantId: (ctx as any).tenantId,
						principal: ctx.principal,
						actor: ctx.actor,
						request,
						accessMode,
						transport,
					});
					return {
						content: [{ type: "text", text: String((ctx as any).tenantId) }],
					};
				}),
			},
		});
		const boundContext = {
			...(await setup.app.createContext({ accessMode: "user" })),
			tenantId: "tenant-a",
			actor: { kind: "human", subjectId: "tenant-a" },
		};
		const options: WorkloadMcpServerOptions = {
			envelope: "opaque",
			authorizer: {
				authorize: async () => ({
					context: { tenantId: "tenant-a" },
					attribution: "audit-a",
				}),
			},
			contextBinder: {
				bind: async (input) => {
					seenBindings.push(input);
					return boundContext as never;
				},
			},
			// @ts-expect-error workload servers cannot inherit requester HTTP identity
			request: new Request("http://forged.invalid", {
				headers: { cookie: "session=forged" },
			}),
			ctx: { tenantId: "tenant-forged" },
			accessMode: "system",
		};
		const server = await createWorkloadMcpServer(setup.app, options);
		const { client, close } = await connect(server);

		try {
			expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
				["tenant.read"],
			);
			expect(
				(
					await client.callTool({
						name: "tenant.read",
						arguments: {},
					})
				).content,
			).toEqual([{ type: "text", text: "tenant-a" }]);
			expect(seenHandlers).toEqual([
				{
					tenantId: "tenant-a",
					principal: undefined,
					actor: { kind: "human", subjectId: "tenant-a" },
					request: undefined,
					accessMode: "user",
					transport: "workload",
				},
			]);
			expect(seenBindings).toHaveLength(2);
			expect(seenBindings).toEqual([
				expect.objectContaining({
					authorizationContext: { tenantId: "tenant-a" },
					attribution: "audit-a",
				}),
				expect.objectContaining({
					authorizationContext: { tenantId: "tenant-a" },
					attribution: "audit-a",
				}),
			]);
		} finally {
			await close();
			await setup.cleanup();
		}
	}, 15_000);

	it("uses user-safe entity defaults instead of trusted stdio write defaults", async () => {
		const tasks = collection("workloadSafeDefaults")
			.fields(({ f }) => ({ title: f.text(255).required() }))
			.access({ read: true, create: true });
		const setup = await buildMockApp({
			collections: { workloadSafeDefaults: tasks },
		});
		const server = await createWorkloadMcpServer(setup.app, {
			envelope: "opaque",
			authorizer: {
				authorize: async () => ({ context: "opaque" }),
			},
			contextBinder: contextBinder(setup.app),
			config: {
				crud: {
					collections: {
						workloadSafeDefaults: {
							operationWorkloads: {
								create: { capabilities: ["tasks.write"] },
							},
						},
					},
				},
			},
		});
		const { client, close } = await connect(server);

		try {
			expect((await client.listTools()).tools).toEqual([]);
			expect(
				await client.callTool({
					name: "collections.workloadSafeDefaults.create",
					arguments: { data: { title: "must-not-create" } },
				}),
			).toEqual({
				isError: true,
				content: [{ type: "text", text: "MCP access denied" }],
			});
		} finally {
			await close();
			await setup.cleanup();
		}
	}, 15_000);

	it("rejects proxy and accessor authorization results without leaking or invoking", async () => {
		let handlerCalls = 0;
		let binderCalls = 0;
		const setup = await buildMockApp({
			mcpTools: {
				read: mcpTool("protected.proxy", {
					workload: { capabilities: ["protected.read"] },
				}).handler(async () => {
					handlerCalls += 1;
					return { content: [{ type: "text", text: "unexpected" }] };
				}),
			},
		});

		try {
			for (const authorization of [
				new Proxy(
					{ context: "opaque" },
					{
						getOwnPropertyDescriptor: () => {
							throw new Error("proxy://consumer-secret");
						},
					},
				),
				Object.defineProperty({}, "context", {
					get() {
						throw new Error("getter://consumer-secret");
					},
				}),
			]) {
				const server = await createWorkloadMcpServer(setup.app, {
					envelope: "opaque",
					authorizer: {
						authorize: async () => authorization as never,
					},
					contextBinder: {
						bind: async () => {
							binderCalls += 1;
							return (await setup.app.createContext({
								accessMode: "user",
							})) as never;
						},
					},
				});
				const { client, close } = await connect(server);
				try {
					expect((await client.listTools()).tools).toEqual([]);
					const result = await client.callTool({
						name: "protected.proxy",
						arguments: {},
					});
					expect(result).toEqual({
						isError: true,
						content: [{ type: "text", text: "MCP access denied" }],
					});
					expect(JSON.stringify(result)).not.toContain("consumer-secret");
				} finally {
					await close();
				}
			}
			expect(binderCalls).toBe(0);
			expect(handlerCalls).toBe(0);
		} finally {
			await setup.cleanup();
		}
	}, 15_000);

	it("keeps throwing or malformed binders and handoff failures secret-safe", async () => {
		let handlerCalls = 0;
		const setup = await buildMockApp({
			mcpTools: {
				read: mcpTool("protected.bound", {
					workload: { capabilities: ["protected.read"] },
				}).handler(async () => {
					handlerCalls += 1;
					return { content: [{ type: "text", text: "unexpected" }] };
				}),
				write: mcpTool("protected.write", {
					workload: {
						capabilities: ["protected.write"],
						handoff: "protected.commit",
					},
				}).handler(async () => {
					handlerCalls += 1;
					return { content: [{ type: "text", text: "unexpected" }] };
				}),
			},
		});

		try {
			for (const bind of [
				async () => {
					throw new Error("postgres://binder-secret");
				},
				async () => null as never,
				async () => ({}) as never,
				async () =>
					({
						...(await setup.app.createContext({ accessMode: "system" })),
						accessMode: "system",
					}) as never,
			]) {
				const server = await createWorkloadMcpServer(setup.app, {
					envelope: "opaque",
					authorizer: {
						authorize: async () => ({ context: "opaque" }),
					},
					contextBinder: { bind },
					handoff: {
						execute: async ({ invoke }) => invoke(),
					},
				});
				const { client, close } = await connect(server);
				try {
					expect((await client.listTools()).tools).toEqual([]);
					const result = await client.callTool({
						name: "protected.bound",
						arguments: {},
					});
					expect(result).toEqual({
						isError: true,
						content: [{ type: "text", text: "MCP access denied" }],
					});
					expect(JSON.stringify(result)).not.toContain("binder-secret");
				} finally {
					await close();
				}
			}

			const handoffServer = await createWorkloadMcpServer(setup.app, {
				envelope: "opaque",
				authorizer: {
					authorize: async () => ({ context: "opaque" }),
				},
				contextBinder: contextBinder(setup.app),
				handoff: {
					execute: async () => {
						throw new Error("postgres://handoff-secret");
					},
				},
			});
			const handoffConnection = await connect(handoffServer);
			try {
				const result = await handoffConnection.client.callTool({
					name: "protected.write",
					arguments: {},
				});
				expect(result).toEqual({
					isError: true,
					content: [{ type: "text", text: "MCP access denied" }],
				});
				expect(JSON.stringify(result)).not.toContain("handoff-secret");
			} finally {
				await handoffConnection.close();
			}
			expect(handlerCalls).toBe(0);
		} finally {
			await setup.cleanup();
		}
	}, 15_000);

	it("passes mutation execution through an opaque consumer handoff without interpreting metadata", async () => {
		let handlerCalls = 0;
		const handoffs: unknown[] = [];
		const setup = await buildMockApp({
			mcpTools: {
				update: mcpTool("tasks.update", {
					workload: {
						capabilities: ["tasks.write"],
						handoff: "tasks.commit",
					},
				}).handler(async () => {
					handlerCalls += 1;
					return { content: [{ type: "text", text: "updated" }] };
				}),
			},
		});
		const server = await createWorkloadMcpServer(setup.app, {
			envelope: "opaque-envelope",
			authorizer: {
				authorize: async () => ({
					context: "opaque-authorization-context",
					attribution: "opaque-correlation",
				}),
			},
			contextBinder: contextBinder(setup.app),
			handoff: {
				execute: async (input) => {
					handoffs.push({
						authorizationContext: input.authorizationContext,
						attribution: input.attribution,
						toolName: input.toolName,
						capability: input.capability,
						metadata: input.metadata,
					});
					return input.invoke();
				},
			},
		});
		const { client, close } = await connect(server);

		try {
			const result = await client.callTool({
				name: "tasks.update",
				arguments: {},
				_meta: { opaque: { consumer: "metadata" } },
			});
			expect(result.isError).toBeUndefined();
			expect(handlerCalls).toBe(1);
			expect(handoffs).toEqual([
				{
					authorizationContext: "opaque-authorization-context",
					attribution: "opaque-correlation",
					toolName: "tasks.update",
					capability: "tasks.commit",
					metadata: undefined,
				},
			]);
		} finally {
			await close();
			await setup.cleanup();
		}
	}, 15_000);

	it("hides malformed requirements and handoff-bound tools without a handoff", async () => {
		let handlerCalls = 0;
		const setup = await buildMockApp({
			mcpTools: {
				malformed: mcpTool("malformed.read", {
					workload: { capabilities: [] },
				}).handler(async () => {
					handlerCalls += 1;
					return { content: [{ type: "text", text: "unexpected" }] };
				}),
				requiresHandoff: mcpTool("tasks.commit", {
					workload: {
						capabilities: ["tasks.write"],
						handoff: "tasks.commit",
					},
				}).handler(async () => {
					handlerCalls += 1;
					return { content: [{ type: "text", text: "unexpected" }] };
				}),
			},
		});
		const server = await createWorkloadMcpServer(setup.app, {
			envelope: "opaque",
			authorizer: {
				authorize: async () => ({ context: "opaque" }),
			},
			contextBinder: contextBinder(setup.app),
		});
		const { client, close } = await connect(server);

		try {
			expect((await client.listTools()).tools).toEqual([]);
			for (const name of ["malformed.read", "tasks.commit"]) {
				expect(await client.callTool({ name, arguments: {} })).toEqual({
					isError: true,
					content: [{ type: "text", text: "MCP access denied" }],
				});
			}
			expect(handlerCalls).toBe(0);
		} finally {
			await close();
			await setup.cleanup();
		}
	}, 15_000);

	it("keeps authorizer and audit failures secret-safe", async () => {
		let handlerCalls = 0;
		const setup = await buildMockApp({
			mcpTools: {
				read: mcpTool("tasks.read", {
					workload: { capabilities: ["tasks.read"] },
				}).handler(async () => {
					handlerCalls += 1;
					return { content: [{ type: "text", text: "secret" }] };
				}),
			},
		});
		const server = await createWorkloadMcpServer(setup.app, {
			envelope: "opaque",
			authorizer: {
				authorize: async () => ({
					context: "opaque",
					attribution: "opaque-attribution",
				}),
			},
			contextBinder: contextBinder(setup.app),
			audit: async () => {
				throw new Error("postgres://user:credential@internal");
			},
		});
		const { client, close } = await connect(server);

		try {
			expect((await client.listTools()).tools).toEqual([]);
			const result = await client.callTool({
				name: "tasks.read",
				arguments: {},
			});
			expect(result).toEqual({
				isError: true,
				content: [{ type: "text", text: "MCP access denied" }],
			});
			expect(JSON.stringify(result)).not.toContain("credential");
			expect(handlerCalls).toBe(0);
		} finally {
			await close();
			await setup.cleanup();
		}
	}, 15_000);

	it("applies the same fail-closed boundary to custom, generated CRUD, and route tools", async () => {
		let allowed = true;
		let customCalls = 0;
		const tasks = collection("workloadTasks")
			.fields(({ f }) => ({ title: f.text(255).required() }))
			.access({ read: true });
		const lookup = route()
			.post()
			.schema(z.object({ taskId: z.string() }))
			.meta({
				title: "Look up a task",
				mcp: { expose: true, name: "tasks.lookup" },
			})
			.handler(async ({ input }) => ({ taskId: input.taskId }));
		const requirement = { capabilities: ["tasks.read"] };
		const setup = await buildMockApp({
			collections: { workloadTasks: tasks },
			routes: { "tasks/lookup:POST": lookup },
			mcpTools: {
				custom: mcpTool("tasks.custom", {
					workload: requirement,
				}).handler(async () => {
					customCalls += 1;
					return { content: [{ type: "text", text: "ok" }] };
				}),
			},
		});
		const server = await createWorkloadMcpServer(setup.app, {
			envelope: "opaque",
			authorizer: {
				authorize: async () => (allowed ? { context: "opaque-context" } : null),
			},
			contextBinder: contextBinder(setup.app),
			config: {
				crud: {
					collections: {
						workloadTasks: {
							read: true,
							write: false,
							delete: false,
							operationWorkloads: { list: requirement },
						},
					},
				},
				routes: {
					routes: {
						"tasks/lookup": { workload: requirement },
					},
				},
			},
		});
		const { client, close } = await connect(server);

		try {
			expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
				["collections.workloadTasks.list", "tasks.lookup", "tasks.custom"],
			);
			allowed = false;
			for (const request of [
				{ name: "collections.workloadTasks.list", arguments: {} },
				{ name: "tasks.lookup", arguments: { taskId: "task-1" } },
				{ name: "tasks.custom", arguments: {} },
			]) {
				expect(await client.callTool(request)).toEqual({
					isError: true,
					content: [{ type: "text", text: "MCP access denied" }],
				});
			}
			expect(customCalls).toBe(0);
		} finally {
			await close();
			await setup.cleanup();
		}
	}, 15_000);
});
