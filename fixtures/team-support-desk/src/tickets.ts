import {
	collection,
	constraint,
	defineCollection,
	field,
	index,
	relation,
	relationRef,
} from "questpie";

import type { CollectionLifecycle } from "#questpie/app";

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
			onUpdate: "now",
			withTimezone: true,
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
		slaFollowUpDueAt: field.timestamp({
			nullable: true,
			withTimezone: true,
			server: true,
		}),
	},
	issues: {
		invalidReference: collection.issue(),
	},
	lifecycle: {
		normalize: ({ input }) => {
			if (input.reference?.includes("")) {
				if (input.summary?.includes("")) {
					if (input.description?.includes(""))
						return {
							...input,
							reference: input.reference.trim(),
							summary: input.summary.trim(),
							description: input.description.trim(),
						};
					return {
						...input,
						reference: input.reference.trim(),
						summary: input.summary.trim(),
					};
				}
				if (input.description?.includes(""))
					return {
						...input,
						reference: input.reference.trim(),
						description: input.description.trim(),
					};
				return { ...input, reference: input.reference.trim() };
			}
			if (input.summary?.includes("")) {
				if (input.description?.includes(""))
					return {
						...input,
						summary: input.summary.trim(),
						description: input.description.trim(),
					};
				return { ...input, summary: input.summary.trim() };
			}
			return input.description?.includes("")
				? { ...input, description: input.description.trim() }
				: input;
		},
		validate: ({ candidate, issues }) => {
			if (
				!candidate.reference.startsWith("SUP-") &&
				!candidate.reference.startsWith("WEB-")
			)
				throw issues.invalidReference();
		},
		check: async ({ candidate, ctx, issues }) => {
			const team = await ctx.data.teams.get({
				key: { id: candidate.teamId },
				select: { id: true, routingStatus: true },
			});
			if (team === null || team.routingStatus !== "active")
				throw issues.invalidReference();

			const requester = await ctx.data.memberships.get({
				key: { id: candidate.requesterMembershipId },
				select: { id: true, status: true },
			});
			if (requester === null || requester.status !== "active")
				throw issues.invalidReference();
		},
		afterWrite: async ({ row, ctx }) => {
			await ctx.jobs.ticket.slaFollowUp.accept({
				input: {
					organizationId: row.organizationId,
					ticketId: row.id,
					reference: row.reference,
					summary: row.summary,
					dueAt: ctx.now,
				},
				idempotencyKey: `ticket:${row.id}:${ctx.callId}`,
			});
		},
	} satisfies CollectionLifecycle<"tickets">,
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
		comments: relation.toMany({
			inverseOf: relationRef("comments", "ticket"),
		}),
	},
	indexes: {
		slaDue: index({
			fields: ["organizationId", "status", "slaFollowUpDueAt", "id"],
		}),
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
