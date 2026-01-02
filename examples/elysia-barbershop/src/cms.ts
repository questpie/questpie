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
	ConsoleAdapter,
	createEtherealSmtpAdapter,
	defaultQCMSAuth,
	defineCollection,
	defineEmailTemplate,
	defineJob,
	defineQCMS,
	getCMSFromContext,
	pgBossAdapter,
	SmtpAdapter,
} from "@questpie/cms/server";
import {
	boolean,
	integer,
	jsonb,
	text,
	timestamp,
	varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { blogModule } from "./blog-module";
import * as React from "react";

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
// Email Templates
// ============================================================================

const appointmentConfirmationTemplate = defineEmailTemplate({
	name: "appointment-confirmation",
	schema: z.object({
		customerName: z.string(),
		barberName: z.string(),
		serviceName: z.string(),
		scheduledAt: z.string(),
		appointmentId: z.string(),
	}),
	render: ({ customerName, barberName, serviceName, scheduledAt }) =>
		React.createElement(
			"div",
			null,
			React.createElement("h1", null, `Hello ${customerName}!`),
			React.createElement(
				"p",
				null,
				`Your appointment with ${barberName} for ${serviceName} is confirmed.`,
			),
			React.createElement("p", null, `Scheduled at: ${scheduledAt}`),
			React.createElement("p", null, "See you soon!"),
		),
	subject: (ctx) => `Appointment Confirmed - ${ctx.serviceName}`,
});

const appointmentCancellationTemplate = defineEmailTemplate({
	name: "appointment-cancellation",
	schema: z.object({
		customerName: z.string(),
		serviceName: z.string(),
		scheduledAt: z.string(),
		reason: z.string().optional(),
	}),
	render: ({ customerName, serviceName, scheduledAt, reason }) =>
		React.createElement(
			"div",
			null,
			React.createElement("h1", null, `Hello ${customerName}`),
			React.createElement(
				"p",
				null,
				`Your appointment for ${serviceName} scheduled at ${scheduledAt} has been cancelled.`,
			),
			reason && React.createElement("p", null, `Reason: ${reason}`),
			React.createElement("p", null, "We hope to see you again soon!"),
		),
	subject: () => "Appointment Cancelled",
});

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
		const cms = getCMSFromContext<AppCMS>();
		// Fetch appointment details
		const appointment = await cms.api.collections.appointments.findOne({
			where: { id: payload.appointmentId },
			with: { customer: true },
		});

		if (!appointment) {
			throw new Error(`Appointment ${payload.appointmentId} not found`);
		}

		// Send email using typed template
		await cms.email.sendTemplate({
			template: "appointment-confirmation",
			to: appointment.customer.email,
			context: {
				customerName: appointment.customer.name || "Customer",
				barberName: appointment.barber.name,
				serviceName: appointment.service.name,
				scheduledAt: appointment.scheduledAt.toLocaleString(),
				appointmentId: appointment.id,
			},
		});

		console.log(
			`📧 Sent confirmation email for appointment ${payload.appointmentId} to ${appointment.customer.email}`,
		);
	},
});

const sendAppointmentCancellation = defineJob({
	name: "send-appointment-cancellation",
	schema: z.object({
		appointmentId: z.string(),
		customerId: z.string(),
		reason: z.string().optional(),
	}),
	handler: async (payload) => {
		const cms = getCMSFromContext<AppCMS>();
		const appointment = await cms.api.collections.appointments.findOne({
			where: { id: payload.appointmentId },
			with: { customer: true, service: true },
		});

		if (!appointment) {
			throw new Error(`Appointment ${payload.appointmentId} not found`);
		}

		await cms.email.sendTemplate({
			template: "appointment-cancellation",
			to: appointment.customer.email,
			context: {
				customerName: appointment.customer.name || "Customer",
				serviceName: appointment.service.name,
				scheduledAt: appointment.scheduledAt.toLocaleString(),
				reason: payload.reason,
			},
		});

		console.log(
			`📧 Sent cancellation email for appointment ${payload.appointmentId} to ${appointment.customer.email}`,
		);
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
	process.env.DATABASE_URL || "postgres://localhost/barbershop_elysia";

/**
 * Barbershop CMS Instance
 *
 * Built using the builder pattern for cleaner, more maintainable configuration:
 * - Type-inferrable definitions (collections, jobs, templates, auth) in builder
 * - Runtime adapters (storage, email, queue) in .build()
 * - Clear separation of concerns
 * - Easy to compose and extend
 */
export const cms = defineQCMS({ name: "barbershop" })
	// Configure authentication (type-inferrable)
	.auth((db: any) =>
		defaultQCMSAuth(db, {
			emailPassword: true,
			emailVerification: false, // Simplified for demo
			baseURL: process.env.APP_URL || "http://localhost:3001",
			secret:
				process.env.BETTER_AUTH_SECRET || "demo-secret-change-in-production",
		}),
	)
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
	// Define email templates (type-safe templates)
	.emailTemplates({
		appointmentConfirmation: appointmentConfirmationTemplate,
		appointmentCancellation: appointmentCancellationTemplate,
	})
	// Compose with other modules
	.use(blogModule)
	// Build with runtime configuration (adapters, connection strings, etc.)
	.build({
		app: {
			url: process.env.APP_URL || "http://localhost:3001",
		},
		db: {
			url: DATABASE_URL,
		},
		secret: process.env.SECRET,
		// Runtime: Storage driver
		storage: {
			// driver: fsDriver({ location: './uploads' })
		},
		// Runtime: Email adapter
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
			defaults: {
				from: process.env.MAIL_FROM || "noreply@barbershop.test",
			},
		},
		// Runtime: Queue adapter
		queue: {
			adapter: pgBossAdapter({
				connectionString: DATABASE_URL,
			}),
		},
	});

export type AppCMS = typeof cms;
