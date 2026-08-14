import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { SQL } from "bun";

import {
	applyCommittedMigrations,
	compileApplication,
	createCommittedMigration,
	createMigrationPlan,
	inspectSchemaFingerprint,
} from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../../fixtures/collaboration");
const database = process.env.PGHOST ? new SQL() : undefined;

beforeAll(async () => {
	if (!database) return;
	await database.unsafe(
		'DROP SCHEMA IF EXISTS "collaboration" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE;',
	);
});

afterAll(async () => {
	await database?.close();
});

describe.skipIf(!database)("BETA-02 PostgreSQL migration lifecycle", () => {
	test("applies, loses the response, restarts, and reports no Drift", async () => {
		const compilation = await compileApplication({
			applicationRoot: fixtureRoot,
		});
		const targetSchema = JSON.parse(
			compilation.generatedFiles["schema-projection.json"] ?? "null",
		);
		const mismatchedSchema = {
			...targetSchema,
			requiredPostgres: {
				...targetSchema.requiredPostgres,
				databaseCollation: "questpie.invalid-collation",
			},
		};
		const mismatchedPlan = createMigrationPlan({
			targetSchema: mismatchedSchema,
			slug: "provider-must-match-before-ddl",
		});
		const mismatchedMigration = createCommittedMigration({
			plan: mismatchedPlan.plan,
			baseSchema: mismatchedPlan.baseSchema,
			targetSchema: mismatchedSchema,
			planDigest: mismatchedPlan.digest,
		});
		await expect(
			applyCommittedMigrations({ migrations: [mismatchedMigration] }),
		).rejects.toMatchObject({ code: "QP-SCHEMA-007" });
		const [preflightState] = await database!<
			{
				applicationSchemaExists: boolean;
				protocolSchemaExists: boolean;
			}[]
		>`
			select
				exists(select 1 from pg_catalog.pg_namespace where nspname = 'collaboration') as "applicationSchemaExists",
				exists(select 1 from pg_catalog.pg_namespace where nspname = 'questpie_internal') as "protocolSchemaExists"
		`;
		expect(preflightState).toEqual({
			applicationSchemaExists: false,
			protocolSchemaExists: false,
		});
		const planned = createMigrationPlan({
			targetSchema,
			slug: "create-collaboration",
		});
		const migration = createCommittedMigration({
			plan: planned.plan,
			baseSchema: planned.baseSchema,
			targetSchema,
			planDigest: planned.digest,
		});

		const applied = await applyCommittedMigrations({ migrations: [migration] });
		expect(applied).toMatchObject({
			status: "applied",
			applied: ["000001_create-collaboration"],
		});

		// Treat the successful result as lost and create a fresh pool in the retry.
		const restarted = await applyCommittedMigrations({
			migrations: [migration],
		});
		expect(restarted).toMatchObject({
			status: "alreadyApplied",
			applied: [],
			head: "000001_create-collaboration",
		});
		expect(restarted.fingerprintDigest).toBe(applied.fingerprintDigest);

		const drift = await inspectSchemaFingerprint({ schema: targetSchema });
		expect(drift.digest).toBe(applied.fingerprintDigest);
		const [receipt] = await database!<{ count: number }[]>`
			select count(*)::integer as count
			from questpie_internal.schema_migration_receipts
			where application_name = 'collaboration'
		`;
		expect(receipt?.count).toBe(1);
		expect(drift.fingerprint.observations.serverVersion).toMatch(/^17\./);
	});
});
