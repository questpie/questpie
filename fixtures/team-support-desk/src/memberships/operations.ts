import { defineCollectionOperations } from "questpie";

import { memberships } from "../memberships";
import { membershipPolicy } from "./policy";

export const membershipOperations = defineCollectionOperations(memberships, {
	name: "memberships",
	policy: membershipPolicy,
	get: {
		select: {
			id: true,
			organizationId: true,
			principalId: true,
			role: true,
			status: true,
		},
	},
});
