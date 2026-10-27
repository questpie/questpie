import { afterEach, describe, expect, it } from "bun:test";

import {
	createBrowserErrorReporter,
	createRouterErrorReporter,
	installGlobalErrorHandlers,
} from "../src/browser.js";
import {
	ALLOWED_EVENT_KEYS,
	captureTransport,
	DSN,
	SECRET,
} from "./helpers.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
	delete (globalThis as any).SENTRY_RELEASE;
});

function fakeTarget() {
	const listeners = new Map<string, Set<(event: any) => void>>();
	return {
		addEventListener(type: string, listener: (event: any) => void) {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type)!.add(listener);
		},
		removeEventListener(type: string, listener: (event: any) => void) {
			listeners.get(type)?.delete(listener);
		},
		dispatch(type: string, event: unknown) {
			for (const listener of listeners.get(type) ?? []) listener(event);
		},
		count: () =>
			[...listeners.values()].reduce((sum, set) => sum + set.size, 0),
	};
}

describe("browser error reporter", () => {
	it("sends a template-only event without page data", async () => {
		const capture = captureTransport();
		const reporter = createBrowserErrorReporter({
			dsn: DSN,
			release: "web@1.0.0",
			send: capture.send,
		});
		reporter.report(new Error(`render failed for ${SECRET}`), {
			kind: "boundary",
			route: "/invite/$token",
		});
		await reporter.flush();

		const [envelope] = capture.envelopes;
		expect(envelope!.raw).not.toContain(SECRET);
		const event = envelope!.items[0]!.payload;
		for (const key of Object.keys(event)) {
			expect(ALLOWED_EVENT_KEYS.has(key)).toBe(true);
		}
		expect(event).toMatchObject({
			platform: "javascript",
			release: "web@1.0.0",
			transaction: "/invite/$token",
			tags: {
				"questpie.source": "browser",
				"questpie.kind": "boundary",
				route: "/invite/$token",
			},
		});
		expect(event).not.toHaveProperty("request");
		expect(event).not.toHaveProperty("user");
		expect(event).not.toHaveProperty("breadcrumbs");
	});

	it("drops a raw URL passed as the route", async () => {
		const capture = captureTransport();
		const reporter = createBrowserErrorReporter({
			dsn: DSN,
			send: capture.send,
		});
		reporter.report(new Error("x"), {
			route: `https://app.example.com/invite/${SECRET}?t=${SECRET}`,
		});
		await reporter.flush();
		expect(capture.envelopes[0]!.raw).not.toContain(SECRET);
		expect(capture.envelopes[0]!.items[0]!.payload).not.toHaveProperty(
			"transaction",
		);
	});

	it("sends with no referrer, no credentials and keepalive", async () => {
		const requests: RequestInit[] = [];
		globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
			requests.push(init);
			return new Response(null, { status: 200 });
		}) as typeof fetch;
		const reporter = createBrowserErrorReporter({ dsn: DSN });
		reporter.report(new Error("x"));
		await reporter.flush();
		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({
			method: "POST",
			referrerPolicy: "no-referrer",
			credentials: "omit",
			keepalive: true,
		});
	});

	it("uses the tunnel instead of the ingest host", async () => {
		const capture = captureTransport();
		const reporter = createBrowserErrorReporter({
			dsn: DSN,
			tunnel: "/monitoring",
			send: capture.send,
		});
		reporter.report(new Error("x"));
		await reporter.flush();
		expect(capture.envelopes[0]!.url).toBe("/monitoring");
		expect(capture.envelopes[0]!.header.dsn).toBe(DSN);
	});

	it("dedupes the same error and caps reports per minute", async () => {
		const capture = captureTransport();
		const reporter = createBrowserErrorReporter({
			dsn: DSN,
			send: capture.send,
			maxReportsPerMinute: 3,
		});
		const error = new Error("loop");
		reporter.report(error, { kind: "boundary" });
		reporter.report(error, { kind: "global" });
		for (let i = 0; i < 10; i++) reporter.report(new Error(String(i)));
		await reporter.flush();
		expect(capture.envelopes).toHaveLength(3);
	});

	it("picks up the bundler-injected release", async () => {
		(globalThis as any).SENTRY_RELEASE = { id: "web@injected" };
		const capture = captureTransport();
		const reporter = createBrowserErrorReporter({
			dsn: DSN,
			send: capture.send,
		});
		reporter.report(new Error("x"));
		await reporter.flush();
		expect(capture.envelopes[0]!.items[0]!.payload.release).toBe(
			"web@injected",
		);
	});

	it("never throws and stops after close", async () => {
		const reporter = createBrowserErrorReporter({
			dsn: DSN,
			send: () => Promise.reject(new Error("offline")),
		});
		expect(() => reporter.report(new Error("x"))).not.toThrow();
		await reporter.close(50);
		const capture = captureTransport();
		const closed = createBrowserErrorReporter({ dsn: DSN, send: capture.send });
		await closed.close();
		closed.report(new Error("late"));
		await closed.flush();
		expect(capture.envelopes).toHaveLength(0);
		expect(() =>
			createBrowserErrorReporter({}).report(new Error("no dsn")),
		).not.toThrow();
	});
});

describe("capture points", () => {
	it("observes uncaught errors and rejections and can be uninstalled", async () => {
		const capture = captureTransport();
		const reporter = createBrowserErrorReporter({
			dsn: DSN,
			send: capture.send,
		});
		const target = fakeTarget();
		const uninstall = installGlobalErrorHandlers(
			reporter,
			target,
			() => "/posts/$postId",
		);
		target.dispatch("error", { error: new Error("uncaught") });
		// Cross-origin "Script error." carries no error object.
		target.dispatch("error", { error: null, message: "Script error." });
		target.dispatch("unhandledrejection", { reason: new Error("rejected") });
		uninstall();
		expect(target.count()).toBe(0);
		target.dispatch("error", { error: new Error("after uninstall") });
		await reporter.flush();

		expect(
			capture.envelopes.map((e) => e.items[0]!.payload.tags["questpie.kind"]),
		).toEqual(["global", "unhandledrejection"]);
		expect(capture.envelopes[0]!.items[0]!.payload.tags.route).toBe(
			"/posts/$postId",
		);
	});

	it("bridges a router onCatch with the matched route template", async () => {
		const capture = captureTransport();
		const reporter = createBrowserErrorReporter({
			dsn: DSN,
			send: capture.send,
		});
		const onCatch = createRouterErrorReporter(reporter, () => {
			throw new Error("router not ready");
		});
		onCatch(new Error("boundary"));
		const withRoute = createRouterErrorReporter(
			reporter,
			() => "/invite/$token",
		);
		withRoute(new Error("boundary 2"));
		await reporter.flush();
		const events = capture.envelopes.map((e) => e.items[0]!.payload);
		expect(events[0]!.tags).toEqual({
			"questpie.source": "browser",
			"questpie.kind": "boundary",
		});
		expect(events[1]!.tags.route).toBe("/invite/$token");
	});
});
