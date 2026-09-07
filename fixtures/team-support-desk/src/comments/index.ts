import { constraint, defineCollection, field, index, relation } from "questpie";

import type { CollectionLifecycle } from "#questpie/app";

import { memberships } from "../memberships";
import { tickets } from "../tickets";

export const comments = defineCollection({
	name: "comments",
	fields: {
		id: field.uuid({
			nullable: false,
			default: "randomUuid",
			server: true,
			immutable: true,
		}),
		ticketId: field.uuid({ nullable: false, immutable: true }),
		authorMembershipId: field.uuid({
			nullable: false,
			server: true,
			immutable: true,
		}),
		body: field.text({ nullable: false, minLength: 1, maxLength: 8_192 }),
		kind: field.text({
			nullable: false,
			minLength: 1,
			maxLength: 16,
			default: "public",
			server: true,
			immutable: true,
		}),
		createdAt: field.timestamp({
			nullable: false,
			default: "now",
			withTimezone: true,
			server: true,
			immutable: true,
		}),
	},
	lifecycle: {
		normalize: ({ input }) =>
			input.body?.includes("") ? { ...input, body: input.body.trim() } : input,
	} satisfies CollectionLifecycle<"comments">,
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
	},
	relations: {
		ticket: relation.toOne({
			target: tickets,
			fields: ["ticketId"],
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
			fields: [
				"ticketId",
				{ field: "createdAt", order: "desc", nulls: "last" },
				{ field: "id", order: "desc", nulls: "last" },
			],
		}),
	},
});
