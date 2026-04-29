/**
 * City Portal Runtime Configuration
 *
 * Runtime-only configuration: database, adapters, secrets.
 * Entity definitions (collections, globals, etc.) are codegen-generated.
 * Sidebar, dashboard, branding, locale, context are file conventions.
 */

import {
	ConsoleAdapter,
	pgBossAdapter,
	runtimeConfig,
	SmtpAdapter,
} from "questpie";

const DATABASE_URL =
	process.env.DATABASE_URL || "postgres://localhost/cityportal";

export default runtimeConfig({
	app: {
		url: process.env.APP_URL || "http://localhost:3001",
	},
	db: {
		url: DATABASE_URL,
	},
	storage: {
		basePath: "/api",
	},
	secret: process.env.BETTER_AUTH_SECRET || "demo-secret-change-in-production",

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

	queue: {
		adapter: pgBossAdapter({ connectionString: DATABASE_URL }),
	},

	cli: {
		migrations: { directory: "./src/migrations" },
	},
});
