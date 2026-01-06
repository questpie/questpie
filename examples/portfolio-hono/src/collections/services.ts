/**
 * Services Collection
 *
 * Agency/freelancer services offered.
 * Demonstrates:
 * - Price handling (stored in cents)
 * - Icon field
 * - Ordering
 */

import { defineCollection } from "@questpie/cms/server";
import { varchar, text, integer, boolean } from "drizzle-orm/pg-core";

export const services = defineCollection("services")
	.fields({
		// Service name
		title: varchar("title", { length: 255 }).notNull(),
		// Short tagline
		tagline: varchar("tagline", { length: 255 }),
		// Full description
		description: text("description"),
		// Icon identifier (e.g., "code", "design", "strategy")
		icon: varchar("icon", { length: 100 }),
		// Price in cents (null = "Contact for quote")
		priceFrom: integer("price_from"),
		priceTo: integer("price_to"),
		priceUnit: varchar("price_unit", { length: 50 }).default("project"),
		// Display
		featured: boolean("featured").default(false).notNull(),
		order: integer("order").default(0).notNull(),
		isActive: boolean("is_active").default(true).notNull(),
	})
	.localized(["title", "tagline", "description"])
	.title((t, i18n) => i18n.title)
	.access({
		read: true,
		create: ({ user }) => !!user,
		update: ({ user }) => !!user,
		delete: ({ user }) => user?.role === "admin",
	});
