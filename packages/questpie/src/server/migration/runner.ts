import { sql } from "drizzle-orm";
import type {
	Migration,
	MigrationDb,
	MigrationRecord,
	MigrationStatus,
	RunMigrationsOptions,
} from "./types.js";

export type MigrationRunnerOptions = {
	/** Suppress info/warn logs */
	silent?: boolean;
};

/**
 * Migration runner service
 *
 * Manages migration execution, rollback, and status tracking
 * Stores migration history in a dedicated `questpie_migrations` table
 */
export class MigrationRunner {
	private db: MigrationDb;
	private tableName = "questpie_migrations";
	readonly silent: boolean;

	constructor(db: MigrationDb, options: MigrationRunnerOptions = {}) {
		this.db = db;
		this.silent = options.silent ?? this.readSilentEnv();
	}

	private readSilentEnv(): boolean {
		const value = process.env.QUESTPIE_MIGRATIONS_SILENT;
		const isTestEnv = process.env.NODE_ENV === "test";

		if (isTestEnv) {
			return true;
		}

		if (!value) {
			return false;
		}
		return ["1", "true", "yes"].includes(value.toLowerCase());
	}

	private log(message: string): void {
		if (!this.silent) {
			console.log(message);
		}
	}

	private warn(message: string): void {
		if (!this.silent) {
			console.warn(message);
		}
	}

	/**
	 * Ensure migrations table exists
	 */
	async ensureMigrationsTable(): Promise<void> {
		await this.db.execute(
			sql.raw(`
			CREATE TABLE IF NOT EXISTS ${this.tableName} (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				batch INTEGER NOT NULL,
				executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
			)
		`),
		);
	}

	/**
	 * Run all pending migrations
	 */
	async runMigrationsUp(
		migrations: Migration[],
		options: RunMigrationsOptions = {},
	): Promise<void> {
		await this.ensureMigrationsTable();

		const executed = await this.getExecutedMigrations();
		const executedIds = new Set(executed.map((m) => m.id));

		const pending = migrations.filter((m) => !executedIds.has(m.id));

		if (pending.length === 0) {
			this.log("✅ No pending migrations");
			return;
		}

		this.log(`📦 Running ${pending.length} pending migrations...`);

		// Get next batch number
		const currentBatch = await this.getCurrentBatch();
		const nextBatch = currentBatch + 1;

		for (const migration of pending) {
			if (options.targetMigration && migration.id === options.targetMigration) {
				this.log(`🎯 Reached target migration: ${migration.id}, stopping here`);
				break;
			}

			this.log(`⬆️  Running migration: ${migration.id}`);

			try {
				// Run the migration within a transaction
				await this.db.transaction(async (tx) => {
					// Run the migration
					await migration.up({ db: tx });

					// Record it in the migrations table
					await tx.execute(
						sql.raw(
							`INSERT INTO ${this.tableName} (id, name, batch) VALUES ('${migration.id}', '${migration.id}', ${nextBatch})`,
						),
					);
				});

				this.log(`✅ Migration completed: ${migration.id}`);
			} catch (error) {
				console.error(`❌ Migration failed: ${migration.id}`, error);
				throw error;
			}

			if (options.targetMigration && migration.id === options.targetMigration) {
				break;
			}
		}

		this.log("✅ All migrations completed successfully");
	}

	/**
	 * Rollback the last batch of migrations
	 */
	async rollbackLastBatch(migrations: Migration[]): Promise<void> {
		await this.ensureMigrationsTable();

		const currentBatch = await this.getCurrentBatch();

		if (currentBatch === 0) {
			this.log("ℹ️  No migrations to rollback");
			return;
		}

		await this.rollbackBatch(migrations, currentBatch);
	}

	/**
	 * Rollback a specific batch of migrations
	 */
	async rollbackBatch(migrations: Migration[], batch: number): Promise<void> {
		await this.ensureMigrationsTable();

		// Get migrations in this batch
		const batchMigrations = await this.getMigrationsByBatch(batch);

		if (batchMigrations.length === 0) {
			this.log(`ℹ️  No migrations found in batch ${batch}`);
			return;
		}

		this.log(
			`📦 Rolling back ${batchMigrations.length} migrations from batch ${batch}...`,
		);

		// Rollback in reverse order
		for (let i = batchMigrations.length - 1; i >= 0; i--) {
			const record = batchMigrations[i]!;
			const migration = migrations.find((m) => m.id === record.id);

			if (!migration) {
				this.warn(`⚠️  Migration definition not found: ${record.id}, skipping`);
				continue;
			}

			this.log(`⬇️  Rolling back migration: ${migration.id}`);

			try {
				// Run the rollback within a transaction
				await this.db.transaction(async (tx) => {
					// Run the down migration
					await migration.down({ db: tx });

					// Remove from migrations table
					await tx.execute(
						sql.raw(
							`DELETE FROM ${this.tableName} WHERE id = '${migration.id}'`,
						),
					);
				});

				this.log(`✅ Rollback completed: ${migration.id}`);
			} catch (error) {
				console.error(`❌ Rollback failed: ${migration.id}`, error);
				throw error;
			}
		}

		this.log("✅ All migrations rolled back successfully");
	}

	/**
	 * Rollback to a specific migration (inclusive)
	 */
	async rollbackToMigration(
		migrations: Migration[],
		targetId: string,
	): Promise<void> {
		await this.ensureMigrationsTable();

		const executed = await this.getExecutedMigrations();
		const targetIndex = executed.findIndex((m) => m.id === targetId);

		if (targetIndex === -1) {
			throw new Error(`Migration not found: ${targetId}`);
		}

		// Get all migrations after target (reverse order)
		const toRollback = executed.slice(targetIndex).reverse();

		this.log(
			`📦 Rolling back ${toRollback.length} migrations to ${targetId}...`,
		);

		for (const record of toRollback) {
			const migration = migrations.find((m) => m.id === record.id);

			if (!migration) {
				this.warn(`⚠️  Migration definition not found: ${record.id}, skipping`);
				continue;
			}

			this.log(`⬇️  Rolling back migration: ${migration.id}`);

			try {
				// Run the rollback within a transaction
				await this.db.transaction(async (tx) => {
					await migration.down({ db: tx });
					await tx.execute(
						sql.raw(
							`DELETE FROM ${this.tableName} WHERE id = '${migration.id}'`,
						),
					);
				});

				this.log(`✅ Rollback completed: ${migration.id}`);
			} catch (error) {
				console.error(`❌ Rollback failed: ${migration.id}`, error);
				throw error;
			}
		}

		this.log("✅ Rollback completed successfully");
	}

	/**
	 * Reset all migrations (rollback everything)
	 */
	async reset(migrations: Migration[]): Promise<void> {
		await this.ensureMigrationsTable();

		const executed = await this.getExecutedMigrations();

		if (executed.length === 0) {
			this.log("ℹ️  No migrations to reset");
			return;
		}

		this.log(`📦 Resetting ${executed.length} migrations...`);

		// Rollback in reverse order
		for (let i = executed.length - 1; i >= 0; i--) {
			const record = executed[i]!;
			const migration = migrations.find((m) => m.id === record.id);

			if (!migration) {
				this.warn(`⚠️  Migration definition not found: ${record.id}, skipping`);
				continue;
			}

			this.log(`⬇️  Rolling back migration: ${migration.id}`);

			try {
				// Run the rollback within a transaction
				await this.db.transaction(async (tx) => {
					await migration.down({ db: tx });
					await tx.execute(
						sql.raw(
							`DELETE FROM ${this.tableName} WHERE id = '${migration.id}'`,
						),
					);
				});

				this.log(`✅ Rollback completed: ${migration.id}`);
			} catch (error) {
				console.error(`❌ Rollback failed: ${migration.id}`, error);
				throw error;
			}
		}

		this.log("✅ All migrations reset successfully");
	}

	/**
	 * Fresh migrations (reset + run all)
	 */
	async fresh(migrations: Migration[]): Promise<void> {
		await this.reset(migrations);
		await this.runMigrationsUp(migrations);
	}

	/**
	 * Get migration status
	 */
	async status(migrations: Migration[]): Promise<MigrationStatus> {
		await this.ensureMigrationsTable();

		const executed = await this.getExecutedMigrations();
		const executedIds = new Set(executed.map((m) => m.id));

		const pending = migrations
			.filter((m) => !executedIds.has(m.id))
			.map((m) => ({ id: m.id, name: m.id }));

		const currentBatch = await this.getCurrentBatch();

		this.log("\n📊 Migration Status:\n");
		this.log(`Current batch: ${currentBatch}`);
		this.log(`Executed: ${executed.length}`);
		this.log(`Pending: ${pending.length}\n`);

		if (executed.length > 0) {
			this.log("✅ Executed migrations:");
			for (const record of executed) {
				this.log(
					`  - ${record.name} (batch ${record.batch}, ${record.executedAt})`,
				);
			}
			this.log("");
		}

		if (pending.length > 0) {
			this.log("⏳ Pending migrations:");
			for (const p of pending) {
				this.log(`  - ${p.name}`);
			}
			this.log("");
		}

		return {
			pending,
			executed,
			currentBatch,
		};
	}

	/**
	 * Get all executed migrations
	 */
	private async getExecutedMigrations(): Promise<MigrationRecord[]> {
		const result: any = await this.db.execute(
			sql.raw(
				`SELECT id, name, batch, executed_at FROM ${this.tableName} ORDER BY executed_at ASC`,
			),
		);

		return (result.rows || result || []).map((row: any) => ({
			id: row.id,
			name: row.name,
			batch: row.batch,
			executedAt: new Date(row.executed_at),
		}));
	}

	/**
	 * Get migrations by batch number
	 */
	private async getMigrationsByBatch(
		batch: number,
	): Promise<MigrationRecord[]> {
		const result: any = await this.db.execute(
			sql.raw(
				`SELECT id, name, batch, executed_at FROM ${this.tableName} WHERE batch = ${batch} ORDER BY executed_at ASC`,
			),
		);

		return (result.rows || result || []).map((row: any) => ({
			id: row.id,
			name: row.name,
			batch: row.batch,
			executedAt: new Date(row.executed_at),
		}));
	}

	/**
	 * Get current batch number
	 */
	private async getCurrentBatch(): Promise<number> {
		const result: any = await this.db.execute(
			sql.raw(`SELECT MAX(batch) as max_batch FROM ${this.tableName}`),
		);

		const rows = result.rows || result || [];
		const maxBatch = rows[0]?.max_batch;
		return maxBatch ? Number.parseInt(maxBatch, 10) : 0;
	}
}
