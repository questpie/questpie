/**
 * OpenAPI 3.1 validation gate + `/api/docs` regression coverage.
 *
 * This is the shared verify harness for the generator-hardening work: it proves
 * the emitted document is a VALID OpenAPI 3.1 spec (not just "it generates"),
 * and it locks the historically-500'd `/api/openapi.json` + `/api/docs`
 * endpoints at 200 through the real HTTP adapter.
 *
 * Reusable assertion helpers live in `./openapi-test-utils.ts` and are consumed
 * by the sibling task tests (status codes, filter/query DSL, schema/meta
 * responses, route meta, per-op security).
 */

import { describe, expect, it } from "bun:test";

import { route } from "questpie";
import { z } from "zod";

import { generateOpenApiSpec } from "../../../openapi/src/generator/index.js";
import { openApiModule } from "../../../openapi/src/server.js";
import { collection, global } from "../../src/exports/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import coreModule from "../../src/server/modules/core/.generated/module.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../utils/test-db.js";
import {
	assertHasSummary,
	assertPathParam,
	assertResponse,
	assertSecurityEmpty,
	assertValidOpenApi31,
	getOperation,
	validateOpenApi31,
} from "./openapi-test-utils.js";

// ---------------------------------------------------------------------------
// A representative app: collections + globals + routes exercising the full
// generator surface (CRUD, versioning, workflow, relations, input/output-false
// fields, JSON + raw routes, path-param raw routes, method-suffix siblings,
// public + gated access, route meta, auth + search sections).
// ---------------------------------------------------------------------------

const authors = collection("authors").fields(({ f }) => ({
	name: f.text().required(),
}));

const posts = collection("posts")
	.fields(({ f }) => ({
		title: f.text(255).required(),
		content: f.textarea(),
		viewCount: f.number().default(0),
		published: f.boolean().default(false),
		tags: f.text().array(),
		author: f.relation("authors"),
		serverOnly: f.text().inputFalse(),
		secret: f.text().outputFalse(),
	}))
	.options({
		versioning: {
			workflow: {
				stages: ["draft", "published"],
				initialStage: "draft",
			},
		},
	});

const pages = collection("pages")
	.fields(({ f }) => ({
		title: f.text().required(),
	}))
	.options({ versioning: true });

const settings = global("settings").fields(({ f }) => ({
	siteName: f.text().required(),
	maintenance: f.boolean().default(false),
}));

const nav = global("nav").fields(({ f }) => ({
	items: f.text().array(),
}));

const representativeRoutes = {
	// Public JSON route with an output schema.
	health: route()
		.get()
		.access(true)
		.outputSchema(z.object({ ok: z.boolean() }))
		.handler(() => ({ ok: true })),
	// JSON route with an input schema + author-provided meta.
	bookings: route()
		.post()
		.schema(z.object({ name: z.string() }))
		.meta({
			title: "Create a booking",
			description: "Creates a booking for the current user.",
			tags: ["Bookings"],
		})
		.handler(() => ({ ok: true })),
	// Method-suffixed raw sibling routes on one catch-all path.
	"auth/[...path]:GET": route()
		.get()
		.raw()
		.handler(() => new Response("ok")),
	"auth/[...path]:POST": route()
		.post()
		.raw()
		.handler(() => new Response("ok")),
	// Nested + path-param raw route.
	files: {
		"[...key]": route()
			.get()
			.raw()
			.handler(() => new Response("ok")),
	},
	// Gated (function access) nested JSON route with an output schema.
	admin: {
		stats: route()
			.get()
			.access(() => true)
			.outputSchema(z.object({ total: z.number() }))
			.handler(() => ({ total: 0 })),
	},
};

function representativeApp() {
	return {
		getCollections: () => ({ authors, posts, pages }),
		getGlobals: () => ({ settings, nav }),
		config: { routes: representativeRoutes },
	};
}

const representativeConfig = {
	basePath: "/api",
	info: { title: "Representative API", version: "1.0.0" },
	auth: true,
	search: true,
} as const;

// ---------------------------------------------------------------------------
// Core: full-spec 3.1 validity
// ---------------------------------------------------------------------------

describe("OpenAPI 3.1 spec validity (full representative spec)", () => {
	it("validates the representative spec against the OpenAPI 3.1 meta-schema with ZERO errors", async () => {
		const spec = await generateOpenApiSpec(
			representativeApp() as any,
			representativeRoutes as any,
			representativeConfig,
		);

		// Sanity: the spec is genuinely comprehensive, not a trivial stub.
		expect(spec.openapi).toBe("3.1.0");
		expect(Object.keys(spec.paths).length).toBeGreaterThan(20);
		expect(Object.keys(spec.components.schemas).length).toBeGreaterThan(10);

		await assertValidOpenApi31(spec);
	});

	it("validates the default spec (no config) — collections + globals + routes present", async () => {
		const spec = await generateOpenApiSpec(
			representativeApp() as any,
			representativeRoutes as any,
			{ basePath: "/api" },
		);
		await assertValidOpenApi31(spec);
	});

	it("validates an empty app (no collections/globals/routes) — graceful skeleton", async () => {
		const emptyApp = {
			getCollections: () => ({}),
			getGlobals: () => ({}),
			config: { routes: {} },
		};
		const spec = await generateOpenApiSpec(emptyApp as any, {}, {});
		await assertValidOpenApi31(spec);
	});
});

describe("realtime v3 core module route coverage", () => {
	it("includes the channels and realtime route definitions with exact methods", async () => {
		const app = {
			getCollections: () => ({}),
			getGlobals: () => ({}),
			config: { routes: coreModule.routes },
		};
		const spec = await generateOpenApiSpec(
			app as any,
			coreModule.routes as any,
			{ basePath: "/api", auth: false, search: false },
		);

		const modulePaths = Object.fromEntries(
			Object.entries(spec.paths)
				.filter(
					([path]) =>
						path.startsWith("/api/channels/") ||
						path.startsWith("/api/realtime"),
				)
				.map(([path, operations]) => [path, Object.keys(operations).sort()]),
		);

		expect(modulePaths).toEqual({
			"/api/channels/auth": ["options", "post"],
			"/api/channels/config": ["get"],
			"/api/channels/publish": ["options", "post"],
			"/api/channels/replay": ["options", "post"],
			"/api/realtime": ["post"],
			"/api/realtime/auth": ["post"],
			"/api/realtime/config": ["get"],
			"/api/realtime/crdt/exchange": ["post"],
			"/api/realtime/crdt/open": ["post"],
		});

		for (const path of [
			"/api/channels/auth",
			"/api/channels/config",
			"/api/channels/publish",
			"/api/channels/replay",
			"/api/realtime/auth",
			"/api/realtime/config",
			"/api/realtime/crdt/exchange",
			"/api/realtime/crdt/open",
		]) {
			for (const operation of Object.values(spec.paths[path])) {
				expect(operation.security).toEqual([]);
				expect(operation.description).toContain("Raw route");
			}
		}

		expect(spec.paths["/api/realtime"].post.security).toBeUndefined();
		await assertValidOpenApi31(spec);
	});
});

// ---------------------------------------------------------------------------
// The validator gate is REAL: it rejects a deliberately-malformed spec.
// (Proves "generates a valid spec" can actually fail — the gate has teeth.)
// ---------------------------------------------------------------------------

describe("OpenAPI 3.1 validator gate has teeth", () => {
	it("rejects a path parameter missing its required `schema`/`content`", async () => {
		const broken = {
			openapi: "3.1.0",
			info: { title: "Broken", version: "1.0.0" },
			paths: {
				"/x/{id}": {
					get: {
						// A path parameter must carry a `schema` (or `content`).
						parameters: [{ name: "id", in: "path", required: true }],
						responses: { "200": { description: "ok" } },
					},
				},
			},
			components: { schemas: {} },
		};
		const { valid, version } = await validateOpenApi31(broken);
		expect(version).toBe("3.1");
		expect(valid).toBe(false);
	});

	it("rejects a response object missing the required `description`", async () => {
		const broken = {
			openapi: "3.1.0",
			info: { title: "Broken", version: "1.0.0" },
			paths: {
				"/x": {
					get: { responses: { "200": { foo: "bar" } } },
				},
			},
			components: { schemas: {} },
		};
		const { valid } = await validateOpenApi31(broken);
		expect(valid).toBe(false);
	});

	it("rejects an invalid `components.schemas` key (must match ^[a-zA-Z0-9._-]+$)", async () => {
		const broken = {
			openapi: "3.1.0",
			info: { title: "Broken", version: "1.0.0" },
			paths: {},
			components: { schemas: { "bad key with spaces": { type: "object" } } },
		};
		const { valid } = await validateOpenApi31(broken);
		expect(valid).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Reusable helpers exercised against the real spec (so the sibling tasks can
// rely on them). Also documents the intended content of key operations.
// ---------------------------------------------------------------------------

describe("reusable assert helpers (used against the real spec)", () => {
	it("getOperation + assertHasSummary read a route's author-provided meta", async () => {
		const spec = await generateOpenApiSpec(
			representativeApp() as any,
			representativeRoutes as any,
			representativeConfig,
		);
		const op = getOperation(spec, "/api/bookings", "post");
		assertHasSummary(op, "Create a booking");
		expect(op.description).toBe("Creates a booking for the current user.");
		expect(op.tags).toEqual(["Bookings"]);
	});

	it("assertSecurityEmpty confirms a public route opts out of global security", async () => {
		const spec = await generateOpenApiSpec(
			representativeApp() as any,
			representativeRoutes as any,
			representativeConfig,
		);
		const op = getOperation(spec, "/api/health", "get");
		assertSecurityEmpty(op);
	});

	it("assertPathParam confirms a collection {id} operation declares the path param", async () => {
		const spec = await generateOpenApiSpec(
			representativeApp() as any,
			representativeRoutes as any,
			representativeConfig,
		);
		const op = getOperation(spec, "/api/posts/{id}", "get");
		assertPathParam(op, "id");
	});

	it("assertResponse reads a declared response off a collection operation", async () => {
		const spec = await generateOpenApiSpec(
			representativeApp() as any,
			representativeRoutes as any,
			representativeConfig,
		);
		const op = getOperation(spec, "/api/posts/{id}", "get");
		const ok = assertResponse(op, 200);
		expect(ok.description).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Regression: /api/openapi.json + /api/docs must return 200 through the real
// HTTP adapter. These endpoints historically 500'd; this locks them.
// ---------------------------------------------------------------------------

describe("openApiModule endpoints (e2e through createFetchHandler)", () => {
	async function setupHandler() {
		const setup = await buildMockApp({
			modules: [openApiModule as any],
			collections: {
				posts: collection("posts").fields(({ f }) => ({
					title: f.text().required(),
				})),
			},
			globals: {
				settings: global("settings").fields(({ f }) => ({
					siteName: f.text().required(),
				})),
			},
		});
		await runTestDbMigrations(setup.app);
		const handler = createFetchHandler(setup.app, {
			basePath: "/api",
			requestLogging: false,
			getSession: async () => null,
		});
		return { setup, handler };
	}

	it("GET /api/openapi.json → 200 with a valid OpenAPI 3.1 JSON spec", async () => {
		const { setup, handler } = await setupHandler();
		try {
			const res = await handler(
				new Request("http://localhost/api/openapi.json"),
			);
			expect(res?.status).toBe(200);
			expect(res?.headers.get("content-type")).toContain("application/json");

			const spec = (await res!.json()) as any;
			expect(spec.openapi).toBe("3.1.0");
			// The module serves with the basePath from `config/openapi.ts`
			// (unset here → default "/"), so collection/global paths are present
			// regardless of the exact leading prefix.
			const pathKeys = Object.keys(spec.paths);
			expect(pathKeys.some((p) => p.endsWith("/posts"))).toBe(true);
			expect(pathKeys.some((p) => p.endsWith("/globals/settings"))).toBe(true);

			// The served document is itself valid OpenAPI 3.1.
			await assertValidOpenApi31(spec);
		} finally {
			await setup.cleanup();
		}
	});

	it("GET /api/docs → 200 Scalar HTML", async () => {
		const { setup, handler } = await setupHandler();
		try {
			const res = await handler(new Request("http://localhost/api/docs"));
			expect(res?.status).toBe(200);
			expect(res?.headers.get("content-type")).toContain("text/html");

			const html = await res!.text();
			// Scalar UI references the spec via the openapi.json route.
			expect(html.toLowerCase()).toContain("<html");
		} finally {
			await setup.cleanup();
		}
	});

	it("GET /api/openapi.json honours conditional requests (304 on matching ETag)", async () => {
		const { setup, handler } = await setupHandler();
		try {
			const first = await handler(
				new Request("http://localhost/api/openapi.json"),
			);
			const etag = first?.headers.get("etag");
			expect(etag).toBeTruthy();

			const second = await handler(
				new Request("http://localhost/api/openapi.json", {
					headers: { "if-none-match": etag! },
				}),
			);
			expect(second?.status).toBe(304);
		} finally {
			await setup.cleanup();
		}
	});
});
