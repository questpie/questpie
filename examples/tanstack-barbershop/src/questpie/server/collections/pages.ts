import { uniqueIndex } from "drizzle-orm/pg-core";
import { qb } from "@/questpie/server/builder";

/**
 * Pages Collection
 *
 * Demonstrates the Block System from Feature Pack V2.
 * Content is stored as JSONB with localized block content.
 */
export const pages = qb
	.collection("pages")
	.fields((f) => ({
		// Basic page info (localized)
		title: f.text({ required: true, maxLength: 255, localized: true }),
		slug: f.text({ required: true, maxLength: 255 }),
		description: f.textarea({ localized: true }),

		// Block content - stored as JSONB with localized values
		content: f.blocks({ localized: true }),

		// SEO fields
		metaTitle: f.text({ maxLength: 255, localized: true }),
		metaDescription: f.textarea({ localized: true }),

		// Publishing
		isPublished: f.boolean({ default: false, required: true }),
	}))
	.indexes(({ table }) => [
		uniqueIndex("pages_slug_unique").on(table.slug as any),
	])
	.title(({ f }) => f.title);
