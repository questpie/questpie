import { definePolicy, expr, policy } from "questpie";

import { memberships } from "../memberships";
import { organizations } from "../organizations";

export const organizationPolicy = definePolicy(organizations, {
	name: "organizations.default",
	read: {
		admit: policy.authenticated(),
		rows: ({ row, principal, tenant }) =>
			expr.and(
				row.id.equal(tenant.id),
				expr.exists(memberships, ({ row: membership }) =>
					expr.and(
						membership.organizationId.equal(row.id),
						membership.principalId.equal(principal.id),
						membership.status.equal("active"),
					),
				),
			),
	},
});
