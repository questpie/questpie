import { constraint, defineCollection, field, index, relation } from "questpie";

import { organizations } from "./organizations";

export const memberships = defineCollection({
	name: "memberships",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		organizationId: field.uuid({ nullable: false }),
		principalId: field.uuid({ nullable: false }),
		role: field.text({
			nullable: false,
			minLength: 1,
			maxLength: 16,
			default: "customer",
		}),
		status: field.text({
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
		organizationPrincipal: constraint.unique({
			fields: ["organizationId", "principalId"],
		}),
	},
	relations: {
		organization: relation.toOne({
			target: organizations,
			fields: ["organizationId"],
			references: ["id"],
		}),
	},
	indexes: {
		principal: index({ fields: ["principalId", "organizationId"] }),
		tenantRole: index({
			fields: ["organizationId", "status", "role", "id"],
		}),
	},
});
