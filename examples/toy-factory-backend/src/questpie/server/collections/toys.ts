import { collection } from "#questpie/factories";

export const toys = collection("toys")
	.fields(({ f }) => ({
		name: f.text(255).label("Name").required(),
		sku: f.text(64).label("SKU").required(),
		status: f
			.select([
				{ value: "prototype", label: "Prototype" },
				{ value: "active", label: "Active" },
				{ value: "paused", label: "Paused" },
				{ value: "retired", label: "Retired" },
			])
			.label("Status")
			.required()
			.default("active"),
		minutesPerUnit: f.number().label("Minutes per unit").required().default(12),
		safetyStock: f.number().label("Safety stock").required().default(20),
		notes: f.textarea().label("Production notes"),
	}))
	.title(({ f }) => f.name)
	.admin(({ c }) => ({
		label: "Toys",
		icon: c.icon("ph:puzzle-piece"),
	}))
	.list(({ v, f }) =>
		v.collectionTable({
			columns: [f.name, f.sku, f.status, f.minutesPerUnit, f.safetyStock],
			defaultSort: { field: f.name, direction: "asc" },
		}),
	)
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [f.status, f.safetyStock],
			},
			fields: [
				{
					type: "section",
					label: "Toy",
					layout: "grid",
					columns: 2,
					fields: [f.name, f.sku],
				},
				{
					type: "section",
					label: "Production",
					layout: "grid",
					columns: 2,
					fields: [f.minutesPerUnit, f.notes],
				},
			],
		}),
	);
