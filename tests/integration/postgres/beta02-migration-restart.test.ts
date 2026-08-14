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

import { lockKey } from "../../../packages/compiler/src/postgres-session";

const fixtureRoot = resolve(import.meta.dir, "../../../fixtures/collaboration");
const database = process.env.PGHOST ? new SQL() : undefined;

beforeAll(async () => {
	if (!database) return;
	await database.unsafe(
		'DROP SCHEMA IF EXISTS "collaboration" CASCADE; DROP SCHEMA IF EXISTS "lock_probe" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE;',
	);
});

afterAll(async () => {
	await database?.close();
});

describe.skipIf(!database)("BETA-02 PostgreSQL migration lifecycle", () => {
	test("bounds application advisory-lock waits before schema SQL", async () => {
		const compilation = await compileApplication({
			applicationRoot: fixtureRoot,
		});
		const fixtureSchema = JSON.parse(
			compilation.generatedFiles["schema-projection.json"] ?? "null",
		);
		const targetSchema = {
			...fixtureSchema,
			application: {
				...fixtureSchema.application,
				name: "lock-probe",
				postgresSchema: "lock_probe",
			},
		};
		const planned = createMigrationPlan({
			targetSchema,
			slug: "create-lock-probe",
		});
		const migration = createCommittedMigration({
			plan: planned.plan,
			baseSchema: planned.baseSchema,
			targetSchema,
			currentSchema: targetSchema,
			planDigest: planned.digest,
		});
		const holder = await database!.reserve();
		const [current] = await holder<{ name: string }[]>`
			select current_database() as name
		`;
		const applicationKey = lockKey(
			"questpie-application-lock-v1",
			current!.name,
			"lock-probe",
		);
		await holder`select pg_catalog.pg_advisory_lock(${applicationKey})`;
		const started = performance.now();
		try {
			let lockError: unknown;
			try {
				await applyCommittedMigrations({
					migrations: [migration],
					lockTimeoutMs: 50,
					statementTimeoutMs: 500,
				});
			} catch (error) {
				lockError = error;
			}
			expect(lockError).toBeInstanceOf(SQL.PostgresError);
			expect((lockError as SQL.PostgresError).code).toBe(
				"ERR_POSTGRES_SERVER_ERROR",
			);
			expect((lockError as SQL.PostgresError).errno).toBe("55P03");
			expect(performance.now() - started).toBeLessThan(3_000);
			const [state] = await database!<
				{ schemaExists: boolean; receipts: number }[]
			>`
				select
				  exists(select 1 from pg_catalog.pg_namespace where nspname = 'lock_probe') as "schemaExists",
				  (select count(*)::integer from questpie_internal.schema_migration_receipts where application_name = 'lock-probe') as receipts
			`;
			expect(state).toEqual({ schemaExists: false, receipts: 0 });

			const controller = new AbortController();
			setTimeout(() => controller.abort(), 50);
			const abortStarted = performance.now();
			let abortError: unknown;
			try {
				await applyCommittedMigrations({
					migrations: [migration],
					lockTimeoutMs: 5_000,
					statementTimeoutMs: 30_000,
					signal: controller.signal,
				});
			} catch (error) {
				abortError = error;
			}
			expect(abortError).toBeInstanceOf(DOMException);
			expect((abortError as DOMException).name).toBe("AbortError");
			expect(performance.now() - abortStarted).toBeLessThan(3_000);
			const [afterAbort] = await database!<
				{ schemaExists: boolean; receipts: number }[]
			>`
				select
				  exists(select 1 from pg_catalog.pg_namespace where nspname = 'lock_probe') as "schemaExists",
				  (select count(*)::integer from questpie_internal.schema_migration_receipts where application_name = 'lock-probe') as receipts
			`;
			expect(afterAbort).toEqual({ schemaExists: false, receipts: 0 });
		} finally {
			await holder`select pg_catalog.pg_advisory_unlock(${applicationKey})`;
			holder.release();
		}

		const retry = await applyCommittedMigrations({
			migrations: [migration],
			lockTimeoutMs: 500,
			statementTimeoutMs: 5_000,
		});
		expect(retry.status).toBe("applied");
	});

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
		const [preflightBefore] = await database!<
			{ protocolSchemaExists: boolean }[]
		>`
			select exists(
				select 1 from pg_catalog.pg_namespace where nspname = 'questpie_internal'
			) as "protocolSchemaExists"
		`;
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
			protocolSchemaExists: preflightBefore!.protocolSchemaExists,
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

		const firstApplyStarted = performance.now();
		const concurrent = await Promise.all([
			applyCommittedMigrations({ migrations: [migration] }),
			applyCommittedMigrations({ migrations: [migration] }),
		]);
		const firstApplyMs = performance.now() - firstApplyStarted;
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
		const restartStarted = performance.now();
		const restarted = await applyCommittedMigrations({
			migrations: [migration],
		});
		const restartMs = performance.now() - restartStarted;
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

		const interruptedSeed = createCommittedSeed({
			definition: {
				name: "collaboration.interrupted.v1",
				dependsOn: ["collaboration.demo.v1"],
				steps: [
					{
						kind: "update",
						collection: "collection:companies",
						key: { id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0" },
						values: { name: "recovered value" },
					},
				],
			},
			schema: targetSchema,
		});
		const abandonedAttempt = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61ff";
		await database!`
			insert into questpie_internal.seed_attempt_events
			(application_name, attempt_id, sequence, seed_identity, checksum, event, occurred_at, error_code)
			values ('collaboration', ${abandonedAttempt}, 0, ${interruptedSeed.identity}, ${interruptedSeed.checksum}, 'started', ${new Date("2026-08-14T12:00:00.000Z")}, null)
		`;
		await applyCommittedSeeds({
			schema: targetSchema,
			seeds: [committedSeed, interruptedSeed],
		});
		const [interruption] = await database!<{ count: number }[]>`
			select count(*)::integer as count
			from questpie_internal.seed_attempt_events
			where attempt_id = ${abandonedAttempt} and event = 'interrupted'
		`;
		expect(interruption?.count).toBe(1);

		const blockedSeed = createCommittedSeed({
			definition: {
				name: "collaboration.blocked.v1",
				dependsOn: ["collaboration.demo.v1"],
				steps: [
					{
						kind: "update",
						collection: "collection:companies",
						key: { id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0" },
						values: { name: "must not write" },
					},
				],
			},
			schema: targetSchema,
		});
		await database!.unsafe(
			"CREATE FUNCTION collaboration.seed_drift() RETURNS integer LANGUAGE sql AS 'SELECT 1'",
		);
		await expect(
			applyCommittedSeeds({
				schema: targetSchema,
				seeds: [committedSeed, blockedSeed],
			}),
		).rejects.toMatchObject({ code: "QP-SEED-014" });
		const [blockedAttempt] = await database!<
			{ event: string; errorCode: string }[]
		>`
			select event, error_code as "errorCode"
			from questpie_internal.seed_attempt_events
			where seed_identity = ${blockedSeed.identity}
			order by occurred_at desc limit 1
		`;
		expect(blockedAttempt).toEqual({
			event: "blocked",
			errorCode: "QP-SEED-014",
		});
		await database!.unsafe("DROP FUNCTION collaboration.seed_drift()");

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
		console.log(
			JSON.stringify({
				scenario: "beta02-postgres-local",
				postgres: "17",
				measurements: { firstApplyMs, restartMs },
				status: "PASS",
			}),
		);
	});
});
