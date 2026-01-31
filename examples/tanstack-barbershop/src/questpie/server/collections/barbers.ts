import { boolean, jsonb, varchar } from "drizzle-orm/pg-core";
import { q } from "questpie";

export type DaySchedule = {
	isOpen: boolean;
	start: string;
	end: string;
};

export type WorkingHours = {
	monday: DaySchedule;
	tuesday: DaySchedule;
	wednesday: DaySchedule;
	thursday: DaySchedule;
	friday: DaySchedule;
	saturday?: DaySchedule | null;
	sunday?: DaySchedule | null;
};

export type SocialLink = {
	platform: "instagram" | "facebook" | "twitter" | "linkedin" | "tiktok";
	url: string;
};

/**
 * Simple slugify function
 * Converts "John Smith" to "john-smith"
 */
function slugify(text: string): string {
	return text
		.toLowerCase()
		.trim()
		.replace(/[^\w\s-]/g, "") // Remove non-word chars
		.replace(/[\s_-]+/g, "-") // Replace spaces/underscores with hyphens
		.replace(/^-+|-+$/g, ""); // Remove leading/trailing hyphens
}

/**
 * Barbers Collection
 *
 * Staff members who provide services.
 * Features:
 * - Auto-generated slug from name
 * - Localized bio field
 * - Working hours configuration
 * - Social media links
 * - M:N relation to services
 */
export const barbers = q
	.collection("barbers")
	.fields({
		name: varchar("name", { length: 255 }).notNull(),
		slug: varchar("slug", { length: 255 }).notNull().unique(),
		email: varchar("email", { length: 255 }).notNull().unique(),
		phone: varchar("phone", { length: 50 }),
		bio: jsonb("bio"),
		avatar: varchar("avatar", { length: 500 }),
		isActive: boolean("is_active").default(true).notNull(),
		workingHours: jsonb("working_hours").$type<WorkingHours>(),
		socialLinks: jsonb("social_links").$type<SocialLink[]>(),
		specialties: jsonb("specialties").$type<string[]>(),
	})
	.localized(["bio", "specialties"])
	.relations(({ one, table, manyToMany }) => ({
		// Relation to assets collection for avatar image
		avatar: one("assets", {
			fields: [table.avatar],
			references: ["id"],
		}),
		// M:N relation to services (through barber_services junction)
		services: manyToMany("services", {
			through: "barberServices",
			sourceField: "barberId",
			targetField: "serviceId",
		}),
	}))
	.title(({ f }) => f.name)
	.hooks({
		beforeValidate: async ({ data, operation }) => {
			// Auto-generate slug from name on create
			if (operation === "create") {
				const d = data as { name?: string; slug?: string };
				if (d.name && !d.slug) {
					d.slug = slugify(d.name);
				}
			}
		},
	});
