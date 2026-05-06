import type { generateDrizzleJson } from "drizzle-kit/api-postgres";

/**
 * Drizzle snapshot JSON type inferred from drizzle-kit API
 */
export type DrizzleSnapshotJSON = Awaited<
	ReturnType<typeof generateDrizzleJson>
>;

/**
 * Migration database interface
 * Compatible with Drizzle's execute method for running raw SQL
 */
export interface MigrationDb {
	execute(query: any): Promise<any>;
	transaction<T>(callback: (tx: MigrationDb) => Promise<T>): Promise<T>;
}

/**
 * Migration definition - the actual migration to run
 */
export type Migration = {
	/** Unique migration ID (e.g., "crimsonHappyZebra20250126T143052") */
	id: string;

	/** Up migration - apply changes */
	up: (ctx: MigrationContext) => Promise<void>;

	/** Down migration - rollback changes */
	down: (ctx: MigrationContext) => Promise<void>;

	/**
	 * Operation snapshot for this migration
	 * Used to build cumulative schema state for generating new migrations
	 */
	snapshot?: OperationSnapshot;
};

/**
 * Context passed to migration up/down functions
 */
export type MigrationContext = {
	/** Drizzle client for executing migrations */
	db: MigrationDb;
};

/**
 * Migration configuration in app config (runtime)
 *
 * Migrations are passed via config({ migrations: [...] }).
 *
 * @example
 * ```ts
 * // questpie.config.ts
 * export default config({ db: { url }, app: { url }, migrations })
 * ```
 */
export type MigrationsConfig = {
	/**
	 * @deprecated Use CLI config (app.config.ts) for directory settings
	 */
	directory?: string;

	/**
	 * Migrations passed via .build() method
	 * These are the migrations that will be run at runtime
	 */
	migrations?: Migration[];
};

/**
 * Migration record in database
 */
export type MigrationRecord = {
	id: string;
	name: string;
	batch: number;
	executedAt: Date;
};

/**
 * Operation-based snapshot operation
 */
export type SnapshotOperation = {
	type: "set" | "remove";
	path: string;
	value?: any;
	timestamp: string;
	migrationId: string;
};

/**
 * Operation snapshot stored in snapshots/ directory
 */
export type OperationSnapshot = {
	operations: SnapshotOperation[];
	metadata: {
		migrationId: string;
		timestamp: string;
		prevId?: string;
	};
};

/**
 * PostgreSQL extension required by generated framework/plugin DDL.
 *
 * String inputs may be either an extension name (`pg_trgm`) or a full
 * `CREATE EXTENSION IF NOT EXISTS ...;` statement for backwards compatibility
 * with existing adapter APIs.
 */
export type MigrationExtensionDependency =
	| string
	| {
			name: string;
			schema?: string;
			statement?: string;
	  };

/**
 * Result of migration generation
 */
export type GenerateMigrationResult = {
	/** Generated migration file name */
	fileName: string;

	/** Full path to migration file */
	filePath: string;

	/** Final snapshot after applying migration */
	snapshot: DrizzleSnapshotJSON;

	/** Whether generation was skipped (no changes) */
	skipped: boolean;
};

/**
 * Options for running migrations
 */
export type RunMigrationsOptions = {
	/** Target specific migration ID */
	targetMigration?: string;
};

/**
 * Migration status information
 */
export type MigrationStatus = {
	/** Pending migrations not yet run */
	pending: Array<{ id: string; name: string }>;

	/** Executed migrations */
	executed: MigrationRecord[];

	/** Current batch number */
	currentBatch: number;
};
