import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { SQL } from "bun";

import { backendPid } from "../../../packages/compiler/src/postgres-session";
import {
	ensureInternalProtocolV3,
	projectPostgresChangeCapture,
} from "../../../packages/compiler/src/schema";
import {
	canonicalJsonLine,
	sha256Digest,
} from "../../../packages/runtime/src/canonical-json";
import {
	createPostgresLiveQueryInvalidationEffect,
	reconcilePostgresChangeLedger,
} from "../../../packages/runtime/src/live-query";

const database = process.env.PGHOST ? new SQL({ max: 1 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;
const control = { lockTimeoutMs: 1_000, statementTimeoutMs: 10_000 } as const;
const application = "durableInvalidationProbe";
const deploymentA = "a".repeat(64);
const deploymentB = "b".repeat(64);
const authority = "c".repeat(64);
const inputDigest = "d".repeat(64);
const projection = projectPostgresChangeCapture({
	applicationName: application,
	postgresSchema: "durable_invalidation_probe",
	collections: [
		{
			identity: "collection:messages",
			postgresName: "messages",
			keyColumns: ["id"],
		},
	],
});

function planBytes(collection: string): Uint8Array {
	const plan = {
		format: "questpie.observed-live-query-plan" as const,
		version: 1 as const,
		query: "query:messages.page",
		tokens: [
			{
				kind: "collectionRange" as const,
				collection,
				detail: { conservative: true },
			},
		],
	};
	return canonicalJsonLine({
		...plan,
		digest: sha256Digest(
			Buffer.concat([
				Buffer.from("questpie-observed-live-query-plan-v1\0"),
				canonicalJsonLine(plan),
			]),
		),
	});
}

async function ensure(sql: SQL): Promise<void> {
	const [current] = await sql<
		{ name: string }[]
	>`select current_database() as name`;
	await ensureInternalProtocolV3(
		sql,
		current!.name,
		await backendPid(sql),
		control,
	);
}

async function insertWatch(
	scope: string,
	binding: string,
	deployment: string,
	collection: string,
	slot: number,
): Promise<void> {
	const bytes = planBytes(collection);
	await database!`
		insert into questpie_internal.realtime_scope_attachments
		(application_name, scope_identity, deployment_digest,
		 authority_partition_digest, principal_kind, principal_id, state)
		values (${application}, ${scope}, ${deployment}, ${authority},
		        'user', ${`principal:${scope}`}, 'open')
	`;
	await database!`
		insert into questpie_internal.realtime_watch_bindings
		(application_name, scope_identity, binding_identity, deployment_digest,
		 authority_partition_digest, principal_kind, principal_id, active_slot,
		 query_identity, query_bytes, input_bytes, input_digest, context_input_bytes,
		 wire_version, resume_requested, requested_resume_token, state)
		values (${application}, ${scope}, ${binding}, ${deployment}, ${authority},
		        'user', ${`principal:${scope}`}, ${slot}, 'messages.page',
		        ${new TextEncoder().encode('"query:messages.page"\n')},
		        ${new TextEncoder().encode("{}\n")}, ${inputDigest},
		        ${new TextEncoder().encode("{}\n")}, 1, false, null, 'open')
	`;
	await database!`
		insert into questpie_internal.observed_dependency_plans
		(application_name, scope_identity, binding_identity, deployment_digest,
		 authority_partition_digest, query_identity, input_digest, wire_version,
		 retained_generation, plan_digest, plan_bytes)
		values (${application}, ${scope}, ${binding}, ${deployment}, ${authority},
		        'messages.page', ${inputDigest}, 1, 1, ${sha256Digest(bytes)}, ${bytes})
	`;
}

async function generations(): Promise<Record<string, string>> {
	const rows = await database!<{ binding: string; generation: string }[]>`
		select binding_identity as binding,
		       invalidation_generation::text as generation
		from questpie_internal.realtime_watch_bindings
		where application_name = ${application}
		order by binding_identity
	`;
	return Object.fromEntries(rows.map((row) => [row.binding, row.generation]));
}

beforeEach(async () => {
	if (!database) return;
	await database.unsafe(`DROP SCHEMA IF EXISTS durable_invalidation_probe CASCADE;
DROP SCHEMA IF EXISTS questpie_internal CASCADE;`);
	await ensure(database);
	await database.unsafe(`CREATE SCHEMA durable_invalidation_probe;
CREATE TABLE durable_invalidation_probe.messages (
  id text PRIMARY KEY,
  body text NOT NULL
);`);
	await database.unsafe(projection.sql);
});

afterAll(async () => {
	await database?.unsafe(`DROP SCHEMA IF EXISTS durable_invalidation_probe CASCADE;
DROP SCHEMA IF EXISTS questpie_internal CASCADE;`);
	await database?.close({ timeout: 0 });
});

describe.skipIf(!database)(
	"BETA-07 deployment-wide durable invalidation",
	() => {
		postgresTest(
			"instance R dirties only matching open deployment bindings without a wake and rolls every effect back atomically",
			async () => {
				await insertWatch(
					"scope:a-match",
					"binding:a-match",
					deploymentA,
					"collection:messages",
					1,
				);
				await insertWatch(
					"scope:a-miss",
					"binding:a-miss",
					deploymentA,
					"collection:channels",
					2,
				);
				await insertWatch(
					"scope:b-match",
					"binding:b-match",
					deploymentB,
					"collection:messages",
					1,
				);
				const effect = createPostgresLiveQueryInvalidationEffect({
					deploymentDigest: deploymentA,
				});
				await reconcilePostgresChangeLedger({
					sql: database!,
					application,
					consumer: effect.consumer,
					apply: () => undefined,
					effect,
				});

				await database!`
				insert into durable_invalidation_probe.messages (id, body)
				values ('one', 'wake deliberately suppressed')
			`;
				await reconcilePostgresChangeLedger({
					sql: database!,
					application,
					consumer: effect.consumer,
					apply: () => undefined,
					effect,
				});
				expect(await generations()).toEqual({
					"binding:a-match": "2",
					"binding:a-miss": "1",
					"binding:b-match": "1",
				});

				await reconcilePostgresChangeLedger({
					sql: database!,
					application,
					consumer: effect.consumer,
					apply: () => undefined,
					effect,
				});
				expect((await generations())["binding:a-match"]).toBe("2");

				await database!.unsafe(`
				insert into durable_invalidation_probe.messages (id, body)
				select 'bulk-' || value, 'widens at seventeen'
				from generate_series(1, 17) value
			`);
				await reconcilePostgresChangeLedger({
					sql: database!,
					application,
					consumer: effect.consumer,
					apply: () => undefined,
					effect,
				});
				expect((await generations())["binding:a-match"]).toBe("3");

				const [before] = await database!<
					{ horizon: string; processed: number }[]
				>`
				select consumer.xid_horizon::text as horizon,
				       (select count(*)::integer
				        from questpie_internal.processed_change_facts processed
				        where processed.application_name = consumer.application_name
				          and processed.consumer_id = consumer.consumer_id) as processed
				from questpie_internal.reconciliation_consumers consumer
				where consumer.application_name = ${application}
				  and consumer.consumer_id = ${effect.consumer}
			`;
				const invalid = new TextEncoder().encode('{"not":"a plan"}\n');
				await database!`
				update questpie_internal.observed_dependency_plans
				set plan_bytes = ${invalid}, plan_digest = ${sha256Digest(invalid)}
				where application_name = ${application}
				  and binding_identity = 'binding:a-match'
			`;
				await database!`
				insert into durable_invalidation_probe.messages (id, body)
				values ('after-invalid-plan', 'must remain retryable')
			`;
				await expect(
					reconcilePostgresChangeLedger({
						sql: database!,
						application,
						consumer: effect.consumer,
						apply: () => undefined,
						effect,
					}),
				).rejects.toThrow("observed Live Query plan");
				const [after] = await database!<
					{ horizon: string; processed: number }[]
				>`
				select consumer.xid_horizon::text as horizon,
				       (select count(*)::integer
				        from questpie_internal.processed_change_facts processed
				        where processed.application_name = consumer.application_name
				          and processed.consumer_id = consumer.consumer_id) as processed
				from questpie_internal.reconciliation_consumers consumer
				where consumer.application_name = ${application}
				  and consumer.consumer_id = ${effect.consumer}
			`;
				expect(after).toEqual(before);
				expect((await generations())["binding:a-match"]).toBe("3");

				const repaired = planBytes("collection:messages");
				await database!`
					update questpie_internal.observed_dependency_plans
					set plan_bytes = ${repaired}, plan_digest = ${sha256Digest(repaired)}
					where application_name = ${application}
					  and binding_identity = 'binding:a-match'
				`;
				await database!`
					update questpie_internal.realtime_watch_bindings
					set invalidation_generation = 9223372036854775807
					where application_name = ${application}
					  and binding_identity = 'binding:a-match'
				`;
				await expect(
					reconcilePostgresChangeLedger({
						sql: database!,
						application,
						consumer: effect.consumer,
						apply: () => undefined,
						effect,
					}),
				).rejects.toThrow();
				const [afterUpdateFailure] = await database!<
					{ horizon: string; processed: number }[]
				>`
					select consumer.xid_horizon::text as horizon,
					       (select count(*)::integer
					        from questpie_internal.processed_change_facts processed
					        where processed.application_name = consumer.application_name
					          and processed.consumer_id = consumer.consumer_id) as processed
					from questpie_internal.reconciliation_consumers consumer
					where consumer.application_name = ${application}
					  and consumer.consumer_id = ${effect.consumer}
				`;
				expect(afterUpdateFailure).toEqual(before);
				expect((await generations())["binding:a-match"]).toBe(
					"9223372036854775807",
				);
			},
			15_000,
		);
	},
);
