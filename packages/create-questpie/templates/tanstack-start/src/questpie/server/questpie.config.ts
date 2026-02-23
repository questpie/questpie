/**
 * QUESTPIE Configuration
 *
 * Central config using config() API.
 * Collections, globals, functions, and jobs are discovered
 * from the file convention by `questpie generate`.
 */

import { admin } from "@questpie/admin/server";
import { ConsoleAdapter, config } from "questpie";
import { env } from "@/lib/env.js";
import { migrations } from "../../migrations/index.js";
import { configureDashboard } from "./dashboard.js";
import { configureSidebar } from "./sidebar.js";

export default config({
	modules: [
		admin({
			branding: { name: "{{projectName}}" },
			sidebar: configureSidebar,
			dashboard: configureDashboard,
		}),
	],
	app: { url: env.APP_URL },
	db: { url: env.DATABASE_URL },
	auth: {
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: false,
		},
		baseURL: env.APP_URL,
		basePath: "/api/auth",
		secret: env.BETTER_AUTH_SECRET,
	},
	storage: { basePath: "/api" },
	email: {
		adapter: new ConsoleAdapter({ logHtml: false }),
	},
	migrations,
});
