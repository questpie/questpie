/**
 * QUESTPIE Runtime Configuration
 *
 * Runtime-only configuration: database, adapters, secrets.
 * Entity definitions (collections, globals, etc.) are codegen-generated.
 * Sidebar, dashboard, branding are file conventions.
 */

import { ConsoleAdapter, runtimeConfig } from "questpie";

import { env } from "@/lib/env.js";
import { adminPlugin } from "@questpie/admin/plugin";

export default runtimeConfig({
	plugins: [adminPlugin()],
	app: { url: env.APP_URL },
	db: { url: env.DATABASE_URL },
	storage: { basePath: "/api" },
	email: {
		adapter: new ConsoleAdapter({ logHtml: false }),
	},
});
