/**
 * Projects Collection
 *
 * Portfolio projects with rich content, categories, and images.
 * Demonstrates:
 * - Localized fields (title, description)
 * - Relations (category, images)
 * - Hooks (auto-slug, publish date)
 * - Access control
 * - Title expression
 */

import { defineCollection, getCMSFromContext } from "@questpie/cms/server";
import { varchar, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import type { AppCMS } from "../cms";

// Slugify helper
function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\w\s-]/g, "")
		.replace(/\s+/g, "-")
		.replace(/--+/g, "-")
		.trim();
}

export const projects = defineCollection("projects")
	.fields({
		// URL-friendly identifier
		slug: varchar("slug", { length: 255 }).notNull().unique(),
		// Localized content
		title: varchar("title", { length: 255 }).notNull(),
		description: text("description"),
		// Rich text content (Tiptap JSON)
		content: jsonb("content").$type<Record<string, unknown>>(),
		// Featured image (storage reference)
		featuredImage: varchar("featured_image", { length: 500 }),
		// Category relation
		categoryId: varchar("category_id", { length: 255 }),
		// Display options
		featured: boolean("featured").default(false).notNull(),
		// Publishing
		status: varchar("status", { length: 50 }).default("draft").notNull(),
		publishedAt: timestamp("published_at", { mode: "date" }),
		// SEO
		metaTitle: varchar("meta_title", { length: 255 }),
		metaDescription: varchar("meta_description", { length: 500 }),
	})
	// Mark fields that support multiple languages
	.localized([
		"title",
		"description",
		"content",
		"metaTitle",
		"metaDescription",
	])
	// Computed title for search and display
	.title((t, i18n) => i18n.title)
	// Define relations
	.relations(({ table, one, many }) => ({
		category: one("categories", {
			fields: [table.categoryId],
			references: ["id"],
		}),
		images: many("project_images", {
			relationName: "project-images",
		}),
	}))
	// Lifecycle hooks
	.hooks({
		beforeCreate: async ({ data }) => {
			// Auto-generate slug from title if not provided
			if (!data.slug && data.title) {
				data.slug = slugify(data.title as string);
			}
		},
		beforeUpdate: async ({ data, original }) => {
			// Set publishedAt when first published
			if (data.status === "published" && original.status !== "published") {
				data.publishedAt = new Date();
			}
		},
		afterCreate: async ({ data }) => {
			const cms = getCMSFromContext<AppCMS>();
			// Notify admin about new project
			if (data.status === "published") {
				await cms.queue["notify-new-project"].publish({
					projectId: data.id,
					title: data.title as string,
				});
			}
		},
	})
	// Access control
	.access({
		// Anyone can read published projects
		read: ({ user }) => {
			if (!user) {
				return { status: "published" };
			}
			// Logged in users see all
			return true;
		},
		// Only authenticated users can create/update
		create: ({ user }) => !!user,
		update: ({ user }) => !!user,
		// Only admins can delete
		delete: ({ user }) => user?.role === "admin",
	});
