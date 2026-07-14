import { describe, expect, it } from "bun:test";

import { route } from "questpie";
import { z } from "zod";

import { generateRoutePaths } from "./routes.js";

describe("generateRoutePaths — method suffix routes", () => {
	it("emits one operation per method for method-suffixed routes on the same path", () => {
		const authGet = route()
			.get()
			.raw()
			.handler(() => new Response("ok"));
		const authPost = route()
			.post()
			.raw()
			.handler(() => new Response("ok"));

		const routes = {
			"auth/[...path]:GET": authGet,
			"auth/[...path]:POST": authPost,
		} as any;

		let result: ReturnType<typeof generateRoutePaths> | undefined;
		expect(() => {
			result = generateRoutePaths(routes, { basePath: "/api" });
		}).not.toThrow();

		const pathItem = result!.paths["/api/auth/{path}"];
		expect(pathItem).toBeDefined();
		// Both methods present on the SAME path object (not overwritten).
		expect(pathItem.get).toBeDefined();
		expect(pathItem.post).toBeDefined();
		// `[...path]` → `{path}` template, no `[...path]` literal in the key.
		expect(Object.keys(result!.paths)).toEqual(["/api/auth/{path}"]);
		// Unique operationIds across the two methods.
		expect((pathItem.get as any).operationId).not.toBe(
			(pathItem.post as any).operationId,
		);
	});

	it("splits a trailing :METHOD key suffix into the method and path", () => {
		// A route registered under a `<path>:METHOD` key (e.g. generated module keys).
		const createItem = route()
			.post()
			.schema(z.object({ name: z.string() }))
			.handler(() => ({ ok: true }));

		const routes = {
			"items:POST": createItem,
		} as any;

		const result = generateRoutePaths(routes, { basePath: "/api" });

		// Path has no `:POST` literal; the suffix became the method.
		expect(result.paths["/api/items"]).toBeDefined();
		expect(result.paths["/api/items"].post).toBeDefined();
		expect(Object.keys(result.paths)).toEqual(["/api/items"]);
		expect(Object.keys(result.paths).some((p) => p.includes(":POST"))).toBe(
			false,
		);
	});

	it("keeps the default summary and Routes: <top> tag when no meta is set", () => {
		const list = route()
			.get()
			.schema(z.object({}))
			.handler(() => ({ ok: true }));

		const routes = { widgets: { list } } as any;

		const result = generateRoutePaths(routes, { basePath: "/api" });

		const op = result.paths["/api/widgets/list"].get as any;
		expect(op.summary).toBe("widgets/list");
		expect(op.tags).toEqual(["Routes: widgets"]);
		expect(op.description).toBeUndefined();
		expect(result.tags).toEqual([
			{ name: "Routes: widgets", description: "Routes under widgets" },
		]);
	});

	it("converts [param] and [...slug] segments to {param} templates with path parameters", () => {
		const getOne = route()
			.get()
			.schema(z.object({}))
			.handler(() => ({ ok: true }));
		const getFile = route()
			.get()
			.raw()
			.handler(() => new Response("ok"));

		const routes = {
			users: {
				"[id]": getOne,
			},
			files: {
				"[...key]": getFile,
			},
		} as any;

		const result = generateRoutePaths(routes, { basePath: "/api" });

		const userPath = result.paths["/api/users/{id}"];
		expect(userPath).toBeDefined();
		expect(userPath.get).toBeDefined();
		expect((userPath.get as any).parameters).toEqual([
			{ name: "id", in: "path", required: true, schema: { type: "string" } },
		]);

		const filePath = result.paths["/api/files/{key}"];
		expect(filePath).toBeDefined();
		expect(filePath.get).toBeDefined();
		expect((filePath.get as any).parameters).toEqual([
			{ name: "key", in: "path", required: true, schema: { type: "string" } },
		]);
	});
});

describe("generateRoutePaths — route meta", () => {
	it("maps meta.title/description/tags onto the operation and registers tags", () => {
		const createBooking = route()
			.post()
			.schema(z.object({ name: z.string() }))
			.meta({
				title: "Create a booking",
				description: "Creates a booking for the current user.",
				tags: ["Bookings", "Public API"],
			})
			.handler(() => ({ ok: true }));

		const routes = { bookings: createBooking } as any;

		const result = generateRoutePaths(routes, { basePath: "/api" });

		const op = result.paths["/api/bookings"].post as any;
		expect(op.summary).toBe("Create a booking");
		expect(op.description).toBe("Creates a booking for the current user.");
		expect(op.tags).toEqual(["Bookings", "Public API"]);
		// meta.tags surface in the top-level tags array (no orphans), and the
		// default `Routes: bookings` bucket is NOT registered when overridden.
		expect(result.tags).toEqual([
			{ name: "Bookings" },
			{ name: "Public API" },
		]);
	});

	it("uses meta.description for a raw route instead of the default blurb", () => {
		const webhook = route()
			.post()
			.raw()
			.meta({ description: "Stripe webhook receiver." })
			.handler(() => new Response("ok"));

		const routes = { webhooks: { stripe: webhook } } as any;

		const result = generateRoutePaths(routes, { basePath: "/api" });

		const op = result.paths["/api/webhooks/stripe"].post as any;
		expect(op.description).toBe("Stripe webhook receiver.");
	});

	it("falls back to the default raw description when meta has no description", () => {
		const webhook = route()
			.post()
			.raw()
			.meta({ title: "Stripe webhook" })
			.handler(() => new Response("ok"));

		const routes = { webhooks: { stripe: webhook } } as any;

		const result = generateRoutePaths(routes, { basePath: "/api" });

		const op = result.paths["/api/webhooks/stripe"].post as any;
		expect(op.summary).toBe("Stripe webhook");
		expect(op.description).toBe(
			"Raw route - accepts any request body and returns a raw response.",
		);
	});
});

describe("generateRoutePaths — per-operation security from access", () => {
	it("emits security: [] for an explicitly public route (access(true))", () => {
		const publicRoute = route()
			.get()
			.access(true)
			.schema(z.object({}))
			.handler(() => ({ ok: true }));

		const routes = { health: publicRoute } as any;

		const result = generateRoutePaths(routes, { basePath: "/api" });

		const op = result.paths["/api/health"].get as any;
		expect(op.security).toEqual([]);
	});

	it("emits no per-op security for a gated route (function access rule)", () => {
		const gatedRoute = route()
			.get()
			.access(() => true)
			.schema(z.object({}))
			.handler(() => ({ ok: true }));

		const routes = { secret: gatedRoute } as any;

		const result = generateRoutePaths(routes, { basePath: "/api" });

		const op = result.paths["/api/secret"].get as any;
		expect(op.security).toBeUndefined();
	});

	it("emits no per-op security when no access is declared", () => {
		const defaultRoute = route()
			.get()
			.schema(z.object({}))
			.handler(() => ({ ok: true }));

		const routes = { thing: defaultRoute } as any;

		const result = generateRoutePaths(routes, { basePath: "/api" });

		const op = result.paths["/api/thing"].get as any;
		expect(op.security).toBeUndefined();
	});

	it("treats access({ execute: true }) as explicitly public (security: [])", () => {
		const publicRoute = route()
			.get()
			.access({ execute: true })
			.raw()
			.handler(() => new Response("ok"));

		const routes = { ping: publicRoute } as any;

		const result = generateRoutePaths(routes, { basePath: "/api" });

		const op = result.paths["/api/ping"].get as any;
		expect(op.security).toEqual([]);
	});

	it("does not mark access(false) as public", () => {
		const closedRoute = route()
			.get()
			.access(false)
			.schema(z.object({}))
			.handler(() => ({ ok: true }));

		const routes = { closed: closedRoute } as any;

		const result = generateRoutePaths(routes, { basePath: "/api" });

		const op = result.paths["/api/closed"].get as any;
		expect(op.security).toBeUndefined();
	});
});
