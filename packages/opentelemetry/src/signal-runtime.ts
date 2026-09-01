import type { ContextManager, Meter, Tracer } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { AggregationType } from "@opentelemetry/sdk-metrics";

import type { buildEffectiveConfig } from "./config";
import { SIGNAL_PROJECTION_ARTIFACT } from "./generated/signal-projection.gen";
import {
	ADAPTER_METRIC_DEFINITIONS,
	DURABLE_HISTOGRAM_BOUNDARIES,
	OPERATION_HISTOGRAM_BOUNDARIES,
} from "./projection";

type EffectiveConfiguration = ReturnType<typeof buildEffectiveConfig>;

export type OpenTelemetrySignalRuntime = Readonly<{
	contextManager: ContextManager;
	meter: Meter;
	tracer: Tracer;
	close(): Promise<void>;
	forceFlush(): Promise<void>;
}>;

const durableHistogramNames = new Set([
	"questpie.job.queue.delay",
	"questpie.durable.attempt.duration",
]);

export const OPEN_TELEMETRY_METRIC_VIEWS = Object.freeze(
	ADAPTER_METRIC_DEFINITIONS.filter(
		(definition) => definition.type === "histogram",
	).map((definition) => ({
		instrumentName: definition.name,
		aggregation: {
			type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM as const,
			options: {
				boundaries: [
					...(durableHistogramNames.has(definition.name)
						? DURABLE_HISTOGRAM_BOUNDARIES
						: OPERATION_HISTOGRAM_BOUNDARIES),
				],
			},
		},
	})),
);

export function createOpenTelemetryResource(effective: EffectiveConfiguration) {
	const candidates = {
		"service.name": effective.artifact.resource.serviceName,
		"service.version": effective.artifact.resource.serviceVersion,
		"service.instance.id": effective.artifact.resource.serviceInstanceId,
		"questpie.runtime_build.digest":
			effective.artifact.resource.runtimeBuildDigest,
		...(effective.artifact.resource.deploymentEnvironment === undefined
			? {}
			: {
					"deployment.environment.name":
						effective.artifact.resource.deploymentEnvironment,
				}),
	};
	return resourceFromAttributes(
		Object.fromEntries(
			SIGNAL_PROJECTION_ARTIFACT.resourceAttributeAllowlist.flatMap((name) =>
				name in candidates
					? [[name, candidates[name as keyof typeof candidates]]]
					: [],
			),
		),
	);
}
