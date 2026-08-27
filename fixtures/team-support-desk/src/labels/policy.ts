import { definePolicy, expr, policy } from "questpie";

import { labels } from "../labels";
import { memberships } from "../memberships";
import { tickets } from "../tickets";

export const labelPolicy = definePolicy(labels, {
	name: "labels.default",
	read: {
		admit: policy.authenticated(),
		rows: ({ row, principal, tenant }) =>
			expr.and(
				row.organizationId.equal(tenant.id),
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
				candidate.organizationId.equal(tenant.id),
				expr.exists(tickets, ({ row: ticket }) =>
					expr.and(
						ticket.id.equal(candidate.ticketId),
						ticket.organizationId.equal(tenant.id),
					),
				),
				expr.exists(memberships, ({ row: actor }) =>
					expr.and(
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
			expr.and(
				current.organizationId.equal(tenant.id),
				expr.exists(memberships, ({ row: actor }) =>
					expr.and(
						actor.organizationId.equal(tenant.id),
						actor.principalId.equal(principal.id),
						actor.status.equal("active"),
						actor.role.equal("admin"),
					),
				),
			),
		candidate: ({ current, candidate }) =>
			expr.and(
				candidate.id.equal(current.id),
				candidate.organizationId.equal(current.organizationId),
				candidate.ticketId.equal(current.ticketId),
				candidate.createdAt.equal(current.createdAt),
			),
	},
	delete: {
		admit: policy.authenticated(),
		rows: ({ current, principal, tenant }) =>
			expr.and(
				current.organizationId.equal(tenant.id),
				expr.exists(memberships, ({ row: actor }) =>
					expr.and(
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
			const admin = expr.exists(memberships, ({ row: actor }) =>
				expr.and(
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
			const admin = expr.exists(memberships, ({ row: actor }) =>
				expr.and(
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
