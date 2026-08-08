import { describe, expect, it } from "bun:test";

import { runWithContext } from "../../../src/server/config/context.js";
import { LoggerService } from "../../../src/server/modules/core/integrated/logger/service.js";
import type { LoggerAdapter } from "../../../src/server/modules/core/integrated/logger/types.js";

function capturing() {
	const records: unknown[][] = [];
	const childBindings: Array<Record<string, unknown>> = [];
	const adapter: LoggerAdapter = {
		debug: (_message, ...args) => records.push(args),
		info: (_message, ...args) => records.push(args),
		warn: (_message, ...args) => records.push(args),
		error: (_message, ...args) => records.push(args),
		child: (bindings) => {
			childBindings.push(bindings);
			return adapter;
		},
	};
	return { adapter, childBindings, records };
}

describe("logger redaction", () => {
	it("recursively redacts credential keys without discarding diagnostics", () => {
		const log = capturing();
		const logger = new LoggerService({ adapter: log.adapter });

		logger.info("request failed", {
			event: "request.failed",
			requestId: "req-1",
			request: {
				headers: {
					Authorization: "Bearer private",
					cookie: "session=private",
				},
				body: { password: "private" },
			},
			auth: {
				accessToken: "private",
				client_secret: "private",
				credentials: { "x-api-key": "private" },
			},
		});

		expect(log.records[0]?.[0]).toEqual({
			event: "request.failed",
			requestId: "req-1",
			request: {
				headers: {
					Authorization: "[Redacted]",
					cookie: "[Redacted]",
				},
				body: { password: "[Redacted]" },
			},
			auth: {
				accessToken: "[Redacted]",
				client_secret: "[Redacted]",
				credentials: { "x-api-key": "[Redacted]" },
			},
		});
	});

	it("extends defaults with user paths for the log adapter and OTLP tee", async () => {
		const log = capturing();
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
			async () => {
				logger.info("profile updated", {
					profile: { email: "private@example.com", displayName: "Safe" },
					token: "private-token",
				});
			},
		);

		const expected = {
			profile: { email: "[Redacted]", displayName: "Safe" },
			token: "[Redacted]",
		};
		expect(log.records[0]?.[0]).toEqual(expected);
		expect(emitted[0]).toMatchObject({ attributes: expected });
	});

	it("serializes Error and request error details without messages or stacks", () => {
		const log = capturing();
		const logger = new LoggerService({ adapter: log.adapter });
		const error = Object.assign(
			new TypeError("request body contained private"),
			{
				code: "INVALID_INPUT",
			},
		);

		logger.error("operation failed", error);
		logger.error("request failed", {
			error: {
				name: "ValidationError",
				message: "private request body",
				stack: "private stack",
				status: 400,
			},
		});
		logger.error("string failure", { error: "private request body" });

		expect(log.records[0]?.[0]).toEqual({
			err: {
				type: "TypeError",
				message: "[Redacted]",
				code: "INVALID_INPUT",
			},
		});
		expect(log.records[1]?.[0]).toEqual({
			error: {
				name: "ValidationError",
				message: "[Redacted]",
				status: 400,
			},
		});
		expect(log.records[2]?.[0]).toEqual({ error: "[Redacted]" });
	});

	it("keeps the same policy on child loggers", () => {
		const log = capturing();
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

		expect(log.records[0]?.[0]).toEqual({
			customer: { email: "[Redacted]" },
			apiKey: "[Redacted]",
		});
		expect(log.childBindings[0]).toEqual({
			component: "billing",
			authorization: "[Redacted]",
		});
	});
});
