/**
 * Cities Collection (Tenant)
 *
 * This is the tenant collection - not scoped itself, but provides the scope for other collections.
 */

import { uniqueIndex } from "drizzle-orm/pg-core";
import { qb } from "@/questpie/server/builder";

export const cities = qb
	.collection("cities")
	.fields((f) => ({
		name: f.text({
			label: "City Name",
			required: true,
			maxLength: 255,
		}),
		slug: f.text({
			label: "Slug",
			required: true,
			maxLength: 100,
			description: "URL-friendly identifier (e.g., 'london', 'manchester')",
		}),
		logo: f.upload({
			label: "City Logo/Crest",
			accept: ["image/*"],
		}),
		email: f.text({
			label: "Contact Email",
			maxLength: 255,
		}),
		phone: f.text({
			label: "Contact Phone",
			maxLength: 50,
		}),
		address: f.textarea({
			label: "Address",
			description: "Full postal address of the city council",
		}),
		website: f.text({
			label: "External Website",
			maxLength: 255,
			description: "Link to the official city website (if different)",
		}),
		population: f.number({
			label: "Population",
			description: "Approximate population",
		}),
		isActive: f.boolean({
			label: "Active",
			default: true,
			description: "Whether this city portal is publicly accessible",
		}),
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
		v.table({
			columns: ["name", "slug", "email", "isActive"],
		}),
	)
	.form(({ v, f }) =>
		v.form({
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
