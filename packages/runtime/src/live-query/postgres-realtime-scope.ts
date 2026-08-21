import type { SQL } from "bun";

import type { PostgresTransactionRunner } from "../postgres";
import { createPostgresRealtimeGenerationStore } from "./postgres-realtime-generations";
import { createPostgresRealtimeGenerationDatabaseStore } from "./postgres-realtime-generations-database";
import {
	scopeLockIdentity,
	type PostgresRealtimeGeneration,
	validBoundedIdentity,
	validDigest,
	validateApplicationIdentity,
	validateOpen,
	validateScope,
	validateScopeLease,
} from "./postgres-realtime-scope-contract";
import { createPostgresRealtimeScopeDatabaseStore } from "./postgres-realtime-scope-database";
import type { PostgresRealtimeScopeStore } from "./postgres-realtime-scope-store";

export type {
	PostgresRealtimeScopeLease,
	PostgresRealtimeWatch,
} from "./postgres-realtime-scope-contract";
export type { PostgresRealtimeScopeStore } from "./postgres-realtime-scope-store";
const unavailable = Object.freeze({ status: "unavailable" as const });
const limit = Object.freeze({ status: "limit" as const });

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	return Buffer.from(left).equals(Buffer.from(right));
}

export function createPostgresRealtimeScopeStore(
	input:
		| Readonly<{ database: PostgresTransactionRunner; sql?: never }>
		| Readonly<{ database?: never; sql: SQL }>,
): PostgresRealtimeScopeStore {
	if (input.database) {
		const generations = createPostgresRealtimeGenerationDatabaseStore(
			input.database,
		);
		return createPostgresRealtimeScopeDatabaseStore({
			database: input.database,
			generations,
		});
	}
	const generations = createPostgresRealtimeGenerationStore(input.sql);
	return Object.freeze({
		async attachScope(scope) {
			validateScope(scope);
			return input.sql.begin(async (transaction) => {
				await transaction`
					delete from questpie_internal.realtime_scope_attachments
					where application_name = ${scope.applicationName}
					  and scope_identity = ${scope.scopeIdentity}
					  and expires_at <= transaction_timestamp()
				`;
				const attached = await transaction<{ holderGeneration: bigint }[]>`
					insert into questpie_internal.realtime_scope_attachments
					(application_name, scope_identity, deployment_digest,
					 authority_partition_digest, principal_kind, principal_id,
					 state)
					values (${scope.applicationName}, ${scope.scopeIdentity},
					 ${scope.deploymentDigest}, null, ${scope.principal.kind},
					 ${scope.principal.id}, 'attached')
					on conflict (application_name, scope_identity) do update
					set authority_partition_digest = case
					      when realtime_scope_attachments.state = 'withdrawn' then null
					      else realtime_scope_attachments.authority_partition_digest
					    end,
					    renewed_at = transaction_timestamp(),
					    state = case
					      when realtime_scope_attachments.state = 'withdrawn' then 'attached'
					      else realtime_scope_attachments.state
					    end,
					    holder_generation = realtime_scope_attachments.holder_generation + 1
					where realtime_scope_attachments.deployment_digest = excluded.deployment_digest
					  and realtime_scope_attachments.principal_kind = excluded.principal_kind
					  and realtime_scope_attachments.principal_id = excluded.principal_id
					  and realtime_scope_attachments.holder_generation < 9223372036854775807
					  and (
					    realtime_scope_attachments.state = 'withdrawn'
					    or realtime_scope_attachments.expires_at > transaction_timestamp()
					  )
					returning holder_generation as "holderGeneration"
				`;
				return attached.length === 1
					? Object.freeze({
							status: "attached" as const,
							holderGeneration: BigInt(attached[0]!.holderGeneration),
						})
					: unavailable;
			});
		},

		async renewScope(scope) {
			validateScopeLease(scope);
			const renewed = await input.sql<{ scopeIdentity: string }[]>`
				update questpie_internal.realtime_scope_attachments
				set renewed_at = transaction_timestamp()
				where application_name = ${scope.applicationName}
				  and scope_identity = ${scope.scopeIdentity}
				  and deployment_digest = ${scope.deploymentDigest}
				  and principal_kind = ${scope.principal.kind}
				  and principal_id = ${scope.principal.id}
				  and holder_generation = ${scope.holderGeneration}
				  and state <> 'withdrawn'
				  and expires_at > transaction_timestamp()
				returning scope_identity as "scopeIdentity"
			`;
			return renewed.length === 1;
		},

		async openWatch(open) {
			validateOpen(open);
			return input.sql.begin(async (transaction) => {
				await transaction`
					select pg_catalog.pg_advisory_xact_lock(
					  pg_catalog.hashtextextended(${scopeLockIdentity(open)}, 0)
					)
				`;
				await transaction`
					delete from questpie_internal.realtime_scope_attachments
					where application_name = ${open.applicationName}
					  and deployment_digest = ${open.deploymentDigest}
					  and principal_kind = ${open.principal.kind}
					  and principal_id = ${open.principal.id}
					  and expires_at <= transaction_timestamp()
				`;
				const [scope] = await transaction<
					{ authorityPartitionDigest: string | null; state: string }[]
				>`
					select authority_partition_digest as "authorityPartitionDigest", state
					from questpie_internal.realtime_scope_attachments
					where application_name = ${open.applicationName}
					  and scope_identity = ${open.scopeIdentity}
					  and deployment_digest = ${open.deploymentDigest}
					  and principal_kind = ${open.principal.kind}
					  and principal_id = ${open.principal.id}
					  and state in ('attached', 'open')
					  and expires_at > transaction_timestamp()
					for update
				`;
				if (
					!scope ||
					(scope.authorityPartitionDigest !== null &&
						scope.authorityPartitionDigest !== open.authorityPartitionDigest)
				)
					return unavailable;

				const [existing] = await transaction<
					{
						activeSlot: number | null;
						authorityPartitionDigest: string;
						queryIdentity: string;
						queryBytes: Uint8Array;
						inputBytes: Uint8Array;
						contextInputBytes: Uint8Array;
						inputDigest: string;
						wireVersion: number;
						resumeRequested: boolean;
						requestedResumeToken: string | null;
						state: string;
					}[]
				>`
					select active_slot as "activeSlot",
					       authority_partition_digest as "authorityPartitionDigest",
					       query_identity as "queryIdentity", query_bytes as "queryBytes",
					       input_bytes as "inputBytes", context_input_bytes as "contextInputBytes",
					       input_digest as "inputDigest", wire_version as "wireVersion",
					       resume_requested as "resumeRequested",
					       requested_resume_token as "requestedResumeToken", state
					from questpie_internal.realtime_watch_bindings
					where application_name = ${open.applicationName}
					  and scope_identity = ${open.scopeIdentity}
					  and binding_identity = ${open.bindingIdentity}
				`;
				if (existing) {
					if (
						existing.state === "open" &&
						existing.activeSlot !== null &&
						existing.authorityPartitionDigest ===
							open.authorityPartitionDigest &&
						existing.queryIdentity === open.queryIdentity &&
						sameBytes(existing.queryBytes, open.queryBytes) &&
						sameBytes(existing.inputBytes, open.inputBytes) &&
						sameBytes(existing.contextInputBytes, open.contextInputBytes) &&
						existing.inputDigest === open.inputDigest &&
						existing.wireVersion === open.wireVersion
					)
						// A reconnect re-opens the same durable binding carrying the
						// resume token it last accepted, so its requested resume state
						// legitimately differs from the recorded one. That recorded state
						// is immutable binding authority and governs only the first
						// materialization, which already happened, so converge on the
						// existing binding and leave it untouched rather than refusing and
						// failing the client transport.
						return Object.freeze({
							status: "opened" as const,
							activeSlot: existing.activeSlot,
						});
					return unavailable;
				}

				const [slot] = await transaction<{ activeSlot: number }[]>`
					select candidate.slot::integer as "activeSlot"
					from pg_catalog.generate_series(1, 64) as candidate(slot)
					where not exists (
					  select 1 from questpie_internal.realtime_watch_bindings watch
					  where watch.application_name = ${open.applicationName}
					    and watch.deployment_digest = ${open.deploymentDigest}
					    and watch.principal_kind = ${open.principal.kind}
					    and watch.principal_id = ${open.principal.id}
					    and watch.active_slot = candidate.slot
					)
					order by candidate.slot
					limit 1
				`;
				if (!slot) return limit;

				await transaction`
					update questpie_internal.realtime_scope_attachments
					set authority_partition_digest = ${open.authorityPartitionDigest}, state = 'open'
					where application_name = ${open.applicationName}
					  and scope_identity = ${open.scopeIdentity}
				`;
				await transaction`
					insert into questpie_internal.realtime_watch_bindings
					(application_name, scope_identity, binding_identity, deployment_digest,
					 authority_partition_digest, principal_kind, principal_id, active_slot,
					 query_identity, query_bytes, input_bytes, context_input_bytes,
					 input_digest, wire_version, resume_requested,
					 requested_resume_token, state)
					values (${open.applicationName}, ${open.scopeIdentity},
					 ${open.bindingIdentity}, ${open.deploymentDigest},
					 ${open.authorityPartitionDigest}, ${open.principal.kind},
					 ${open.principal.id}, ${slot.activeSlot}, ${open.queryIdentity},
					 ${open.queryBytes}, ${open.inputBytes}, ${open.contextInputBytes},
					 ${open.inputDigest}, ${open.wireVersion}, ${open.resumeRequested},
					 ${open.requestedResumeToken}, 'open')
				`;
				return Object.freeze({
					status: "opened" as const,
					activeSlot: slot.activeSlot,
				});
			});
		},

		async scanOpenWatches(scope) {
			validateScopeLease(scope);
			const rows = await input.sql<
				{
					bindingIdentity: string;
					authorityPartitionDigest: string;
					queryIdentity: string;
					queryBytes: Uint8Array;
					inputBytes: Uint8Array;
					inputDigest: string;
					contextInputBytes: Uint8Array;
					wireVersion: number;
					resumeRequested: boolean;
					requestedResumeToken: string | null;
					activeSlot: number;
					invalidationGeneration: bigint;
					evaluatedInvalidationGeneration: bigint;
					generation: bigint | null;
					tokenDigest: string | null;
					resultBytes: Uint8Array | null;
					dependencyPlanBytes: Uint8Array | null;
					delivery: PostgresRealtimeGeneration["delivery"] | null;
					resetReason: PostgresRealtimeGeneration["resetReason"];
					acknowledged: boolean | null;
				}[]
			>`
				select watch.binding_identity as "bindingIdentity",
				       watch.authority_partition_digest as "authorityPartitionDigest",
				       watch.query_identity as "queryIdentity", watch.query_bytes as "queryBytes",
				       watch.input_bytes as "inputBytes",
				       watch.input_digest as "inputDigest",
				       watch.context_input_bytes as "contextInputBytes",
				       watch.wire_version as "wireVersion",
				       watch.resume_requested as "resumeRequested",
				       watch.requested_resume_token as "requestedResumeToken",
				       watch.active_slot::integer as "activeSlot",
				       watch.invalidation_generation as "invalidationGeneration",
				       watch.evaluated_invalidation_generation as "evaluatedInvalidationGeneration",
				       generation.generation, generation.token_digest as "tokenDigest",
				       generation.result_bytes as "resultBytes",
				       generation.dependency_plan_bytes as "dependencyPlanBytes",
				       generation.delivery_kind as delivery,
				       generation.reset_reason as "resetReason",
				       (generation.ack_slot = 1) as acknowledged
				from questpie_internal.realtime_scope_attachments scope
				join questpie_internal.realtime_watch_bindings watch
				  on watch.application_name = scope.application_name
				 and watch.scope_identity = scope.scope_identity
				left join questpie_internal.realtime_binding_generations generation
				  on generation.application_name = watch.application_name
				 and generation.scope_identity = watch.scope_identity
				 and generation.binding_identity = watch.binding_identity
				 and generation.latest_slot = 1
				where scope.application_name = ${scope.applicationName}
				  and scope.scope_identity = ${scope.scopeIdentity}
				  and scope.deployment_digest = ${scope.deploymentDigest}
				  and scope.principal_kind = ${scope.principal.kind}
				  and scope.principal_id = ${scope.principal.id}
				  and scope.holder_generation = ${scope.holderGeneration}
				  and scope.state = 'open'
				  and scope.expires_at > transaction_timestamp()
				  and watch.state = 'open'
				order by watch.binding_identity
			`;
			return Object.freeze(
				rows.map((row) =>
					Object.freeze({
						bindingIdentity: row.bindingIdentity,
						authorityPartitionDigest: row.authorityPartitionDigest,
						queryIdentity: row.queryIdentity,
						queryBytes: new Uint8Array(row.queryBytes),
						inputBytes: new Uint8Array(row.inputBytes),
						inputDigest: row.inputDigest,
						contextInputBytes: new Uint8Array(row.contextInputBytes),
						wireVersion: row.wireVersion,
						resumeRequested: row.resumeRequested,
						requestedResumeToken: row.requestedResumeToken,
						activeSlot: row.activeSlot,
						invalidationGeneration: BigInt(row.invalidationGeneration),
						evaluatedInvalidationGeneration: BigInt(
							row.evaluatedInvalidationGeneration,
						),
						latest:
							row.generation === null ||
							row.tokenDigest === null ||
							row.resultBytes === null ||
							row.dependencyPlanBytes === null ||
							row.delivery === null
								? null
								: Object.freeze({
										generation: BigInt(row.generation),
										tokenDigest: row.tokenDigest,
										resultBytes: new Uint8Array(row.resultBytes),
										dependencyPlanBytes: new Uint8Array(
											row.dependencyPlanBytes,
										),
										delivery: row.delivery,
										resetReason: row.resetReason,
										acknowledged: row.acknowledged === true,
									}),
					}),
				),
			);
		},

		async readOpenWatch(scope) {
			validateScope(scope);
			validBoundedIdentity(scope.bindingIdentity, "binding identity");
			const [row] = await input.sql<
				{
					bindingIdentity: string;
					authorityPartitionDigest: string;
					queryIdentity: string;
					queryBytes: Uint8Array;
					inputBytes: Uint8Array;
					inputDigest: string;
					contextInputBytes: Uint8Array;
					wireVersion: number;
					resumeRequested: boolean;
					requestedResumeToken: string | null;
					activeSlot: number;
					invalidationGeneration: bigint;
					evaluatedInvalidationGeneration: bigint;
					generation: bigint | null;
					tokenDigest: string | null;
					resultBytes: Uint8Array | null;
					dependencyPlanBytes: Uint8Array | null;
					delivery: PostgresRealtimeGeneration["delivery"] | null;
					resetReason: PostgresRealtimeGeneration["resetReason"];
					acknowledged: boolean | null;
				}[]
			>`
				select watch.binding_identity as "bindingIdentity",
				       watch.authority_partition_digest as "authorityPartitionDigest",
				       watch.query_identity as "queryIdentity", watch.query_bytes as "queryBytes",
				       watch.input_bytes as "inputBytes", watch.input_digest as "inputDigest",
				       watch.context_input_bytes as "contextInputBytes",
				       watch.wire_version as "wireVersion",
				       watch.resume_requested as "resumeRequested",
				       watch.requested_resume_token as "requestedResumeToken",
				       watch.active_slot::integer as "activeSlot",
				       watch.invalidation_generation as "invalidationGeneration",
				       watch.evaluated_invalidation_generation as "evaluatedInvalidationGeneration",
				       generation.generation, generation.token_digest as "tokenDigest",
				       generation.result_bytes as "resultBytes",
				       generation.dependency_plan_bytes as "dependencyPlanBytes",
				       generation.delivery_kind as delivery,
				       generation.reset_reason as "resetReason",
				       (generation.ack_slot = 1) as acknowledged
				from questpie_internal.realtime_scope_attachments scope
				join questpie_internal.realtime_watch_bindings watch
				  on watch.application_name = scope.application_name
				 and watch.scope_identity = scope.scope_identity
				left join questpie_internal.realtime_binding_generations generation
				  on generation.application_name = watch.application_name
				 and generation.scope_identity = watch.scope_identity
				 and generation.binding_identity = watch.binding_identity
				 and generation.latest_slot = 1
				where scope.application_name = ${scope.applicationName}
				  and scope.scope_identity = ${scope.scopeIdentity}
				  and scope.deployment_digest = ${scope.deploymentDigest}
				  and scope.principal_kind = ${scope.principal.kind}
				  and scope.principal_id = ${scope.principal.id}
				  and scope.state = 'open'
				  and scope.expires_at > transaction_timestamp()
				  and watch.binding_identity = ${scope.bindingIdentity}
				  and watch.state = 'open'
			`;
			if (!row) return undefined;
			return Object.freeze({
				bindingIdentity: row.bindingIdentity,
				authorityPartitionDigest: row.authorityPartitionDigest,
				queryIdentity: row.queryIdentity,
				queryBytes: new Uint8Array(row.queryBytes),
				inputBytes: new Uint8Array(row.inputBytes),
				inputDigest: row.inputDigest,
				contextInputBytes: new Uint8Array(row.contextInputBytes),
				wireVersion: row.wireVersion,
				resumeRequested: row.resumeRequested,
				requestedResumeToken: row.requestedResumeToken,
				activeSlot: row.activeSlot,
				invalidationGeneration: BigInt(row.invalidationGeneration),
				evaluatedInvalidationGeneration: BigInt(
					row.evaluatedInvalidationGeneration,
				),
				latest:
					row.generation === null ||
					row.tokenDigest === null ||
					row.resultBytes === null ||
					row.dependencyPlanBytes === null ||
					row.delivery === null
						? null
						: Object.freeze({
								generation: BigInt(row.generation),
								tokenDigest: row.tokenDigest,
								resultBytes: new Uint8Array(row.resultBytes),
								dependencyPlanBytes: new Uint8Array(row.dependencyPlanBytes),
								delivery: row.delivery,
								resetReason: row.resetReason,
								acknowledged: row.acknowledged === true,
							}),
			});
		},

		async stageGeneration(staged) {
			return generations.stageGeneration(staged);
		},

		async acknowledgeWatch(acknowledgement) {
			return generations.acknowledgeWatch(acknowledgement);
		},

		async closeWatch(close) {
			validateScope(close);
			validBoundedIdentity(close.bindingIdentity, "binding identity");
			return input.sql.begin(async (transaction) => {
				await transaction`
					select pg_catalog.pg_advisory_xact_lock(
					  pg_catalog.hashtextextended(${scopeLockIdentity(close)}, 0)
					)
				`;
				const closed = await transaction<{ bindingIdentity: string }[]>`
					update questpie_internal.realtime_watch_bindings watch
					set state = 'withdrawn'
					from questpie_internal.realtime_scope_attachments scope
					where scope.application_name = ${close.applicationName}
					  and scope.scope_identity = ${close.scopeIdentity}
					  and scope.deployment_digest = ${close.deploymentDigest}
					  and scope.principal_kind = ${close.principal.kind}
					  and scope.principal_id = ${close.principal.id}
					  and scope.state = 'open'
					  and scope.expires_at > transaction_timestamp()
					  and watch.application_name = scope.application_name
					  and watch.scope_identity = scope.scope_identity
					  and watch.binding_identity = ${close.bindingIdentity}
					  and watch.state = 'open'
					returning watch.binding_identity as "bindingIdentity"
				`;
				return closed.length === 1;
			});
		},

		async withdrawScope(scope) {
			validateScopeLease(scope);
			return input.sql.begin(async (transaction) => {
				await transaction`
					select pg_catalog.pg_advisory_xact_lock(
					  pg_catalog.hashtextextended(${scopeLockIdentity(scope)}, 0)
					)
				`;
				const withdrawn = await transaction<{ scopeIdentity: string }[]>`
					update questpie_internal.realtime_scope_attachments
					set state = 'withdrawn'
					where application_name = ${scope.applicationName}
					  and scope_identity = ${scope.scopeIdentity}
					  and deployment_digest = ${scope.deploymentDigest}
					  and principal_kind = ${scope.principal.kind}
					  and principal_id = ${scope.principal.id}
					  and holder_generation = ${scope.holderGeneration}
					  and state <> 'withdrawn'
					  and expires_at > transaction_timestamp()
					returning scope_identity as "scopeIdentity"
				`;
				return withdrawn.length === 1;
			});
		},

		async expireScopes(expiry) {
			validateApplicationIdentity(expiry.applicationName);
			validDigest(expiry.deploymentDigest, "deployment digest");
			const [expired] = await input.sql<{ scopes: number; watches: number }[]>`
				with doomed as materialized (
				  select application_name, scope_identity
				  from questpie_internal.realtime_scope_attachments
				  where application_name = ${expiry.applicationName}
				    and deployment_digest = ${expiry.deploymentDigest}
				    and expires_at <= transaction_timestamp()
				  for update
				), watch_count as (
				  select count(*)::integer as watches
				  from questpie_internal.realtime_watch_bindings watch
				  join doomed using (application_name, scope_identity)
				), deleted as (
				  delete from questpie_internal.realtime_scope_attachments attachment
				  using doomed
				  where attachment.application_name = doomed.application_name
				    and attachment.scope_identity = doomed.scope_identity
				  returning 1
				)
				select count(*)::integer as scopes,
				       (select watches from watch_count) as watches
				from deleted
			`;
			return Object.freeze(expired ?? { scopes: 0, watches: 0 });
		},
	});
}
