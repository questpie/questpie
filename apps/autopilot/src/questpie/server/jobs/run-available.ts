import { job } from "questpie/services";
import { z } from "zod";

// The "run-available" kick (spec §3.3/§3.4): createRunLink enqueues this right
// after inserting a pending run_links row so an idle worker claims promptly
// instead of waiting a full poll interval. Best-effort acceleration only — the
// run_links row is the source of truth, the kick is delivery acceleration.
//
// Honest status: the worker-side poll-nudge consumer is still unwired —
// startAIWorker only claims on its own poll interval, so this handler stays a
// logging placeholder until the kick is plumbed into the worker loop.
export default job({
	name: "run-available",
	schema: z.object({
		runtime: z.string().optional(),
	}),
	options: {
		retryLimit: 0,
	},
	handler: async (ctx) => {
		const { logger, payload } = ctx;
		// Placeholder until the poll-nudge is wired into startAIWorker.
		logger.debug?.(
			`run-available kick received (runtime=${payload.runtime ?? "?"}; poll-nudge consumer not wired yet)`,
		);
	},
});
