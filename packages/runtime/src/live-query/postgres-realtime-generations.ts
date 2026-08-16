import type { SQL } from "bun";

import { sha256Digest } from "../canonical-json";
import {
	scopeLockIdentity,
	type PostgresRealtimeAcknowledgement,
	type PostgresRealtimeGenerationStage,
	type PostgresRealtimeScopeAuthority,
	validBoundedIdentity,
	validateCompleteGeneration,
	validateGeneration,
	validateResumeToken,
	validateScope,
	validateScopeLease,
} from "./postgres-realtime-scope-contract";

export type PostgresRealtimeGenerationStore = Readonly<{
	invalidateWatch(
		input: PostgresRealtimeScopeAuthority &
			Readonly<{ bindingIdentity: string }>,
	): Promise<bigint | false>;
	stageGeneration(input: PostgresRealtimeGenerationStage): Promise<boolean>;
	acknowledgeWatch(input: PostgresRealtimeAcknowledgement): Promise<boolean>;
}>;

export function createPostgresRealtimeGenerationStore(
	sql: SQL,
): PostgresRealtimeGenerationStore {
	return Object.freeze({
		async invalidateWatch(invalidation) {
			validateScope(invalidation);
			validBoundedIdentity(invalidation.bindingIdentity, "binding identity");
			const [invalidated] = await sql<{ generation: bigint }[]>`
				update questpie_internal.realtime_watch_bindings watch
				set invalidation_generation = watch.invalidation_generation + 1
				from questpie_internal.realtime_scope_attachments scope
				where scope.application_name = ${invalidation.applicationName}
				  and scope.scope_identity = ${invalidation.scopeIdentity}
				  and scope.deployment_digest = ${invalidation.deploymentDigest}
				  and scope.principal_kind = ${invalidation.principal.kind}
				  and scope.principal_id = ${invalidation.principal.id}
				  and scope.state = 'open'
				  and scope.expires_at > transaction_timestamp()
				  and watch.application_name = scope.application_name
				  and watch.scope_identity = scope.scope_identity
				  and watch.binding_identity = ${invalidation.bindingIdentity}
				  and watch.state = 'open'
				returning watch.invalidation_generation as generation
			`;
			return invalidated ? BigInt(invalidated.generation) : false;
		},

		async stageGeneration(staged) {
			validateScopeLease(staged);
			validBoundedIdentity(staged.bindingIdentity, "binding identity");
			validateCompleteGeneration(staged);
			return sql.begin(async (transaction) => {
				await transaction`
					select pg_catalog.pg_advisory_xact_lock(
					  pg_catalog.hashtextextended(${scopeLockIdentity(staged)}, 0)
					)
				`;
				const [binding] = await transaction<
					{
						deploymentDigest: string;
						authorityPartitionDigest: string;
						queryIdentity: string;
						inputDigest: string;
						wireVersion: number;
						invalidationGeneration: bigint;
						evaluatedInvalidationGeneration: bigint;
						latestGeneration: bigint;
					}[]
				>`
					select watch.deployment_digest as "deploymentDigest",
					       watch.authority_partition_digest as "authorityPartitionDigest",
					       watch.query_identity as "queryIdentity",
					       watch.input_digest as "inputDigest", watch.wire_version as "wireVersion",
					       watch.invalidation_generation as "invalidationGeneration",
					       watch.evaluated_invalidation_generation as "evaluatedInvalidationGeneration",
					       (select coalesce(max(generation.generation), 0)::bigint
					        from questpie_internal.realtime_binding_generations generation
					        where generation.application_name = watch.application_name
					          and generation.scope_identity = watch.scope_identity
					          and generation.binding_identity = watch.binding_identity) as "latestGeneration"
					from questpie_internal.realtime_scope_attachments scope
					join questpie_internal.realtime_watch_bindings watch
					  on watch.application_name = scope.application_name
					 and watch.scope_identity = scope.scope_identity
					where scope.application_name = ${staged.applicationName}
					  and scope.scope_identity = ${staged.scopeIdentity}
					  and scope.deployment_digest = ${staged.deploymentDigest}
					  and scope.principal_kind = ${staged.principal.kind}
					  and scope.principal_id = ${staged.principal.id}
					  and scope.holder_generation = ${staged.holderGeneration}
					  and scope.state = 'open'
					  and scope.expires_at > transaction_timestamp()
					  and watch.binding_identity = ${staged.bindingIdentity}
					  and watch.state = 'open'
					for update of watch
				`;
				if (
					!binding ||
					staged.observedInvalidationGeneration <=
						BigInt(binding.evaluatedInvalidationGeneration) ||
					staged.observedInvalidationGeneration >
						BigInt(binding.invalidationGeneration) ||
					(BigInt(binding.latestGeneration) !== 0n &&
						staged.generation !== BigInt(binding.latestGeneration) + 1n)
				)
					return false;

				await transaction`
					update questpie_internal.realtime_binding_generations
					set latest_slot = null
					where application_name = ${staged.applicationName}
					  and scope_identity = ${staged.scopeIdentity}
					  and binding_identity = ${staged.bindingIdentity}
					  and latest_slot = 1
				`;
				await transaction`
					insert into questpie_internal.realtime_binding_generations
					(application_name, scope_identity, binding_identity, deployment_digest,
					 authority_partition_digest, query_identity, input_digest, wire_version,
					 generation, token_digest, result_bytes, dependency_plan_bytes,
					 delivery_kind, reset_reason, latest_slot, ack_slot)
					values (${staged.applicationName}, ${staged.scopeIdentity},
					 ${staged.bindingIdentity}, ${binding.deploymentDigest},
					 ${binding.authorityPartitionDigest}, ${binding.queryIdentity},
					 ${binding.inputDigest}, ${binding.wireVersion}, ${staged.generation},
					 ${sha256Digest(staged.resumeToken)}, ${staged.resultBytes},
					 ${staged.dependencyPlanBytes}, ${staged.delivery}, ${staged.resetReason},
					 1, null)
				`;
				await transaction`
					insert into questpie_internal.observed_dependency_plans
					(application_name, scope_identity, binding_identity, deployment_digest,
					 authority_partition_digest, query_identity, input_digest, wire_version,
					 retained_generation, plan_digest, plan_bytes)
					values (${staged.applicationName}, ${staged.scopeIdentity},
					 ${staged.bindingIdentity}, ${binding.deploymentDigest},
					 ${binding.authorityPartitionDigest}, ${binding.queryIdentity},
					 ${binding.inputDigest}, ${binding.wireVersion}, ${staged.generation},
					 ${sha256Digest(staged.dependencyPlanBytes)},
					 ${staged.dependencyPlanBytes})
					on conflict (application_name, scope_identity, binding_identity) do update
					set retained_generation = excluded.retained_generation,
					    plan_digest = excluded.plan_digest, plan_bytes = excluded.plan_bytes
				`;
				await transaction`
					update questpie_internal.realtime_watch_bindings
					set evaluated_invalidation_generation = ${staged.observedInvalidationGeneration}
					where application_name = ${staged.applicationName}
					  and scope_identity = ${staged.scopeIdentity}
					  and binding_identity = ${staged.bindingIdentity}
				`;
				await transaction`
					delete from questpie_internal.realtime_binding_generations
					where application_name = ${staged.applicationName}
					  and scope_identity = ${staged.scopeIdentity}
					  and binding_identity = ${staged.bindingIdentity}
					  and latest_slot is null and ack_slot is null
				`;
				return true;
			});
		},

		async acknowledgeWatch(acknowledgement) {
			validateScope(acknowledgement);
			validBoundedIdentity(acknowledgement.bindingIdentity, "binding identity");
			validateGeneration(acknowledgement.generation);
			const tokenDigest = sha256Digest(
				validateResumeToken(acknowledgement.resumeToken),
			);
			return sql.begin(async (transaction) => {
				await transaction`
					select pg_catalog.pg_advisory_xact_lock(
					  pg_catalog.hashtextextended(${scopeLockIdentity(acknowledgement)}, 0)
					)
				`;
				const [candidate] = await transaction<{ generation: bigint }[]>`
					select generation.generation
					from questpie_internal.realtime_scope_attachments scope
					join questpie_internal.realtime_watch_bindings watch
					  on watch.application_name = scope.application_name
					 and watch.scope_identity = scope.scope_identity
					join questpie_internal.realtime_binding_generations generation
					  on generation.application_name = watch.application_name
					 and generation.scope_identity = watch.scope_identity
					 and generation.binding_identity = watch.binding_identity
					where scope.application_name = ${acknowledgement.applicationName}
					  and scope.scope_identity = ${acknowledgement.scopeIdentity}
					  and scope.deployment_digest = ${acknowledgement.deploymentDigest}
					  and scope.principal_kind = ${acknowledgement.principal.kind}
					  and scope.principal_id = ${acknowledgement.principal.id}
					  and scope.state = 'open'
					  and scope.expires_at > transaction_timestamp()
					  and watch.binding_identity = ${acknowledgement.bindingIdentity}
					  and watch.state = 'open'
					  and generation.generation = ${acknowledgement.generation}
					  and generation.token_digest = ${tokenDigest}
					for update of generation
				`;
				if (!candidate) return false;
				await transaction`
					update questpie_internal.realtime_binding_generations
					set ack_slot = null
					where application_name = ${acknowledgement.applicationName}
					  and scope_identity = ${acknowledgement.scopeIdentity}
					  and binding_identity = ${acknowledgement.bindingIdentity}
					  and ack_slot = 1
					  and generation <> ${acknowledgement.generation}
				`;
				await transaction`
					update questpie_internal.realtime_binding_generations
					set ack_slot = 1
					where application_name = ${acknowledgement.applicationName}
					  and scope_identity = ${acknowledgement.scopeIdentity}
					  and binding_identity = ${acknowledgement.bindingIdentity}
					  and generation = ${acknowledgement.generation}
				`;
				await transaction`
					delete from questpie_internal.realtime_binding_generations
					where application_name = ${acknowledgement.applicationName}
					  and scope_identity = ${acknowledgement.scopeIdentity}
					  and binding_identity = ${acknowledgement.bindingIdentity}
					  and latest_slot is null and ack_slot is null
				`;
				return true;
			});
		},
	});
}
