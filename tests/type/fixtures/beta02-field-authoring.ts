import { constraint, defineCollection, field, seed } from "questpie";

const measurements = defineCollection({
	name: "measurements",
	fields: {
		id: field.bigint({
			nullable: false,
			minimum: "0",
			maximum: "9223372036854775807",
		}),
		amount: field.numeric({ nullable: false, precision: 12, scale: 4 }),
		day: field.date({ nullable: true }),
		label: field.text({ nullable: false, default: "pending" }),
		enabled: field.boolean({ nullable: false, default: true }),
		position: field.integer({ nullable: false, default: 0 }),
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

field.text({ nullable: false, default: "ready" });
field.boolean({ nullable: false, default: false });
field.integer({ nullable: false, default: 42 });

// @ts-expect-error every public Field constructor requires explicit nullability
field.uuid({});
// @ts-expect-error every public Field constructor requires its options object
field.uuid();

// @ts-expect-error Field options are an exact closed contract
field.uuid({ nullable: false, unknown: true });
// @ts-expect-error timestamp flags are booleans
field.timestamp({ nullable: false, withTimezone: "yes" });

// @ts-expect-error bigint literal schema defaults are deferred in v1
field.bigint({ nullable: false, default: "1" });
// @ts-expect-error numeric literal schema defaults are deferred in v1
field.numeric({ nullable: false, precision: 4, scale: 2, default: "1.00" });
// @ts-expect-error date literal schema defaults are deferred in v1
field.date({ nullable: false, default: "2026-08-15" });
