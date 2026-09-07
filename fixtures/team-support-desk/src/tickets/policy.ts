import { definePolicy, expr, policy } from "questpie";

import { memberships } from "../memberships";
import { teams } from "../teams";
import { tickets } from "./index";

const readableTicketRows = policy.rows(
	tickets,
	({ row: ticket, principal, tenant }) =>
		expr.and(
			ticket.organizationId.equal(tenant.id),
			expr.exists(memberships, ({ row: membership }) =>
				expr.and(
					membership.organizationId.equal(tenant.id),
					membership.principalId.equal(principal.id),
					membership.status.equal("active"),
					expr.or(
						membership.role.in(["agent", "admin"]),
						expr.and(
							membership.role.equal("customer"),
							ticket.requesterMembershipId.equal(membership.id),
						),
					),
				),
			),
		),
);

export const ticketPolicy = definePolicy(tickets, {
	name: "tickets.default",
	read: { admit: policy.authenticated(), rows: readableTicketRows },
	create: {
		admit: policy.authenticated(),
		candidate: ({ candidate, principal, tenant }) =>
			expr.and(
				candidate.organizationId.equal(tenant.id),
				candidate.priority.in(["low", "normal", "high", "urgent"]),
				candidate.status.equal("open"),
				candidate.closedAt.isNull(),
				candidate.lastSlaFollowUpAt.isNull(),
				expr.exists(teams, ({ row: team }) =>
					expr.and(
						team.id.equal(candidate.teamId),
						team.organizationId.equal(tenant.id),
					),
				),
				expr.exists(memberships, ({ row: requester }) =>
					expr.and(
						requester.id.equal(candidate.requesterMembershipId),
						requester.organizationId.equal(tenant.id),
						requester.principalId.equal(principal.id),
						requester.status.equal("active"),
					),
				),
				expr.or(
					candidate.assigneeMembershipId.isNull(),
					expr.exists(memberships, ({ row: assignee }) =>
						expr.and(
							assignee.id.equal(candidate.assigneeMembershipId),
							assignee.organizationId.equal(tenant.id),
							assignee.status.equal("active"),
							assignee.role.in(["agent", "admin"]),
						),
					),
				),
			),
	},
	update: {
		admit: policy.authenticated(),
		rows: ({ current, principal, tenant }) =>
			expr.and(
				current.organizationId.equal(tenant.id),
				expr.exists(memberships, ({ row: membership }) =>
					expr.and(
						membership.organizationId.equal(tenant.id),
						membership.principalId.equal(principal.id),
						membership.status.equal("active"),
						expr.or(
							membership.role.in(["agent", "admin"]),
							expr.and(
								membership.role.equal("customer"),
								current.requesterMembershipId.equal(membership.id),
							),
						),
					),
				),
			),
		candidate: ({ current, candidate, principal, tenant }) =>
			expr.and(
				candidate.id.equal(current.id),
				candidate.organizationId.equal(current.organizationId),
				candidate.requesterMembershipId.equal(current.requesterMembershipId),
				candidate.createdAt.equal(current.createdAt),
				candidate.priority.in(["low", "normal", "high", "urgent"]),
				candidate.status.in(["open", "closed"]),
				expr.or(
					expr.and(
						current.status.equal("open"),
						current.closedAt.isNull(),
						candidate.status.equal("open"),
						candidate.closedAt.isNull(),
					),
					expr.and(
						current.status.equal("closed"),
						expr.not(current.closedAt.isNull()),
						candidate.status.equal("closed"),
						expr.not(candidate.closedAt.isNull()),
						candidate.closedAt.equal(current.closedAt),
					),
					expr.and(
						current.status.equal("open"),
						current.closedAt.isNull(),
						candidate.status.equal("closed"),
						expr.not(candidate.closedAt.isNull()),
					),
					expr.and(
						current.status.equal("closed"),
						expr.not(current.closedAt.isNull()),
						candidate.status.equal("open"),
						candidate.closedAt.isNull(),
					),
				),
				expr.exists(teams, ({ row: team }) =>
					expr.and(
						team.id.equal(candidate.teamId),
						team.organizationId.equal(tenant.id),
					),
				),
				expr.or(
					candidate.assigneeMembershipId.isNull(),
					expr.exists(memberships, ({ row: assignee }) =>
						expr.and(
							assignee.id.equal(candidate.assigneeMembershipId),
							assignee.organizationId.equal(tenant.id),
							assignee.status.equal("active"),
							assignee.role.in(["agent", "admin"]),
						),
					),
				),
				expr.or(
					expr.exists(memberships, ({ row: actor }) =>
						expr.and(
							actor.organizationId.equal(tenant.id),
							actor.principalId.equal(principal.id),
							actor.status.equal("active"),
							actor.role.in(["agent", "admin"]),
						),
					),
					expr.exists(memberships, ({ row: actor }) =>
						expr.and(
							actor.id.equal(current.requesterMembershipId),
							actor.principalId.equal(principal.id),
							actor.status.equal("active"),
							actor.role.equal("customer"),
							current.status.equal("open"),
							candidate.teamId.equal(current.teamId),
							candidate.priority.equal(current.priority),
							candidate.status.equal(current.status),
							candidate.closedAt.isNull(),
							expr.or(
								expr.and(
									candidate.slaFollowUpDueAt.isNull(),
									current.slaFollowUpDueAt.isNull(),
								),
								expr.and(
									expr.not(candidate.slaFollowUpDueAt.isNull()),
									expr.not(current.slaFollowUpDueAt.isNull()),
									candidate.slaFollowUpDueAt.equal(current.slaFollowUpDueAt),
								),
							),
							expr.or(
								expr.and(
									candidate.assigneeMembershipId.isNull(),
									current.assigneeMembershipId.isNull(),
								),
								expr.and(
									expr.not(candidate.assigneeMembershipId.isNull()),
									expr.not(current.assigneeMembershipId.isNull()),
									candidate.assigneeMembershipId.equal(
										current.assigneeMembershipId,
									),
								),
							),
							expr.or(
								expr.and(
									candidate.lastSlaFollowUpAt.isNull(),
									current.lastSlaFollowUpAt.isNull(),
								),
								expr.and(
									expr.not(candidate.lastSlaFollowUpAt.isNull()),
									expr.not(current.lastSlaFollowUpAt.isNull()),
									candidate.lastSlaFollowUpAt.equal(current.lastSlaFollowUpAt),
								),
							),
						),
					),
				),
			),
	},
	fields: {
		create: ({ principal, tenant }) => {
			const activeActor = expr.exists(memberships, ({ row: actor }) =>
				expr.and(
					actor.organizationId.equal(tenant.id),
					actor.principalId.equal(principal.id),
					actor.status.equal("active"),
				),
			);
			return {
				teamId: activeActor,
				requesterMembershipId: activeActor,
				assigneeMembershipId: activeActor,
				reference: activeActor,
				priority: activeActor,
				status: activeActor,
				summary: activeActor,
				description: activeActor,
			};
		},
		update: ({ current, principal, tenant }) => {
			const staff = expr.exists(memberships, ({ row: actor }) =>
				expr.and(
					actor.organizationId.equal(tenant.id),
					actor.principalId.equal(principal.id),
					actor.status.equal("active"),
					actor.role.in(["agent", "admin"]),
				),
			);
			const requester = expr.exists(memberships, ({ row: actor }) =>
				expr.and(
					actor.id.equal(current.requesterMembershipId),
					actor.principalId.equal(principal.id),
					actor.status.equal("active"),
					actor.role.equal("customer"),
					current.status.equal("open"),
				),
			);
			const editableText = expr.or(staff, requester);
			return {
				summary: editableText,
				description: editableText,
				teamId: staff,
				assigneeMembershipId: staff,
				priority: staff,
				status: staff,
				closedAt: staff,
				lastSlaFollowUpAt: expr.not(expr.always()),
				slaFollowUpDueAt: expr.not(expr.always()),
				updatedAt: expr.not(expr.always()),
			};
		},
	},
});
