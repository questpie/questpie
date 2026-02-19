import type { Questpie } from "#questpie/server/config/questpie.js";
import type { RequestContext } from "#questpie/server/config/context.js";
import type { QuestpieConfig } from "#questpie/server/config/types.js";

/**
 * Seed categories control when seeds run:
 * - "required": System bootstrap (admin user, default roles, system settings). Runs in every environment.
 * - "dev": Development/demo data (sample content, test users, demo pages).
 * - "test": Test fixtures (known datasets for integration tests).
 */
export type SeedCategory = "required" | "dev" | "test";

/**
 * Context passed to seed run/undo functions.
 * Provides full app access — unlike migrations which only get raw DB.
 */
export type SeedContext<TConfig extends QuestpieConfig = QuestpieConfig> = {
	/** Full app instance — access db, api, auth, storage, queue, etc. */
	app: Questpie<TConfig>;
	/** Pre-created system context for the default locale */
	ctx: RequestContext;
	/** Logger for seed output */
	log: (message: string) => void;
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
export type Seed<TConfig extends QuestpieConfig = QuestpieConfig> = {
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
	run: (ctx: SeedContext<TConfig>) => Promise<void>;

	/**
	 * Optional: Undo the seed — remove seeded data.
	 * Not all seeds need this (e.g., "required" seeds usually don't).
	 */
	undo?: (ctx: SeedContext<TConfig>) => Promise<void>;

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
