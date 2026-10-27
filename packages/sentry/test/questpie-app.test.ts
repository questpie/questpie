import { afterEach, describe, expect, it } from "bun:test";

import { route } from "questpie";
import { createFetchHandler } from "questpie/http";
import { ObservabilityService } from "questpie/observability";
import { job } from "questpie/services";
import { z } from "zod";

import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../../questpie/test/utils/test-db";
import { sentryErrorReporting } from "../src/server.js";
import { captureTransport, DSN, SECRET } from "./helpers.js";

/**
 * End to end: a real app, the framework's own HTTP and queue boundaries, and
 * the serialized envelope that would leave the process. The sentinel is put
 * everywhere a secret realistically lives — message, cause, URL path and
 * query, headers, cookie, body, job payload — and must appear nowhere.
 */
describe("QUESTPIE + @questpie/sentry", () => {
	let cleanup: (() => Promise<void>) | undefined;

	afterEach(async () => {
		await cleanup?.();
		cleanup = undefined;
	});

	async function setup(
		definition: Record<string, unknown>,
		capture = captureTransport(),
	) {
		const built = await buildMockApp(
			definition as any,
			{
				errors: {
					adapter: sentryErrorReporting({
						dsn: DSN,
						release: "app@1.0.0",
						environment: "test",
						filenameRoot: process.cwd(),
						send: capture.send,
					}),
				},
				secret: "queue-secret-root-key-at-least-32-bytes",
			} as any,
		);
		cleanup = built.cleanup;
		await runTestDbMigrations(built.app);
		return { app: built.app, capture };
	}

	const routes = {
		"items/[id]": route()
			.post()
			.raw()
			.handler(async ({ request }) => {
				const body = await request.text();
				throw new Error(`failed for ${body}`, {
					cause: new Error(`db said ${SECRET}`),
				});
			}),
		ok: route()
			.get()
			.raw()
			.handler(() => new Response("ok")),
	};

	it("keeps every request secret out of the envelope", async () => {
		const { app, capture } = await setup({ routes });
		const handler = createFetchHandler(app);

		const response = await handler(
			new Request(`http://localhost/items/${SECRET}?token=${SECRET}`, {
				method: "POST",
				headers: {
					authorization: `Bearer ${SECRET}`,
					cookie: `session=${SECRET}`,
					"x-request-id": "req-1",
				},
				body: JSON.stringify({ password: SECRET }),
			}),
		);
		expect(response?.status).toBe(500);
		expect(await response?.text()).not.toContain(SECRET);
		expect(
			(await handler(new Request(`http://localhost/invite/${SECRET}`)))?.status,
		).toBe(404);
		await app.errors.flush(1_000);

		expect(capture.envelopes).toHaveLength(1);
		const [envelope] = capture.envelopes;
		expect(envelope!.raw).not.toContain(SECRET);
		expect(envelope!.raw).not.toContain("req-1");
		expect(envelope!.raw).not.toContain("localhost");
		const event = envelope!.items[0]!.payload;
		expect(event.tags["http.route"]).toBe("items/:id");
		expect(event.transaction).toBe("POST items/:id");
		expect(event.exception.values).toHaveLength(2);
		const frames = event.exception.values[1].stacktrace.frames;
		expect(
			frames.some((f: any) => String(f.filename).startsWith("app:///")),
		).toBe(true);
	});

	it("reports concurrent failures independently", async () => {
		const { app, capture } = await setup({
			routes: {
				"a/[id]": route()
					.get()
					.raw()
					.handler(() => {
						throw new Error("a");
					}),
				"b/[id]": route()
					.get()
					.raw()
					.handler(async () => {
						await new Promise((r) => setTimeout(r, 5));
						throw new Error("b");
					}),
			},
		});
		const handler = createFetchHandler(app);
		await Promise.all(
			Array.from({ length: 20 }, (_, i) =>
				handler(new Request(`http://localhost/${i % 2 ? "b" : "a"}/${i}`)),
			),
		);
		await app.errors.flush(2_000);
		const routesSeen = capture.envelopes.map(
			(e) => e.items[0]!.payload.tags["http.route"],
		);
		expect(routesSeen.filter((r) => r === "a/:id")).toHaveLength(10);
		expect(routesSeen.filter((r) => r === "b/:id")).toHaveLength(10);
		const ids = new Set(capture.envelopes.map((e) => e.header.event_id));
		expect(ids.size).toBe(20);
	});

	it("never sends a secret job payload or its original error", async () => {
		const deliver = job({
			name: "deliver",
			schema: z.object({ token: z.string() }),
			handler: async ({ payload }) => {
				throw new Error(`provider rejected ${payload.token}`);
			},
		});
		const { app, capture } = await setup({ jobs: { deliver } });
		await app.queue.listen({ gracefulShutdown: false });
		await app.queue.deliver.publish(
			{ token: SECRET },
			{ idempotencyKey: "deliver:one", secretPayload: true },
		);
		const [physical] = app.mocks.queue.getJobs();
		await app.mocks.queue.processJob(physical!.id).catch(() => {});
		await app.errors.flush(1_000);

		expect(capture.envelopes).toHaveLength(1);
		expect(capture.envelopes[0]!.raw).not.toContain(SECRET);
		expect(capture.envelopes[0]!.items[0]!.payload.tags).toMatchObject({
			"questpie.source": "job",
			"questpie.job": "deliver",
			"questpie.final": "true",
		});
	});

	it("coexists with a metrics-only observability adapter", async () => {
		const metrics: string[] = [];
		const { app, capture } = await setup({ routes });
		// The mock builder has no observability override; install it the way
		// the framework's own span tests do.
		app.observability = new ObservabilityService({
			adapter: {
				// Tracing deliberately off: errors must not depend on spans.
				tracer: () => ({
					startActiveSpan: (_n: string, _o: unknown, fn: any) =>
						fn({
							setAttribute() {},
							setAttributes() {},
							recordError() {},
							addEvent() {},
							end() {},
						}),
				}),
				meter: () => ({
					createCounter: () => ({ add: () => {} }),
					createHistogram: (name: string) => ({
						record: () => metrics.push(name),
					}),
				}),
				shutdown: async () => {},
			},
		});
		const handler = createFetchHandler(app);
		await handler(
			new Request("http://localhost/items/1", { method: "POST", body: "x" }),
		);
		await handler(new Request("http://localhost/ok"));
		await app.errors.flush(1_000);

		expect(metrics).toEqual([
			"http.server.request.duration",
			"http.server.request.duration",
		]);
		expect(capture.envelopes).toHaveLength(1);
		expect(capture.envelopes[0]!.items[0]!.payload).not.toHaveProperty(
			"contexts",
		);
	});

	it("delivers pending reports on app.destroy()", async () => {
		const delivered: string[] = [];
		const slow = {
			envelopes: [] as unknown[],
			send: async (request: { body: string | Uint8Array }) => {
				await new Promise((r) => setTimeout(r, 50));
				delivered.push(String(request.body));
				return { statusCode: 200 };
			},
		};
		const { app } = await setup({ routes }, slow as any);
		await createFetchHandler(app)(
			new Request("http://localhost/items/1", { method: "POST", body: "x" }),
		);
		expect(delivered).toHaveLength(0);
		await cleanup!();
		cleanup = undefined;
		expect(delivered).toHaveLength(1);
	});
});
