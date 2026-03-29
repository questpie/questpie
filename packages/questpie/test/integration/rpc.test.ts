import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { z } from "zod";

import { createFetchHandler } from "../../src/server/adapters/http.js";
import { collection, global, route } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";

const createDefinition = () => {
	const ping = route()
		.post()
		.schema(z.object({ message: z.string() }))
		.outputSchema(
			z.object({
				message: z.string(),
				hasSession: z.boolean(),
			}),
		)
		.handler(async ({ input, session }) => {
			return {
				message: input.message,
				// Test that session is accessible in handler
				hasSession: session !== undefined && session !== null,
			};
		});

	const webhook = route()
		.post()
		.raw()
		.handler(async ({ request }) => {
			const body = await request.text();
			return new Response(body);
		});

	const posts = collection("posts").fields(({ f }) => ({
		title: f.textarea().required(),
	}));

	const settings = global("settings").fields(({ f }) => ({
		title: f.textarea().required(),
	}));

	return {
		definition: {
			collections: { posts },
			globals: { settings },
			routes: { ping, webhook },
		},
	};
};

describe("route execution", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		const { definition } = createDefinition();
		setup = await buildMockApp(definition);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("executes JSON route via HTTP handler", async () => {
		const handler = createFetchHandler(setup.app);

		const rootResponse = await handler(
			new Request("http://localhost/ping", {
				method: "POST",
				body: JSON.stringify({ message: "hello" }),
			}),
		);
		const rootPayload = await rootResponse?.json();
		expect(rootPayload).toEqual({ message: "hello", hasSession: false });
	});

	it("handles raw routes without JSON parsing", async () => {
		const handler = createFetchHandler(setup.app);
		const response = await handler(
			new Request("http://localhost/webhook", {
				method: "POST",
				body: "raw-payload",
			}),
		);

		expect(await response?.text()).toBe("raw-payload");
	});

	it("returns 400 on invalid JSON input", async () => {
		const handler = createFetchHandler(setup.app);
		const response = await handler(
			new Request("http://localhost/ping", {
				method: "POST",
				body: "{invalid",
			}),
		);

		expect(response?.status).toBe(400);
	});
});

describe("flat route keys with slashes", () => {
	const echo = route()
		.post()
		.schema(z.object({ text: z.string() }))
		.handler(async ({ input }) => ({ echo: input.text }));

	const add = route()
		.post()
		.schema(z.object({ a: z.number(), b: z.number() }))
		.handler(async ({ input }) => ({ sum: input.a + input.b }));

	const multiply = route()
		.post()
		.schema(z.object({ a: z.number(), b: z.number() }))
		.handler(async ({ input }) => ({ product: input.a * input.b }));

	const deepLeaf = route()
		.post()
		.schema(z.object({}))
		.handler(async () => ({ reached: true }));

	// Flat route record with slash-separated keys
	const routes = {
		echo,
		"math/add": add,
		"math/multiply": multiply,
		"deeply/nested/path/leaf": deepLeaf,
	};

	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		const posts = collection("posts").fields(({ f }) => ({
			title: f.textarea().required(),
		}));
		setup = await buildMockApp({
			collections: { posts },
			routes,
		});
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("resolves flat route", async () => {
		const handler = createFetchHandler(setup.app);

		const response = await handler(
			new Request("http://localhost/echo", {
				method: "POST",
				body: JSON.stringify({ text: "hello" }),
			}),
		);

		expect(response?.status).toBe(200);
		expect(await response?.json()).toEqual({ echo: "hello" });
	});

	it("resolves slash-separated route keys", async () => {
		const handler = createFetchHandler(setup.app);

		const addResponse = await handler(
			new Request("http://localhost/math/add", {
				method: "POST",
				body: JSON.stringify({ a: 3, b: 4 }),
			}),
		);
		expect(addResponse?.status).toBe(200);
		expect(await addResponse?.json()).toEqual({ sum: 7 });

		const mulResponse = await handler(
			new Request("http://localhost/math/multiply", {
				method: "POST",
				body: JSON.stringify({ a: 5, b: 6 }),
			}),
		);
		expect(mulResponse?.status).toBe(200);
		expect(await mulResponse?.json()).toEqual({ product: 30 });
	});

	it("resolves deeply nested route path", async () => {
		const handler = createFetchHandler(setup.app);

		const response = await handler(
			new Request("http://localhost/deeply/nested/path/leaf", {
				method: "POST",
				body: JSON.stringify({}),
			}),
		);

		expect(response?.status).toBe(200);
		expect(await response?.json()).toEqual({ reached: true });
	});

	it("returns error for nonexistent route path", async () => {
		const handler = createFetchHandler(setup.app);

		const response = await handler(
			new Request("http://localhost/math/nonexistent", {
				method: "POST",
				body: JSON.stringify({}),
			}),
		);

		// Falls through to collection CRUD — "math" is not a valid collection → 400
		expect(response?.status).toBeGreaterThanOrEqual(400);
	});

	it("returns 404 for partial path that isn't a route", async () => {
		const handler = createFetchHandler(setup.app);

		const response = await handler(
			new Request("http://localhost/math", {
				method: "POST",
				body: JSON.stringify({}),
			}),
		);

		// "math" itself is not a route key — only "math/add" and "math/multiply" are
		expect(response?.status).toBe(404);
	});
});
