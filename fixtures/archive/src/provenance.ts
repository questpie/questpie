import { constraint, defineCollection, field, index, relation } from "questpie";

import { records } from "./records";

export const provenance = defineCollection({
	name: "provenance",
	fields: {
		archiveCode: field.text({ nullable: false, minLength: 1, maxLength: 32 }),
		catalogueNumber: field.text({
			nullable: false,
			minLength: 1,
			maxLength: 80,
		}),
		sequence: field.integer({ nullable: false, minimum: 1 }),
		kind: field.text({ nullable: false, minLength: 1, maxLength: 32 }),
		note: field.text({ nullable: false, minLength: 1, maxLength: 2_048 }),
		recordedAt: field.timestamp({
			nullable: false,
			default: "now",
			withTimezone: true,
		}),
	},
	constraints: {
		primary: constraint.primaryKey({
			fields: ["archiveCode", "catalogueNumber", "sequence"],
		}),
	},
	relations: {
		record: relation.toOne({
			target: records,
			fields: ["archiveCode", "catalogueNumber"],
			references: ["archiveCode", "catalogueNumber"],
		}),
	},
	indexes: {
		page: index({
			fields: [
				"archiveCode",
				"catalogueNumber",
				{ field: "sequence", order: "asc", nulls: "last" },
			],
		}),
	},
});
