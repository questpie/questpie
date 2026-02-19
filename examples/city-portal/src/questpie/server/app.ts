import { adminRpc } from "@questpie/admin/server";
import { ConsoleAdapter, pgBossAdapter, SmtpAdapter } from "questpie";
import { qb } from "@/questpie/server/builder";
import {
	announcements,
	cities,
	cityMembers,
	contacts,
	documents,
	news,
	pages,
	submissions,
} from "@/questpie/server/collections";
import { blocks } from "./blocks";
import { dashboard } from "./dashboard";
import { siteSettings } from "./globals";
import { sidebar } from "./sidebar";

const DATABASE_URL =
	process.env.DATABASE_URL || "postgres://localhost/cityportal";

/**
 * App Base Builder
 *
 * Contains the full app configuration (collections, globals, auth, etc.)
 * EXCEPT blocks. This allows blocks to import BaseApp for typed ctx.app
 * access in prefetch functions without circular type dependencies.
 */
export const appBase = qb
	.use(sidebar)
	.use(dashboard)
	.collections({
		cities,
		cityMembers,
		pages,
		news,
		announcements,
		documents,
		contacts,
		submissions,
	})
	.globals({ siteSettings })
	.branding({
		name: "City Portal",
	})
	.locale({
		locales: [
			{
				code: "en",
				label: "English",
				fallback: true,
				flagCountryCode: "gb",
			},
		],
		defaultLocale: "en",
	})
	.adminLocale({
		locales: ["en"],
		defaultLocale: "en",
	})
	.auth({
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: false,
		},
		baseURL: process.env.APP_URL || "http://localhost:3001",
		basePath: "/api/auth",
		secret:
			process.env.BETTER_AUTH_SECRET || "demo-secret-change-in-production",
	});

/**
 * Inferred app type WITHOUT blocks.
 * Use this in block prefetch functions for typed ctx.app access.
 */
export type BaseApp = (typeof appBase)["$inferApp"];

/**
 * Full app instance with blocks registered.
 */
export const app = appBase.blocks(blocks).build({
	app: {
		url: process.env.APP_URL || "http://localhost:3001",
	},
	db: {
		url: DATABASE_URL,
	},
	storage: {
		basePath: "/api",
	},
	secret: process.env.SECRET,
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
		adapter: pgBossAdapter({
			connectionString: DATABASE_URL,
		}),
	},
});

export const appRpc = {
	...adminRpc,
};

export type App = typeof app;
export type AppRpc = typeof appRpc;
