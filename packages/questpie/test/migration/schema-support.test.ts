/**
 * Schema support — per-collection/global Postgres schema.
 *
 * Verifies that:
 * - `collection(...).options({ schema: "x" })` produces tables under schema "x".
 * - Cross-schema relations render a qualified FK: `REFERENCES "x"."y"("id")`.
 * - The migration generator prepends `CREATE SCHEMA IF NOT EXISTS "x"` for new schemas.
 * - Collections without `schema` stay on `public` (backward compatible).
 */

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

import type { PGlite } from "@electric-sql/pglite";
import { getTableConfig } from "drizzle-orm/pg-core";

import {
	collection,
	createApp,
	global,
	module,
} from "../../src/exports/index.js";
import { MockKVAdapter } from "../utils/mocks/kv.adapter";
import { MockLogger } from "../utils/mocks/logger.adapter";
import { MockMailAdapter } from "../utils/mocks/mailer.adapter";
import { MockQueueAdapter } from "../utils/mocks/queue.adapter";
import { createTestDb, testMigrationDir } from "../utils/test-db";

describe("Collection & global — Postgres schema option", () => {
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

	test("collection without schema stays on public", () => {
		const posts = collection("posts")
			.fields(({ f }) => ({ title: f.text(255).required() }))
			.build();

		const cfg = getTableConfig(posts.table as any);
		expect(cfg.schema).toBeUndefined();
		expect(cfg.name).toBe("posts");
	});

	test("collection with schema option binds tables to that schema", () => {
		const users = collection("users")
			.fields(({ f }) => ({
				email: f.text(255).required(),
				name: f.text(255),
			}))
			.options({ schema: "auth" })
			.build();

		const cfg = getTableConfig(users.table as any);
		expect(cfg.schema).toBe("auth");
		expect(cfg.name).toBe("users");
	});

	test("schema option threads into i18n and versions tables", () => {
		const articles = collection("articles")
			.fields(({ f }) => ({
				title: f.text(255).required().localized(),
				body: f.textarea().localized(),
			}))
			.options({ schema: "content", versioning: true })
			.build();

		expect(getTableConfig(articles.table as any).schema).toBe("content");
		expect(getTableConfig(articles.i18nTable as any).schema).toBe("content");
		expect(getTableConfig(articles.versionsTable as any).schema).toBe(
			"content",
		);
		expect(getTableConfig(articles.i18nVersionsTable as any).schema).toBe(
			"content",
		);
	});

	test("global schema option threads into global main table", () => {
		const siteSettings = global("site_settings")
			.fields(({ f }) => ({ title: f.text(255) }))
			.options({ schema: "web" })
			.build();

		expect(getTableConfig(siteSettings.table as any).schema).toBe("web");
	});

	test("migration generator emits schema-qualified tables, cross-schema FK, and CREATE SCHEMA", async () => {
		const { DrizzleMigrationGenerator } = await import(
			"../../src/server/migration/generator.js"
		);

		// Pre-build users so we can reference its table from pages' FK.
		const usersBuilt = collection("users")
			.options({ schema: "auth" })
			.fields(({ f }) => ({
				email: f.text(255).required(),
				name: f.text(255),
			}))
			.build();

		// pages lives in a different schema and its `authorId` column has an
		// explicit cross-schema FK to auth.users.id via the .drizzle() escape hatch.
		// The relation metadata is preserved separately for CRUD.
		const pages = collection("pages")
			.options({ schema: "web" })
			.fields(({ f }) => ({
				title: f.text(255).required(),
				authorId: f
					.text(36)
					.drizzle((c) =>
						c.references(() => (usersBuilt.table as any).id, {
							onDelete: "cascade",
						}),
					),
			}));

		const def = module({
			name: "schema-test-app",
			collections: { users: usersBuilt, pages },
		});
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
			migrationName: "crossSchema20260417",
			fileBaseName: "20260417_cross_schema",
			schema: app.getSchema(),
			migrationDir: testMigrationDir,
		});

		expect(result.skipped).toBe(false);

		const migPath = join(testMigrationDir, "20260417_cross_schema.ts");
		expect(existsSync(migPath)).toBe(true);

		const contents = readFileSync(migPath, "utf8");

		// Schemas emitted idempotently before tables that need them.
		expect(contents).toContain('CREATE SCHEMA IF NOT EXISTS "auth"');
		expect(contents).toContain('CREATE SCHEMA IF NOT EXISTS "web"');

		// Tables qualified with their schema.
		expect(contents).toMatch(/CREATE TABLE "auth"\."users"/);
		expect(contents).toMatch(/CREATE TABLE "web"\."pages"/);

		// Cross-schema FK: web.pages.authorId → auth.users.id
		expect(contents).toMatch(
			/ALTER TABLE "web"\."pages"[\s\S]*?REFERENCES "auth"\."users"\("id"\)/,
		);

		// Down migration drops the schemas we added (CASCADE).
		expect(contents).toContain('DROP SCHEMA IF EXISTS "auth" CASCADE');
		expect(contents).toContain('DROP SCHEMA IF EXISTS "web" CASCADE');
	});

	test("subsequent migration does not re-emit CREATE SCHEMA for existing schemas", async () => {
		const { DrizzleMigrationGenerator } = await import(
			"../../src/server/migration/generator.js"
		);

		// First migration: users lives in "auth".
		const usersV1 = collection("users")
			.options({ schema: "auth" })
			.fields(({ f }) => ({ email: f.text(255).required() }));

		const defV1 = module({
			name: "schema-test-app",
			collections: { users: usersV1 },
		});
		const appV1 = await createApp(defV1, {
			app: { url: "http://localhost:3000" },
			db: { pglite: pgClient },
			email: { adapter: new MockMailAdapter() },
			queue: { adapter: new MockQueueAdapter() },
			kv: { adapter: new MockKVAdapter() },
			logger: { adapter: new MockLogger() },
		});

		const generator = new DrizzleMigrationGenerator();
		const r1 = await generator.generateMigration({
			migrationName: "v1_20260417",
			fileBaseName: "20260417_v1",
			schema: appV1.getSchema(),
			migrationDir: testMigrationDir,
		});
		expect(r1.skipped).toBe(false);

		// Second migration: add a new column — still in "auth".
		const usersV2 = collection("users")
			.options({ schema: "auth" })
			.fields(({ f }) => ({
				email: f.text(255).required(),
				name: f.text(255),
			}));

		const defV2 = module({
			name: "schema-test-app",
			collections: { users: usersV2 },
		});
		const appV2 = await createApp(defV2, {
			app: { url: "http://localhost:3000" },
			db: { pglite: pgClient },
			email: { adapter: new MockMailAdapter() },
			queue: { adapter: new MockQueueAdapter() },
			kv: { adapter: new MockKVAdapter() },
			logger: { adapter: new MockLogger() },
		});

		const r2 = await generator.generateMigration({
			migrationName: "v2_20260417",
			fileBaseName: "20260417_v2",
			schema: appV2.getSchema(),
			migrationDir: testMigrationDir,
		});
		expect(r2.skipped).toBe(false);

		const v2Contents = readFileSync(
			join(testMigrationDir, "20260417_v2.ts"),
			"utf8",
		);
		expect(v2Contents).not.toContain('CREATE SCHEMA IF NOT EXISTS "auth"');
	});

	test("regression — no schema option anywhere produces zero schema statements", async () => {
		const { DrizzleMigrationGenerator } = await import(
			"../../src/server/migration/generator.js"
		);

		const posts = collection("posts").fields(({ f }) => ({
			title: f.text(255).required(),
		}));

		const def = module({ name: "schema-test-app", collections: { posts } });
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
			migrationName: "noSchemas20260417",
			fileBaseName: "20260417_no_schemas",
			schema: app.getSchema(),
			migrationDir: testMigrationDir,
		});

		expect(result.skipped).toBe(false);

		const contents = readFileSync(
			join(testMigrationDir, "20260417_no_schemas.ts"),
			"utf8",
		);
		expect(contents).not.toContain("CREATE SCHEMA");
		expect(contents).not.toContain("DROP SCHEMA");
	});
});
