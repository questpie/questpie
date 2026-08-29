import {
	collection,
	constraint,
	defineCollection,
	field,
	index,
	relation,
} from "questpie";

import type { CollectionLifecycle } from "#questpie/app";
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
	issues: {
		channelUnavailable: collection.issue(),
	},
	lifecycle: {
		check: async ({ candidate, ctx, issues }) => {
			const channel = await ctx.data.channels.get({
				key: { id: candidate.channelId },
				select: { id: true },
			});
			if (channel === null) throw issues.channelUnavailable();
		},
	} satisfies CollectionLifecycle<"messages">,
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
	indexes: {
		page: index({
			fields: ["channelId", { field: "id", order: "desc", nulls: "last" }],
		}),
	},
	augmentations: [messageAudit],
});
