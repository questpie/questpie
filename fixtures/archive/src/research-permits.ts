import { constraint, defineCollection, field, relation } from "questpie";

import { institutions } from "./institutions";

export const researchPermits = defineCollection({
	name: "researchPermits",
	fields: {
		programmeCode: field.text({ nullable: false, minLength: 1, maxLength: 64 }),
		archiveCode: field.text({ nullable: false, minLength: 1, maxLength: 32 }),
		principalId: field.uuid({ nullable: false }),
		status: field.text({
			nullable: false,
			minLength: 1,
			maxLength: 16,
			default: "active",
		}),
		mayViewRestricted: field.boolean({ nullable: false, default: false }),
		mayDeposit: field.boolean({ nullable: false, default: false }),
	},
	constraints: {
		primary: constraint.primaryKey({
			fields: ["programmeCode", "archiveCode", "principalId"],
		}),
	},
	relations: {
		institution: relation.toOne({
			target: institutions,
			fields: ["archiveCode"],
			references: ["code"],
		}),
	},
});
