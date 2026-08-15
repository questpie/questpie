import { constraint, defineCollection, field, relation } from "questpie";

import { companies } from "./companies";

export const memberships = defineCollection({
	name: "memberships",
	fields: {
		id: field.uuid({ default: "randomUuid" }),
		companyId: field.uuid(),
		principalId: field.uuid(),
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
