import { relationId } from "./records";

export async function linkScheduleExecutionRun(input: {
	ctx: Questpie.AppContext;
	scheduleExecutionId?: string | null;
	runId: string;
}) {
	if (!input.scheduleExecutionId) return;

	const runLink = await input.ctx.collections.run_links.findOne({
		where: { id: input.runId },
	});
	if (!runLink) return;

	const execution = await input.ctx.collections.schedule_executions.findOne({
		where: { id: input.scheduleExecutionId },
	});

	await input.ctx.collections.run_links.updateById({
		id: input.runId,
		data: {
			scheduleExecution: input.scheduleExecutionId,
			schedule: relationId(execution?.schedule) ?? undefined,
			task: relationId(execution?.task) ?? undefined,
			chatSession: relationId(execution?.chatSession) ?? undefined,
		},
	});
	await input.ctx.collections.schedule_executions.updateById({
		id: input.scheduleExecutionId,
		data: { run: input.runId },
	});
}
