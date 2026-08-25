import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { SQL } from "bun";

import { backendPid } from "../../../packages/compiler/src/postgres-session";
import {
	ensureInternalProtocolV6,
	internalProtocolV6Checksum,
} from "../../../packages/compiler/src/schema/postgres/internal-protocol-v6";
import {
	ensureInternalProtocolV7,
	internalProtocolV7Checksum,
	verifyInternalProtocolV7,
} from "../../../packages/compiler/src/schema/postgres/internal-protocol-v7";
import { linkJobProjection } from "../../../packages/runtime/src/durable/job-projection";
import { createPostgresDatabaseDurableEffectLedger } from "../../../packages/runtime/src/durable/postgres-database-effect-ledger";
import { createPostgresDatabaseDurableKernel } from "../../../packages/runtime/src/durable/postgres-database-kernel";
import { linkReactionProjection } from "../../../packages/runtime/src/durable/projection";
import { createDurableWorker } from "../../../packages/runtime/src/durable/worker";
import { createPostgresDatabase } from "../../../packages/runtime/src/postgres";

const database = process.env.PGHOST ? new SQL({ max: 2 }) : undefined;
const control = { lockTimeoutMs: 5_000, statementTimeoutMs: 30_000 } as const;
const application = "application:protocol-v7-preservation";
const dispatchId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6201";
const runId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6202";
const reactionIdentity = "reaction:messages.published";
const executableDigest = "c".repeat(64);

function postgresUrl(): string {
	const url = new URL("postgres://localhost/");
	url.hostname = process.env.PGHOST ?? "127.0.0.1";
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER ?? "postgres";
	url.pathname = `/${process.env.PGDATABASE ?? "postgres"}`;
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	return url.toString();
}

const reactions = linkReactionProjection({
	format: "questpie.reaction-projection",
	version: 2,
	reactions: [
		{
			identity: reactionIdentity,
			input: {
				kind: "object",
				properties: { messageId: { kind: "text" } },
			},
			output: {
				kind: "object",
				properties: { delivered: { kind: "boolean" } },
			},
			declaredErrors: {},
			runAs: { actor: "caller", whenDenied: "fail" },
			retry: {
				maximumAttempts: 3,
				initialDelayMilliseconds: 1_000,
				backoff: "exponential",
				maximumDelayMilliseconds: 60_000,
				jitter: "full",
				horizonMilliseconds: 86_400_000,
			},
			effects: [],
			contractDigest: executableDigest,
			origin: {
				path: "src/messages-published.ts",
				exportName: "messagesPublished",
				packageId: null,
			},
		},
	],
});

const jobs = linkJobProjection({
	format: "questpie.job-projection",
	version: 1,
	jobs: [],
});

beforeEach(async () => {
	await database?.unsafe("DROP SCHEMA IF EXISTS questpie_internal CASCADE");
});

afterAll(async () => {
	await database?.unsafe("DROP SCHEMA IF EXISTS questpie_internal CASCADE");
	await database?.close();
});

describe.skipIf(!database)("Job internal protocol v7", () => {
	test("explicit non-rolling cutover preserves and executes an existing v6 Reaction run", async () => {
		const session = await database!.reserve();
		let runtimeDatabase: ReturnType<typeof createPostgresDatabase> | undefined;
		try {
			const [current] = await session<{ databaseName: string }[]>`
				select current_database() as "databaseName"
			`;
			const pid = await backendPid(session);
			await ensureInternalProtocolV6(
				session,
				current!.databaseName,
				pid,
				control,
			);
			await session.begin(async (transaction) => {
				await transaction`select set_config('questpie.durable_kernel', 'on', true)`;
				await transaction.unsafe(
					`INSERT INTO questpie_internal.pending_reaction_intents
  (application_name, tenant_id, source_operation, principal_kind, principal_id,
   call_id, dispatch_slot, record_id, reaction_name, input_digest, payload_bytes,
   transaction_id, recorded_at, state)
VALUES
  ($1, 'tenant:legacy', 'mutation:messages.publish', 'user', 'user:legacy',
   'call:legacy', 'published', $2::uuid, $3, $4, convert_to('{"messageId":"message:legacy"}', 'UTF8'),
   pg_current_xact_id(), transaction_timestamp(), 'accepted')`,
					[application, dispatchId, reactionIdentity, "d".repeat(64)],
				);
				await transaction.unsafe(
					`INSERT INTO questpie_internal.durable_runs
  (application_name, run_id, dispatch_id, resource_identity, tenant_id,
   principal_kind, principal_id, run_as, context_input_bytes, payload_bytes,
   retry_bytes, runtime_build_digest, executable_digest, causation_kind,
   causation_id, correlation_id, state, attempt_count, current_attempt_id,
   lease_token_digest, lease_expires_at, available_at, horizon_at,
   cancellation_requested, event_sequence, result_bytes, failure_code,
   dead_letter, accepted_at, terminal_at)
VALUES
  ($1, $2::uuid, $3::uuid, $4, 'tenant:legacy', 'user', 'user:legacy', 'caller',
   convert_to('{"tenant":"legacy"}', 'UTF8'),
   convert_to('{"messageId":"message:legacy"}', 'UTF8'),
   convert_to('{"backoff":"exponential","horizonMilliseconds":86400000,"initialDelayMilliseconds":1000,"jitter":"full","maximumAttempts":3,"maximumDelayMilliseconds":60000}', 'UTF8'),
   $5, $6, 'mutationDispatch', 'cause:legacy', 'correlation:legacy', 'ready', 0,
   NULL, NULL, NULL, transaction_timestamp(), transaction_timestamp() + interval '1 day',
   false, 1, NULL, NULL, false, transaction_timestamp(), NULL)`,
					[
						application,
						runId,
						dispatchId,
						reactionIdentity,
						"a".repeat(64),
						executableDigest,
					],
				);
				await transaction.unsafe(
					`INSERT INTO questpie_internal.durable_run_events
  (application_name, run_id, sequence, occurred_at, resource_identity,
   dispatch_id, attempt_id, lease_token_digest, causation_id, correlation_id,
   kind, error_code)
VALUES
  ($1, $2::uuid, 1, transaction_timestamp(), $3, $4::uuid, NULL, NULL,
   'cause:legacy', 'correlation:legacy', 'accepted', NULL)`,
					[application, runId, reactionIdentity, dispatchId],
				);
			});

			await expect(
				ensureInternalProtocolV7(session, current!.databaseName, pid, control),
			).rejects.toMatchObject({
				code: "QP-SCHEMA-020",
				diagnosticClass: "destructiveAcknowledgementRequired",
			});
			const [unchanged] = await session<
				Readonly<Array<{ version: number; checksum: string; legacy: boolean }>>
			>`
				select version,
				       checksum,
				       to_regclass('questpie_internal.pending_reaction_intents') is not null as legacy
				from questpie_internal.protocol
				where singleton = true
			`;
			expect(unchanged).toEqual({
				version: 6,
				checksum: internalProtocolV6Checksum,
				legacy: true,
			});
			const [legacyBefore] = await session<
				Readonly<Array<{ reaction: string; state: string; attempts: number }>>
			>`
				select intents.reaction_name as reaction,
				       runs.state,
				       runs.attempt_count as attempts
				from questpie_internal.pending_reaction_intents as intents
				join questpie_internal.durable_runs as runs
				  on runs.application_name = intents.application_name
				 and runs.dispatch_id = intents.record_id
				where intents.application_name = ${application}
				  and intents.record_id = ${dispatchId}::uuid
			`;
			expect(legacyBefore).toEqual({
				reaction: reactionIdentity,
				state: "ready",
				attempts: 0,
			});

			await ensureInternalProtocolV7(
				session,
				current!.databaseName,
				pid,
				control,
				{ allowNonRollingProtocolV7: true },
			);
			await verifyInternalProtocolV7(session);
			const [preserved] = await session<
				Readonly<
					Array<{
						kind: string;
						resource: string;
						semanticVersion: number;
						state: string;
						attempts: number;
					}>
				>
			>`
				select dispatches.resource_kind as kind,
				       dispatches.resource_identity as resource,
				       runs.semantic_version as "semanticVersion",
				       runs.state,
				       runs.attempt_count as attempts
				from questpie_internal.durable_dispatches as dispatches
				join questpie_internal.durable_runs as runs
				  on runs.application_name = dispatches.application_name
				 and runs.dispatch_id = dispatches.record_id
				where dispatches.application_name = ${application}
				  and dispatches.record_id = ${dispatchId}::uuid
			`;
			expect(preserved).toEqual({
				kind: "reaction",
				resource: reactionIdentity,
				semanticVersion: 1,
				state: "ready",
				attempts: 0,
			});

			runtimeDatabase = createPostgresDatabase({
				connectionUrl: postgresUrl(),
				directConnectionUrl: postgresUrl(),
				pool: {
					max: 2,
					connectTimeoutMs: 2_000,
					checkoutTimeoutMs: 2_000,
					idleTimeoutMs: 2_000,
					maxLifetimeSeconds: 60,
				},
				timeouts: {
					statementMs: 5_000,
					lockMs: 2_000,
					idleInTransactionMs: 5_000,
				},
			});
			const kernel = createPostgresDatabaseDurableKernel({
				database: runtimeDatabase,
				application,
				reactions,
				jobs,
			});
			const worker = createDurableWorker({
				kernel,
				ledger: createPostgresDatabaseDurableEffectLedger({
					database: runtimeDatabase,
					application,
				}),
				reactions,
				jobs,
				workerId: "worker:protocol-v7-preservation",
				execute: async (attempt) => {
					expect(attempt.capability).toBe("reaction");
					expect(attempt.claim.semanticVersion).toBe(1);
					expect(attempt.claim.resource).toBe(reactionIdentity);
					expect(attempt.input).toEqual({ messageId: "message:legacy" });
					expect(attempt.contextInput).toEqual({ tenant: "legacy" });
					attempt.assertResolvedTenant("tenant:legacy");
					return { delivered: true };
				},
			});
			expect(await worker.poll()).toMatchObject({
				admitted: 1,
				claimed: 1,
				refusedIncompatible: 0,
				outcomes: [
					{
						runId,
						resource: reactionIdentity,
						attemptNumber: 1,
						outcome: "succeeded",
						failureCode: null,
					},
				],
			});
			const [settled] = await session<
				Readonly<
					Array<{
						state: string;
						attempts: number;
						result: string;
						events: string;
					}>
				>
			>`
				select runs.state,
				       runs.attempt_count as attempts,
				       convert_from(runs.result_bytes, 'UTF8') as result,
				       (select string_agg(events.kind, ',' order by events.sequence)
				          from questpie_internal.durable_run_events as events
				         where events.application_name = runs.application_name
				           and events.run_id = runs.run_id) as events
				from questpie_internal.durable_runs as runs
				where runs.application_name = ${application}
				  and runs.run_id = ${runId}::uuid
			`;
			expect(settled).toEqual({
				state: "succeeded",
				attempts: 1,
				result: '{"delivered":true}\n',
				events: "accepted,attemptStarted,succeeded",
			});
		} finally {
			await runtimeDatabase?.close({ deadlineAt: Date.now() + 5_000 });
			session.release();
		}
	}, 120_000);

	test("generalizes durable dispatch identity and pins run semantic version", async () => {
		const session = await database!.reserve();
		try {
			const [current] = await session<{ databaseName: string }[]>`
				select current_database() as "databaseName"
			`;
			await ensureInternalProtocolV7(
				session,
				current!.databaseName,
				await backendPid(session),
				control,
			);
			await verifyInternalProtocolV7(session);

			const [protocol] = await session<
				Readonly<Array<{ version: number; checksum: string }>>
			>`select version, checksum from questpie_internal.protocol where singleton = true`;
			expect(protocol).toEqual({
				version: 7,
				checksum: internalProtocolV7Checksum,
			});
			const columns = await session<
				Readonly<Array<{ table: string; column: string }>>
			>`
				select table_name as table, column_name as column
				from information_schema.columns
				where table_schema = 'questpie_internal'
				  and ((table_name = 'durable_dispatches' and column_name in ('resource_kind', 'resource_identity'))
				    or (table_name = 'durable_runs' and column_name = 'semantic_version'))
				order by table_name, column_name
			`;
			expect(columns).toEqual([
				{ table: "durable_dispatches", column: "resource_identity" },
				{ table: "durable_dispatches", column: "resource_kind" },
				{ table: "durable_runs", column: "semantic_version" },
			]);
			const [causation] = await session<{ definition: string }[]>`
				select pg_catalog.pg_get_constraintdef(oid, true) as definition
				from pg_catalog.pg_constraint
				where connamespace = 'questpie_internal'::regnamespace
				  and conname = 'durable_run_causation_kind_known'
			`;
			expect(causation?.definition).toBe(
				"CHECK (causation_kind = ANY (ARRAY['explicit'::text, 'mutationDispatch'::text]))",
			);
			const [legacy] = await session<{ exists: boolean }[]>`
				select to_regclass('questpie_internal.pending_reaction_intents') is not null as exists
			`;
			expect(legacy!.exists).toBe(false);
		} finally {
			session.release();
		}
	});
});
