import { describe, expect, it } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { collection, global } from "questpie";
import { z } from "zod";

import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder.js";
import {
	createMockUser,
	createTestContext,
} from "../../questpie/test/utils/test-context.js";
import {
	createMcpServer,
	createWorkloadMcpServer,
	mcpTool,
	mcpPrompts,
} from "../src/exports/index.js";
import { installSchemaDietListToolsHandler } from "../src/server/create-server.js";

async function connect(server: McpServer) {
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "catalog-budget-test", version: "1.0.0" });
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

const bytes = (value: unknown) =>
	new TextEncoder().encode(JSON.stringify(value)).byteLength;

describe("MCP catalog UTF-8 byte budget", () => {
	it("keeps complete CRUD catalogs within budget by referencing shared schemas", async () => {
		const collections = Object.fromEntries(
			["posts", "notes", "tasks"].map((name) => [
				name,
				collection(name).fields(({ f }) => ({ title: f.text(255).required() })),
			]),
		);
		const setup = await buildMockApp({
			collections,
			globals: {
				settings: global("settings").fields(({ f }) => ({
					title: f.text(255),
				})),
			},
		});
		try {
			const server = await createMcpServer(setup.app, {
				transport: "stdio",
				config: {
					stdio: { trustedMaintenance: true },
					crud: {
						collections: Object.fromEntries(
							["posts", "notes", "tasks"].map((name) => [
								name,
								{
									operations: {
										list: true,
										count: true,
										get: true,
										create: true,
										update: true,
										delete: true,
									},
								},
							]),
						),
						globals: { settings: { operations: { get: true, update: true } } },
					},
				},
			});
			const { client, close } = await connect(server);
			try {
				const result = await client.listTools();
				const expected = [
					...["posts", "notes", "tasks"].flatMap((name) =>
						["list", "count", "get", "create", "update", "delete"].map(
							(operation) => `collections.${name}.${operation}`,
						),
					),
					"globals.settings.get",
					"globals.settings.update",
				];
				expect(result.tools.map(({ name }) => name).sort()).toEqual(
					expected.sort(),
				);
				expect(bytes(result)).toBeLessThan(100_000);
				const list = result.tools.find(
					({ name }) => name === "collections.posts.list",
				);
				expect(list?.inputSchema.definitions).toBeDefined();
			} finally {
				await close();
			}
		} finally {
			await setup.cleanup();
		}
	});

	it.each(["development", "test", "production"])(
		"serves resources and prompts with zero OAuth-visible tools in %s",
		async (env) => {
			const originalEnv = process.env.NODE_ENV;
			const setup = await buildMockApp({
				mcpPrompts: {
					help: mcpPrompts("help", {
						access: true,
						scopes: false,
						list: async () => [{ name: "help" }],
						get: async () => ({ messages: [] }),
					}),
				},
				collections: Object.fromEntries(
					["locked", "open"].map((name) => [
						name,
						collection(name)
							.fields(({ f }) => ({ title: f.text(255) }))
							.access({ read: true }),
					]),
				),
				config: {
					mcp: {
						crud: {
							collections: {
								locked: { operations: { list: true } },
								open: { operations: { list: true } },
							},
						},
						resources: { collections: { open: true } },
					},
				},
			});
			const user = createMockUser();
			const ctx = createTestContext({
				accessMode: "user",
				principal: {
					kind: "oauth",
					user,
					clientId: "empty",
					scopes: [],
					tokenId: "empty",
				},
			});
			try {
				process.env.NODE_ENV = env;
				const server = await createMcpServer(setup.app, {
					transport: "http",
					ctx,
				});
				const { client, close } = await connect(server);
				try {
					expect(await client.listTools()).toEqual({ tools: [] });
					expect(
						(await client.listResources()).resources.length,
					).toBeGreaterThan(0);
					expect(
						(
							await client.readResource({
								uri: "questpie://schema/collections",
							})
						).contents.length,
					).toBe(1);
					expect((await client.listPrompts()).prompts).toEqual([
						{ name: "help" },
					]);
					expect((await client.getPrompt({ name: "help" })).messages).toEqual(
						[],
					);
				} finally {
					await close();
				}
			} finally {
				process.env.NODE_ENV = originalEnv;
				await setup.cleanup();
			}
		},
	);

	it.each([3, 4])(
		"fits %s collections with twelve fields without dropping read tools",
		async (count) => {
			const collections = Object.fromEntries(
				Array.from({ length: count }, (_, i) => [
					`c${i}`,
					collection(`c${i}`)
						.fields(({ f }) =>
							Object.fromEntries(
								Array.from({ length: 12 }, (_, j) => [
									`field${j}`,
									f.text(255),
								]),
							),
						)
						.access({ read: true }),
				]),
			);
			const setup = await buildMockApp({
				collections,
				config: {
					mcp: {
						crud: {
							collections: Object.fromEntries(
								Object.keys(collections).map((name) => [
									name,
									{ operations: { list: true, count: true, get: true } },
								]),
							),
						},
					},
				},
			});
			try {
				const server = await createMcpServer(setup.app, {
					transport: "http",
					ctx: createTestContext({
						accessMode: "user",
						principal: {
							kind: "oauth",
							user: createMockUser(),
							clientId: "read",
							tokenId: "read",
							scopes: ["collections:read"],
						},
					}),
				});
				const { client, close } = await connect(server);
				try {
					const result = await client.listTools();
					expect(result.tools.length).toBe(count * 3);
					expect(bytes(result)).toBeLessThan(85_000);
				} finally {
					await close();
				}
			} finally {
				await setup.cleanup();
			}
		},
	);

	it("rejects a discovery cursor as InvalidParams", async () => {
		const server = new McpServer({ name: "cursor", version: "1" });
		server.registerTool("read", { inputSchema: z.object({}) }, async () => ({
			content: [],
		}));
		installSchemaDietListToolsHandler(server);
		const { client, close } = await connect(server);
		try {
			await expect(
				client.listTools({ cursor: "invalid" }),
			).rejects.toMatchObject({ code: -32602 });
		} finally {
			await close();
		}
	});

	it("rejects invalid or relaxed thresholds and includes the empty result wrapper in a stricter budget", async () => {
		const setup = await buildMockApp({});
		try {
			for (const maxCatalogBytes of [0, -1, 1.5, NaN, Infinity, 100_001]) {
				await expect(
					createMcpServer(setup.app, {
						config: { execution: { maxCatalogBytes } },
					}),
				).rejects.toThrow(/Invalid MCP execution limit: maxCatalogBytes/);
			}
			for (const [maximum, fits] of [
				[13, true],
				[12, false],
			] as const) {
				const server = await createMcpServer(setup.app, {
					config: { execution: { maxCatalogBytes: maximum } },
				});
				const { client, close } = await connect(server);
				try {
					if (fits) expect(await client.listTools()).toEqual({ tools: [] });
					else
						await expect(client.listTools()).rejects.toThrow(
							/12 UTF-8 bytes; must be < 12/,
						);
				} finally {
					await close();
				}
			}
		} finally {
			await setup.cleanup();
		}
	});

	it("bounds the diagnostic to the five largest contributors without reordering the catalog", async () => {
		const server = new McpServer({ name: "contributors", version: "1" });
		const tools = Array.from({ length: 8 }, (_, index) =>
			server.registerTool(
				`tool-${index}`,
				{
					description: "x".repeat(20_000 + index),
					inputSchema: z.object({}),
				},
				async () => ({ content: [] }),
			),
		);
		installSchemaDietListToolsHandler(server);
		const { client, close } = await connect(server);
		try {
			let message = "";
			try {
				await client.listTools();
			} catch (error) {
				message = (error as Error).message;
			}
			expect(message.match(/tool-\d=/g)).toEqual([
				"tool-7=",
				"tool-6=",
				"tool-5=",
				"tool-4=",
				"tool-3=",
			]);
			expect(message.length).toBeLessThan(1_000);
			for (const tool of tools) tool.update({ description: "" });
			expect((await client.listTools()).tools.map(({ name }) => name)).toEqual(
				tools.map((_, index) => `tool-${index}`),
			);
		} finally {
			await close();
		}
	});

	it("budgets authorized workload discovery as a whole without changing authority or the order of other tools", async () => {
		let allowLarge = false;
		const setup = await buildMockApp({
			mcpTools: Object.fromEntries(
				["first", "large", "last"].map((name) => [
					name,
					mcpTool(name, {
						access: true,
						scopes: false,
						description: name === "large" ? "a".repeat(86_000) : name,
						inputSchema: z.object({ id: z.uuid() }),
						outputSchema: z.object({ value: z.string() }),
						workload: { capabilities: ["tasks.read"] },
					}).handler(async () => ({ content: [] })),
				]),
			),
		});
		const options = {
			envelope: { secret: "private-envelope" },
			authorizer: {
				authorize: async ({ tool }: { tool: { name: string } }) =>
					tool.name !== "large" || allowLarge
						? { context: "private-authorization" }
						: null,
			},
			contextBinder: {
				bind: async () => setup.app.createContext({ accessMode: "user" }),
			},
		};
		const server = await createWorkloadMcpServer(setup.app, {
			...options,
			config: { execution: { maxCatalogBytes: 85_000 } },
		});
		const { client, close } = await connect(server);
		try {
			expect((await client.listTools()).tools.map(({ name }) => name)).toEqual([
				"first",
				"last",
			]);
			await expect(
				client.listTools({ cursor: "invalid" }),
			).rejects.toMatchObject({ code: -32602 });
			allowLarge = true;
			await expect(client.listTools()).rejects.toThrow(
				/catalog byte budget exceeded.*85000/i,
			);
			const defaultServer = await createWorkloadMcpServer(setup.app, options);
			const normal = await connect(defaultServer);
			try {
				const result = await normal.client.listTools();
				expect(result.tools.map(({ name }) => name)).toEqual([
					"first",
					"large",
					"last",
				]);
				expect(bytes(result)).toBeGreaterThan(85_000);
				expect(bytes(result)).toBeLessThan(100_000);
			} finally {
				await normal.close();
			}
			allowLarge = false;
			expect((await client.listTools()).tools.map(({ name }) => name)).toEqual([
				"first",
				"last",
			]);
		} finally {
			await close();
			await setup.cleanup();
		}
	});

	it("counts UTF-8 bytes in output schemas and emits a bounded diagnostic without schema or metadata contents", async () => {
		const server = new McpServer({ name: "unicode", version: "1" });
		server.registerTool(
			"unicode-output",
			{
				description: "private-description",
				inputSchema: z.object({
					value: z.string().describe("private-input-schema"),
				}),
				outputSchema: z.object({
					value: z.string().describe("📚".repeat(25_000)),
				}),
				_meta: { private: "private-tool-metadata" },
			},
			async () => ({ content: [] }),
		);
		const { client, close } = await connect(server);
		try {
			const raw = await client.listTools();
			expect(JSON.stringify(raw).length).toBeLessThan(100_000);
			expect(bytes(raw)).toBeGreaterThan(100_000);
			installSchemaDietListToolsHandler(server);
			let message = "";
			try {
				await client.listTools();
			} catch (error) {
				message = (error as Error).message;
			}
			expect(message).toContain("catalog byte budget exceeded");
			expect(message).toContain("unicode-output=");
			expect(message).toContain("No tools were dropped");
			expect(message.length).toBeLessThan(1_000);
			expect(message).not.toContain("private-");
			expect(message).not.toContain("📚");
		} finally {
			await close();
		}
	});

	it.each(["wrapper metadata", "pagination", "terminal page cursor"])(
		"cannot evade the whole-catalog policy through %s",
		async (mode) => {
			const server = new McpServer({ name: "wrapper", version: "1" });
			server.registerTool("read", { inputSchema: z.object({}) }, async () => ({
				content: [],
			}));
			const { client, close } = await connect(server);
			try {
				const initial = await client.listTools();
				server.server.setRequestHandler(ListToolsRequestSchema, () => ({
					...initial,
					...(mode === "pagination"
						? { nextCursor: "private-cursor" }
						: mode === "wrapper metadata"
							? { _meta: { payload: "x".repeat(100_000) } }
							: {}),
				}));
				installSchemaDietListToolsHandler(server);
				await expect(
					client.listTools(
						mode === "terminal page cursor"
							? { cursor: "private-cursor" }
							: undefined,
					),
				).rejects.toThrow(
					mode === "wrapper metadata"
						? /catalog byte budget exceeded/
						: /complete tools\/list/,
				);
			} finally {
				await close();
			}
		},
	);

	it("supports a stricter app margin against the final SDK diet, with required input and output schemas intact", async () => {
		const setup = await buildMockApp({
			mcpTools: {
				read: mcpTool("tasks.read", {
					access: true,
					scopes: false,
					title: "Read 📚",
					description: "a".repeat(84_000),
					inputSchema: z.object({ id: z.uuid() }),
					outputSchema: z.object({ value: z.string() }),
					annotations: { readOnlyHint: true },
					_meta: { display: "📚" },
				}).handler(async () => ({ content: [] })),
			},
		});
		const server = await createMcpServer(setup.app);
		const { client, close } = await connect(server);
		try {
			const result = await client.listTools();
			const exactBytes = bytes(result);
			expect(exactBytes).toBeLessThan(85_000);
			expect(result.tools[0].inputSchema).toMatchObject({ required: ["id"] });
			expect(result.tools[0].inputSchema.$schema).toBe(
				"http://json-schema.org/draft-07/schema#",
			);
			expect(result.tools[0].outputSchema).toMatchObject({
				required: ["value"],
			});
			// The exact final byte count is exclusive. This also catches checks
			// against raw, undieted SDK schemas, which would reject exactBytes + 1.
			for (const [maximum, fits] of [
				[exactBytes + 1, true],
				[exactBytes, false],
			] as const) {
				const bounded = await createMcpServer(setup.app, {
					config: { execution: { maxCatalogBytes: maximum } },
				});
				const connection = await connect(bounded);
				try {
					if (fits) expect(await connection.client.listTools()).toEqual(result);
					else
						await expect(connection.client.listTools()).rejects.toThrow(
							/catalog byte budget exceeded/i,
						);
				} finally {
					await connection.close();
				}
			}
		} finally {
			await close();
			await setup.cleanup();
		}
	});

	it("returns the complete final catalog at 99,999 bytes and rejects exactly 100,000 without dropping tools", async () => {
		const server = new McpServer({ name: "budget", version: "1" });
		const large = server.registerTool(
			"large",
			{
				description: "",
				inputSchema: z.object({ id: z.uuid() }),
				outputSchema: z.object({ value: z.string() }),
				annotations: { readOnlyHint: true },
				_meta: { display: "📚" },
			},
			async () => ({ content: [] }),
		);
		server.registerTool("small", { inputSchema: z.object({}) }, async () => ({
			content: [],
		}));
		installSchemaDietListToolsHandler(server);
		const { client, close } = await connect(server);
		try {
			const initial = await client.listTools();
			const padding = "a".repeat(99_999 - bytes(initial));
			large.update({ description: padding });
			const below = await client.listTools();
			expect(bytes(below)).toBe(99_999);
			expect(below.tools.map(({ name }) => name)).toEqual(["large", "small"]);
			expect(below.tools[0].outputSchema?.properties).toHaveProperty("value");
			large.update({ description: `${padding}a` });
			await expect(client.listTools()).rejects.toThrow(
				/catalog.*100000.*100000/i,
			);
			large.update({ description: "" });
			expect((await client.listTools()).tools.map(({ name }) => name)).toEqual([
				"large",
				"small",
			]);
		} finally {
			await close();
		}
	});
});
