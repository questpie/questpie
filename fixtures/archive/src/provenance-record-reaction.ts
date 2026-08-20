import { codec, operation, policy } from "questpie";

import { defineMutation } from "#questpie/app";

export const recordReactionProvenance = defineMutation({
	name: "provenance.recordReaction",
	input: codec.object({
		archiveCode: codec.text(),
		catalogueNumber: codec.text(),
	}),
	output: codec.object({ sequence: codec.integer() }),
	policy: policy.authenticated(),
	errors: {
		recordUnavailable: operation.error({
			code: "RECORD_UNAVAILABLE",
			status: 404,
		}),
	},
	handler: async ({ input, ctx, errors }) => {
		const entry = await ctx.data.provenance.create({
			input: {
				...input,
				sequence: 2,
				kind: "indexed",
				note: "Durable Reaction observed the committed deposit",
			},
		});
		if (entry.sequence !== 2) throw errors.recordUnavailable();
		return { sequence: entry.sequence };
	},
});
