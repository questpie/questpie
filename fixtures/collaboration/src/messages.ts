import { constraint, defineCollection, field, relation } from "questpie";

import { messageAudit } from "@questpie/collaboration-audit/questpie";

import { channels } from "./channels";
import { memberships } from "./memberships";

export const messages = defineCollection({
	name: "messages",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		channelId: field.uuid({ nullable: false }),
		authorMembershipId: field.uuid({ nullable: false }),
		body: field.text({ nullable: false, minLength: 1, maxLength: 8_192 }),
		createdAt: field.timestamp({
			nullable: false,
			default: "now",
			withTimezone: true,
		}),
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
