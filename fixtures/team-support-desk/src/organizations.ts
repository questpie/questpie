import { constraint, defineCollection, field, index } from "questpie";

export const organizations = defineCollection({
	name: "organizations",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		name: field.text({ nullable: false, minLength: 1, maxLength: 120 }),
		createdAt: field.timestamp({
			nullable: false,
			default: "now",
			withTimezone: true,
		}),
		updatedAt: field.timestamp({
			nullable: false,
			default: "now",
			withTimezone: true,
		}),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
		nameUnique: constraint.unique({ fields: ["name"] }),
	},
	indexes: {
		page: index({ fields: ["name", "id"] }),
	},
});
