import { collection } from "#questpie/factories";

export const materials = collection("materials")
	.fields(({ f }) => ({
		name: f.text(255).label("Name").required(),
		sku: f.text(64).label("SKU").required(),
		unit: f
			.select([
				{ value: "pcs", label: "Pieces" },
				{ value: "kg", label: "Kilograms" },
				{ value: "m", label: "Meters" },
				{ value: "l", label: "Liters" },
			])
			.label("Unit")
			.required()
			.default("pcs"),
		onHand: f.number().label("On hand").required().default(0),
		reorderPoint: f.number().label("Reorder point").required().default(0),
		leadTimeDays: f.number().label("Lead time days").required().default(3),
		isActive: f.boolean().label("Active").required().default(true),
	}))
	.title(({ f }) => f.name)
	.admin(({ c }) => ({
		label: "Materials",
		icon: c.icon("ph:package"),
	}))
	.list(({ v, f }) =>
		v.collectionTable({
			columns: [f.name, f.sku, f.unit, f.onHand, f.reorderPoint, f.isActive],
			defaultSort: { field: f.name, direction: "asc" },
		}),
	)
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [f.isActive, f.unit],
			},
			fields: [
				{
					type: "section",
					label: "Identity",
					layout: "grid",
					columns: 2,
					fields: [f.name, f.sku],
				},
				{
					type: "section",
					label: "Stock planning",
					layout: "grid",
					columns: 3,
					fields: [f.onHand, f.reorderPoint, f.leadTimeDays],
				},
			],
		}),
	);
