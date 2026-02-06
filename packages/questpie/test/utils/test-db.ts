import path, { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/pglite";
import type { Questpie } from "../../src/server/index.js";
import type { MockApp } from "./mocks/mock-app-builder";

export type TestDb = ReturnType<typeof drizzle>;

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export const testMigrationDir = join(dirname, "test-migrations-generate");

export const createTestDb = async () => {
  // Create PGlite with pg_trgm extension for trigram search support
  const client = await PGlite.create({
    extensions: { pg_trgm },
  });

  return client;
};

export const runTestDbMigrations = async (
  app: Questpie<any> | MockApp<any>,
) => {
  // Generate migrations in-memory using drizzle-kit API
  const { generateDrizzleJson, generateMigration } =
    await import("drizzle-kit/api-postgres");

  const schema = app.getSchema();
  const emptySnapshot = {
    id: "00000000-0000-0000-0000-000000000000",
    dialect: "postgres" as const,
    prevIds: [],
    version: "8" as const,
    ddl: [],
    renames: [],
  };

  // Generate snapshot from current schema
  const snapshot = await generateDrizzleJson(schema, emptySnapshot.id);

  // Generate SQL statements
  const upStatements = await generateMigration(emptySnapshot, snapshot);
  const downStatements = await generateMigration(snapshot, emptySnapshot);

  // Create migration object
  const migration = {
    id: "test_migration",
    async up({ db }: any) {
      for (const statement of upStatements) {
        if (statement.trim()) {
          await db.execute(sql.raw(statement));
        }
      }
    },
    async down({ db }: any) {
      for (const statement of downStatements) {
        if (statement.trim()) {
          await db.execute(sql.raw(statement));
        }
      }
    },
  };

  // Add migration to config
  app.config.migrations = {
    migrations: [migration],
  };

  // Run migrations
  await app.migrations.up();

  // Ensure search service is initialized (in case fire-and-forget init hasn't completed)
  await app.search?.initialize?.();
};
