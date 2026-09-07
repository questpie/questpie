import { definePolicy, expr, policy } from "questpie";

import { memberships } from "../memberships";
import { teams } from "./index";

export const teamPolicy = definePolicy(teams, {
	name: "teams.default",
	read: {
		admit: policy.authenticated(),
		rows: ({ row, principal, tenant }) =>
			expr.and(
				row.organizationId.equal(tenant.id),
				expr.exists(memberships, ({ row: membership }) =>
					expr.and(
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
			expr.and(
				current.organizationId.equal(tenant.id),
				expr.exists(memberships, ({ row: actor }) =>
					expr.and(
						actor.organizationId.equal(tenant.id),
						actor.principalId.equal(principal.id),
						actor.status.equal("active"),
						actor.role.in(["agent", "admin"]),
					),
				),
			),
		candidate: ({ current, candidate }) =>
			expr.and(
				candidate.id.equal(current.id),
				candidate.organizationId.equal(current.organizationId),
				candidate.createdAt.equal(current.createdAt),
				candidate.routingStatus.in(["active", "paused"]),
			),
	},
	fields: {
		update: ({ principal, tenant }) => {
			const staff = expr.exists(memberships, ({ row: actor }) =>
				expr.and(
					actor.organizationId.equal(tenant.id),
					actor.principalId.equal(principal.id),
					actor.status.equal("active"),
					actor.role.in(["agent", "admin"]),
				),
			);
			return {
				name: staff,
				routingStatus: staff,
				updatedAt: expr.not(expr.always()),
			};
		},
	},
});
