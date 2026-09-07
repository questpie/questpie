import { defineSeed, seed } from "questpie";

import { demoIds } from "../demo-ids";
import { memberships } from "./index";

export const supportSweepIdentity = defineSeed({
	name: "teamSupport.sweepIdentity.v1",
	dependsOn: ["teamSupport.identity.v1"],
	steps: [
		seed.insert(memberships, {
			id: demoIds.memberships.sweep,
			organizationId: demoIds.organization,
			principalId: demoIds.principals.sweep,
			role: "agent",
			status: "active",
			createdAt: "2026-09-06T00:00:00.000Z",
			updatedAt: "2026-09-06T00:00:00.000Z",
		}),
	],
});
