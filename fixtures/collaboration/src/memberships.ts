import {
	constraint,
	defineCollection,
	field,
	relation,
	relationRef,
} from "questpie";

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
			target: relationRef("companies"),
			fields: ["companyId"],
			references: ["id"],
		}),
	},
});
