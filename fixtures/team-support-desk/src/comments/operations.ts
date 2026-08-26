import { defineCollectionOperations, mutation, operation } from "questpie";

import { comments } from "../comments";
import { commentPolicy } from "./policy";

export const commentOperations = defineCollectionOperations(comments, {
	name: "comments",
	policy: commentPolicy,
	create: {
		input: ["ticketId", "authorMembershipId", "body", "kind"],
		normalize: ({ input }) => ({ body: operation.text.trim(input.body) }),
		values: ({ operationTime }) => ({
			createdAt: mutation.overwrite(operationTime),
		}),
		select: {
			id: true,
			ticketId: true,
			authorMembershipId: true,
			body: true,
			kind: true,
			createdAt: true,
		},
	},
});
