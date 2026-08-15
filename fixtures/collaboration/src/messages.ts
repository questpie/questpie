import { constraint, defineCollection, field, relation } from "questpie";

import { messageAudit } from "@questpie/collaboration-audit/questpie";

import { channels } from "./channels";
import { memberships } from "./memberships";

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
			target: channels,
			fields: ["channelId"],
			references: ["id"],
		}),
		author: relation.toOne({
			target: memberships,
			fields: ["authorMembershipId"],
			references: ["id"],
		}),
	},
	augmentations: [messageAudit],
});
