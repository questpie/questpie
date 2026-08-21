import { definePostgresStatement, type PostgresStatement } from "../postgres";
import type {
	PostgresRealtimeAcknowledgement,
	PostgresRealtimeGenerationStage,
} from "./postgres-realtime-scope-contract";

export type StagedBinding = Readonly<{
	deploymentDigest: string;
	authorityPartitionDigest: string;
	queryIdentity: string;
	inputDigest: string;
	wireVersion: number;
	invalidationGeneration: bigint;
	evaluatedInvalidationGeneration: bigint;
	latestGeneration: bigint;
}>;

function mutation(
	result: Readonly<{
		command: string;
		rowCount: number | null;
		rows: readonly (readonly unknown[])[];
	}>,
	command: string,
	expected?: number,
): number {
	if (
		result.command !== command ||
		result.rowCount === null ||
		result.rows.length !== 0 ||
		(expected !== undefined && result.rowCount !== expected)
	)
		throw new TypeError(`realtime generation ${command} result is invalid`);
	return result.rowCount;
}

function decimal(value: unknown, label: string, allowZero = false): bigint {
	const pattern = allowZero ? /^(?:0|[1-9][0-9]*)$/u : /^[1-9][0-9]*$/u;
	if (typeof value !== "string" || !pattern.test(value))
		throw new TypeError(`${label} is invalid`);
	return BigInt(value);
}

export const readGenerationBinding: PostgresStatement<
	PostgresRealtimeGenerationStage,
	StagedBinding | undefined
> = definePostgresStatement({
	name: "live-query.realtime-generation-binding-read",
	text: `SELECT watch.deployment_digest, watch.authority_partition_digest,
       watch.query_identity, watch.input_digest, watch.wire_version,
       watch.invalidation_generation::text,
       watch.evaluated_invalidation_generation::text,
       (SELECT coalesce(max(generation.generation), 0)::text
        FROM questpie_internal.realtime_binding_generations generation
        WHERE generation.application_name = watch.application_name
          AND generation.scope_identity = watch.scope_identity
          AND generation.binding_identity = watch.binding_identity)
FROM questpie_internal.realtime_scope_attachments scope
JOIN questpie_internal.realtime_watch_bindings watch USING (application_name, scope_identity)
WHERE scope.application_name = $1 AND scope.scope_identity = $2
  AND scope.deployment_digest = $3 AND scope.principal_kind = $4
  AND scope.principal_id = $5 AND scope.holder_generation = $6
  AND scope.state = 'open' AND scope.expires_at > transaction_timestamp()
  AND watch.binding_identity = $7 AND watch.state = 'open'
FOR UPDATE OF watch`,
	parameterCount: 7,
	parameters: (input: PostgresRealtimeGenerationStage) => [
		input.applicationName,
		input.scopeIdentity,
		input.deploymentDigest,
		input.principal.kind,
		input.principal.id,
		input.holderGeneration,
		input.bindingIdentity,
	],
	decode(result): StagedBinding | undefined {
		if (
			result.command !== "SELECT" ||
			result.rowCount === null ||
			result.rowCount > 1 ||
			result.rows.length !== result.rowCount
		)
			throw new TypeError("realtime generation binding cardinality is invalid");
		const row = result.rows[0];
		if (!row) return;
		if (
			row.length !== 8 ||
			typeof row[0] !== "string" ||
			typeof row[1] !== "string" ||
			typeof row[2] !== "string" ||
			typeof row[3] !== "string" ||
			typeof row[4] !== "number" ||
			!Number.isSafeInteger(row[4]) ||
			row[4] <= 0
		)
			throw new TypeError("realtime generation binding row is invalid");
		return Object.freeze({
			deploymentDigest: row[0],
			authorityPartitionDigest: row[1],
			queryIdentity: row[2],
			inputDigest: row[3],
			wireVersion: row[4],
			invalidationGeneration: decimal(row[5], "invalidation generation"),
			evaluatedInvalidationGeneration: decimal(
				row[6],
				"evaluated invalidation generation",
				true,
			),
			latestGeneration: decimal(row[7], "latest generation", true),
		});
	},
});

export type BindingGeneration = Readonly<{
	applicationName: string;
	scopeIdentity: string;
	bindingIdentity: string;
	generation: bigint;
}>;

export const clearLatestGeneration: PostgresStatement<
	BindingGeneration,
	number
> = definePostgresStatement({
	name: "live-query.realtime-generation-latest-clear",
	text: `UPDATE questpie_internal.realtime_binding_generations SET latest_slot = NULL
WHERE application_name = $1 AND scope_identity = $2 AND binding_identity = $3 AND latest_slot = 1`,
	parameterCount: 3,
	parameters: (input: BindingGeneration) => [
		input.applicationName,
		input.scopeIdentity,
		input.bindingIdentity,
	],
	decode: (result) => mutation(result, "UPDATE"),
});

export type GenerationInsert = Readonly<{
	staged: PostgresRealtimeGenerationStage;
	binding: StagedBinding;
	tokenDigest: string;
	planDigest: string;
}>;

export const insertGeneration: PostgresStatement<GenerationInsert, number> =
	definePostgresStatement({
		name: "live-query.realtime-generation-insert",
		text: `INSERT INTO questpie_internal.realtime_binding_generations
  (application_name, scope_identity, binding_identity, deployment_digest,
   authority_partition_digest, query_identity, input_digest, wire_version,
   generation, token_digest, result_bytes, dependency_plan_bytes,
   delivery_kind, reset_reason, latest_slot, ack_slot)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,1,NULL)`,
		parameterCount: 14,
		parameters: ({ staged, binding, tokenDigest }: GenerationInsert) => [
			staged.applicationName,
			staged.scopeIdentity,
			staged.bindingIdentity,
			binding.deploymentDigest,
			binding.authorityPartitionDigest,
			binding.queryIdentity,
			binding.inputDigest,
			binding.wireVersion,
			staged.generation,
			tokenDigest,
			staged.resultBytes,
			staged.dependencyPlanBytes,
			staged.delivery,
			staged.resetReason,
		],
		decode: (result) => mutation(result, "INSERT", 1),
	});

export const upsertObservedPlan: PostgresStatement<GenerationInsert, number> =
	definePostgresStatement({
		name: "live-query.realtime-observed-plan-upsert",
		text: `INSERT INTO questpie_internal.observed_dependency_plans
  (application_name, scope_identity, binding_identity, deployment_digest,
   authority_partition_digest, query_identity, input_digest, wire_version,
   retained_generation, plan_digest, plan_bytes)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
ON CONFLICT (application_name, scope_identity, binding_identity) DO UPDATE
SET retained_generation = excluded.retained_generation,
    plan_digest = excluded.plan_digest, plan_bytes = excluded.plan_bytes`,
		parameterCount: 11,
		parameters: ({ staged, binding, planDigest }: GenerationInsert) => [
			staged.applicationName,
			staged.scopeIdentity,
			staged.bindingIdentity,
			binding.deploymentDigest,
			binding.authorityPartitionDigest,
			binding.queryIdentity,
			binding.inputDigest,
			binding.wireVersion,
			staged.generation,
			planDigest,
			staged.dependencyPlanBytes,
		],
		decode: (result) => mutation(result, "INSERT", 1),
	});

export const markGenerationEvaluated: PostgresStatement<
	PostgresRealtimeGenerationStage,
	number
> = definePostgresStatement({
	name: "live-query.realtime-generation-evaluated-update",
	text: `UPDATE questpie_internal.realtime_watch_bindings
SET evaluated_invalidation_generation = $4
WHERE application_name = $1 AND scope_identity = $2 AND binding_identity = $3`,
	parameterCount: 4,
	parameters: (input: PostgresRealtimeGenerationStage) => [
		input.applicationName,
		input.scopeIdentity,
		input.bindingIdentity,
		input.observedInvalidationGeneration,
	],
	decode: (result) => mutation(result, "UPDATE", 1),
});

export const pruneUnreferencedGenerations: PostgresStatement<
	BindingGeneration,
	number
> = definePostgresStatement({
	name: "live-query.realtime-generations-unreferenced-delete",
	text: `DELETE FROM questpie_internal.realtime_binding_generations
WHERE application_name = $1 AND scope_identity = $2 AND binding_identity = $3
  AND latest_slot IS NULL AND ack_slot IS NULL`,
	parameterCount: 3,
	parameters: (input: BindingGeneration) => [
		input.applicationName,
		input.scopeIdentity,
		input.bindingIdentity,
	],
	decode: (result) => mutation(result, "DELETE"),
});

export type Acknowledgement = PostgresRealtimeAcknowledgement &
	Readonly<{ tokenDigest: string }>;
export const readAcknowledgementCandidate: PostgresStatement<
	Acknowledgement,
	boolean
> = definePostgresStatement({
	name: "live-query.realtime-acknowledgement-candidate-read",
	text: `SELECT generation.generation::text
FROM questpie_internal.realtime_scope_attachments scope
JOIN questpie_internal.realtime_watch_bindings watch USING (application_name, scope_identity)
JOIN questpie_internal.realtime_binding_generations generation USING (application_name, scope_identity, binding_identity)
WHERE scope.application_name = $1 AND scope.scope_identity = $2
  AND scope.deployment_digest = $3 AND scope.principal_kind = $4 AND scope.principal_id = $5
  AND scope.state = 'open' AND scope.expires_at > transaction_timestamp()
  AND watch.binding_identity = $6 AND watch.state = 'open'
  AND generation.generation = $7 AND generation.token_digest = $8
FOR UPDATE OF generation`,
	parameterCount: 8,
	parameters: (input: Acknowledgement) => [
		input.applicationName,
		input.scopeIdentity,
		input.deploymentDigest,
		input.principal.kind,
		input.principal.id,
		input.bindingIdentity,
		input.generation,
		input.tokenDigest,
	],
	decode(result) {
		if (
			result.command !== "SELECT" ||
			result.rowCount === null ||
			result.rowCount > 1 ||
			result.rows.length !== result.rowCount
		)
			throw new TypeError(
				"realtime acknowledgement candidate cardinality is invalid",
			);
		const row = result.rows[0];
		if (!row) return false;
		if (row.length !== 1 || decimal(row[0], "acknowledged generation") <= 0n)
			throw new TypeError("realtime acknowledgement candidate row is invalid");
		return true;
	},
});

export const clearPriorAcknowledgement: PostgresStatement<
	BindingGeneration,
	number
> = definePostgresStatement({
	name: "live-query.realtime-acknowledgement-prior-clear",
	text: `UPDATE questpie_internal.realtime_binding_generations SET ack_slot = NULL
WHERE application_name = $1 AND scope_identity = $2 AND binding_identity = $3 AND ack_slot = 1 AND generation <> $4`,
	parameterCount: 4,
	parameters: (input: BindingGeneration) => [
		input.applicationName,
		input.scopeIdentity,
		input.bindingIdentity,
		input.generation,
	],
	decode: (result) => mutation(result, "UPDATE"),
});

export const setAcknowledgement: PostgresStatement<BindingGeneration, number> =
	definePostgresStatement({
		name: "live-query.realtime-acknowledgement-set",
		text: `UPDATE questpie_internal.realtime_binding_generations SET ack_slot = 1
WHERE application_name = $1 AND scope_identity = $2 AND binding_identity = $3 AND generation = $4`,
		parameterCount: 4,
		parameters: (input: BindingGeneration) => [
			input.applicationName,
			input.scopeIdentity,
			input.bindingIdentity,
			input.generation,
		],
		decode: (result) => mutation(result, "UPDATE", 1),
	});
