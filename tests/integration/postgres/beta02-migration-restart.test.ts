import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { SQL } from "bun";

import {
	applyCommittedMigrations,
	applyCommittedSeeds,
	compileApplication,
	createCommittedMigration,
	createCommittedSeed,
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
			currentSchema: mismatchedSchema,
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
			currentSchema: targetSchema,
			planDigest: planned.digest,
		});

		const concurrent = await Promise.all([
			applyCommittedMigrations({ migrations: [migration] }),
			applyCommittedMigrations({ migrations: [migration] }),
		]);
		const applied = concurrent.find((result) => result.status === "applied");
		expect(concurrent.map((result) => result.status).sort()).toEqual([
			"alreadyApplied",
			"applied",
		]);
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
		expect(restarted.fingerprintDigest).toBe(applied?.fingerprintDigest);

		const drift = await inspectSchemaFingerprint({ schema: targetSchema });
		expect(drift.digest).toBe(applied.fingerprintDigest);
		const [receipt] = await database!<{ count: number }[]>`
			select count(*)::integer as count
			from questpie_internal.schema_migration_receipts
			where application_name = 'collaboration'
		`;
		expect(receipt?.count).toBe(1);
		expect(drift.fingerprint.observations.serverVersion).toMatch(/^17\./);
		const [committedSeed] = compilation.committedSeeds;
		if (!committedSeed)
			throw new Error("compiled collaboration Seed is missing");
		const seeded = await applyCommittedSeeds({
			schema: targetSchema,
			seeds: [committedSeed],
		});
		expect(seeded).toEqual({
			applied: ["seed:collaboration.demo.v1"],
			alreadyApplied: [],
		});
		const reseeded = await applyCommittedSeeds({
			schema: targetSchema,
			seeds: [committedSeed],
		});
		expect(reseeded).toEqual({
			applied: [],
			alreadyApplied: ["seed:collaboration.demo.v1"],
		});
		const [seedState] = await database!<
			{ messages: number; receipts: number; succeeded: number }[]
		>`
			select
			  (select count(*)::integer from collaboration.messages) as messages,
			  (select count(*)::integer from questpie_internal.seed_receipts) as receipts,
			  (select count(*)::integer from questpie_internal.seed_attempt_events where event = 'succeeded') as succeeded
		`;
		expect(seedState).toEqual({ messages: 1, receipts: 1, succeeded: 1 });

		const upsertSeed = createCommittedSeed({
			definition: {
				name: "collaboration.upsert.v1",
				dependsOn: ["collaboration.demo.v1"],
				steps: [
					{
						kind: "upsert",
						collection: "collection:companies",
						key: { id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0" },
						create: { name: "created value" },
						update: { name: "updated value" },
					},
				],
			},
			schema: targetSchema,
		});
		const upserted = await applyCommittedSeeds({
			schema: targetSchema,
			seeds: [committedSeed, upsertSeed],
		});
		expect(upserted).toEqual({
			applied: ["seed:collaboration.upsert.v1"],
			alreadyApplied: ["seed:collaboration.demo.v1"],
		});
		const [company] = await database!<{ name: string }[]>`
			select name from collaboration.companies
			where id = '018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0'
		`;
		expect(company?.name).toBe("updated value");

		await database!.unsafe(
			"CREATE INDEX unexpected_protocol_index ON questpie_internal.protocol (version)",
		);
		await expect(
			applyCommittedMigrations({ migrations: [migration] }),
		).rejects.toMatchObject({ code: "QP-SCHEMA-023" });
		await database!.unsafe(
			"DROP INDEX questpie_internal.unexpected_protocol_index",
		);

		await database!.unsafe(
			"CREATE FUNCTION collaboration.unexpected() RETURNS integer LANGUAGE sql AS 'SELECT 1'",
		);
		await expect(
			inspectSchemaFingerprint({ schema: targetSchema }),
		).rejects.toMatchObject({ code: "QP-SCHEMA-028" });
		await database!.unsafe("DROP FUNCTION collaboration.unexpected()");

		await database!.unsafe(
			"ALTER TABLE collaboration.channels DROP CONSTRAINT qp_fk_channels_space; ALTER TABLE collaboration.channels ADD CONSTRAINT qp_fk_channels_space FOREIGN KEY (space_id) REFERENCES collaboration.spaces(id) ON UPDATE RESTRICT ON DELETE CASCADE",
		);
		await expect(
			inspectSchemaFingerprint({ schema: targetSchema }),
		).rejects.toMatchObject({ code: "QP-SCHEMA-028" });
		await database!.unsafe(
			"ALTER TABLE collaboration.channels DROP CONSTRAINT qp_fk_channels_space; ALTER TABLE collaboration.channels ADD CONSTRAINT qp_fk_channels_space FOREIGN KEY (space_id) REFERENCES collaboration.spaces(id) ON UPDATE RESTRICT ON DELETE RESTRICT",
		);

		await database!.unsafe(
			"DROP INDEX collaboration.qp_ix_messages_by_audit_id; CREATE INDEX qp_ix_messages_by_audit_id ON collaboration.messages USING btree (audit_id DESC)",
		);
		await expect(
			inspectSchemaFingerprint({ schema: targetSchema }),
		).rejects.toMatchObject({ code: "QP-SCHEMA-028" });
		await database!.unsafe(
			"DROP INDEX collaboration.qp_ix_messages_by_audit_id; CREATE INDEX qp_ix_messages_by_audit_id ON collaboration.messages USING btree (audit_id)",
		);

		await database!.unsafe("ALTER TABLE collaboration.messages SET UNLOGGED");
		await expect(
			inspectSchemaFingerprint({ schema: targetSchema }),
		).rejects.toMatchObject({ code: "QP-SCHEMA-028" });
		await database!.unsafe("ALTER TABLE collaboration.messages SET LOGGED");

		const otherTarget = {
			...targetSchema,
			application: { ...targetSchema.application, name: "other" },
		};
		const otherPlan = createMigrationPlan({
			targetSchema: otherTarget,
			slug: "claim-collaboration",
		});
		const otherMigration = createCommittedMigration({
			plan: otherPlan.plan,
			baseSchema: otherPlan.baseSchema,
			targetSchema: otherTarget,
			currentSchema: otherTarget,
			planDigest: otherPlan.digest,
		});
		await expect(
			applyCommittedMigrations({ migrations: [otherMigration] }),
		).rejects.toMatchObject({ code: "QP-SCHEMA-029" });
	});
});
