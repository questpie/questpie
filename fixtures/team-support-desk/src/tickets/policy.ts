import { definePolicy, policy, query } from "questpie";

import { memberships } from "../memberships";
import { teams } from "../teams";
import { tickets } from "../tickets";

const readableTicketRows = policy.rows(
	tickets,
	({ row: ticket, principal, tenant }) =>
		query.and(
			ticket.organizationId.equal(tenant.id),
			policy.exists(memberships, ({ row: membership }) =>
				query.and(
					membership.organizationId.equal(tenant.id),
					membership.principalId.equal(principal.id),
					membership.status.equal("active"),
					query.or(
						membership.role.in(["agent", "admin"]),
						query.and(
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
			query.and(
				candidate.organizationId.equal(tenant.id),
				candidate.priority.in(["low", "normal", "high", "urgent"]),
				candidate.status.equal("open"),
				candidate.closedAt.isNull(),
				candidate.lastSlaFollowUpAt.isNull(),
				policy.exists(teams, ({ row: team }) =>
					query.and(
						team.id.equal(candidate.teamId),
						team.organizationId.equal(tenant.id),
					),
				),
				policy.exists(memberships, ({ row: requester }) =>
					query.and(
						requester.id.equal(candidate.requesterMembershipId),
						requester.organizationId.equal(tenant.id),
						requester.principalId.equal(principal.id),
						requester.status.equal("active"),
					),
				),
				query.or(
					candidate.assigneeMembershipId.isNull(),
					policy.exists(memberships, ({ row: assignee }) =>
						query.and(
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
			query.and(
				current.organizationId.equal(tenant.id),
				policy.exists(memberships, ({ row: membership }) =>
					query.and(
						membership.organizationId.equal(tenant.id),
						membership.principalId.equal(principal.id),
						membership.status.equal("active"),
						query.or(
							membership.role.in(["agent", "admin"]),
							query.and(
								membership.role.equal("customer"),
								current.requesterMembershipId.equal(membership.id),
							),
						),
					),
				),
			),
		candidate: ({ current, candidate, principal, tenant }) =>
			query.and(
				candidate.id.equal(current.id),
				candidate.organizationId.equal(current.organizationId),
				candidate.requesterMembershipId.equal(current.requesterMembershipId),
				candidate.createdAt.equal(current.createdAt),
				candidate.priority.in(["low", "normal", "high", "urgent"]),
				candidate.status.in(["open", "closed"]),
				query.or(
					query.and(
						current.status.equal("open"),
						current.closedAt.isNull(),
						candidate.status.equal("open"),
						candidate.closedAt.isNull(),
					),
					query.and(
						current.status.equal("closed"),
						query.not(current.closedAt.isNull()),
						candidate.status.equal("closed"),
						query.not(candidate.closedAt.isNull()),
						candidate.closedAt.equal(current.closedAt),
					),
					query.and(
						current.status.equal("open"),
						current.closedAt.isNull(),
						candidate.status.equal("closed"),
						query.not(candidate.closedAt.isNull()),
					),
					query.and(
						current.status.equal("closed"),
						query.not(current.closedAt.isNull()),
						candidate.status.equal("open"),
						candidate.closedAt.isNull(),
					),
				),
				policy.exists(teams, ({ row: team }) =>
					query.and(
						team.id.equal(candidate.teamId),
						team.organizationId.equal(tenant.id),
					),
				),
				query.or(
					candidate.assigneeMembershipId.isNull(),
					policy.exists(memberships, ({ row: assignee }) =>
						query.and(
							assignee.id.equal(candidate.assigneeMembershipId),
							assignee.organizationId.equal(tenant.id),
							assignee.status.equal("active"),
							assignee.role.in(["agent", "admin"]),
						),
					),
				),
				query.or(
					policy.exists(memberships, ({ row: actor }) =>
						query.and(
							actor.organizationId.equal(tenant.id),
							actor.principalId.equal(principal.id),
							actor.status.equal("active"),
							actor.role.in(["agent", "admin"]),
						),
					),
					policy.exists(memberships, ({ row: actor }) =>
						query.and(
							actor.id.equal(current.requesterMembershipId),
							actor.principalId.equal(principal.id),
							actor.status.equal("active"),
							actor.role.equal("customer"),
							current.status.equal("open"),
							candidate.teamId.equal(current.teamId),
							candidate.priority.equal(current.priority),
							candidate.status.equal(current.status),
							candidate.closedAt.isNull(),
							query.or(
								query.and(
									candidate.assigneeMembershipId.isNull(),
									current.assigneeMembershipId.isNull(),
								),
								query.and(
									query.not(candidate.assigneeMembershipId.isNull()),
									query.not(current.assigneeMembershipId.isNull()),
									candidate.assigneeMembershipId.equal(
										current.assigneeMembershipId,
									),
								),
							),
							query.or(
								query.and(
									candidate.lastSlaFollowUpAt.isNull(),
									current.lastSlaFollowUpAt.isNull(),
								),
								query.and(
									query.not(candidate.lastSlaFollowUpAt.isNull()),
									query.not(current.lastSlaFollowUpAt.isNull()),
									candidate.lastSlaFollowUpAt.equal(current.lastSlaFollowUpAt),
								),
							),
						),
					),
				),
			),
	},
	fields: {
		create: ({ candidate, principal, tenant }) => {
			const activeRequester = policy.exists(memberships, ({ row: requester }) =>
				query.and(
					requester.id.equal(candidate.requesterMembershipId),
					requester.organizationId.equal(tenant.id),
					requester.principalId.equal(principal.id),
					requester.status.equal("active"),
				),
			);
			return {
				teamId: activeRequester,
				requesterMembershipId: activeRequester,
				assigneeMembershipId: activeRequester,
				reference: activeRequester,
				priority: activeRequester,
				status: activeRequester,
				summary: activeRequester,
				description: activeRequester,
			};
		},
		update: ({ current, principal, tenant }) => {
			const staff = policy.exists(memberships, ({ row: actor }) =>
				query.and(
					actor.organizationId.equal(tenant.id),
					actor.principalId.equal(principal.id),
					actor.status.equal("active"),
					actor.role.in(["agent", "admin"]),
				),
			);
			const requester = policy.exists(memberships, ({ row: actor }) =>
				query.and(
					actor.id.equal(current.requesterMembershipId),
					actor.principalId.equal(principal.id),
					actor.status.equal("active"),
					actor.role.equal("customer"),
					current.status.equal("open"),
				),
			);
			const editableText = query.or(staff, requester);
			return {
				summary: editableText,
				description: editableText,
				teamId: staff,
				assigneeMembershipId: staff,
				priority: staff,
				status: staff,
				closedAt: staff,
				lastSlaFollowUpAt: query.not(query.always()),
				updatedAt: query.not(query.always()),
			};
		},
	},
});
