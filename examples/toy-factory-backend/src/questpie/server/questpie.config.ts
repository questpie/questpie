/**
 * QUESTPIE Runtime Configuration
 *
 * Runtime-only configuration: database, adapters, secrets.
 * Entity definitions are codegen-generated.
 */

import { fs } from "files-sdk/fs";
import { ConsoleAdapter } from "questpie/adapters/console";
import { pgBossAdapter } from "questpie/adapters/pg-boss";
import { runtimeConfig } from "questpie/app";

import { env } from "@/lib/env.js";

export default runtimeConfig({
	app: { url: env.APP_URL },
	db: { url: env.DATABASE_URL },
	storage: {
		adapter: fs({ root: "./uploads" }),
		basePath: "/api",
	},
	email: {
		adapter: new ConsoleAdapter({ logHtml: false }),
	},
	queue: {
		adapter: pgBossAdapter({ connectionString: env.DATABASE_URL }),
	},
});
