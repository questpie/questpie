import { defineCollectionOperations, mutation, operation } from "questpie";

import { teams } from "../teams";
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
	update: {
		input: ["name", "routingStatus"],
		normalize: ({ input }) => ({
			name: operation.text.trimIfPresent(input.name),
		}),
		values: ({ operationTime }) => ({
			updatedAt: mutation.overwrite(operationTime),
		}),
		select: { id: true, name: true, routingStatus: true, updatedAt: true },
	},
});
