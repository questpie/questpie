/**
 * City Members Collection
 *
 * Links users to cities they can manage, with role-based access.
 */

import { uniqueIndex } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

export default collection("cityMembers")
	.fields(({ f }) => ({
		user: f.relation("user").label("User").required(),
		city: f.relation("cities").label("City").required(),
		role: f
			.select([
				{ value: "admin", label: "Admin" },
				{ value: "editor", label: "Editor" },
				{ value: "viewer", label: "Viewer" },
			])
			.label("Role")
			.default("editor")
			.required()
			.description(
				"Admin: full access, Editor: can edit content, Viewer: read only",
			),
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
		v.collectionTable({
			columns: ["user", "city", "role"],
		}),
	)
	.form(({ v, f }) =>
		v.collectionForm({
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
