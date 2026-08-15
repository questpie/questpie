import { constraint, defineCollection, field, relation } from "questpie";

import { companies } from "./companies";

export const spaces = defineCollection({
	name: "spaces",
	fields: {
		id: field.uuid({ default: "randomUuid" }),
		companyId: field.uuid(),
		name: field.text({ minLength: 1, maxLength: 120 }),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
	},
	relations: {
		company: relation.toOne({
			target: companies,
			fields: ["companyId"],
			references: ["id"],
		}),
	},
});
