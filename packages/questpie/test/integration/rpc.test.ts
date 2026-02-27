import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { z } from "zod";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import { collection, fn, global } from "../../src/server/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";

const createDefinition = () => {
	const ping = fn({
		schema: z.object({ message: z.string() }),
		outputSchema: z.object({
			message: z.string(),
			hasSession: z.boolean(),
		}),
		handler: async ({ input, session }) => {
			return {
				message: input.message,
				// Test that session is accessible in handler
				hasSession: session !== undefined && session !== null,
			};
		},
	});

	const webhook = fn({
		mode: "raw",
		handler: async ({ request }) => {
			const body = await request.text();
			return new Response(body);
		},
	});

	const posts = collection("posts").fields(({ f }) => ({
		title: f.textarea({ required: true }),
	}));

	const settings = global("settings").fields(({ f }) => ({
		title: f.textarea({ required: true }),
	}));

	return {
		definition: {
			collections: { posts },
			globals: { settings },
			functions: { ping, webhook },
		},
	};
};

describe("rpc functions", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		const { definition } = createDefinition();
		setup = await buildMockApp(definition);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("executes root RPC via adapter routes", async () => {
		const handler = createFetchHandler(setup.app);

		const rootResponse = await handler(
			new Request("http://localhost/rpc/ping", {
				method: "POST",
				body: JSON.stringify({ message: "hello" }),
			}),
		);
		const rootPayload = await rootResponse?.json();
		expect(rootPayload).toEqual({ message: "hello", hasSession: false });
	});

	it("handles raw functions without JSON parsing", async () => {
		const handler = createFetchHandler(setup.app);
		const response = await handler(
			new Request("http://localhost/rpc/webhook", {
				method: "POST",
				body: "raw-payload",
			}),
		);

		expect(await response?.text()).toBe("raw-payload");
	});

	it("returns 400 on invalid JSON input", async () => {
		const handler = createFetchHandler(setup.app);
		const response = await handler(
			new Request("http://localhost/rpc/ping", {
				method: "POST",
				body: "{invalid",
			}),
		);

		expect(response?.status).toBe(400);
	});
});

describe("rpc nested routers", () => {
	const echo = fn({
		schema: z.object({ text: z.string() }),
		handler: async ({ input }) => ({ echo: input.text }),
	});

	const add = fn({
		schema: z.object({ a: z.number(), b: z.number() }),
		handler: async ({ input }) => ({ sum: input.a + input.b }),
	});

	const multiply = fn({
		schema: z.object({ a: z.number(), b: z.number() }),
		handler: async ({ input }) => ({ product: input.a * input.b }),
	});

	const deepLeaf = fn({
		schema: z.object({}),
		handler: async () => ({ reached: true }),
	});

	// Plain nested object (no rpc().router())
	const nestedFunctions = {
		echo,
		math: {
			add,
			multiply,
		},
		deeply: {
			nested: {
				path: {
					leaf: deepLeaf,
				},
			},
		},
	};

	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		const posts = collection("posts").fields(({ f }) => ({
			title: f.textarea({ required: true }),
		}));
		setup = await buildMockApp({
			collections: { posts },
			functions: nestedFunctions,
		});
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("resolves flat procedures in nested router", async () => {
		const handler = createFetchHandler(setup.app);

		const response = await handler(
			new Request("http://localhost/rpc/echo", {
				method: "POST",
				body: JSON.stringify({ text: "hello" }),
			}),
		);

		expect(response?.status).toBe(200);
		expect(await response?.json()).toEqual({ echo: "hello" });
	});

	it("resolves one-level nested procedures", async () => {
		const handler = createFetchHandler(setup.app);

		const addResponse = await handler(
			new Request("http://localhost/rpc/math/add", {
				method: "POST",
				body: JSON.stringify({ a: 3, b: 4 }),
			}),
		);
		expect(addResponse?.status).toBe(200);
		expect(await addResponse?.json()).toEqual({ sum: 7 });

		const mulResponse = await handler(
			new Request("http://localhost/rpc/math/multiply", {
				method: "POST",
				body: JSON.stringify({ a: 5, b: 6 }),
			}),
		);
		expect(mulResponse?.status).toBe(200);
		expect(await mulResponse?.json()).toEqual({ product: 30 });
	});

	it("resolves deeply nested procedures (3+ levels)", async () => {
		const handler = createFetchHandler(setup.app);

		const response = await handler(
			new Request("http://localhost/rpc/deeply/nested/path/leaf", {
				method: "POST",
				body: JSON.stringify({}),
			}),
		);

		expect(response?.status).toBe(200);
		expect(await response?.json()).toEqual({ reached: true });
	});

	it("returns 404 for nonexistent nested path", async () => {
		const handler = createFetchHandler(setup.app);

		const response = await handler(
			new Request("http://localhost/rpc/math/nonexistent", {
				method: "POST",
				body: JSON.stringify({}),
			}),
		);

		expect(response?.status).toBe(404);
	});

	it("returns 404 for partial path (router node, not procedure)", async () => {
		const handler = createFetchHandler(setup.app);

		const response = await handler(
			new Request("http://localhost/rpc/math", {
				method: "POST",
				body: JSON.stringify({}),
			}),
		);

		expect(response?.status).toBe(404);
	});

	it("returns 404 for path beyond a leaf procedure", async () => {
		const handler = createFetchHandler(setup.app);

		const response = await handler(
			new Request("http://localhost/rpc/echo/extra", {
				method: "POST",
				body: JSON.stringify({ text: "test" }),
			}),
		);

		expect(response?.status).toBe(404);
	});
});
