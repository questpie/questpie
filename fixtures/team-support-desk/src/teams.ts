import { constraint, defineCollection, field, index, relation } from "questpie";

import { organizations } from "./organizations";

export const teams = defineCollection({
	name: "teams",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		organizationId: field.uuid({ nullable: false }),
		name: field.text({ nullable: false, minLength: 1, maxLength: 120 }),
		routingStatus: field.text({
			nullable: false,
			minLength: 1,
			maxLength: 16,
			default: "active",
		}),
		createdAt: field.timestamp({
			nullable: false,
			default: "now",
			withTimezone: true,
		}),
		updatedAt: field.timestamp({
			nullable: false,
			default: "now",
			withTimezone: true,
		}),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
		tenantName: constraint.unique({ fields: ["organizationId", "name"] }),
	},
	relations: {
		organization: relation.toOne({
			target: organizations,
			fields: ["organizationId"],
			references: ["id"],
		}),
	},
	indexes: {
		routingChoices: index({
			fields: ["organizationId", "routingStatus", "name", "id"],
		}),
	},
});
