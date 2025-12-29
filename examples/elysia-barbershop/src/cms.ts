/**
 * Barbershop CMS Configuration
 *
 * A complete example showing:
 * - Collections with relations
 * - Better Auth integration
 * - Queue jobs for notifications
 * - Custom business logic
 */

import {
	QCMS,
	defaultQCMSAuth,
	defineCollection,
	defineJob,
	pgBossAdapter,
	SmtpAdapter,
	ConsoleAdapter,
	createEtherealSmtpAdapter,
} from "@questpie/cms/server";
import {
	varchar,
	integer,
	timestamp,
	text,
	boolean,
	jsonb,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { sql } from "drizzle-orm";

// ============================================================================
// Collections
// ============================================================================

type WorkingHours = {
	monday: { start: string; end: string };
	tuesday: { start: string; end: string };
	wednesday: { start: string; end: string };
	thursday: { start: string; end: string };
	friday: { start: string; end: string };
	saturday?: { start: string; end: string };
	sunday?: { start: string; end: string };
};

/**
 * Barbers Collection
 * Represents staff members who provide services
 */
export const barbers = defineCollection("barbers")
	.fields({
		name: varchar("name", { length: 255 }).notNull(),
		email: varchar("email", { length: 255 }).notNull().unique(),
		phone: varchar("phone", { length: 50 }),
		bio: text("bio"),
		avatar: varchar("avatar", { length: 500 }),
		isActive: boolean("is_active").default(true).notNull(),
		// Working hours stored as JSON
		workingHours: jsonb("working_hours").$type<WorkingHours>(),
	})
	.title(({ table }) => sql`${table.name}`);

/**
 * Services Collection
 * Available services at the barbershop
 */
export const services = defineCollection("services")
	.fields({
		name: varchar("name", { length: 255 }).notNull(),
		description: text("description"),
		duration: integer("duration").notNull(), // in minutes
		price: integer("price").notNull(), // in cents
		isActive: boolean("is_active").default(true).notNull(),
	})
	.title(({ table }) => sql`${table.name}`);

/**
 * Appointments Collection
 * Customer bookings with barbers
 */
export const appointments = defineCollection("appointments")
	.fields({
		customerId: varchar("customer_id", { length: 255 }).notNull(),
		barberId: varchar("barber_id", { length: 255 }).notNull(),
		serviceId: varchar("service_id", { length: 255 }).notNull(),
		scheduledAt: timestamp("scheduled_at", { mode: "date" }).notNull(),
		status: varchar("status", { length: 50 }).default("pending").notNull(),
		// Status: pending, confirmed, completed, cancelled, no-show
		notes: text("notes"),
		cancelledAt: timestamp("cancelled_at", { mode: "date" }),
		cancellationReason: text("cancellation_reason"),
	})
	.title(({ table }) => sql`Appointment at  ${table.scheduledAt}`)
	// TODO: Support relation definitions that accept table/column refs (not just strings).
	.relations(({ one, table }) => ({
		// Note: customerId references Better Auth's users table
		customer: one("questpie_users", {
			fields: [table.customerId],
			references: ["id"],
		}),
		barber: one("barbers", {
			fields: [table.barberId],
			references: ["id"],
		}),
		service: one("services", {
			fields: [table.serviceId],
			references: ["id"],
		}),
	}))
	.hooks({
		afterCreate: async ({ data, cms }) => {
			// Send confirmation email after booking
			await cms.queue.publish("send-appointment-confirmation", {
				appointmentId: data.id,
				customerId: data.customerId,
			});
		},
		afterUpdate: async ({ data, cms }) => {
			// Notify customer if appointment is cancelled
			if (data.status === "cancelled" && data.cancelledAt) {
				await cms.queue.publish("send-appointment-cancellation", {
					appointmentId: data.id,
					customerId: data.customerId,
				});
			}
		},
	});

/**
 * Reviews Collection
 * Customer reviews for completed appointments
 */
export const reviews = defineCollection("reviews")
	.fields({
		appointmentId: varchar("appointment_id", { length: 255 })
			.notNull()
			.unique(),
		customerId: varchar("customer_id", { length: 255 }).notNull(),
		barberId: varchar("barber_id", { length: 255 }).notNull(),
		rating: integer("rating").notNull(), // 1-5
		comment: text("comment"),
	})
	.title(({ table }) => sql`'Review #' || ${table.id}`)
	.relations(({ one, table }) => ({
		appointment: one("appointments", {
			fields: [table.appointmentId],
			references: ["id"],
		}),
		customer: one("questpie_users", {
			fields: [table.customerId],
			references: ["id"],
		}),
		barber: one("barbers", {
			fields: [table.barberId],
			references: ["id"],
		}),
	}));

// ============================================================================
// Queue Jobs
// ============================================================================

const jobs = [
	defineJob({
		name: "send-appointment-confirmation",
		schema: z.object({
			appointmentId: z.string(),
			customerId: z.string(),
		}),
		handler: async (payload) => {
			console.log(
				`📧 Sending confirmation email for appointment ${payload.appointmentId} to customer ${payload.customerId}`,
			);
			// TODO: Implement email sending via context.cms.email
		},
	}),

	defineJob({
		name: "send-appointment-cancellation",
		schema: z.object({
			appointmentId: z.string(),
			customerId: z.string(),
		}),
		handler: async (payload) => {
			console.log(
				`📧 Sending cancellation email for appointment ${payload.appointmentId} to customer ${payload.customerId}`,
			);
			// TODO: Implement email sending
		},
	}),

	defineJob({
		name: "send-appointment-reminder",
		schema: z.object({
			appointmentId: z.string(),
		}),
		handler: async (payload) => {
			console.log(
				`📧 Sending reminder email for appointment ${payload.appointmentId}`,
			);
			// TODO: Implement reminder logic
		},
	}),
];

// ============================================================================
// CMS Instance
// ============================================================================

const DATABASE_URL =
	process.env.DATABASE_URL || "postgres://localhost/barbershop_elysia";

export const cms = new QCMS({
	app: {
		url: process.env.APP_URL || "http://localhost:3001",
	},

	db: {
		connection: {
			url: DATABASE_URL,
		},
	},

	collections: [barbers, services, appointments, reviews],

	auth: (db: any) =>
		defaultQCMSAuth(db, {
			emailPassword: true,
			emailVerification: false, // Simplified for demo
			baseURL: process.env.APP_URL || "http://localhost:3001",
			secret:
				process.env.BETTER_AUTH_SECRET || "demo-secret-change-in-production",
		}),

	storage: {
		// Default: local filesystem storage
		// driver: fsDriver({ location: './uploads' })
	},

	email: {
		adapter:
			process.env.NODE_ENV === "production"
				? // Production: Use real SMTP server
					new SmtpAdapter({
						transport: {
							host: process.env.SMTP_HOST || "localhost",
							port: Number.parseInt(process.env.SMTP_PORT || "587", 10),
							secure: true,
							auth: {
								user: process.env.SMTP_USER || "",
								pass: process.env.SMTP_PASS || "",
							},
						},
					})
				: process.env.MAIL_ADAPTER === "console"
					? // Development: Console logging
						new ConsoleAdapter({ logHtml: false })
					: // Development: Ethereal email with preview URLs (default)
						createEtherealSmtpAdapter(),
		templates: {},
		defaults: {
			from: process.env.MAIL_FROM || "noreply@barbershop.test",
		},
	},

	queue: {
		jobs,
		adapter: pgBossAdapter({
			connectionString: DATABASE_URL,
		}),
	},
});

export type AppCMS = typeof cms;
