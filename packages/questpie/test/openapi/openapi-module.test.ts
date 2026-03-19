import { describe, expect, it } from "bun:test";

import { generateOpenApiSpec as generateInternal } from "../../../openapi/src/generator/index.js";
import { openApiPlugin } from "../../../openapi/src/plugin.js";
import {
	docsRoute,
	generateOpenApiSpec,
	openApiModule,
	openApiRoute,
} from "../../../openapi/src/server.js";
import { collection, global } from "../../src/server/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockApp(opts?: {
	collections?: Record<string, any>;
	globals?: Record<string, any>;
	routes?: Record<string, any>;
}) {
	return {
		getCollections: () => opts?.collections ?? {},
		getGlobals: () => opts?.globals ?? {},
		config: {
			routes: opts?.routes ?? {},
		},
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

		const spec = generateOpenApiSpec(app, {
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

		const spec = generateOpenApiSpec(app, { basePath: "/api" });

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

		const spec = generateOpenApiSpec(app, { basePath: "/api" });

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

		const spec = generateOpenApiSpec(app, {
			basePath: "/api",
			exclude: { collections: ["internal"] },
		});

		expect(spec.paths["/api/posts"]).toBeDefined();
		expect(spec.paths["/api/internal"]).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// openApiModule
// ---------------------------------------------------------------------------

describe("openApiModule", () => {
	it("is a valid static module definition", () => {
		expect(openApiModule.name).toBe("questpie-openapi");
		expect(openApiModule.routes).toBeDefined();
	});

	it("has routes with default paths", () => {
		expect(openApiModule.routes).toBeDefined();
		expect(openApiModule.routes!["openapi.json"]).toBeDefined();
		expect(openApiModule.routes!["docs"]).toBeDefined();
	});

	it("includes the openapi plugin", () => {
		expect(openApiModule.plugin).toBeDefined();
		expect((openApiModule.plugin as any).name).toBe("questpie-openapi");
	});

	it("routes have the correct __brand and mode", () => {
		const specRoute = openApiModule.routes!["openapi.json"] as any;
		const docsRouteVal = openApiModule.routes!["docs"] as any;

		expect(specRoute.__brand).toBe("route");
		expect(specRoute.mode).toBe("raw");
		expect(specRoute.method).toBe("GET");

		expect(docsRouteVal.__brand).toBe("route");
		expect(docsRouteVal.mode).toBe("raw");
		expect(docsRouteVal.method).toBe("GET");
	});
});

// ---------------------------------------------------------------------------
// openApiRoute
// ---------------------------------------------------------------------------

describe("openApiRoute", () => {
	it("returns a raw GET route definition", () => {
		const routeDef = openApiRoute();

		expect((routeDef as any).__brand).toBe("route");
		expect((routeDef as any).mode).toBe("raw");
		expect((routeDef as any).method).toBe("GET");
		expect(typeof (routeDef as any).handler).toBe("function");
	});
});

// ---------------------------------------------------------------------------
// docsRoute
// ---------------------------------------------------------------------------

describe("docsRoute", () => {
	it("returns a raw GET route definition", () => {
		const routeDef = docsRoute();

		expect((routeDef as any).__brand).toBe("route");
		expect((routeDef as any).mode).toBe("raw");
		expect((routeDef as any).method).toBe("GET");
		expect(typeof (routeDef as any).handler).toBe("function");
	});

	it("accepts scalar config", () => {
		const routeDef = docsRoute({ scalar: { theme: "purple" } });

		expect((routeDef as any).__brand).toBe("route");
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
// Routes (flat URLs)
// ---------------------------------------------------------------------------

describe("Routes in OpenAPI spec", () => {
	it("generates flat paths for routes", () => {
		const app = createMockApp();
		const { z } = require("zod");

		const routes = {
			greet: {
				handler: () => {},
				schema: z.object({ name: z.string() }),
				outputSchema: z.object({ message: z.string() }),
			},
		};

		const spec = generateInternal(app as any, routes, {
			basePath: "/api",
		});

		expect(spec.paths["/api/greet"]).toBeDefined();
		expect(spec.paths["/api/greet"].post).toBeDefined();
		expect(spec.paths["/api/greet"].post.operationId).toBe("route_greet");
	});

	it("generates nested flat paths for routes", () => {
		const app = createMockApp();

		const routes = {
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

		const spec = generateInternal(app as any, routes, {
			basePath: "/api",
		});

		expect(spec.paths["/api/admin/stats"]).toBeDefined();
		expect(spec.paths["/api/admin/users/list"]).toBeDefined();
	});
});
