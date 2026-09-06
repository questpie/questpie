import { codec, durable } from "questpie";

import { defineJob } from "#questpie/app";

/** Copied only into the disposable application for worker recovery races. */
export const companyDigest = defineJob({
	name: "reports.companyDigest",
	input: codec.object({
		companyId: codec.uuid(),
		restartProbe: codec.optional(codec.text()),
	}),
	output: codec.object({
		attemptNumber: codec.integer(),
		companyId: codec.uuid(),
		contextResolutionId: codec.uuid(),
		invocationId: codec.uuid(),
		role: codec.text(),
	}),
	runAs: durable.caller({ whenDenied: "fail" }),
	retry: durable.retry({
		maximumAttempts: 3,
		initialDelay: "1s",
		backoff: "exponential",
		maximumDelay: "5s",
		jitter: "full",
		horizon: "1h",
	}),
	handler: async ({ input, ctx }) => {
		const message = await ctx.run.step.mutation(
			"publish",
			ctx.mutations.message.publish,
			{
				channelId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2",
				body: input.restartProbe ?? "checkpoint-recovery",
			},
		);
		return {
			attemptNumber: ctx.attempt.number,
			companyId: input.companyId,
			contextResolutionId: ctx.values.contextResolutionId,
			invocationId: message.id,
			role: ctx.values.selectedRole,
		};
	},
});
