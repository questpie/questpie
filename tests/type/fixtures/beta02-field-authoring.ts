import { constraint, defineCollection, field, seed } from "questpie";

const measurements = defineCollection({
	name: "measurements",
	fields: {
		id: field.bigint({ minimum: "0", maximum: "9223372036854775807" }),
		amount: field.numeric({ precision: 12, scale: 4 }),
		day: field.date({ nullable: true }),
		label: field.text({ default: "pending" }),
		enabled: field.boolean({ default: true }),
		position: field.integer({ default: 0 }),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
	},
});

seed.insert(measurements, {
	id: "9223372036854775807",
	amount: "12345678.9000",
});

// @ts-expect-error bigint is canonical int8 text, never a JavaScript bigint
seed.insert(measurements, { id: 1n, amount: "1.0000" });
// @ts-expect-error numeric is canonical fixed-scale text, never a number
seed.insert(measurements, { id: "1", amount: 1 });
// @ts-expect-error date is canonical YYYY-MM-DD text
seed.insert(measurements, { id: "1", amount: "1.0000", day: new Date() });

field.text({ default: "ready" });
field.boolean({ default: false });
field.integer({ default: 42 });

// @ts-expect-error bigint literal schema defaults are deferred in v1
field.bigint({ default: "1" });
// @ts-expect-error numeric literal schema defaults are deferred in v1
field.numeric({ precision: 4, scale: 2, default: "1.00" });
// @ts-expect-error date literal schema defaults are deferred in v1
field.date({ default: "2026-08-15" });
