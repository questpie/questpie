import { job } from "questpie";
import { z } from "zod";

/**
 * Workflow maintenance cron job.
 *
 * Runs every 5 minutes to:
 * 1. Timeout: Mark running workflows past their timeoutAt as timed_out
 * 2. Stuck resume: Re-publish wf-resume for suspended workflows past their deadline
 * 3. Retention: Clean up old completed workflow data
 */
export default job({
	name: "wf-maintenance",
	schema: z.object({}),
	options: {
		retryLimit: 0,
	},
	handler: async () => {
		const { getAppRef } = await import("#workflows/server/app-ref.js");
		const { runMaintenance } = await import(
			"#workflows/server/engine/replay.js"
		);
		await runMaintenance(getAppRef());
	},
});
