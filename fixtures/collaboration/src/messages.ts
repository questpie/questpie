import {
	constraint,
	defineCollection,
	field,
	relation,
	relationRef,
} from "questpie";

import { messageAudit } from "@questpie/collaboration-audit/questpie";

export const messages = defineCollection({
	name: "messages",
	fields: {
		id: field.uuid({ default: "randomUuid" }),
		channelId: field.uuid(),
		authorMembershipId: field.uuid(),
		body: field.text({ minLength: 1, maxLength: 8_192 }),
		createdAt: field.timestamp({ default: "now", withTimezone: true }),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
	},
	relations: {
		channel: relation.toOne({
			target: relationRef("channels"),
			fields: ["channelId"],
			references: ["id"],
		}),
		author: relation.toOne({
			target: relationRef("memberships"),
			fields: ["authorMembershipId"],
			references: ["id"],
		}),
	},
	augmentations: [messageAudit],
});
