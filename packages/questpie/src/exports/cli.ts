#!/usr/bin/env bun
/**
 * CLI exports for questpie/cli
 *
 * These types and helpers are used for questpie.config.ts configuration files
 */
import { program } from "#questpie/cli/index.js";

export type {
	PackageConfig,
	QuestpieCliConfig,
	QuestpieConfigFile,
} from "#questpie/cli/config.js";
export { config, packageConfig } from "#questpie/cli/config.js";

export { program };

// Only run the CLI when this file is the process entry (bin or `bun run`).
// Config files import "questpie/cli" for packageConfig — that import must be
// side-effect-free: in the workspace it resolves to a second module instance
// (src vs dist), and a top-level parse would start the in-flight command a
// second time in the same process, corrupting .generated output.
if (import.meta.main) {
	program.parse();
}
