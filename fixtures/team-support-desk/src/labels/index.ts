import { constraint, defineCollection, field, index, relation } from "questpie";

import { organizations } from "../organizations";
import { tickets } from "../tickets";

export const labels = defineCollection({
	name: "labels",
	fields: {
		id: field.uuid({
			nullable: false,
			default: "randomUuid",
			server: true,
			immutable: true,
		}),
		organizationId: field.uuid({
			nullable: false,
			server: true,
			immutable: true,
		}),
		ticketId: field.uuid({ nullable: false, immutable: true }),
		name: field.text({ nullable: false, minLength: 1, maxLength: 48 }),
		color: field.text({ nullable: false, minLength: 4, maxLength: 16 }),
		createdAt: field.timestamp({
			nullable: false,
			default: "now",
			withTimezone: true,
			server: true,
			immutable: true,
		}),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
		ticketName: constraint.unique({ fields: ["ticketId", "name"] }),
	},
	relations: {
		organization: relation.toOne({
			target: organizations,
			fields: ["organizationId"],
			references: ["id"],
		}),
		ticket: relation.toOne({
			target: tickets,
			fields: ["ticketId"],
			references: ["id"],
		}),
	},
	indexes: {
		page: index({ fields: ["ticketId", "name", "id"] }),
	},
});
