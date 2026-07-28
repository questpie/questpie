/**
 * OpenTelemetry adapter for QUESTPIE.
 *
 * Composes the SDK by hand rather than using `@opentelemetry/sdk-node` or
 * `auto-instrumentations-node`. That is deliberate and was validated on Bun
 * 1.3.14: a manually composed provider initialises and exports under plain
 * `bun run` with no `--require` flag, no preload, and no monkey-patching of
 * built-ins — which is what auto-instrumentation relies on and what tends to be
 * fragile outside Node.
 *
 * Everything here implements the framework-side interfaces from
 * `questpie/observability`. The framework itself has no OpenTelemetry
 * dependency; this package is the only place OTel appears.
 */

import {
	context,
	metrics,
	propagation,
	SpanStatusCode,
	trace,
	type Attributes,
	type Meter as OtelMeter,
	type Span as OtelSpan,
	type SpanKind as OtelSpanKind,
	type Tracer as OtelTracer,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	MeterProvider,
	PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
	AlwaysOnSampler,
	BatchSpanProcessor,
	ConsoleSpanExporter,
	ParentBasedSampler,
	SimpleSpanProcessor,
	TraceIdRatioBasedSampler,
	BasicTracerProvider,
	type Sampler,
	type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
	ATTR_SERVICE_NAME,
	ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import type {
	Counter,
	Histogram,
	InstrumentOptions,
	Meter,
	ObservabilityAdapter,
	ObservabilityAttributes,
	ObservabilitySpan,
	SpanKind,
	StartSpanOptions,
	Tracer,
} from "questpie/observability";

export interface OtelObservabilityOptions {
	/** `service.name`. Required — an unnamed service is unusable in any backend. */
	serviceName: string;
	serviceVersion?: string;
	/** Becomes `deployment.environment.name`. */
	environment?: string;
	/**
	 * OTLP/HTTP base endpoint, e.g. `http://localhost:4318`. Omit to skip the
	 * OTLP exporter entirely — useful with `console: true` in development.
	 */
	otlpEndpoint?: string;
	otlpHeaders?: Record<string, string>;
	/**
	 * Head sampling ratio, 0..1. Wrapped in a parent-based sampler, so a
	 * sampled upstream request stays sampled here regardless of the ratio.
	 * Omit for always-on.
	 */
	samplingRatio?: number;
	/** Also print spans to stdout. Development only — it is very noisy. */
	console?: boolean;
	/** Metric export interval. Default 60s, matching the OTLP default. */
	metricIntervalMs?: number;
	/** Extra resource attributes, merged last so they can override the above. */
	resourceAttributes?: Attributes;
	/**
	 * Additional span processors, appended after the OTLP and console ones.
	 *
	 * `BasicTracerProvider` takes its processors at construction and has no
	 * `addSpanProcessor`, so without this there is no way to attach a different
	 * exporter (Jaeger, Zipkin, a custom enricher) or to capture spans in memory
	 * for a test — which is how the span-tree assertions in this package's
	 * `otel-tree.test.ts` work.
	 */
	spanProcessors?: SpanProcessor[];
}

const SPAN_KINDS: Record<SpanKind, OtelSpanKind> = {
	internal: 0,
	server: 1,
	client: 2,
	producer: 3,
	consumer: 4,
};

/** Drops undefined values — OTel rejects them, the framework type allows them. */
function toOtelAttributes(attributes?: ObservabilityAttributes): Attributes {
	if (!attributes) return {};
	const out: Attributes = {};
	for (const [key, value] of Object.entries(attributes)) {
		if (value !== undefined) out[key] = value;
	}
	return out;
}

function wrapSpan(span: OtelSpan): ObservabilitySpan {
	return {
		setAttribute(key, value) {
			span.setAttribute(key, value);
		},
		setAttributes(attributes) {
			span.setAttributes(toOtelAttributes(attributes));
		},
		recordError(error) {
			const err = error instanceof Error ? error : new Error(String(error));
			span.recordException(err);
			// Status matters as much as the exception event: backends filter and
			// alert on status, not on the presence of an exception event.
			span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
		},
		addEvent(name, attributes) {
			span.addEvent(name, toOtelAttributes(attributes));
		},
		end() {
			span.end();
		},
	};
}

function wrapTracer(tracer: OtelTracer): Tracer {
	return {
		startActiveSpan<T>(
			name: string,
			options: StartSpanOptions,
			fn: (span: ObservabilitySpan) => T,
		): T {
			return tracer.startActiveSpan(
				name,
				{
					kind: options.kind ? SPAN_KINDS[options.kind] : undefined,
					attributes: toOtelAttributes(options.attributes),
				},
				// The framework's span() owns ending the span (including the
				// async case), so this must NOT end it here.
				(span) => fn(wrapSpan(span)),
			);
		},
	};
}

function wrapMeter(meter: OtelMeter): Meter {
	return {
		createCounter(name: string, options?: InstrumentOptions): Counter {
			const counter = meter.createCounter(name, options);
			return {
				add(value, attributes) {
					counter.add(value, toOtelAttributes(attributes));
				},
			};
		},
		createHistogram(name: string, options?: InstrumentOptions): Histogram {
			const histogram = meter.createHistogram(name, options);
			return {
				record(value, attributes) {
					histogram.record(value, toOtelAttributes(attributes));
				},
			};
		},
	};
}

function buildSampler(ratio?: number): Sampler {
	if (ratio === undefined) return new AlwaysOnSampler();
	// Parent-based, so a trace already sampled upstream is not truncated here.
	// A ratio sampler applied without this produces broken partial traces.
	return new ParentBasedSampler({
		root: new TraceIdRatioBasedSampler(ratio),
	});
}

/**
 * Build the OTel-backed adapter.
 *
 * ```ts
 * import { otelObservability } from "@questpie/observability";
 *
 * export default runtimeConfig({
 *   observability: {
 *     adapter: otelObservability({
 *       serviceName: "my-app",
 *       otlpEndpoint: "http://localhost:4318",
 *     }),
 *   },
 * });
 * ```
 *
 * The providers are created eagerly — `runtimeConfig` is evaluated at startup,
 * which is early enough, and it means the first request is already traced
 * rather than racing an async init.
 */
export function otelObservability(
	options: OtelObservabilityOptions,
): ObservabilityAdapter {
	const resource = resourceFromAttributes({
		[ATTR_SERVICE_NAME]: options.serviceName,
		...(options.serviceVersion
			? { [ATTR_SERVICE_VERSION]: options.serviceVersion }
			: {}),
		...(options.environment
			? { "deployment.environment.name": options.environment }
			: {}),
		...options.resourceAttributes,
	});

	const spanProcessors: SpanProcessor[] = [];
	if (options.otlpEndpoint) {
		spanProcessors.push(
			new BatchSpanProcessor(
				new OTLPTraceExporter({
					url: `${options.otlpEndpoint.replace(/\/$/, "")}/v1/traces`,
					headers: options.otlpHeaders,
				}),
			),
		);
	}
	if (options.console) {
		// Simple, not batched: in development you want the span when it ends,
		// not up to 5 seconds later.
		spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
	}
	if (options.spanProcessors) {
		spanProcessors.push(...options.spanProcessors);
	}

	const tracerProvider = new BasicTracerProvider({
		resource,
		sampler: buildSampler(options.samplingRatio),
		spanProcessors,
	});

	// sdk-node would install these; composing by hand means doing it explicitly.
	const contextManager = new AsyncLocalStorageContextManager();
	contextManager.enable();
	context.setGlobalContextManager(contextManager);
	propagation.setGlobalPropagator(new W3CTraceContextPropagator());
	trace.setGlobalTracerProvider(tracerProvider);

	const meterProvider = new MeterProvider({
		resource,
		readers: options.otlpEndpoint
			? [
					new PeriodicExportingMetricReader({
						exporter: new OTLPMetricExporter({
							url: `${options.otlpEndpoint.replace(/\/$/, "")}/v1/metrics`,
							headers: options.otlpHeaders,
						}),
						exportIntervalMillis: options.metricIntervalMs ?? 60_000,
					}),
				]
			: [],
	});
	metrics.setGlobalMeterProvider(meterProvider);

	return {
		tracer(name) {
			return wrapTracer(tracerProvider.getTracer(name));
		},
		meter(name) {
			return wrapMeter(meterProvider.getMeter(name));
		},
		async shutdown() {
			// Both, and in this order: spans are usually what you are missing
			// when a process exits without flushing.
			await tracerProvider.shutdown();
			await meterProvider.shutdown();
		},
	};
}
