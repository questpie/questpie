import { codec } from "questpie";

import { defineQuery } from "#questpie/app";

import { labelPagePlan } from "./query-plan";

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

export const pageLabels = defineQuery({
	name: "labels.page",
	network: true,
	input: codec.object({ ticketId: codec.uuid(), ...pageInputCodec }),
	output: codec.object({
		nodes: codec.array(
			codec.object({
				id: codec.uuid(),
				organizationId: codec.uuid(),
				ticketId: codec.uuid(),
				name: codec.text(),
				color: codec.text(),
				createdAt: codec.timestamp(),
			}),
		),
		pageInfo: pageInfoCodec,
	}),
	handler: async ({ input, ctx }) => {
		const page = await ctx.data.run(labelPagePlan, input);
		return {
			...page,
			nodes: page.nodes.map((label) => ({
				...label,
				createdAt: timestamp(label.createdAt),
			})),
		};
	},
});
