import { expect, it } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv-provider.js";
import { collection } from "questpie";
import { z } from "zod";

import { blocks } from "../../admin/src/server/fields/blocks.js";
import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../../questpie/test/utils/test-db.js";
import {
	createMcpServer,
	createWorkloadMcpServer,
	createWorkloadMcpToolPort,
	mcpTool,
} from "../src/exports/index.js";

async function connect(server: McpServer) {
	const [ct, st] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "input-semantics", version: "1" });
	await server.connect(st);
	await client.connect(ct);
	return {
		client,
		close: async () => {
			await client.close();
			await server.close();
		},
	};
}

it("advertises omitted defaults and recursive block children as valid real CRUD input", async () => {
	const setup = await buildMockApp({
		collections: {
			pages: collection("pages")
				.fields(({ f }) => ({
					title: f.text().required(),
					settings: f
						.json()
						.zod(() =>
							z.object({ theme: z.enum(["light", "dark"]).default("light") }),
						),
					shape: f
						.json()
						.zod(() =>
							z.discriminatedUnion("kind", [
								z.object({ kind: z.literal("circle"), r: z.number() }),
								z.object({ kind: z.literal("square"), side: z.number() }),
							]),
						),
					coordinates: f.json().zod(() => z.tuple([z.string(), z.number()])),
					content: blocks(),
				}))
				.access({ read: true, create: true, update: true }),
		},
		config: {
			mcp: {
				stdio: { trustedMaintenance: true },
				crud: {
					collections: {
						pages: { operations: { create: true, update: true } },
					},
				},
			},
		},
	});
	try {
		await runTestDbMigrations(setup.app);
		const server = await createMcpServer(setup.app, { transport: "stdio" });
		const schemas = Reflect.get(server, "_registeredTools") as Record<
			string,
			{ inputSchema: z.ZodTypeAny }
		>;
		const { client, close } = await connect(server);
		try {
			const { tools } = await client.listTools();
			for (const tool of tools) {
				const validate = new AjvJsonSchemaValidator().getValidator(
					tool.inputSchema,
				);
				const samples = [
					{ title: "Defaults", settings: {} },
					{ title: "Tuple", coordinates: ["tag", 1] },
					{
						title: "Recursive",
						content: {
							_tree: [
								{
									id: "parent",
									type: "hero",
									children: [{ id: "leaf", type: "hero" }],
								},
							],
							_values: {},
						},
					},
					{ title: "Union", shape: { kind: "circle", r: 1, note: "stripped" } },
				];
				for (const data of samples) {
					const input = tool.name.endsWith(".update")
						? { id: "existing", data }
						: { data };
					expect(schemas[tool.name].inputSchema.safeParse(input).success).toBe(
						true,
					);
					expect(validate(input).valid).toBe(true);
				}
				const invalid = {
					data: { title: "Invalid", settings: { theme: "invalid" } },
					...(tool.name.endsWith(".update") ? { id: "existing" } : {}),
				};
				expect(schemas[tool.name].inputSchema.safeParse(invalid).success).toBe(
					false,
				);
				expect(validate(invalid).valid).toBe(false);
			}
			const result = await client.callTool({
				name: "collections.pages.create",
				arguments: {
					data: {
						title: "Stored",
						coordinates: ["tag", 1],
						settings: {},
						content: { _tree: [{ id: "leaf", type: "hero" }], _values: {} },
					},
				},
			});
			expect(result.isError).not.toBe(true);
			expect(result.structuredContent).toMatchObject({
				title: "Stored",
				settings: { theme: "light" },
			});
		} finally {
			await close();
		}
	} finally {
		await setup.cleanup();
	}
});

it("keeps tuple and default semantics across human, workload, and in-process custom tools", async () => {
	const tuple = z.tuple([z.string(), z.number()]).meta({ id: "ToolTuple" });
	const inputSchema = z.object({ tags: tuple, limit: z.number().default(10) });
	const outputSchema = z.object({ tags: tuple, limit: z.number() });
	const setup = await buildMockApp({
		mcpTools: {
			echo: mcpTool("echo", {
				access: true,
				scopes: false,
				inputSchema,
				outputSchema,
				workload: { capabilities: ["echo"] },
			}).handler(async ({ input }) => ({
				content: [],
				structuredContent: input,
			})),
		},
		config: { mcp: { stdio: { trustedMaintenance: true } } },
	});
	const options = {
		envelope: "opaque",
		authorizer: { authorize: async () => ({ context: "opaque" }) },
		contextBinder: {
			bind: async () => setup.app.createContext({ accessMode: "user" }),
		},
	};
	try {
		const human = await connect(
			await createMcpServer(setup.app, { transport: "stdio" }),
		);
		const workload = await connect(
			await createWorkloadMcpServer(setup.app, options),
		);
		try {
			const port = createWorkloadMcpToolPort(setup.app, options);
			const catalogs = [
				await human.client.listTools(),
				await workload.client.listTools(),
				await port.listCustomTools(),
			];
			for (const { tools } of catalogs) {
				const descriptor = tools[0];
				expect(descriptor.inputSchema.required).toEqual(["tags"]);
				const validate = new AjvJsonSchemaValidator().getValidator(
					descriptor.inputSchema,
				);
				for (const input of [
					{ tags: ["tag", 1] },
					{ tags: ["tag", 1], limit: 2 },
					{ tags: ["tag", "bad"] },
					{ tags: [1, "tag"] },
					{ tags: ["tag"] },
					{ tags: ["tag", 1, true] },
				]) {
					expect(validate(input).valid).toBe(
						inputSchema.safeParse(input).success,
					);
				}
				const validateOutput = new AjvJsonSchemaValidator().getValidator(
					descriptor.outputSchema!,
				);
				expect(validateOutput({ tags: ["tag", 1], limit: 10 }).valid).toBe(
					true,
				);
				expect(validateOutput({ tags: ["tag", "bad"], limit: 10 }).valid).toBe(
					false,
				);
				expect(validateOutput({ tags: ["tag", 1] }).valid).toBe(false);
			}
			for (const { client } of [human, workload]) {
				const result = await client.callTool({
					name: "echo",
					arguments: { tags: ["tag", 1] },
				});
				expect(result.isError).not.toBe(true);
				expect(result.structuredContent).toEqual({
					tags: ["tag", 1],
					limit: 10,
				});
				const invalid = await client.callTool({
					name: "echo",
					arguments: { tags: ["tag", "bad"] },
				});
				expect(invalid.isError).toBe(true);
			}
			expect(
				(
					await port.callCustomTool({
						name: "echo",
						input: { tags: ["tag", 1] },
					})
				).structuredContent,
			).toEqual({ tags: ["tag", 1], limit: 10 });
		} finally {
			await human.close();
			await workload.close();
		}
	} finally {
		await setup.cleanup();
	}
});
