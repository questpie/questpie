import type { AppContext } from "#questpie/server/config/app-context.js";
import type { RequestContext } from "#questpie/server/config/context.js";

/**
 * Seed categories control when seeds run:
 * - "required": System bootstrap (admin user, default roles, system settings). Runs in every environment.
 * - "dev": Development/demo data (sample content, test users, demo pages).
 * - "test": Test fixtures (known datasets for integration tests).
 */
export type SeedCategory = "required" | "dev" | "test";

/**
 * Context passed to seed run/undo functions.
 *
 * Extends AppContext — provides the same flat, fully-typed access to all
 * infrastructure (db, collections, globals, queue, email, storage, …) as
 * function and job handlers. Auto-typed via `declare module "questpie"` in
 * the generated `.generated/index.ts`.
 *
 * Adds two seed-specific helpers:
 * - `log` — seed output logger
 * - `createContext` — create a locale-specific request context for
 *   multi-locale data operations (e.g. updating translated globals)
 *
 * @example
 * ```ts
 * export default seed({
 *   async run({ collections, globals, createContext, log }) {
 *     log("Seeding...");
 *     await globals.siteSettings.update({ shopName: "My Shop" });
 *
 *     // For locale-specific operations:
 *     const ctxSk = await createContext({ locale: "sk" });
 *     await globals.siteSettings.update({ tagline: "Môj obchod" }, ctxSk);
 *   },
 * });
 * ```
 */
export type SeedContext = AppContext & {
	/** Logger for seed output */
	log: (message: string) => void;
	/**
	 * Create a locale-specific request context for multi-locale data operations.
	 * Pass the result as the second argument to collection/global CRUD methods.
	 *
	 * @example
	 * ```ts
	 * const ctxSk = await createContext({ locale: "sk" });
	 * await globals.siteSettings.update({ tagline: "Môj obchod" }, ctxSk);
	 * ```
	 */
	createContext(options?: {
		locale?: string;
		accessMode?: "system" | "user";
	}): Promise<RequestContext>;
};

/**
 * Seed definition — a unit of seed data.
 *
 * Seeds are different from migrations:
 * - They get full app context (not just raw DB)
 * - They have categories for selective execution
 * - They can optionally have an undo function
 * - They should be idempotent by default
 */
export type Seed = {
	/** Unique seed ID (e.g., "adminUser", "demoData") */
	id: string;

	/** Human-readable description */
	description?: string;

	/** Seed category — determines when this seed should run */
	category: SeedCategory;

	/**
	 * Run the seed — populate data.
	 * Should be idempotent (safe to re-run).
	 * For "required" seeds, check if data exists before creating.
	 */
	run: (ctx: SeedContext) => Promise<void>;

	/**
	 * Optional: Undo the seed — remove seeded data.
	 * Not all seeds need this (e.g., "required" seeds usually don't).
	 */
	undo?: (ctx: SeedContext) => Promise<void>;

	/**
	 * Dependencies — IDs of seeds that must run before this one.
	 * The runner resolves execution order automatically via topological sort.
	 */
	dependsOn?: string[];
};

/**
 * Seed record tracked in the database
 */
export type SeedRecord = {
	id: string;
	category: SeedCategory;
	executedAt: Date;
};

/**
 * Seed status information
 */
export type SeedStatus = {
	/** Seeds that haven't been run yet */
	pending: Array<{ id: string; category: SeedCategory; description?: string }>;
	/** Seeds that have been executed */
	executed: SeedRecord[];
};

/**
 * Options for running seeds
 */
export type RunSeedsOptions = {
	/** Filter by category (run only seeds of this category) */
	category?: SeedCategory | SeedCategory[];
	/** Run specific seed(s) by ID */
	only?: string[];
	/** Force re-run even if already executed */
	force?: boolean;
	/** Dry-run: wrap in transaction, then rollback. Validates seed compatibility without side-effects. */
	validate?: boolean;
	/** Suppress info logs */
	silent?: boolean;
};

/**
 * Options for resetting seed tracking
 */
export type ResetSeedsOptions = {
	/** Reset tracking for specific seed(s) only */
	only?: string[];
};

/**
 * Seeds configuration in QuestpieConfig
 */
export type SeedsConfig = {
	/** Seed definitions passed via .build() method */
	seeds?: Seed[];
};

/**
 * Resolve autoSeed shorthand to category arrays.
 * - "required" → ["required"]
 * - "dev" → ["required", "dev"]
 * - "test" → ["required", "test"]
 * - true → undefined (all)
 * - false → null (none)
 */
export function resolveAutoSeedCategories(
	autoSeed: boolean | SeedCategory | SeedCategory[],
): SeedCategory[] | undefined {
	if (autoSeed === false) return undefined;
	if (autoSeed === true) return undefined; // undefined means "all"
	if (Array.isArray(autoSeed)) return autoSeed;

	// Shorthand: "dev" means "required + dev", "test" means "required + test"
	switch (autoSeed) {
		case "required":
			return ["required"];
		case "dev":
			return ["required", "dev"];
		case "test":
			return ["required", "test"];
		default:
			return [autoSeed];
	}
}
