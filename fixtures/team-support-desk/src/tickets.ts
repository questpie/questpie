import { constraint, defineCollection, field, index, relation } from "questpie";

import { memberships } from "./memberships";
import { organizations } from "./organizations";
import { teams } from "./teams";

export const tickets = defineCollection({
	name: "tickets",
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
		teamId: field.uuid({ nullable: false }),
		requesterMembershipId: field.uuid({
			nullable: false,
			server: true,
			immutable: true,
		}),
		assigneeMembershipId: field.uuid({ nullable: true }),
		reference: field.text({ nullable: false, minLength: 1, maxLength: 32 }),
		priority: field.text({
			nullable: false,
			minLength: 1,
			maxLength: 16,
			default: "normal",
		}),
		status: field.text({
			nullable: false,
			minLength: 1,
			maxLength: 16,
			default: "open",
			server: true,
		}),
		summary: field.text({ nullable: false, minLength: 1, maxLength: 240 }),
		description: field.text({
			nullable: false,
			minLength: 1,
			maxLength: 16_384,
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
		closedAt: field.timestamp({
			nullable: true,
			withTimezone: true,
			server: true,
		}),
		lastSlaFollowUpAt: field.timestamp({
			nullable: true,
			withTimezone: true,
			server: true,
		}),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
		tenantReference: constraint.unique({
			fields: ["organizationId", "reference"],
		}),
	},
	relations: {
		organization: relation.toOne({
			target: organizations,
			fields: ["organizationId"],
			references: ["id"],
		}),
		team: relation.toOne({
			target: teams,
			fields: ["teamId"],
			references: ["id"],
		}),
		requester: relation.toOne({
			target: memberships,
			fields: ["requesterMembershipId"],
			references: ["id"],
		}),
		assignee: relation.toOne({
			target: memberships,
			fields: ["assigneeMembershipId"],
			references: ["id"],
			onDelete: "setNull",
		}),
	},
	indexes: {
		tenantUpdated: index({
			fields: [
				"organizationId",
				{ field: "updatedAt", order: "desc", nulls: "last" },
				{ field: "id", order: "desc", nulls: "last" },
			],
		}),
		tenantStatus: index({
			fields: [
				"organizationId",
				"status",
				{ field: "updatedAt", order: "desc", nulls: "last" },
				{ field: "id", order: "desc", nulls: "last" },
			],
		}),
		tenantTeam: index({
			fields: [
				"organizationId",
				"teamId",
				{ field: "updatedAt", order: "desc", nulls: "last" },
				{ field: "id", order: "desc", nulls: "last" },
			],
		}),
		queue: index({
			fields: [
				"organizationId",
				"status",
				"teamId",
				{ field: "updatedAt", order: "desc", nulls: "last" },
				{ field: "id", order: "desc", nulls: "last" },
			],
		}),
		requesterQueue: index({
			fields: [
				"requesterMembershipId",
				"status",
				{ field: "updatedAt", order: "desc", nulls: "last" },
				{ field: "id", order: "desc", nulls: "last" },
			],
		}),
	},
});
