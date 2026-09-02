import { definePolicy, expr, policy } from "questpie";

import { comments } from "../comments";
import { memberships } from "../memberships";
import { tickets } from "../tickets";

export const commentPolicy = definePolicy(comments, {
	name: "comments.default",
	read: {
		admit: policy.authenticated(),
		rows: ({ row, principal, tenant }) =>
			expr.and(
				expr.or(
					row.kind.equal("public"),
					expr.exists(memberships, ({ row: actor }) =>
						expr.and(
							actor.organizationId.equal(tenant.id),
							actor.principalId.equal(principal.id),
							actor.status.equal("active"),
							actor.role.in(["agent", "admin"]),
						),
					),
				),
				expr.exists(tickets, ({ row: ticket }) =>
					expr.and(
						ticket.id.equal(row.ticketId),
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
				),
			),
	},
	create: {
		admit: policy.authenticated(),
		candidate: ({ candidate, principal, tenant }) =>
			expr.and(
				candidate.kind.in(["public", "internal"]),
				expr.exists(memberships, ({ row: author }) =>
					expr.and(
						author.id.equal(candidate.authorMembershipId),
						author.organizationId.equal(tenant.id),
						author.principalId.equal(principal.id),
						author.status.equal("active"),
						expr.or(
							candidate.kind.equal("public"),
							expr.and(
								candidate.kind.equal("internal"),
								author.role.in(["agent", "admin"]),
							),
						),
					),
				),
				expr.exists(tickets, ({ row: ticket }) =>
					expr.and(
						ticket.id.equal(candidate.ticketId),
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
				),
			),
	},
	fields: {
		output: ({ row, principal, tenant }) => ({
			body: expr.exists(memberships, ({ row: actor }) =>
				expr.and(
					actor.organizationId.equal(tenant.id),
					actor.principalId.equal(principal.id),
					actor.status.equal("active"),
					expr.or(
						actor.role.in(["agent", "admin"]),
						actor.id.equal(row.authorMembershipId),
					),
				),
			),
		}),
		create: ({ principal, tenant }) => {
			const activeActor = expr.exists(memberships, ({ row: actor }) =>
				expr.and(
					actor.organizationId.equal(tenant.id),
					actor.principalId.equal(principal.id),
					actor.status.equal("active"),
				),
			);
			return {
				ticketId: activeActor,
				authorMembershipId: activeActor,
				body: activeActor,
				kind: activeActor,
			};
		},
	},
});
