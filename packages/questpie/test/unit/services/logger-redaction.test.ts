import { describe, expect, it } from "bun:test";

import { runWithContext } from "../../../src/server/config/context.js";
import { LoggerService } from "../../../src/server/modules/core/integrated/logger/service.js";
import type { LoggerAdapter } from "../../../src/server/modules/core/integrated/logger/types.js";
import { createCapturingLogger } from "../../utils/capturing-logger.js";

describe("logger structured-field redaction", () => {
	it("redacts nested credential keys without discarding diagnostics", () => {
		const log = createCapturingLogger({ captureMessages: false });
		const logger = new LoggerService({ adapter: log.adapter });
		logger.info("request failed", {
			event: "request.failed",
			requestId: "req-1",
			request: {
				headers: { Authorization: "Bearer private", cookie: "private" },
				body: { password: "private" },
			},
			auth: {
				accessToken: "private",
				client_secret: "private",
				credentials: { "x-api-key": "private" },
			},
		});

		expect(log.records[0]?.args?.[0]).toEqual({
			event: "request.failed",
			requestId: "req-1",
			request: {
				headers: { Authorization: "[Redacted]", cookie: "[Redacted]" },
				body: { password: "[Redacted]" },
			},
			auth: {
				accessToken: "[Redacted]",
				client_secret: "[Redacted]",
				credentials: { "x-api-key": "[Redacted]" },
			},
		});
	});

	it("safely snapshots enumerable fields on custom objects", () => {
		class CredentialEnvelope {
			token = "private-token";
			nested = { error: new Error("private-error") };
			self: CredentialEnvelope = this;

			get unsafeGetter(): never {
				throw new Error("getter must not run");
			}
		}
		const envelope = new CredentialEnvelope();
		const log = createCapturingLogger({ captureMessages: false });
		const logger = new LoggerService({ adapter: log.adapter });

		logger.info("custom object", { envelope });

		const record = log.records[0]?.args?.[0] as
			| { envelope: Record<string, any> }
			| undefined;
		expect(record).toBeDefined();
		const observed = record!.envelope;
		expect(observed.token).toBe("[Redacted]");
		expect(observed.nested.error).toEqual({
			type: "Error",
			message: "[Redacted]",
		});
		expect(observed.self).toBe(observed);
		expect("unsafeGetter" in observed).toBe(false);
		expect(envelope.token).toBe("private-token");
		expect(envelope.nested.error.message).toBe("private-error");
	});

	it("does not invoke caller getters while adding request context", async () => {
		const log = createCapturingLogger({ captureMessages: false });
		const logger = new LoggerService({ adapter: log.adapter });
		const structured = Object.defineProperty(
			{ token: "private-token" },
			"unsafeGetter",
			{
				enumerable: true,
				get: () => {
					throw new Error("getter must not run");
				},
			},
		);

		await runWithContext({ requestId: "req-safe" }, async () => {
			logger.info("contextual object", structured);
		});

		expect(log.records[0]?.args?.[0]).toEqual({
			token: "[Redacted]",
			requestId: "req-safe",
		});
	});

	it("fails closed for error-like getters, Error subclasses, and proxies", async () => {
		class UnsafeError extends Error {
			get name(): never {
				throw new Error("name getter must not run");
			}
		}
		const proxy = new Proxy(
			{},
			{
				ownKeys: () => {
					throw new Error("proxy trap");
				},
			},
		);
		const log = createCapturingLogger({ captureMessages: false });
		const logger = new LoggerService({ adapter: log.adapter });
		await runWithContext({ requestId: "req-safe" }, async () => {
			logger.error("safe", {
				error: Object.defineProperty({ message: "secret" }, "name", {
					enumerable: true,
					get: () => {
						throw new Error("name getter must not run");
					},
				}),
				cause: new UnsafeError("secret"),
				proxy,
			});
		});
		const record = log.records[0]?.args?.[0] as Record<string, any>;
		expect(record.error).toEqual({ message: "[Redacted]" });
		expect(record.cause).toEqual({ type: "Error", message: "[Redacted]" });
		expect(record.proxy).toBe("[Unserializable]");
	});

	it("preserves supported non-plain diagnostics for both sinks", async () => {
		const log = createCapturingLogger({ captureMessages: false });
		const emitted: any[] = [];
		const logger = new LoggerService({
			adapter: log.adapter,
			redact: ["map.customerEmail"],
		});
		await runWithContext(
			{
				app: {
					observability: { emitLog: (record: unknown) => emitted.push(record) },
				},
			},
			async () =>
				logger.info("diagnostics", {
					date: new Date("2026-01-02T03:04:05.000Z"),
					url: new URL(
						"https://user:password@example.com/path?token=private&safe=ok",
					),
					map: new Map([
						["authorization", "private"],
						["customerEmail", "private@example.com"],
					]),
					set: new Set(["value"]),
					bytes: new Uint8Array([1, 2, 3]),
				}),
		);
		const diagnostics = log.records[0]?.args?.[0];
		expect(diagnostics).toMatchObject({
			date: { type: "Date", value: "2026-01-02T03:04:05.000Z" },
			url: {
				type: "URL",
				value: "https://example.com/path?token=%5BRedacted%5D&safe=ok",
			},
			map: {
				type: "Map",
				entries: [
					["authorization", "[Redacted]"],
					["customerEmail", "[Redacted]"],
				],
			},
			set: { type: "Set", values: ["value"] },
			bytes: { type: "TypedArray", values: [1, 2, 3] },
		});
		expect(emitted[0].attributes).toEqual(diagnostics);
	});

	it("extends defaults with configured structured paths for adapter and tee", async () => {
		const log = createCapturingLogger({ captureMessages: false });
		const emitted: unknown[] = [];
		const logger = new LoggerService({
			adapter: log.adapter,
			redact: ["profile.email"],
		});
		await runWithContext(
			{
				app: {
					observability: { emitLog: (record: unknown) => emitted.push(record) },
				},
			},
			async () =>
				logger.info("profile updated", {
					profile: { email: "private@example.com", displayName: "Safe" },
					token: "private-token",
				}),
		);
		const expected = {
			profile: { email: "[Redacted]", displayName: "Safe" },
			token: "[Redacted]",
		};
		expect(log.records[0]?.args?.[0]).toEqual(expected);
		expect(emitted[0]).toMatchObject({ attributes: expected });
	});

	it("serializes Error values without messages or stacks", () => {
		const log = createCapturingLogger({ captureMessages: false });
		const logger = new LoggerService({ adapter: log.adapter });
		const error = Object.assign(new TypeError("private body"), {
			code: "INVALID_INPUT",
		});
		Object.defineProperty(error, "name", {
			enumerable: true,
			value: { token: "private-name" },
		});
		logger.error("operation failed", error);
		logger.error("request failed", {
			error: {
				name: "ValidationError",
				message: "private",
				stack: "private",
				status: 400,
			},
		});
		expect(log.records[0]?.args?.[0]).toEqual({
			err: { type: "TypeError", message: "[Redacted]", code: "INVALID_INPUT" },
		});
		expect(log.records[1]?.args?.[0]).toEqual({
			error: { name: "ValidationError", message: "[Redacted]", status: 400 },
		});
	});

	it("retains configured policy on child loggers", () => {
		const log = createCapturingLogger({ captureMessages: false });
		const logger = new LoggerService({
			adapter: log.adapter,
			redact: ["customer.email"],
		});
		logger
			.child({ component: "billing", authorization: "private" })
			.info("customer", {
				customer: { email: "private@example.com" },
				apiKey: "private-key",
			});
		expect(log.records[0]?.args?.[0]).toEqual({
			customer: { email: "[Redacted]" },
			apiKey: "[Redacted]",
		});
		expect(log.childBindings[0]).toEqual({
			component: "billing",
			authorization: "[Redacted]",
		});
	});

	it("tees effective child bindings with the same redaction policy", async () => {
		const log = createCapturingLogger({ captureMessages: false });
		const emitted: any[] = [];
		const logger = new LoggerService({ adapter: log.adapter });
		await runWithContext(
			{
				app: {
					observability: { emitLog: (record: unknown) => emitted.push(record) },
				},
			},
			async () => {
				logger
					.child({ component: "billing", authorization: "private" })
					.info("child event", { event: "invoice.created" });
			},
		);

		expect(log.childBindings[0]).toEqual({
			component: "billing",
			authorization: "[Redacted]",
		});
		expect(emitted[0].attributes).toMatchObject({
			component: "billing",
			authorization: "[Redacted]",
			event: "invoice.created",
		});
	});

	it("does not claim to inspect caller-owned message strings", () => {
		const messages: string[] = [];
		const adapter: LoggerAdapter = {
			debug: (message) => messages.push(message),
			info: (message) => messages.push(message),
			warn: (message) => messages.push(message),
			error: (message) => messages.push(message),
			child: () => adapter,
		};
		new LoggerService({ adapter }).info("caller message remains unchanged");
		expect(messages).toEqual(["caller message remains unchanged"]);
	});
});
