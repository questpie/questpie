import { constraint, defineCollection, field, relation } from "questpie";

import { spaces } from "./spaces";

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
			target: spaces,
			fields: ["spaceId"],
			references: ["id"],
		}),
	},
});
