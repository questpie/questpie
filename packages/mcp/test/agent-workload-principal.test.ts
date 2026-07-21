import { describe, expect, it } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { collection, route } from "questpie";
import { z } from "zod";

import {
	createAgentWorkloadPrincipalResolver,
	createAuthenticatedAgentWorkloadTransport,
} from "@questpie/ai";

import {
	activeAuthority,
	authoritySnapshot,
	WORKLOAD_NOW,
} from "../../ai/src/__tests__/agent-workload-fixture.js";
import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder.js";
import { createAgentWorkloadMcpServer, mcpTool } from "../src/exports/index.js";

function readTaskTool(onCall: () => void = () => undefined) {
	return mcpTool("tasks.get", {
		description: "Read one task in the anchor Space.",
		inputSchema: z.object({ taskId: z.string() }),
		workload: {
			scope: "anchor_space",
			grant: "tasks.read",
			effect: false,
		},
	}).handler(async ({ input }) => {
		onCall();
		return {
			structuredContent: { taskId: input.taskId },
			content: [{ type: "text" as const, text: input.taskId }],
		};
	});
}

function replyTool(onCall: () => void) {
	return mcpTool("messages.reply", {
		description: "Reply in the anchor Thread.",
		inputSchema: z.object({ body: z.string() }),
		workload: {
			scope: "anchor_space",
			grant: "messages.create",
			effect: "message.create",
		},
	}).handler(async () => {
		onCall();
		return {
			structuredContent: { receiptId: "receipt_message_01" },
			content: [{ type: "text" as const, text: "receipt_message_01" }],
		};
	});
}

const hiddenSecret = mcpTool("secrets.read", {
	description: "Must never be visible to this Skill.",
	inputSchema: z.object({}),
	workload: {
		scope: "company",
		grant: "company.secrets.read",
		effect: false,
	},
}).handler(async () => ({
	content: [{ type: "text", text: "must-not-run" }],
}));

const workloadTasks = collection("workloadTasks")
	.fields(({ f }) => ({ title: f.text(255).required() }))
	.access({ read: true });

const workloadLookupRoute = route()
	.post()
	.schema(z.object({ taskId: z.string() }))
	.meta({
		title: "Look up a task",
		mcp: { expose: true, name: "tasks.lookup" },
	})
	.handler(async ({ input }) => ({ taskId: input.taskId }));

async function connect(server: McpServer) {
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({
		name: "agent-workload-principal-test",
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

describe("Agent workload principal at the MCP boundary", () => {
	it("lists and calls only a tool inside the validated Skill and exact anchor-Space grant", async () => {
		const record = activeAuthority();
		const resolver = createAgentWorkloadPrincipalResolver({
			audience: "mcp",
			authorityStore: {
				loadFreshConsistentAuthority: async () => authoritySnapshot(record),
			},
			now: () => WORKLOAD_NOW,
			principalId: () => "principal_mcp_marketing",
		});
		const transport = createAuthenticatedAgentWorkloadTransport({
			keyId: "mcp-worker-control-plane-v1",
			secret: new TextEncoder().encode(
				"hreben-mcp-workload-transport-key-32-bytes-minimum",
			),
		});
		const principal = await resolver.resolve({
			runId: record.run.id,
			attemptId: record.run.attemptId,
		});
		const envelope = transport.open(transport.seal(principal));
		const setup = await buildMockApp({
			mcpTools: { readTask: readTaskTool(), hiddenSecret },
		});
		const server = await createAgentWorkloadMcpServer(setup.app, {
			envelope,
			resolver,
		});
		const { client, close } = await connect(server);

		try {
			const tools = await client.listTools();
			expect(tools.tools.map((tool) => tool.name)).toEqual(["tasks.get"]);

			const result = await client.callTool({
				name: "tasks.get",
				arguments: { taskId: "task_launch" },
			});
			expect(result.isError).toBeUndefined();
			expect(result.structuredContent).toEqual({ taskId: "task_launch" });
		} finally {
			await close();
			await setup.cleanup();
		}
	});

	it("revalidates after discovery so revocation denies the call and emits only redacted attributable audit", async () => {
		let record = activeAuthority();
		let handlerCalls = 0;
		const audit: unknown[] = [];
		const resolver = createAgentWorkloadPrincipalResolver({
			audience: "mcp",
			authorityStore: {
				loadFreshConsistentAuthority: async () => authoritySnapshot(record),
			},
			now: () => WORKLOAD_NOW,
			principalId: () => "principal_mcp_revocation",
		});
		const transport = createAuthenticatedAgentWorkloadTransport({
			keyId: "mcp-worker-control-plane-v1",
			secret: new TextEncoder().encode(
				"hreben-mcp-workload-transport-key-32-bytes-minimum",
			),
		});
		const principal = await resolver.resolve({
			runId: record.run.id,
			attemptId: record.run.attemptId,
		});
		const setup = await buildMockApp({
			mcpTools: {
				readTask: readTaskTool(() => {
					handlerCalls += 1;
				}),
			},
		});
		const server = await createAgentWorkloadMcpServer(setup.app, {
			envelope: transport.open(transport.seal(principal)),
			resolver,
			audit: (event) => {
				audit.push(event);
			},
		});
		const { client, close } = await connect(server);

		try {
			expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
				["tasks.get"],
			);
			record = {
				...record,
				run: { ...record.run, revocationEpoch: 4 },
				currentEpochs: { ...record.currentEpochs, revocation: 4 },
			};
			expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
				[],
			);
			const result = await client.callTool({
				name: "tasks.get",
				arguments: { taskId: "task_sensitive_do_not_audit" },
			});

			expect(result.isError).toBe(true);
			expect(handlerCalls).toBe(0);
			expect(audit).toEqual([
				expect.objectContaining({
					phase: "discovery",
					decision: "allowed",
					runId: "run_marketing_launch",
					attemptId: "attempt_01",
					agentActorId: "actor_autopilot",
					toolName: "tasks.get",
				}),
				expect.objectContaining({
					phase: "discovery",
					decision: "denied",
					runId: "run_marketing_launch",
					attemptId: "attempt_01",
					agentActorId: "actor_autopilot",
					reason: "authority_not_current",
				}),
				expect.objectContaining({
					phase: "call",
					decision: "denied",
					runId: "run_marketing_launch",
					attemptId: "attempt_01",
					agentActorId: "actor_autopilot",
					toolName: "tasks.get",
					reason: "authority_not_current",
				}),
			]);
			const serializedAudit = JSON.stringify(audit);
			expect(serializedAudit).not.toContain("task_sensitive_do_not_audit");
			expect(serializedAudit).not.toContain("credential");
			expect(serializedAudit).not.toContain("arguments");
		} finally {
			await close();
			await setup.cleanup();
		}
	});

	it("fails closed with a fixed public error when the audit sink fails", async () => {
		const record = activeAuthority();
		const resolver = createAgentWorkloadPrincipalResolver({
			audience: "mcp",
			authorityStore: {
				loadFreshConsistentAuthority: async () => authoritySnapshot(record),
			},
			now: () => WORKLOAD_NOW,
			principalId: () => "principal_mcp_audit_failure",
		});
		const transport = createAuthenticatedAgentWorkloadTransport({
			keyId: "mcp-worker-control-plane-v1",
			secret: new TextEncoder().encode(
				"hreben-mcp-workload-transport-key-32-bytes-minimum",
			),
		});
		const principal = await resolver.resolve({
			runId: record.run.id,
			attemptId: record.run.attemptId,
		});
		const setup = await buildMockApp({
			mcpTools: { readTask: readTaskTool() },
		});
		const server = await createAgentWorkloadMcpServer(setup.app, {
			envelope: transport.open(transport.seal(principal)),
			resolver,
			audit: (event) => {
				if (event.phase === "call") {
					throw new Error("postgres://user:credential@db/internal");
				}
			},
		});
		const { client, close } = await connect(server);

		try {
			const result = await client.callTool({
				name: "tasks.get",
				arguments: { taskId: "task_launch" },
			});
			expect(result).toEqual({
				isError: true,
				content: [{ type: "text", text: "MCP access denied" }],
			});
			expect(JSON.stringify(result)).not.toContain("credential");
			expect(JSON.stringify(result)).not.toContain("postgres://");
		} finally {
			await close();
			await setup.cleanup();
		}
	});

	it("keeps audit-sink failures secret-safe across custom, generated CRUD, and route tools", async () => {
		const base = activeAuthority();
		const record = {
			...base,
			capabilities: {
				...base.capabilities,
				tools: [
					...base.capabilities.tools,
					"collections.workloadTasks.list",
					"tasks.lookup",
				],
			},
		};
		const resolver = createAgentWorkloadPrincipalResolver({
			audience: "mcp",
			authorityStore: {
				loadFreshConsistentAuthority: async () => authoritySnapshot(record),
			},
			now: () => WORKLOAD_NOW,
			principalId: () => "principal_mcp_all_paths_audit_failure",
		});
		const transport = createAuthenticatedAgentWorkloadTransport({
			keyId: "mcp-worker-control-plane-v1",
			secret: new TextEncoder().encode(
				"hreben-mcp-workload-transport-key-32-bytes-minimum",
			),
		});
		const principal = await resolver.resolve({
			runId: record.run.id,
			attemptId: record.run.attemptId,
		});
		const setup = await buildMockApp({
			collections: { workloadTasks },
			routes: { "tasks/lookup:POST": workloadLookupRoute },
			mcpTools: { readTask: readTaskTool() },
		});
		const workload = {
			scope: "anchor_space" as const,
			grant: "tasks.read",
			effect: false as const,
		};
		const server = await createAgentWorkloadMcpServer(setup.app, {
			envelope: transport.open(transport.seal(principal)),
			resolver,
			config: {
				crud: {
					collections: {
						workloadTasks: {
							read: true,
							write: false,
							delete: false,
							operationWorkloads: { list: workload },
						},
					},
				},
				routes: {
					routes: {
						"tasks/lookup": { workload },
					},
				},
			},
			audit: (event) => {
				if (event.phase === "call") {
					throw new Error("postgres://user:credential@db/internal");
				}
			},
		});
		const { client, close } = await connect(server);

		try {
			const names = (await client.listTools()).tools.map((tool) => tool.name);
			expect(names).toEqual([
				"collections.workloadTasks.list",
				"tasks.lookup",
				"tasks.get",
			]);

			const results = await Promise.all([
				client.callTool({
					name: "tasks.get",
					arguments: { taskId: "task_custom" },
				}),
				client.callTool({
					name: "collections.workloadTasks.list",
					arguments: {},
				}),
				client.callTool({
					name: "tasks.lookup",
					arguments: { taskId: "task_route" },
				}),
			]);
			for (const result of results) {
				expect(result).toEqual({
					isError: true,
					content: [{ type: "text", text: "MCP access denied" }],
				});
			}
			const serialized = JSON.stringify(results);
			expect(serialized).not.toContain("credential");
			expect(serialized).not.toContain("postgres://");
		} finally {
			await close();
			await setup.cleanup();
		}
	});

	it("hands a mutating call to the typed command/effect idempotency seam", async () => {
		const record = activeAuthority();
		let handlerCalls = 0;
		const receipts = new Map<string, CallToolResult>();
		const resolver = createAgentWorkloadPrincipalResolver({
			audience: "mcp",
			authorityStore: {
				loadFreshConsistentAuthority: async () => authoritySnapshot(record),
			},
			now: () => WORKLOAD_NOW,
			principalId: () => "principal_mcp_effect",
		});
		const transport = createAuthenticatedAgentWorkloadTransport({
			keyId: "mcp-worker-control-plane-v1",
			secret: new TextEncoder().encode(
				"hreben-mcp-workload-transport-key-32-bytes-minimum",
			),
		});
		const principal = await resolver.resolve({
			runId: record.run.id,
			attemptId: record.run.attemptId,
		});
		const setup = await buildMockApp({
			mcpTools: {
				reply: replyTool(() => {
					handlerCalls += 1;
				}),
			},
		});
		const server = await createAgentWorkloadMcpServer(setup.app, {
			envelope: transport.open(transport.seal(principal)),
			resolver,
			effectHandoff: {
				execute: async ({ command, effect, invoke }) => {
					expect(effect).toBe("message.create");
					expect(command.commandId).toBe("command_reply_01");
					const existing = receipts.get(command.idempotencyKey);
					if (existing) return existing;
					const result = await invoke();
					receipts.set(command.idempotencyKey, result);
					return result;
				},
			},
		});
		const { client, close } = await connect(server);

		try {
			const request = {
				name: "messages.reply",
				arguments: { body: "Never place this body in authority or audit." },
				_meta: {
					"io.questpie/command-id": "command_reply_01",
					"io.questpie/idempotency-key": "reply-run-attempt-event-01",
					"io.questpie/effect-request-id": "effect_request_reply_01",
				},
			};
			const first = await client.callTool(request);
			const duplicate = await client.callTool(request);

			expect(first.isError).toBeUndefined();
			expect(duplicate.structuredContent).toEqual(first.structuredContent);
			expect(handlerCalls).toBe(1);
		} finally {
			await close();
			await setup.cleanup();
		}
	});
});
