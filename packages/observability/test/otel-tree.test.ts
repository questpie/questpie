import { beforeEach, describe, expect, it } from "bun:test";

import { context, propagation, trace, type Context } from "@opentelemetry/api";
import {
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { ObservabilityService } from "questpie/observability";

import { otelObservability } from "../src/otel-adapter.js";

/**
 * The real adapter driven through the framework's own `ObservabilityService`,
 * with an in-memory exporter capturing what a collector would receive.
 *
 * This covers the gap the rest of the suite leaves open. The unit tests in
 * `otel-adapter.test.ts` exercise the adapter with no exporter, and
 * `questpie`'s `crud-spans.test.ts` drives the framework against a fake
 * recorder that appends span NAMES to a flat array — neither can tell whether
 * the spans that actually reach a backend form the right tree. A waterfall with
 * every span at the root looks fine in both of those and is useless in Jaeger.
 *
 * What is NOT covered here, because it is not wired yet: DB query spans, RED
 * metrics per seam, and logs carrying trace_id (the `wire-db-query-spans` and
 * logs-bridge tasks). Do not read this file as proof of those.
 */

function harness(samplingRatio?: number) {
	const exporter = new InMemorySpanExporter();
	const adapter = otelObservability({
		serviceName: "tree-test",
		samplingRatio,
		spanProcessors: [new SimpleSpanProcessor(exporter)],
	});
	// The framework never touches the adapter directly — this is the seam every
	// call site (http.ts, crud-generator.ts, kv, search, queue) goes through.
	const service = new ObservabilityService({ adapter });

	/**
	 * Read the spans, THEN shut down — never the other way round.
	 * `InMemorySpanExporter.shutdown()` resets its buffer, so shutting down
	 * first hands back an empty array and every assertion below fails for a
	 * reason that has nothing to do with the code under test. No flush is
	 * needed: SimpleSpanProcessor exports synchronously as each span ends.
	 */
	const collect = async () => {
		const spans = exporter.getFinishedSpans();
		await adapter.shutdown();
		return spans;
	};
	return { exporter, adapter, service, collect };
}

type Collected = Awaited<ReturnType<ReturnType<typeof harness>["collect"]>>;

/** Spans come back in end order; index by name for readable assertions. */
function byName(spans: Collected) {
	const out = new Map<string, Collected[number]>();
	for (const span of spans) out.set(span.name, span);
	return out;
}

describe("otel adapter — exported span tree", () => {
	beforeEach(() => {
		// The adapter installs global providers; each harness replaces them.
		trace.disable();
		propagation.disable();
		context.disable();
	});

	it("nests framework seams under one trace with real parent links", async () => {
		const { service, collect } = harness();

		// Mirrors a real request: http.ts opens the root, crud-generator opens a
		// collection span inside it, and a service (kv/search) opens one deeper.
		await service.span(
			"http.request",
			async () => {
				await service.span("collection.find", async () => {
					await service.span("kv.get", async () => {});
				});
			},
			{ kind: "server" },
		);

		const spans = byName(await collect());
		expect([...spans.keys()].sort()).toEqual([
			"collection.find",
			"http.request",
			"kv.get",
		]);

		const root = spans.get("http.request")!;
		const find = spans.get("collection.find")!;
		const kv = spans.get("kv.get")!;

		// One trace, not three.
		expect(find.spanContext().traceId).toBe(root.spanContext().traceId);
		expect(kv.spanContext().traceId).toBe(root.spanContext().traceId);

		// …and an actual parent chain, which a shared trace id alone does not
		// prove: three siblings would also share it.
		expect(root.parentSpanContext).toBeUndefined();
		expect(find.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
		expect(kv.parentSpanContext?.spanId).toBe(find.spanContext().spanId);
	});

	it("keeps nesting across an await boundary", async () => {
		const { service, collect } = harness();

		await service.span("outer", async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
			await service.span("inner", async () => {
				await new Promise((resolve) => setTimeout(resolve, 5));
			});
		});

		const spans = byName(await collect());
		expect(spans.get("inner")!.parentSpanContext?.spanId).toBe(
			spans.get("outer")!.spanContext().spanId,
		);
	});

	it("continues an inbound traceparent instead of starting a new trace", async () => {
		const { service, collect } = harness();

		const upstreamTraceId = "12345678901234567890123456789012";
		const upstreamSpanId = "1234567890123456";
		let extracted!: Context;
		// What an HTTP adapter does with an incoming request's headers.
		extracted = propagation.extract(context.active(), {
			traceparent: `00-${upstreamTraceId}-${upstreamSpanId}-01`,
		});

		await context.with(extracted, async () => {
			await service.span("http.request", async () => {}, { kind: "server" });
		});

		const root = byName(await collect()).get("http.request")!;
		expect(root.spanContext().traceId).toBe(upstreamTraceId);
		expect(root.parentSpanContext?.spanId).toBe(upstreamSpanId);
	});

	it("records an error on the span and still ends it", async () => {
		const { service, collect } = harness();

		await expect(
			service.span("collection.create", async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");

		const span = byName(await collect()).get("collection.create")!;
		// A span that never ends never reaches the exporter at all, so its
		// presence here is the proof that the throw path still ends it.
		expect(span.status.code).toBe(2); // SpanStatusCode.ERROR
		expect(span.events.some((e) => e.name === "exception")).toBe(true);
	});

	it("keeps a sampled upstream trace sampled under a 0 ratio", async () => {
		// ParentBasedSampler is the reason this works: a bare
		// TraceIdRatioBasedSampler(0) would drop the child and produce a broken
		// partial trace in the backend.
		const { service, collect } = harness(0);

		const extracted = propagation.extract(context.active(), {
			traceparent: "00-12345678901234567890123456789012-1234567890123456-01",
		});
		await context.with(extracted, async () => {
			await service.span("http.request", async () => {}, { kind: "server" });
		});

		expect(await collect()).toHaveLength(1);
	});

	it("emits nothing at all when no adapter is configured", async () => {
		const { collect } = harness();
		// The default service — what every app without `observability.adapter`
		// gets. It must not reach the globals the harness above installed.
		const noop = new ObservabilityService({});

		await noop.span(
			"http.request",
			async () => {
				await noop.span("collection.find", async () => {});
			},
			{ kind: "server" },
		);

		expect(await collect()).toHaveLength(0);
	});
});
