/**
 * QUESTPIE Runtime Configuration
 *
 * Runtime-only configuration: database, adapters, secrets.
 * Entity definitions (collections, globals, etc.) are codegen-generated.
 * Admin sidebar, dashboard, and branding live in config/admin.ts.
 */

import { runtimeConfig } from "questpie";
import { ConsoleAdapter } from "questpie/adapters/console";

import { env } from "@/lib/env.js";

export default runtimeConfig({
	app: { url: env.APP_URL },
	db: { url: env.DATABASE_URL },
	storage: { basePath: "/api" },
	email: {
		adapter: new ConsoleAdapter({ logHtml: false }),
	},
});
