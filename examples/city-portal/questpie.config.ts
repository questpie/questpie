/**
 * Questpie Configuration for CLI
 */

import { cms } from "@/questpie/server/cms";

export const config = {
	app: cms,
	cli: {
		migrations: {
			directory: "./src/migrations",
		},
	},
};

export default config;
