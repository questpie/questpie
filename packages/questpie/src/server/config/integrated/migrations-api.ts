import { sql } from "drizzle-orm";
import { toCamelCase } from "drizzle-orm/casing";
import type { Questpie } from "#questpie/server/config/cms.js";
import type { QuestpieConfig } from "#questpie/server/config/types.js";
import {
  DrizzleMigrationGenerator,
  type GenerateMigrationOptions,
  type GenerateMigrationResult,
  MigrationRunner,
  type MigrationStatus,
  type RunMigrationsOptions,
} from "#questpie/server/migration/index.js";

/**
 * Programmatic migration API
 *
 * Provides access to migration operations for use in tests and scripts
 *
 * @example
 * ```ts
 * // Generate a new migration
 * await cms.migrations.generate({ name: "add_users_table" })
 *
 * // Run all pending migrations
 * await cms.migrations.up()
 *
 * // Rollback last batch
 * await cms.migrations.down()
 *
 * // Get status
 * const status = await cms.migrations.status()
 * ```
 */
export class QuestpieMigrationsAPI<
  TConfig extends QuestpieConfig = QuestpieConfig,
> {
  private readonly runner: MigrationRunner;

  constructor(private readonly cms: Questpie<TConfig>) {
    this.runner = new MigrationRunner(this.cms.db);
  }

  /**
   * Generate a new migration
   */
  async generate(
    options: GenerateMigrationOptions = {},
  ): Promise<GenerateMigrationResult> {
    const generator = new DrizzleMigrationGenerator();
    const migrationDir =
      this.cms.config.migrations?.directory || "./migrations";

    // Generate timestamp and name (YYYYMMDDHHmmss format - 14 digits)
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:T]/g, "")
      .replace(/\..+/, "")
      .slice(0, 14);

    const randomName = options.name || this.generateRandomMigrationName();
    const fileBaseName = `${timestamp}_${randomName}`;
    const camelCaseName = toCamelCase(randomName);
    const migrationVariableName = `${camelCaseName}${timestamp}`;

    return generator.generateMigration({
      migrationName: migrationVariableName,
      fileBaseName,
      schema: this.cms.getSchema(),
      migrationDir,
    });
  }

  /**
   * Run pending migrations
   *
   * Automatically:
   * 1. Runs search adapter extensions first (pg_trgm, vector, etc.)
   * 2. Runs Drizzle migrations (tables, basic indexes)
   * 3. Runs search adapter migrations (FTS indexes, trigram indexes)
   */
  async up(options: RunMigrationsOptions = {}): Promise<void> {
    // 1. Ensure search extensions are created first (idempotent)
    const extResult = await this.ensureExtensions();
    if (extResult.applied.length > 0 && !this.runner.silent) {
      console.log(`🔌 Created extensions: ${extResult.applied.length}`);
      for (const ext of extResult.applied) {
        console.log(`   ✅ ${ext}`);
      }
    }
    if (extResult.skipped.length > 0 && !this.runner.silent) {
      console.log(`⏭️  Extensions already exist: ${extResult.skipped.length}`);
    }

    // 2. Run Drizzle migrations (creates tables)
    const migrations = this.cms.config.migrations?.migrations || [];
    await this.runner.runMigrationsUp(migrations, options);

    // 3. Run search adapter migrations (creates FTS/trigram indexes)
    // These use IF NOT EXISTS so safe to run multiple times
    await this.search();
  }

  /**
   * Ensure required PostgreSQL extensions are created.
   *
   * Runs CREATE EXTENSION statements from the search adapter before migrations.
   * These statements are idempotent (IF NOT EXISTS) so safe to run multiple times.
   *
   * @example
   * ```ts
   * // Run extensions only (useful for CI/CD)
   * await cms.migrations.ensureExtensions();
   * ```
   */
  async ensureExtensions(): Promise<{ applied: string[]; skipped: string[] }> {
    const applied: string[] = [];
    const skipped: string[] = [];

    const adapter = this.cms.search?.getAdapter();
    if (!adapter?.getExtensions) {
      return { applied, skipped };
    }

    const extensions = adapter.getExtensions();
    for (const ext of extensions) {
      try {
        await this.cms.db.execute(sql.raw(ext));
        applied.push(ext);
      } catch (error: any) {
        const msg = error?.message?.toLowerCase() || "";
        // Handle common extension errors gracefully
        if (
          msg.includes("already exists") ||
          msg.includes("extension") ||
          msg.includes("could not open extension") ||
          msg.includes("permission denied")
        ) {
          skipped.push(ext);
        } else {
          // Re-throw unexpected errors
          throw error;
        }
      }
    }

    return { applied, skipped };
  }

  /**
   * Rollback last batch of migrations
   */
  async down(): Promise<void> {
    const migrations = this.cms.config.migrations?.migrations || [];
    await this.runner.rollbackLastBatch(migrations);
  }

  /**
   * Rollback to a specific migration
   */
  async downTo(migrationId: string): Promise<void> {
    const migrations = this.cms.config.migrations?.migrations || [];
    await this.runner.rollbackToMigration(migrations, migrationId);
  }

  /**
   * Reset all migrations (rollback everything)
   */
  async reset(): Promise<void> {
    const migrations = this.cms.config.migrations?.migrations || [];
    await this.runner.reset(migrations);
  }

  /**
   * Fresh migrations (reset + run all)
   */
  async fresh(): Promise<void> {
    const migrations = this.cms.config.migrations?.migrations || [];
    await this.runner.fresh(migrations);
  }

  /**
   * Get migration status
   */
  async status(): Promise<MigrationStatus> {
    const migrations = this.cms.config.migrations?.migrations || [];
    return this.runner.status(migrations);
  }

  /**
   * Run search adapter migrations
   *
   * This applies the search index table, FTS index, and optionally trigram/vector indexes
   * based on the configured search adapter.
   *
   * @example
   * ```ts
   * // Run search migrations
   * await cms.migrations.search();
   * ```
   */
  async search(): Promise<{ applied: string[]; skipped: string[] }> {
    const adapter = this.cms.search.getAdapter();
    const migrations = adapter.getMigrations();

    const applied: string[] = [];
    const skipped: string[] = [];

    for (const migration of migrations) {
      try {
        // Split SQL into individual statements to support PGLite
        // which doesn't allow multiple commands in a prepared statement
        const statements = this.splitSqlStatements(migration.up);
        for (const statement of statements) {
          await this.cms.db.execute(sql.raw(statement));
        }
        applied.push(migration.name);
      } catch (error: any) {
        // Handle "already exists" gracefully - these are idempotent
        const msg = error?.message?.toLowerCase() || "";
        if (
          msg.includes("already exists") ||
          msg.includes("duplicate") ||
          (msg.includes("relation") && msg.includes("exists"))
        ) {
          skipped.push(migration.name);
        } else {
          // For extension errors, skip gracefully
          if (
            msg.includes("extension") ||
            msg.includes("could not open extension")
          ) {
            console.warn(
              `[Search Migration] Skipping ${migration.name}: ${error.message}`,
            );
            skipped.push(migration.name);
          } else {
            throw error;
          }
        }
      }
    }

    return { applied, skipped };
  }

  /**
   * Rollback search adapter migrations
   *
   * @example
   * ```ts
   * // Rollback search migrations
   * await cms.migrations.searchDown();
   * ```
   */
  async searchDown(): Promise<{ applied: string[] }> {
    const adapter = this.cms.search.getAdapter();
    const migrations = adapter.getMigrations();

    const applied: string[] = [];

    // Run in reverse order
    for (let i = migrations.length - 1; i >= 0; i--) {
      const migration = migrations[i];
      try {
        // Split SQL into individual statements to support PGLite
        const statements = this.splitSqlStatements(migration.down);
        for (const statement of statements) {
          await this.cms.db.execute(sql.raw(statement));
        }
        applied.push(migration.name);
      } catch (error: any) {
        // Ignore "does not exist" errors
        const msg = error?.message?.toLowerCase() || "";
        if (!msg.includes("does not exist")) {
          console.warn(
            `[Search Migration] Warning rolling back ${migration.name}: ${error.message}`,
          );
        }
      }
    }

    return { applied };
  }

  private generateRandomMigrationName(): string {
    const adjectives = [
      "happy",
      "bright",
      "swift",
      "bold",
      "calm",
      "eager",
      "fancy",
      "gentle",
      "jolly",
      "kind",
      "lucky",
      "merry",
      "nice",
      "proud",
      "quick",
    ];
    const colors = [
      "red",
      "blue",
      "green",
      "yellow",
      "purple",
      "orange",
      "pink",
      "crimson",
      "azure",
      "emerald",
      "amber",
      "violet",
      "indigo",
      "scarlet",
      "teal",
    ];
    const animals = [
      "zebra",
      "panda",
      "tiger",
      "eagle",
      "dolphin",
      "falcon",
      "phoenix",
      "dragon",
      "griffin",
      "unicorn",
      "lion",
      "wolf",
      "otter",
      "koala",
      "lemur",
    ];

    const randomItem = (arr: string[]) =>
      arr[Math.floor(Math.random() * arr.length)]!;

    return `${randomItem(adjectives)}_${randomItem(colors)}_${randomItem(animals)}`;
  }

  /**
   * Split SQL string into individual statements.
   * This is needed because PGLite doesn't allow multiple commands in a prepared statement.
   */
  private splitSqlStatements(sqlString: string): string[] {
    return sqlString
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
}
