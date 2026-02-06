import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { builtinFields } from "../../src/server/fields/builtin/defaults.js";
import { questpie } from "../../src/server/index.js";
import type { Migration } from "../../src/server/migration/types.js";
import { MockKVAdapter } from "../utils/mocks/kv.adapter";
import { MockLogger } from "../utils/mocks/logger.adapter";
import { MockMailAdapter } from "../utils/mocks/mailer.adapter";
import { MockQueueAdapter } from "../utils/mocks/queue.adapter";
import { createTestDb, testMigrationDir } from "../utils/test-db";

describe("Migration System - Programmatic", () => {
  let app: any;
  let pgClient: PGlite;

  beforeAll(async () => {
    // Create in-memory PGlite instance
    pgClient = await createTestDb();

    // Create questpie instance with fields
    const q = questpie({ name: "test-cms" }).fields(builtinFields);

    // Define test collections using q.collection()
    const posts = q.collection("posts").fields((f) => ({
      title: f.text({ required: true, maxLength: 255 }),
      content: f.textarea(),
      published: f.boolean({ default: false }),
    }));

    // Create CMS instance
    const builder = q.collections({ posts });

    app = builder.build({
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
});

/**
 * Migration Generation Tests
 *
 * Note: Migration generation is now a CLI-only feature via `bun questpie migrate:generate`.
 * These tests verify the DrizzleMigrationGenerator directly for unit testing purposes.
 * For integration testing of the full migration workflow, use the CLI commands.
 *
 * The new migration workflow:
 * 1. Define collections in your CMS
 * 2. Run `bun questpie migrate:generate` to create migration files
 * 3. Import migrations via `.migrations([...])` in your CMS builder
 * 4. Run `bun questpie migrate:up` or use `cms.migrations.up()` at runtime
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

    const q = questpie({ name: "test-cms" }).fields(builtinFields);
    const posts = q.collection("posts").fields((f) => ({
      title: f.text({ required: true, maxLength: 255 }),
      content: f.textarea(),
    }));

    const builder = q.collections({ posts });
    const app = builder.build({
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

  test("should skip if no schema changes", async () => {
    const { DrizzleMigrationGenerator } =
      await import("../../src/server/migration/generator.js");

    const q = questpie({ name: "test-cms" }).fields(builtinFields);
    const posts = q.collection("posts").fields((f) => ({
      title: f.text({ required: true, maxLength: 255 }),
    }));

    const builder = q.collections({ posts });
    const app = builder.build({
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
