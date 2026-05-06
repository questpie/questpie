import { z } from "zod";

import { workflow } from "@questpie/workflows";

export default workflow({
	name: "nightly-capacity-review",
	schema: z.object({}),
	cron: "0 2 * * *",
	cronOverlap: "skip",
	handler: async ({ step, ctx }) => {
		await step.run("refresh-material-plan", async () => {
			await ctx.queue.recalculateMaterialPlan.publish({});
		});
		return { queued: true };
	},
});
