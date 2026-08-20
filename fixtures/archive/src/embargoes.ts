import { constraint, defineCollection, field, relation } from "questpie";

import { records } from "./records";

export const embargoes = defineCollection({
	name: "embargoes",
	fields: {
		archiveCode: field.text({ nullable: false, minLength: 1, maxLength: 32 }),
		catalogueNumber: field.text({
			nullable: false,
			minLength: 1,
			maxLength: 80,
		}),
		status: field.text({
			nullable: false,
			minLength: 1,
			maxLength: 16,
			default: "active",
		}),
		expiresAt: field.timestamp({ nullable: false, withTimezone: true }),
	},
	constraints: {
		primary: constraint.primaryKey({
			fields: ["archiveCode", "catalogueNumber"],
		}),
	},
	relations: {
		record: relation.toOne({
			target: records,
			fields: ["archiveCode", "catalogueNumber"],
			references: ["archiveCode", "catalogueNumber"],
		}),
	},
});
