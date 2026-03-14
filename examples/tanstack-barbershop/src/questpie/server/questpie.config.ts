/**
 * Barbershop Runtime Configuration
 *
 * Runtime-only configuration: database, adapters, secrets, and plugins.
 * Entity definitions (collections, functions, etc.) are codegen-generated.
 * Sidebar, dashboard, branding, locale are file conventions.
 *
 * @see RFC-MODULE-ARCHITECTURE §8.1 (User Project)
 */

import { adminPlugin } from "@questpie/admin/plugin";
import {
	ConsoleAdapter,
	pgBossAdapter,
	runtimeConfig,
	SmtpAdapter,
} from "questpie";
import { messages } from "@/questpie/server/i18n";

const DATABASE_URL =
	process.env.DATABASE_URL || "postgres://localhost/barbershop";

export default runtimeConfig({
	plugins: [adminPlugin()],
	app: {
		url: process.env.APP_URL || "http://localhost:3000",
	},
	db: {
		url: DATABASE_URL,
	},
	storage: {
		basePath: "/api",
	},
	secret: process.env.BETTER_AUTH_SECRET || "demo-secret-change-in-production",

	translations: {
		messages: messages as Record<string, Record<string, string>>,
	},

	email: {
		adapter:
			process.env.MAIL_ADAPTER === "console"
				? new ConsoleAdapter({ logHtml: false })
				: new SmtpAdapter({
						transport: {
							host: process.env.SMTP_HOST || "localhost",
							port: Number.parseInt(process.env.SMTP_PORT || "1025", 10),
							secure: false,
						},
					}),
	},

	queue: { adapter: pgBossAdapter({ connectionString: DATABASE_URL }) },
});
