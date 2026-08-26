import { defineCollectionOperations, mutation } from "questpie";

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
	update: {
		input: ["role", "status"],
		values: ({ operationTime }) => ({
			updatedAt: mutation.overwrite(operationTime),
		}),
		select: { id: true, role: true, status: true, updatedAt: true },
	},
});
