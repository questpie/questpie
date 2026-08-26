import { definePolicy, policy, query } from "questpie";

import { memberships } from "../memberships";
import { teams } from "../teams";

export const teamPolicy = definePolicy(teams, {
	name: "teams.default",
	read: {
		admit: policy.authenticated(),
		rows: ({ row, principal, tenant }) =>
			query.and(
				row.organizationId.equal(tenant.id),
				policy.exists(memberships, ({ row: membership }) =>
					query.and(
						membership.organizationId.equal(tenant.id),
						membership.principalId.equal(principal.id),
						membership.status.equal("active"),
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
						actor.role.in(["agent", "admin"]),
					),
				),
			),
		candidate: ({ current, candidate }) =>
			query.and(
				candidate.id.equal(current.id),
				candidate.organizationId.equal(current.organizationId),
				candidate.createdAt.equal(current.createdAt),
				candidate.routingStatus.in(["active", "paused"]),
			),
	},
	fields: {
		update: ({ principal, tenant }) => {
			const staff = policy.exists(memberships, ({ row: actor }) =>
				query.and(
					actor.organizationId.equal(tenant.id),
					actor.principalId.equal(principal.id),
					actor.status.equal("active"),
					actor.role.in(["agent", "admin"]),
				),
			);
			return {
				name: staff,
				routingStatus: staff,
				updatedAt: query.not(query.always()),
			};
		},
	},
});
