import type { Questpie } from "../server/config/questpie.js";

/**
 * CLI-specific configuration options
 * These are only used by the CLI tooling, not at runtime
 */
export interface QuestpieCliConfig {
	/**
	 * Migration settings for CLI
	 */
	migrations?: {
		/**
		 * Directory where generated migrations should be saved
		 * @default "./src/migrations"
		 */
		directory?: string;
	};

	/**
	 * Seed settings for CLI
	 */
	seeds?: {
		/**
		 * Directory where generated seeds should be saved
		 * @default "./src/seeds"
		 */
		directory?: string;
	};
}

/**
 * Config file structure (questpie.config.ts)
 *
 * This is the configuration file used by the Questpie CLI for:
 * - Generating migrations (`questpie migrate:generate`)
 * - Running migrations (`questpie migrate:up`)
 * - Pushing schema directly (`questpie push`)
 *
 * ## Architecture
 *
 * The config separates concerns between runtime and CLI:
 * - **Runtime (Questpie instance)**: Knows about migrations via `.build({ migrations: [...] })`
 * - **CLI config**: Knows where to save generated migrations
 *
 * ## Workflow
 *
 * 1. Generate migration: `bun questpie migrate:generate`
 *    - CLI reads schema from `app.getSchema()`
 *    - Compares with previous snapshots
 *    - Generates new migration in `cli.migrations.directory`
 *
 * 2. Import migration in your app:
 *    ```ts
 *    import { migrations } from "./src/migrations.js"
 *    const app = questpie({ name: 'app' })
 *      .build({ ..., migrations })
 *    ```
 *
 * 3. Run migrations: `bun questpie migrate:up`
 *    - CLI reads migrations from `app.config.migrations.migrations`
 *    - Executes pending migrations
 *
 * @example
 * ```ts
 * // questpie.config.ts
 * import { config } from "questpie/cli";
 * import { app } from "./src/server/app.js";
 *
 * export default config({
 *   app: app,
 *   cli: {
 *     migrations: {
 *       directory: "./src/migrations",
 *     },
 *   },
 * });
 * ```
 */
export interface QuestpieConfigFile<
	TApp extends Questpie<any> = Questpie<any>,
> {
	/**
	 * The Questpie instance
	 * Must have migrations loaded via `.migrations([...])` for migrate:up to work
	 */
	app: TApp;

	/**
	 * CLI-specific configuration
	 * Used only by CLI commands, not at runtime
	 */
	cli?: QuestpieCliConfig;
}

/**
 * Helper function to define CLI config with full type safety
 *
 * @example
 * ```ts
 * // questpie.config.ts
 * import { config } from "questpie/cli";
 * import { app } from "./src/server/app.js";
 *
 * export default config({
 *   app: app,
 *   cli: {
 *     migrations: {
 *       directory: "./src/migrations",
 *     },
 *   },
 * });
 * ```
 */
export function config<TApp extends Questpie<any>>(
	config: QuestpieConfigFile<TApp>,
): QuestpieConfigFile<TApp> {
	return config;
}

/**
 * Load and validate config file
 */
export async function loadQuestpieConfig(
	configPath: string,
): Promise<QuestpieConfigFile> {
	const configModule = await import(/* @vite-ignore */ configPath);
	const config = configModule.config || configModule.default || configModule;

	// Support both old format (direct app export) and new format (config object)
	if (config.app) {
		return config as QuestpieConfigFile;
	}

	// Legacy format: { qcms } or just qcms - for backwards compatibility
	if (config.qcms) {
		console.warn(
			'⚠️  Deprecation warning: "qcms" property is deprecated, use "app" instead',
		);
		return { app: config.qcms, cli: config.cli };
	}

	// Legacy format: direct Questpie instance
	if (typeof config === "object" && "db" in config) {
		// This looks like a Questpie instance directly
		return { app: config };
	}

	throw new Error(
		"Config must export a QuestpieConfigFile object with 'app' property, or a Questpie instance directly",
	);
}

/**
 * Get migration directory from config
 * Priority: cli.migrations.directory > default
 */
export function getMigrationDirectory(config: QuestpieConfigFile): string {
	return config.cli?.migrations?.directory || "./src/migrations";
}

/**
 * Get seed directory from config
 * Priority: cli.seeds.directory > default
 */
export function getSeedDirectory(config: QuestpieConfigFile): string {
	return config.cli?.seeds?.directory || "./src/seeds";
}
