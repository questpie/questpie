import { expect, test } from "bun:test";

import {
	buildEffectiveConfig,
	decodeOpenTelemetryConfiguration,
} from "../../packages/opentelemetry/src/config";

const metadata = Object.freeze({
	applicationIdentity: "application:team-support-desk",
	runtimeBuildDigest: "a".repeat(64),
	runtimeInstanceId: "01234567-89ab-4def-8123-456789abcdef",
	signalProjectionDigest:
		"b2138ccb6f40f0a95df1573848fb239124b57420609e6f9f9d97d378b6a62d58",
	questpieVersion: "4.0.0-beta.1",
});

test("builds one canonical secret-free effective configuration", () => {
	const decoded = decodeOpenTelemetryConfiguration(
		{
			ingress: { trustBoundary: "restart" },
			operationalIds: "spans",
			deploymentEnvironment: "staging",
		},
		{
			OTEL_BSP_MAX_QUEUE_SIZE: "128",
			OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example/v1",
			OTEL_EXPORTER_OTLP_HEADERS: "authorization=secret-value",
			OTEL_METRICS_EXPORTER: "none",
			OTEL_TRACES_EXPORTER: "otlp",
			OTEL_UNKNOWN_MEMBER: "ignored",
		},
	);
	const first = buildEffectiveConfig(metadata, decoded);
	const second = buildEffectiveConfig(metadata, decoded);

	expect(first).toEqual(second);
	expect(new TextDecoder().decode(first.bytes).endsWith("\n")).toBe(true);
	expect(first.digest).toMatch(/^[0-9a-f]{64}$/u);
	expect(first.digest).toBe(
		"45880ece9d23211758c038abe7a42fab8ea87720a83084920893aee1c41746f8",
	);
	expect(first.artifact).toMatchObject({
		format: "questpie.opentelemetry-effective-config",
		version: 1,
		projectionDigest: metadata.signalProjectionDigest,
		resource: {
			serviceName: metadata.applicationIdentity,
			serviceVersion: metadata.questpieVersion,
			serviceInstanceId: metadata.runtimeInstanceId,
			runtimeBuildDigest: metadata.runtimeBuildDigest,
			deploymentEnvironment: "staging",
		},
		ingress: { trustBoundary: "restart" },
		operationalIds: "spans",
		export: {
			metrics: "none",
			otlpEndpointConfigured: true,
			otlpHeadersConfigured: true,
			traces: "otlp",
		},
		batchSpans: { maxQueueSize: 128, maxExportBatchSize: 128 },
	});
	const bytes = new TextDecoder().decode(first.bytes);
	expect(bytes).not.toContain("collector.example");
	expect(bytes).not.toContain("secret-value");
	expect(decoded.runtime.otlpEndpoint).toBe("https://collector.example/v1");
});

test("rejects only the safe configuration path and closes sampler and queue combinations", () => {
	for (const [environment, path] of [
		[{ OTEL_BSP_MAX_QUEUE_SIZE: "0" }, "OTEL_BSP_MAX_QUEUE_SIZE"],
		[
			{
				OTEL_BSP_MAX_QUEUE_SIZE: "128",
				OTEL_BSP_MAX_EXPORT_BATCH_SIZE: "129",
			},
			"OTEL_BSP_MAX_EXPORT_BATCH_SIZE",
		],
		[{ OTEL_TRACES_SAMPLER_ARG: "0.5" }, "OTEL_TRACES_SAMPLER_ARG"],
		[
			{ OTEL_TRACES_SAMPLER: "parentbased_traceidratio" },
			"OTEL_TRACES_SAMPLER_ARG",
		],
	] as const) {
		expect(() =>
			decodeOpenTelemetryConfiguration(undefined, environment),
		).toThrow(`QP-OTEL-001 invalidConfiguration: environment.${path}`);
	}
	expect(() =>
		decodeOpenTelemetryConfiguration({ unknown: "secret" } as never, {}),
	).toThrow("QP-OTEL-001 invalidConfiguration: options.unknown");
	expect(() =>
		buildEffectiveConfig(
			{ ...metadata, signalProjectionDigest: "b".repeat(64) },
			decodeOpenTelemetryConfiguration(undefined, {}),
		),
	).toThrow("QP-OTEL-002 projectionMismatch");
	expect(() =>
		buildEffectiveConfig(
			{ ...metadata, questpieVersion: "4.0.0-beta.2" },
			decodeOpenTelemetryConfiguration(undefined, {}),
		),
	).toThrow("QP-OTEL-002 input.questpieVersion");
});

test("pins the complete supported option and environment bounds", () => {
	const exactEndpoint = `https://x/${"a".repeat(2_038)}`;
	const exactHeaders = `authorization=${"x".repeat(8_178)}`;
	expect(new TextEncoder().encode(exactEndpoint)).toHaveLength(2_048);
	expect(new TextEncoder().encode(exactHeaders)).toHaveLength(8_192);
	const decoded = decodeOpenTelemetryConfiguration(
		{
			deploymentEnvironment: "x".repeat(64),
			ingress: { trustBoundary: "continue" },
			operationalIds: "omit",
		},
		{
			OTEL_BSP_EXPORT_TIMEOUT: "1",
			OTEL_BSP_MAX_EXPORT_BATCH_SIZE: "65536",
			OTEL_BSP_MAX_QUEUE_SIZE: "65536",
			OTEL_BSP_SCHEDULE_DELAY: "30000",
			OTEL_EXPORTER_OTLP_ENDPOINT: exactEndpoint,
			OTEL_EXPORTER_OTLP_HEADERS: exactHeaders,
			OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
			OTEL_EXPORTER_OTLP_TIMEOUT: "30000",
			OTEL_METRICS_EXPORTER: "otlp",
			OTEL_METRIC_EXPORT_INTERVAL: "300000",
			OTEL_METRIC_EXPORT_TIMEOUT: "1",
			OTEL_SERVICE_NAME: "é".repeat(64),
			OTEL_TRACES_EXPORTER: "none",
			OTEL_TRACES_SAMPLER: "parentbased_traceidratio",
			OTEL_TRACES_SAMPLER_ARG: "0.5",
			OTEL_UNSUPPORTED_SENTINEL: "ignored",
		},
	);
	expect(decoded.artifact).toMatchObject({
		batchExportTimeoutMilliseconds: 1,
		batchScheduleDelayMilliseconds: 30_000,
		maxExportBatchSize: 65_536,
		maxQueueSize: 65_536,
		metricExportIntervalMilliseconds: 300_000,
		metricExportTimeoutMilliseconds: 1,
		otlpEndpointConfigured: true,
		otlpHeadersConfigured: true,
		otlpTimeoutMilliseconds: 30_000,
		protocol: "http/protobuf",
		sampler: { name: "parentbased_traceidratio", ratio: 0.5 },
		serviceName: "é".repeat(64),
	});

	for (const [options, path] of [
		[null, "options"],
		[[], "options"],
		[{ ingress: { unknown: true } }, "options.ingress.unknown"],
		[{ ingress: { trustBoundary: "trust" } }, "options.ingress.trustBoundary"],
		[{ operationalIds: "metrics" }, "options.operationalIds"],
		[{ deploymentEnvironment: "" }, "options.deploymentEnvironment"],
		[
			{ deploymentEnvironment: "x".repeat(65) },
			"options.deploymentEnvironment",
		],
		[
			{ deploymentEnvironment: "staging\nsecret" },
			"options.deploymentEnvironment",
		],
	] as const) {
		expect(() =>
			decodeOpenTelemetryConfiguration(options as never, {}),
		).toThrow(`QP-OTEL-001 invalidConfiguration: ${path}`);
	}

	const invalidEnvironment: readonly Readonly<{
		name: string;
		value: string;
		with?: Readonly<Record<string, string>>;
	}>[] = [
		{ name: "OTEL_SERVICE_NAME", value: "" },
		{ name: "OTEL_SERVICE_NAME", value: "é".repeat(65) },
		{ name: "OTEL_TRACES_EXPORTER", value: "console" },
		{ name: "OTEL_METRICS_EXPORTER", value: "prometheus" },
		{ name: "OTEL_EXPORTER_OTLP_PROTOCOL", value: "grpc" },
		{ name: "OTEL_EXPORTER_OTLP_ENDPOINT", value: "collector.local" },
		{ name: "OTEL_EXPORTER_OTLP_ENDPOINT", value: "file:///tmp/collector" },
		{
			name: "OTEL_EXPORTER_OTLP_ENDPOINT",
			value: `https://x/${"a".repeat(2_039)}`,
		},
		{ name: "OTEL_EXPORTER_OTLP_HEADERS", value: "bad header=secret" },
		{ name: "OTEL_EXPORTER_OTLP_HEADERS", value: `a=${"x".repeat(8_191)}` },
		{ name: "OTEL_EXPORTER_OTLP_TIMEOUT", value: "0" },
		{ name: "OTEL_EXPORTER_OTLP_TIMEOUT", value: "30001" },
		{ name: "OTEL_BSP_SCHEDULE_DELAY", value: "0" },
		{ name: "OTEL_BSP_SCHEDULE_DELAY", value: "30001" },
		{ name: "OTEL_BSP_EXPORT_TIMEOUT", value: "0" },
		{ name: "OTEL_BSP_EXPORT_TIMEOUT", value: "30001" },
		{ name: "OTEL_BSP_MAX_QUEUE_SIZE", value: "0" },
		{ name: "OTEL_BSP_MAX_QUEUE_SIZE", value: "65537" },
		{ name: "OTEL_BSP_MAX_EXPORT_BATCH_SIZE", value: "0" },
		{
			name: "OTEL_BSP_MAX_EXPORT_BATCH_SIZE",
			value: "3",
			with: { OTEL_BSP_MAX_QUEUE_SIZE: "2" },
		},
		{ name: "OTEL_METRIC_EXPORT_INTERVAL", value: "999" },
		{ name: "OTEL_METRIC_EXPORT_INTERVAL", value: "300001" },
		{ name: "OTEL_METRIC_EXPORT_TIMEOUT", value: "0" },
		{ name: "OTEL_METRIC_EXPORT_TIMEOUT", value: "30001" },
		{
			name: "OTEL_TRACES_SAMPLER_ARG",
			value: ".5",
			with: { OTEL_TRACES_SAMPLER: "parentbased_traceidratio" },
		},
		{
			name: "OTEL_TRACES_SAMPLER_ARG",
			value: "1.1",
			with: { OTEL_TRACES_SAMPLER: "parentbased_traceidratio" },
		},
	];
	for (const { name, value, with: additional } of invalidEnvironment) {
		const environment = { ...additional, [name]: value };
		let message = "";
		try {
			decodeOpenTelemetryConfiguration(undefined, environment);
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toBe(
			`QP-OTEL-001 invalidConfiguration: environment.${name}`,
		);
	}

	for (const ratio of ["0", "1", "0.25"])
		expect(
			decodeOpenTelemetryConfiguration(undefined, {
				OTEL_TRACES_SAMPLER: "parentbased_traceidratio",
				OTEL_TRACES_SAMPLER_ARG: ratio,
			}).artifact.sampler.ratio,
		).toBe(Number(ratio));
});
