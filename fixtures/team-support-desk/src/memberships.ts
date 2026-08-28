import { constraint, defineCollection, field, index, relation } from "questpie";

import { organizations } from "./organizations";

export const memberships = defineCollection({
	name: "memberships",
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
		principalId: field.uuid({ nullable: false, immutable: true }),
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
			server: true,
			immutable: true,
		}),
		updatedAt: field.timestamp({
			nullable: false,
			default: "now",
			withTimezone: true,
			server: true,
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
