import {
	constraint,
	defineCollection,
	field,
	index,
	seed,
	shape,
} from "questpie";

const customers = defineCollection({
	name: "customers",
	fields: {
		id: field.uuid(),
		address: shape.inline({
			fields: {
				city: field.text({ maxLength: 160 }),
				geo: shape.inline({
					fields: {
						latitude: field.numeric({ precision: 8, scale: 5 }),
						longitude: field.numeric({ precision: 8, scale: 5 }),
					},
				}),
			},
		}),
		"address.city": field.text(),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
		city: constraint.unique({ fields: [["address", "city"]] }),
	},
	indexes: {
		location: index({
			fields: [
				{
					field: ["address", "geo", "latitude"],
					order: "desc",
					nulls: "first",
				},
				["address", "geo", "longitude"],
			],
		}),
	},
});

seed.insert(customers, {
	id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
	address: {
		city: "Bratislava",
		geo: { latitude: "48.14860", longitude: "17.10770" },
	},
	"address.city": "literal top-level key",
});
seed.insert(customers, {
	id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
	// @ts-expect-error every required inline leaf must be present
	address: { city: "Bratislava" },
	"address.city": "literal top-level key",
});

// @ts-expect-error an inline shape cannot be empty
shape.inline({ fields: {} });

index({
	fields: [
		// @ts-expect-error B-tree order is a closed asc/desc choice
		{ field: "id", order: "sideways" },
	],
});

defineCollection({
	name: "invalid",
	fields: {
		id: field.uuid(),
		address: shape.inline({ fields: { city: field.text() } }),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
		// @ts-expect-error nested references use segment tuples, never dotted paths
		invalid: constraint.unique({ fields: ["address.city"] }),
	},
});
