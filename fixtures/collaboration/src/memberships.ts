import { constraint, defineCollection, field, relation } from "questpie";

import { companies } from "./companies";

export const memberships = defineCollection({
	name: "memberships",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		companyId: field.uuid({ nullable: false }),
		principalId: field.uuid({ nullable: false }),
		scopeKey: field.text({
			nullable: false,
			minLength: 1,
			maxLength: 63,
			default: "company",
		}),
		status: field.text({
			nullable: false,
			minLength: 1,
			maxLength: 16,
			default: "active",
		}),
		role: field.text({
			nullable: false,
			minLength: 1,
			maxLength: 32,
			default: "member",
		}),
	},
	constraints: {
		primary: constraint.primaryKey({
			fields: ["companyId", "principalId", "scopeKey"],
		}),
		idUnique: constraint.unique({ fields: ["id"] }),
	},
	relations: {
		company: relation.toOne({
			target: companies,
			fields: ["companyId"],
			references: ["id"],
		}),
	},
});
