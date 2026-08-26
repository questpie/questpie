import { definePolicy, policy, query } from "questpie";

import { memberships } from "../memberships";

export const membershipPolicy = definePolicy(memberships, {
	name: "memberships.default",
	read: {
		admit: policy.authenticated(),
		rows: ({ row, principal, tenant }) =>
			query.and(
				row.organizationId.equal(tenant.id),
				query.or(
					row.principalId.equal(principal.id),
					policy.exists(memberships, ({ row: actor }) =>
						query.and(
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
				candidate.principalId.equal(current.principalId),
				candidate.createdAt.equal(current.createdAt),
				candidate.role.in(["customer", "agent", "admin"]),
				candidate.status.in(["active", "suspended"]),
			),
	},
	fields: {
		update: ({ principal, tenant }) => {
			const admin = policy.exists(memberships, ({ row: actor }) =>
				query.and(
					actor.organizationId.equal(tenant.id),
					actor.principalId.equal(principal.id),
					actor.status.equal("active"),
					actor.role.equal("admin"),
				),
			);
			return {
				role: admin,
				status: admin,
				updatedAt: query.not(query.always()),
			};
		},
	},
});
