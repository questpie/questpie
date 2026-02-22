/**
 * Questpie Configuration for CLI
 *
 * This file is used by the Questpie CLI for migrations and other commands.
 * It exports the Questpie instance and CLI-specific settings.
 *
 * @example
 * ```ts
 * export const config = {
 *   app: app,
 *   cli: {
 *     migrations: {
 *       directory: "./src/migrations",
 *     },
 *   },
 * };
 * ```
 */

import { app } from "@/questpie/server/app";

export const config = {
	app: app,
	cli: {
		migrations: {
			directory: "./src/migrations",
		},
	},
};

export default config;
