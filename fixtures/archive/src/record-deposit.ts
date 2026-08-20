import { codec, operation, policy } from "questpie";

import { defineMutation } from "#questpie/app";

export const depositRecord = defineMutation({
	name: "record.deposit",
	network: true,
	input: codec.object({
		archiveCode: codec.text(),
		catalogueNumber: codec.text(),
		visibility: codec.text(),
		title: codec.text(),
		body: codec.text(),
	}),
	output: codec.object({
		archiveCode: codec.text(),
		catalogueNumber: codec.text(),
		createdAt: codec.timestamp(),
	}),
	policy: policy.authenticated(),
	errors: {
		depositDenied: operation.error({ code: "DEPOSIT_DENIED", status: 404 }),
	},
	handler: async ({ input, ctx, errors }) => {
		ctx.signal.throwIfAborted();
		if (input.archiveCode !== ctx.values.selectedArchiveCode)
			throw errors.depositDenied();
		const record = await ctx.data.records.create({ input });
		if (record.body === undefined) throw errors.depositDenied();
		await ctx.data.provenance.create({
			input: {
				archiveCode: record.archiveCode,
				catalogueNumber: record.catalogueNumber,
				sequence: 1,
				kind: "deposited",
				note: "Record accepted into the archive",
			},
		});
		await ctx.dispatch.recordDeposited({
			archiveCode: record.archiveCode,
			catalogueNumber: record.catalogueNumber,
		});
		return {
			archiveCode: record.archiveCode,
			catalogueNumber: record.catalogueNumber,
			createdAt: record.createdAt,
		};
	},
});
