import { collection } from "#questpie/factories";

export const inventoryMovements = collection("inventoryMovements")
	.fields(({ f }) => ({
		material: f.relation("materials").label("Material").required(),
		productionOrder: f.relation("productionOrders").label("Production order"),
		direction: f
			.select([
				{ value: "receipt", label: "Receipt" },
				{ value: "consume", label: "Consume" },
				{ value: "adjust", label: "Adjust" },
			])
			.label("Direction")
			.required(),
		quantity: f.number().label("Quantity").required(),
		reason: f.text(255).label("Reason"),
		occurredAt: f.datetime().label("Occurred at").required(),
	}))
	.title(({ f }) => f.reason)
	.admin(({ c }) => ({
		label: "Inventory Movements",
		icon: c.icon("ph:arrows-left-right"),
	}))
	.list(({ v, f }) =>
		v.collectionTable({
			columns: [
				f.occurredAt,
				f.material,
				f.direction,
				f.quantity,
				f.productionOrder,
			],
			defaultSort: { field: f.occurredAt, direction: "desc" },
		}),
	)
	.form(({ v, f }) =>
		v.collectionForm({
			fields: [
				{
					type: "section",
					label: "Movement",
					layout: "grid",
					columns: 2,
					fields: [
						f.material,
						f.productionOrder,
						f.direction,
						f.quantity,
						f.occurredAt,
						f.reason,
					],
				},
			],
		}),
	);
