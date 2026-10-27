import { afterEach, describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ErrorReportingService } from "questpie/errors";

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
		});
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
		});
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
		const adapter = sentryErrorReporting({ dsn: DSN, send: capture.send });
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
		const adapter = sentryErrorReporting({ dsn: DSN, send: capture.send });
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

	it("is a no-op without a DSN", async () => {
		const adapter = sentryErrorReporting({});
		expect(
			adapter.report(new Error("x"), { source: "manual" }),
		).toBeUndefined();
	});

	it("emits debug-id images under the sanitized filename", async () => {
		const capture = captureTransport();
		const error = new Error("x");
		const topFrame = String(error.stack).split("\n")[1]!;
		(globalThis as any)._sentryDebugIds = {
			[`Error\n${topFrame}`]: "c0ffee00-0000-4000-8000-000000000001",
		};
		const adapter = sentryErrorReporting({ dsn: DSN, send: capture.send });
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

	it("stops sending after shutdown and keeps the core contract on transport failure", async () => {
		const capture = captureTransport();
		const adapter = sentryErrorReporting({ dsn: DSN, send: capture.send });
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
		await sentryErrorReporting({ dsn: DSN, send: capture.send }).report(
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
