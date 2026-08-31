import { describe, test } from "bun:test";
import {
	deepStrictEqual,
	doesNotMatch,
	match,
	notStrictEqual,
	strictEqual,
	throws,
} from "node:assert";

import {
	ArtifactDiagnostic,
	buildArtifacts,
	digestArtifactBytes,
	projectOperationAttributes,
	projectPostgresAttributes,
} from "./artifact";

const baseInput = Object.freeze({
	questpieVersion: "4.0.0-beta.1",
	applicationIdentity: "application:team-support-desk",
	runtimeBuildDigest: "b".repeat(64),
	runtimeInstanceId: "01234567-89ab-4def-8123-456789abcdef",
});

function expectDiagnostic(input: unknown, reason: string): ArtifactDiagnostic {
	let caught: unknown;
	try {
		buildArtifacts(input);
	} catch (error) {
		caught = error;
	}
	strictEqual(caught instanceof ArtifactDiagnostic, true);
	strictEqual((caught as ArtifactDiagnostic).code, "QP-OTEL-001");
	strictEqual((caught as ArtifactDiagnostic).reason, reason);
	return caught as ArtifactDiagnostic;
}

describe("canonical OpenTelemetry projection and config artifacts", () => {
	test("are deterministic, newline terminated, version bound, and domain separated", () => {
		const first = buildArtifacts({
			...baseInput,
			options: {
				operationalIds: "omit",
				ingress: { trustBoundary: "continue" },
			},
			environment: {
				OTEL_BSP_MAX_EXPORT_BATCH_SIZE: "64",
				OTEL_BSP_MAX_QUEUE_SIZE: "128",
				OTEL_METRICS_EXPORTER: "none",
				OTEL_TRACES_EXPORTER: "otlp",
			},
		});
		const reordered = buildArtifacts({
			environment: {
				OTEL_TRACES_EXPORTER: "otlp",
				OTEL_METRICS_EXPORTER: "none",
				OTEL_BSP_MAX_QUEUE_SIZE: "128",
				OTEL_BSP_MAX_EXPORT_BATCH_SIZE: "64",
			},
			options: {
				ingress: { trustBoundary: "continue" },
				operationalIds: "omit",
			},
			runtimeInstanceId: baseInput.runtimeInstanceId,
			runtimeBuildDigest: baseInput.runtimeBuildDigest,
			applicationIdentity: baseInput.applicationIdentity,
			questpieVersion: baseInput.questpieVersion,
		});

		deepStrictEqual(first, reordered);
		strictEqual(
			new TextDecoder().decode(first.projectionBytes).endsWith("\n"),
			true,
		);
		strictEqual(
			new TextDecoder().decode(first.configBytes).endsWith("\n"),
			true,
		);
		match(first.projectionDigest, /^[0-9a-f]{64}$/u);
		match(first.configDigest, /^[0-9a-f]{64}$/u);
		strictEqual(
			first.projectionDigest,
			"94568377fb1d713d98e81922e33dcaea31cc03192f5b1bcb16fba330b2517f7c",
		);
		strictEqual(
			first.configDigest,
			"0da930d424c5fc8fe3fae177d360fafe30f52066e3ce8eb66ac5d6242077637f",
		);
		strictEqual(first.config.projectionDigest, first.projectionDigest);
		strictEqual(first.projection.semanticConventions.version, "1.44.0");
		strictEqual(first.projection.instrumentationScope.name, "questpie");
		strictEqual(first.projection.instrumentationScope.version, "4.0.0-beta.1");
		strictEqual(first.projection.spanGraph.length, 14);
		deepStrictEqual(first.projection.transactionIdentity, {
			kind: "postgresXid8Text",
			canonicalPattern: "^[1-9][0-9]{0,19}$",
			maximum: "18446744073709551615",
		});
		deepStrictEqual(
			first.projection.spanEventScopes["questpie.durable.retry_scheduled"],
			["job.attempt", "reaction.attempt"],
		);
		deepStrictEqual(first.projection.endOutcomesByScope.mutation, [
			"ok",
			"declared_error",
			"framework_error",
			"cancelled",
			"deadline",
			"ambiguous",
		]);
		deepStrictEqual(first.projection.envelopeEventShape, {
			started: "exact_redacted_start_variant",
			event: "exact_event_variant",
			ended: "exact_end_variant",
		});
		deepStrictEqual(first.projection.httpMethodNormalization, [
			"CONNECT",
			"DELETE",
			"GET",
			"HEAD",
			"OPTIONS",
			"PATCH",
			"POST",
			"PUT",
			"TRACE",
			"_OTHER",
		]);
		deepStrictEqual(first.projection.observationDropCauses, [
			"event_limit",
			"adapter_fault",
		]);
		strictEqual(
			first.projection.jobQueueDelayOrigin,
			"max(acceptedAt,notBefore)_to_successful_claim",
		);
		deepStrictEqual(first.projection.postgresOperations, [
			"SELECT",
			"INSERT",
			"UPDATE",
			"DELETE",
			"CALL",
		]);
		strictEqual(first.projection.metrics.length, 10);
		strictEqual(Object.isFrozen(first.projection), true);
		strictEqual(Object.isFrozen(first.projection.spanGraph[0]!), true);
		strictEqual(Object.isFrozen(first.projection.metrics[0]!.attributes), true);
		notStrictEqual(
			digestArtifactBytes("projection-v1", first.projectionBytes),
			digestArtifactBytes("config-v1", first.projectionBytes),
		);

		const otherVersion = buildArtifacts({
			...baseInput,
			questpieVersion: "4.0.0-beta.2",
		});
		notStrictEqual(otherVersion.projectionDigest, first.projectionDigest);
		notStrictEqual(otherVersion.configDigest, first.configDigest);
	});

	test("materializes exact defaults and binds queue and batch bounds", () => {
		const built = buildArtifacts(baseInput);
		deepStrictEqual(built.config.export, {
			metrics: "otlp",
			otlpEndpointConfigured: false,
			otlpHeadersConfigured: false,
			otlpTimeoutMilliseconds: 10_000,
			protocol: "http/protobuf",
			traces: "otlp",
		});
		deepStrictEqual(built.config.batchSpans, {
			exportTimeoutMilliseconds: 30_000,
			maxExportBatchSize: 512,
			maxQueueSize: 2_048,
			scheduleDelayMilliseconds: 5_000,
		});
		deepStrictEqual(built.config.metrics, {
			exportIntervalMilliseconds: 60_000,
			exportTimeoutMilliseconds: 30_000,
		});

		expectDiagnostic(
			{
				...baseInput,
				environment: { OTEL_BSP_MAX_QUEUE_SIZE: "0" },
			},
			"environment.OTEL_BSP_MAX_QUEUE_SIZE",
		);
		expectDiagnostic(
			{
				...baseInput,
				environment: { OTEL_BSP_MAX_QUEUE_SIZE: "65537" },
			},
			"environment.OTEL_BSP_MAX_QUEUE_SIZE",
		);
		expectDiagnostic(
			{
				...baseInput,
				environment: {
					OTEL_BSP_MAX_QUEUE_SIZE: "128",
					OTEL_BSP_MAX_EXPORT_BATCH_SIZE: "129",
				},
			},
			"environment.OTEL_BSP_MAX_EXPORT_BATCH_SIZE",
		);
		const smallQueue = buildArtifacts({
			...baseInput,
			environment: { OTEL_BSP_MAX_QUEUE_SIZE: "128" },
		});
		strictEqual(smallQueue.config.batchSpans.maxQueueSize, 128);
		strictEqual(smallQueue.config.batchSpans.maxExportBatchSize, 128);
	});

	test("rejects open or unsafe authored config while ignoring unsupported OTEL variables", () => {
		expectDiagnostic(
			{ ...baseInput, attributes: { "service.namespace": "injected" } },
			"input.attributes",
		);
		expectDiagnostic(
			{ ...baseInput, options: { arbitraryAttributes: { owner: "caller" } } },
			"options.arbitraryAttributes",
		);
		expectDiagnostic(
			{
				...baseInput,
				options: { ingress: { trustBoundary: "continue", baggage: true } },
			},
			"options.ingress.baggage",
		);
		expectDiagnostic(
			{
				...baseInput,
				options: { deploymentEnvironment: "prod\nsecret" },
			},
			"options.deploymentEnvironment",
		);
		expectDiagnostic(
			{
				...baseInput,
				environment: { OTEL_EXPORTER_OTLP_ENDPOINT: "file:///tmp/signals" },
			},
			"environment.OTEL_EXPORTER_OTLP_ENDPOINT",
		);
		expectDiagnostic(
			{
				...baseInput,
				environment: { OTEL_TRACES_SAMPLER: "always_on" },
			},
			"environment.OTEL_TRACES_SAMPLER",
		);

		const ignored = buildArtifacts({
			...baseInput,
			environment: {
				OTEL_LOGS_EXPORTER: "console",
				OTEL_RESOURCE_ATTRIBUTES:
					"caller.raw=CALL-SENTINEL,policy.evidence=POLICY-SENTINEL,db.statement=SQL-SENTINEL",
			},
		});
		const allBytes = `${new TextDecoder().decode(ignored.projectionBytes)}${new TextDecoder().decode(ignored.configBytes)}`;
		doesNotMatch(allBytes, /CALL-SENTINEL|POLICY-SENTINEL|SQL-SENTINEL/u);
		doesNotMatch(allBytes, /caller\.raw|policy\.evidence|db\.statement/u);
	});

	test("validates endpoint and header secrets but records only their presence", () => {
		const endpoint =
			"https://collector.example/v1/traces?token=ENDPOINT-SENTINEL";
		const headers = "authorization=HEADER-SENTINEL,x-tenant=TENANT-SENTINEL";
		const built = buildArtifacts({
			...baseInput,
			environment: {
				OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
				OTEL_EXPORTER_OTLP_HEADERS: headers,
			},
		});
		strictEqual(built.config.export.otlpEndpointConfigured, true);
		strictEqual(built.config.export.otlpHeadersConfigured, true);
		const bytes = new TextDecoder().decode(built.configBytes);
		doesNotMatch(bytes, /ENDPOINT-SENTINEL|HEADER-SENTINEL|TENANT-SENTINEL/u);
		doesNotMatch(bytes, /collector\.example|authorization|x-tenant/u);

		expectDiagnostic(
			{
				...baseInput,
				environment: { OTEL_EXPORTER_OTLP_HEADERS: "x=" + "a".repeat(8_192) },
			},
			"environment.OTEL_EXPORTER_OTLP_HEADERS",
		);
	});
});

describe("closed signal attribute projection", () => {
	test("projects only the Operation allowlist and rejects caller, Policy, SQL, and free attributes", () => {
		deepStrictEqual(
			projectOperationAttributes(
				{
					resource: "mutation:helpdesk/ticket.close",
					operationKind: "mutation",
					entry: "fetch",
					outcome: "declared_error",
					errorCode: "ticketAlreadyClosed",
				},
				"omit",
			),
			{
				"questpie.error.code": "ticketAlreadyClosed",
				"questpie.execution.entry": "fetch",
				"questpie.operation.kind": "mutation",
				"questpie.outcome": "declared_error",
				"questpie.resource": "mutation:helpdesk/ticket.close",
			},
		);

		for (const unsafe of [
			{ rawCallId: "CALL-SENTINEL" },
			{ policyEvidence: "POLICY-SENTINEL" },
			{ sqlText: "SELECT 'SQL-SENTINEL'" },
			{ attributes: { "caller.injected": "CALL-SENTINEL" } },
		]) {
			throws(
				() =>
					projectOperationAttributes(
						{
							resource: "query:helpdesk/ticket.list",
							operationKind: "query",
							entry: "direct",
							outcome: "ok",
							...unsafe,
						},
						"omit",
					),
				(error: unknown) =>
					error instanceof ArtifactDiagnostic && error.code === "QP-OTEL-002",
			);
		}
	});

	test("projects PostgreSQL identity and verb without SQL text", () => {
		deepStrictEqual(
			projectPostgresAttributes({
				statementIdentity: "statement:ticket/update",
				dbOperation: "UPDATE",
				outcome: "ok",
			}),
			{
				"db.operation.name": "UPDATE",
				"db.system.name": "postgresql",
				"questpie.outcome": "ok",
				"questpie.statement.identity": "statement:ticket/update",
			},
		);
		throws(
			() =>
				projectPostgresAttributes({
					statementIdentity: "statement:ticket/update",
					dbOperation: "UPDATE",
					outcome: "ok",
					sqlText: "UPDATE tickets SET title = 'SQL-SENTINEL'",
				}),
			(error: unknown) =>
				error instanceof ArtifactDiagnostic && error.reason === "span.sqlText",
		);
	});
});
