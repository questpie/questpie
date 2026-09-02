import {
	context,
	type Context,
	type Span,
	type SpanOptions,
	type Tracer,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { isTracingSuppressed } from "@opentelemetry/core";
import {
	AggregationTemporality,
	InMemoryMetricExporter,
	MeterProvider,
	PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
	InMemorySpanExporter,
	SimpleSpanProcessor,
	TracerProvider,
} from "@opentelemetry/sdk-trace";

import {
	EXPECTED_SIGNAL_PROJECTION_DIGEST,
	buildEffectiveConfig,
	decodeOpenTelemetryConfiguration,
	type OpenTelemetryOptions,
} from "./config";
import { createOpenTelemetryHandle } from "./lifecycle";
import { createOpenTelemetrySdkFromSignalRuntime } from "./sdk";
import {
	createOpenTelemetryResource,
	OPEN_TELEMETRY_METRIC_VIEWS,
} from "./signal-runtime";

function withHostileSpanEvent(
	tracer: Tracer,
	beforeSpanEvent: (() => void) | undefined,
): Tracer {
	if (beforeSpanEvent === undefined) return tracer;
	return {
		startSpan(name: string, options?: SpanOptions, context?: Context): Span {
			const span = tracer.startSpan(name, options, context);
			return new Proxy(span, {
				get(target, property) {
					if (property === "addEvent")
						return (...args: Parameters<Span["addEvent"]>) => {
							beforeSpanEvent();
							return target.addEvent(...args);
						};
					const value = Reflect.get(target, property);
					return typeof value === "function" ? value.bind(target) : value;
				},
			});
		},
		startActiveSpan: tracer.startActiveSpan.bind(
			tracer,
		) as Tracer["startActiveSpan"],
	};
}

export function installOpenTelemetryAmbientContextTestHarness() {
	const manager = new AsyncLocalStorageContextManager().enable();
	if (!context.setGlobalContextManager(manager)) {
		manager.disable();
		throw new TypeError(
			"OpenTelemetry ambient test context is already installed",
		);
	}
	return Object.freeze({
		isTracingSuppressed: () => isTracingSuppressed(context.active()),
		close() {
			context.disable();
			manager.disable();
		},
	});
}

export async function createOpenTelemetryTestHarness(
	input: Readonly<{
		closeTimeoutMilliseconds?: number;
		faults?: Readonly<{ beforeSpanEvent?(): void }>;
		options?: OpenTelemetryOptions;
		sdkClose?: () => Promise<void>;
	}>,
) {
	const spanExporter = new InMemorySpanExporter();
	const metricExporter = new InMemoryMetricExporter(
		AggregationTemporality.CUMULATIVE,
	);
	const configuration = decodeOpenTelemetryConfiguration(input.options, {
		OTEL_METRICS_EXPORTER: "otlp",
		OTEL_TRACES_EXPORTER: "otlp",
	});
	let sdk:
		| ReturnType<typeof createOpenTelemetrySdkFromSignalRuntime>
		| undefined;
	const observability = createOpenTelemetryHandle({
		closeTimeoutMilliseconds: input.closeTimeoutMilliseconds ?? 30_000,
		configuration,
		createSdk(metadata) {
			const effective = buildEffectiveConfig(metadata, configuration);
			const resource = createOpenTelemetryResource(effective);
			const traceProvider = new TracerProvider({
				resource,
				spanProcessors: [new SimpleSpanProcessor({ exporter: spanExporter })],
			});
			const metricProvider = new MeterProvider({
				readers: [
					new PeriodicExportingMetricReader({ exporter: metricExporter }),
				],
				resource,
				views: [...OPEN_TELEMETRY_METRIC_VIEWS],
			});
			const contextManager = new AsyncLocalStorageContextManager().enable();
			sdk = createOpenTelemetrySdkFromSignalRuntime({
				metadata,
				configuration,
				effective,
				signalRuntime: Object.freeze({
					contextManager,
					meter: metricProvider.getMeter("questpie", metadata.questpieVersion),
					tracer: withHostileSpanEvent(
						traceProvider.getTracer("questpie", metadata.questpieVersion),
						input.faults?.beforeSpanEvent,
					),
					async close() {
						contextManager.disable();
						await Promise.allSettled([
							traceProvider.shutdown(),
							metricProvider.shutdown(),
						]);
					},
					async forceFlush() {
						await Promise.allSettled([
							traceProvider.forceFlush(),
							metricProvider.forceFlush(),
						]);
					},
				}),
			});
			return {
				adapter: sdk.adapter,
				close: input.sdkClose ?? sdk.close,
			};
		},
	});
	return Object.freeze({
		observability,
		adapter: () => sdk?.adapter,
		signalProjectionDigest: EXPECTED_SIGNAL_PROJECTION_DIGEST,
		finishedSpans: () => spanExporter.getFinishedSpans(),
		finishedMetrics: () => metricExporter.getMetrics(),
		forceFlush: async () => await sdk?.forceFlush(),
		close: observability.close,
	});
}
