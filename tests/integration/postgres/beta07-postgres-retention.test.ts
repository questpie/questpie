import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { SQL } from "bun";

import { backendPid } from "../../../packages/compiler/src/postgres-session";
import { ensureInternalProtocolV3 } from "../../../packages/compiler/src/schema";
import {
	createPostgresLiveQueryRetention,
	type RetainedLiveQueryBinding,
} from "../../../packages/runtime/src/live-query/postgres-retention";

const database = process.env.PGHOST ? new SQL({ max: 1 }) : undefined;
const concurrentDatabase = process.env.PGHOST ? new SQL({ max: 8 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;
const control = { lockTimeoutMs: 1_000, statementTimeoutMs: 10_000 } as const;
const hmacKey = new Uint8Array(32).fill(29);
const digest = (value: string): string => value.repeat(64);
const binding = {
	applicationName: "collaboration",
	deploymentDigest: digest("a"),
	authorityPartitionDigest: digest("b"),
	queryIdentity: "messages.page",
	inputDigest: digest("c"),
	wireVersion: 2,
	retainedGeneration: 1n,
} as const;
const resultBytes = new TextEncoder().encode('{"messages":[]}\n');
const dependencyPlanBytes = new TextEncoder().encode('{"tokens":[]}\n');

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

function completeResult(nextBinding: RetainedLiveQueryBinding = binding) {
	return { binding: nextBinding, resultBytes, dependencyPlanBytes } as const;
}

beforeEach(async () => {
	await database?.unsafe("DROP SCHEMA IF EXISTS questpie_internal CASCADE");
	if (database) await ensure(database);
});

afterAll(async () => {
	await database?.unsafe("DROP SCHEMA IF EXISTS questpie_internal CASCADE");
	await database?.close({ timeout: 0 });
	await concurrentDatabase?.close({ timeout: 0 });
});

describe.skipIf(!database)(
	"BETA-07 PostgreSQL retained-result authority",
	() => {
		postgresTest(
			"makes only the last acknowledged complete result resumable without an availability oracle",
			async () => {
				const retention = createPostgresLiveQueryRetention({
					sql: database!,
					hmacKey,
				});
				const result = completeResult();
				const resumeToken = retention.mint(result);
				const { retainedGeneration: _generation, ...lookupBinding } = binding;
				expect(
					await retention.resume({ binding: lookupBinding, resumeToken }),
				).toEqual({
					status: "unavailable",
				});

				await retention.acknowledge({
					...result,
					resumeToken,
				});
				const resumed = await retention.resume({
					binding: lookupBinding,
					resumeToken,
				});
				expect(resumed).toEqual({
					status: "available",
					resultBytes,
					dependencyPlanBytes,
					retainedGeneration: 1n,
				});

				const unavailable = { status: "unavailable" } as const;
				const tampered = `${resumeToken.slice(0, -1)}${resumeToken.endsWith("a") ? "b" : "a"}`;
				expect(
					await retention.resume({
						binding: lookupBinding,
						resumeToken: tampered,
					}),
				).toEqual(unavailable);
				for (const incompatible of [
					{ ...lookupBinding, deploymentDigest: digest("d") },
					{ ...lookupBinding, authorityPartitionDigest: digest("d") },
					{ ...lookupBinding, queryIdentity: "messages.other" },
					{ ...lookupBinding, inputDigest: digest("d") },
					{ ...lookupBinding, wireVersion: 3 },
				])
					expect(
						await retention.resume({
							binding: incompatible,
							resumeToken,
						}),
					).toEqual(unavailable);
				await database!.unsafe(
					"ALTER TABLE questpie_internal.retained_live_query_results DISABLE TRIGGER retained_live_query_result_clock",
				);
				await database!`
					update questpie_internal.retained_live_query_results
					set created_at = transaction_timestamp() - interval '25 hours',
					    expires_at = transaction_timestamp() - interval '1 hour'
					where application_name = 'collaboration'
				`;
				await database!.unsafe(
					"ALTER TABLE questpie_internal.retained_live_query_results ENABLE TRIGGER retained_live_query_result_clock",
				);
				expect(
					await retention.resume({
						binding: lookupBinding,
						resumeToken,
					}),
				).toEqual(unavailable);
				expect(
					await retention.prune({ applicationName: "collaboration" }),
				).toEqual({ retainedResults: 1, ledgerFacts: 0 });
				await expect(
					retention.acknowledge({
						...result,
						resultBytes: new TextEncoder().encode('{"messages":["forged"]}\n'),
						resumeToken,
					}),
				).rejects.toThrow(/does not bind/);
			},
		);

		postgresTest(
			"retains at most 128 acknowledged tokens in one Principal authority partition",
			async () => {
				const retention = createPostgresLiveQueryRetention({
					sql: concurrentDatabase!,
					hmacKey,
				});
				const { retainedGeneration: _generation, ...lookupBinding } = binding;
				const tokens: string[] = [];
				const acknowledgements: Promise<void>[] = [];
				for (let generation = 1n; generation <= 129n; generation += 1n) {
					const nextBinding = { ...binding, retainedGeneration: generation };
					const result = completeResult(nextBinding);
					const resumeToken = retention.mint(result);
					tokens.push(resumeToken);
					acknowledgements.push(
						retention.acknowledge({
							...result,
							resumeToken,
						}),
					);
				}
				await Promise.all(acknowledgements);
				const [count] = await database!<{ retained: number }[]>`
			select count(*)::integer as retained
			from questpie_internal.retained_live_query_results
			where application_name = 'collaboration'
			  and authority_partition_digest = ${binding.authorityPartitionDigest}
		`;
				expect(count).toEqual({ retained: 128 });
				const resumed = await Promise.all(
					tokens.map((resumeToken) =>
						retention.resume({ binding: lookupBinding, resumeToken }),
					),
				);
				expect(
					resumed.filter(({ status }) => status === "unavailable"),
				).toHaveLength(1);
				expect(
					resumed.filter(({ status }) => status === "available"),
				).toHaveLength(128);
			},
		);

		postgresTest(
			"prunes ledger facts only below the minimum acknowledged consumer xid8 horizon",
			async () => {
				const retention = createPostgresLiveQueryRetention({
					sql: database!,
					hmacKey,
				});
				const [fact] = await database!<
					{ factIdentity: string; transactionId: string }[]
				>`
			insert into questpie_internal.change_ledger
			(application_name, transaction_id, collection_identity, change_kind, conservative)
			values ('collaboration', pg_current_xact_id(), 'messages', 'collection', true)
			returning fact_identity::text as "factIdentity", transaction_id::text as "transactionId"
		`;
				await database!`
			insert into questpie_internal.reconciliation_consumers
			(application_name, consumer_id, xid_horizon, acknowledged_at)
			values
			('collaboration', 'primary', pg_snapshot_xmin(pg_current_snapshot()), transaction_timestamp()),
			('collaboration', 'lagging', ${fact!.transactionId}::xid8, transaction_timestamp())
		`;
				await database!`
			insert into questpie_internal.processed_change_facts
			(application_name, consumer_id, fact_identity, processed_at)
			values ('collaboration', 'primary', ${fact!.factIdentity}::uuid, transaction_timestamp())
		`;

				expect(
					await retention.prune({ applicationName: "collaboration" }),
				).toEqual({ retainedResults: 0, ledgerFacts: 0 });
				await database!`
			update questpie_internal.reconciliation_consumers
			set xid_horizon = pg_snapshot_xmin(pg_current_snapshot()), acknowledged_at = transaction_timestamp()
			where application_name = 'collaboration' and consumer_id = 'lagging'
		`;
				expect(
					await retention.prune({ applicationName: "collaboration" }),
				).toEqual({ retainedResults: 0, ledgerFacts: 1 });
				const [processed] = await database!<{ count: number }[]>`
			select count(*)::integer as count from questpie_internal.processed_change_facts
		`;
				expect(processed).toEqual({ count: 0 });
			},
		);
	},
);
