/**
 * Project Images Collection
 *
 * Gallery images for projects.
 * Demonstrates:
 * - One-to-many relation (many images per project)
 * - Storage integration
 * - Ordering
 */

import { defineCollection } from "@questpie/cms/server";
import { varchar, integer } from "drizzle-orm/pg-core";

export const projectImages = defineCollection("project_images")
	.fields({
		// Parent project
		projectId: varchar("project_id", { length: 255 }).notNull(),
		// Image file (storage reference)
		imageUrl: varchar("image_url", { length: 500 }).notNull(),
		// Localized caption
		caption: varchar("caption", { length: 500 }),
		// Alt text for accessibility
		altText: varchar("alt_text", { length: 255 }),
		// Display order
		order: integer("order").default(0).notNull(),
	})
	.localized(["caption", "altText"])
	.relations(({ table, one }) => ({
		project: one("projects", {
			fields: [table.projectId],
			references: ["id"],
			relationName: "project-images",
		}),
	}))
	.access({
		read: true,
		create: ({ user }) => !!user,
		update: ({ user }) => !!user,
		delete: ({ user }) => !!user,
	});
