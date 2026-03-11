import { job } from "questpie";
import { z } from "zod";

/**
 * Main workflow execution job.
 *
 * Runs the workflow handler through the replay engine.
 * Published with `singletonKey: "wf-exec-{instanceId}"` to prevent
 * concurrent execution of the same workflow instance.
 *
 * Retry logic is handled by the replay engine (not PgBoss),
 * so retryLimit is set to 0.
 */
export default job({
	name: "wf-execute",
	schema: z.object({
		instanceId: z.string(),
	}),
	options: {
		retryLimit: 0, // Replay engine handles retries
	},
	handler: async (ctx) => {
		const { getAppRef } = await import("#workflows/server/app-ref.js");
		const { executeWorkflow } = await import(
			"#workflows/server/engine/replay.js"
		);
		await executeWorkflow(ctx.payload.instanceId, getAppRef());
	},
});
