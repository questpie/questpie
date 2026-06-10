/**
 * Barbershop Runtime Configuration
 *
 * Runtime-only configuration: database, adapters, secrets, and plugins.
 * Entity definitions (collections, functions, etc.) are codegen-generated.
 * Sidebar, dashboard, branding, locale are file conventions.
 * Environment variables are declared + validated in `env.ts`.
 *
 * @see RFC-MODULE-ARCHITECTURE §8.1 (User Project)
 */

import { ConsoleAdapter } from "questpie/adapters/console";
import { pgBossAdapter } from "questpie/adapters/pg-boss";
import { SmtpAdapter } from "questpie/adapters/smtp";
import { runtimeConfig } from "questpie/app";

import { messages } from "@/questpie/server/i18n";

import env from "./env";

export default runtimeConfig({
	app: {
		url: env.APP_URL,
	},
	db: {
		url: env.DATABASE_URL,
	},
	storage: {
		basePath: "/api",
	},
	secret: env.BETTER_AUTH_SECRET,

	translations: {
		messages: messages as Record<string, Record<string, string>>,
	},

	email: {
		adapter:
			env.MAIL_ADAPTER === "console"
				? new ConsoleAdapter({ logHtml: false })
				: new SmtpAdapter({
						transport: {
							host: env.SMTP_HOST,
							port: env.SMTP_PORT,
							secure: false,
						},
					}),
	},

	queue: { adapter: pgBossAdapter({ connectionString: env.DATABASE_URL }) },
});
