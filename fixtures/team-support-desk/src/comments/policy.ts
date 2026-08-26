import { definePolicy, policy, query } from "questpie";

import { comments } from "../comments";
import { memberships } from "../memberships";
import { tickets } from "../tickets";

export const commentPolicy = definePolicy(comments, {
	name: "comments.default",
	read: {
		admit: policy.authenticated(),
		rows: ({ row, principal, tenant }) =>
			policy.exists(tickets, ({ row: ticket }) =>
				query.and(
					ticket.id.equal(row.ticketId),
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
			),
	},
	create: {
		admit: policy.authenticated(),
		candidate: ({ candidate, principal, tenant }) =>
			query.and(
				candidate.kind.in(["public", "internal"]),
				policy.exists(memberships, ({ row: author }) =>
					query.and(
						author.id.equal(candidate.authorMembershipId),
						author.organizationId.equal(tenant.id),
						author.principalId.equal(principal.id),
						author.status.equal("active"),
						query.or(
							candidate.kind.equal("public"),
							query.and(
								candidate.kind.equal("internal"),
								author.role.in(["agent", "admin"]),
							),
						),
					),
				),
				policy.exists(tickets, ({ row: ticket }) =>
					query.and(
						ticket.id.equal(candidate.ticketId),
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
				),
			),
	},
	fields: {
		create: ({ candidate, principal, tenant }) => {
			const activeAuthor = policy.exists(memberships, ({ row: author }) =>
				query.and(
					author.id.equal(candidate.authorMembershipId),
					author.organizationId.equal(tenant.id),
					author.principalId.equal(principal.id),
					author.status.equal("active"),
				),
			);
			return {
				ticketId: activeAuthor,
				authorMembershipId: activeAuthor,
				body: activeAuthor,
				kind: activeAuthor,
			};
		},
	},
});
