import { job } from "questpie/services";
import { z } from "zod";

function daysAgo(days: number) {
	return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export default job({
	name: "cleanup",
	schema: z.object({
		runEventsDays: z.number().int().positive().default(30),
		joinTokensDays: z.number().int().positive().default(7),
		scheduleExecutionsDays: z.number().int().positive().default(90),
	}),
	options: {
		cron: "17 * * * *",
		retryLimit: 1,
	},
	handler: async (ctx) => {
		const runEventsCutoff = daysAgo(ctx.payload.runEventsDays);
		const joinTokensCutoff = daysAgo(ctx.payload.joinTokensDays);
		const scheduleExecutionsCutoff = daysAgo(
			ctx.payload.scheduleExecutionsDays,
		);

		const runEvents = await ctx.collections.run_events.delete({
			where: { createdAt: { lte: runEventsCutoff } },
		});
		const joinTokens = await ctx.collections.join_tokens.delete({
			where: {
				expiresAt: { lte: new Date() },
				createdAt: { lte: joinTokensCutoff },
			},
		});
		const scheduleExecutions = await ctx.collections.schedule_executions.delete(
			{
				where: { triggeredAt: { lte: scheduleExecutionsCutoff } },
			},
		);

		return {
			runEventsDeleted: Array.isArray(runEvents) ? runEvents.length : 0,
			joinTokensDeleted: Array.isArray(joinTokens) ? joinTokens.length : 0,
			scheduleExecutionsDeleted: Array.isArray(scheduleExecutions)
				? scheduleExecutions.length
				: 0,
		};
	},
});
