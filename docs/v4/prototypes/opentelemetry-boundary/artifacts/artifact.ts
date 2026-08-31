import { createHash } from "node:crypto";

import { canonicalJsonLine } from "../../../../../packages/runtime/src/canonical-json";

export type ArtifactDigestDomain = "projection-v1" | "config-v1";

export class ArtifactDiagnostic extends TypeError {
	readonly code: "QP-OTEL-001" | "QP-OTEL-002";
	readonly reason: string;

	constructor(code: "QP-OTEL-001" | "QP-OTEL-002", reason: string) {
		super(`${code} rejected ${reason}`);
		this.name = "ArtifactDiagnostic";
		this.code = code;
		this.reason = reason;
	}
}

const UTF8 = new TextEncoder();
const UUID_V4 =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

function hasLoneSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const unit = value.charCodeAt(index);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
			index += 1;
		} else if (unit >= 0xdc00 && unit <= 0xdfff) return true;
	}
	return false;
}

function deepFreeze<Value>(value: Value): Value {
	if (value && typeof value === "object") {
		for (const member of Object.values(value as Record<string, unknown>))
			deepFreeze(member);
		if (!Object.isFrozen(value)) Object.freeze(value);
	}
	return value;
}

export function digestArtifactBytes(
	domain: ArtifactDigestDomain,
	bytes: Uint8Array,
): string {
	return createHash("sha256")
		.update(`questpie-opentelemetry-${domain}\0`)
		.update(bytes)
		.digest("hex");
}

function record(
	value: unknown,
	path: string,
	allowedKeys: readonly string[],
	code: ArtifactDiagnostic["code"] = "QP-OTEL-001",
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new ArtifactDiagnostic(code, path);
	const candidate = value as Readonly<Record<string, unknown>>;
	const allowed = new Set(allowedKeys);
	const unknown = Object.keys(candidate)
		.filter((key) => !allowed.has(key))
		.sort()[0];
	if (unknown !== undefined)
		throw new ArtifactDiagnostic(code, `${path}.${unknown}`);
	return candidate;
}

function boundedString(
	value: unknown,
	path: string,
	minimumBytes: number,
	maximumBytes: number,
	code: ArtifactDiagnostic["code"] = "QP-OTEL-001",
): string {
	if (typeof value !== "string" || hasLoneSurrogate(value))
		throw new ArtifactDiagnostic(code, path);
	const bytes = UTF8.encode(value).byteLength;
	if (bytes < minimumBytes || bytes > maximumBytes)
		throw new ArtifactDiagnostic(code, path);
	return value;
}

function enumeration<const Value extends string>(
	value: unknown,
	path: string,
	values: readonly Value[],
	code: ArtifactDiagnostic["code"] = "QP-OTEL-001",
): Value {
	if (typeof value !== "string" || !values.includes(value as Value))
		throw new ArtifactDiagnostic(code, path);
	return value as Value;
}

function environmentInteger(
	environment: Readonly<Record<string, unknown>>,
	name: string,
	minimum: number,
	maximum: number,
	defaultValue: number,
): number {
	const value = environment[name];
	if (value === undefined) return defaultValue;
	if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value))
		throw new ArtifactDiagnostic("QP-OTEL-001", `environment.${name}`);
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
		throw new ArtifactDiagnostic("QP-OTEL-001", `environment.${name}`);
	return parsed;
}

function environmentEnum<const Value extends string>(
	environment: Readonly<Record<string, unknown>>,
	name: string,
	values: readonly Value[],
	defaultValue: Value,
): Value {
	const value = environment[name];
	if (value === undefined) return defaultValue;
	return enumeration(value, `environment.${name}`, values);
}

function decodeOptions(value: unknown): Readonly<{
	ingressTrustBoundary: "continue" | "restart";
	operationalIds: "omit" | "spans";
	deploymentEnvironment: string | null;
}> {
	if (value === undefined)
		return {
			ingressTrustBoundary: "continue",
			operationalIds: "omit",
			deploymentEnvironment: null,
		};
	const options = record(value, "options", [
		"ingress",
		"operationalIds",
		"deploymentEnvironment",
	]);
	let ingressTrustBoundary: "continue" | "restart" = "continue";
	if (options.ingress !== undefined) {
		const ingress = record(options.ingress, "options.ingress", [
			"trustBoundary",
		]);
		if (ingress.trustBoundary !== undefined)
			ingressTrustBoundary = enumeration(
				ingress.trustBoundary,
				"options.ingress.trustBoundary",
				["continue", "restart"],
			);
	}
	const operationalIds =
		options.operationalIds === undefined
			? "omit"
			: enumeration(options.operationalIds, "options.operationalIds", [
					"omit",
					"spans",
				]);
	let deploymentEnvironment: string | null = null;
	if (options.deploymentEnvironment !== undefined) {
		deploymentEnvironment = boundedString(
			options.deploymentEnvironment,
			"options.deploymentEnvironment",
			1,
			64,
		);
		if (!/^[\x20-\x7e]+$/u.test(deploymentEnvironment))
			throw new ArtifactDiagnostic(
				"QP-OTEL-001",
				"options.deploymentEnvironment",
			);
	}
	return { deploymentEnvironment, ingressTrustBoundary, operationalIds };
}

function decodeEnvironment(value: unknown): Readonly<Record<string, unknown>> {
	if (value === undefined) return Object.freeze({});
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new ArtifactDiagnostic("QP-OTEL-001", "environment");
	return value as Readonly<Record<string, unknown>>;
}

function decodeHeaders(value: unknown): boolean {
	if (value === undefined) return false;
	const headers = boundedString(
		value,
		"environment.OTEL_EXPORTER_OTLP_HEADERS",
		1,
		8_192,
	);
	const members = headers.split(",");
	if (
		members.some((member) => {
			const equals = member.indexOf("=");
			const headerValue = member.slice(equals + 1);
			return (
				equals <= 0 ||
				!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(member.slice(0, equals)) ||
				Array.from(headerValue).some((character) => {
					const code = character.codePointAt(0) ?? 0;
					return code < 32 || code === 127;
				})
			);
		})
	)
		throw new ArtifactDiagnostic(
			"QP-OTEL-001",
			"environment.OTEL_EXPORTER_OTLP_HEADERS",
		);
	return true;
}

function decodeEndpoint(value: unknown): boolean {
	if (value === undefined) return false;
	const endpoint = boundedString(
		value,
		"environment.OTEL_EXPORTER_OTLP_ENDPOINT",
		1,
		2_048,
	);
	let parsed: URL;
	try {
		parsed = new URL(endpoint);
	} catch {
		throw new ArtifactDiagnostic(
			"QP-OTEL-001",
			"environment.OTEL_EXPORTER_OTLP_ENDPOINT",
		);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
		throw new ArtifactDiagnostic(
			"QP-OTEL-001",
			"environment.OTEL_EXPORTER_OTLP_ENDPOINT",
		);
	return true;
}

function decodeSampler(
	environment: Readonly<Record<string, unknown>>,
): Readonly<{ name: string; ratio: number | null }> {
	const name = environmentEnum(
		environment,
		"OTEL_TRACES_SAMPLER",
		[
			"parentbased_always_on",
			"parentbased_always_off",
			"parentbased_traceidratio",
		],
		"parentbased_always_on",
	);
	const argument = environment.OTEL_TRACES_SAMPLER_ARG;
	if (name !== "parentbased_traceidratio") {
		if (argument !== undefined)
			throw new ArtifactDiagnostic(
				"QP-OTEL-001",
				"environment.OTEL_TRACES_SAMPLER_ARG",
			);
		return { name, ratio: null };
	}
	if (
		typeof argument !== "string" ||
		!/^(?:0(?:\.[0-9]+)?|1(?:\.0+)?)$/u.test(argument)
	)
		throw new ArtifactDiagnostic(
			"QP-OTEL-001",
			"environment.OTEL_TRACES_SAMPLER_ARG",
		);
	const ratio = Number(argument);
	if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1)
		throw new ArtifactDiagnostic(
			"QP-OTEL-001",
			"environment.OTEL_TRACES_SAMPLER_ARG",
		);
	return { name, ratio };
}

const RESOURCE_ATTRIBUTES = Object.freeze([
	"deployment.environment.name",
	"questpie.runtime_build.digest",
	"service.instance.id",
	"service.name",
	"service.version",
]);

const SPAN_ATTRIBUTES = Object.freeze([
	"db.operation.name",
	"db.system.name",
	"http.request.method",
	"http.response.status_code",
	"http.route",
	"questpie.attempt.id",
	"questpie.attempt.number",
	"questpie.dispatch.id",
	"questpie.effect.id",
	"questpie.error.code",
	"questpie.execution.entry",
	"questpie.operation.kind",
	"questpie.outcome",
	"questpie.resource",
	"questpie.run.id",
	"questpie.runtime.instance.id",
	"questpie.statement.identity",
	"questpie.transaction.id",
	"url.scheme",
]);

const EVENT_NAMES = Object.freeze([
	"questpie.action.ambiguous",
	"questpie.context.completed",
	"questpie.durable.accepted",
	"questpie.durable.fenced",
	"questpie.durable.retry_scheduled",
	"questpie.durable.terminal",
	"questpie.execution.cancelled",
	"questpie.execution.deadline_exceeded",
	"questpie.operation.post_commit_ambiguous",
	"questpie.receipt.replayed",
	"questpie.transaction.committed",
]);

const SPAN_GRAPH = Object.freeze([
	{
		kind: "SERVER",
		name: "POST /_questpie/operation",
		parent: "remote_parent_or_restart_link_or_root",
		scope: "generated_operation_fetch",
	},
	{
		kind: "SERVER",
		name: "{METHOD} {matched route template}",
		parent: "remote_parent_or_restart_link_or_root",
		scope: "authored_matched_route",
	},
	{
		kind: "SERVER",
		name: "{METHOD}",
		parent: "remote_parent_or_restart_link_or_root",
		scope: "unmatched_framework_fetch",
	},
	{
		kind: "INTERNAL",
		name: "questpie execution",
		parent: "active_local_context_or_root",
		scope: "direct_root_execution",
	},
	{
		kind: "INTERNAL",
		name: "query {Resource identity}",
		parent: "owning_execution",
		scope: "query_operation",
	},
	{
		kind: "INTERNAL",
		name: "mutation {Resource identity}",
		parent: "owning_execution",
		scope: "mutation_operation",
	},
	{
		kind: "INTERNAL",
		name: "action {Resource identity}",
		parent: "owning_execution_or_durable_attempt",
		scope: "action_operation",
	},
	{
		kind: "INTERNAL",
		name: "questpie transaction",
		parent: "owning_mutation",
		scope: "mutation_transaction",
	},
	{
		kind: "CLIENT",
		name: "{UPPERCASE SQL verb}",
		parent: "active_operation_transaction_or_attempt",
		scope: "compiler_owned_postgresql_call",
	},
	{
		kind: "PRODUCER",
		name: "job {Resource identity} accept",
		parent: "accepting_execution_or_mutation_transaction",
		scope: "job_acceptance",
	},
	{
		kind: "PRODUCER",
		name: "reaction {Resource identity} accept",
		parent: "committing_mutation_transaction",
		scope: "reaction_committed_fact_acceptance",
	},
	{
		kind: "CONSUMER",
		name: "job {Resource identity} attempt",
		parent: "root_with_first_acceptance_link",
		scope: "job_physical_attempt",
	},
	{
		kind: "CONSUMER",
		name: "reaction {Resource identity} attempt",
		parent: "root_with_committed_fact_acceptance_link",
		scope: "reaction_physical_attempt",
	},
	{
		kind: "CLIENT",
		name: "action {Resource identity}",
		parent: "current_operation_or_physical_attempt",
		scope: "action_effect",
	},
]);

const METRICS = Object.freeze([
	{
		attributes: [
			"questpie.error.code",
			"questpie.operation.kind",
			"questpie.outcome",
			"questpie.resource",
		],
		name: "questpie.operation.calls",
		type: "counter",
		unit: "{call}",
	},
	{
		attributes: [
			"questpie.operation.kind",
			"questpie.outcome",
			"questpie.resource",
		],
		name: "questpie.operation.duration",
		type: "histogram",
		unit: "s",
	},
	{
		attributes: ["questpie.operation.kind", "questpie.resource"],
		name: "questpie.operation.active",
		type: "up_down_counter",
		unit: "{execution}",
	},
	{
		attributes: [
			"db.operation.name",
			"questpie.outcome",
			"questpie.statement.identity",
		],
		name: "questpie.postgresql.statement.duration",
		type: "histogram",
		unit: "s",
	},
	{
		attributes: ["questpie.outcome", "questpie.resource"],
		name: "questpie.job.accepted",
		type: "counter",
		unit: "{run}",
	},
	{
		attributes: ["questpie.resource"],
		name: "questpie.job.queue.delay",
		type: "histogram",
		unit: "s",
	},
	{
		attributes: [
			"questpie.error.code",
			"questpie.outcome",
			"questpie.resource",
		],
		name: "questpie.durable.attempt.duration",
		type: "histogram",
		unit: "s",
	},
	{
		attributes: ["questpie.outcome", "questpie.resource"],
		name: "questpie.action.duration",
		type: "histogram",
		unit: "s",
	},
	{
		attributes: ["questpie.execution.entry"],
		name: "questpie.runtime.active_executions",
		type: "up_down_counter",
		unit: "{execution}",
	},
	{
		attributes: ["cause", "signal"],
		name: "questpie.observation.dropped",
		type: "counter",
		unit: "{signal}",
	},
]);

function createProjection(questpieVersion: string) {
	return deepFreeze({
		format: "questpie.opentelemetry-signal-projection",
		version: 1,
		semanticConventions: Object.freeze({ version: "1.44.0" }),
		instrumentationScope: Object.freeze({
			name: "questpie",
			version: questpieVersion,
		}),
		resourceAttributeAllowlist: RESOURCE_ATTRIBUTES,
		spanGraph: SPAN_GRAPH,
		spanAttributeAllowlist: SPAN_ATTRIBUTES,
		spanAttributeMaximumUtf8Bytes: 256,
		httpMethodNormalization: Object.freeze([
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
		]),
		postgresOperations: Object.freeze([
			"SELECT",
			"INSERT",
			"UPDATE",
			"DELETE",
			"CALL",
		]),
		spanStatus: Object.freeze({
			unset: Object.freeze([
				"ok",
				"declared_error",
				"cancelled",
				"deadline",
				"ambiguous",
				"fenced",
				"retry",
			]),
			errorWithoutDescription: Object.freeze(["framework_error"]),
		}),
		spanEventLimit: 32,
		spanEventNames: EVENT_NAMES,
		spanEventScopes: Object.freeze({
			"questpie.context.completed": Object.freeze(["execution"]),
			"questpie.receipt.replayed": Object.freeze(["mutation"]),
			"questpie.transaction.committed": Object.freeze(["transaction"]),
			"questpie.operation.post_commit_ambiguous": Object.freeze(["mutation"]),
			"questpie.durable.accepted": Object.freeze([
				"job.accept",
				"reaction.accept",
			]),
			"questpie.execution.cancelled": Object.freeze(["execution"]),
			"questpie.execution.deadline_exceeded": Object.freeze(["execution"]),
			"questpie.durable.fenced": Object.freeze([
				"job.attempt",
				"reaction.attempt",
			]),
			"questpie.durable.retry_scheduled": Object.freeze([
				"job.attempt",
				"reaction.attempt",
			]),
			"questpie.durable.terminal": Object.freeze([
				"job.attempt",
				"reaction.attempt",
			]),
			"questpie.action.ambiguous": Object.freeze(["action.effect"]),
		}),
		endOutcomesByScope: Object.freeze({
			runtime: Object.freeze([
				"ok",
				"framework_error",
				"cancelled",
				"deadline",
			]),
			fetch: Object.freeze(["ok", "framework_error", "cancelled", "deadline"]),
			route: Object.freeze(["ok", "framework_error", "cancelled", "deadline"]),
			execution: Object.freeze([
				"ok",
				"declared_error",
				"framework_error",
				"cancelled",
				"deadline",
			]),
			query: Object.freeze([
				"ok",
				"declared_error",
				"framework_error",
				"cancelled",
				"deadline",
			]),
			mutation: Object.freeze([
				"ok",
				"declared_error",
				"framework_error",
				"cancelled",
				"deadline",
				"ambiguous",
			]),
			action: Object.freeze([
				"ok",
				"declared_error",
				"framework_error",
				"cancelled",
				"deadline",
				"ambiguous",
			]),
			transaction: Object.freeze([
				"ok",
				"framework_error",
				"cancelled",
				"deadline",
			]),
			postgresql: Object.freeze([
				"ok",
				"framework_error",
				"cancelled",
				"deadline",
			]),
			"job.accept": Object.freeze([
				"ok",
				"declared_error",
				"framework_error",
				"cancelled",
				"deadline",
			]),
			"reaction.accept": Object.freeze([
				"ok",
				"declared_error",
				"framework_error",
				"cancelled",
				"deadline",
			]),
			"job.attempt": Object.freeze([
				"ok",
				"declared_error",
				"framework_error",
				"cancelled",
				"deadline",
				"fenced",
				"retry",
			]),
			"reaction.attempt": Object.freeze([
				"ok",
				"declared_error",
				"framework_error",
				"cancelled",
				"deadline",
				"fenced",
				"retry",
			]),
			"action.effect": Object.freeze([
				"ok",
				"declared_error",
				"framework_error",
				"cancelled",
				"deadline",
				"ambiguous",
			]),
		}),
		transactionIdentity: Object.freeze({
			kind: "postgresXid8Text",
			canonicalPattern: "^[1-9][0-9]{0,19}$",
			maximum: "18446744073709551615",
		}),
		envelopeEventShape: Object.freeze({
			started: "exact_redacted_start_variant",
			event: "exact_event_variant",
			ended: "exact_end_variant",
		}),
		observationDropCauses: Object.freeze(["event_limit", "adapter_fault"]),
		jobQueueDelayOrigin: "max(acceptedAt,notBefore)_to_successful_claim",
		operationHistogramBoundariesSeconds: Object.freeze([
			0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
			30,
		]),
		durableHistogramBoundariesSeconds: Object.freeze([
			0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
			30, 60, 300, 900,
		]),
		metrics: METRICS,
		forbiddenSignalMaterial: Object.freeze([
			"baggage",
			"callIdentity",
			"context",
			"credentials",
			"databaseUrl",
			"errorMessage",
			"headers",
			"policyEvidence",
			"principalIdentity",
			"providerPayload",
			"requestBody",
			"responseBody",
			"serviceState",
			"sqlParameters",
			"sqlText",
			"stack",
			"tenantIdentity",
		]),
	});
}

export function buildArtifacts(input: unknown) {
	const candidate = record(input, "input", [
		"questpieVersion",
		"applicationIdentity",
		"runtimeBuildDigest",
		"runtimeInstanceId",
		"options",
		"environment",
	]);
	const questpieVersion = boundedString(
		candidate.questpieVersion,
		"input.questpieVersion",
		1,
		64,
	);
	const applicationIdentity = boundedString(
		candidate.applicationIdentity,
		"input.applicationIdentity",
		1,
		256,
	);
	if (
		typeof candidate.runtimeBuildDigest !== "string" ||
		!SHA256.test(candidate.runtimeBuildDigest)
	)
		throw new ArtifactDiagnostic("QP-OTEL-001", "input.runtimeBuildDigest");
	if (
		typeof candidate.runtimeInstanceId !== "string" ||
		!UUID_V4.test(candidate.runtimeInstanceId)
	)
		throw new ArtifactDiagnostic("QP-OTEL-001", "input.runtimeInstanceId");

	const options = decodeOptions(candidate.options);
	const environment = decodeEnvironment(candidate.environment);
	const serviceName =
		environment.OTEL_SERVICE_NAME === undefined
			? applicationIdentity
			: boundedString(
					environment.OTEL_SERVICE_NAME,
					"environment.OTEL_SERVICE_NAME",
					1,
					128,
				);
	const traces = environmentEnum(
		environment,
		"OTEL_TRACES_EXPORTER",
		["otlp", "none"],
		"otlp",
	);
	const metricsExporter = environmentEnum(
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
	const maxQueueSize = environmentInteger(
		environment,
		"OTEL_BSP_MAX_QUEUE_SIZE",
		1,
		65_536,
		2_048,
	);
	const maxExportBatchSize = environmentInteger(
		environment,
		"OTEL_BSP_MAX_EXPORT_BATCH_SIZE",
		1,
		maxQueueSize,
		Math.min(512, maxQueueSize),
	);
	if (maxExportBatchSize > maxQueueSize)
		throw new ArtifactDiagnostic(
			"QP-OTEL-001",
			"environment.OTEL_BSP_MAX_EXPORT_BATCH_SIZE",
		);
	const sampler = decodeSampler(environment);

	const projection = createProjection(questpieVersion);
	const projectionBytes = canonicalJsonLine(projection);
	const projectionDigest = digestArtifactBytes(
		"projection-v1",
		projectionBytes,
	);
	const resource = {
		serviceName,
		serviceVersion: questpieVersion,
		serviceInstanceId: candidate.runtimeInstanceId,
		runtimeBuildDigest: candidate.runtimeBuildDigest,
		...(options.deploymentEnvironment === null
			? {}
			: { deploymentEnvironment: options.deploymentEnvironment }),
	};
	const config = Object.freeze({
		format: "questpie.opentelemetry-effective-config",
		version: 1,
		projectionDigest,
		resource: Object.freeze(resource),
		ingress: Object.freeze({ trustBoundary: options.ingressTrustBoundary }),
		operationalIds: options.operationalIds,
		export: Object.freeze({
			metrics: metricsExporter,
			otlpEndpointConfigured: decodeEndpoint(
				environment.OTEL_EXPORTER_OTLP_ENDPOINT,
			),
			otlpHeadersConfigured: decodeHeaders(
				environment.OTEL_EXPORTER_OTLP_HEADERS,
			),
			otlpTimeoutMilliseconds: environmentInteger(
				environment,
				"OTEL_EXPORTER_OTLP_TIMEOUT",
				1,
				30_000,
				10_000,
			),
			protocol,
			traces,
		}),
		sampler: Object.freeze(sampler),
		batchSpans: Object.freeze({
			exportTimeoutMilliseconds: environmentInteger(
				environment,
				"OTEL_BSP_EXPORT_TIMEOUT",
				1,
				30_000,
				30_000,
			),
			maxExportBatchSize,
			maxQueueSize,
			scheduleDelayMilliseconds: environmentInteger(
				environment,
				"OTEL_BSP_SCHEDULE_DELAY",
				1,
				30_000,
				5_000,
			),
		}),
		metrics: Object.freeze({
			exportIntervalMilliseconds: environmentInteger(
				environment,
				"OTEL_METRIC_EXPORT_INTERVAL",
				1_000,
				300_000,
				60_000,
			),
			exportTimeoutMilliseconds: environmentInteger(
				environment,
				"OTEL_METRIC_EXPORT_TIMEOUT",
				1,
				30_000,
				30_000,
			),
		}),
	});
	const configBytes = canonicalJsonLine(config);
	const configDigest = digestArtifactBytes("config-v1", configBytes);
	return Object.freeze({
		projection,
		projectionBytes,
		projectionDigest,
		config,
		configBytes,
		configDigest,
	});
}

const OUTCOMES = Object.freeze([
	"ok",
	"declared_error",
	"framework_error",
	"cancelled",
	"deadline",
	"ambiguous",
	"fenced",
	"retry",
] as const);

export function projectOperationAttributes(
	input: unknown,
	operationalIds: "omit" | "spans",
): Readonly<Record<string, string | number>> {
	const span = record(
		input,
		"span",
		[
			"resource",
			"operationKind",
			"entry",
			"outcome",
			"errorCode",
			"runtimeInstanceId",
		],
		"QP-OTEL-002",
	);
	const resource = boundedString(
		span.resource,
		"span.resource",
		1,
		256,
		"QP-OTEL-002",
	);
	const operationKind = enumeration(
		span.operationKind,
		"span.operationKind",
		["query", "mutation", "action"],
		"QP-OTEL-002",
	);
	const entry = enumeration(
		span.entry,
		"span.entry",
		["direct", "fetch", "watch_initial", "watch_recompute", "worker"],
		"QP-OTEL-002",
	);
	const outcome = enumeration(
		span.outcome,
		"span.outcome",
		OUTCOMES,
		"QP-OTEL-002",
	);
	const errorCode =
		span.errorCode === undefined
			? null
			: boundedString(span.errorCode, "span.errorCode", 1, 256, "QP-OTEL-002");
	let runtimeInstanceId: string | null = null;
	if (span.runtimeInstanceId !== undefined) {
		if (
			typeof span.runtimeInstanceId !== "string" ||
			!UUID_V4.test(span.runtimeInstanceId)
		)
			throw new ArtifactDiagnostic("QP-OTEL-002", "span.runtimeInstanceId");
		runtimeInstanceId = span.runtimeInstanceId;
	}
	return Object.freeze({
		"questpie.resource": resource,
		"questpie.operation.kind": operationKind,
		"questpie.execution.entry": entry,
		"questpie.outcome": outcome,
		...(errorCode === null ? {} : { "questpie.error.code": errorCode }),
		...(operationalIds === "spans" && runtimeInstanceId !== null
			? { "questpie.runtime.instance.id": runtimeInstanceId }
			: {}),
	});
}

export function projectPostgresAttributes(
	input: unknown,
): Readonly<Record<string, string>> {
	const span = record(
		input,
		"span",
		["statementIdentity", "dbOperation", "outcome"],
		"QP-OTEL-002",
	);
	const statementIdentity = boundedString(
		span.statementIdentity,
		"span.statementIdentity",
		1,
		256,
		"QP-OTEL-002",
	);
	const dbOperation = enumeration(
		span.dbOperation,
		"span.dbOperation",
		["SELECT", "INSERT", "UPDATE", "DELETE", "CALL"],
		"QP-OTEL-002",
	);
	const outcome = enumeration(
		span.outcome,
		"span.outcome",
		OUTCOMES,
		"QP-OTEL-002",
	);
	return Object.freeze({
		"questpie.statement.identity": statementIdentity,
		"db.system.name": "postgresql",
		"db.operation.name": dbOperation,
		"questpie.outcome": outcome,
	});
}
