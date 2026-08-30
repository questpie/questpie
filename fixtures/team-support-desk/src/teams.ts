import { constraint, defineCollection, field, index, relation } from "questpie";

import type { CollectionLifecycle } from "#questpie/app";

import { organizations } from "./organizations";

export const teams = defineCollection({
	name: "teams",
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
	lifecycle: {
		normalize: ({ input }) =>
			input.name?.includes("") ? { ...input, name: input.name.trim() } : input,
	} satisfies CollectionLifecycle<"teams">,
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
