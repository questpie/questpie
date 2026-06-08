import { job } from "questpie/services";
import { z } from "zod";

import { asRecord, mergeRecords, relationId } from "../lib/records";
import { dateOrNull } from "../lib/schedules";

function minutesAgo(minutes: number, now = new Date()) {
	return new Date(now.getTime() - minutes * 60 * 1000);
}

function shouldEscalate(record: Record<string, unknown>, cutoff: Date) {
	const updatedAt =
		dateOrNull(record.updatedAt) ?? dateOrNull(record.createdAt);
	return !updatedAt || updatedAt <= cutoff;
}

export default job({
	name: "task-escalation",
	schema: z.object({
		staleRunningMinutes: z.number().int().positive().default(120),
		staleWaitingMinutes: z
			.number()
			.int()
			.positive()
			.default(24 * 60),
		limit: z.number().int().positive().max(500).default(100),
	}),
	options: {
		cron: "*/15 * * * *",
		retryLimit: 1,
	},
	handler: async (ctx) => {
		const now = new Date();
		const runningCutoff = minutesAgo(ctx.payload.staleRunningMinutes, now);
		const waitingCutoff = minutesAgo(ctx.payload.staleWaitingMinutes, now);
		const candidates = await ctx.collections.tasks.find({
			where: { status: { in: ["running", "waiting", "failed"] } },
			limit: ctx.payload.limit,
			orderBy: { updatedAt: "asc" },
		});

		const escalatedTaskIds: string[] = [];
		for (const task of candidates.docs as Array<Record<string, unknown>>) {
			const status = String(task.status);
			const cutoff = status === "running" ? runningCutoff : waitingCutoff;
			if (!shouldEscalate(task, cutoff)) continue;

			const metadata = asRecord(task.metadata);
			const lastEscalatedAt = dateOrNull(metadata.lastEscalatedAt);
			if (lastEscalatedAt && lastEscalatedAt > cutoff) continue;

			await ctx.collections.tasks.updateById({
				id: String(task.id),
				data: {
					...(status === "running" && { status: "waiting" }),
					metadata: mergeRecords(metadata, {
							lastEscalatedAt: now.toISOString(),
							escalationReason:
								status === "running" ? "stale_running" : `stale_${status}`,
						}),
				},
			});
			await ctx.collections.activity.create({
				actor: "job:task-escalation",
				type: "task.escalation",
				summary: `Task needs operator attention: ${task.title ?? task.id}`,
				task: String(task.id),
				project: relationId(task.project) ?? undefined,
				details: {
					status,
					nextStatus: status === "running" ? "waiting" : status,
					staleRunningMinutes: ctx.payload.staleRunningMinutes,
					staleWaitingMinutes: ctx.payload.staleWaitingMinutes,
				},
			});
			escalatedTaskIds.push(String(task.id));
		}

		return { checked: candidates.docs.length, escalatedTaskIds };
	},
});
