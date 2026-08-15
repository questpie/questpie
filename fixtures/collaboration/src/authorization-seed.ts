import { defineSeed, seed } from "questpie";

import { memberships } from "./memberships";

export const collaborationAuthorization = defineSeed({
	name: "collaboration.authorization.v1",
	dependsOn: ["collaboration.demo.v1"],
	steps: [
		seed.update(memberships, {
			key: {
				companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
				principalId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
				scopeKey: "company",
			},
			values: { role: "admin", status: "active" },
		}),
	],
});
