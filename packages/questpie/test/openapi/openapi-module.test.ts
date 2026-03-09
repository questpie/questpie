import { describe, expect, it } from "bun:test";
import {
	generateOpenApiSpec,
	createOpenApiHandlers,
	withOpenApi,
} from "../../../openapi/src/server.js";
import { generateOpenApiSpec as generateInternal } from "../../../openapi/src/generator/index.js";
import { openApiPlugin } from "../../../openapi/src/plugin.js";
import { collection, global } from "../../src/server/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockApp(opts?: {
	collections?: Record<string, any>;
	globals?: Record<string, any>;
	functions?: Record<string, any>;
}) {
	return {
		getCollections: () => opts?.collections ?? {},
		getGlobals: () => opts?.globals ?? {},
		functions: opts?.functions ?? {},
		config: {},
	};
}

// ---------------------------------------------------------------------------
// generateOpenApiSpec (public API)
// ---------------------------------------------------------------------------

describe("generateOpenApiSpec (public API)", () => {
	it("generates a valid OpenAPI 3.1 spec", () => {
		const app = createMockApp({
			collections: {
				posts: collection("posts").fields(({ f }) => ({
					title: f.text(),
				})),
			},
		});

		const spec = generateOpenApiSpec(app, undefined, {
			info: { title: "Test", version: "2.0.0" },
		});

		expect(spec.openapi).toBe("3.1.0");
		expect(spec.info.title).toBe("Test");
		expect(spec.info.version).toBe("2.0.0");
		expect(spec.components.schemas).toBeDefined();
		expect(spec.components.securitySchemes).toBeDefined();
	});

	it("uses default title and version when not provided", () => {
		const app = createMockApp();
		const spec = generateOpenApiSpec(app);

		expect(spec.info.title).toBe("QUESTPIE API");
		expect(spec.info.version).toBe("1.0.0");
	});

	it("includes collections in the spec", () => {
		const app = createMockApp({
			collections: {
				posts: collection("posts").fields(({ f }) => ({
					title: f.text(),
				})),
			},
		});

		const spec = generateOpenApiSpec(app, undefined, { basePath: "/api" });

		expect(spec.paths["/api/posts"]).toBeDefined();
		expect(spec.components.schemas?.PostsInsert).toBeDefined();
	});

	it("includes globals in the spec", () => {
		const app = createMockApp({
			globals: {
				settings: global("settings").fields(({ f }) => ({
					siteName: f.text(),
				})),
			},
		});

		const spec = generateOpenApiSpec(app, undefined, { basePath: "/api" });

		expect(spec.paths["/api/globals/settings"]).toBeDefined();
	});

	it("respects exclude config", () => {
		const app = createMockApp({
			collections: {
				posts: collection("posts").fields(({ f }) => ({
					title: f.text(),
				})),
				internal: collection("internal").fields(({ f }) => ({
					data: f.text(),
				})),
			},
		});

		const spec = generateOpenApiSpec(app, undefined, {
			basePath: "/api",
			exclude: { collections: ["internal"] },
		});

		expect(spec.paths["/api/posts"]).toBeDefined();
		expect(spec.paths["/api/internal"]).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// createOpenApiHandlers
// ---------------------------------------------------------------------------

describe("createOpenApiHandlers", () => {
	it("returns specHandler and scalarHandler", () => {
		const app = createMockApp();
		const spec = generateOpenApiSpec(app);
		const handlers = createOpenApiHandlers(spec);

		expect(typeof handlers.specHandler).toBe("function");
		expect(typeof handlers.scalarHandler).toBe("function");
	});

	it("specHandler returns JSON response with correct headers", async () => {
		const app = createMockApp();
		const spec = generateOpenApiSpec(app, undefined, {
			info: { title: "Handler Test", version: "1.0.0" },
		});
		const { specHandler } = createOpenApiHandlers(spec);

		const response = specHandler();

		expect(response).toBeInstanceOf(Response);
		expect(response.headers.get("Content-Type")).toBe("application/json");
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");

		const body = await response.json();
		expect(body.openapi).toBe("3.1.0");
		expect(body.info.title).toBe("Handler Test");
	});

	it("scalarHandler returns HTML response with Scalar UI", async () => {
		const app = createMockApp();
		const spec = generateOpenApiSpec(app);
		const { scalarHandler } = createOpenApiHandlers(spec);

		const response = scalarHandler();

		expect(response).toBeInstanceOf(Response);
		expect(response.headers.get("Content-Type")).toBe(
			"text/html; charset=utf-8",
		);

		const html = await response.text();
		expect(html).toContain("<!DOCTYPE html>");
		expect(html).toContain("@scalar/api-reference");
	});

	it("respects scalar theme config", async () => {
		const app = createMockApp();
		const spec = generateOpenApiSpec(app);
		const { scalarHandler } = createOpenApiHandlers(spec, {
			scalar: { theme: "bluePlanet" },
		});

		const response = scalarHandler();
		const html = await response.text();

		expect(html).toContain("bluePlanet");
	});
});

// ---------------------------------------------------------------------------
// withOpenApi
// ---------------------------------------------------------------------------

describe("withOpenApi", () => {
	const baseHandler = async (req: Request) =>
		new Response("base", { status: 200 });

	it("intercepts spec route and returns JSON", async () => {
		const app = createMockApp();
		const handler = withOpenApi(baseHandler, {
			app,
			basePath: "/api",
			info: { title: "Wrap Test", version: "2.0.0" },
		});

		const response = await handler(
			new Request("http://localhost/api/openapi.json"),
		);

		expect(response).toBeInstanceOf(Response);
		const body = await response!.json();
		expect(body.openapi).toBe("3.1.0");
		expect(body.info.title).toBe("Wrap Test");
	});

	it("intercepts docs route and returns HTML", async () => {
		const app = createMockApp();
		const handler = withOpenApi(baseHandler, {
			app,
			basePath: "/api",
		});

		const response = await handler(
			new Request("http://localhost/api/docs"),
		);

		expect(response).toBeInstanceOf(Response);
		const html = await response!.text();
		expect(html).toContain("<!DOCTYPE html>");
	});

	it("passes non-matching requests to the base handler", async () => {
		const app = createMockApp();
		const handler = withOpenApi(baseHandler, {
			app,
			basePath: "/api",
		});

		const response = await handler(
			new Request("http://localhost/api/posts"),
		);

		expect(response).toBeInstanceOf(Response);
		const text = await response!.text();
		expect(text).toBe("base");
	});

	it("uses custom specPath and docsPath", async () => {
		const app = createMockApp();
		const handler = withOpenApi(baseHandler, {
			app,
			basePath: "/api",
			specPath: "spec.json",
			docsPath: "api-docs",
		});

		const specRes = await handler(
			new Request("http://localhost/api/spec.json"),
		);
		const body = await specRes!.json();
		expect(body.openapi).toBe("3.1.0");

		const docsRes = await handler(
			new Request("http://localhost/api/api-docs"),
		);
		const html = await docsRes!.text();
		expect(html).toContain("<!DOCTYPE html>");

		// Old paths should fall through
		const oldSpec = await handler(
			new Request("http://localhost/api/openapi.json"),
		);
		const oldText = await oldSpec!.text();
		expect(oldText).toBe("base");
	});

	it("only intercepts GET requests", async () => {
		const app = createMockApp();
		const handler = withOpenApi(baseHandler, {
			app,
			basePath: "/api",
		});

		const response = await handler(
			new Request("http://localhost/api/openapi.json", { method: "POST" }),
		);

		const text = await response!.text();
		expect(text).toBe("base");
	});
});

// ---------------------------------------------------------------------------
// openApiPlugin (codegen)
// ---------------------------------------------------------------------------

describe("openApiPlugin", () => {
	it("returns a valid CodegenPlugin", () => {
		const plugin = openApiPlugin();

		expect(plugin.name).toBe("questpie-openapi");
		expect(plugin.targets).toBeDefined();
		expect(plugin.targets.server).toBeDefined();
		expect(plugin.targets.server.root).toBe(".");
		expect(plugin.targets.server.outputFile).toBe("index.ts");
		expect(typeof plugin.targets.server.transform).toBe("function");
	});

	it("transform does nothing when no routes category", () => {
		const plugin = openApiPlugin();
		const declarations: string[] = [];
		const ctx = {
			categories: new Map(),
			addTypeDeclaration: (code: string) => declarations.push(code),
		};

		plugin.targets.server.transform!(ctx as any);

		expect(declarations).toHaveLength(0);
	});

	it("transform does nothing when routes category is empty", () => {
		const plugin = openApiPlugin();
		const declarations: string[] = [];
		const ctx = {
			categories: new Map([["routes", new Map()]]),
			addTypeDeclaration: (code: string) => declarations.push(code),
		};

		plugin.targets.server.transform!(ctx as any);

		expect(declarations).toHaveLength(0);
	});

	it("transform emits AppRouteKeys type from discovered routes", () => {
		const plugin = openApiPlugin();
		const declarations: string[] = [];
		const routes = new Map([
			["health", {} as any],
			["webhooks/stripe", {} as any],
			["webhooks/github", {} as any],
		]);
		const ctx = {
			categories: new Map([["routes", routes]]),
			addTypeDeclaration: (code: string) => declarations.push(code),
		};

		plugin.targets.server.transform!(ctx as any);

		expect(declarations).toHaveLength(1);
		expect(declarations[0]).toContain("export type AppRouteKeys");
		expect(declarations[0]).toContain('"health"');
		expect(declarations[0]).toContain('"webhooks/stripe"');
		expect(declarations[0]).toContain('"webhooks/github"');
	});
});

// ---------------------------------------------------------------------------
// RPC paths
// ---------------------------------------------------------------------------

describe("RPC in OpenAPI spec", () => {
	it("generates paths for RPC functions", () => {
		const app = createMockApp();
		const { z } = require("zod");

		const functions = {
			greet: {
				handler: () => {},
				schema: z.object({ name: z.string() }),
				outputSchema: z.object({ message: z.string() }),
			},
		};

		const spec = generateInternal(app as any, functions, {
			basePath: "/api",
		});

		expect(spec.paths["/api/rpc/greet"]).toBeDefined();
		expect(spec.paths["/api/rpc/greet"].post).toBeDefined();
		expect(spec.paths["/api/rpc/greet"].post.operationId).toBe("rpc_greet");
	});

	it("generates nested RPC paths", () => {
		const app = createMockApp();

		const functions = {
			admin: {
				stats: {
					handler: () => {},
				},
				users: {
					list: {
						handler: () => {},
					},
				},
			},
		};

		const spec = generateInternal(app as any, functions, {
			basePath: "/api",
		});

		expect(spec.paths["/api/rpc/admin/stats"]).toBeDefined();
		expect(spec.paths["/api/rpc/admin/users/list"]).toBeDefined();
	});
});
