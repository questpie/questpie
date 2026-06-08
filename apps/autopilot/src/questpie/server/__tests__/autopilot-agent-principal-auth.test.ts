import { describe, expect, it } from "bun:test";

import { createMcpServer, mcpTool } from "@questpie/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { starterModule } from "questpie";
import { z } from "zod";

import {
	buildMockApp,
	type MockApp,
} from "../../../../../../packages/questpie/test/utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../../../../../../packages/questpie/test/utils/test-db";
import authConfig from "../config/auth";

const principalTool = mcpTool("autopilot.principal", {
	description: "Return the authenticated Autopilot principal.",
	inputSchema: z.object({}),
	access: ({ ctx }) => typeof ctx.session?.user?.id === "string",
}).handler(async ({ ctx }) => ({
	structuredContent: {
		userId: ctx.session?.user.id,
		sessionId: ctx.session?.session.id,
	},
	content: [{ type: "text", text: ctx.session?.user.id ?? "" }],
}));

async function connect(server: McpServer) {
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({
		name: "autopilot-principal-test",
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

describe("Autopilot agent principal auth contract", () => {
	it("resolves user-owned API keys to Better Auth sessions for HTTP MCP", async () => {
		let setup: { app: MockApp; cleanup: () => Promise<void> } | undefined;

		try {
			setup = await buildMockApp(
				{
					modules: [starterModule],
					auth: authConfig,
					mcpTools: {
						principal: principalTool,
					},
				},
				{
					secret: "test-auth-secret-with-more-than-32-chars",
				},
			);
			await runTestDbMigrations(setup.app);

			const signUpResponse = await setup.app.auth.api.signUpEmail({
				body: {
					email: "agent-api-key@example.test",
					password: "password123",
					name: "Agent API Key",
				},
				asResponse: true,
			});
			const signUpBody = await signUpResponse.json();
			const apiKey = await (setup.app.auth.api as any).createApiKey({
				body: {
					name: "autopilot-agent",
					userId: signUpBody.user.id,
				},
			});
			const sessionFromApiKey = await setup.app.auth.api.getSession({
				headers: new Headers({ "x-api-key": apiKey.key }),
			});
			expect(sessionFromApiKey?.user.id).toBe(signUpBody.user.id);

			const server = await createMcpServer(setup.app, {
				transport: "http",
				request: new Request("http://localhost/api/mcp", {
					headers: { "x-api-key": apiKey.key },
				}),
			});
			const { client, close } = await connect(server);

			try {
				const tools = await client.listTools();
				expect(tools.tools.map((tool) => tool.name)).toContain(
					"autopilot.principal",
				);

				const result = await client.callTool({
					name: "autopilot.principal",
					arguments: {},
				});
				expect(result.isError).toBeUndefined();
				expect(result.structuredContent).toEqual({
					userId: signUpBody.user.id,
					sessionId: apiKey.id,
				});
			} finally {
				await close();
			}
		} finally {
			await setup?.cleanup();
		}
	});
});
