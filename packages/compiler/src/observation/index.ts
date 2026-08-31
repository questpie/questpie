import {
	END_OUTCOMES,
	EVENT_OUTCOMES,
	EVENT_SCOPES,
	type ScopeKind,
} from "@questpie/runtime/observation";

import { canonicalBytes, digest } from "../canonical";

function deepFreeze<Value>(value: Value): Value {
	if (value && typeof value === "object") {
		for (const member of Object.values(value as Record<string, unknown>))
			deepFreeze(member);
		if (!Object.isFrozen(value)) Object.freeze(value);
	}
	return value;
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
] as const);
const ALL_SCOPES = Object.freeze([
	"runtime",
	"fetch",
	"route",
	"execution",
	"query",
	"mutation",
	"action",
	"transaction",
	"postgresql",
	"job.accept",
	"reaction.accept",
	"job.attempt",
	"reaction.attempt",
	"action.effect",
] satisfies readonly ScopeKind[]);
type ProjectedSpanAttribute =
	| (typeof SPAN_ATTRIBUTES)[number]
	| "questpie.retry.delay_ms";
const SPAN_ATTRIBUTE_SCOPES = Object.freeze({
	"db.operation.name": Object.freeze(["postgresql"]),
	"db.system.name": Object.freeze(["postgresql"]),
	"http.request.method": Object.freeze(["fetch", "route"]),
	"http.response.status_code": Object.freeze(["fetch", "route"]),
	"http.route": Object.freeze(["route"]),
	"questpie.attempt.id": Object.freeze(["job.attempt", "reaction.attempt"]),
	"questpie.attempt.number": Object.freeze(["job.attempt", "reaction.attempt"]),
	"questpie.dispatch.id": Object.freeze([
		"job.accept",
		"reaction.accept",
		"job.attempt",
		"reaction.attempt",
	]),
	"questpie.effect.id": Object.freeze(["action.effect"]),
	"questpie.error.code": ALL_SCOPES,
	"questpie.execution.entry": Object.freeze([
		"execution",
		"query",
		"mutation",
		"action",
	]),
	"questpie.operation.kind": Object.freeze(["query", "mutation", "action"]),
	"questpie.outcome": ALL_SCOPES,
	"questpie.resource": Object.freeze([
		"query",
		"mutation",
		"action",
		"job.accept",
		"reaction.accept",
		"job.attempt",
		"reaction.attempt",
		"action.effect",
	]),
	"questpie.retry.delay_ms": Object.freeze(["job.attempt", "reaction.attempt"]),
	"questpie.run.id": Object.freeze([
		"job.accept",
		"reaction.accept",
		"job.attempt",
		"reaction.attempt",
	]),
	"questpie.runtime.instance.id": ALL_SCOPES,
	"questpie.statement.identity": Object.freeze(["postgresql"]),
	"questpie.transaction.id": Object.freeze(["transaction", "mutation"]),
	"url.scheme": Object.freeze(["fetch", "route"]),
} satisfies Readonly<Record<ProjectedSpanAttribute, readonly ScopeKind[]>>);
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

export function projectObservationSignalProjection(questpieVersion: string) {
	const spanEventScopes = Object.fromEntries(
		Object.entries(EVENT_SCOPES).map(([event, scopes]) => [
			`questpie.${event}`,
			Object.freeze([...scopes]),
		]),
	);
	const spanEventOutcomes = Object.fromEntries(
		Object.entries(EVENT_OUTCOMES).map(([event, outcomes]) => [
			`questpie.${event}`,
			Object.freeze([...outcomes]),
		]),
	);
	const endOutcomesByScope = Object.fromEntries(
		Object.entries(END_OUTCOMES).map(([scope, outcomes]) => [
			scope,
			Object.freeze([...outcomes]),
		]),
	);
	const artifact = deepFreeze({
		format: "questpie.opentelemetry-signal-projection" as const,
		version: 1 as const,
		semanticConventions: { version: "1.44.0" },
		instrumentationScope: { name: "questpie", version: questpieVersion },
		resourceAttributeAllowlist: RESOURCE_ATTRIBUTES,
		spanGraph: SPAN_GRAPH,
		spanAttributeAllowlist: SPAN_ATTRIBUTES,
		spanAttributeScopes: SPAN_ATTRIBUTE_SCOPES,
		spanAttributeMaximumUtf8Bytes: 256,
		httpMethodNormalization: [
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
		],
		postgresOperations: ["SELECT", "INSERT", "UPDATE", "DELETE", "CALL"],
		spanStatus: {
			unset: [
				"ok",
				"declared_error",
				"cancelled",
				"deadline",
				"ambiguous",
				"fenced",
				"retry",
			],
			errorWithoutDescription: ["framework_error"],
		},
		spanEventLimit: 32,
		spanEventNames: Object.keys(spanEventScopes).sort(),
		spanEventOutcomes,
		spanEventScopes,
		endOutcomesByScope,
		transactionIdentity: {
			kind: "postgresXid8Text",
			canonicalPattern: "^[1-9][0-9]{0,19}$",
			maximum: "18446744073709551615",
		},
		envelopeEventShape: {
			started: "exact_redacted_start_variant",
			event: "exact_event_variant",
			ended: "exact_end_variant",
		},
		observationDropCauses: ["event_limit", "adapter_fault"],
		jobQueueDelayOrigin: "max(acceptedAt,notBefore)_to_successful_claim",
		operationHistogramBoundariesSeconds: [
			0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
			30,
		],
		durableHistogramBoundariesSeconds: [
			0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
			30, 60, 300, 900,
		],
		metrics: METRICS,
		forbiddenSignalMaterial: [
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
		],
	});
	const bytes = canonicalBytes(artifact);
	return Object.freeze({
		artifact,
		bytes,
		digest: digest("questpie-opentelemetry-projection-v1", artifact),
	});
}
