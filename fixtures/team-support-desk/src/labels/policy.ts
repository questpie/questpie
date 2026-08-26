import { definePolicy, policy, query } from "questpie";

import { labels } from "../labels";
import { memberships } from "../memberships";
import { tickets } from "../tickets";

export const labelPolicy = definePolicy(labels, {
	name: "labels.default",
	read: {
		admit: policy.authenticated(),
		rows: ({ row, principal, tenant }) =>
			query.and(
				row.organizationId.equal(tenant.id),
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
			),
	},
	create: {
		admit: policy.authenticated(),
		candidate: ({ candidate, principal, tenant }) =>
			query.and(
				candidate.organizationId.equal(tenant.id),
				policy.exists(tickets, ({ row: ticket }) =>
					query.and(
						ticket.id.equal(candidate.ticketId),
						ticket.organizationId.equal(tenant.id),
					),
				),
				policy.exists(memberships, ({ row: actor }) =>
					query.and(
						actor.organizationId.equal(tenant.id),
						actor.principalId.equal(principal.id),
						actor.status.equal("active"),
						actor.role.equal("admin"),
					),
				),
			),
	},
	update: {
		admit: policy.authenticated(),
		rows: ({ current, principal, tenant }) =>
			query.and(
				current.organizationId.equal(tenant.id),
				policy.exists(memberships, ({ row: actor }) =>
					query.and(
						actor.organizationId.equal(tenant.id),
						actor.principalId.equal(principal.id),
						actor.status.equal("active"),
						actor.role.equal("admin"),
					),
				),
			),
		candidate: ({ current, candidate }) =>
			query.and(
				candidate.id.equal(current.id),
				candidate.organizationId.equal(current.organizationId),
				candidate.ticketId.equal(current.ticketId),
				candidate.createdAt.equal(current.createdAt),
			),
	},
	delete: {
		admit: policy.authenticated(),
		rows: ({ current, principal, tenant }) =>
			query.and(
				current.organizationId.equal(tenant.id),
				policy.exists(memberships, ({ row: actor }) =>
					query.and(
						actor.organizationId.equal(tenant.id),
						actor.principalId.equal(principal.id),
						actor.status.equal("active"),
						actor.role.equal("admin"),
					),
				),
			),
	},
	fields: {
		create: ({ principal, tenant }) => {
			const admin = policy.exists(memberships, ({ row: actor }) =>
				query.and(
					actor.organizationId.equal(tenant.id),
					actor.principalId.equal(principal.id),
					actor.status.equal("active"),
					actor.role.equal("admin"),
				),
			);
			return {
				ticketId: admin,
				name: admin,
				color: admin,
			};
		},
		update: ({ principal, tenant }) => {
			const admin = policy.exists(memberships, ({ row: actor }) =>
				query.and(
					actor.organizationId.equal(tenant.id),
					actor.principalId.equal(principal.id),
					actor.status.equal("active"),
					actor.role.equal("admin"),
				),
			);
			return { name: admin, color: admin };
		},
	},
});
