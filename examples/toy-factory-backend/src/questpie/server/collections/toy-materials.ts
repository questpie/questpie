import { collection } from "#questpie/factories";

export const toyMaterials = collection("toyMaterials")
	.fields(({ f }) => ({
		toy: f.relation("toys").label("Toy").required(),
		material: f.relation("materials").label("Material").required(),
		quantityPerUnit: f.number().label("Quantity per toy").required().default(1),
		wastePercent: f.number().label("Waste percent").required().default(0),
	}))
	.title(({ f }) => f.material)
	.admin(({ c }) => ({
		label: "Bill of Materials",
		icon: c.icon("ph:list-checks"),
	}))
	.list(({ v, f }) =>
		v.collectionTable({
			columns: [f.toy, f.material, f.quantityPerUnit, f.wastePercent],
		}),
	)
	.form(({ v, f }) =>
		v.collectionForm({
			fields: [
				{
					type: "section",
					label: "Requirement",
					layout: "grid",
					columns: 2,
					fields: [f.toy, f.material, f.quantityPerUnit, f.wastePercent],
				},
			],
		}),
	);
