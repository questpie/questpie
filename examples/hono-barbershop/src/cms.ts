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
	defineQCMS,
	defaultQCMSAuth,
	defineCollection,
	defineJob,
	pgBossAdapter,
	ConsoleAdapter,
	SmtpAdapter,
	getCMSFromContext,
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

// ============================================================================
// Collections
// ============================================================================

type WorkingHours = {
	monday: { start: string; end: string };
	tuesday: { start: string; end: string };
	wednesday: { start: string; end: string };
	thursday: { start: string; end: string };
	friday: { start: string; end: string };
	saturday?: { start: string; end: string } | null;
	sunday?: { start: string; end: string } | null;
};

/**
 * Barbers Collection
 * Represents staff members who provide services
 */
export const barbers = defineCollection("barbers").fields({
	name: varchar("name", { length: 255 }).notNull(),
	email: varchar("email", { length: 255 }).notNull().unique(),
	phone: varchar("phone", { length: 50 }),
	bio: text("bio"),
	avatar: varchar("avatar", { length: 500 }),
	isActive: boolean("is_active").default(true).notNull(),
	// Working hours stored as JSON
	workingHours: jsonb("working_hours").$type<WorkingHours>(),
});

/**
 * Services Collection
 * Available services at the barbershop
 */
export const services = defineCollection("services").fields({
	name: varchar("name", { length: 255 }).notNull(),
	description: text("description"),
	duration: integer("duration").notNull(), // in minutes
	price: integer("price").notNull(), // in cents
	isActive: boolean("is_active").default(true).notNull(),
});

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
		afterCreate: async ({ data }) => {
			const cms = getCMSFromContext<AppCMS>();
			// Send confirmation email after booking (type-safe job publishing)
			await cms.queue["send-appointment-confirmation"].publish({
				appointmentId: data.id,
				customerId: data.customerId,
			});
		},
		afterUpdate: async ({ data }) => {
			const cms = getCMSFromContext<AppCMS>();
			// Notify customer if appointment is cancelled
			if (data.status === "cancelled" && data.cancelledAt) {
				await cms.queue["send-appointment-cancellation"].publish({
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

const sendAppointmentConfirmation = defineJob({
	name: "send-appointment-confirmation",
	schema: z.object({
		appointmentId: z.string(),
		customerId: z.string(),
	}),
	handler: async (payload) => {
		console.log(
			`📧 Sending confirmation email for appointment ${payload.appointmentId} to customer ${payload.customerId}`,
		);
		// TODO: Implement email sending via getCMSFromContext().email
	},
});

const sendAppointmentCancellation = defineJob({
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
});

const sendAppointmentReminder = defineJob({
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
});

// ============================================================================
// CMS Instance (Builder Pattern)
// ============================================================================

const DATABASE_URL =
	process.env.DATABASE_URL || "postgres://localhost/barbershop";

/**
 * Barbershop CMS Instance
 *
 * Built using the builder pattern for cleaner, more maintainable configuration:
 * - Collections/jobs are defined as maps (not arrays) for type-safe access
 * - Definition-time config (collections, jobs, auth) separated from runtime config (db url, secrets)
 * - Easy to compose and extend
 */
export const cms = defineQCMS({ name: "barbershop" })
	// Define collections (as a map for type-safe access)
	.collections({
		barbers,
		services,
		appointments,
		reviews,
	})
	// Define background jobs
	.jobs({
		sendAppointmentConfirmation,
		sendAppointmentCancellation,
		sendAppointmentReminder,
	})
	// Configure authentication (Better Auth)
	.auth((db: any) =>
		defaultQCMSAuth(db, {
			emailPassword: true,
			emailVerification: false, // Simplified for demo
			baseURL: process.env.APP_URL || "http://localhost:3000",
			secret:
				process.env.BETTER_AUTH_SECRET || "demo-secret-change-in-production",
		}),
	)
	// Build the final instance with runtime configuration
	.build({
		app: {
			url: process.env.APP_URL || "http://localhost:3000",
		},
		db: {
			url: DATABASE_URL,
		},
		secret: process.env.SECRET,
		// Configure storage (local filesystem by default)
		storage: {
			// driver: fsDriver({ location: "./uploads" })
		},
		// Configure email
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
		// Configure queue adapter
		queue: {
			adapter: pgBossAdapter({
				connectionString: DATABASE_URL,
			}),
		},
	});

export type AppCMS = typeof cms;
