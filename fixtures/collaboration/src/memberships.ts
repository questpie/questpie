import { constraint, defineCollection, field, relation } from "questpie";

import { companies } from "./companies";

export const memberships = defineCollection({
	name: "memberships",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		companyId: field.uuid({ nullable: false }),
		principalId: field.uuid({ nullable: false }),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
		onePrincipalPerCompany: constraint.unique({
			fields: ["companyId", "principalId"],
		}),
	},
	relations: {
		company: relation.toOne({
			target: companies,
			fields: ["companyId"],
			references: ["id"],
		}),
	},
});
