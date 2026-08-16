import { constraint, defineCollection, field, relation } from "questpie";

import { messages } from "./messages";

export const messageEvents = defineCollection({
	name: "messageEvents",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		messageId: field.uuid({ nullable: false }),
		kind: field.text({ nullable: false, minLength: 1, maxLength: 32 }),
		occurredAt: field.timestamp({ nullable: false, withTimezone: true }),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
	},
	relations: {
		message: relation.toOne({
			target: messages,
			fields: ["messageId"],
			references: ["id"],
		}),
	},
});
