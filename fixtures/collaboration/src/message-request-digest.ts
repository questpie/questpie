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
	handler: async ({ input, ctx }) =>
		ctx.jobs["reports.companyDigest"].dispatch({ companyId: input.companyId }),
});
