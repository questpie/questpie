import { constraint, defineCollection, field, index, relation } from "questpie";

import { institutions } from "./institutions";

export const records = defineCollection({
	name: "records",
	fields: {
		archiveCode: field.text({ nullable: false, minLength: 1, maxLength: 32 }),
		catalogueNumber: field.text({
			nullable: false,
			minLength: 1,
			maxLength: 80,
		}),
		visibility: field.text({
			nullable: false,
			minLength: 1,
			maxLength: 16,
			default: "restricted",
		}),
		title: field.text({ nullable: false, minLength: 1, maxLength: 240 }),
		body: field.text({ nullable: false, minLength: 1, maxLength: 32_768 }),
		createdAt: field.timestamp({
			nullable: false,
			default: "now",
			withTimezone: true,
		}),
	},
	constraints: {
		primary: constraint.primaryKey({
			fields: ["archiveCode", "catalogueNumber"],
		}),
	},
	relations: {
		institution: relation.toOne({
			target: institutions,
			fields: ["archiveCode"],
			references: ["code"],
		}),
	},
	indexes: {
		page: index({
			fields: [
				"archiveCode",
				{ field: "catalogueNumber", order: "desc", nulls: "last" },
			],
		}),
	},
});
