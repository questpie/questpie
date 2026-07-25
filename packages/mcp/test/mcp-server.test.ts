import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { collection, global, route, starterModule } from "questpie";
import { z } from "zod";

import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder.js";
import { createTestContext } from "../../questpie/test/utils/test-context.js";
import { runTestDbMigrations } from "../../questpie/test/utils/test-db.js";
import { createMcpServer, mcpTool } from "../src/exports/index.js";
import { mcpOAuthScopeCatalog } from "../src/server/oauth-scope-catalog.js";

const posts = collection("posts")
	.fields(({ f }) => ({
		title: f.text(255).required(),
		published: f.boolean().default(false),
		scheduledAt: f.datetime(),
		secret: f.text(255),
	}))
	.access({ read: true, create: true, update: true, delete: true });

const privateNotes = collection("privateNotes")
	.fields(({ f }) => ({
		title: f.text(255).required(),
	}))
	.access({
		read: ({ session }) => !!session,
		create: ({ session }) => !!session,
		update: ({ session }) => !!session,
		delete: ({ session }) => !!session,
	});

const siteSettings = global("siteSettings")
	.fields(({ f }) => ({
		siteName: f.text(255).required(),
		privateToken: f.text(255),
	}))
	.access({ read: true, update: true });

let reportRouteAllowed = true;

const reportRoute = route()
	.post()
	.access(() => reportRouteAllowed)
	.schema(z.object({ period: z.enum(["day", "week"]) }))
	.outputSchema(z.object({ period: z.enum(["day", "week"]), ok: z.boolean() }))
	.meta({
		title: "Generate report",
		description: "Generate a sales report.",
		mcp: {
			expose: true,
			name: "reports.generate",
			annotations: { readOnlyHint: true },
		},
	})
	.handler(async ({ input }) => ({ period: input.period, ok: true }));

const reportRouteWithParams = route()
	.post()
	.params<{ id: string }>()
	.schema(z.object({ period: z.enum(["day", "week"]) }))
	.meta({
		title: "Generate report by id",
		mcp: { expose: true },
	})
	.handler(async ({ input, params }) => ({
		id: params.id,
		period: input.period,
	}));

const unannotatedRoute = route()
	.post()
	.schema(z.object({ ok: z.boolean() }))
	.handler(async ({ input }) => input);

const rawAnnotatedRoute = route()
	.post()
	.raw()
	.meta({ mcp: { expose: true, name: "raw.exposed" } })
	.handler(async () => Response.json({ ok: true }));

const deniedRoute = route()
	.post()
	.schema(z.object({ ok: z.boolean() }))
	.access(false)
	.meta({ mcp: { expose: true } })
	.handler(async ({ input }) => input);

const dateRoute = route()
	.post()
	.schema(z.object({ at: z.coerce.date() }))
	.outputSchema(z.object({ iso: z.string() }))
	.meta({ mcp: { expose: true, name: "dates.parse" } })
	.handler(async ({ input }) => ({ iso: input.at.toISOString() }));

const echoTool = mcpTool("custom.echo", {
	access: true,
	scopes: false,
	description: "Echo a message.",
	inputSchema: z.object({ message: z.string() }),
}).handler(async ({ input }) => ({
	structuredContent: { message: input.message },
	content: [{ type: "text", text: input.message }],
}));

const dateTool = mcpTool("custom.date", {
	access: true,
	scopes: false,
	description: "Parse a date.",
	inputSchema: z.object({ at: z.coerce.date() }),
}).handler(async ({ input }) => ({
	structuredContent: { iso: input.at.toISOString() },
	content: [{ type: "text", text: input.at.toISOString() }],
}));

let guardedToolAllowed = true;

const guardedTool = mcpTool("custom.guarded", {
	description: "Guarded custom tool.",
	inputSchema: z.object({ message: z.string() }),
	access: () => guardedToolAllowed,
	scopes: false,
}).handler(async ({ input }) => ({
	structuredContent: { message: input.message },
	content: [{ type: "text", text: input.message }],
}));

const requestHeaderTool = mcpTool("custom.request-header", {
	description: "Return a request header.",
	inputSchema: z.object({}),
	access: ({ ctx }) =>
		(ctx as any).request?.headers.get("x-mcp-test") === "present",
	scopes: false,
}).handler(async ({ ctx }) => ({
	structuredContent: {
		header: (ctx as any).request?.headers.get("x-mcp-test"),
	},
	content: [
		{
			type: "text",
			text: (ctx as any).request?.headers.get("x-mcp-test") ?? "",
		},
	],
}));

const principalTool = mcpTool("custom.principal", {
	description: "Return the authenticated principal.",
	inputSchema: z.object({}),
	access: ({ ctx }) => typeof ctx.session?.user?.id === "string",
	scopes: false,
}).handler(async ({ ctx }) => ({
	structuredContent: {
		userId: ctx.session?.user.id,
	},
	content: [{ type: "text", text: ctx.session?.user.id ?? "" }],
}));

async function connect(server: McpServer) {
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "questpie-test", version: "1.0.0" });
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

describe("@questpie/mcp server", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		guardedToolAllowed = true;
		reportRouteAllowed = true;
		setup = await buildMockApp({
			collections: { posts, privateNotes },
			globals: { siteSettings },
			routes: {
				"reports/generate:POST": reportRoute,
				"reports/[id]:POST": reportRouteWithParams,
				"reports/unannotated:POST": unannotatedRoute,
				"reports/raw:POST": rawAnnotatedRoute,
				"reports/denied:POST": deniedRoute,
				"dates/parse:POST": dateRoute,
			},
			mcpTools: {
				echo: echoTool,
				date: dateTool,
				guarded: guardedTool,
				requestHeader: requestHeaderTool,
			},
			config: {
				mcp: {
					crud: {
						collections: {
							posts: {
								operations: {
									list: true,
									count: true,
									get: true,
									create: true,
									update: true,
									delete: true,
								},
							},
							privateNotes: {
								operations: {
									list: true,
									count: true,
									get: true,
									create: true,
									update: true,
								},
							},
						},
						globals: {
							siteSettings: {
								operations: { get: true, update: true },
							},
						},
					},
					routes: {
						routes: {
							"reports/generate": { operations: { execute: true } },
							"reports/[id]": { operations: { execute: true } },
							"reports/denied": { operations: { execute: true } },
							"dates/parse": { operations: { execute: true } },
						},
					},
					resources: {
						collections: { posts: true, privateNotes: true },
						globals: { siteSettings: true },
						routes: {
							"reports/generate": true,
							"reports/[id]": true,
							"reports/denied": true,
							"dates/parse": true,
						},
					},
				},
			},
		});
		await runTestDbMigrations(setup.app);
		await setup.app.collections.posts.create(
			{ title: "Hello", published: true, secret: "seed-secret" },
			createTestContext({ accessMode: "system" }),
		);
		await setup.app.globals.siteSettings.update(
			{ siteName: "Questpie", privateToken: "seed-token" },
			createTestContext({ accessMode: "system" }),
		);
	}, 30000);

	afterEach(async () => {
		await setup?.cleanup();
	});

	it("exposes nothing when named MCP policy is omitted", async () => {
		const omitted = await buildMockApp({
			collections: { posts },
			globals: { siteSettings },
			routes: { "reports/generate:POST": reportRoute },
		});
		try {
			const server = await createMcpServer(omitted.app, {
				transport: "http",
			});
			const { client, close } = await connect(server);
			try {
				expect((await client.listTools()).tools).toEqual([]);
				expect(client.getServerCapabilities()?.resources).toBeUndefined();
			} finally {
				await close();
			}
		} finally {
			await omitted.cleanup();
		}
	});

	it("reuses the immutable OAuth release snapshot for later server calls", async () => {
		const mutableToolConfig = {
			access: true,
			scopes: "custom:frozen:invoke",
		};
		const frozenTool = mcpTool("custom.frozen", mutableToolConfig).handler(
			async () => ({ content: [{ type: "text", text: "frozen" }] }),
		);
		const local = await buildMockApp({
			collections: { posts },
			mcpTools: { frozenTool },
			config: {
				mcp: {
					crud: {
						collections: { posts: { operations: { list: true } } },
					},
				},
			},
		});

		const advertised = mcpOAuthScopeCatalog(local.app as never);
		mutableToolConfig.access = false;
		mutableToolConfig.scopes = "custom:mutated:invoke";
		(
			local.app.state!.config!.mcp!.crud!.collections!.posts as {
				operations: Record<string, boolean>;
			}
		).operations.delete = true;

		const server = await createMcpServer(local.app);
		const { client, close } = await connect(server);
		try {
			expect(advertised.scopes).toContain("custom:frozen:invoke");
			expect(advertised.scopes).not.toContain("custom:mutated:invoke");
			expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
				["collections.posts.list", "custom.frozen"],
			);
			expect(
				(
					await client.callTool({
						name: "custom.frozen",
						arguments: {},
					})
				).isError,
			).toBeUndefined();
		} finally {
			await close();
			await local.cleanup();
		}
	});

	it("fails closed when a route and custom tool resolve to the same name", async () => {
		const duplicateTool = mcpTool("reports.generate", {
			access: true,
			scopes: false,
		}).handler(async () => ({ content: [] }));
		const collision = await buildMockApp({
			routes: { "reports/generate:POST": reportRoute },
			mcpTools: { duplicateTool },
			config: {
				mcp: {
					routes: {
						routes: {
							"reports/generate": { operations: { execute: true } },
						},
					},
				},
			},
		});
		try {
			await expect(
				createMcpServer(collision.app, { transport: "http" }),
			).rejects.toThrow("Duplicate MCP tool name");
		} finally {
			await collision.cleanup();
		}
	});

	it("handles JSON-RPC initialize plus tool and resource discovery", async () => {
		const server = await createMcpServer(setup.app, { transport: "http" });
		const { client, close } = await connect(server);

		try {
			const tools = await client.listTools();
			const toolNames = tools.tools.map((tool) => tool.name).sort();

			expect(toolNames).toContain("collections.posts.list");
			expect(toolNames).toContain("collections.posts.create");
			expect(toolNames).toContain("globals.siteSettings.get");
			expect(toolNames).toContain("reports.generate");
			expect(toolNames).toContain("routes.reports.id");
			expect(toolNames).toContain("dates.parse");
			expect(toolNames).toContain("custom.echo");
			expect(toolNames).toContain("custom.date");
			expect(toolNames).not.toContain("collections.privateNotes.list");
			expect(toolNames).not.toContain("routes.reports.unannotated");
			expect(toolNames).not.toContain("raw.exposed");
			expect(toolNames).not.toContain("routes.reports.denied");

			const resources = await client.listResources();
			const resourceUris = resources.resources.map((resource) => resource.uri);
			expect(resourceUris).toContain("questpie://schema/collections");
			expect(resourceUris).toContain("questpie://schema/globals");
			expect(resourceUris).toContain("questpie://schema/routes");
			expect(resourceUris).toContain("questpie://schema/collections/posts");
			expect(resourceUris).not.toContain(
				"questpie://schema/collections/privateNotes",
			);
		} finally {
			await close();
		}
	});

	it("resolves Better Auth request sessions for programmatic HTTP MCP tools", async () => {
		const authSetup = await buildMockApp(
			{
				modules: [starterModule],
				auth: {
					emailAndPassword: {
						enabled: true,
						requireEmailVerification: false,
					},
				},
				mcpTools: {
					principal: principalTool,
				},
			},
			{
				secret: "test-auth-secret-with-more-than-32-chars",
			},
		);

		try {
			await runTestDbMigrations(authSetup.app);
			const signUpResponse = await authSetup.app.auth.api.signUpEmail({
				body: {
					email: "mcp-principal@example.test",
					password: "password123",
					name: "MCP Principal",
				},
				asResponse: true,
			});
			const signUpBody = await signUpResponse.json();
			const sessionCookie = signUpResponse.headers
				.get("set-cookie")
				?.split(";")[0];
			expect(sessionCookie).toBeTruthy();

			const server = await createMcpServer(authSetup.app, {
				transport: "http",
				request: new Request("http://localhost/api/mcp", {
					headers: { cookie: sessionCookie! },
				}),
			});
			const { client, close } = await connect(server);

			try {
				const tools = await client.listTools();
				expect(tools.tools.map((tool) => tool.name)).toContain(
					"custom.principal",
				);

				const result = await client.callTool({
					name: "custom.principal",
					arguments: {},
				});
				expect(result.isError).toBeUndefined();
				expect(result.structuredContent).toEqual({
					userId: signUpBody.user.id,
				});
			} finally {
				await close();
			}
		} finally {
			await authSetup.cleanup();
		}
	});

	it("executes generated collection CRUD tools", async () => {
		const server = await createMcpServer(setup.app, { transport: "http" });
		const { client, close } = await connect(server);

		try {
			const listResult = await client.callTool({
				name: "collections.posts.list",
				arguments: { limit: 10 },
			});
			expect(listResult.isError).toBeUndefined();
			expect((listResult.structuredContent as any).docs[0].title).toBe("Hello");

			const countResult = await client.callTool({
				name: "collections.posts.count",
				arguments: {},
			});
			expect(countResult.structuredContent).toEqual({ value: 1 });

			const createResult = await client.callTool({
				name: "collections.posts.create",
				arguments: { data: { title: "Created", published: false } },
			});
			expect(createResult.isError).toBeUndefined();
			const createdId = (createResult.structuredContent as any).id;
			expect(typeof createdId).toBe("string");

			const getResult = await client.callTool({
				name: "collections.posts.get",
				arguments: { id: createdId },
			});
			expect((getResult.structuredContent as any).title).toBe("Created");

			const updateResult = await client.callTool({
				name: "collections.posts.update",
				arguments: {
					id: createdId,
					data: { title: "Updated", published: true },
				},
			});
			expect((updateResult.structuredContent as any).title).toBe("Updated");

			const deleteResult = await client.callTool({
				name: "collections.posts.delete",
				arguments: { id: createdId },
			});
			expect((deleteResult.structuredContent as any).success).toBe(true);
		} finally {
			await close();
		}
	});

	it("executes generated global CRUD tools", async () => {
		const server = await createMcpServer(setup.app, { transport: "http" });
		const { client, close } = await connect(server);

		try {
			const getResult = await client.callTool({
				name: "globals.siteSettings.get",
				arguments: {},
			});
			expect((getResult.structuredContent as any).siteName).toBe("Questpie");

			const updateResult = await client.callTool({
				name: "globals.siteSettings.update",
				arguments: { data: { siteName: "Updated Site" } },
			});
			expect((updateResult.structuredContent as any).siteName).toBe(
				"Updated Site",
			);
		} finally {
			await close();
		}
	});

	it("executes annotated JSON route tools including path params", async () => {
		const server = await createMcpServer(setup.app, { transport: "http" });
		const { client, close } = await connect(server);

		try {
			const routeResult = await client.callTool({
				name: "reports.generate",
				arguments: { period: "day" },
			});
			expect(routeResult.structuredContent).toEqual({
				period: "day",
				ok: true,
			});

			const paramRouteResult = await client.callTool({
				name: "routes.reports.id",
				arguments: {
					params: { id: "sales" },
					input: { period: "week" },
				},
			});
			expect(paramRouteResult.structuredContent).toEqual({
				id: "sales",
				period: "week",
			});

			const extraParamResult = await client.callTool({
				name: "routes.reports.id",
				arguments: {
					params: { id: "sales", forged: "value" },
					input: { period: "week" },
				},
			});
			expect(extraParamResult.isError).toBe(true);

			const extraWrapperResult = await client.callTool({
				name: "routes.reports.id",
				arguments: {
					params: { id: "sales" },
					input: { period: "week" },
					forged: "value",
				},
			});
			expect(extraWrapperResult.isError).toBe(true);

			const dateRouteResult = await client.callTool({
				name: "dates.parse",
				arguments: { at: "2026-05-08T12:00:00.000Z" },
			});
			expect(dateRouteResult.structuredContent).toEqual({
				iso: "2026-05-08T12:00:00.000Z",
			});
		} finally {
			await close();
		}
	});

	it("rechecks ordinary route access after discovery", async () => {
		const server = await createMcpServer(setup.app, { transport: "http" });
		const { client, close } = await connect(server);
		try {
			expect(
				(await client.listTools()).tools.map((tool) => tool.name),
			).toContain("reports.generate");
			reportRouteAllowed = false;
			const result = await client.callTool({
				name: "reports.generate",
				arguments: { period: "day" },
			});
			expect(result.isError).toBe(true);
		} finally {
			reportRouteAllowed = true;
			await close();
		}
	});

	it("executes custom mcp-tools", async () => {
		const server = await createMcpServer(setup.app, { transport: "http" });
		const { client, close } = await connect(server);

		try {
			const customResult = await client.callTool({
				name: "custom.echo",
				arguments: { message: "pong" },
			});
			expect(customResult.structuredContent).toEqual({ message: "pong" });

			const dateResult = await client.callTool({
				name: "custom.date",
				arguments: { at: "2026-05-08T12:00:00.000Z" },
			});
			expect(dateResult.structuredContent).toEqual({
				iso: "2026-05-08T12:00:00.000Z",
			});
		} finally {
			await close();
		}
	});

	it("redacts raw custom tool failures from protocol responses", async () => {
		const secretFailure = mcpTool("custom.secret-failure", {
			access: true,
			scopes: false,
		}).handler(async () => {
			throw new Error("postgres://user:password@internal/database");
		});
		const local = await buildMockApp({
			mcpTools: { secretFailure },
		});
		const server = await createMcpServer(local.app);
		const { client, close } = await connect(server);
		try {
			const result = await client.callTool({
				name: "custom.secret-failure",
				arguments: {},
			});
			expect(result.isError).toBe(true);
			expect(JSON.stringify(result)).not.toContain("password");
			expect(result.content).toEqual([
				{ type: "text", text: "MCP operation failed" },
			]);
			expect(result["_meta"]).toEqual({
				"questpie/error": {
					code: "internal",
					correlationId: expect.any(String),
				},
			});
		} finally {
			await close();
			await local.cleanup();
		}
	});

	it("reads schema resources and filters them through MCP and QUESTPIE policy", async () => {
		const server = await createMcpServer(setup.app, { transport: "http" });
		const { client, close } = await connect(server);

		try {
			const schema = await client.readResource({
				uri: "questpie://schema/collections/posts",
			});
			const parsed = JSON.parse(schema.contents[0].text!);
			expect(parsed.name).toBe("posts");

			const collections = await client.readResource({
				uri: "questpie://schema/collections",
			});
			const parsedCollections = JSON.parse(collections.contents[0].text!);
			expect(parsedCollections.map((item: any) => item.name)).toEqual([
				"posts",
			]);

			await expect(
				client.readResource({
					uri: "questpie://schema/collections/privateNotes",
				}),
			).rejects.toThrow();
		} finally {
			await close();
		}
	});

	it("applies field policy exactly to mutations, recursive queries, outputs, and resources", async () => {
		const server = await createMcpServer(setup.app, {
			transport: "http",
			config: {
				crud: {
					collections: {
						posts: {
							operations: {
								list: true,
								count: true,
								get: true,
								create: true,
								update: true,
								delete: true,
							},
							fields: { include: ["title", "published"] },
						},
					},
					globals: {
						siteSettings: {
							operations: { get: true, update: true },
							fields: { exclude: ["privateToken"] },
						},
					},
				},
			},
		});
		const { client, close } = await connect(server);

		try {
			for (const [name, args] of [
				[
					"collections.posts.create",
					{
						data: {
							title: "Rejected",
							published: true,
							secret: "must-reject",
						},
					},
				],
				["collections.posts.count", { where: { secret: "oracle" } }],
				["collections.posts.list", { where: { AND: [{ secret: "oracle" }] } }],
				["collections.posts.list", { sort: { secret: "asc" } }],
				["collections.posts.list", { columns: { secret: true } }],
				["collections.posts.list", { with: { secret: true } }],
			] as const) {
				expect((await client.callTool({ name, arguments: args })).isError).toBe(
					true,
				);
			}

			const createResult = await client.callTool({
				name: "collections.posts.create",
				arguments: {
					data: {
						title: "Filtered",
						published: true,
					},
				},
			});
			expect(createResult.isError).toBeUndefined();
			expect((createResult.structuredContent as any).title).toBe("Filtered");
			expect((createResult.structuredContent as any).secret).toBeUndefined();

			const stored = await setup.app.collections.posts.findOne(
				{ where: { title: "Filtered" } },
				createTestContext({ accessMode: "system" }),
			);
			expect((stored as any).secret).toBeNull();

			const rejectedUpdate = await client.callTool({
				name: "collections.posts.update",
				arguments: {
					id: (stored as any).id,
					data: { title: "Filtered update", secret: "still-not-store" },
				},
			});
			expect(rejectedUpdate.isError).toBe(true);
			const updateResult = await client.callTool({
				name: "collections.posts.update",
				arguments: {
					id: (stored as any).id,
					data: { title: "Filtered update" },
				},
			});
			expect((updateResult.structuredContent as any).secret).toBeUndefined();

			const storedAfterUpdate = await setup.app.collections.posts.findOne(
				{ where: { id: (stored as any).id } },
				createTestContext({ accessMode: "system" }),
			);
			expect((storedAfterUpdate as any).secret).not.toBe("still-not-store");

			const listResult = await client.callTool({
				name: "collections.posts.list",
				arguments: { limit: 10 },
			});
			expect((listResult.structuredContent as any).docs[0].title).toBe("Hello");
			expect(
				(listResult.structuredContent as any).docs[0].secret,
			).toBeUndefined();

			const rejectedGlobal = await client.callTool({
				name: "globals.siteSettings.update",
				arguments: {
					data: { siteName: "Filtered Site", privateToken: "new-token" },
				},
			});
			expect(rejectedGlobal.isError).toBe(true);
			const globalResult = await client.callTool({
				name: "globals.siteSettings.update",
				arguments: {
					data: { siteName: "Filtered Site" },
				},
			});
			expect((globalResult.structuredContent as any).siteName).toBe(
				"Filtered Site",
			);
			expect(
				(globalResult.structuredContent as any).privateToken,
			).toBeUndefined();
			const storedGlobal = await setup.app.globals.siteSettings.get(
				{},
				createTestContext({ accessMode: "system" }),
			);
			expect((storedGlobal as any).privateToken).toBe("seed-token");

			const collectionSchema = await client.readResource({
				uri: "questpie://schema/collections/posts",
			});
			const parsedCollection = JSON.parse(collectionSchema.contents[0].text!);
			expect(Object.keys(parsedCollection.fields)).toEqual([
				"title",
				"published",
			]);

			const globalSchema = await client.readResource({
				uri: "questpie://schema/globals/siteSettings",
			});
			const parsedGlobal = JSON.parse(globalSchema.contents[0].text!);
			expect(Object.keys(parsedGlobal.fields)).toEqual(["siteName"]);
		} finally {
			await close();
		}
	});

	it("exposes field-derived create, update, and global schemas through tools/list", async () => {
		const server = await createMcpServer(setup.app, {
			transport: "http",
			config: {
				crud: {
					collections: {
						posts: {
							operations: {
								list: true,
								count: true,
								get: true,
								create: true,
								update: true,
							},
							fields: { include: ["title", "published"] },
						},
					},
					globals: {
						siteSettings: {
							operations: { get: true, update: true },
							fields: { exclude: ["privateToken"] },
						},
					},
				},
			},
		});
		const { client, close } = await connect(server);

		try {
			const tools = await client.listTools();
			const createTool = tools.tools.find(
				(tool) => tool.name === "collections.posts.create",
			);
			const updateTool = tools.tools.find(
				(tool) => tool.name === "collections.posts.update",
			);
			const globalUpdateTool = tools.tools.find(
				(tool) => tool.name === "globals.siteSettings.update",
			);

			const createSchema = JSON.stringify(createTool?.inputSchema);
			const updateSchema = JSON.stringify(updateTool?.inputSchema);
			const globalSchema = JSON.stringify(globalUpdateTool?.inputSchema);
			expect(createSchema).toContain("title");
			expect(createSchema).toContain("published");
			expect(createSchema).not.toContain("secret");
			expect(updateSchema).toContain("title");
			expect(updateSchema).not.toContain("secret");
			expect(globalSchema).toContain("siteName");
			expect(globalSchema).not.toContain("privateToken");
		} finally {
			await close();
		}
	});

	it("includes route JSON schemas in resources and honors route policy", async () => {
		const server = await createMcpServer(setup.app, {
			transport: "http",
			config: {
				routes: {
					routes: {
						"reports/[id]": false,
					},
				},
			},
		});
		const { client, close } = await connect(server);

		try {
			const routesResource = await client.readResource({
				uri: "questpie://schema/routes",
			});
			const routes = JSON.parse(routesResource.contents[0].text!);
			expect(routes.map((item: any) => item.key)).toContain("reports/generate");
			expect(routes.map((item: any) => item.key)).not.toContain("reports/[id]");
			expect(routes.map((item: any) => item.key)).not.toContain(
				"reports/denied",
			);

			const routeResource = await client.readResource({
				uri: `questpie://schema/routes/${encodeURIComponent("reports/generate")}`,
			});
			const routeSchema = JSON.parse(routeResource.contents[0].text!);
			expect(routeSchema.inputSchema.properties.period.enum).toEqual([
				"day",
				"week",
			]);
			expect(routeSchema.outputSchema.properties.ok.type).toBe("boolean");
		} finally {
			await close();
		}
	});

	it("can disable annotated route resources globally", async () => {
		const server = await createMcpServer(setup.app, {
			transport: "http",
			config: {
				resources: {
					routes: {
						"reports/generate": false,
						"reports/[id]": false,
						"reports/denied": false,
						"dates/parse": false,
					},
				},
			},
		});
		const { client, close } = await connect(server);

		try {
			expect(
				(await client.listResources()).resources.map(
					(resource) => resource.uri,
				),
			).not.toContain("questpie://schema/routes");
			await expect(
				client.readResource({ uri: "questpie://schema/routes" }),
			).rejects.toThrow();
		} finally {
			await close();
		}
	});

	it("rejects stdio without an explicit authority", async () => {
		await expect(
			createMcpServer(setup.app, { transport: "stdio" }),
		).rejects.toThrow("explicit authority");
		await expect(
			createMcpServer(setup.app, {
				transport: "stdio",
				accessMode: "system",
			}),
		).rejects.toThrow("explicit authority");
		await expect(
			createMcpServer(setup.app, {
				transport: "stdio",
				ctx: createTestContext({ accessMode: "system" }),
			}),
		).rejects.toThrow("explicit authority");
	});

	it("uses stdio policy defaults only in explicit trusted-maintenance mode", async () => {
		const server = await createMcpServer(setup.app, {
			transport: "stdio",
			config: { stdio: { trustedMaintenance: true } },
		});
		const { client, close } = await connect(server);

		try {
			const tools = await client.listTools();
			const toolNames = tools.tools.map((tool) => tool.name);

			expect(toolNames).toContain("collections.posts.delete");
			expect(toolNames).toContain("globals.siteSettings.update");
			expect(toolNames).toContain("collections.privateNotes.list");

			const privateList = await client.callTool({
				name: "collections.privateNotes.list",
				arguments: {},
			});
			expect(privateList.isError).toBeUndefined();
		} finally {
			await close();
		}
	});

	it("keeps HTTP in user mode even when system mode is requested", async () => {
		const server = await createMcpServer(setup.app, {
			transport: "http",
			accessMode: "system",
		});
		const { client, close } = await connect(server);

		try {
			const tools = await client.listTools();
			const toolNames = tools.tools.map((tool) => tool.name);

			expect(toolNames).not.toContain("collections.privateNotes.list");
			expect(toolNames).toContain("collections.posts.list");
		} finally {
			await close();
		}
	});

	it("ignores config.http.accessMode system mode", async () => {
		const server = await createMcpServer(setup.app, {
			transport: "http",
			config: { http: { accessMode: "system" } },
		});
		const { client, close } = await connect(server);

		try {
			const tools = await client.listTools();
			const toolNames = tools.tools.map((tool) => tool.name);

			expect(toolNames).not.toContain("collections.privateNotes.list");
			expect(toolNames).toContain("collections.posts.list");
		} finally {
			await close();
		}
	});

	it("lets stdio be explicitly lowered to user mode", async () => {
		const ctx = createTestContext({ accessMode: "user" });
		const server = await createMcpServer(setup.app, {
			transport: "stdio",
			ctx,
		});
		const { client, close } = await connect(server);

		try {
			const tools = await client.listTools();
			const toolNames = tools.tools.map((tool) => tool.name);

			expect(toolNames).not.toContain("collections.privateNotes.list");
			expect(toolNames).toContain("collections.posts.list");
		} finally {
			await close();
		}
	});

	it("honors per-entity policy overrides", async () => {
		const server = await createMcpServer(setup.app, {
			transport: "http",
			config: {
				crud: {
					collections: {
						posts: {
							operations: { list: true, count: true, get: true },
						},
					},
					globals: {
						siteSettings: false,
					},
				},
			},
		});
		const { client, close } = await connect(server);

		try {
			const tools = await client.listTools();
			const toolNames = tools.tools.map((tool) => tool.name);

			expect(toolNames).toContain("collections.posts.list");
			expect(toolNames).not.toContain("collections.posts.create");
			expect(toolNames).not.toContain("globals.siteSettings.get");

			await expect(
				client.readResource({ uri: "questpie://schema/globals/siteSettings" }),
			).rejects.toThrow();
		} finally {
			await close();
		}
	});

	it("intersects named config with QUESTPIE access rules", async () => {
		const server = await createMcpServer(setup.app, {
			transport: "http",
			config: {
				crud: {
					collections: {
						posts: {
							operations: {
								list: true,
								count: true,
								get: true,
								create: true,
								update: true,
							},
						},
						privateNotes: {
							operations: {
								list: true,
								count: true,
								get: true,
								create: true,
								update: true,
							},
						},
					},
				},
			},
		});
		const { client, close } = await connect(server);

		try {
			const tools = await client.listTools();
			const toolNames = tools.tools.map((tool) => tool.name);

			expect(toolNames).toContain("collections.posts.create");
			expect(toolNames).not.toContain("collections.posts.delete");
			expect(toolNames).not.toContain("collections.privateNotes.list");
		} finally {
			await close();
		}
	});

	it("maps create, update, delete, and read to their exact QUESTPIE access rules", async () => {
		const asymmetric = collection("asymmetric")
			.fields(({ f }) => ({ title: f.text(255).required() }))
			.access({ read: false, create: false, update: true, delete: false });
		const local = await buildMockApp({ collections: { asymmetric } });
		const server = await createMcpServer(local.app, {
			config: {
				crud: {
					collections: {
						asymmetric: {
							operations: {
								list: true,
								create: true,
								update: true,
								delete: true,
							},
						},
					},
				},
			},
		});
		const { client, close } = await connect(server);

		try {
			expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
				["collections.asymmetric.update"],
			);
		} finally {
			await close();
			await local.cleanup();
		}
	});

	it("clamps collection list limit to maxLimit", async () => {
		await setup.app.collections.posts.create(
			{ title: "Second", published: false },
			createTestContext({ accessMode: "system" }),
		);
		const server = await createMcpServer(setup.app, {
			transport: "http",
			config: { crud: { maxLimit: 1 } },
		});
		const { client, close } = await connect(server);

		try {
			const listResult = await client.callTool({
				name: "collections.posts.list",
				arguments: { limit: 999 },
			});
			expect((listResult.structuredContent as any).docs).toHaveLength(1);
		} finally {
			await close();
		}
	});

	it("preserves request context when HTTP server is created programmatically", async () => {
		const server = await createMcpServer(setup.app, {
			transport: "http",
			request: new Request("http://questpie.local/api/mcp", {
				headers: { "x-mcp-test": "present" },
			}),
		});
		const { client, close } = await connect(server);

		try {
			const tools = await client.listTools();
			expect(tools.tools.map((tool) => tool.name)).toContain(
				"custom.request-header",
			);

			const result = await client.callTool({
				name: "custom.request-header",
				arguments: {},
			});
			expect(result.structuredContent).toEqual({ header: "present" });
		} finally {
			await close();
		}
	});

	it("hides unauthorized custom tools and denies stale calls", async () => {
		guardedToolAllowed = false;
		const hiddenServer = await createMcpServer(setup.app, {
			transport: "http",
		});
		const hidden = await connect(hiddenServer);

		try {
			const tools = await hidden.client.listTools();
			expect(tools.tools.map((tool) => tool.name)).not.toContain(
				"custom.guarded",
			);
		} finally {
			await hidden.close();
		}

		guardedToolAllowed = true;
		const server = await createMcpServer(setup.app, { transport: "http" });
		const { client, close } = await connect(server);

		try {
			const tools = await client.listTools();
			expect(tools.tools.map((tool) => tool.name)).toContain("custom.guarded");

			guardedToolAllowed = false;
			const result = await client.callTool({
				name: "custom.guarded",
				arguments: { message: "blocked" },
			});
			expect(result.isError).toBe(true);
		} finally {
			guardedToolAllowed = true;
			await close();
		}
	});
});
