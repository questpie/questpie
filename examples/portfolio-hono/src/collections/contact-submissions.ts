/**
 * Contact Submissions Collection
 *
 * Contact form submissions from website visitors.
 * Demonstrates:
 * - Form data storage
 * - Status workflow
 * - Hook for email notification
 */

import { defineCollection, getCMSFromContext } from "@questpie/cms/server";
import { varchar, text, timestamp } from "drizzle-orm/pg-core";
import type { AppCMS } from "../cms";

export const contactSubmissions = defineCollection("contact_submissions")
	.fields({
		// Submitter info
		name: varchar("name", { length: 255 }).notNull(),
		email: varchar("email", { length: 255 }).notNull(),
		phone: varchar("phone", { length: 50 }),
		company: varchar("company", { length: 255 }),
		// Message
		subject: varchar("subject", { length: 500 }),
		message: text("message").notNull(),
		// Optional: which service they're interested in
		serviceInterest: varchar("service_interest", { length: 255 }),
		// Status workflow
		status: varchar("status", { length: 50 }).default("new").notNull(),
		// Status: new, read, replied, archived
		repliedAt: timestamp("replied_at", { mode: "date" }),
		// Internal notes
		internalNotes: text("internal_notes"),
	})
	.title((t) => t.name)
	.hooks({
		afterCreate: async ({ data }) => {
			const cms = getCMSFromContext<AppCMS>();
			// Notify admin about new contact submission
			await cms.queue["contact-notification"].publish({
				submissionId: data.id,
				name: data.name,
				email: data.email,
				subject: data.subject || "New contact form submission",
			});
		},
	})
	.access({
		// Contact form is public to create
		create: true,
		// Only authenticated users can read/update
		read: ({ user }) => !!user,
		update: ({ user }) => !!user,
		delete: ({ user }) => user?.role === "admin",
	});
