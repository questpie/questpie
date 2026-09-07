import { defineCollectionOperations } from "questpie";

import { teams } from "./index";
import { teamPolicy } from "./policy";

export const teamOperations = defineCollectionOperations(teams, {
	name: "teams",
	policy: teamPolicy,
	get: {
		select: {
			id: true,
			organizationId: true,
			name: true,
			routingStatus: true,
		},
	},
});
