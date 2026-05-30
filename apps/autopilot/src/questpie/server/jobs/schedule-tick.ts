import { job } from "questpie/services";
import { z } from "zod";

import { asJsonValue, asRecord, relationId } from "../lib/records";
import {
	computeNextRunAt,
	dateOrNull,
	interpolateTemplate,
} from "../lib/schedules";
import { workflowsFromContext } from "../lib/workflows";

type ScheduleDoc = Record<string, unknown> & { id: string };
type ScheduleTickContext = Questpie.JobHandlerContext;

function isDue(schedule: ScheduleDoc, now: Date) {
	const nextRunAt = dateOrNull(schedule.nextRunAt);
	return !nextRunAt || nextRunAt <= now;
}

function scheduleActor(scheduleId: string) {
	return `schedule:${scheduleId}`;
}

function templateValue(
	template: Record<string, unknown>,
	key: string,
	fallback: string,
	now: Date,
) {
	const value = template[key];
	return interpolateTemplate(typeof value === "string" ? value : fallback, now);
}

async function advanceSchedule(
	ctx: ScheduleTickContext,
	schedule: ScheduleDoc,
	now: Date,
) {
	let nextRunAt: Date | null = null;
	try {
		nextRunAt = computeNextRunAt(
			String(schedule.cron ?? ""),
			String(schedule.timezone ?? "UTC"),
			now,
		);
	} catch (error) {
		await ctx.collections.activity.create({
			actor: "job:schedule-tick",
			type: "schedule.invalid_cron",
			summary: `Invalid schedule cron: ${schedule.name ?? schedule.id}`,
			details: {
				scheduleId: schedule.id,
				error: error instanceof Error ? error.message : String(error),
			},
		});
	}

	await ctx.collections.schedules.updateById({
		id: schedule.id,
		data: {
			lastRunAt: now,
			nextRunAt: nextRunAt ?? null,
			enabled: nextRunAt ? schedule.enabled === true : false,
		},
	});
}

async function hasActiveExecution(
	ctx: ScheduleTickContext,
	scheduleId: string,
) {
	const executions = await ctx.collections.schedule_executions.find({
		where: { schedule: scheduleId, status: "triggered" },
		limit: 20,
		orderBy: { triggeredAt: "desc" },
	});

	for (const execution of executions.docs) {
		const taskId = relationId(execution.task);
		if (taskId) {
			const task = await ctx.collections.tasks.findOne({
				where: { id: taskId },
			});
			if (
				task &&
				!["review", "approved", "done", "failed", "cancelled"].includes(
					String(task.status),
				)
			) {
				return { execution, task };
			}
		}
	}

	return null;
}

async function cancelActiveExecution(
	ctx: ScheduleTickContext,
	schedule: ScheduleDoc,
	active: {
		execution: Record<string, unknown>;
		task?: Record<string, unknown> | null;
	},
) {
	const taskId = relationId(active.execution.task) ?? relationId(active.task);
	if (!taskId) return;

	await ctx.collections.tasks.updateById({
		id: taskId,
		data: { status: "cancelled" },
	});
	const runs = await ctx.collections.run_links.find({
		where: { task: taskId, status: { in: ["pending", "claimed", "running"] } },
		limit: 100,
	});
	for (const run of runs.docs) {
		await ctx.collections.run_links.updateById({
			id: run.id,
			data: {
				status: "cancelled",
				endedAt: new Date(),
				error: `Cancelled by replacement schedule run ${schedule.id}`,
			},
		});
		const aiRunId = relationId(run.aiRun);
		if (aiRunId) {
			await ctx.collections.ai_runs.updateById({
				id: aiRunId,
				data: {
					status: "cancelled",
					endedAt: new Date(),
					error: `Cancelled by replacement schedule run ${schedule.id}`,
				},
			});
		}
	}
	await ctx.collections.activity.create({
		actor: "job:schedule-tick",
		type: "schedule.replaced",
		summary: `Schedule replaced active task ${taskId}`,
		task: taskId,
		details: { scheduleId: schedule.id },
	});
}

async function triggerTaskSchedule(
	ctx: ScheduleTickContext,
	schedule: ScheduleDoc,
	now: Date,
) {
	const template = asRecord(schedule.taskTemplate);
	const task = await ctx.collections.tasks.create({
		title: templateValue(
			template,
			"title",
			`Scheduled: ${String(schedule.name ?? schedule.id)}`,
			now,
		),
		description: template.description
			? templateValue(template, "description", "", now)
			: undefined,
		type: String(template.type ?? "task") as
			| "task"
			| "feature"
			| "bug"
			| "research"
			| "review"
			| "approval",
		status: "pending",
		priority: String(template.priority ?? "medium") as
			| "low"
			| "medium"
			| "high"
			| "urgent",
		project: template.projectId ?? template.project_id ?? undefined,
		scopeType: (template.projectId || template.project_id
			? "project"
			: "company") as "project" | "company",
		model: template.modelId ?? template.model_id ?? undefined,
		queue: template.queue != null ? String(template.queue) : undefined,
		scheduledBy: scheduleActor(schedule.id),
		createdBy: scheduleActor(schedule.id),
		context: asJsonValue(asRecord(template.context)),
		metadata: {
			...asRecord(template.metadata),
			scheduleId: schedule.id,
			triggeredAt: now.toISOString(),
		},
	});

	const execution = await ctx.collections.schedule_executions.create({
		schedule: schedule.id,
		task: task.id,
		status: "triggered",
		triggeredAt: now,
		metadata: { mode: "task" },
	});

	const workflow = await workflowsFromContext(ctx).trigger(
		"task-pipeline",
		{
			taskId: task.id,
			runReason: "schedule",
			requestedBy: scheduleActor(schedule.id),
			scheduleExecutionId: execution.id,
		},
		{ idempotencyKey: `schedule:${schedule.id}:${execution.id}:task` },
	);

	await ctx.collections.activity.create({
		actor: "job:schedule-tick",
		type: "schedule.triggered",
		summary: `Schedule created task: ${task.title}`,
		task: task.id,
		project: relationId(task.project) ?? undefined,
		details: {
			scheduleId: schedule.id,
			executionId: execution.id,
			workflowInstanceId: workflow.instanceId,
		},
	});

	return { executionId: execution.id, taskId: task.id };
}

async function triggerChatSchedule(
	ctx: ScheduleTickContext,
	schedule: ScheduleDoc,
	now: Date,
) {
	const template = asRecord(schedule.taskTemplate);
	const prompt = interpolateTemplate(
		String(
			schedule.chatPrompt ??
				template.prompt ??
				`Scheduled chat: ${schedule.name ?? schedule.id}`,
		),
		now,
	);
	const projectId =
		String(template.projectId ?? template.project_id ?? "") || undefined;
	const taskId = String(template.taskId ?? template.task_id ?? "") || undefined;

	const session = await ctx.collections.chat_sessions.create({
		title: `Scheduled: ${String(schedule.name ?? schedule.id)}`,
		status: "active",
		scopeType: projectId ? "project" : "company",
		project: projectId,
		task: taskId,
		metadata: { scheduleId: schedule.id, triggeredAt: now.toISOString() },
	});
	const message = await ctx.collections.chat_messages.create({
		chatSession: session.id,
		role: "user",
		content: prompt,
		metadata: { scheduleId: schedule.id },
	});
	const execution = await ctx.collections.schedule_executions.create({
		schedule: schedule.id,
		chatSession: session.id,
		status: "triggered",
		triggeredAt: now,
		metadata: { mode: "chat", messageId: message.id },
	});

	const workflow = await workflowsFromContext(ctx).trigger(
		"chat-query",
		{
			chatSessionId: session.id,
			messageId: message.id,
			prompt,
			projectId: projectId ?? null,
			taskId: taskId ?? null,
			scheduleExecutionId: execution.id,
			modelId:
				typeof template.modelId === "string"
					? template.modelId
					: typeof template.model_id === "string"
						? template.model_id
						: null,
		},
		{ idempotencyKey: `schedule:${schedule.id}:${execution.id}:chat` },
	);

	await ctx.collections.activity.create({
		actor: "job:schedule-tick",
		type: "schedule.triggered",
		summary: `Schedule created chat session: ${session.title}`,
		project: projectId,
		task: taskId,
		details: {
			scheduleId: schedule.id,
			executionId: execution.id,
			workflowInstanceId: workflow.instanceId,
			chatSessionId: session.id,
			messageId: message.id,
		},
	});

	return { executionId: execution.id, chatSessionId: session.id };
}

export default job({
	name: "schedule-tick",
	schema: z.object({
		now: z.string().datetime().optional(),
		limit: z.number().int().positive().max(500).default(100),
	}),
	options: {
		cron: "* * * * *",
		retryLimit: 1,
	},
	handler: async (ctx) => {
		const now = ctx.payload.now ? new Date(ctx.payload.now) : new Date();
		const schedules = await ctx.collections.schedules.find({
			where: { enabled: true },
			limit: ctx.payload.limit,
			orderBy: { nextRunAt: "asc" },
		});

		const results = [];
		for (const schedule of schedules.docs as ScheduleDoc[]) {
			if (!isDue(schedule, now)) continue;

			try {
				const active = await hasActiveExecution(ctx, schedule.id);
				const policy = String(schedule.concurrencyPolicy ?? "allow");
				if (active && policy === "skip") {
					const execution = await ctx.collections.schedule_executions.create({
						schedule: schedule.id,
						status: "skipped",
						skipReason: `active execution ${active.execution.id} still running`,
						triggeredAt: now,
						metadata: { activeExecutionId: active.execution.id },
					});
					await advanceSchedule(ctx, schedule, now);
					results.push({
						scheduleId: schedule.id,
						status: "skipped",
						executionId: execution.id,
					});
					continue;
				}
				if (active && policy === "replace") {
					await cancelActiveExecution(ctx, schedule, active);
				}

				const mode = String(schedule.mode ?? "task");
				const result =
					mode === "chat"
						? await triggerChatSchedule(ctx, schedule, now)
						: await triggerTaskSchedule(ctx, schedule, now);
				await advanceSchedule(ctx, schedule, now);
				results.push({
					scheduleId: schedule.id,
					status: "triggered",
					...result,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const execution = await ctx.collections.schedule_executions.create({
					schedule: schedule.id,
					status: "failed",
					error: message,
					triggeredAt: now,
				});
				await ctx.collections.activity.create({
					actor: "job:schedule-tick",
					type: "schedule.failed",
					summary: `Schedule failed: ${schedule.name ?? schedule.id}`,
					details: {
						scheduleId: schedule.id,
						executionId: execution.id,
						error: message,
					},
				});
				await advanceSchedule(ctx, schedule, now);
				results.push({
					scheduleId: schedule.id,
					status: "failed",
					executionId: execution.id,
				});
			}
		}

		return { checked: schedules.docs.length, results };
	},
});
