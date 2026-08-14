import {
	constraint,
	defineCollection,
	field,
	relation,
	relationRef,
} from "questpie";

export const channels = defineCollection({
	name: "channels",
	fields: {
		id: field.uuid({ default: "randomUuid" }),
		spaceId: field.uuid(),
		name: field.text({ minLength: 1, maxLength: 120 }),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
	},
	relations: {
		space: relation.toOne({
			target: relationRef("spaces"),
			fields: ["spaceId"],
			references: ["id"],
		}),
	},
});
