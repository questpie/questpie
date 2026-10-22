import { expect, it } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { route } from "questpie";
import { z } from "zod";

import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder.js";
import {
	createMcpServer,
	createWorkloadMcpServer,
} from "../src/exports/index.js";

it("derives query hints for both credential carriers and keeps handoffs as effects", async () => {
	const definitions = Object.fromEntries(
		["read", "approval"].map((name) => [
			`${name}:POST`,
			route()
				.post()
				.schema(z.object({}))
				.outputSchema(z.object({ ok: z.boolean() }))
				.access(true)
				.query()
				.meta({
					mcp: { expose: true, name, annotations: { readOnlyHint: false } },
				})
				.handler(() => ({ ok: true })),
		]),
	);
	const setup = await buildMockApp({ routes: definitions });
	const policy = {
		routes: {
			routes: {
				read: {
					operations: { execute: true },
					requiredScopes: false,
					workload: { capabilities: ["read"] },
				},
				approval: {
					operations: { execute: true },
					requiredScopes: false,
					workload: { capabilities: ["read"], handoff: "approve" as const },
				},
			},
		},
	};
	const facts: Array<{ name: string; intent: string }> = [];
	try {
		const servers = [
			await createMcpServer(setup.app, { config: policy }),
			await createWorkloadMcpServer(setup.app, {
				config: policy,
				envelope: { subject: "same-subject" },
				handoff: { execute: async ({ execute }) => execute() },
				authorizer: {
					authorize: async (request) => {
						facts.push(request.tool);
						return { context: {} };
					},
				},
				contextBinder: {
					bind: async () =>
						await setup.app.createContext({ accessMode: "user" }),
				},
			}),
		];
		for (const server of servers) {
			const [ct, st] = InMemoryTransport.createLinkedPair();
			const client = new Client({ name: "route-query-hints", version: "1" });
			try {
				await server.connect(st);
				await client.connect(ct);
				const tools = (await client.listTools()).tools;
				expect(tools.map((tool) => tool.name).sort()).toEqual([
					"approval",
					"read",
				]);
				for (const tool of tools)
					expect(tool.annotations?.readOnlyHint).toBe(true);
			} finally {
				await client.close();
				await server.close();
			}
		}
		expect(facts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "read", intent: "read" }),
				expect.objectContaining({ name: "approval", intent: "effect" }),
			]),
		);
	} finally {
		await setup.cleanup();
	}
});
