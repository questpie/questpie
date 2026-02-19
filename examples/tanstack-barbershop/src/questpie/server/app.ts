import { adminRpc } from "@questpie/admin/server";
import { ConsoleAdapter, pgBossAdapter, SmtpAdapter } from "questpie";
import {
	createBooking,
	getActiveBarbers,
	getAvailableTimeSlots,
	getRevenueStats,
} from "@/questpie/server/functions";
import { messages } from "@/questpie/server/i18n";
import { migrations } from "../../migrations";
import { blocks } from "./blocks";
import { qb } from "./builder";
import {
	appointments,
	barberServices,
	barbers,
	pages,
	reviews,
	services,
} from "./collections";
import { dashboard } from "./dashboard";
import { siteSettings } from "./globals";
import {
	sendAppointmentCancellation,
	sendAppointmentConfirmation,
	sendAppointmentReminder,
} from "./jobs";
import { r } from "./rpc";
import { sidebar } from "./sidebar";

const DATABASE_URL =
	process.env.DATABASE_URL || "postgres://localhost/barbershop";

export const baseApp = qb
	.use(dashboard)
	.use(sidebar)
	.collections({
		barbers,
		services,
		barberServices,
		appointments,
		reviews,
		pages,
	})
	.globals({ siteSettings })
	.branding({
		name: { en: "Barbershop Control", sk: "Riadenie barbershopu" },
	})
	.jobs({
		sendAppointmentConfirmation,
		sendAppointmentCancellation,
		sendAppointmentReminder,
	})
	.locale({
		locales: [
			{
				code: "en",
				label: "English",
				fallback: true,
				flagCountryCode: "us",
			},
			{ code: "sk", label: "Slovenčina" },
		],
		defaultLocale: "en",
	})
	.adminLocale({
		locales: ["en", "sk"],
		defaultLocale: "en",
	})
	.messages({ ...messages })
	.auth({
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: false,
		},
		baseURL: process.env.APP_URL || "http://localhost:3000",
		basePath: "/api/auth",
		secret:
			process.env.BETTER_AUTH_SECRET || "demo-secret-change-in-production",
	});

// Register blocks and build the app
export const app = baseApp.blocks(blocks).build({
	app: {
		url: process.env.APP_URL || "http://localhost:3000",
	},
	db: {
		url: DATABASE_URL,
	},
	storage: {
		basePath: "/api",
	},
	secret: process.env.SECRET,
	migrations,
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

export const appRpc = r.router({
	...adminRpc,
	getActiveBarbers,
	getRevenueStats,
	getAvailableTimeSlots,
	createBooking,
});

export type App = typeof app;
export type AppRpc = typeof appRpc;
