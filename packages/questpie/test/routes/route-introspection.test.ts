import { describe, expect, it } from "bun:test";

import { z } from "zod";

import { route } from "../../src/exports/index.js";
import { introspectRoutes } from "../../src/server/routes/introspection.js";

describe("route introspection", () => {
	it("flattens nested routes with methods, params, mode, and metadata", () => {
		const def = route()
			.get()
			.params<{ id: string }>()
			.schema(z.object({ q: z.string().optional() }))
			.meta({
				title: "Read post",
				mcp: { expose: true, name: "posts.read" },
			})
			.handler(async () => ({ ok: true }));

		const routes = introspectRoutes({
			posts: {
				"[id]:GET": def,
			},
		});

		expect(routes).toHaveLength(1);
		expect(routes[0]).toMatchObject({
			key: "posts/[id]",
			path: "/posts/:id",
			pattern: "posts/:id",
			methods: ["GET"],
			mode: "json",
			params: ["id"],
			meta: {
				title: "Read post",
				mcp: { expose: true, name: "posts.read" },
			},
		});
		expect(routes[0].definition).toBe(def);
	});

	it("uses route definition methods when the key has no method suffix", () => {
		const def = route()
			.post()
			.raw()
			.meta({ title: "Webhook" })
			.handler(async () => new Response("ok"));

		const routes = introspectRoutes({ webhooks: { stripeEvents: def } });

		expect(routes[0]).toMatchObject({
			key: "webhooks/stripeEvents",
			path: "/webhooks/stripe-events",
			methods: ["POST"],
			mode: "raw",
			params: [],
			meta: { title: "Webhook" },
		});
	});
});
