import { z } from "zod";

import { job } from "#questpie/server/modules/core/integrated/queue/job.js";

/**
 * Realtime outbox cleanup job.
 * Runs hourly via cron to clean up processed realtime events.
 */
export default job({
	name: "questpie.realtime.cleanup",
	schema: z.object({}),
	options: {
		cron: "0 * * * *",
	},
	handler: async (ctx) => {
		await (ctx as any).realtime.cleanupOutbox(true);
	},
});
