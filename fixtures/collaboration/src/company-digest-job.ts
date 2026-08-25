import { codec, durable } from "questpie";

import { defineJob } from "#questpie/app";
import type { ExecutionInput, GeneratedApp, JobContext } from "#questpie/app";
import type { GeneratedClient } from "#questpie/client";

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
	handler: async ({ input, ctx }) => {
		if (
			Object.hasOwn(ctx, "services") ||
			Object.hasOwn(ctx, "actionScope") ||
			Object.hasOwn(ctx, "actions")
		)
			throw new TypeError("Job context leaked an action-only capability");
		await ctx.attempt.heartbeat();
		return { companyId: input.companyId };
	},
});

function jobAcceptanceCapabilityContract(
	app: GeneratedApp,
	executionInput: ExecutionInput,
	client: GeneratedClient,
	jobContext: JobContext,
): Promise<unknown> {
	// @ts-expect-error Job handlers cannot recursively accept durable work
	void jobContext.jobs;
	// @ts-expect-error browser clients expose no generic Job acceptance surface
	void client.jobs;
	return app.execution(executionInput, async ({ jobs }) => {
		const receipt = await jobs.reports.companyDigest.accept(
			{ companyId: executionInput.context.companyId },
			{ idempotencyKey: "direct-company-digest" },
		);
		// @ts-expect-error dispatch was replaced, not retained as an alias
		void jobs.reports.companyDigest.dispatch;
		return receipt;
	});
}

void jobAcceptanceCapabilityContract;
