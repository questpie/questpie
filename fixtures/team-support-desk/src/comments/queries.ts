import { codec } from "questpie";

import { defineQuery } from "#questpie/app";

import { commentPagePlan } from "./query-plan";

const pageInfoCodec = codec.object({
	endCursor: codec.nullable(codec.text()),
	hasNextPage: codec.boolean(),
});

const pageInputCodec = {
	first: codec.integer(),
	after: codec.nullable(codec.cursor()),
} as const;

function timestamp(value: Date | string): Date {
	return value instanceof Date ? value : new Date(value);
}

const membershipSummaryCodec = codec.object({
	id: codec.uuid(),
	principalId: codec.text(),
	role: codec.text(),
});

export const pageComments = defineQuery({
	name: "comments.page",
	network: true,
	input: codec.object({ ticketId: codec.uuid(), ...pageInputCodec }),
	output: codec.object({
		nodes: codec.array(
			codec.object({
				id: codec.uuid(),
				ticketId: codec.uuid(),
				authorMembershipId: codec.uuid(),
				body: codec.text(),
				kind: codec.text(),
				createdAt: codec.timestamp(),
				author: codec.nullable(membershipSummaryCodec),
			}),
		),
		pageInfo: pageInfoCodec,
	}),
	handler: async ({ input, ctx }) => {
		const page = await ctx.data.run(commentPagePlan, input);
		return {
			...page,
			nodes: page.nodes.map((comment) => ({
				...comment,
				createdAt: timestamp(comment.createdAt),
			})),
		};
	},
});
