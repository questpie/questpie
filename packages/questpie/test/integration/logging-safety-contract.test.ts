import { describe, expect, it } from "bun:test";

import { runWithContext } from "../../src/server/config/context.js";
import { LoggerService } from "../../src/server/modules/core/integrated/logger/service.js";
import type { LoggerAdapter } from "../../src/server/modules/core/integrated/logger/types.js";

function capture() {
	const records: Array<{ message: string; args: unknown[] }> = [];
	const adapter: LoggerAdapter = {
		debug: (message, ...args) => records.push({ message, args }),
		info: (message, ...args) => records.push({ message, args }),
		warn: (message, ...args) => records.push({ message, args }),
		error: (message, ...args) => records.push({ message, args }),
		child: () => adapter,
	};
	return { adapter, records };
}

describe("logging safety contract", () => {
	it("tees the same correlated structured record sent to the logger adapter", async () => {
		const captured = capture();
		const emitted: unknown[] = [];
		const logger = new LoggerService({ adapter: captured.adapter });
		await runWithContext(
			{
				requestId: "req-contract",
				traceId: "framework-trace",
				app: {
					observability: {
						activeSpanContext: () => ({
							traceId: "a".repeat(32),
							spanId: "b".repeat(16),
						}),
						emitLog: (record: unknown) => emitted.push(record),
					},
				},
			},
			async () => logger.info("contract event", { event: "contract.event" }),
		);

		const attributes = captured.records[0]?.args[0];
		expect(attributes).toMatchObject({
			event: "contract.event",
			requestId: "req-contract",
			traceId: "framework-trace",
			trace_id: "a".repeat(32),
			span_id: "b".repeat(16),
		});
		expect(emitted[0]).toMatchObject({ message: "contract event", attributes });
	});

	it("redacts structured credentials and errors but preserves the caller message", () => {
		const captured = capture();
		const logger = new LoggerService({ adapter: captured.adapter });
		logger.error("stable caller message", {
			authorization: "private",
			nested: { accessToken: "private" },
			error: new Error("private error"),
		});

		expect(captured.records[0]).toEqual({
			message: "stable caller message",
			args: [
				{
					authorization: "[Redacted]",
					nested: { accessToken: "[Redacted]" },
					error: { type: "Error", message: "[Redacted]" },
				},
			],
		});
	});
});
