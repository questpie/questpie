import { definePolicy, expr, policy } from "questpie";

import { memberships } from "./index";

export const membershipPolicy = definePolicy(memberships, {
	name: "memberships.default",
	read: {
		admit: policy.authenticated(),
		rows: ({ row, principal, tenant }) =>
			expr.and(
				row.organizationId.equal(tenant.id),
				expr.or(
					row.principalId.equal(principal.id),
					expr.exists(memberships, ({ row: actor }) =>
						expr.and(
							actor.organizationId.equal(tenant.id),
							actor.principalId.equal(principal.id),
							actor.status.equal("active"),
							actor.role.in(["agent", "admin"]),
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
				candidate.principalId.equal(current.principalId),
				candidate.createdAt.equal(current.createdAt),
				candidate.role.in(["customer", "agent", "admin"]),
				candidate.status.in(["active", "suspended"]),
			),
	},
	fields: {
		update: ({ principal, tenant }) => {
			const admin = expr.exists(memberships, ({ row: actor }) =>
				expr.and(
					actor.organizationId.equal(tenant.id),
					actor.principalId.equal(principal.id),
					actor.status.equal("active"),
					actor.role.equal("admin"),
				),
			);
			return {
				role: admin,
				status: admin,
				updatedAt: expr.not(expr.always()),
			};
		},
	},
});
