import {
	constraint,
	defineCollection,
	field,
	relation,
	relationRef,
} from "questpie";

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
			target: relationRef("companies"),
			fields: ["companyId"],
			references: ["id"],
		}),
	},
});
