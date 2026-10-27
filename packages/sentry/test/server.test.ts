import { afterEach, describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ErrorReportingService } from "questpie/errors";

import { SDK_VERSION } from "../src/envelope.js";
import { sentryErrorReporting } from "../src/server.js";
import {
	ALLOWED_EVENT_KEYS,
	captureTransport,
	DSN,
	IDENT_SECRET,
	SECRET,
} from "./helpers.js";

afterEach(() => {
	delete (globalThis as any)._sentryDebugIds;
});

describe("sentryErrorReporting", () => {
	it("sends an allowlisted event and nothing else on the wire", async () => {
		const capture = captureTransport();
		const adapter = sentryErrorReporting({
			dsn: DSN,
			release: "app@1.2.3",
			environment: "staging",
			send: capture.send,
		})!;
		const cause = new Error(`upstream said ${SECRET}`);
		const error = new Error(
			`query failed: SELECT * FROM t WHERE token='${SECRET}'`,
			{
				cause,
			},
		);
		await adapter.report(error, {
			source: "http",
			kind: "thrown",
			method: "POST",
			route: "items/:id",
			status: 500,
			trace: { traceId: "a".repeat(32), spanId: "b".repeat(16) },
		});

		expect(capture.envelopes).toHaveLength(1);
		const [envelope] = capture.envelopes;
		expect(envelope!.raw).not.toContain(SECRET);
		expect(envelope!.url).toStartWith(
			"https://o1.ingest.example.com/api/42/envelope/",
		);
		expect(envelope!.items.map((i) => i.header.type)).toEqual(["event"]);

		const event = envelope!.items[0]!.payload;
		for (const key of Object.keys(event)) {
			expect(ALLOWED_EVENT_KEYS.has(key)).toBe(true);
		}
		expect(event).not.toHaveProperty("user");
		expect(event).not.toHaveProperty("request");
		expect(event).not.toHaveProperty("breadcrumbs");
		expect(event).not.toHaveProperty("extra");
		expect(event).not.toHaveProperty("server_name");
		expect(event).not.toHaveProperty("modules");
		expect(Object.keys(event.contexts)).toEqual(["trace"]);
		expect(event).toMatchObject({
			platform: "node",
			level: "error",
			release: "app@1.2.3",
			environment: "staging",
			transaction: "POST items/:id",
			tags: {
				"questpie.source": "http",
				"questpie.kind": "thrown",
				"http.method": "POST",
				"http.status_code": "500",
				"http.route": "items/:id",
			},
			contexts: {
				trace: { trace_id: "a".repeat(32), span_id: "b".repeat(16) },
			},
		});
		const values = event.exception.values;
		expect(values).toHaveLength(2);
		expect(values[1].type).toBe("Error");
		expect(values[1].value).toBe("HTTP 500 POST items/:id (thrown)");
		expect(values[1].stacktrace.frames.length).toBeGreaterThan(0);
		expect(values[0].mechanism).toMatchObject({
			source: "cause",
			parent_id: 0,
		});
		for (const frame of values[1].stacktrace.frames) {
			for (const key of Object.keys(frame)) {
				expect([
					"function",
					"filename",
					"abs_path",
					"lineno",
					"colno",
					"in_app",
				]).toContain(key);
			}
		}
	});

	it("keeps identifier-shaped app data out of type, functions and files", async () => {
		const capture = captureTransport();
		const adapter = sentryErrorReporting({
			dsn: DSN,
			send: capture.send,
			errorNames: ["ApiError"],
		})!;
		class TenantError extends Error {
			override name = `${IDENT_SECRET}Error`;
		}
		function AcmeTenantSentinelLoader() {
			return new TenantError("x");
		}
		const outside = new Error("outside root");
		Object.defineProperty(outside, "stack", {
			value: `Error: outside root\n    at load (/srv/${IDENT_SECRET}/x.js:1:1)\n    at run (https://${IDENT_SECRET}.example/app.js:2:2)`,
		});
		class ApiError extends Error {
			override name = "ApiError";
		}
		await adapter.report(AcmeTenantSentinelLoader(), { source: "manual" });
		await adapter.report(outside, { source: "manual" });
		await adapter.report(new ApiError("x"), { source: "manual" });

		for (const envelope of capture.envelopes) {
			expect(envelope.raw).not.toContain(IDENT_SECRET);
		}
		const types = capture.envelopes.map(
			(e) => e.items[0]!.payload.exception.values[0].type,
		);
		expect(types).toEqual(["Error", "Error", "ApiError"]);
		const outsideFrames =
			capture.envelopes[1]!.items[0]!.payload.exception.values[0].stacktrace
				.frames;
		expect(outsideFrames).toEqual([
			{ lineno: 2, colno: 2 },
			{ lineno: 1, colno: 1 },
		]);
	});

	it("reports a returned 5xx without a stack", async () => {
		const capture = captureTransport();
		const adapter = sentryErrorReporting({ dsn: DSN, send: capture.send })!;
		await adapter.report(undefined, {
			source: "http",
			kind: "returned",
			method: "GET",
			route: "health",
			status: 503,
		});
		const [value] = capture.envelopes[0]!.items[0]!.payload.exception.values;
		expect(value.type).toBe("HttpServerError");
		expect(value).not.toHaveProperty("stacktrace");
	});

	it("classifies job attempts", async () => {
		const capture = captureTransport();
		const adapter = sentryErrorReporting({ dsn: DSN, send: capture.send })!;
		await adapter.report(new Error(SECRET), {
			source: "job",
			job: "send-digest",
			final: false,
		});
		const event = capture.envelopes[0]!.items[0]!.payload;
		expect(event.transaction).toBe("job send-digest");
		expect(event.tags).toEqual({
			"questpie.source": "job",
			"questpie.job": "send-digest",
			"questpie.final": "false",
		});
		expect(capture.envelopes[0]!.raw).not.toContain(SECRET);
	});

	it("bounds a custom transport by the deadline and frees its slot", async () => {
		let calls = 0;
		const adapter = sentryErrorReporting({
			dsn: DSN,
			timeoutMs: 5,
			bufferSize: 1,
			send: () => {
				calls += 1;
				if (calls === 1) return new Promise(() => {});
				if (calls === 2) {
					return new Promise((_, reject) =>
						setTimeout(() => reject(new Error("late failure")), 20),
					);
				}
				return Promise.resolve({ statusCode: 200 });
			},
		})!;
		const hung = Promise.resolve(
			adapter.report(new Error("a"), { source: "manual" }),
		).catch(() => "timed out");
		await new Promise((resolve) => setTimeout(resolve, 15));
		const late = Promise.resolve(
			adapter.report(new Error("b"), { source: "manual" }),
		).catch(() => "timed out");
		expect(calls).toBe(2);
		expect(await hung).toBe("timed out");
		expect(await late).toBe("timed out");
		// The late rejection lands after its deadline and must be absorbed.
		await new Promise((resolve) => setTimeout(resolve, 30));
		await adapter.report(new Error("c"), { source: "manual" });
		expect(calls).toBe(3);
		const started = Date.now();
		expect(await adapter.flush!(50)).toBe(true);
		expect(Date.now() - started).toBeLessThan(50);
	});

	it("returns no adapter without a DSN, leaving errors disabled", () => {
		const adapter = sentryErrorReporting({ dsn: undefined });
		expect(adapter).toBeUndefined();
		expect(new ErrorReportingService({ adapter }).enabled).toBe(false);
	});

	it("pins SDK_VERSION to the @sentry/core it is built on", () => {
		const manifest = JSON.parse(
			readFileSync(join(import.meta.dir, "../package.json"), "utf8"),
		);
		const installed = JSON.parse(
			readFileSync(
				join(import.meta.dir, "../node_modules/@sentry/core/package.json"),
				"utf8",
			),
		);
		expect(manifest.dependencies["@sentry/core"]).toBe(SDK_VERSION);
		expect(installed.version).toBe(SDK_VERSION);
	});

	it("emits debug-id images under the sanitized filename", async () => {
		const capture = captureTransport();
		const error = new Error("x");
		const topFrame = String(error.stack).split("\n")[1]!;
		(globalThis as any)._sentryDebugIds = {
			[`Error\n${topFrame}`]: "c0ffee00-0000-4000-8000-000000000001",
		};
		const adapter = sentryErrorReporting({ dsn: DSN, send: capture.send })!;
		await adapter.report(error, { source: "manual" });
		const event = capture.envelopes[0]!.items[0]!.payload;
		const frames = event.exception.values[0].stacktrace.frames;
		expect(event.debug_meta.images).toEqual([
			{
				type: "sourcemap",
				code_file: frames.at(-1).abs_path,
				debug_id: "c0ffee00-0000-4000-8000-000000000001",
			},
		]);
	});

	it("maps each debug id to the chunk that registered it, not its importer", async () => {
		const capture = captureTransport();
		// The snippet in chunk-B runs while entry-A is importing it, so its key
		// stack holds both files, newest (chunk-B) first.
		(globalThis as any)._sentryDebugIds = {
			"Error\n    at chunkInit (/root/assets/chunk-B.js:1:1)\n    at load (/root/assets/entry-A.js:2:2)":
				"bbbbbbbb-0000-4000-8000-00000000000b",
			"Error\n    at entryInit (/root/assets/entry-A.js:1:1)":
				"aaaaaaaa-0000-4000-8000-00000000000a",
		};
		const error = new Error("x");
		Object.defineProperty(error, "stack", {
			value:
				"Error: x\n    at render (/root/assets/chunk-B.js:5:5)\n    at main (/root/assets/entry-A.js:9:9)",
		});
		const adapter = sentryErrorReporting({
			dsn: DSN,
			send: capture.send,
			filenameRoot: "/root",
		})!;
		await adapter.report(error, { source: "manual" });
		const images = capture.envelopes[0]!.items[0]!.payload.debug_meta.images;
		expect(
			Object.fromEntries(
				images.map((image: any) => [image.code_file, image.debug_id]),
			),
		).toEqual({
			"app:///assets/chunk-B.js": "bbbbbbbb-0000-4000-8000-00000000000b",
			"app:///assets/entry-A.js": "aaaaaaaa-0000-4000-8000-00000000000a",
		});
	});

	it("drops a location two registered bundles share instead of mis-symbolicating", async () => {
		const capture = captureTransport();
		// Three keys: Sentry caches the map by key count, and another test
		// registers two.
		(globalThis as any)._sentryDebugIds = {
			"Error\n    at a (https://cdn-a.example/assets/main.js:1:1)":
				"aaaaaaaa-0000-4000-8000-0000000000aa",
			"Error\n    at b (https://cdn-b.example/assets/main.js:1:1)":
				"bbbbbbbb-0000-4000-8000-0000000000bb",
			"Error\n    at c (https://cdn-a.example/assets/other.js:1:1)":
				"cccccccc-0000-4000-8000-0000000000cc",
		};
		const cause = new Error("from b");
		Object.defineProperty(cause, "stack", {
			value:
				"Error: from b\n    at g (https://cdn-b.example/assets/main.js:9:9)",
		});
		const error = new Error("from a", { cause });
		Object.defineProperty(error, "stack", {
			value:
				"Error: from a\n    at f (https://cdn-a.example/assets/main.js:5:5)\n    at h (https://cdn-a.example/assets/other.js:7:7)",
		});
		const adapter = sentryErrorReporting({ dsn: DSN, send: capture.send })!;
		await adapter.report(error, { source: "manual" });

		const event = capture.envelopes[0]!.items[0]!.payload;
		const [causeValue, errorValue] = event.exception.values;
		expect(errorValue.stacktrace.frames).toEqual([
			{
				filename: "app:///assets/other.js",
				abs_path: "app:///assets/other.js",
				in_app: true,
				lineno: 7,
				colno: 7,
			},
			{ lineno: 5, colno: 5 },
		]);
		expect(causeValue.stacktrace.frames).toEqual([{ lineno: 9, colno: 9 }]);
		expect(event.debug_meta.images).toEqual([
			{
				type: "sourcemap",
				code_file: "app:///assets/other.js",
				debug_id: "cccccccc-0000-4000-8000-0000000000cc",
			},
		]);
		expect(capture.envelopes[0]!.raw).not.toContain("cdn-");
	});

	it("stops sending after shutdown and keeps the core contract on transport failure", async () => {
		const capture = captureTransport();
		const adapter = sentryErrorReporting({ dsn: DSN, send: capture.send })!;
		await adapter.shutdown!(100);
		await adapter.report(new Error("late"), { source: "manual" });
		expect(capture.envelopes).toHaveLength(0);

		const failing = new ErrorReportingService({
			adapter: sentryErrorReporting({
				dsn: DSN,
				send: () => Promise.reject(new Error("network down")),
			}),
		});
		expect(() =>
			failing.report(new Error("x"), { source: "manual" }),
		).not.toThrow();
		await failing.shutdown();
	});

	it("registers no global Sentry client or OpenTelemetry provider", async () => {
		const capture = captureTransport();
		await sentryErrorReporting({ dsn: DSN, send: capture.send })!.report(
			new Error("x"),
			{ source: "manual" },
		);
		const otel = Object.getOwnPropertySymbols(globalThis).filter((symbol) =>
			String(symbol.description).startsWith("opentelemetry"),
		);
		expect(otel).toEqual([]);
		expect(
			(globalThis as any).__SENTRY__?.[
				"11.9.0"
			]?.defaultCurrentScope?.getClient?.(),
		).toBeUndefined();
	});

	it("imports only @sentry/core, and nothing Node-only reaches the browser entry", () => {
		const sources = join(import.meta.dir, "../src");
		const files = readdirSync(sources, { recursive: true }).filter((f) =>
			String(f).endsWith(".ts"),
		);
		for (const file of files) {
			const text = readFileSync(join(sources, String(file)), "utf8");
			expect(text).not.toMatch(
				/from "@opentelemetry|from "@sentry\/(node|browser|tanstack)/,
			);
		}
		for (const file of [
			"browser.ts",
			"envelope.ts",
			"recent.ts",
			"sanitize.ts",
		]) {
			const text = readFileSync(join(sources, file), "utf8");
			expect(text).not.toMatch(/from "node:|from "\.\/server|from "questpie/);
		}
	});
});
