import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { z } from "zod";

import { collection, global, route, service } from "../../src/exports/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";

function requireRecord(
	value: unknown,
	label: string,
): Record<PropertyKey, unknown> {
	if (!value || typeof value !== "object") {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<PropertyKey, unknown>;
}

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

	it("keeps request services alive until a raw response body closes", async () => {
		let disposed = false;
		let disposals = 0;
		const streamSetup = await buildMockApp({
			services: {
				probe: service()
					.lifecycle("request")
					.create(() => ({ marker: "request-probe" }))
					.dispose(() => {
						disposed = true;
						disposals += 1;
					}),
			},
			routes: {
				stream: route()
					.get()
					.raw()
					.handler(({ request, services }) => {
						void services.probe;
						const mode = new URL(request.url).searchParams.get("mode");
						const response = new Response(
							new ReadableStream<Uint8Array>({
								pull(controller) {
									if (mode === "cancel") return;
									if (mode === "error") {
										controller.error(new Error("stream failed"));
										return;
									}
									controller.enqueue(
										new TextEncoder().encode(String(disposed)),
									);
									controller.close();
								},
							}),
						);
						if (mode === "locked") {
							void response.body!.getReader();
						}
						return response;
					}),
			},
		});
		try {
			const handler = createFetchHandler(streamSetup.app);
			const response = await handler(new Request("http://localhost/stream"));

			expect(disposed).toBe(false);
			expect(await response?.text()).toBe("false");
			expect(disposals).toBe(1);

			disposed = false;
			const cancelled = await handler(
				new Request("http://localhost/stream?mode=cancel"),
			);
			await cancelled?.body?.cancel("test cancellation");
			expect(disposals).toBe(2);

			disposed = false;
			const failed = await handler(
				new Request("http://localhost/stream?mode=error"),
			);
			await expect(failed?.text()).rejects.toThrow("stream failed");
			expect(disposals).toBe(3);

			disposed = false;
			const locked = await handler(
				new Request("http://localhost/stream?mode=locked"),
			);
			expect(locked?.status).toBe(500);
			expect(disposals).toBe(4);
		} finally {
			await streamSetup.cleanup();
		}
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

	it("disposes context-resolver request services on malformed JSON and 405 exits", async () => {
		let creations = 0;
		let disposals = 0;
		const earlyExitSetup = await buildMockApp({
			services: {
				probe: service()
					.lifecycle("request")
					.create(() => ({ id: ++creations }))
					.dispose(() => {
						disposals += 1;
					}),
			},
			routes: {
				ping: route()
					.post()
					.schema(z.object({ message: z.string() }))
					.handler(({ input }) => input),
			},
			config: {
				app: {
					context: async (context) => {
						const services = requireRecord(
							requireRecord(context, "context").services,
							"context.services",
						);
						requireRecord(services.probe, "context.services.probe");
						return { tenantId: "tenant-a" };
					},
				},
			},
		});
		try {
			const handler = createFetchHandler(earlyExitSetup.app);
			const malformed = await handler(
				new Request("http://localhost/ping", {
					method: "POST",
					body: "{invalid",
				}),
			);
			expect(malformed?.status).toBe(400);
			expect({ creations, disposals }).toEqual({ creations: 1, disposals: 1 });

			const wrongMethod = await handler(
				new Request("http://localhost/ping", { method: "GET" }),
			);
			expect(wrongMethod?.status).toBe(405);
			expect({ creations, disposals }).toEqual({ creations: 2, disposals: 2 });
		} finally {
			await earlyExitSetup.cleanup();
		}
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
