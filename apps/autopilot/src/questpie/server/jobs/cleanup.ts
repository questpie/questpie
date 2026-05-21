import { job } from "questpie/services";
import { z } from "zod";

function daysAgo(days: number) {
	return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export default job({
	name: "cleanup",
	schema: z.object({
		scheduleExecutionsDays: z.number().int().positive().default(90),
	}),
	options: {
		cron: "17 * * * *",
		retryLimit: 1,
	},
	handler: async (ctx) => {
		const scheduleExecutionsCutoff = daysAgo(
			ctx.payload.scheduleExecutionsDays,
		);

		const scheduleExecutions = await ctx.collections.schedule_executions.delete(
			{
				where: { triggeredAt: { lte: scheduleExecutionsCutoff } },
			},
		);

		return {
			scheduleExecutionsDeleted: Array.isArray(scheduleExecutions)
				? scheduleExecutions.length
				: 0,
		};
	},
});
