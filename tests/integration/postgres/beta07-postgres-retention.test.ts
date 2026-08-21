import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { SQL } from "bun";

import { backendPid } from "../../../packages/compiler/src/postgres-session";
import { ensureInternalProtocolV3 } from "../../../packages/compiler/src/schema";
import { createPostgresLiveQueryCoordinator } from "../../../packages/runtime/src/application/realtime";
import {
	reconcilePostgresChangeLedger,
	type LinkedLiveQueryProgramV1,
	type PostgresWakeTickSource,
} from "../../../packages/runtime/src/live-query";
import {
	createPostgresLiveQueryRetention,
	type RetainedLiveQueryBinding,
} from "../../../packages/runtime/src/live-query/postgres-retention";
import { createPostgresDatabase } from "../../../packages/runtime/src/postgres";

const database = process.env.PGHOST ? new SQL({ max: 1 }) : undefined;
const concurrentDatabase = process.env.PGHOST ? new SQL({ max: 8 }) : undefined;
const snapshotDatabase = process.env.PGHOST ? new SQL({ max: 1 }) : undefined;
const pgDatabase = process.env.PGHOST
	? createPostgresDatabase({
			connectionUrl: postgresUrl(),
			directConnectionUrl: postgresUrl(),
			pool: {
				max: 2,
				connectTimeoutMs: 2_000,
				checkoutTimeoutMs: 2_000,
				idleTimeoutMs: 5_000,
				maxLifetimeSeconds: 60,
			},
			timeouts: {
				statementMs: 10_000,
				lockMs: 1_000,
				idleInTransactionMs: 10_000,
			},
		})
	: undefined;
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
const runtimeProgram = {
	limits: { fanoutPerBatch: 1_024 },
} as LinkedLiveQueryProgramV1;

function postgresUrl(): string {
	const url = new URL("postgres://localhost/postgres");
	url.hostname = process.env.PGHOST ?? "127.0.0.1";
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER ?? "postgres";
	url.pathname = `/${process.env.PGDATABASE ?? "postgres"}`;
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	return url.href;
}

function dormantTicks(): PostgresWakeTickSource {
	return {
		armInterval() {
			return () => {};
		},
		armDeadline() {
			return () => {};
		},
	};
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
	await snapshotDatabase?.close({ timeout: 0 });
	await pgDatabase?.close({ deadlineAt: Date.now() + 2_000 });
});

describe.skipIf(!database)(
	"BETA-07 PostgreSQL retained-result authority",
	() => {
		postgresTest(
			"makes only the last acknowledged complete result resumable without an availability oracle",
			async () => {
				const retention = createPostgresLiveQueryRetention({
					database: pgDatabase!,
					hmacKey,
				});
				const result = completeResult();
				const resumeToken = retention.mint(result);
				const { retainedGeneration: _generation, ...lookupBinding } = binding;
				expect(
					await retention.resume({ binding: lookupBinding, resumeToken }),
				).toEqual({
					status: "unavailable",
					resetReason: "resume-unavailable",
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

				const unavailable = {
					status: "unavailable",
					resetReason: "resume-unavailable",
				} as const;
				const tampered = `${resumeToken.slice(0, -1)}${resumeToken.endsWith("a") ? "b" : "a"}`;
				expect(
					await retention.resume({
						binding: lookupBinding,
						resumeToken: tampered,
					}),
				).toEqual(unavailable);
				expect(
					await retention.resume({
						binding: { ...lookupBinding, deploymentDigest: digest("d") },
						resumeToken,
					}),
				).toEqual({
					status: "unavailable",
					resetReason: "deployment-changed",
				});
				expect(
					await retention.resume({
						binding: {
							...lookupBinding,
							authorityPartitionDigest: digest("d"),
						},
						resumeToken,
					}),
				).toEqual({
					status: "unavailable",
					resetReason: "authority-changed",
				});
				for (const incompatible of [
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
			"retains below an unrelated PostgreSQL snapshot, then prunes after every consumer advances",
			async () => {
				const retention = createPostgresLiveQueryRetention({
					sql: database!,
					hmacKey,
				});
				const snapshotStarted = Promise.withResolvers<string>();
				const releaseSnapshot = Promise.withResolvers<void>();
				const unrelatedSnapshot = snapshotDatabase!.begin(
					"isolation level repeatable read",
					async (transaction) => {
						const [identity] = await transaction<
							{ transactionId: string }[]
						>`select pg_catalog.pg_current_xact_id()::text as "transactionId"`;
						await transaction`select pg_catalog.pg_snapshot_xmin(pg_catalog.pg_current_snapshot())`;
						snapshotStarted.resolve(identity!.transactionId);
						await releaseSnapshot.promise;
					},
				);
				const snapshotTransactionId = await snapshotStarted.promise;
				try {
					const [fact] = await database!<
						{ factIdentity: string; transactionId: string }[]
					>`
			insert into questpie_internal.change_ledger
			(application_name, transaction_id, collection_identity, change_kind, conservative)
			values ('collaboration', pg_current_xact_id(), 'collection:messages', 'collection', true)
			returning fact_identity::text as "factIdentity", transaction_id::text as "transactionId"
		`;
					expect(BigInt(fact!.transactionId)).toBeGreaterThan(
						BigInt(snapshotTransactionId),
					);
					for (const consumer of ["primary", "lagging"])
						expect(
							await reconcilePostgresChangeLedger({
								sql: database!,
								application: "collaboration",
								consumer,
								apply: () => undefined,
							}),
						).toMatchObject({
							priorHorizon: snapshotTransactionId,
							nextHorizon: snapshotTransactionId,
							facts: [],
						});

					expect(
						await retention.prune({ applicationName: "collaboration" }),
					).toEqual({ retainedResults: 0, ledgerFacts: 0 });
					const [retained] = await database!<{ count: number }[]>`
					select count(*)::integer as count
					from questpie_internal.change_ledger
					where fact_identity = ${fact!.factIdentity}::uuid
				`;
					expect(retained).toEqual({ count: 1 });

					releaseSnapshot.resolve();
					await unrelatedSnapshot;
					for (const consumer of ["primary", "lagging"])
						expect(
							(
								await reconcilePostgresChangeLedger({
									sql: database!,
									application: "collaboration",
									consumer,
									apply: () => undefined,
								})
							).facts.map(({ factIdentity }) => factIdentity),
						).toEqual([fact!.factIdentity]);
					expect(
						await retention.prune({ applicationName: "collaboration" }),
					).toEqual({ retainedResults: 0, ledgerFacts: 1 });
					const [processed] = await database!<{ count: number }[]>`
			select count(*)::integer as count from questpie_internal.processed_change_facts
		`;
					expect(processed).toEqual({ count: 0 });

					const [controlFact] = await database!<{ factIdentity: string }[]>`
					insert into questpie_internal.change_ledger
					(application_name, transaction_id, collection_identity, change_kind, conservative)
					values ('collaboration', pg_current_xact_id(), 'collection:messages', 'collection', true)
					returning fact_identity::text as "factIdentity"
				`;
					for (const consumer of ["primary", "lagging"])
						await reconcilePostgresChangeLedger({
							sql: database!,
							application: "collaboration",
							consumer,
							apply: () => undefined,
						});
					expect(
						await retention.prune({ applicationName: "collaboration" }),
					).toEqual({ retainedResults: 0, ledgerFacts: 1 });
					const [control] = await database!<{ count: number }[]>`
					select count(*)::integer as count
					from questpie_internal.change_ledger
					where fact_identity = ${controlFact!.factIdentity}::uuid
				`;
					expect(control).toEqual({ count: 0 });
				} finally {
					releaseSnapshot.resolve();
					await unrelatedSnapshot.catch(() => undefined);
				}
			},
			15_000,
		);

		postgresTest(
			"runs PostgreSQL-clock retention pruning from the production wake scan",
			async () => {
				const retention = createPostgresLiveQueryRetention({
					sql: database!,
					hmacKey,
				});
				const result = completeResult();
				await retention.acknowledge({
					...result,
					resumeToken: retention.mint(result),
				});
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

				const coordinator = createPostgresLiveQueryCoordinator({
					program: runtimeProgram,
					sql: database!,
					hmacKey,
					applicationName: "collaboration",
					deploymentDigest: binding.deploymentDigest,
					wireVersion: binding.wireVersion,
					tickSource: dormantTicks(),
				});
				try {
					await coordinator.start();
					const [remaining] = await database!<{ count: number }[]>`
					select count(*)::integer as count
					from questpie_internal.retained_live_query_results
					where application_name = 'collaboration'
				`;
					expect(remaining).toEqual({ count: 0 });
				} finally {
					await coordinator.drain();
				}
			},
		);
	},
);
