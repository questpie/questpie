import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { SQL } from "bun";

import { backendPid } from "../../../packages/compiler/src/postgres-session";
import {
	ensureInternalProtocolV3,
	projectPostgresChangeCapture,
} from "../../../packages/compiler/src/schema";
import {
	reconcilePostgresChangeLedger,
	type ChangeLedgerFactV1,
} from "../../../packages/runtime/src/live-query";

const database = process.env.PGHOST ? new SQL({ max: 1 }) : undefined;
const lowerDatabase = process.env.PGHOST ? new SQL({ max: 1 }) : undefined;
const higherDatabase = process.env.PGHOST ? new SQL({ max: 1 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;
const control = { lockTimeoutMs: 1_000, statementTimeoutMs: 10_000 } as const;
const application = "frontierProbe";
const consumer = "runtime:frontier-probe";
const projection = projectPostgresChangeCapture({
	applicationName: application,
	postgresSchema: "frontier_probe",
	collections: [
		{
			identity: "collection:messages",
			postgresName: "messages",
			keyColumns: ["id"],
		},
	],
});

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

beforeEach(async () => {
	if (!database) return;
	await database.unsafe(`DROP SCHEMA IF EXISTS frontier_probe CASCADE;
DROP SCHEMA IF EXISTS questpie_internal CASCADE;`);
	await ensure(database);
	await database.unsafe(`CREATE SCHEMA frontier_probe;
CREATE TABLE frontier_probe.messages (
  id text PRIMARY KEY,
  body text NOT NULL
);`);
	await database.unsafe(projection.sql);
});

afterAll(async () => {
	await database?.unsafe(`DROP SCHEMA IF EXISTS frontier_probe CASCADE;
DROP SCHEMA IF EXISTS questpie_internal CASCADE;`);
	await database?.close({ timeout: 0 });
	await lowerDatabase?.close({ timeout: 0 });
	await higherDatabase?.close({ timeout: 0 });
});

describe.skipIf(!database)("BETA-07 PostgreSQL reconciliation frontier", () => {
	postgresTest(
		"waits below an open lower xid8 and ignores local sequence wrap",
		async () => {
			const lowerStarted = Promise.withResolvers<string>();
			const releaseLower = Promise.withResolvers<void>();
			const lower = lowerDatabase!.begin(async (transaction) => {
				await transaction`
					insert into frontier_probe.messages (id, body)
					values ('lower', 'commits second')
				`;
				const [identity] = await transaction<
					{ transactionId: string }[]
				>`select pg_catalog.pg_current_xact_id()::text as "transactionId"`;
				lowerStarted.resolve(identity!.transactionId);
				await releaseLower.promise;
			});
			const lowerTransactionId = await lowerStarted.promise;
			try {
				await higherDatabase!`
				insert into frontier_probe.messages (id, body)
				values ('higher', 'commits first')
			`;
				const firstApplied: ChangeLedgerFactV1[] = [];
				const first = await reconcilePostgresChangeLedger({
					sql: database!,
					application,
					consumer,
					apply: (facts) => firstApplied.push(...facts),
				});

				expect(first.priorHorizon).toBe(lowerTransactionId);
				expect(first.nextHorizon).toBe(lowerTransactionId);
				expect(first.facts).toEqual([]);
				expect(firstApplied).toEqual([]);

				releaseLower.resolve();
				await lower;
				const secondApplied: ChangeLedgerFactV1[] = [];
				const second = await reconcilePostgresChangeLedger({
					sql: database!,
					application,
					consumer,
					apply: (facts) => secondApplied.push(...facts),
				});

				expect(second.facts.map(({ newKey }) => newKey?.id)).toEqual([
					"lower",
					"higher",
				]);
				expect(secondApplied).toEqual(second.facts);
				expect(second.facts[0]!.transactionId).toBe(lowerTransactionId);
				expect(BigInt(second.nextHorizon)).toBeGreaterThan(
					BigInt(second.facts[1]!.transactionId),
				);

				await database!.unsafe(
					"ALTER SEQUENCE questpie_internal.change_ledger_fact_id_seq RESTART WITH 1",
				);
				await higherDatabase!`
				insert into frontier_probe.messages (id, body)
				values ('wrapped', 'local sequence is not authority')
			`;
				const third = await reconcilePostgresChangeLedger({
					sql: database!,
					application,
					consumer,
					apply: () => undefined,
				});
				expect(third.facts).toHaveLength(1);
				expect(third.facts[0]).toMatchObject({
					factId: "1",
					newKey: { id: "wrapped" },
				});

				await higherDatabase!.unsafe(`
					insert into frontier_probe.messages (id, body)
					select 'bulk-' || value, 'widens at seventeen'
					from generate_series(1, 17) value
				`);
				const widened = await reconcilePostgresChangeLedger({
					sql: database!,
					application,
					consumer,
					apply: () => undefined,
				});
				expect(widened.facts).toEqual([
					expect.objectContaining({
						kind: "collection",
						collection: "collection:messages",
						conservative: true,
						oldKey: null,
						newKey: null,
					}),
				]);
			} finally {
				releaseLower.resolve();
				await lower.catch(() => undefined);
			}
		},
		15_000,
	);
});
