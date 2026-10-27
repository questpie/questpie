import { afterEach, describe, expect, it } from "bun:test";

import { z } from "zod";

import { ApiError, job, route } from "../../src/exports/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import {
	createErrorReportOccurrence,
	ErrorReportingService,
	runInErrorReportOccurrence,
} from "../../src/server/modules/core/integrated/errors/service.js";
import type {
	ErrorReport,
	ErrorReportingAdapter,
} from "../../src/server/modules/core/integrated/errors/types.js";
import { createQueueClient } from "../../src/server/modules/core/integrated/queue/service.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { MockQueueAdapter } from "../utils/mocks/queue.adapter.js";
import { runTestDbMigrations } from "../utils/test-db";

interface Captured {
	error: unknown;
	report: ErrorReport;
}

function capturingAdapter(
	behaviour: (error: unknown) => void | Promise<unknown> = () => {},
) {
	const captured: Captured[] = [];
	let shutdowns = 0;
	const adapter: ErrorReportingAdapter = {
		report(error, report) {
			captured.push({ error, report });
			return behaviour(error);
		},
		shutdown: async () => {
			shutdowns += 1;
		},
	};
	return { adapter, captured, shutdowns: () => shutdowns };
}

const SECRET = "sk_live_SENTINEL_9f8e7d6c";

describe("ErrorReportingService", () => {
	it("is a no-op without an adapter", () => {
		const service = new ErrorReportingService();
		expect(service.enabled).toBe(false);
		expect(() =>
			service.report(new Error("x"), { source: "manual" }),
		).not.toThrow();
	});

	it("swallows a throwing or rejecting adapter", async () => {
		const throwing = new ErrorReportingService({
			adapter: {
				report() {
					throw new Error("adapter broke");
				},
			},
		});
		expect(() =>
			throwing.report(new Error("x"), { source: "manual" }),
		).not.toThrow();

		const rejecting = new ErrorReportingService({
			adapter: { report: () => Promise.reject(new Error("transport down")) },
		});
		rejecting.report(new Error("x"), { source: "manual" });
		await rejecting.flush(100);
	});

	it("validates info down to the documented fields", () => {
		const { adapter, captured } = capturingAdapter();
		const service = new ErrorReportingService({ adapter });
		service.report(new Error("x"), {
			source: "http",
			kind: "thrown",
			method: "brew",
			route: `/invite/${SECRET}?token=${SECRET}`,
			status: 9001,
			job: "has spaces and ${secret}",
			final: true,
			// Not part of the contract — must not travel.
			...({ payload: { secret: SECRET }, url: SECRET } as object),
		});
		expect(captured[0]!.report).toEqual({
			source: "http",
			kind: "thrown",
			method: "OTHER",
			final: true,
		});
	});

	it("drops a route that carries a URL scheme or host", () => {
		const { adapter, captured } = capturingAdapter();
		const service = new ErrorReportingService({ adapter });
		for (const route of [
			`https://app.example.com/invite/${SECRET}`,
			`//app.example.com/invite/${SECRET}`,
		]) {
			service.report(new Error("x"), { source: "manual", route });
		}
		service.report(new Error("x"), { source: "process", route: "items/:id" });
		expect(captured.map((c) => c.report)).toEqual([
			{ source: "manual" },
			{ source: "manual" },
			{ source: "process", route: "items/:id" },
		]);
	});

	it("adds trace correlation only when a span is actually active", () => {
		const { adapter, captured } = capturingAdapter();
		let active: { traceId: string; spanId: string } | undefined;
		const service = new ErrorReportingService({ adapter }, () => active);
		service.report(new Error("a"), { source: "manual" });
		active = { traceId: "a".repeat(32), spanId: "b".repeat(16) };
		service.report(new Error("b"), { source: "manual" });
		active = { traceId: SECRET, spanId: SECRET };
		service.report(new Error("c"), { source: "manual" });
		expect(captured.map((c) => c.report.trace)).toEqual([
			undefined,
			{ traceId: "a".repeat(32), spanId: "b".repeat(16) },
			undefined,
		]);
	});

	it("dedupes the same error only within one occurrence", () => {
		const { adapter, captured } = capturingAdapter();
		const service = new ErrorReportingService({ adapter });
		const error = new Error("shared");

		const first = createErrorReportOccurrence();
		runInErrorReportOccurrence(first, () => {
			service.report(error, { source: "manual" });
			service.report(error, { source: "http" });
		});
		runInErrorReportOccurrence(createErrorReportOccurrence(), () =>
			service.report(error, { source: "http" }),
		);
		// Re-entering the first occurrence later still dedupes.
		runInErrorReportOccurrence(first, () =>
			service.report(error, { source: "http" }),
		);
		// Outside any occurrence every call reports.
		service.report(error, { source: "manual" });
		service.report(error, { source: "manual" });

		expect(captured).toHaveLength(4);
	});

	it("bounds pending reports and releases slots after the deadline", async () => {
		const { adapter, captured } = capturingAdapter(() => new Promise(() => {}));
		const service = new ErrorReportingService({
			adapter,
			maxPending: 2,
			timeoutMs: 20,
		});
		for (let i = 0; i < 5; i++)
			service.report(new Error(`${i}`), {
				source: "manual",
			});
		expect(captured).toHaveLength(2);
		await new Promise((resolve) => setTimeout(resolve, 40));
		service.report(new Error("after"), { source: "manual" });
		expect(captured).toHaveLength(3);
	});

	it("does not mark an error as reported when it was dropped for capacity", async () => {
		const { adapter, captured } = capturingAdapter(() => new Promise(() => {}));
		const service = new ErrorReportingService({
			adapter,
			maxPending: 1,
			timeoutMs: 20,
		});
		const error = new Error("dropped first");
		const occurrence = createErrorReportOccurrence();
		runInErrorReportOccurrence(occurrence, () => {
			service.report(new Error("fills the slot"), { source: "manual" });
			service.report(error, { source: "manual" });
		});
		expect(captured).toHaveLength(1);
		await new Promise((resolve) => setTimeout(resolve, 40));
		runInErrorReportOccurrence(occurrence, () =>
			service.report(error, { source: "http" }),
		);
		expect(captured.map((c) => c.error)).toContain(error);
	});

	it("drains, shuts the adapter down once, and ignores later reports", async () => {
		let delivered = 0;
		const { adapter, captured, shutdowns } = capturingAdapter(
			() =>
				new Promise<void>((resolve) =>
					setTimeout(() => {
						delivered += 1;
						resolve();
					}, 10),
				),
		);
		const service = new ErrorReportingService({ adapter });
		service.report(new Error("pending"), { source: "manual" });
		await service.shutdown();
		await service.shutdown();
		expect(delivered).toBe(1);
		expect(shutdowns()).toBe(1);
		service.report(new Error("late"), { source: "manual" });
		expect(captured).toHaveLength(1);
		expect(service.enabled).toBe(false);
	});

	it("calls straight through when there is no occurrence", () => {
		const { adapter, captured } = capturingAdapter();
		const service = new ErrorReportingService({ adapter });
		const error = new Error("x");
		const result = runInErrorReportOccurrence(undefined, () => {
			service.report(error, { source: "manual" });
			service.report(error, { source: "manual" });
			return "done";
		});
		expect(result).toBe("done");
		expect(captured).toHaveLength(2);
	});

	it("refuses reports from the moment shutdown starts and shuts down once", async () => {
		let release!: () => void;
		let shutdowns = 0;
		const captured: unknown[] = [];
		const service = new ErrorReportingService({
			adapter: {
				report(error) {
					captured.push(error);
					return new Promise<void>((resolve) => {
						release = resolve;
					});
				},
				shutdown: async () => {
					shutdowns += 1;
				},
			},
		});
		service.report(new Error("in flight"), { source: "manual" });
		const first = service.shutdown();
		const second = service.shutdown();
		expect(second).toBe(first);
		expect(service.enabled).toBe(false);
		service.report(new Error("during teardown"), { source: "manual" });
		expect(captured).toHaveLength(1);
		expect(shutdowns).toBe(0);
		release();
		await Promise.all([first, second, service.shutdown()]);
		expect(shutdowns).toBe(1);
	});

	it("never rejects from flush or shutdown when the adapter throws or rejects", async () => {
		for (const fail of [
			() => {
				throw new Error("sync");
			},
			() => Promise.reject(new Error("async")),
		]) {
			const service = new ErrorReportingService({
				adapter: { report() {}, flush: fail as any, shutdown: fail as any },
			});
			await expect(service.flush(50)).resolves.toBeUndefined();
			await expect(service.shutdown()).resolves.toBeUndefined();
		}
	});

	it("bounds shutdown by its deadline even if the adapter hangs", async () => {
		const service = new ErrorReportingService({
			adapter: {
				report: () => new Promise(() => {}),
				shutdown: () => new Promise(() => {}),
			},
			shutdownTimeoutMs: 30,
		});
		service.report(new Error("stuck"), { source: "manual" });
		const started = Date.now();
		await service.shutdown();
		expect(Date.now() - started).toBeLessThan(500);
	});
});

describe("HTTP error reporting", () => {
	let cleanup: (() => Promise<void>) | undefined;

	afterEach(async () => {
		await cleanup?.();
		cleanup = undefined;
	});

	async function setup(
		routes: Record<string, unknown>,
		behaviour?: (error: unknown) => void | Promise<unknown>,
	) {
		const rec = capturingAdapter(behaviour);
		const built = await buildMockApp(
			{ routes: routes as any },
			{ errors: { adapter: rec.adapter } },
		);
		cleanup = built.cleanup;
		await runTestDbMigrations(built.app);
		return { app: built.app, handler: createFetchHandler(built.app), ...rec };
	}

	it("reports a thrown 500 once with the route template and the original error", async () => {
		const thrown = new Error(`database said ${SECRET}`);
		const { handler, captured, app } = await setup({
			"items/[id]": route()
				.get()
				.raw()
				.handler(() => {
					throw thrown;
				}),
		});

		const response = await handler(
			new Request(`http://localhost/items/${SECRET}?token=${SECRET}`),
		);

		expect(response?.status).toBe(500);
		expect(app.errors.enabled).toBe(true);
		expect(app.observability.enabled).toBe(false);
		expect(captured).toHaveLength(1);
		expect(captured[0]!.error).toBe(thrown);
		expect(captured[0]!.report).toEqual({
			source: "http",
			kind: "thrown",
			method: "GET",
			route: expect.any(String),
			status: 500,
		});
		expect(captured[0]!.report.route).not.toContain(SECRET);
	});

	it("reports the same error object once per request, even after a manual report", async () => {
		const shared = new Error("shared");
		const { handler, captured } = await setup({
			shared: route()
				.get()
				.raw()
				.handler(({ errors }: any) => {
					errors.report(shared, { source: "manual" });
					throw shared;
				}),
		});

		await handler(new Request("http://localhost/shared"));
		await handler(new Request("http://localhost/shared"));

		expect(captured.map((c) => c.report.source)).toEqual(["manual", "manual"]);
		expect(captured.every((c) => c.error === shared)).toBe(true);
	});

	it("reports a failure while resolving the request context", async () => {
		const failure = new Error(`context resolver said ${SECRET}`);
		const rec = capturingAdapter();
		const built = await buildMockApp(
			{
				routes: {
					ctx: route()
						.get()
						.raw()
						.handler(() => new Response("unreachable")),
				},
				config: {
					app: {
						context: () => {
							throw failure;
						},
					},
				},
			} as any,
			{ errors: { adapter: rec.adapter } },
		);
		cleanup = built.cleanup;
		await runTestDbMigrations(built.app);

		const response = await createFetchHandler(built.app)(
			new Request("http://localhost/ctx"),
		);

		expect(response?.status).toBe(500);
		expect(rec.captured).toHaveLength(1);
		expect(rec.captured[0]!.error).toBe(failure);
		expect(rec.captured[0]!.report).toMatchObject({
			kind: "thrown",
			route: "ctx",
			status: 500,
		});
	});

	it("does not report expected 4xx outcomes or unmatched routes", async () => {
		const { handler, captured } = await setup({
			forbidden: route()
				.get()
				.raw()
				.handler(() => {
					throw ApiError.forbidden({ operation: "read", resource: "x" });
				}),
		});

		expect(
			(await handler(new Request("http://localhost/forbidden")))?.status,
		).toBe(403);
		expect(
			(await handler(new Request(`http://localhost/invite/${SECRET}`)))?.status,
		).toBe(404);
		expect(captured).toHaveLength(0);
	});

	it("reports a returned 500 without inventing an error", async () => {
		const { handler, captured } = await setup({
			degraded: route()
				.get()
				.raw()
				.handler(() => new Response("down", { status: 503 })),
		});

		const response = await handler(new Request("http://localhost/degraded"));

		expect(response?.status).toBe(503);
		expect(await response?.text()).toBe("down");
		expect(captured).toHaveLength(1);
		expect(captured[0]!.error).toBeUndefined();
		expect(captured[0]!.report).toMatchObject({
			kind: "returned",
			status: 503,
		});
	});

	it("keeps the response identical when the reporter throws or hangs", async () => {
		for (const behaviour of [
			() => {
				throw new Error("reporter broke");
			},
			() => new Promise(() => {}),
		]) {
			const { handler } = await setup(
				{
					boom: route()
						.post()
						.raw()
						.handler(() => {
							throw new Error("boom");
						}),
				},
				behaviour,
			);
			const response = await handler(
				new Request("http://localhost/boom", { method: "POST" }),
			);
			expect(response?.status).toBe(500);
			expect(await response?.json()).toMatchObject({
				error: { code: "INTERNAL_SERVER_ERROR" },
			});
			await cleanup?.();
			cleanup = undefined;
		}
	});

	it("reports a stream that fails after the response was handed out", async () => {
		const streamError = new Error("stream broke");
		const { handler, captured } = await setup({
			stream: route()
				.get()
				.raw()
				.handler(
					() =>
						new Response(
							new ReadableStream({
								pull(controller) {
									controller.error(streamError);
								},
							}),
						),
				),
		});

		const response = await handler(new Request("http://localhost/stream"));
		expect(response?.status).toBe(200);
		await expect(response!.text()).rejects.toBe(streamError);

		expect(captured).toHaveLength(1);
		expect(captured[0]!.error).toBe(streamError);
		expect(captured[0]!.report).toMatchObject({
			kind: "stream",
			status: 200,
			method: "GET",
		});
	});

	it("does not report a failure after the client aborted, but still answers 500", async () => {
		const abortDuringHandler = new AbortController();
		const abortDuringContext = new AbortController();
		const rec = capturingAdapter();
		const built = await buildMockApp(
			{
				routes: {
					handler: route()
						.get()
						.raw()
						.handler(() => {
							abortDuringHandler.abort();
							throw new Error("cancelled work failed");
						}),
					ctx: route()
						.get()
						.raw()
						.handler(() => new Response("unreachable")),
				},
				config: {
					app: {
						context: ({ request }: { request: Request }) => {
							if (new URL(request.url).pathname === "/ctx") {
								abortDuringContext.abort();
								throw new Error("context cancelled");
							}
							return {};
						},
					},
				},
			} as any,
			{ errors: { adapter: rec.adapter } },
		);
		cleanup = built.cleanup;
		await runTestDbMigrations(built.app);
		const handler = createFetchHandler(built.app);

		const fromHandler = await handler(
			new Request("http://localhost/handler", {
				signal: abortDuringHandler.signal,
			}),
		);
		const fromContext = await handler(
			new Request("http://localhost/ctx", {
				signal: abortDuringContext.signal,
			}),
		);

		expect(fromHandler?.status).toBe(500);
		expect(fromContext?.status).toBe(500);
		expect(rec.captured).toHaveLength(0);
	});

	it("does not report a stream cancelled by the client", async () => {
		const abort = new AbortController();
		const { handler, captured } = await setup({
			slow: route()
				.get()
				.raw()
				.handler(
					() =>
						new Response(
							new ReadableStream({
								pull: () => new Promise(() => {}),
							}),
						),
				),
		});

		const response = await handler(
			new Request("http://localhost/slow", { signal: abort.signal }),
		);
		const reading = response!.text().catch(() => undefined);
		abort.abort();
		await reading;

		expect(captured).toHaveLength(0);
	});
});

describe("queue error reporting", () => {
	let cleanup: (() => Promise<void>) | undefined;

	afterEach(async () => {
		await cleanup?.();
		cleanup = undefined;
	});

	const failing = job({
		name: "explode",
		schema: z.object({}),
		handler: async () => {
			throw new Error("handler blew up");
		},
	});

	const secretFailing = job({
		name: "secret-explode",
		schema: z.object({ token: z.string() }),
		handler: async ({ payload }) => {
			throw new Error(`provider rejected ${payload.token}`);
		},
	});

	async function setup(jobs: Record<string, unknown>) {
		const rec = capturingAdapter();
		const built = await buildMockApp(
			{ jobs: jobs as any },
			{
				errors: { adapter: rec.adapter },
				secret: "queue-secret-root-key-at-least-32-bytes",
			},
		);
		cleanup = built.cleanup;
		await runTestDbMigrations(built.app);
		await built.app.queue.listen({ gracefulShutdown: false });
		const handlerFor = (name: string) =>
			(built.app.mocks.queue as any).workers.find((w: any) => w.handlers[name])
				.handlers[name] as (job: Record<string, unknown>) => Promise<void>;
		return { app: built.app, handlerFor, ...rec };
	}

	it("reports every attempt with the attempt classification and keeps the thrown error", async () => {
		const { handlerFor, captured } = await setup({ failing });
		const handler = handlerFor("explode");

		const first = await handler({
			id: "1",
			data: {},
			finalAttempt: false,
		}).catch((error) => error);
		const second = await handler({
			id: "1",
			data: {},
			finalAttempt: true,
		}).catch((error) => error);

		expect(first).toBeInstanceOf(Error);
		expect((first as Error).message).toBe("handler blew up");
		expect(captured.map((c) => c.error)).toEqual([first, second]);
		expect(captured.map((c) => c.report)).toEqual([
			{ source: "job", job: "explode", final: false },
			{ source: "job", job: "explode", final: true },
		]);
	});

	it("reports a reused error once per attempt, even after a manual report", async () => {
		const shared = new Error("same object every attempt");
		const reused = job({
			name: "reused",
			schema: z.object({}),
			handler: async ({ errors }: any) => {
				errors.report(shared, { source: "manual" });
				throw shared;
			},
		});
		const { handlerFor, captured } = await setup({ reused });
		const handler = handlerFor("reused");

		await handler({ id: "1", data: {}, finalAttempt: false }).catch(() => {});
		await handler({ id: "1", data: {}, finalAttempt: true }).catch(() => {});

		expect(captured.map((c) => c.report.source)).toEqual(["manual", "manual"]);
	});

	it("reports a context-resolution failure and rethrows the original", async () => {
		const contextFailure = new Error(`context store said ${SECRET}`);
		const rec = capturingAdapter();
		const errors = new ErrorReportingService({ adapter: rec.adapter });
		const adapter = new MockQueueAdapter();
		const queue = createQueueClient({ failing }, adapter, {
			createContext: () => Promise.reject(contextFailure),
			getApp: () => ({ errors }),
		});
		await queue.listen({ gracefulShutdown: false } as any);
		const handler = (adapter as any).workers.find(
			(w: any) => w.handlers.explode,
		).handlers.explode as (job: Record<string, unknown>) => Promise<void>;

		const plain = await handler({
			id: "1",
			data: {},
			finalAttempt: true,
		}).catch((error) => error);
		const secret = await handler({
			id: "2",
			data: {},
			secretPayload: true,
			finalAttempt: true,
		}).catch((error) => error);
		const aborted = new AbortController();
		aborted.abort();
		await handler({ id: "3", data: {}, signal: aborted.signal }).catch(
			() => {},
		);

		expect(plain).toBe(contextFailure);
		expect(secret).toBe(contextFailure);
		expect(rec.captured).toHaveLength(2);
		expect(rec.captured[0]).toEqual({
			error: contextFailure,
			report: { source: "job", job: "explode", final: true },
		});
		const redacted = rec.captured[1]!.error as Error;
		expect(redacted.message).toBe("QUESTPIE Queue secret job handling failed");
		expect(String(redacted.stack)).not.toContain(SECRET);
		await queue.stop();
	});

	it("does not report a cancelled attempt", async () => {
		const { handlerFor, captured } = await setup({ failing });
		const abort = new AbortController();
		abort.abort();
		await handlerFor("explode")({
			id: "1",
			data: {},
			signal: abort.signal,
		}).catch(() => {});
		expect(captured).toHaveLength(0);
	});

	it("only ever hands the redacted error of a secret job to the reporter", async () => {
		const { app, captured } = await setup({ secretFailing });
		await app.queue.secretFailing.publish(
			{ token: SECRET },
			{ idempotencyKey: "secret-explode:one", secretPayload: true },
		);
		const [physical] = app.mocks.queue.getJobs();
		await app.mocks.queue.processJob(physical!.id).catch(() => {});

		expect(captured).toHaveLength(1);
		const reported = captured[0]!.error as Error;
		expect(reported.message).toBe("QUESTPIE Queue secret job handling failed");
		expect(reported.cause).toBeUndefined();
		expect(String(reported.stack)).not.toContain(SECRET);
		expect(JSON.stringify(captured[0]!.report)).not.toContain(SECRET);
	});
});

describe("error reporting lifecycle", () => {
	it("drains and shuts the adapter down on app.destroy()", async () => {
		const rec = capturingAdapter();
		const built = await buildMockApp({}, { errors: { adapter: rec.adapter } });
		expect(built.app.errors).toBeInstanceOf(ErrorReportingService);
		await built.cleanup();
		expect(rec.shutdowns()).toBe(1);
	});
});
