import { describe, expect, it } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
	createAgentWorkloadPrincipalResolver,
	createAuthenticatedAgentWorkloadTransport,
	type AgentWorkloadAuthorityRecord,
} from "@questpie/ai";

import {
	activeAuthority,
	authoritySnapshot,
	WORKLOAD_NOW,
} from "../../ai/src/__tests__/agent-workload-fixture.js";
import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder.js";
import {
	createAgentWorkloadMcpServer,
	mcpTool,
	type McpAgentWorkloadRequirement,
} from "../src/exports/index.js";

function policyTool(name: string, workload?: McpAgentWorkloadRequirement) {
	return mcpTool(name, {
		inputSchema: z.object({}),
		workload,
	}).handler(async () => ({ content: [{ type: "text", text: "ok" }] }));
}

async function connect(server: McpServer) {
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({
		name: "agent-workload-denials-test",
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

function resolverFor(
	record: AgentWorkloadAuthorityRecord,
	now: () => Date = () => WORKLOAD_NOW,
) {
	return createAgentWorkloadPrincipalResolver({
		audience: "mcp",
		authorityStore: {
			loadFreshConsistentAuthority: async () => authoritySnapshot(record),
		},
		now,
		principalId: () => "principal_mcp_denials",
	});
}

function workloadTransport() {
	return createAuthenticatedAgentWorkloadTransport({
		keyId: "mcp-worker-control-plane-v1",
		secret: new TextEncoder().encode(
			"hreben-mcp-workload-transport-key-32-bytes-minimum",
		),
	});
}

describe("Agent workload MCP fail-closed matrix", () => {
	it("keeps Company, anchor-Space, Skill/tool, grant, and effect ceilings independent", async () => {
		const base = activeAuthority();
		const record: AgentWorkloadAuthorityRecord = {
			...base,
			capabilities: {
				tools: [
					...base.capabilities.tools,
					"company.members.get",
					"cross-space.read",
					"tasks.update",
					"missing-grant.read",
				],
				effects: base.capabilities.effects,
			},
		};
		const resolver = resolverFor(record);
		const transport = workloadTransport();
		const principal = await resolver.resolve({
			runId: record.run.id,
			attemptId: record.run.attemptId,
		});
		const audit: unknown[] = [];
		const setup = await buildMockApp({
			mcpTools: {
				task: policyTool("tasks.get", {
					scope: "anchor_space",
					grant: "tasks.read",
					effect: false,
				}),
				companyMember: policyTool("company.members.get", {
					scope: "company",
					grant: "company.members.read",
					effect: false,
				}),
				crossSpace: policyTool("cross-space.read", {
					scope: "anchor_space",
					grant: "company.members.read",
					effect: false,
				}),
				missingEffect: policyTool("tasks.update", {
					scope: "anchor_space",
					grant: "tasks.read",
					effect: "task.update",
				}),
				missingGrant: policyTool("missing-grant.read", {
					scope: "anchor_space",
					grant: "secrets.read",
					effect: false,
				}),
				ambientSystem: policyTool("ambient.system"),
			},
		});
		const server = await createAgentWorkloadMcpServer(setup.app, {
			envelope: transport.open(transport.seal(principal)),
			resolver,
			audit: (event) => audit.push(event),
			effectHandoff: { execute: async ({ invoke }) => invoke() },
		});
		const { client, close } = await connect(server);

		try {
			expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
				["tasks.get", "company.members.get"],
			);
			const serialized = JSON.stringify(audit);
			expect(serialized).not.toContain("cross-space.read");
			expect(serialized).not.toContain("tasks.update");
			expect(serialized).not.toContain("missing-grant.read");
			expect(serialized).not.toContain("ambient.system");
			expect(
				audit.filter(
					(event: any) =>
						event.phase === "discovery" && event.decision === "denied",
				),
			).toHaveLength(4);
		} finally {
			await close();
			await setup.cleanup();
		}
	});

	it("ignores forged cookie, requester context, and stdio system fallback fields", async () => {
		const record = activeAuthority();
		const resolver = resolverFor(record);
		const transport = workloadTransport();
		const principal = await resolver.resolve({
			runId: record.run.id,
			attemptId: record.run.attemptId,
		});
		const setup = await buildMockApp({
			mcpTools: {
				allowed: policyTool("tasks.get", {
					scope: "anchor_space",
					grant: "tasks.read",
					effect: false,
				}),
				ambientSystem: policyTool("ambient.system"),
			},
		});
		const server = await createAgentWorkloadMcpServer(setup.app, {
			envelope: transport.open(transport.seal(principal)),
			resolver,
			accessMode: "system",
			request: new Request("http://questpie.local/mcp", {
				headers: { cookie: "session=forged-requester" },
			}),
			ctx: {
				principal: { kind: "oauth", scopes: ["*"] },
				session: { user: { id: "requester" } },
			},
		} as never);
		const { client, close } = await connect(server);

		try {
			expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
				["tasks.get"],
			);
		} finally {
			await close();
			await setup.cleanup();
		}
	});

	it("rejects forged, wrong-audience, expired, terminal, and stale-lease authority before discovery", async () => {
		const base = activeAuthority();
		const transport = workloadTransport();
		const setup = await buildMockApp({});
		const executorResolver = createAgentWorkloadPrincipalResolver({
			audience: "executor",
			authorityStore: {
				loadFreshConsistentAuthority: async () => authoritySnapshot(base),
			},
			now: () => WORKLOAD_NOW,
		});
		const executorPrincipal = await executorResolver.resolve({
			runId: base.run.id,
			attemptId: base.run.attemptId,
		});

		try {
			await expect(
				createAgentWorkloadMcpServer(setup.app, undefined as never),
			).rejects.toMatchObject({ code: "invalid_principal" });
			await expect(
				createAgentWorkloadMcpServer(setup.app, {
					envelope: transport.open(transport.seal(executorPrincipal)),
					resolver: resolverFor(base),
				}),
			).rejects.toMatchObject({ code: "principal_wrong_audience" });
			await expect(
				createAgentWorkloadMcpServer(setup.app, {
					envelope: {
						kind: "authenticated_agent_workload_envelope",
						version: 1,
					} as never,
					resolver: resolverFor(base),
				}),
			).rejects.toMatchObject({ code: "invalid_principal" });

			const principal = await resolverFor(base).resolve({
				runId: base.run.id,
				attemptId: base.run.attemptId,
			});
			const envelope = transport.open(transport.seal(principal));
			await expect(
				createAgentWorkloadMcpServer(setup.app, {
					envelope,
					resolver: resolverFor(
						base,
						() => new Date("2026-07-19T09:06:00.000Z"),
					),
				}),
			).rejects.toMatchObject({ code: "principal_expired" });
			await expect(
				createAgentWorkloadMcpServer(setup.app, {
					envelope,
					resolver: resolverFor({
						...base,
						run: { ...base.run, status: "completed" },
					}),
				}),
			).rejects.toMatchObject({ code: "run_attempt_terminal" });
			await expect(
				createAgentWorkloadMcpServer(setup.app, {
					envelope,
					resolver: resolverFor({
						...base,
						execution: {
							...base.execution,
							currentWorkerLeaseEpoch: 12,
						},
					}),
				}),
			).rejects.toMatchObject({ code: "worker_lease_stale" });
			await expect(
				createAgentWorkloadMcpServer(setup.app, {
					envelope,
					resolver: resolverFor({
						...base,
						run: { ...base.run, grantEpoch: 8 },
						currentEpochs: { ...base.currentEpochs, grant: 8 },
					}),
				}),
			).rejects.toMatchObject({ code: "authority_epoch_stale" });
			await expect(
				createAgentWorkloadMcpServer(setup.app, {
					envelope,
					resolver: resolverFor({
						...base,
						execution: {
							...base.execution,
							currentWorkerLeaseId: "lease_reassigned",
						},
					}),
				}),
			).rejects.toMatchObject({ code: "worker_lease_stale" });
			await expect(
				createAgentWorkloadMcpServer(setup.app, {
					envelope,
					resolver: resolverFor({
						...base,
						agent: { ...base.agent, status: "suspended" },
					}),
				}),
			).rejects.toMatchObject({ code: "agent_unavailable" });
			await expect(
				createAgentWorkloadMcpServer(setup.app, {
					envelope,
					resolver: resolverFor({
						...base,
						run: { ...base.run, attemptId: "attempt_02" },
					}),
				}),
			).rejects.toMatchObject({ code: "authority_not_found" });
		} finally {
			await setup.cleanup();
		}
	});
});
