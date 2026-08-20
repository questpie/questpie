import { codec, policy } from "questpie";

import { defineMutation } from "#questpie/app";

export const recordReactionProvenance = defineMutation({
	name: "provenance.recordReaction",
	input: codec.object({
		archiveCode: codec.text(),
		catalogueNumber: codec.text(),
	}),
	output: codec.object({ sequence: codec.integer() }),
	policy: policy.authenticated(),
	errors: {},
	handler: async ({ input, ctx }) => {
		const entry = await ctx.data.provenance.create({
			input: {
				...input,
				sequence: 2,
				kind: "indexed",
				note: "Durable Reaction observed the committed deposit",
			},
		});
		return { sequence: entry.sequence };
	},
});
