/**
 * City Members Collection
 *
 * Links users to cities they can manage, with role-based access.
 */

import { uniqueIndex } from "drizzle-orm/pg-core";
import { qb } from "@/questpie/server/builder";

export const cityMembers = qb
	.collection("cityMembers")
	.fields((f) => ({
		user: f.relation({
			label: "User",
			to: "user",
			required: true,
		}),
		city: f.relation({
			label: "City",
			to: "cities",
			required: true,
		}),
		role: f.select({
			label: "Role",
			options: [
				{ value: "admin", label: "Admin" },
				{ value: "editor", label: "Editor" },
				{ value: "viewer", label: "Viewer" },
			],
			default: "editor",
			required: true,
			description:
				"Admin: full access, Editor: can edit content, Viewer: read only",
		}),
	}))
	.indexes(({ table }) => [
		uniqueIndex("city_members_unique").on(table.user as any, table.city as any),
	])
	.admin(({ c }) => ({
		label: "City Members",
		icon: c.icon("ph:users-three"),
		description: "Manage who can access each city portal",
	}))
	.list(({ v }) =>
		v.table({
			columns: ["user", "city", "role"],
		}),
	)
	.form(({ v, f }) =>
		v.form({
			fields: [
				{
					type: "section",
					label: "Membership",
					layout: "grid",
					columns: 3,
					fields: [f.user, f.city, f.role],
				},
			],
		}),
	);
