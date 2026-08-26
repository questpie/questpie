import { definePolicy, policy, query } from "questpie";

import { memberships } from "../memberships";
import { organizations } from "../organizations";

export const organizationPolicy = definePolicy(organizations, {
	name: "organizations.default",
	read: {
		admit: policy.authenticated(),
		rows: ({ row, principal, tenant }) =>
			query.and(
				row.id.equal(tenant.id),
				policy.exists(memberships, ({ row: membership }) =>
					query.and(
						membership.organizationId.equal(row.id),
						membership.principalId.equal(principal.id),
						membership.status.equal("active"),
					),
				),
			),
	},
});
