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
		'DROP SCHEMA IF EXISTS "collaboration" CASCADE; DROP SCHEMA IF EXISTS "lock_probe" CASCADE; DROP SCHEMA IF EXISTS "semantic_rename_probe" CASCADE; DROP SCHEMA IF EXISTS "order" CASCADE; DROP SCHEMA IF EXISTS "deploy_role_probe" CASCADE; DROP SCHEMA IF EXISTS "fk_actions_probe" CASCADE; DROP SCHEMA IF EXISTS "foundational_fields_probe" CASCADE; DROP SCHEMA IF EXISTS "numeric_drift_probe" CASCADE; DROP SCHEMA IF EXISTS "seed_probe" CASCADE; DROP SCHEMA IF EXISTS "seed_checksum_probe" CASCADE; DROP SCHEMA IF EXISTS "seed_concurrency_probe" CASCADE; DROP SCHEMA IF EXISTS "seed_cancel_probe" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE;',
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
			localMigrations: [],
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

		const evolvedSchema = structuredClone(targetSchema);
		const messages = evolvedSchema.collections.find(
			(collection: { identity: string }) =>
				collection.identity === "collection:messages",
		);
		if (!messages) throw new Error("lock probe Messages schema is missing");
		messages.fields.push({
			collation: "questpie.binary",
			default: null,
			identity: "collection:messages/field:cancellationProbe",
			nullable: true,
			path: ["cancellationProbe"],
			postgresName: "cancellation_probe",
			type: {
				collation: "questpie.binary",
				kind: "text",
				maxLength: null,
				minLength: null,
			},
		});
		messages.fields.sort(
			(left: { identity: string }, right: { identity: string }) =>
				left.identity.localeCompare(right.identity),
		);
		const evolvedPlan = createMigrationPlan({
			baseMigration: migration.identity,
			baseSchema: targetSchema,
			slug: "add-cancellation-probe",
			targetSchema: evolvedSchema,
		});
		const evolvedMigration = createCommittedMigration({
			currentSchema: evolvedSchema,
			plan: evolvedPlan.plan,
			baseSchema: evolvedPlan.baseSchema,
			planDigest: evolvedPlan.digest,
			localMigrations: [migration],
			targetSchema: evolvedSchema,
		});
		const tableHolder = await database!.reserve();
		const [tableHolderBackend] = await tableHolder<{ pid: number }[]>`
			select pg_catalog.pg_backend_pid() as pid
		`;
		await tableHolder.unsafe("BEGIN");
		await tableHolder.unsafe(
			'LOCK TABLE "lock_probe"."messages" IN ACCESS SHARE MODE',
		);
		const ddlController = new AbortController();
		try {
			const applying = applyCommittedMigrations({
				migrations: [migration, evolvedMigration],
				lockTimeoutMs: 5_000,
				statementTimeoutMs: 30_000,
				signal: ddlController.signal,
			}).then(
				(value) => ({ value, error: undefined }),
				(error: unknown) => ({ value: undefined, error }),
			);
			let blockedQuery: string | undefined;
			for (let attempt = 0; attempt < 300; attempt += 1) {
				const [waiting] = await database!<{ query: string }[]>`
					select query
					from pg_catalog.pg_stat_activity
					where wait_event_type = 'Lock'
					  and pid <> pg_catalog.pg_backend_pid()
					  and pid <> ${tableHolderBackend!.pid}
					order by pid
					limit 1
				`;
				if (waiting) {
					blockedQuery = waiting.query;
					break;
				}
				await Bun.sleep(10);
			}
			expect(blockedQuery).toContain("cancellation_probe");
			ddlController.abort();
			const { error: ddlError } = await applying;
			expect(ddlError).toBeInstanceOf(SQL.PostgresError);
			expect((ddlError as SQL.PostgresError).errno).toBe("57014");
			expect((ddlError as Error).message).toContain("user request");
			const [rolledBack] = await database!<
				{ fieldExists: boolean; receipts: number }[]
			>`
				select
				  exists(
				    select 1 from pg_catalog.pg_attribute
				    where attrelid = 'lock_probe.messages'::regclass
				      and attname = 'cancellation_probe' and not attisdropped
				  ) as "fieldExists",
				  (select count(*)::integer from questpie_internal.schema_migration_receipts where application_name = 'lock-probe') as receipts
			`;
			expect(rolledBack).toEqual({ fieldExists: false, receipts: 1 });
		} finally {
			await tableHolder.unsafe("ROLLBACK");
			tableHolder.release();
		}
		const ddlRetry = await applyCommittedMigrations({
			migrations: [migration, evolvedMigration],
		});
		expect(ddlRetry).toMatchObject({
			status: "applied",
			applied: ["000002_add-cancellation-probe"],
		});
	}, 10_000);

	test("allows an authorized non-owner deploy role to verify an applied migration", async () => {
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
				name: "deploy-role-probe",
				postgresSchema: "deploy_role_probe",
			},
		};
		const planned = createMigrationPlan({
			targetSchema,
			slug: "create-deploy-role-probe",
		});
		const migration = createCommittedMigration({
			plan: planned.plan,
			baseSchema: planned.baseSchema,
			targetSchema,
			currentSchema: targetSchema,
			planDigest: planned.digest,
			localMigrations: [],
		});
		await applyCommittedMigrations({ migrations: [migration] });
		const role = "questpie_beta02_deployer";
		try {
			await database!.unsafe(`CREATE ROLE ${role} LOGIN`);
			await database!.unsafe(
				`GRANT USAGE ON SCHEMA questpie_internal, deploy_role_probe TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA questpie_internal TO ${role}`,
			);
			const connectionString = `postgres://${role}@${process.env.PGHOST}:${process.env.PGPORT ?? "5432"}/${process.env.PGDATABASE}`;
			const result = await applyCommittedMigrations({
				connectionString,
				migrations: [migration],
			});
			expect(result).toMatchObject({
				status: "alreadyApplied",
				applied: [],
			});
		} finally {
			await database!.unsafe(
				`DROP OWNED BY ${role}; DROP ROLE IF EXISTS ${role}`,
			);
		}
	}, 10_000);

	test("matches PostgreSQL noAction and setNull foreign-key actions", async () => {
		const compilation = await compileApplication({
			applicationRoot: fixtureRoot,
		});
		const targetSchema = JSON.parse(
			compilation.generatedFiles["schema-projection.json"] ?? "null",
		);
		targetSchema.application = {
			name: "fk-actions-probe",
			postgresSchema: "fk_actions_probe",
		};
		const messages = targetSchema.collections.find(
			(collection: { identity: string }) =>
				collection.identity === "collection:messages",
		);
		const authorId = messages.fields.find(
			(field: { identity: string }) =>
				field.identity === "collection:messages/field:authorMembershipId",
		);
		const author = messages.relations.find(
			(relation: { identity: string }) =>
				relation.identity === "collection:messages/relation:author",
		);
		authorId.nullable = true;
		author.onUpdate = "noAction";
		author.onDelete = "setNull";

		const planned = createMigrationPlan({
			targetSchema,
			slug: "create-fk-actions-probe",
		});
		const migration = createCommittedMigration({
			plan: planned.plan,
			baseSchema: planned.baseSchema,
			targetSchema,
			currentSchema: targetSchema,
			planDigest: planned.digest,
			localMigrations: [],
		});

		await expect(
			applyCommittedMigrations({ migrations: [migration] }),
		).resolves.toMatchObject({ status: "applied" });
		const [actions] = await database!<{ onDelete: string; onUpdate: string }[]>`
			select con.confdeltype::text as "onDelete", con.confupdtype::text as "onUpdate"
			from pg_catalog.pg_constraint con
			join pg_catalog.pg_class rel on rel.oid = con.conrelid
			join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace
			where ns.nspname = 'fk_actions_probe'
			  and con.conname = 'qp_fk_messages_author'
		`;
		expect(actions).toEqual({ onDelete: "n", onUpdate: "a" });
		await expect(
			inspectSchemaFingerprint({ schema: targetSchema }),
		).resolves.toBeDefined();
	}, 10_000);

	test("stores and fingerprints every foundational Field family", async () => {
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
				name: "foundational-fields-probe",
				postgresSchema: "foundational_fields_probe",
			},
			collections: [
				{
					identity: "collection:measurements",
					postgresName: "measurements",
					fields: [
						{
							identity: "collection:measurements/field:active",
							path: ["active"],
							postgresName: "active",
							type: { kind: "boolean" },
							nullable: false,
							default: { kind: "literal", value: true },
							collation: null,
						},
						{
							identity: "collection:measurements/field:amount",
							path: ["amount"],
							postgresName: "amount",
							type: { kind: "numeric", precision: 12, scale: 4 },
							nullable: false,
							default: null,
							collation: null,
						},
						{
							identity: "collection:measurements/field:day",
							path: ["day"],
							postgresName: "day",
							type: { kind: "date" },
							nullable: true,
							default: null,
							collation: null,
						},
						{
							identity: "collection:measurements/field:id",
							path: ["id"],
							postgresName: "id",
							type: { kind: "bigint", minimum: null, maximum: null },
							nullable: false,
							default: null,
							collation: null,
						},
						{
							identity: "collection:measurements/field:label",
							path: ["label"],
							postgresName: "label",
							type: {
								kind: "text",
								minLength: null,
								maxLength: null,
								collation: "questpie.binary",
							},
							nullable: false,
							default: { kind: "literal", value: "now" },
							collation: "questpie.binary",
						},
						...(["metadata", "preferences", "tags"] as const).map((name) => ({
							identity: `collection:measurements/field:${name}`,
							path: [name],
							postgresName: name,
							type: {
								kind:
									name === "tags"
										? "array"
										: name === "preferences"
											? "object"
											: "json",
							},
							nullable: true,
							default: null,
							collation: null,
						})),
					],
					constraints: [
						{
							kind: "primaryKey",
							identity: "collection:measurements/constraint:primary",
							postgresName: "qp_pk_measurements_primary",
							fields: ["collection:measurements/field:id"],
						},
					],
					indexes: [],
					relations: [],
				},
			],
		};
		const planned = createMigrationPlan({
			targetSchema,
			slug: "create-foundational-fields-probe",
		});
		const migration = createCommittedMigration({
			plan: planned.plan,
			baseSchema: planned.baseSchema,
			targetSchema,
			currentSchema: targetSchema,
			planDigest: planned.digest,
			localMigrations: [],
		});
		expect(
			await applyCommittedMigrations({ migrations: [migration] }),
		).toMatchObject({
			status: "applied",
		});
		await expect(
			inspectSchemaFingerprint({ schema: targetSchema }),
		).resolves.toBeDefined();
		await database!.unsafe(`
			INSERT INTO foundational_fields_probe.measurements
			  (id, amount, day, metadata, preferences, tags)
			VALUES
			  (9223372036854775807, 12345678.9000, DATE '2026-08-15', 'null'::jsonb, '{"locale":"sk"}'::jsonb, '["owner"]'::jsonb)
		`);
		const [row] = await database!<
			{
				active: boolean;
				amount: string;
				day: string;
				id: string;
				label: string;
				metadata: unknown;
				preferences: unknown;
				tags: unknown;
			}[]
		>`select id::text as id, amount::text as amount, day::text as day, active, label, metadata, preferences, tags from foundational_fields_probe.measurements`;
		expect(row).toEqual({
			active: true,
			amount: "12345678.9000",
			day: "2026-08-15",
			id: "9223372036854775807",
			label: "now",
			metadata: null,
			preferences: { locale: "sk" },
			tags: ["owner"],
		});
	}, 10_000);

	test("detects numeric typmod drift from the live catalog", async () => {
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
				name: "numeric-drift-probe",
				postgresSchema: "numeric_drift_probe",
			},
		};
		const messages = targetSchema.collections.find(
			(collection: { identity: string }) =>
				collection.identity === "collection:messages",
		);
		messages.fields.push({
			collation: null,
			default: null,
			identity: "collection:messages/field:amount",
			nullable: true,
			path: ["amount"],
			postgresName: "amount",
			type: { kind: "numeric", precision: 10, scale: 2 },
		});
		messages.fields.sort(
			(left: { identity: string }, right: { identity: string }) =>
				left.identity.localeCompare(right.identity),
		);
		const planned = createMigrationPlan({
			targetSchema,
			slug: "create-numeric-drift-probe",
		});
		const migration = createCommittedMigration({
			plan: planned.plan,
			baseSchema: planned.baseSchema,
			targetSchema,
			currentSchema: targetSchema,
			planDigest: planned.digest,
			localMigrations: [],
		});
		await applyCommittedMigrations({ migrations: [migration] });
		await expect(
			inspectSchemaFingerprint({ schema: targetSchema }),
		).resolves.toBeDefined();
		await database!.unsafe(
			"ALTER TABLE numeric_drift_probe.messages ALTER COLUMN amount TYPE numeric(12,3)",
		);
		await expect(
			inspectSchemaFingerprint({ schema: targetSchema }),
		).rejects.toMatchObject({ code: "QP-SCHEMA-028" });
	}, 10_000);

	test("rolls back Seed writes and receipt when a later step fails", async () => {
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
				name: "seed-probe",
				postgresSchema: "seed_probe",
			},
		};
		const planned = createMigrationPlan({
			targetSchema,
			slug: "create-seed-probe",
		});
		const migration = createCommittedMigration({
			plan: planned.plan,
			baseSchema: planned.baseSchema,
			targetSchema,
			currentSchema: targetSchema,
			planDigest: planned.digest,
			localMigrations: [],
		});
		await applyCommittedMigrations({ migrations: [migration] });
		const failingSeed = createCommittedSeed({
			definition: {
				name: "seed-probe.rollback.v1",
				steps: [
					{
						kind: "insert",
						collection: "collection:companies",
						values: {
							id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6170",
							name: "must roll back",
						},
					},
					{
						kind: "update",
						collection: "collection:companies",
						key: { id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6171" },
						values: { name: "missing" },
					},
				],
			},
			schema: targetSchema,
		});

		for (let attempt = 1; attempt <= 2; attempt += 1) {
			await expect(
				applyCommittedSeeds({
					schema: targetSchema,
					seeds: [failingSeed],
				}),
			).rejects.toMatchObject({ code: "QP-SEED-012" });
			const [state] = await database!<
				{
					companies: number;
					failed: number;
					receipts: number;
					started: number;
					succeeded: number;
				}[]
			>`
				select
				  (select count(*)::integer from seed_probe.companies) as companies,
				  (select count(*)::integer from questpie_internal.seed_receipts where application_name = 'seed-probe') as receipts,
				  (select count(*)::integer from questpie_internal.seed_attempt_events where application_name = 'seed-probe' and event = 'started') as started,
				  (select count(*)::integer from questpie_internal.seed_attempt_events where application_name = 'seed-probe' and event = 'failed') as failed,
				  (select count(*)::integer from questpie_internal.seed_attempt_events where application_name = 'seed-probe' and event = 'succeeded') as succeeded
			`;
			expect(state).toEqual({
				companies: 0,
				failed: attempt,
				receipts: 0,
				started: attempt,
				succeeded: 0,
			});
		}
	}, 10_000);

	test("records a blocked attempt for an applied Seed checksum mismatch", async () => {
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
				name: "seed-checksum-probe",
				postgresSchema: "seed_checksum_probe",
			},
		};
		const planned = createMigrationPlan({
			targetSchema,
			slug: "create-seed-checksum-probe",
		});
		const migration = createCommittedMigration({
			plan: planned.plan,
			baseSchema: planned.baseSchema,
			targetSchema,
			currentSchema: targetSchema,
			planDigest: planned.digest,
			localMigrations: [],
		});
		await applyCommittedMigrations({ migrations: [migration] });
		const definition = (name: string) => ({
			name: "seed-checksum-probe.demo.v1",
			steps: [
				{
					kind: "insert" as const,
					collection: "collection:companies",
					values: {
						id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6170",
						name,
					},
				},
			],
		});
		const accepted = createCommittedSeed({
			definition: definition("accepted"),
			schema: targetSchema,
		});
		const changed = createCommittedSeed({
			definition: definition("changed"),
			schema: targetSchema,
		});
		await applyCommittedSeeds({ schema: targetSchema, seeds: [accepted] });
		await expect(
			applyCommittedSeeds({ schema: targetSchema, seeds: [changed] }),
		).rejects.toMatchObject({ code: "QP-SEED-004" });
		const [state] = await database!<
			{
				blocked: number;
				companies: number;
				receiptChecksum: string;
			}[]
		>`
			select
			  (select count(*)::integer from seed_checksum_probe.companies where name = 'accepted') as companies,
			  (select checksum from questpie_internal.seed_receipts where application_name = 'seed-checksum-probe' and seed_identity = ${accepted.identity}) as "receiptChecksum",
			  (select count(*)::integer from questpie_internal.seed_attempt_events where application_name = 'seed-checksum-probe' and seed_identity = ${changed.identity} and checksum = ${changed.checksum} and event = 'blocked' and sequence = 0 and error_code = 'QP-SEED-004') as blocked
		`;
		expect(state).toEqual({
			blocked: 1,
			companies: 1,
			receiptChecksum: accepted.checksum,
		});
	}, 10_000);

	test("serializes concurrent application of one Seed", async () => {
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
				name: "seed-concurrency-probe",
				postgresSchema: "seed_concurrency_probe",
			},
		};
		const planned = createMigrationPlan({
			targetSchema,
			slug: "create-seed-concurrency-probe",
		});
		const migration = createCommittedMigration({
			plan: planned.plan,
			baseSchema: planned.baseSchema,
			targetSchema,
			currentSchema: targetSchema,
			planDigest: planned.digest,
			localMigrations: [],
		});
		await applyCommittedMigrations({ migrations: [migration] });
		const seed = createCommittedSeed({
			definition: {
				name: "seed-concurrency-probe.demo.v1",
				steps: [
					{
						kind: "insert",
						collection: "collection:companies",
						values: {
							id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6170",
							name: "once",
						},
					},
				],
			},
			schema: targetSchema,
		});
		const results = await Promise.all([
			applyCommittedSeeds({ schema: targetSchema, seeds: [seed] }),
			applyCommittedSeeds({ schema: targetSchema, seeds: [seed] }),
		]);
		expect(
			results
				.map((result) =>
					result.applied.length === 1 ? "applied" : "alreadyApplied",
				)
				.sort(),
		).toEqual(["alreadyApplied", "applied"]);
		const [state] = await database!<
			{
				alreadyApplied: number;
				companies: number;
				receipts: number;
				started: number;
				succeeded: number;
			}[]
		>`
			select
			  (select count(*)::integer from seed_concurrency_probe.companies) as companies,
			  (select count(*)::integer from questpie_internal.seed_receipts where application_name = 'seed-concurrency-probe') as receipts,
			  (select count(*)::integer from questpie_internal.seed_attempt_events where application_name = 'seed-concurrency-probe' and event = 'started') as started,
			  (select count(*)::integer from questpie_internal.seed_attempt_events where application_name = 'seed-concurrency-probe' and event = 'succeeded') as succeeded,
			  (select count(*)::integer from questpie_internal.seed_attempt_events where application_name = 'seed-concurrency-probe' and event = 'alreadyApplied') as "alreadyApplied"
		`;
		expect(state).toEqual({
			alreadyApplied: 1,
			companies: 1,
			receipts: 1,
			started: 1,
			succeeded: 1,
		});
	}, 10_000);

	test("cancels a blocked Seed statement and rolls back prior steps", async () => {
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
				name: "seed-cancel-probe",
				postgresSchema: "seed_cancel_probe",
			},
		};
		const planned = createMigrationPlan({
			targetSchema,
			slug: "create-seed-cancel-probe",
		});
		const migration = createCommittedMigration({
			plan: planned.plan,
			baseSchema: planned.baseSchema,
			targetSchema,
			currentSchema: targetSchema,
			planDigest: planned.digest,
			localMigrations: [],
		});
		await applyCommittedMigrations({ migrations: [migration] });
		const lockedId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6170";
		const insertedId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6171";
		await database!`
			insert into seed_cancel_probe.companies (id, name)
			values (${lockedId}, 'locked')
		`;
		const holder = await database!.reserve();
		await holder.unsafe("BEGIN");
		await holder`
			select 1 from seed_cancel_probe.companies
			where id = ${lockedId} for update
		`;
		const seed = createCommittedSeed({
			definition: {
				name: "seed-cancel-probe.demo.v1",
				steps: [
					{
						kind: "insert",
						collection: "collection:companies",
						values: { id: insertedId, name: "must roll back" },
					},
					{
						kind: "update",
						collection: "collection:companies",
						key: { id: lockedId },
						values: { name: "updated" },
					},
				],
			},
			schema: targetSchema,
		});
		const controller = new AbortController();
		const outcome = applyCommittedSeeds({
			schema: targetSchema,
			seeds: [seed],
			signal: controller.signal,
		}).catch((error: unknown) => error);
		const deadline = performance.now() + 3_000;
		let waiting = false;
		while (!waiting && performance.now() < deadline) {
			const [activity] = await database!<{ waiting: boolean }[]>`
				select exists(
				  select 1 from pg_catalog.pg_stat_activity
				  where query like 'UPDATE "seed_cancel_probe"."companies"%'
				    and wait_event_type = 'Lock'
				) as waiting
			`;
			waiting = activity?.waiting ?? false;
			if (!waiting) await Bun.sleep(10);
		}
		expect(waiting).toBe(true);
		controller.abort(new Error("cancel Seed probe"));
		const error = await outcome;
		expect(error).toBeInstanceOf(Error);
		await holder.unsafe("ROLLBACK");
		holder.release();
		const [rolledBack] = await database!<
			{ failed: number; inserted: number; receipts: number; started: number }[]
		>`
			select
			  (select count(*)::integer from seed_cancel_probe.companies where id = ${insertedId}) as inserted,
			  (select count(*)::integer from questpie_internal.seed_receipts where application_name = 'seed-cancel-probe') as receipts,
			  (select count(*)::integer from questpie_internal.seed_attempt_events where application_name = 'seed-cancel-probe' and event = 'started') as started,
			  (select count(*)::integer from questpie_internal.seed_attempt_events where application_name = 'seed-cancel-probe' and event = 'failed') as failed
		`;
		expect(rolledBack).toEqual({
			failed: 1,
			inserted: 0,
			receipts: 0,
			started: 1,
		});
		await applyCommittedSeeds({ schema: targetSchema, seeds: [seed] });
		const [retried] = await database!<
			{ inserted: number; receipts: number; succeeded: number }[]
		>`
			select
			  (select count(*)::integer from seed_cancel_probe.companies where id = ${insertedId}) as inserted,
			  (select count(*)::integer from questpie_internal.seed_receipts where application_name = 'seed-cancel-probe') as receipts,
			  (select count(*)::integer from questpie_internal.seed_attempt_events where application_name = 'seed-cancel-probe' and event = 'succeeded') as succeeded
		`;
		expect(retried).toEqual({ inserted: 1, receipts: 1, succeeded: 1 });
	}, 10_000);

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
			localMigrations: [],
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
			localMigrations: [],
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
			  (select count(*)::integer from questpie_internal.seed_receipts where application_name = 'collaboration') as receipts,
			  (select count(*)::integer from questpie_internal.seed_attempt_events where application_name = 'collaboration' and event = 'succeeded') as succeeded
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
			localMigrations: [],
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

	test("receipts a semantic rename with stable physical names and no DDL", async () => {
		const compilation = await compileApplication({
			applicationRoot: fixtureRoot,
		});
		const fixtureSchema = JSON.parse(
			compilation.generatedFiles["schema-projection.json"] ?? "null",
		);
		const baseSchema = {
			...fixtureSchema,
			application: {
				...fixtureSchema.application,
				name: "semantic-rename-probe",
				postgresSchema: "semantic_rename_probe",
			},
		};
		const genesisPlan = createMigrationPlan({
			targetSchema: baseSchema,
			slug: "create-semantic-rename-probe",
		});
		const genesis = createCommittedMigration({
			plan: genesisPlan.plan,
			baseSchema: genesisPlan.baseSchema,
			targetSchema: baseSchema,
			currentSchema: baseSchema,
			planDigest: genesisPlan.digest,
			localMigrations: [],
		});
		const targetSchema = JSON.parse(
			JSON.stringify(baseSchema).replaceAll(
				"collection:companies",
				"collection:organizations",
			),
		);
		const renamePlan = createMigrationPlan({
			baseMigration: genesis.identity,
			baseSchema,
			targetSchema,
			slug: "rename-companies-semantically",
			renames: [
				{
					from: "collection:companies",
					to: "collection:organizations",
				},
			],
		});
		if (renamePlan.status !== "planned")
			throw new Error("semantic rename plan disappeared");
		const rename = createCommittedMigration({
			plan: renamePlan.plan,
			baseSchema,
			targetSchema,
			currentSchema: targetSchema,
			planDigest: renamePlan.digest,
			localMigrations: [genesis],
			acceptDestructive: renamePlan.digest,
		});
		expect(rename.files["up.sql"]).toBe("");

		const applied = await applyCommittedMigrations({
			migrations: [genesis, rename],
		});
		expect(applied).toMatchObject({
			status: "applied",
			applied: [genesis.identity, rename.identity],
			head: rename.identity,
		});
		const [receipt] = await database!<{ receipts: number }[]>`
			select count(*)::integer as receipts
			from questpie_internal.schema_migration_receipts
			where application_name = 'semantic-rename-probe'
		`;
		expect(receipt).toEqual({ receipts: 2 });
		await expect(
			applyCommittedMigrations({ migrations: [genesis, rename] }),
		).resolves.toMatchObject({ status: "alreadyApplied", applied: [] });
	});

	test("quotes PostgreSQL keywords through apply, fingerprint, and restart", async () => {
		const compilation = await compileApplication({
			applicationRoot: fixtureRoot,
		});
		const targetSchema = JSON.parse(
			compilation.generatedFiles["schema-projection.json"] ?? "null",
		);
		targetSchema.application = {
			...targetSchema.application,
			name: "keyword-probe",
			postgresSchema: "order",
		};
		const companies = targetSchema.collections.find(
			(collection: { identity: string }) =>
				collection.identity === "collection:companies",
		);
		if (!companies)
			throw new Error("keyword probe Companies schema is missing");
		companies.postgresName = "group";
		const id = companies.fields.find(
			(field: { identity: string }) =>
				field.identity === "collection:companies/field:id",
		);
		const name = companies.fields.find(
			(field: { identity: string }) =>
				field.identity === "collection:companies/field:name",
		);
		if (!id || !name)
			throw new Error("keyword probe Companies Fields are missing");
		id.postgresName = "user";
		name.postgresName = "from";
		companies.indexes = [
			{
				fields: [
					{
						collation: "questpie.binary",
						field: "collection:companies/field:name",
						nulls: "last",
						operatorClass: "typeDefault",
						order: "asc",
					},
				],
				identity: "collection:companies/index:byName",
				kind: "btree",
				postgresName: "limit",
				unique: false,
			},
		];
		const planned = createMigrationPlan({
			targetSchema,
			slug: "create-keyword-probe",
		});
		const migration = createCommittedMigration({
			plan: planned.plan,
			baseSchema: planned.baseSchema,
			targetSchema,
			currentSchema: targetSchema,
			planDigest: planned.digest,
			localMigrations: [],
		});
		expect(migration.files["up.sql"]).toContain('CREATE TABLE "order"."group"');
		expect(migration.files["up.sql"]).toContain('"user" pg_catalog.uuid');
		expect(migration.files["up.sql"]).toContain(
			'CREATE INDEX "limit" ON "order"."group"',
		);

		await expect(
			applyCommittedMigrations({ migrations: [migration] }),
		).resolves.toMatchObject({
			status: "applied",
			applied: [migration.identity],
		});
		const fingerprint = await inspectSchemaFingerprint({
			schema: targetSchema,
		});
		expect(fingerprint.fingerprint.comparable.applicationSchema).toBe("order");
		await expect(
			applyCommittedMigrations({ migrations: [migration] }),
		).resolves.toMatchObject({ status: "alreadyApplied", applied: [] });
	});
});
