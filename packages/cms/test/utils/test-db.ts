import { PGlite } from "@electric-sql/pglite";
import { pg_uuidv7 } from "@electric-sql/pglite/pg_uuidv7";
import { sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/pglite";
import path, { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { QCMS } from "../../dist/exports/server.mjs";
import type { MockCMS } from "./mocks/mock-cms-builder";

export type TestDb = ReturnType<typeof drizzle>;

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export const testMigrationDir = join(dirname, "test-migrations-generate");

export const createTestDb = async () => {
	const client = await PGlite.create({
		extensions: { pg_uuidv7 },
	});

	await client.exec("CREATE EXTENSION IF NOT EXISTS pg_uuidv7;");
	await client.exec(`
			CREATE OR REPLACE FUNCTION uuidv7()
			RETURNS uuid
			LANGUAGE SQL
			AS $$
				SELECT uuid_generate_v7();
			$$;
				`);

	return client;
};

export const runTestDbMigrations = async (
	qcms: QCMS<any> | MockCMS<any>,
) => {
	// Generate migrations in-memory using drizzle-kit API
	const { generateDrizzleJson, generateMigration } = await import(
		"drizzle-kit/api-postgres"
	);

	const schema = qcms.getSchema();
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
	qcms.config.migrations = {
		migrations: [migration],
	};

	// Run migrations
	await qcms.migrations.up();
};
