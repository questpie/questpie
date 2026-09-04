import { createHash } from "node:crypto";

import { SIGNAL_PROJECTION_DIGEST } from "./generated/signal-projection.gen";

export const EXPECTED_SIGNAL_PROJECTION_DIGEST = SIGNAL_PROJECTION_DIGEST;
export const EXPECTED_QUESTPIE_VERSION = "4.0.0-beta.2" as const;

export type OpenTelemetryOptions = Readonly<{
	ingress?: Readonly<{ trustBoundary?: "continue" | "restart" }>;
	operationalIds?: "omit" | "spans";
	deploymentEnvironment?: string;
}>;

type Environment = Readonly<Record<string, string | undefined>>;

function invalid(path: string): never {
	throw new TypeError(`QP-OTEL-001 invalidConfiguration: ${path}`);
}

function record(
	value: unknown,
	path: string,
	allowed: readonly string[],
): Readonly<Record<string, unknown>> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return invalid(path);
	const candidate = value as Readonly<Record<string, unknown>>;
	const unknown = Object.keys(candidate)
		.filter((key) => !allowed.includes(key))
		.sort()[0];
	if (unknown !== undefined) return invalid(`${path}.${unknown}`);
	return candidate;
}

function boundedString(
	value: unknown,
	path: string,
	minimumBytes: number,
	maximumBytes: number,
): string {
	if (typeof value !== "string") return invalid(path);
	for (let index = 0; index < value.length; index += 1) {
		const unit = value.charCodeAt(index);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return invalid(path);
			index += 1;
		} else if (unit >= 0xdc00 && unit <= 0xdfff) return invalid(path);
	}
	const size = new TextEncoder().encode(value).byteLength;
	if (size < minimumBytes || size > maximumBytes) return invalid(path);
	return value;
}

function enumeration<const Value extends string>(
	value: unknown,
	path: string,
	allowed: readonly Value[],
): Value {
	if (typeof value !== "string" || !allowed.includes(value as Value))
		return invalid(path);
	return value as Value;
}

function integer(
	environment: Environment,
	name: string,
	minimum: number,
	maximum: number,
	defaultValue: number,
): number {
	const value = environment[name];
	if (value === undefined) return defaultValue;
	if (!/^(?:0|[1-9][0-9]*)$/u.test(value))
		return invalid(`environment.${name}`);
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
		return invalid(`environment.${name}`);
	return parsed;
}

function environmentEnum<const Value extends string>(
	environment: Environment,
	name: string,
	allowed: readonly Value[],
	defaultValue: Value,
): Value {
	const value = environment[name];
	return value === undefined
		? defaultValue
		: enumeration(value, `environment.${name}`, allowed);
}

function endpoint(value: string | undefined): string | null {
	if (value === undefined) return null;
	const bounded = boundedString(
		value,
		"environment.OTEL_EXPORTER_OTLP_ENDPOINT",
		1,
		2_048,
	);
	let parsed: URL;
	try {
		parsed = new URL(bounded);
	} catch {
		return invalid("environment.OTEL_EXPORTER_OTLP_ENDPOINT");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
		return invalid("environment.OTEL_EXPORTER_OTLP_ENDPOINT");
	return bounded;
}

function headers(value: string | undefined): Readonly<Record<string, string>> {
	if (value === undefined) return Object.freeze({});
	const bounded = boundedString(
		value,
		"environment.OTEL_EXPORTER_OTLP_HEADERS",
		1,
		8_192,
	);
	const parsed: Record<string, string> = Object.create(null);
	for (const member of bounded.split(",")) {
		const equals = member.indexOf("=");
		const name = member.slice(0, equals);
		const headerValue = member.slice(equals + 1);
		if (
			equals <= 0 ||
			!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name) ||
			Array.from(headerValue).some((character) => {
				const code = character.codePointAt(0) ?? 0;
				return code < 32 || code === 127;
			})
		)
			return invalid("environment.OTEL_EXPORTER_OTLP_HEADERS");
		parsed[name] = headerValue;
	}
	return Object.freeze(parsed);
}

function sampler(environment: Environment) {
	const name = environmentEnum(
		environment,
		"OTEL_TRACES_SAMPLER",
		[
			"parentbased_always_on",
			"parentbased_always_off",
			"parentbased_traceidratio",
		] as const,
		"parentbased_always_on",
	);
	const argument = environment.OTEL_TRACES_SAMPLER_ARG;
	if (name !== "parentbased_traceidratio") {
		if (argument !== undefined)
			return invalid("environment.OTEL_TRACES_SAMPLER_ARG");
		return Object.freeze({ name, ratio: null });
	}
	if (
		argument === undefined ||
		!/^(?:0(?:\.[0-9]+)?|1(?:\.0+)?)$/u.test(argument)
	)
		return invalid("environment.OTEL_TRACES_SAMPLER_ARG");
	return Object.freeze({ name, ratio: Number(argument) });
}

export function decodeOpenTelemetryConfiguration(
	options: OpenTelemetryOptions | undefined,
	environment: Environment,
) {
	const candidate = record(options === undefined ? {} : options, "options", [
		"deploymentEnvironment",
		"ingress",
		"operationalIds",
	]);
	let trustBoundary: "continue" | "restart" = "continue";
	if (candidate.ingress !== undefined) {
		const ingress = record(candidate.ingress, "options.ingress", [
			"trustBoundary",
		]);
		if (ingress.trustBoundary !== undefined)
			trustBoundary = enumeration(
				ingress.trustBoundary,
				"options.ingress.trustBoundary",
				["continue", "restart"],
			);
	}
	const operationalIds =
		candidate.operationalIds === undefined
			? "omit"
			: enumeration(candidate.operationalIds, "options.operationalIds", [
					"omit",
					"spans",
				]);
	let deploymentEnvironment: string | null = null;
	if (candidate.deploymentEnvironment !== undefined) {
		deploymentEnvironment = boundedString(
			candidate.deploymentEnvironment,
			"options.deploymentEnvironment",
			1,
			64,
		);
		if (!/^[\x20-\x7e]+$/u.test(deploymentEnvironment))
			return invalid("options.deploymentEnvironment");
	}
	const traces = environmentEnum(
		environment,
		"OTEL_TRACES_EXPORTER",
		["otlp", "none"],
		"otlp",
	);
	const metrics = environmentEnum(
		environment,
		"OTEL_METRICS_EXPORTER",
		["otlp", "none"],
		"otlp",
	);
	const protocol = environmentEnum(
		environment,
		"OTEL_EXPORTER_OTLP_PROTOCOL",
		["http/protobuf"],
		"http/protobuf",
	);
	const maxQueueSize = integer(
		environment,
		"OTEL_BSP_MAX_QUEUE_SIZE",
		1,
		65_536,
		2_048,
	);
	const maxExportBatchSize = integer(
		environment,
		"OTEL_BSP_MAX_EXPORT_BATCH_SIZE",
		1,
		maxQueueSize,
		Math.min(512, maxQueueSize),
	);
	const otlpEndpoint = endpoint(environment.OTEL_EXPORTER_OTLP_ENDPOINT);
	const otlpHeaders = headers(environment.OTEL_EXPORTER_OTLP_HEADERS);
	return Object.freeze({
		artifact: Object.freeze({
			deploymentEnvironment,
			trustBoundary,
			operationalIds,
			traces,
			metrics,
			protocol,
			otlpEndpointConfigured: otlpEndpoint !== null,
			otlpHeadersConfigured: Object.keys(otlpHeaders).length > 0,
			otlpTimeoutMilliseconds: integer(
				environment,
				"OTEL_EXPORTER_OTLP_TIMEOUT",
				1,
				30_000,
				10_000,
			),
			sampler: sampler(environment),
			maxQueueSize,
			maxExportBatchSize,
			batchExportTimeoutMilliseconds: integer(
				environment,
				"OTEL_BSP_EXPORT_TIMEOUT",
				1,
				30_000,
				30_000,
			),
			batchScheduleDelayMilliseconds: integer(
				environment,
				"OTEL_BSP_SCHEDULE_DELAY",
				1,
				30_000,
				5_000,
			),
			metricExportIntervalMilliseconds: integer(
				environment,
				"OTEL_METRIC_EXPORT_INTERVAL",
				1_000,
				300_000,
				60_000,
			),
			metricExportTimeoutMilliseconds: integer(
				environment,
				"OTEL_METRIC_EXPORT_TIMEOUT",
				1,
				30_000,
				30_000,
			),
			serviceName:
				environment.OTEL_SERVICE_NAME === undefined
					? null
					: boundedString(
							environment.OTEL_SERVICE_NAME,
							"environment.OTEL_SERVICE_NAME",
							1,
							128,
						),
		}),
		runtime: Object.freeze({ otlpEndpoint, otlpHeaders }),
	});
}

function canonical(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	const source = value as Readonly<Record<string, unknown>>;
	return `{${Object.keys(source)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonical(source[key])}`)
		.join(",")}}`;
}

export function buildEffectiveConfig(
	metadata: Readonly<{
		applicationIdentity: string;
		runtimeBuildDigest: string;
		runtimeInstanceId: string;
		signalProjectionDigest: string;
		questpieVersion: string;
	}>,
	configuration: ReturnType<typeof decodeOpenTelemetryConfiguration>,
) {
	if (metadata.questpieVersion !== EXPECTED_QUESTPIE_VERSION)
		throw new TypeError("QP-OTEL-002 input.questpieVersion");
	if (metadata.signalProjectionDigest !== EXPECTED_SIGNAL_PROJECTION_DIGEST)
		throw new TypeError("QP-OTEL-002 projectionMismatch");
	const decoded = configuration.artifact;
	const resource = {
		serviceName: decoded.serviceName ?? metadata.applicationIdentity,
		serviceVersion: metadata.questpieVersion,
		serviceInstanceId: metadata.runtimeInstanceId,
		runtimeBuildDigest: metadata.runtimeBuildDigest,
		...(decoded.deploymentEnvironment === null
			? {}
			: { deploymentEnvironment: decoded.deploymentEnvironment }),
	};
	const artifact = Object.freeze({
		format: "questpie.opentelemetry-effective-config",
		version: 1,
		projectionDigest: metadata.signalProjectionDigest,
		resource: Object.freeze(resource),
		ingress: Object.freeze({ trustBoundary: decoded.trustBoundary }),
		operationalIds: decoded.operationalIds,
		export: Object.freeze({
			metrics: decoded.metrics,
			otlpEndpointConfigured: decoded.otlpEndpointConfigured,
			otlpHeadersConfigured: decoded.otlpHeadersConfigured,
			otlpTimeoutMilliseconds: decoded.otlpTimeoutMilliseconds,
			protocol: decoded.protocol,
			traces: decoded.traces,
		}),
		sampler: decoded.sampler,
		batchSpans: Object.freeze({
			exportTimeoutMilliseconds: decoded.batchExportTimeoutMilliseconds,
			maxExportBatchSize: decoded.maxExportBatchSize,
			maxQueueSize: decoded.maxQueueSize,
			scheduleDelayMilliseconds: decoded.batchScheduleDelayMilliseconds,
		}),
		metrics: Object.freeze({
			exportIntervalMilliseconds: decoded.metricExportIntervalMilliseconds,
			exportTimeoutMilliseconds: decoded.metricExportTimeoutMilliseconds,
		}),
	});
	const bytes = new TextEncoder().encode(`${canonical(artifact)}\n`);
	const digest = createHash("sha256")
		.update("questpie-opentelemetry-config-v1\0")
		.update(bytes)
		.digest("hex");
	return Object.freeze({ artifact, bytes, digest });
}
