import { describe, expect, it } from "bun:test";

import { runWithContext } from "../../src/server/config/context.js";
import { LoggerService } from "../../src/server/modules/core/integrated/logger/service.js";
import type { LoggerAdapter } from "../../src/server/modules/core/integrated/logger/types.js";
import { ObservabilityService } from "../../src/server/modules/core/integrated/observability/service.js";
import type { ObservabilityAdapter } from "../../src/server/modules/core/integrated/observability/types.js";

/** Captures what actually reaches the log adapter, bindings included. */
function capturing() {
	const records: Array<{ msg: string; bindings: Record<string, unknown> }> = [];
	const adapter: LoggerAdapter = {
		debug: () => {},
		info: (msg, ...args) => {
			const first = args[0];
			records.push({
				msg,
				bindings:
					first && typeof first === "object"
						? (first as Record<string, unknown>)
						: {},
			});
		},
		warn: () => {},
		error: () => {},
		child: () => adapter,
	};
	return { adapter, records };
}

/** Minimal observability adapter that reports a fixed active span. */
function withActiveSpan(
	ids: { traceId: string; spanId: string } | undefined,
): ObservabilityAdapter {
	return {
		tracer: () => ({
			startActiveSpan: (_name, _options, fn) =>
				fn({
					setAttribute: () => {},
					setAttributes: () => {},
					recordError: () => {},
					addEvent: () => {},
					end: () => {},
				}),
		}),
		meter: () => ({
			createCounter: () => ({ add: () => {} }),
			createHistogram: () => ({ record: () => {} }),
		}),
		activeSpanContext: () => ids,
		shutdown: async () => {},
	};
}

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN = "00f067aa0ba902b7";

describe("log/trace correlation", () => {
	it("stamps trace_id and span_id from the ACTIVE span", async () => {
		const log = capturing();
		const logger = new LoggerService({ adapter: log.adapter });
		const observability = new ObservabilityService({
			adapter: withActiveSpan({ traceId: TRACE, spanId: SPAN }),
		});

		await runWithContext({ app: { observability } } as never, async () => {
			logger.info("hello");
		});

		expect(log.records).toHaveLength(1);
		expect(log.records[0]!.bindings.trace_id).toBe(TRACE);
		expect(log.records[0]!.bindings.span_id).toBe(SPAN);
	});

	it("keeps snake_case — those are the keys backends join on", async () => {
		// Not cosmetic. `trace_id`/`span_id` are the OTel log semantic
		// conventions; a backend looking for them will not find `traceId`.
		const log = capturing();
		const logger = new LoggerService({ adapter: log.adapter });
		const observability = new ObservabilityService({
			adapter: withActiveSpan({ traceId: TRACE, spanId: SPAN }),
		});

		await runWithContext({ app: { observability } } as never, async () => {
			logger.info("hello");
		});

		expect(Object.keys(log.records[0]!.bindings)).toContain("trace_id");
		expect(Object.keys(log.records[0]!.bindings)).toContain("span_id");
	});

	it("preserves the caller's own bindings", async () => {
		const log = capturing();
		const logger = new LoggerService({ adapter: log.adapter });
		const observability = new ObservabilityService({
			adapter: withActiveSpan({ traceId: TRACE, spanId: SPAN }),
		});

		await runWithContext({ app: { observability } } as never, async () => {
			logger.info("hello", { orderId: "o-1" });
		});

		expect(log.records[0]!.bindings.orderId).toBe("o-1");
		expect(log.records[0]!.bindings.trace_id).toBe(TRACE);
	});

	it("adds nothing when no span is active", async () => {
		const log = capturing();
		const logger = new LoggerService({ adapter: log.adapter });
		const observability = new ObservabilityService({
			adapter: withActiveSpan(undefined),
		});

		await runWithContext({ app: { observability } } as never, async () => {
			logger.info("hello");
		});

		expect(log.records[0]!.bindings.trace_id).toBeUndefined();
		expect(log.records[0]!.bindings.span_id).toBeUndefined();
	});

	it("adds nothing when no observability adapter is configured", async () => {
		const log = capturing();
		const logger = new LoggerService({ adapter: log.adapter });
		const observability = new ObservabilityService({});

		await runWithContext({ app: { observability } } as never, async () => {
			logger.info("hello");
		});

		expect(log.records[0]!.bindings.trace_id).toBeUndefined();
	});

	it("does not throw outside any app context", () => {
		const log = capturing();
		const logger = new LoggerService({ adapter: log.adapter });

		expect(() => logger.info("hello")).not.toThrow();
	});
});
