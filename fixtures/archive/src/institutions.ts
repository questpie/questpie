import { constraint, defineCollection, field } from "questpie";

export const institutions = defineCollection({
	name: "institutions",
	fields: {
		code: field.text({ nullable: false, minLength: 1, maxLength: 32 }),
		tenantId: field.uuid({ nullable: false }),
		name: field.text({ nullable: false, minLength: 1, maxLength: 160 }),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["code"] }),
	},
});
