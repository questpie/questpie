import { defineCollectionOperations, mutation, operation } from "questpie";

import { labels } from "../labels";
import { labelPolicy } from "./policy";

export const labelOperations = defineCollectionOperations(labels, {
	name: "labels",
	policy: labelPolicy,
	create: {
		input: ["ticketId", "name", "color"],
		normalize: ({ input }) => ({
			name: operation.text.trim(input.name),
			color: operation.text.trim(input.color),
		}),
		values: ({ tenant, operationTime }) => ({
			organizationId: mutation.overwrite(tenant.id),
			createdAt: mutation.overwrite(operationTime),
		}),
		select: {
			id: true,
			organizationId: true,
			ticketId: true,
			name: true,
			color: true,
			createdAt: true,
		},
	},
	update: {
		input: ["name", "color"],
		normalize: ({ input }) => ({
			name: operation.text.trimIfPresent(input.name),
			color: operation.text.trimIfPresent(input.color),
		}),
		select: { id: true, name: true, color: true },
	},
	delete: { select: { id: true } },
});
