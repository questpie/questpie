import { constraint, defineCollection, field } from "questpie";

export const companies = defineCollection({
	name: "companies",
	fields: {
		id: field.uuid({ default: "randomUuid" }),
		name: field.text({ minLength: 1, maxLength: 120 }),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
	},
});
