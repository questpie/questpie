import { job } from "questpie/services";
import { z } from "zod";

// The "run-available" kick (spec §3.3/§3.4): createRunLink enqueues this right
// after inserting a pending run_links row so an idle worker claims promptly
// instead of waiting a full poll interval. Best-effort acceleration only — the
// run_links row is the source of truth, the kick is delivery acceleration.
//
// The worker-side poll-nudge consumer lands in T4/T5 (startAIWorker +
// workerManager re-point to run_links). claimRun is still ai_runs-based until
// T5, so this handler must NOT attempt a claim yet — it stays a placeholder.
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
		// Placeholder until T4/T5 wires the poll-nudge into startAIWorker.
		logger.debug?.(
			`run-available kick received (runtime=${payload.runtime ?? "?"}; poll-nudge wiring lands in T4/T5)`,
		);
	},
});
