import { codec } from "questpie";

import { defineQuery } from "#questpie/app";

import { archiveRecordPage } from "./record-page";

export const recordPage = defineQuery({
	name: "records.page",
	network: true,
	input: codec.object({
		archiveCode: codec.text(),
		first: codec.integer(),
		after: codec.nullable(codec.text()),
	}),
	output: codec.object({
		nodes: codec.array(
			codec.object({
				archiveCode: codec.text(),
				catalogueNumber: codec.text(),
				visibility: codec.text(),
				title: codec.text(),
				body: codec.optional(codec.text()),
				createdAt: codec.timestamp(),
			}),
		),
		pageInfo: codec.object({
			endCursor: codec.nullable(codec.text()),
			hasNextPage: codec.boolean(),
		}),
	}),
	handler: async ({ input, ctx }) => {
		const page = await ctx.data.run(archiveRecordPage, input);
		return {
			...page,
			nodes: page.nodes.map((node) => ({
				...node,
				createdAt: new Date(node.createdAt),
			})),
		};
	},
});
