import { constraint, defineCollection, field, index, relation } from "questpie";

import { memberships } from "./memberships";
import { tickets } from "./tickets";

export const comments = defineCollection({
	name: "comments",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		ticketId: field.uuid({ nullable: false }),
		authorMembershipId: field.uuid({ nullable: false }),
		body: field.text({ nullable: false, minLength: 1, maxLength: 8_192 }),
		kind: field.text({
			nullable: false,
			minLength: 1,
			maxLength: 16,
			default: "public",
		}),
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
