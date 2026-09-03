import {
	ROOT_CONTEXT,
	SpanStatusCode,
	context,
	trace,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { suppressTracing, unsuppressTracing } from "@opentelemetry/core";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import {
	MeterProvider,
	PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
	AlwaysOffSampler,
	AlwaysOnSampler,
	BatchSpanProcessor,
	ParentBasedSampler,
	TraceIdRatioBasedSampler,
	TracerProvider,
} from "@opentelemetry/sdk-trace";
import type { QuestpieObservationRuntimeMetadataV1 } from "questpie/internal/observability";

import {
	buildEffectiveConfig,
	type decodeOpenTelemetryConfiguration,
} from "./config";
import { SIGNAL_PROJECTION_ARTIFACT } from "./generated/signal-projection.gen";
import {
	ADAPTER_METRIC_DEFINITIONS,
	projectSpanAttributes,
	spanDefinition,
	type End,
	type Event,
	type Start,
} from "./projection";
import {
	extractTracePlan,
	neutral,
	parentContext,
	spanContext,
} from "./propagation";
import {
	createOpenTelemetryResource,
	OPEN_TELEMETRY_METRIC_VIEWS,
	type OpenTelemetrySignalRuntime,
} from "./signal-runtime";

type Configuration = ReturnType<typeof decodeOpenTelemetryConfiguration>;

function metricDefinition<Name extends string>(name: Name) {
	const definition = ADAPTER_METRIC_DEFINITIONS.find(
		(candidate) => candidate.name === name,
	);
	if (definition === undefined)
		throw new TypeError(`Missing OpenTelemetry metric definition: ${name}`);
	return definition;
}

function signalEndpoint(base: string | null, signal: "metrics" | "traces") {
	if (base === null) return undefined;
	const url = new URL(base);
	url.pathname = `${url.pathname.replace(/\/$/u, "")}/v1/${signal}`;
	return url.href;
}

function configuredSampler(configuration: Configuration) {
	const sampler = configuration.artifact.sampler;
	const root =
		sampler.name === "parentbased_always_off"
			? new AlwaysOffSampler()
			: sampler.name === "parentbased_traceidratio"
				? new TraceIdRatioBasedSampler(sampler.ratio ?? 0)
				: new AlwaysOnSampler();
	return new ParentBasedSampler({ root });
}

export function createOpenTelemetrySdk(
	input: Readonly<{
		metadata: QuestpieObservationRuntimeMetadataV1;
		configuration: Configuration;
	}>,
) {
	const effective = buildEffectiveConfig(input.metadata, input.configuration);
	const config = input.configuration.artifact;
	const resource = createOpenTelemetryResource(effective);
	const traceExporter =
		config.traces === "otlp"
			? new OTLPTraceExporter({
					headers: input.configuration.runtime.otlpHeaders,
					timeoutMillis: config.otlpTimeoutMilliseconds,
					url: signalEndpoint(
						input.configuration.runtime.otlpEndpoint,
						"traces",
					),
				})
			: null;
	const provider = new TracerProvider({
		resource,
		sampler:
			config.traces === "none"
				? new AlwaysOffSampler()
				: configuredSampler(input.configuration),
		spanProcessors:
			traceExporter === null
				? []
				: [
						new BatchSpanProcessor({
							exporter: traceExporter,
							exportTimeoutMillis: config.batchExportTimeoutMilliseconds,
							maxExportBatchSize: config.maxExportBatchSize,
							maxQueueSize: config.maxQueueSize,
							scheduledDelayMillis: config.batchScheduleDelayMilliseconds,
						}),
					],
	});
	const tracer = provider.getTracer("questpie", input.metadata.questpieVersion);
	const manager = new AsyncLocalStorageContextManager().enable();

	const metricExporter =
		config.metrics === "otlp"
			? new OTLPMetricExporter({
					headers: input.configuration.runtime.otlpHeaders,
					timeoutMillis: config.otlpTimeoutMilliseconds,
					url: signalEndpoint(
						input.configuration.runtime.otlpEndpoint,
						"metrics",
					),
				})
			: null;
	const metricReader =
		metricExporter === null
			? null
			: new PeriodicExportingMetricReader({
					exporter: metricExporter,
					exportIntervalMillis: config.metricExportIntervalMilliseconds,
					exportTimeoutMillis: config.metricExportTimeoutMilliseconds,
				});
	const meterProvider = new MeterProvider({
		resource,
		readers: metricReader === null ? [] : [metricReader],
		views: [...OPEN_TELEMETRY_METRIC_VIEWS],
	});
	const meter = meterProvider.getMeter(
		"questpie",
		input.metadata.questpieVersion,
	);
	return createOpenTelemetrySdkFromSignalRuntime({
		metadata: input.metadata,
		configuration: input.configuration,
		effective,
		signalRuntime: Object.freeze({
			contextManager: manager,
			meter,
			tracer,
			async close() {
				manager.disable();
				await Promise.allSettled([
					provider.shutdown(),
					meterProvider.shutdown(),
				]);
			},
			async forceFlush() {
				await Promise.allSettled([
					provider.forceFlush(),
					meterProvider.forceFlush(),
				]);
			},
		}),
	});
}

export function createOpenTelemetrySdkFromSignalRuntime(
	input: Readonly<{
		metadata: QuestpieObservationRuntimeMetadataV1;
		configuration: Configuration;
		effective: ReturnType<typeof buildEffectiveConfig>;
		signalRuntime: OpenTelemetrySignalRuntime;
	}>,
) {
	const effective = input.effective;
	const config = input.configuration.artifact;
	const { contextManager: manager, meter, tracer } = input.signalRuntime;
	const operationCallsDefinition = metricDefinition("questpie.operation.calls");
	const operationCalls = meter.createCounter(operationCallsDefinition.name, {
		unit: operationCallsDefinition.unit,
	});
	const operationDurationDefinition = metricDefinition(
		"questpie.operation.duration",
	);
	const operationDuration = meter.createHistogram(
		operationDurationDefinition.name,
		{ unit: operationDurationDefinition.unit },
	);
	const operationActiveDefinition = metricDefinition(
		"questpie.operation.active",
	);
	const operationActive = meter.createUpDownCounter(
		operationActiveDefinition.name,
		{ unit: operationActiveDefinition.unit },
	);
	const postgresDurationDefinition = metricDefinition(
		"questpie.postgresql.statement.duration",
	);
	const postgresDuration = meter.createHistogram(
		postgresDurationDefinition.name,
		{ unit: postgresDurationDefinition.unit },
	);
	const jobAcceptedDefinition = metricDefinition("questpie.job.accepted");
	const jobAccepted = meter.createCounter(jobAcceptedDefinition.name, {
		unit: jobAcceptedDefinition.unit,
	});
	const jobQueueDelayDefinition = metricDefinition("questpie.job.queue.delay");
	const jobQueueDelay = meter.createHistogram(jobQueueDelayDefinition.name, {
		unit: jobQueueDelayDefinition.unit,
	});
	const durableAttemptDurationDefinition = metricDefinition(
		"questpie.durable.attempt.duration",
	);
	const durableAttemptDuration = meter.createHistogram(
		durableAttemptDurationDefinition.name,
		{ unit: durableAttemptDurationDefinition.unit },
	);
	const actionDurationDefinition = metricDefinition("questpie.action.duration");
	const actionDuration = meter.createHistogram(actionDurationDefinition.name, {
		unit: actionDurationDefinition.unit,
	});
	const runtimeActiveDefinition = metricDefinition(
		"questpie.runtime.active_executions",
	);
	const runtimeActive = meter.createUpDownCounter(
		runtimeActiveDefinition.name,
		{ unit: runtimeActiveDefinition.unit },
	);
	const droppedDefinition = metricDefinition("questpie.observation.dropped");
	const dropped = meter.createCounter(droppedDefinition.name, {
		unit: droppedDefinition.unit,
	});

	const adapter = Object.freeze({
		format: "questpie.runtime-observability" as const,
		version: 1 as const,
		extract(
			headers: Readonly<{
				traceparent: string | null;
				tracestate: string | null;
			}>,
		) {
			return extractTracePlan(headers, config.trustBoundary);
		},
		begin(start: Start) {
			const definition = spanDefinition(start);
			if (definition === null)
				return Object.freeze({
					context: null,
					run: async <Result>(use: () => Result | Promise<Result>) =>
						await use(),
					event: () => undefined,
					end: () => undefined,
				});
			const links = (start.trace.links ?? []).map((item) => ({
				context: spanContext(item),
			}));
			const startedAt = performance.now();
			const attributes = projectSpanAttributes({
				metadata: input.metadata,
				operationalIds: config.operationalIds,
				scope: start.kind,
				start,
			});
			const parent = unsuppressTracing(parentContext(start.trace, manager));
			const span = tracer.startSpan(
				definition.name,
				{ kind: definition.kind, attributes, links },
				parent,
			);
			const active = trace.setSpan(ROOT_CONTEXT, span);
			const scopeContext =
				start.suppressHttp === true || start.suppressPostgres === true
					? suppressTracing(active)
					: unsuppressTracing(active);
			if (start.kind === "execution")
				runtimeActive.add(1, {
					"questpie.execution.entry": String(start.entry),
				});
			if (
				start.kind === "query" ||
				start.kind === "mutation" ||
				start.kind === "action"
			)
				operationActive.add(1, {
					"questpie.operation.kind": start.kind,
					"questpie.resource": String(start.resourceIdentity),
				});
			if (start.kind === "job.attempt")
				jobQueueDelay.record(Number(start.queueDelayMilliseconds) / 1_000, {
					"questpie.resource": String(start.resourceIdentity),
				});
			let eventCount = 0;
			let ended = false;
			return Object.freeze({
				context: neutral(span.spanContext()),
				run: async <Result>(use: () => Result | Promise<Result>) =>
					await manager.with(
						scopeContext,
						async () => await context.with(scopeContext, use),
					),
				event(event: Event) {
					if (eventCount >= SIGNAL_PROJECTION_ARTIFACT.spanEventLimit) {
						dropped.add(1, { signal: "event", cause: "event_limit" });
						return;
					}
					eventCount += 1;
					try {
						const eventName = `questpie.${event.kind}`;
						if (
							!SIGNAL_PROJECTION_ARTIFACT.spanEventNames.includes(
								eventName as (typeof SIGNAL_PROJECTION_ARTIFACT.spanEventNames)[number],
							)
						)
							throw new TypeError("Unsupported QUESTPIE observation event");
						const eventAttrs = projectSpanAttributes({
							event,
							metadata: input.metadata,
							operationalIds: config.operationalIds,
							scope: start.kind,
						});
						span.addEvent(eventName, eventAttrs);
						for (const name of [
							"questpie.transaction.id",
							"questpie.dispatch.id",
							"questpie.run.id",
						] as const) {
							const value = eventAttrs[name];
							if (typeof value === "string") span.setAttribute(name, value);
						}
					} catch (error) {
						dropped.add(1, {
							cause: "adapter_fault",
							signal: "event",
						});
						throw error;
					}
				},
				end(end: End) {
					if (ended) return;
					ended = true;
					const duration = Math.max(0, performance.now() - startedAt) / 1_000;
					span.setAttributes(
						projectSpanAttributes({
							end,
							metadata: input.metadata,
							operationalIds: config.operationalIds,
							scope: start.kind,
						}),
					);
					if (
						SIGNAL_PROJECTION_ARTIFACT.spanStatus.errorWithoutDescription.includes(
							end.outcome as "framework_error",
						) ||
						((start.kind === "fetch" || start.kind === "route") &&
							typeof end.httpResponseStatusCode === "number" &&
							end.httpResponseStatusCode >= 500)
					)
						span.setStatus({ code: SpanStatusCode.ERROR });
					if (start.kind === "execution")
						runtimeActive.add(-1, {
							"questpie.execution.entry": String(start.entry),
						});
					if (
						start.kind === "query" ||
						start.kind === "mutation" ||
						start.kind === "action"
					) {
						const base = {
							"questpie.operation.kind": start.kind,
							"questpie.resource": String(start.resourceIdentity),
						};
						operationActive.add(-1, base);
						operationDuration.record(duration, {
							...base,
							"questpie.outcome": end.outcome,
						});
						operationCalls.add(1, {
							...base,
							"questpie.outcome": end.outcome,
							...(typeof end.errorCode === "string"
								? { "questpie.error.code": end.errorCode }
								: {}),
						});
					}
					if (start.kind === "postgresql")
						postgresDuration.record(duration, {
							"questpie.statement.identity": String(start.statementIdentity),
							"db.operation.name": String(start.databaseOperation),
							"questpie.outcome": end.outcome,
						});
					if (start.kind === "job.accept")
						jobAccepted.add(1, {
							"questpie.resource": String(start.resourceIdentity),
							"questpie.outcome": end.outcome,
						});
					if (start.kind.endsWith(".attempt"))
						durableAttemptDuration.record(duration, {
							"questpie.resource": String(start.resourceIdentity),
							"questpie.outcome": end.outcome,
							...(typeof end.errorCode === "string"
								? { "questpie.error.code": end.errorCode }
								: {}),
						});
					if (start.kind === "action")
						actionDuration.record(duration, {
							"questpie.resource": String(start.resourceIdentity),
							"questpie.outcome": end.outcome,
						});
					span.end();
				},
			});
		},
	});

	return Object.freeze({
		adapter,
		effective,
		close: input.signalRuntime.close,
		forceFlush: input.signalRuntime.forceFlush,
	});
}
