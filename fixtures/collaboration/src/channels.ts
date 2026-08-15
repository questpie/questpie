import { constraint, defineCollection, field, relation } from "questpie";

import { spaces } from "./spaces";

export const channels = defineCollection({
	name: "channels",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		spaceId: field.uuid({ nullable: false }),
		name: field.text({ nullable: false, minLength: 1, maxLength: 120 }),
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
