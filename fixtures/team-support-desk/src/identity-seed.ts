import { defineSeed, seed } from "questpie";

import { demoIds } from "./demo-ids";
import { memberships } from "./memberships";
import { organizations } from "./organizations";
import { teams } from "./teams";

const createdAt = "2026-08-26T08:00:00.000Z";

export const supportIdentity = defineSeed({
	name: "teamSupport.identity.v1",
	steps: [
		seed.insert(organizations, {
			id: demoIds.organization,
			name: "Northwind Support",
			createdAt,
			updatedAt: createdAt,
		}),
		seed.insert(memberships, {
			id: demoIds.memberships.customer,
			organizationId: demoIds.organization,
			principalId: demoIds.principals.customer,
			role: "customer",
			status: "active",
			createdAt,
			updatedAt: createdAt,
		}),
		seed.insert(memberships, {
			id: demoIds.memberships.agent,
			organizationId: demoIds.organization,
			principalId: demoIds.principals.agent,
			role: "agent",
			status: "active",
			createdAt,
			updatedAt: createdAt,
		}),
		seed.insert(memberships, {
			id: demoIds.memberships.admin,
			organizationId: demoIds.organization,
			principalId: demoIds.principals.admin,
			role: "admin",
			status: "active",
			createdAt,
			updatedAt: createdAt,
		}),
		seed.insert(memberships, {
			id: demoIds.memberships.integration,
			organizationId: demoIds.organization,
			principalId: demoIds.principals.integration,
			role: "customer",
			status: "active",
			createdAt,
			updatedAt: createdAt,
		}),
		seed.insert(teams, {
			id: demoIds.team,
			organizationId: demoIds.organization,
			name: "Customer Care",
			routingStatus: "active",
			createdAt,
			updatedAt: createdAt,
		}),
	],
});
