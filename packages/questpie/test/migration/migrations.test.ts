import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { bigserial, index, jsonb, pgTable, text } from "drizzle-orm/pg-core";

import { createApp, module } from "../../src/exports/index.js";
import { collection } from "../../src/exports/index.js";
import { systemTimestamp } from "../../src/server/db/system-columns.js";
import { MigrationRunner } from "../../src/server/migration/runner.js";
import type {
	Migration,
	OperationSnapshot,
} from "../../src/server/migration/types.js";
import { questpieRealtimeLogTable } from "../../src/server/modules/core/integrated/realtime/collection.js";
import { createPostgresSearchAdapter } from "../../src/server/modules/core/integrated/search/adapters/postgres.js";
import { MockKVAdapter } from "../utils/mocks/kv.adapter";
import { MockLogger } from "../utils/mocks/logger.adapter";
import { MockMailAdapter } from "../utils/mocks/mailer.adapter";
import { MockQueueAdapter } from "../utils/mocks/queue.adapter";
import {
	createTestDb,
	testMigrationDir as baseTestMigrationDir,
} from "../utils/test-db";

const testMigrationDir = join(baseTestMigrationDir, "migrations");

describe("Migration System - Programmatic", () => {
	let app: any;
	let pgClient: PGlite;

	beforeAll(async () => {
		// Create in-memory PGlite instance
		pgClient = await createTestDb();

		// Define test collections using standalone collection()
		const posts = collection("posts").fields(({ f }) => ({
			title: f.text(255).required(),
			content: f.textarea(),
			published: f.boolean().default(false),
		}));

		// Create app instance using new API
		const def = module({
			name: "test-app",
			collections: { posts },
		});

		app = await createApp(def, {
			app: { url: "http://localhost:3000" },
			db: { pglite: pgClient },
			email: { adapter: new MockMailAdapter() },
			queue: { adapter: new MockQueueAdapter() },
			kv: { adapter: new MockKVAdapter() },
			logger: { adapter: new MockLogger() },
		});
	});

	afterAll(async () => {
		if (pgClient) {
			await pgClient.close();
		}
	});

	test("should run manual migrations up", async () => {
		// Define manual migration
		const createPostsTable: Migration = {
			id: "create_posts_table",
			async up({ db: migDb }) {
				await migDb.execute(
					sql.raw(`
CREATE TABLE posts (
id TEXT PRIMARY KEY,
title VARCHAR(255) NOT NULL,
content TEXT,
published BOOLEAN DEFAULT false
)
`),
				);
			},
			async down({ db: migDb }) {
				await migDb.execute(sql.raw(`DROP TABLE posts`));
			},
		};

		// Add migration to config
		app.config.migrations = {
			migrations: [createPostsTable],
		};

		// Run migration
		await app.migrations.up();

		// Verify table exists
		const tablesResult = await pgClient.query(`
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name = 'posts'
`);

		expect(tablesResult.rows.length).toBe(1);

		// Verify migration was recorded
		const migrationsResult = await pgClient.query(
			"SELECT * FROM questpie_migrations WHERE id = 'create_posts_table'",
		);
		expect(migrationsResult.rows.length).toBe(1);
	});

	test("should show migration status", async () => {
		const status = await app.migrations.status();

		expect(status.executed.length).toBe(1);
		expect(status.executed[0]?.id).toBe("create_posts_table");
		expect(status.pending.length).toBe(0);
		expect(status.currentBatch).toBe(1);
	});

	test("should rollback last batch", async () => {
		await app.migrations.down();

		// Verify table was dropped
		const tablesResult = await pgClient.query(`
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name = 'posts'
`);

		expect(tablesResult.rows.length).toBe(0);

		// Verify migration was removed from history
		const status = await app.migrations.status();
		expect(status.executed.length).toBe(0);
		expect(status.pending.length).toBe(1);
	});

	test("should run migrations fresh (reset + up)", async () => {
		await app.migrations.fresh();

		// Verify table exists again
		const tablesResult = await pgClient.query(`
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name = 'posts'
`);

		expect(tablesResult.rows.length).toBe(1);

		const status = await app.migrations.status();
		expect(status.executed.length).toBe(1);
		expect(status.currentBatch).toBe(1);
	});

	test("should handle multiple migrations in batches", async () => {
		// Add second migration
		const createCommentsTable: Migration = {
			id: "create_comments_table",
			async up({ db: migDb }) {
				await migDb.execute(
					sql.raw(`
CREATE TABLE comments (
id TEXT PRIMARY KEY,
post_id TEXT NOT NULL,
author VARCHAR(255) NOT NULL,
content TEXT NOT NULL
)
`),
				);
			},
			async down({ db: migDb }) {
				await migDb.execute(sql.raw(`DROP TABLE comments`));
			},
		};

		app.config.migrations?.migrations?.push(createCommentsTable);

		// Run new migration
		await app.migrations.up();

		// Both tables should exist
		const tablesResult = await pgClient.query(`
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('posts', 'comments')
ORDER BY table_name
`);

		expect(tablesResult.rows.length).toBe(2);

		const status = await app.migrations.status();
		expect(status.executed.length).toBe(2);
		expect(status.currentBatch).toBe(2); // Second batch
	});

	test("should rollback specific batch", async () => {
		// Rollback only batch 2 (comments table)
		await app.migrations.down();

		// Posts should still exist, comments should be gone
		const tablesResult = await pgClient.query(`
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('posts', 'comments')
ORDER BY table_name
`);

		expect(tablesResult.rows.length).toBe(1);
		expect((tablesResult.rows[0] as any)?.table_name).toBe("posts");

		const status = await app.migrations.status();
		expect(status.executed.length).toBe(1);
		expect(status.currentBatch).toBe(1);
	});

	test("should reset all migrations", async () => {
		await app.migrations.reset();

		// No tables should exist
		const tablesResult = await pgClient.query(`
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('posts', 'comments')
`);

		expect(tablesResult.rows.length).toBe(0);

		const status = await app.migrations.status();
		expect(status.executed.length).toBe(0);
		expect(status.pending.length).toBe(2);
	});

	test("should run target migration inclusively", async () => {
		const targetDb = await createTestDb();
		const def = module({ name: "target-test" });
		const targetApp = await createApp(def, {
			app: { url: "http://localhost:3000" },
			db: { pglite: targetDb },
			email: { adapter: new MockMailAdapter() },
			queue: { adapter: new MockQueueAdapter() },
			kv: { adapter: new MockKVAdapter() },
			logger: { adapter: new MockLogger() },
		});
		const runner = new MigrationRunner(targetApp.db, { silent: true });
		const ran: string[] = [];

		const migrations: Migration[] = [
			{
				id: "first",
				async up({ db }) {
					ran.push("first");
					await db.execute(
						sql.raw(`CREATE TABLE target_first (id TEXT PRIMARY KEY)`),
					);
				},
				async down({ db }) {
					await db.execute(sql.raw(`DROP TABLE target_first`));
				},
			},
			{
				id: "second",
				async up({ db }) {
					ran.push("second");
					await db.execute(
						sql.raw(`CREATE TABLE target_second (id TEXT PRIMARY KEY)`),
					);
				},
				async down({ db }) {
					await db.execute(sql.raw(`DROP TABLE target_second`));
				},
			},
			{
				id: "third",
				async up({ db }) {
					ran.push("third");
					await db.execute(
						sql.raw(`CREATE TABLE target_third (id TEXT PRIMARY KEY)`),
					);
				},
				async down({ db }) {
					await db.execute(sql.raw(`DROP TABLE target_third`));
				},
			},
		];

		try {
			await runner.runMigrationsUp(migrations, {
				targetMigration: "second",
			});

			expect(ran).toEqual(["first", "second"]);

			const status = await runner.status(migrations);
			expect(status.executed.map((migration) => migration.id)).toEqual([
				"first",
				"second",
			]);
			expect(status.pending.map((migration) => migration.id)).toEqual([
				"third",
			]);
		} finally {
			await targetDb.close();
		}
	});
});

/**
 * Migration Generation Tests
 *
 * Note: Migration generation is now a CLI-only feature via `bun questpie migrate:generate`.
 * These tests verify the DrizzleMigrationGenerator directly for unit testing purposes.
 * For integration testing of the full migration workflow, use the CLI commands.
 *
 * The new migration workflow:
 * 1. Define collections in your app
 * 2. Run `bun questpie migrate:generate` to create migration files
 * 3. Import migrations via `.migrations([...])` in your app builder
 * 4. Run `bun questpie migrate:up` or use `app.migrations.up()` at runtime
 */
describe("Migration System - DrizzleMigrationGenerator", () => {
	let pgClient: PGlite;

	beforeAll(async () => {
		pgClient = await createTestDb();
	});

	beforeEach(() => {
		if (existsSync(testMigrationDir)) {
			rmSync(testMigrationDir, { recursive: true });
		}
		mkdirSync(testMigrationDir, { recursive: true });
	});

	afterAll(async () => {
		if (pgClient) {
			await pgClient.close();
		}
		if (existsSync(testMigrationDir)) {
			rmSync(testMigrationDir, { recursive: true });
		}
	});

	test("should generate migration file from schema", async () => {
		const { DrizzleMigrationGenerator } =
			await import("../../src/server/migration/generator.js");

		const posts = collection("posts").fields(({ f }) => ({
			title: f.text(255).required(),
			content: f.textarea(),
		}));

		const def = module({ name: "test-app", collections: { posts } });
		const app = await createApp(def, {
			app: { url: "http://localhost:3000" },
			db: { pglite: pgClient },
			email: { adapter: new MockMailAdapter() },
			queue: { adapter: new MockQueueAdapter() },
			kv: { adapter: new MockKVAdapter() },
			logger: { adapter: new MockLogger() },
		});

		const generator = new DrizzleMigrationGenerator();

		const result = await generator.generateMigration({
			migrationName: "createPosts20250108",
			fileBaseName: "20250108_create_posts",
			schema: app.getSchema(),
			migrationDir: testMigrationDir,
		});

		expect(result.skipped).toBe(false);
		expect(existsSync(join(testMigrationDir, "20250108_create_posts.ts"))).toBe(
			true,
		);
		expect(
			existsSync(
				join(testMigrationDir, "snapshots", "20250108_create_posts.json"),
			),
		).toBe(true);
	});

	test("generates the framework-owned realtime topology schema", async () => {
		const { DrizzleMigrationGenerator } =
			await import("../../src/server/migration/generator.js");
		const app = await createApp(module({ name: "realtime-topology-schema" }), {
			app: { url: "http://localhost:3000" },
			db: { pglite: pgClient },
			email: { adapter: new MockMailAdapter() },
			queue: { adapter: new MockQueueAdapter() },
			kv: { adapter: new MockKVAdapter() },
			logger: { adapter: new MockLogger() },
		});
		const schema = app.getSchema();
		expect(schema.questpie_realtime_topology).toBeDefined();

		const result = await new DrizzleMigrationGenerator().generateMigration({
			migrationName: "realtimeTopology20250108",
			fileBaseName: "20250108_realtime_topology",
			schema,
			migrationDir: testMigrationDir,
		});

		expect(result.skipped).toBe(false);
		const migrationSource = readFileSync(
			join(testMigrationDir, "20250108_realtime_topology.ts"),
			"utf8",
		);
		for (const fragment of [
			'CREATE TABLE "questpie_realtime_topology"',
			'"session_key" text PRIMARY KEY',
			'"owner_generation" bigserial',
			'"token_hash" text NOT NULL',
			'"identity_hash" text NOT NULL',
			'"lease_expires_at" timestamp with time zone NOT NULL',
			'"desired_revision" bigint DEFAULT 0 NOT NULL',
			'"applied_revision" bigint DEFAULT 0 NOT NULL',
			'"desired_topology" jsonb NOT NULL',
			'CREATE INDEX "idx_realtime_topology_owner_lease"',
			'CREATE INDEX "idx_realtime_topology_lease"',
		]) {
			expect(migrationSource).toContain(fragment);
		}
	});

	test("should skip if no schema changes", async () => {
		const { DrizzleMigrationGenerator } =
			await import("../../src/server/migration/generator.js");

		const posts = collection("posts").fields(({ f }) => ({
			title: f.text(255).required(),
		}));

		const def = module({ name: "test-app", collections: { posts } });
		const app = await createApp(def, {
			app: { url: "http://localhost:3000" },
			db: { pglite: pgClient },
			email: { adapter: new MockMailAdapter() },
			queue: { adapter: new MockQueueAdapter() },
			kv: { adapter: new MockKVAdapter() },
			logger: { adapter: new MockLogger() },
		});

		const generator = new DrizzleMigrationGenerator();

		// First generation
		const result1 = await generator.generateMigration({
			migrationName: "initial20250108",
			fileBaseName: "20250108_initial",
			schema: app.getSchema(),
			migrationDir: testMigrationDir,
		});
		expect(result1.skipped).toBe(false);

		// Second generation with same schema - should skip
		const result2 = await generator.generateMigration({
			migrationName: "noChanges20250108",
			fileBaseName: "20250108_no_changes",
			schema: app.getSchema(),
			migrationDir: testMigrationDir,
		});
		expect(result2.skipped).toBe(true);
	});

	test("generates drops for obsolete realtime outbox indexes", async () => {
		const { DrizzleMigrationGenerator } =
			await import("../../src/server/migration/generator.js");
		const generator = new DrizzleMigrationGenerator();
		const oldRealtimeLogTable = pgTable(
			"questpie_realtime_log",
			{
				seq: bigserial("seq", { mode: "number" }).primaryKey(),
				resourceType: text("resource_type").notNull(),
				resource: text("resource").notNull(),
				operation: text("operation").notNull(),
				recordId: text("record_id"),
				locale: text("locale"),
				payload: jsonb("payload").default({}),
				createdAt: systemTimestamp("created_at").defaultNow().notNull(),
			},
			(table) => [
				index("idx_realtime_log_seq").on(table.seq),
				index("idx_realtime_log_resource").on(
					table.resourceType,
					table.resource,
				),
				index("idx_realtime_log_created_at").on(table.createdAt),
			],
		);

		await generator.generateMigration({
			migrationName: "realtimeIndexesBefore",
			fileBaseName: "20250108_realtime_indexes_before",
			schema: { questpieRealtimeLogTable: oldRealtimeLogTable },
			migrationDir: testMigrationDir,
		});
		const result = await generator.generateMigration({
			migrationName: "dropDeadRealtimeIndexes",
			fileBaseName: "20250109_drop_dead_realtime_indexes",
			schema: { questpieRealtimeLogTable },
			migrationDir: testMigrationDir,
		});

		expect(result.skipped).toBe(false);
		const migrationSource = readFileSync(
			join(testMigrationDir, "20250109_drop_dead_realtime_indexes.ts"),
			"utf8",
		);
		expect(migrationSource).toContain('DROP INDEX "idx_realtime_log_seq"');
		expect(migrationSource).toContain('DROP INDEX "idx_realtime_log_resource"');
		expect(migrationSource).not.toContain(
			'DROP INDEX "idx_realtime_log_created_at"',
		);
	});

	test("does not re-emit a column whose migration is on disk but missing from the in-memory list", async () => {
		// Regression for the stale-list vs on-disk-snapshot divergence: the CLI
		// built the previous snapshot from the in-memory `app.config.migrations`
		// list only. When that codegen-produced list drifts out of sync with the
		// on-disk snapshots (a migration whose `.json` exists but is absent from
		// the list), its ops were silently dropped → the diff re-emitted
		// already-applied DDL (`ADD COLUMN` → "column already exists" on apply).
		const { DrizzleMigrationGenerator } =
			await import("../../src/server/migration/generator.js");
		const generator = new DrizzleMigrationGenerator();

		const makeApp = (def: ReturnType<typeof module>) =>
			createApp(def, {
				app: { url: "http://localhost:3000" },
				db: { pglite: pgClient },
				email: { adapter: new MockMailAdapter() },
				queue: { adapter: new MockQueueAdapter() },
				kv: { adapter: new MockKVAdapter() },
				logger: { adapter: new MockLogger() },
			});

		// #1 — collection with just `title`.
		const appV1 = await makeApp(
			module({
				name: "test-app",
				collections: {
					posts: collection("posts").fields(({ f }) => ({
						title: f.text(255).required(),
					})),
				},
			}),
		);
		const r1 = await generator.generateMigration({
			migrationName: "m1",
			fileBaseName: "20250108_m1",
			schema: appV1.getSchema(),
			migrationDir: testMigrationDir,
		});
		expect(r1.skipped).toBe(false);

		// #2 — add a `status` column (writes snapshot #2 to disk).
		const appV2 = await makeApp(
			module({
				name: "test-app",
				collections: {
					posts: collection("posts").fields(({ f }) => ({
						title: f.text(255).required(),
						status: f.text(50),
					})),
				},
			}),
		);
		const r2 = await generator.generateMigration({
			migrationName: "m2",
			fileBaseName: "20250109_m2",
			schema: appV2.getSchema(),
			migrationDir: testMigrationDir,
		});
		expect(r2.skipped).toBe(false);

		// Simulate STALE codegen: the in-memory list holds only #1, while #2's
		// snapshot `.json` remains on disk.
		const snap1: OperationSnapshot = JSON.parse(
			readFileSync(
				join(testMigrationDir, "snapshots", "20250108_m1.json"),
				"utf8",
			),
		);
		const staleList = [{ id: "20250108_m1", snapshot: snap1 }];

		// BEFORE (bug): previous built from the stale list alone drops #2 →
		// re-emits `ADD COLUMN "status"`.
		const stalePrev = generator.getCumulativeSnapshotFromMigrations(staleList);
		// AFTER (fix): the union also reads #2 from disk → previous already has
		// `status`, computed BEFORE the buggy generate writes anything.
		const unionPrev = await generator.getCumulativeSnapshotUnion(
			testMigrationDir,
			staleList,
		);

		const buggy = await generator.generateMigration({
			migrationName: "m3buggy",
			fileBaseName: "20250110_m3buggy",
			schema: appV2.getSchema(),
			migrationDir: testMigrationDir,
			cumulativeSnapshot: stalePrev,
		});
		expect(buggy.skipped).toBe(false);
		const buggySql = readFileSync(
			join(testMigrationDir, "20250110_m3buggy.ts"),
			"utf8",
		);
		expect(buggySql).toContain('ADD COLUMN "status"');

		const fixed = await generator.generateMigration({
			migrationName: "m4fixed",
			fileBaseName: "20250111_m4fixed",
			schema: appV2.getSchema(),
			migrationDir: testMigrationDir,
			cumulativeSnapshot: unionPrev,
		});
		expect(fixed.skipped).toBe(true);
	});

	test("should NOT auto-create extensions, but still emit dependent indexes", async () => {
		// Drizzle-native: generated migrations no longer prepend CREATE EXTENSION
		// (drizzle generate doesn't emit it, so neither do we). The dependent
		// trigram index is still emitted; the pg_trgm extension is expected to
		// already exist on the DB, provided out-of-band (docker-init / managed).
		const { DrizzleMigrationGenerator } =
			await import("../../src/server/migration/generator.js");

		const adapter = createPostgresSearchAdapter();
		const posts = collection("posts")
			.fields(({ f }) => ({
				title: f.text(255).required(),
				content: f.textarea(),
			}))
			.title(({ f }) => f.title)
			.searchable({ content: (record) => record.content || "" });

		const def = module({
			name: "search-extension-test",
			collections: { posts },
		});
		const app = await createApp(def, {
			app: { url: "http://localhost:3000" },
			db: { pglite: pgClient },
			email: { adapter: new MockMailAdapter() },
			queue: { adapter: new MockQueueAdapter() },
			kv: { adapter: new MockKVAdapter() },
			logger: { adapter: new MockLogger() },
			search: adapter,
		});

		const generator = new DrizzleMigrationGenerator();
		const result = await generator.generateMigration({
			migrationName: "searchExtension20250108",
			fileBaseName: "20250108_search_extension",
			schema: app.getSchema(),
			migrationDir: testMigrationDir,
		});

		expect(result.skipped).toBe(false);

		const contents = readFileSync(
			join(testMigrationDir, "20250108_search_extension.ts"),
			"utf8",
		);
		// No CREATE EXTENSION in the generated migration...
		expect(contents).not.toContain("CREATE EXTENSION");
		// ...but the dependent trigram index is still emitted.
		expect(contents).toContain('CREATE INDEX "idx_search_trigram"');

		// No extensions.<name> op recorded in the snapshot.
		const snapshot = JSON.parse(
			readFileSync(
				join(testMigrationDir, "snapshots", "20250108_search_extension.json"),
				"utf8",
			),
		);
		expect(
			snapshot.operations.some((operation: any) =>
				String(operation.path).startsWith("extensions."),
			),
		).toBe(false);
	});

	test("generated search migration runs on a clean DB that already has the extension", async () => {
		// The framework does not CREATE EXTENSION; the trigram index in the
		// generated migration applies because pg_trgm is provided out-of-band.
		// createTestDb() loads pg_trgm at the PGlite level — the test analog of
		// docker-init / a managed DB shipping the contrib extension.
		const { DrizzleMigrationGenerator } =
			await import("../../src/server/migration/generator.js");

		const cleanDb = await createTestDb();
		const adapter = createPostgresSearchAdapter();
		const posts = collection("posts")
			.fields(({ f }) => ({
				title: f.text(255).required(),
				content: f.textarea(),
			}))
			.title(({ f }) => f.title)
			.searchable({ content: (record) => record.content || "" });

		const def = module({
			name: "search-extension-fresh-test",
			collections: { posts },
		});
		const app = await createApp(def, {
			app: { url: "http://localhost:3000" },
			db: { pglite: cleanDb },
			email: { adapter: new MockMailAdapter() },
			queue: { adapter: new MockQueueAdapter() },
			kv: { adapter: new MockKVAdapter() },
			logger: { adapter: new MockLogger() },
			search: adapter,
		});

		try {
			const generator = new DrizzleMigrationGenerator();
			const result = await generator.generateMigration({
				migrationName: "searchExtensionFresh20250108",
				fileBaseName: "20250108_search_extension_fresh",
				schema: app.getSchema(),
				migrationDir: testMigrationDir,
			});

			// The generated migration itself must not create the extension.
			const contents = readFileSync(`${result.filePath}.ts`, "utf8");
			expect(contents).not.toContain("CREATE EXTENSION");

			const migrationModule = await import(
				`${pathToFileURL(`${result.filePath}.ts`).href}?t=${Date.now()}`
			);
			const runner = new MigrationRunner(app.db, { silent: true });
			await runner.fresh([migrationModule.default]);

			// pg_trgm is present because createTestDb provided it out-of-band
			// (docker-init analog), not because the migration created it.
			const extensionResult = await cleanDb.query(
				"SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'",
			);
			expect(extensionResult.rows.length).toBe(1);

			const indexResult = await cleanDb.query(`
SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename = 'questpie_search'
AND indexname = 'idx_search_trigram'
`);
			expect(indexResult.rows.length).toBe(1);
		} finally {
			await app.destroy();
			await cleanDb.close();
		}
	});

	test("should build cumulative snapshot from migrations", async () => {
		const { DrizzleMigrationGenerator } =
			await import("../../src/server/migration/generator.js");

		const generator = new DrizzleMigrationGenerator();

		// Mock migrations with snapshots
		const mockMigrations = [
			{
				id: "migration1",
				snapshot: {
					operations: [
						{
							type: "set" as const,
							path: "tables.posts",
							value: { name: "posts" },
							timestamp: "2025-01-08T00:00:00Z",
							migrationId: "migration1",
						},
					],
					metadata: {
						migrationId: "migration1",
						timestamp: "2025-01-08T00:00:00Z",
					},
				},
			},
		];

		const snapshot =
			generator.getCumulativeSnapshotFromMigrations(mockMigrations);

		expect(snapshot).toBeDefined();
		expect(snapshot.dialect).toBe("postgres");
	});
});
