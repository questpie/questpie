/**
 * Team Members Collection
 *
 * Team/staff profiles.
 * Demonstrates:
 * - Avatar storage
 * - Social links as JSON
 * - Ordering
 */

import { defineCollection } from "@questpie/cms/server";
import { varchar, text, integer, jsonb } from "drizzle-orm/pg-core";

type SocialLinks = {
	twitter?: string;
	linkedin?: string;
	github?: string;
	dribbble?: string;
	website?: string;
};

export const teamMembers = defineCollection("team_members")
	.fields({
		name: varchar("name", { length: 255 }).notNull(),
		// Role/position (localized)
		role: varchar("role", { length: 255 }).notNull(),
		// Bio (localized)
		bio: text("bio"),
		// Avatar image (storage reference)
		avatar: varchar("avatar", { length: 500 }),
		// Contact
		email: varchar("email", { length: 255 }),
		// Social links
		socialLinks: jsonb("social_links").$type<SocialLinks>(),
		// Display order
		order: integer("order").default(0).notNull(),
	})
	.localized(["role", "bio"])
	.title((t) => t.name)
	.access({
		read: true,
		create: ({ user }) => !!user,
		update: ({ user }) => !!user,
		delete: ({ user }) => user?.role === "admin",
	});
