import { job } from "questpie";
import { z } from "zod";

/**
 * Workflow resume job.
 *
 * Resumes a suspended workflow after sleep duration expires or
 * an event is received. Published with `startAfter` set to the
 * sleep/event deadline.
 *
 * Uses `singletonKey` to prevent duplicate resume attempts.
 */
export default job({
	name: "wf-resume",
	schema: z.object({
		instanceId: z.string(),
	}),
	options: {
		retryLimit: 1, // One retry in case of transient failure
	},
	handler: async (ctx) => {
		const { getAppRef } = await import("#workflows/server/app-ref.js");
		const { resumeWorkflow } = await import(
			"#workflows/server/engine/replay.js"
		);
		await resumeWorkflow(ctx.payload.instanceId, getAppRef());
	},
});
