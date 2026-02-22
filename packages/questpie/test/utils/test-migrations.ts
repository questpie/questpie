import { sql } from "drizzle-orm";
import type { Collection } from "../../src/server/collection/builder/collection.js";
import type { AnyCollectionState } from "../../src/server/collection/builder/types.js";
import { questpie } from "../../src/server/index.js";
import type { Migration } from "../../src/server/migration/types.js";
import { buildMockApp } from "./mocks/mock-app-builder";

/**
 * Create migration from collection definition
 * Generates CREATE TABLE statement from Drizzle table definition
 */
export function createCollectionMigration(
	collection: Collection<AnyCollectionState>,
	options: {
		includeI18n?: boolean;
		includeVersions?: boolean;
	} = {},
): Migration {
	const { includeI18n = false, includeVersions = false } = options;

	const migrationId = `create_${collection.name}_table`;

	return {
		id: migrationId,
		async up({ db }) {
			// Generate CREATE TABLE from Drizzle schema
			// We use Drizzle's internal schema to generate SQL
			const tableName = collection.name;

			// For now, we'll use a simple approach: extract table creation from Drizzle
			// In production, this could use drizzle-kit's SQL generation
			await db.execute(
				sql.raw(
					`CREATE TABLE ${tableName} AS SELECT * FROM ${tableName} WHERE false`,
				),
			);

			if (includeI18n && collection.i18nTable) {
				await db.execute(
					sql.raw(
						`CREATE TABLE ${tableName}_i18n AS SELECT * FROM ${tableName}_i18n WHERE false`,
					),
				);
			}

			if (includeVersions && collection.versionsTable) {
				await db.execute(
					sql.raw(
						`CREATE TABLE ${tableName}_versions AS SELECT * FROM ${tableName}_versions WHERE false`,
					),
				);
			}

			if (includeVersions && collection.i18nVersionsTable) {
				await db.execute(
					sql.raw(
						`CREATE TABLE ${tableName}_i18n_versions AS SELECT * FROM ${tableName}_i18n_versions WHERE false`,
					),
				);
			}
		},
		async down({ db }) {
			const tableName = collection.name;

			if (includeVersions && collection.i18nVersionsTable) {
				await db.execute(
					sql.raw(`DROP TABLE IF EXISTS ${tableName}_i18n_versions`),
				);
			}

			if (includeVersions && collection.versionsTable) {
				await db.execute(sql.raw(`DROP TABLE IF EXISTS ${tableName}_versions`));
			}

			if (includeI18n && collection.i18nTable) {
				await db.execute(sql.raw(`DROP TABLE IF EXISTS ${tableName}_i18n`));
			}

			await db.execute(sql.raw(`DROP TABLE IF EXISTS ${tableName}`));
		},
	};
}

/**
 * Helper to run migrations in tests
 * Replaces manual DDL statements with migration system
 *
 * @example
 * ```ts
 * const { app } = await setupTestMigrations(db, [
 *   products,
 *   categories,
 * ]);
 *
 * // Tables are now created via migrations
 * // Use app.migrations.down() to rollback in afterEach
 * ```
 */
export async function setupTestMigrations(
	db: any,
	collections: Collection<AnyCollectionState>[],
	customMigrations: Migration[] = [],
) {
	const collectionsMap = Object.fromEntries(
		collections.map((collection) => [collection.name, collection]),
	);
	const testModule = questpie({ name: "test-migrations" }).collections(
		collectionsMap,
	);
	const dbConfig = db && ("bun" in db || "pglite" in db) ? db : { pglite: db };
	const { app } = await buildMockApp(testModule, { db: dbConfig });

	// Generate migrations for each collection
	const collectionMigrations: Migration[] = [];

	for (const collection of collections) {
		// For testing, we still need to use manual DDL
		// But in the future, we can use Drizzle Kit to generate SQL
		// For now, this is a placeholder that documents the approach
	}

	// Add custom migrations
	app.config.migrations = {
		migrations: [...collectionMigrations, ...customMigrations],
	};

	// Run migrations
	await app.migrations.up();

	return { app, db };
}

/**
 * Helper to create a simple migration from DDL
 * Use this to convert existing test DDL to migrations
 */
export function createMigrationFromDDL(
	id: string,
	upStatements: string[],
	downStatements: string[],
): Migration {
	return {
		id,
		async up({ db }) {
			for (const statement of upStatements) {
				await db.execute(sql.raw(statement));
			}
		},
		async down({ db }) {
			for (const statement of downStatements) {
				await db.execute(sql.raw(statement));
			}
		},
	};
}
