import { codec, durable } from "questpie";

import { defineJob } from "#questpie/app";

export const companyDigest = defineJob({
	name: "reports.companyDigest",
	input: codec.object({ companyId: codec.uuid() }),
	output: codec.object({ companyId: codec.uuid() }),
	runAs: durable.caller({ whenDenied: "fail" }),
	retry: durable.retry({
		maximumAttempts: 5,
		initialDelay: "1s",
		backoff: "exponential",
		maximumDelay: "60s",
		jitter: "full",
		horizon: "24h",
	}),
	handler: async ({ input }) => ({ companyId: input.companyId }),
});
