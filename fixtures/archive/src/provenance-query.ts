import { codec } from "questpie";

import { defineQuery } from "#questpie/app";

import { recordProvenancePage } from "./provenance-page";

export const provenancePage = defineQuery({
	name: "provenance.page",
	input: codec.object({
		archiveCode: codec.text(),
		catalogueNumber: codec.text(),
		first: codec.integer(),
		after: codec.nullable(codec.text()),
	}),
	output: codec.object({
		nodes: codec.array(
			codec.object({
				archiveCode: codec.text(),
				catalogueNumber: codec.text(),
				sequence: codec.integer(),
				kind: codec.text(),
				note: codec.text(),
				recordedAt: codec.timestamp(),
			}),
		),
		pageInfo: codec.object({
			endCursor: codec.nullable(codec.text()),
			hasNextPage: codec.boolean(),
		}),
	}),
	handler: async ({ input, ctx }) => {
		const page = await ctx.data.run(recordProvenancePage, input);
		return {
			...page,
			nodes: page.nodes.map((node) => ({
				...node,
				recordedAt: new Date(node.recordedAt),
			})),
		};
	},
});
