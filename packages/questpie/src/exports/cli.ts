#!/usr/bin/env bun
/**
 * CLI exports for questpie/cli
 *
 * These types and helpers are used for questpie.config.ts configuration files
 */
export type {
	QuestpieCliConfig,
	QuestpieConfigFile,
} from "#questpie/cli/config.js";
export { config } from "#questpie/cli/config.js";

import "#questpie/cli/index.js";
