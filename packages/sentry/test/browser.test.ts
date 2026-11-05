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
		expect(event).not.toHaveProperty("breadcrumbs");
		// Sentry otherwise stores the sender's IP as the user and looks up its
		// location.
		expect(event.sdk.settings).toEqual({ infer_ip: "never" });
		expect(event.user).toEqual({ geo: {} });
	});

	it("by default reports the type only and runs nothing on the value", async () => {
		const capture = captureTransport();
		const reporter = createBrowserErrorReporter({
			dsn: DSN,
			send: capture.send,
		});
		let calls = 0;
		const tagged = new RangeError(SECRET);
		Object.defineProperty(tagged, Symbol.toStringTag, {
			get() {
				calls += 1;
				return "Error";
			},
		});
		const proxied = new Proxy(new Error(SECRET), {
			get(target, key, receiver) {
				calls += 1;
				return Reflect.get(target, key, receiver);
			},
			getOwnPropertyDescriptor(target, key) {
				calls += 1;
				return Reflect.getOwnPropertyDescriptor(target, key);
			},
			getPrototypeOf(target) {
				calls += 1;
				return Reflect.getPrototypeOf(target);
			},
		});
		reporter.report(tagged);
		reporter.report(proxied);
		await reporter.flush();

		expect(calls).toBe(0);
		for (const envelope of capture.envelopes) {
			expect(envelope.raw).not.toContain(SECRET);
			const [value] = envelope.items[0]!.payload.exception.values;
			expect(value.type).toBe("Error");
			expect(value).not.toHaveProperty("stacktrace");
		}
		expect(capture.envelopes).toHaveLength(2);
	});

	it("reads the stack of a listed error class and of no other", async () => {
		class ClientFailure extends Error {
			override name = "ClientFailure";
		}
		class Unlisted extends ClientFailure {}
		const capture = captureTransport();
		const options = {
			dsn: DSN,
			send: capture.send,
			formattedStacks: true,
			errorNames: ["ClientFailure"],
		};
		createBrowserErrorReporter(options).report(new ClientFailure());
		const listed = createBrowserErrorReporter({
			...options,
			errorClasses: [ClientFailure],
		});
		listed.report(new ClientFailure());
		listed.report(new Unlisted());
		await listed.flush();

		const values = capture.envelopes.map(
			(envelope) => envelope.items[0]!.payload.exception.values[0],
		);
		expect(values.map((value) => value.type)).toEqual([
			"ClientFailure",
			"ClientFailure",
			"ClientFailure",
		]);
		// Without the listing its prototype is not trusted, so the stack is not read.
		expect(values[0]).not.toHaveProperty("stacktrace");
		expect(values[1].stacktrace.frames.length).toBeGreaterThan(0);
		// A subclass has its own, unlisted prototype.
		expect(values[2]).not.toHaveProperty("stacktrace");
	});

	it("never calls a getter on a listed class's prototype", async () => {
		let calls = 0;
		class Tricky extends Error {}
		Object.defineProperty(Tricky.prototype, "code", {
			get() {
				calls += 1;
				return SECRET;
			},
		});
		const capture = captureTransport();
		const reporter = createBrowserErrorReporter({
			dsn: DSN,
			send: capture.send,
			formattedStacks: true,
			errorClasses: [Tricky],
		});
		reporter.report(new Tricky(SECRET));
		await reporter.flush();
		expect(calls).toBe(0);
		expect(capture.envelopes[0]!.raw).not.toContain(SECRET);
		expect(
			capture.envelopes[0]!.items[0]!.payload.exception.values[0],
		).not.toHaveProperty("stacktrace");
	});

	it("sends a fingerprint of registered labels as fingerprint and tag, and drops any other", async () => {
		const UUID = "550e8400-e29b-41d4-a716-446655440000";
		const capture = captureTransport();
		const reporter = createBrowserErrorReporter({
			dsn: DSN,
			send: capture.send,
			fingerprintLabels: [
				"realtime",
				"rejected",
				"dropped",
				"resource.arm",
				"a",
				"b",
				"c",
				"d",
				"e",
				// Not a valid label itself, so never admitted.
				`token ${SECRET}`,
			],
		});
		const report = (fingerprint: unknown) =>
			reporter.report(new Error("x"), {
				kind: "manual",
				route: "/spaces/$spaceId",
				fingerprint: fingerprint as string[],
			});
		report(["realtime", "rejected", "resource.arm"]);
		report(["realtime", "dropped", "resource.arm"]);
		for (const invalid of [
			// Well-formed, but data rather than a registered label.
			["realtime", UUID],
			["realtime", "Unauthorized"],
			["realtime", "customer.example.com"],
			[`https://app.example.com/${SECRET}`],
			[`token ${SECRET}`],
			["x".repeat(65)],
			["a", "b", "c", "d", "e"],
			[],
			["realtime", 42],
			"realtime",
		]) {
			report(invalid);
		}
		await reporter.flush();

		const events = capture.envelopes.map((e) => e.items[0]!.payload);
		expect(events).toHaveLength(12);
		expect(events[0].fingerprint).toEqual([
			"{{ default }}",
			"realtime",
			"rejected",
			"resource.arm",
		]);
		expect(events[0].tags["questpie.fingerprint"]).toBe(
			"realtime/rejected/resource.arm",
		);
		// Same route, same call site: two groups because the labels differ.
		expect(events[1].fingerprint).toEqual([
			"{{ default }}",
			"realtime",
			"dropped",
			"resource.arm",
		]);
		expect(events[0].transaction).toBe(events[1].transaction);
		for (const event of events.slice(2)) {
			expect(event).not.toHaveProperty("fingerprint");
			expect(event.tags).not.toHaveProperty("questpie.fingerprint");
		}
		for (const envelope of capture.envelopes) {
			expect(envelope.raw).not.toContain(SECRET);
			expect(envelope.raw).not.toContain(UUID);
			expect(envelope.raw).not.toContain("customer.example.com");
		}
	});

	it("sends no fingerprint without registered labels", async () => {
		const capture = captureTransport();
		const reporter = createBrowserErrorReporter({
			dsn: DSN,
			send: capture.send,
		});
		reporter.report(new Error("x"), { fingerprint: ["realtime", "rejected"] });
		await reporter.flush();
		const event = capture.envelopes[0]!.items[0]!.payload;
		expect(event).not.toHaveProperty("fingerprint");
		expect(event.tags).not.toHaveProperty("questpie.fingerprint");
	});

	it("drops a URL without a query passed as the route", async () => {
		const capture = captureTransport();
		const reporter = createBrowserErrorReporter({
			dsn: DSN,
			send: capture.send,
		});
		reporter.report(new Error("x"), {
			route: `https://app.example.com/invite/${SECRET}`,
		});
		reporter.report(new Error("y"), {
			route: `//app.example.com/invite/${SECRET}`,
		});
		await reporter.flush();
		expect(capture.envelopes).toHaveLength(2);
		for (const envelope of capture.envelopes) {
			expect(envelope.raw).not.toContain(SECRET);
		}
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
