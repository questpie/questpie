import type { ExecutorRunResult } from "questpie/executor";
import { job } from "questpie/services";
import { z } from "zod";

import {
	type AppResolverCollections,
	resolveApp,
} from "../apps/app-resolver";
import {
	buildMiniAppBindingTarget,
	type MiniAppBindingCtx,
} from "../apps/mini-app-bindings";
import {
	buildEntrySource,
	resolveBrokerUrl,
	resolveCollectionRelationFields,
	resolveCollectionWriteRule,
} from "../apps/mini-app-runner";
import { createAiRunLink } from "../lib/ai-run-links";
import { asRecord, relationId, stringFrom } from "../lib/records";
import { resolveRuntimeSelection } from "../lib/runtime-selection";
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
		project:
			stringFrom(template.projectId) ?? stringFrom(template.project_id) ?? undefined,
		scopeType: (template.projectId || template.project_id
			? "project"
			: "company") as "project" | "company",
		model: stringFrom(template.modelId) ?? stringFrom(template.model_id) ?? undefined,
		queue: template.queue != null ? String(template.queue) : undefined,
		scheduledBy: scheduleActor(schedule.id),
		createdBy: scheduleActor(schedule.id),
		context: asRecord(template.context),
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

	const modelId =
		typeof template.modelId === "string"
			? template.modelId
			: typeof template.model_id === "string"
				? template.model_id
				: undefined;

	// The run_links row is the execution record the fleet worker claims +
	// streams; the stream tail resolves chat_sessions.activeRun →
	// run_links.activeStreamId. The `run-stream:…` id is logged below.
	const runtime = await resolveRuntimeSelection(
		{ collections: ctx.collections } as never,
		{ modelId, projectId },
	);
	const row = await createAiRunLink({
		ctx: ctx as never,
		runtime,
		initiatedBy: "schedule",
		kind: "chat",
		chatSessionId: session.id,
		chatMessageId: message.id,
		instructions: prompt,
		projectId,
		taskId,
		scheduleId: schedule.id,
		scheduleExecutionId: execution.id,
		linkMetadata: { modelId: modelId ?? null },
	});
	await ctx.collections.chat_sessions.updateById({
		id: session.id,
		data: { activeRun: row.id, activeStreamId: row.activeStreamId },
	});
	const streamId = row.activeStreamId ?? undefined;

	await ctx.collections.activity.create({
		actor: "job:schedule-tick",
		type: "schedule.triggered",
		summary: `Schedule created chat session: ${session.title}`,
		project: projectId,
		task: taskId,
		details: {
			scheduleId: schedule.id,
			executionId: execution.id,
			streamId: streamId ?? null,
			chatSessionId: session.id,
			messageId: message.id,
		},
	});

	return { executionId: execution.id, chatSessionId: session.id };
}

/** The narrow executor surface the cron runner needs (`ctx.executor` is `unknown`). */
interface ScheduleRunnerExecutor {
	isEnabled?: boolean;
	run(opts: {
		source: string;
		input?: unknown;
		isolation: "sandboxed";
		capabilities?: unknown;
		appBindings?: unknown;
		brokerUrl?: string;
	}): Promise<ExecutorRunResult>;
}

/**
 * The app-instance shape the cron runner reads off the job context: the
 * executor service, the resolved `config` (for the TRUSTED broker URL), and
 * `getCollectionConfig` (host-side relation-field detection — G3). Mirrors the
 * M4 route's access of `ctx.app`.
 */
interface ScheduleRunnerApp {
	executor?: ScheduleRunnerExecutor;
	config?: { executor?: { brokerUrl?: string } };
	getCollectionConfig?: (name: string) => {
		getMeta(): { relations?: string[] };
		/** Builder state — `state.access` backs the G4 explicit-write-rule check. */
		state?: { access?: Record<string, unknown> };
	};
}

/**
 * Pick the cron export the schedule should invoke from the app's
 * statically-inferred cron exports (default-deny):
 *
 *   - when the schedule names `appFn`, it MUST be a declared cron export;
 *   - otherwise the app must declare EXACTLY ONE cron export (the unambiguous
 *     default). Zero or many → error (the schedule must disambiguate).
 *
 * HTTP endpoint exports are NOT addressable here — only declared crons run on a
 * schedule (the mirror of the route refusing to run a cron export as HTTP).
 */
export function pickCronExport(
	crons: { name: string }[],
	appFn: string | undefined,
	appId: string,
): string {
	if (appFn) {
		const match = crons.find((c) => c.name === appFn);
		if (!match) {
			throw new Error(
				`mini-app "${appId}" has no cron export "${appFn}" ` +
					`(declared crons: ${crons.map((c) => c.name).join(", ") || "none"})`,
			);
		}
		return match.name;
	}
	if (crons.length === 1) return crons[0]!.name;
	if (crons.length === 0) {
		throw new Error(
			`mini-app "${appId}" declares no cron export; set the schedule's appFn ` +
				"or add a `cron`-prefixed export to the app entry",
		);
	}
	throw new Error(
		`mini-app "${appId}" declares multiple cron exports ` +
			`(${crons.map((c) => c.name).join(", ")}); set the schedule's appFn to choose one`,
	);
}

/**
 * Run a Knowledge mini-app's cron export on a schedule (the M5 UNTRUSTED cron
 * runner). Mirrors {@link triggerTaskSchedule}'s structure but parks the
 * programmatic executor on the schedule instead of creating a task/chat:
 *
 *   1. resolve the app + manifest from the Knowledge tree (M3 `resolveApp`);
 *   2. pick the declared cron export (default-deny via {@link pickCronExport});
 *   3. build the HOST-SIDE, tenant-scoped, NON-PRIVILEGED bindings target
 *      ({@link buildMiniAppBindingTarget} — G1/G2/G3, the security boundary);
 *   4. run SANDBOXED with the manifest capabilities + the CONFIG broker URL
 *      (`resolveBrokerUrl` — NEVER request-derived; a cron has no request);
 *   5. record `run_links` (with `metadata.stepType:"app"`) + `schedule_executions`
 *      for observability, updating both with the run result.
 *
 * A cron run has NO HTTP session, so the bindings target uses the synthesized
 * non-privileged app-principal (handled inside `buildMiniAppBindingTarget`).
 */
export async function triggerAppSchedule(
	ctx: ScheduleTickContext,
	schedule: ScheduleDoc,
	now: Date,
) {
	const app = (ctx as unknown as { app: ScheduleRunnerApp }).app;
	const executor = app?.executor;
	if (!executor || executor.isEnabled === false) {
		throw new Error(
			"executor is not configured; the sandboxed mini-app runtime is unavailable",
		);
	}

	const appId = String(schedule.appId ?? "");
	if (!appId) {
		throw new Error(
			`schedule ${schedule.id} is mode "app" but has no appId configured`,
		);
	}
	const appFn = typeof schedule.appFn === "string" ? schedule.appFn : undefined;

	// 1. Resolve the app + manifest from the Knowledge tree (M3). `assertValidAppId`
	//    inside the resolver rejects a malformed appId before any path/principal use.
	const resolved = await resolveApp(
		appId,
		ctx.collections as unknown as AppResolverCollections,
	);

	// 2. Pick the declared cron export to invoke (default-deny).
	const cronName = pickCronExport(resolved.crons, appFn, appId);

	// 3. Build the HOST-SIDE, tenant-scoped, non-privileged bindings target
	//    (G1 knowledge clamp, G2 user-mode principal, G3 relation guard). No HTTP
	//    session on a cron → the synthesized app-principal is used. Never trusts
	//    the manifest.
	const target = buildMiniAppBindingTarget(
		appId,
		ctx as unknown as MiniAppBindingCtx,
		resolved.capabilities,
		(name) => resolveCollectionRelationFields(app, name),
		(name, op) => resolveCollectionWriteRule(app, name, op),
	);

	// 4. The cron "tick" payload handed to the guest export as `input`.
	const input = {
		app: appId,
		fn: cronName,
		trigger: "cron",
		scheduleId: schedule.id,
		scheduledAt: now.toISOString(),
	};

	// The broker URL the SUPERVISOR uses to reach the host broker — from
	// CONFIG/ENV ONLY (a cron has no request; never request-derived).
	const brokerUrl = resolveBrokerUrl(app);

	// 5a. Observability rows FIRST so a crash mid-run still leaves a trail.
	const run = await ctx.collections.run_links.create({
		schedule: schedule.id,
		initiatedBy: "schedule",
		status: "running",
		instructions: `mini-app ${appId}/${cronName} (scheduled)`,
		startedAt: now,
		metadata: { stepType: "app", appId, appFn: cronName, scheduleId: schedule.id },
	});
	const execution = await ctx.collections.schedule_executions.create({
		schedule: schedule.id,
		run: run.id,
		status: "triggered",
		triggeredAt: now,
		metadata: { mode: "app", appId, appFn: cronName, stepType: "app" },
	});

	// 5b. Run sandboxed: the executor service mints the per-run scoped token bound
	//     to (capabilities, target) and the supervisor brokers the guest's RPCs.
	let result: ExecutorRunResult;
	try {
		result = await executor.run({
			source: buildEntrySource(resolved.entrySource, cronName),
			input,
			isolation: "sandboxed",
			capabilities: resolved.capabilities,
			appBindings: target,
			brokerUrl,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await ctx.collections.run_links.updateById({
			id: run.id,
			data: { status: "failed", endedAt: new Date(), error: message },
		});
		throw error;
	}

	const endedAt = new Date();
	await ctx.collections.run_links.updateById({
		id: run.id,
		data: {
			status: result.ok ? "completed" : "failed",
			endedAt,
			summary: result.ok ? "mini-app run completed" : undefined,
			error: result.ok ? undefined : (result.error ?? "mini-app execution failed"),
		},
	});

	await ctx.collections.activity.create({
		actor: "job:schedule-tick",
		type: result.ok ? "schedule.triggered" : "schedule.failed",
		summary: result.ok
			? `Schedule ran mini-app: ${appId}/${cronName}`
			: `Schedule mini-app failed: ${appId}/${cronName}`,
		details: {
			scheduleId: schedule.id,
			executionId: execution.id,
			runId: run.id,
			appId,
			appFn: cronName,
			ok: result.ok,
			...(result.ok ? {} : { error: result.error ?? null }),
		},
	});

	return { executionId: execution.id, runId: run.id, ok: result.ok };
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
				const policy = String(schedule.concurrencyPolicy ?? "allow");
				const active =
					policy === "skip" || policy === "replace"
						? await hasActiveExecution(ctx, schedule.id)
						: null;
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
						: mode === "app"
							? await triggerAppSchedule(ctx, schedule, now)
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
