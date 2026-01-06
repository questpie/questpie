/**
 * Site Settings Global
 *
 * Singleton configuration for the entire site.
 * Demonstrates:
 * - Global definition
 * - Localized fields
 * - JSON typed fields
 */

import { defineGlobal } from "@questpie/cms/server";
import { varchar, text, jsonb } from "drizzle-orm/pg-core";

type SocialLinks = {
	twitter?: string;
	linkedin?: string;
	github?: string;
	instagram?: string;
	youtube?: string;
};

type SEODefaults = {
	defaultTitle?: string;
	defaultDescription?: string;
	titleSuffix?: string;
	ogImage?: string;
};

export const siteSettings = defineGlobal("site_settings")
	.fields({
		// Branding
		siteName: varchar("site_name", { length: 255 }).notNull(),
		tagline: varchar("tagline", { length: 500 }),
		logo: varchar("logo", { length: 500 }),
		favicon: varchar("favicon", { length: 500 }),
		// Contact
		contactEmail: varchar("contact_email", { length: 255 }),
		contactPhone: varchar("phone", { length: 50 }),
		address: text("address"),
		// Social
		socialLinks: jsonb("social_links").$type<SocialLinks>(),
		// SEO defaults
		seo: jsonb("seo").$type<SEODefaults>(),
		// Analytics
		googleAnalyticsId: varchar("google_analytics_id", { length: 50 }),
	})
	.localized(["tagline", "address"])
	.access({
		read: true,
		update: ({ user }) => !!user,
	});
