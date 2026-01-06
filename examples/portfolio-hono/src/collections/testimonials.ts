/**
 * Testimonials Collection
 *
 * Client testimonials/reviews.
 * Demonstrates:
 * - Simple collection
 * - Featured flag for homepage
 */

import { defineCollection } from "@questpie/cms/server";
import { varchar, text, boolean, integer } from "drizzle-orm/pg-core";

export const testimonials = defineCollection("testimonials")
	.fields({
		// Client info
		clientName: varchar("client_name", { length: 255 }).notNull(),
		clientCompany: varchar("client_company", { length: 255 }),
		clientRole: varchar("client_role", { length: 255 }),
		clientAvatar: varchar("client_avatar", { length: 500 }),
		// Testimonial content (localized)
		content: text("content").notNull(),
		// Optional project reference
		projectId: varchar("project_id", { length: 255 }),
		// Display
		rating: integer("rating"), // 1-5
		featured: boolean("featured").default(false).notNull(),
		order: integer("order").default(0).notNull(),
	})
	.localized(["content"])
	.title((t) => t.clientName)
	.relations(({ table, one }) => ({
		project: one("projects", {
			fields: [table.projectId],
			references: ["id"],
		}),
	}))
	.access({
		read: true,
		create: ({ user }) => !!user,
		update: ({ user }) => !!user,
		delete: ({ user }) => user?.role === "admin",
	});
