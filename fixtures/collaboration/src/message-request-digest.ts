import { codec, policy } from "questpie";

import { defineMutation } from "#questpie/app";

export const requestCompanyDigest = defineMutation({
	name: "message.requestDigest",
	network: true,
	input: codec.object({ companyId: codec.uuid() }),
	output: codec.object({
		runId: codec.uuid(),
		resource: codec.text(),
	}),
	policy: policy.authenticated(),
	errors: {},
	handler: async ({ input, ctx }) => {
		const primary = await ctx.jobs["reports.companyDigest"].accept(
			{ companyId: input.companyId },
			{ idempotencyKey: `company-digest:${input.companyId}:primary` },
		);
		await ctx.jobs["reports.companyDigest"].accept(
			{ companyId: input.companyId },
			{
				idempotencyKey: `company-digest:${input.companyId}:delayed`,
				notBefore: new Date(ctx.operationTime.getTime() + 1_000),
			},
		);
		return primary;
	},
});
