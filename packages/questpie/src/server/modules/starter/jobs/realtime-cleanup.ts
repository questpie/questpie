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
		// With `realtime.changeCapture: false` nothing ever writes the outbox, so
		// the hourly DELETE would only be a scan the application did not ask for.
		if ((ctx as any).app?.config?.realtime?.changeCapture === false) return;
		await (ctx as any).realtime.cleanupOutbox(true);
	},
});
