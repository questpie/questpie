import { constraint, defineCollection, field } from "questpie";

export const companies = defineCollection({
	name: "companies",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		name: field.text({ nullable: false, minLength: 1, maxLength: 120 }),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
	},
});
