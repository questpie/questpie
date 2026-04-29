import { existsSync } from "node:fs";

import { SeedRunner } from "../../server/seed/runner.js";
import type { Seed } from "../../server/seed/types.js";
import { loadQuestpieConfig } from "../config.js";
import {
	parseCsvOption,
	parseSeedCategoryOption,
	resolveCliPath,
} from "../utils.js";

export type SeedAction = "run" | "undo" | "status" | "reset";

export type RunSeedOptions = {
	action: SeedAction;
	configPath: string;
	category?: string;
	only?: string;
	force?: boolean;
	validate?: boolean;
};

/**
 * Run seed commands (run, undo, status, reset)
 *
 * This command:
 * 1. Loads the config
 * 2. Gets seeds from app.config.seeds.seeds
 * 3. Executes the requested action using SeedRunner
 */
export async function runSeedCommand(options: RunSeedOptions): Promise<void> {
	// Resolve config path
	const resolvedConfigPath = resolveCliPath(options.configPath);

	if (!existsSync(resolvedConfigPath)) {
		throw new Error(`Config file not found: ${resolvedConfigPath}`);
	}

	// Load config
	const cmsConfig = await loadQuestpieConfig(resolvedConfigPath);
	const app = cmsConfig.app;

	// Get seeds from Questpie config
	// Supports both flat array (new codegen) and legacy nested format { seeds: [...] }
	const seeds: Seed[] =
		(Array.isArray(app.config.seeds)
			? app.config.seeds
			: app.config.seeds?.seeds) || [];

	if (seeds.length === 0 && options.action !== "reset") {
		console.log("ℹ️  No seeds found");
		console.log(
			"\n💡 Tip: Place seed files in seeds/*.ts and run questpie generate",
		);
		return;
	}

	if (options.action !== "reset") {
		console.log(`🌱 Found ${seeds.length} seed(s)\n`);
	}

	// Parse category filter
	const category = parseSeedCategoryOption(options.category);

	// Parse only filter
	const only = parseCsvOption(options.only);

	// Create seed runner
	const runner = new SeedRunner(app);

	// Execute the requested action
	switch (options.action) {
		case "run":
			await runner.run(seeds, {
				category,
				only,
				force: options.force,
				validate: options.validate,
			});
			break;

		case "undo":
			await runner.undo(seeds, {
				category,
				only,
			});
			break;

		case "status":
			await runner.status(seeds);
			break;

		case "reset":
			await runner.reset({
				only,
			});
			break;

		default:
			throw new Error(`Unknown action: ${options.action}`);
	}
}
