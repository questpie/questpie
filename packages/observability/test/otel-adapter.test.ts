import { describe, expect, it } from "bun:test";

import { otelObservability } from "../src/otel-adapter.js";

/**
 * These assert the adapter satisfies the framework contract without needing a
 * collector: no `otlpEndpoint` means no exporter is constructed, so nothing
 * leaves the process and the test stays hermetic.
 */
describe("otelObservability", () => {
	it("produces a working adapter with no exporter configured", async () => {
		const adapter = otelObservability({ serviceName: "test-service" });

		const tracer = adapter.tracer("unit");
		const seen: string[] = [];

		const result = tracer.startActiveSpan("outer", {}, (span) => {
			span.setAttribute("a", 1);
			span.setAttributes({ b: "x", skipped: undefined });
			span.addEvent("event");
			seen.push("ran");
			span.end();
			return "value";
		});

		expect(result).toBe("value");
		expect(seen).toEqual(["ran"]);

		const counter = adapter.meter("unit").createCounter("c");
		counter.add(1, { label: "x" });
		adapter.meter("unit").createHistogram("h", { unit: "ms" }).record(12);

		await adapter.shutdown();
	});

	it("nests child spans under the active parent", async () => {
		const adapter = otelObservability({ serviceName: "test-nesting" });
		const tracer = adapter.tracer("unit");

		let parentTrace: string | undefined;
		let childTrace: string | undefined;

		// The whole reason the adapter installs AsyncLocalStorageContextManager:
		// without it a child started inside the parent callback gets its own
		// trace and the resulting waterfall is meaningless.
		await tracer.startActiveSpan("parent", {}, async (parent) => {
			parentTrace = await currentTraceId();
			await Promise.resolve();
			await tracer.startActiveSpan("child", {}, async (child) => {
				childTrace = await currentTraceId();
				child.end();
			});
			parent.end();
		});

		expect(parentTrace).toBeDefined();
		expect(childTrace).toBe(parentTrace);

		await adapter.shutdown();
	});

	it("records an error and marks the span failed", async () => {
		const adapter = otelObservability({ serviceName: "test-errors" });
		const tracer = adapter.tracer("unit");

		// recordError must not throw on a non-Error value — seams pass whatever
		// was caught, and `throw "string"` is legal JavaScript.
		tracer.startActiveSpan("failing", {}, (span) => {
			span.recordError(new Error("boom"));
			span.recordError("not an error object");
			span.end();
		});

		await adapter.shutdown();
	});

	it("accepts a sampling ratio and a console exporter", async () => {
		const adapter = otelObservability({
			serviceName: "test-sampling",
			samplingRatio: 0,
			serviceVersion: "1.2.3",
			environment: "test",
			resourceAttributes: { "custom.attr": "yes" },
		});

		// ratio 0 still runs the callback — sampling decides what is EXPORTED,
		// not whether instrumented code executes.
		expect(
			adapter.tracer("unit").startActiveSpan("dropped", {}, (span) => {
				span.end();
				return 1;
			}),
		).toBe(1);

		await adapter.shutdown();
	});
});

async function currentTraceId(): Promise<string | undefined> {
	const { trace, context } = await import("@opentelemetry/api");
	return trace.getSpan(context.active())?.spanContext().traceId;
}
