/**
 * Cities Collection (Tenant)
 *
 * This is the tenant collection - not scoped itself, but provides the scope for other collections.
 */

import { uniqueIndex } from "drizzle-orm/pg-core";
import { collection } from "#questpie/factories";

export default collection("cities")
	.fields(({ f }) => ({
		name: f.text(255).label("City Name").required(),
		slug: f
			.text(100)
			.label("Slug")
			.required()
			.description("URL-friendly identifier (e.g., 'london', 'manchester')"),
		logo: f.upload({ mimeTypes: ["image/*"] }).label("City Logo/Crest"),
		email: f.text(255).label("Contact Email"),
		phone: f.text(50).label("Contact Phone"),
		address: f
			.textarea()
			.label("Address")
			.description("Full postal address of the city council"),
		website: f
			.text(255)
			.label("External Website")
			.description("Link to the official city website (if different)"),
		population: f
			.number()
			.label("Population")
			.description("Approximate population"),
		isActive: f
			.boolean()
			.label("Active")
			.default(true)
			.description("Whether this city portal is publicly accessible"),
	}))
	.indexes(({ table }) => [
		uniqueIndex("cities_slug_unique").on(table.slug as any),
	])
	.title(({ f }) => f.name)
	.admin(({ c }) => ({
		label: "Cities",
		icon: c.icon("ph:buildings"),
		description: "Manage city portals",
	}))
	.list(({ v }) =>
		v.collectionTable({
			columns: ["name", "slug", "email", "isActive"],
		}),
	)
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [f.slug, f.isActive],
			},
			fields: [
				{
					type: "section",
					label: "Basic Information",
					layout: "grid",
					columns: 2,
					fields: [f.name, f.logo],
				},
				{
					type: "section",
					label: "Contact Details",
					layout: "grid",
					columns: 2,
					fields: [f.email, f.phone, f.address, f.website],
				},
				{
					type: "section",
					label: "Additional Info",
					fields: [f.population],
				},
			],
		}),
	);
