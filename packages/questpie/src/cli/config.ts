import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { Questpie } from "../server/config/questpie.js";
import { toFileImportSpecifier } from "./utils.js";

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
		 * Directory where generated migrations should be saved.
		 * When omitted, defaults to the `migrations/` dir inside the entity root
		 * (same directory codegen discovers from).
		 * If set, resolved relative to CWD.
		 */
		directory?: string;
	};

	/**
	 * Seed settings for CLI
	 */
	seeds?: {
		/**
		 * Directory where generated seeds should be saved.
		 * When omitted, defaults to the `seeds/` dir inside the entity root
		 * (same directory codegen discovers from).
		 * If set, resolved relative to CWD.
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
 *    // in questpie.config.ts
 *    export default config({ db: { url }, app: { url }, migrations })
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
 * Resolve the entity root directory from a config file path.
 *
 * Project root configs commonly re-export the real server config from a deeper
 * directory. CLI commands that need generated runtime output must follow that
 * re-export so they look next to the server config, not next to the root shim.
 */
export async function resolveConfigRoot(
	configPath: string,
): Promise<{ configPath: string; rootDir: string }> {
	let content: string;
	try {
		content = String(await readFile(configPath, "utf-8"));
	} catch {
		return { configPath, rootDir: dirname(configPath) };
	}

	const reExportMatch = content.match(
		/^\s*export\s*\{\s*default\s*\}\s*from\s*["']([^"']+)["']/m,
	);
	if (!reExportMatch) {
		return { configPath, rootDir: dirname(configPath) };
	}

	const innerRaw = resolve(dirname(configPath), reExportMatch[1]);
	for (const candidate of [innerRaw, `${innerRaw}.ts`, `${innerRaw}.mts`]) {
		try {
			await stat(candidate);
			return { configPath: candidate, rootDir: dirname(candidate) };
		} catch {
			// Try the next extension candidate.
		}
	}

	return { configPath, rootDir: dirname(configPath) };
}

/**
 * Load and validate config file.
 *
 * Supports multiple config formats:
 * 1. **New format (AppConfig)**: `export default config({ app: { url }, db: { url }, modules: [...] })`
 *    → Auto-resolves .generated/index.ts for the Questpie instance
 * 2. **CLI format**: `export default { app: questpieInstance, cli: { ... } }`
 * 3. **Legacy format**: `export default { qcms: questpieInstance }` (deprecated)
 * 4. **Direct instance**: `export default questpieInstance`
 */
export async function loadQuestpieConfig(
	configPath: string,
): Promise<QuestpieConfigFile> {
	const configModule = await import(
		/* @vite-ignore */ toFileImportSpecifier(configPath)
	);
	const config = configModule.config || configModule.default || configModule;

	// Check if this is the new AppConfig format (has app.url but app is not a Questpie instance)
	if (
		config.app &&
		typeof config.app === "object" &&
		"url" in config.app &&
		typeof config.app.url === "string" &&
		!("api" in config.app)
	) {
		// New AppConfig format — try to load .generated/index.ts
		const { rootDir } = await resolveConfigRoot(configPath);
		const generatedPath = join(rootDir, ".generated", "index.ts");
		try {
			const generatedModule = await import(
				/* @vite-ignore */ toFileImportSpecifier(generatedPath)
			);
			if (!generatedModule.app) {
				throw new Error("Generated module does not export `app`.");
			}

			return {
				app: generatedModule.app,
				cli: config.cli ?? {
					migrations: config.cli?.migrations,
					seeds: config.cli?.seeds,
				},
			};
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new Error(
				`Config at ${configPath} uses the new AppConfig format.\n` +
					`Could not load generated app at ${generatedPath}: ${reason}\n` +
					`Run \`questpie generate\` first to create .generated/index.ts,\n` +
					`or point --config to a file that exports { app: QuestpieInstance }.`,
			);
		}
	}

	// Standard format: { app: QuestpieInstance, cli?: { ... } }
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

// ============================================================================
// Package Config — for npm packages that contain modules
// ============================================================================

/**
 * Configuration for packages that contain questpie modules.
 *
 * Used by `questpie generate` in package mode to discover and generate
 * `.generated/module.ts` for each module in the package.
 *
 * This config is dev-only — it is NOT distributed with the npm package.
 * Only the generated `.generated/module.ts` files are published.
 *
 * @example
 * ```ts
 * // packages/admin/questpie.config.ts
 * import { packageConfig } from "questpie/cli";
 * import { adminPlugin } from "./src/server/plugin.js";
 *
 * export default packageConfig({
 *   modulesDir: "src/server/modules",
 *   modulePrefix: "questpie",
 *   plugins: [adminPlugin()],
 * });
 * ```
 */
export interface PackageConfig {
	/**
	 * Marker property to identify this as a package config.
	 * @internal Set automatically by `packageConfig()`.
	 */
	readonly __type: "package";

	/**
	 * Directory containing module subdirectories, relative to config file location.
	 * Each subdirectory is treated as a separate module.
	 *
	 * @example "src/server/modules" → scans src/server/modules/admin/, src/server/modules/starter/, etc.
	 */
	modulesDir: string;

	/**
	 * Prefix for generated module names.
	 * Module name = `${modulePrefix}-${directoryName}`.
	 *
	 * @default derived from package.json name
	 * @example "questpie" → directory "admin" becomes module "questpie-admin"
	 */
	modulePrefix?: string;

	/**
	 * Codegen plugins shared across all modules in this package.
	 * Plugins add discovery patterns (views, components, blocks, etc.).
	 */
	plugins?: import("./codegen/types.js").CodegenPlugin[];
}

/**
 * Define a package-level codegen config for packages containing modules.
 *
 * @example
 * ```ts
 * import { packageConfig } from "questpie/cli";
 * import { adminPlugin } from "./src/server/plugin.js";
 *
 * export default packageConfig({
 *   modulesDir: "src/server/modules",
 *   modulePrefix: "questpie",
 *   plugins: [adminPlugin()],
 * });
 * ```
 */
export function packageConfig(
	config: Omit<PackageConfig, "__type">,
): PackageConfig {
	return { ...config, __type: "package" as const };
}

/**
 * Check if a config object is a PackageConfig.
 */
export function isPackageConfig(config: unknown): config is PackageConfig {
	return (
		typeof config === "object" &&
		config !== null &&
		"__type" in config &&
		(config as any).__type === "package"
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
