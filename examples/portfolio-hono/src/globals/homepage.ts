/**
 * Homepage Global
 *
 * Configuration for the homepage content.
 * Demonstrates:
 * - JSON arrays (featured project IDs)
 * - Localized hero content
 */

import { defineGlobal } from "@questpie/cms/server";
import { varchar, text, jsonb } from "drizzle-orm/pg-core";

export const homepage = defineGlobal("homepage")
	.fields({
		// Hero section
		heroTitle: varchar("hero_title", { length: 255 }).notNull(),
		heroSubtitle: text("hero_subtitle"),
		heroImage: varchar("hero_image", { length: 500 }),
		heroCta: varchar("hero_cta", { length: 100 }),
		heroCtaLink: varchar("hero_cta_link", { length: 500 }),
		// Featured content
		featuredProjectIds: jsonb("featured_project_ids").$type<string[]>(),
		featuredServiceIds: jsonb("featured_service_ids").$type<string[]>(),
		// About section
		aboutTitle: varchar("about_title", { length: 255 }),
		aboutContent: text("about_content"),
		aboutImage: varchar("about_image", { length: 500 }),
	})
	.localized([
		"heroTitle",
		"heroSubtitle",
		"heroCta",
		"aboutTitle",
		"aboutContent",
	])
	.access({
		read: true,
		update: ({ user }) => !!user,
	});
