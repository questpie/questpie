import { z } from "zod";

import { workflow } from "@questpie/workflows";

import { createAiRunLink } from "../lib/ai-run-links";
import type { AppCollections, WorkflowServiceContext } from "../lib/app-types";
import { classifyRunError, type RunErrorType } from "../lib/error-classifier";
import { injectMemoriesIntoInstructions } from "../lib/memory-injection";
import { runReflectionStep } from "../lib/memory-reflect-step";
import { projectWorkspacePath } from "../lib/project-workspace";
import {
	asRecord,
	mergeRecords,
	relationId,
} from "../lib/records";
import type { RunCompletion } from "../lib/run-completion";
import { resolveRuntimeSelection } from "../lib/runtime-selection";
import { linkScheduleExecutionRun } from "../lib/schedule-run-links";
import { buildSkillsSystemPrompt } from "../lib/skill-discovery";
import { workflowsFromContext } from "../lib/workflows";

type Collections = AppCollections;

interface RetryPolicy {
	maxAttempts: number;
	delaySeconds: number;
	backoffMultiplier: number;
	maxDelaySeconds?: number;
	retryOn: RunErrorType[];
}

const DEFAULT_RETRY_POLICY: RetryPolicy = {
	maxAttempts: 2,
	delaySeconds: 60,
	backoffMultiplier: 2,
	maxDelaySeconds: 15 * 60,
	retryOn: ["infra", "timeout", "rate_limit"],
};

function retryPolicyFrom(value: unknown): RetryPolicy {
	const raw = asRecord(value);
	const retryOn = Array.isArray(raw.retryOn)
		? raw.retryOn
		: Array.isArray(raw.retry_on)
			? raw.retry_on
			: DEFAULT_RETRY_POLICY.retryOn;

	return {
		maxAttempts: Math.max(
			1,
			Number(raw.maxAttempts ?? raw.max_attempts) ||
				DEFAULT_RETRY_POLICY.maxAttempts,
		),
		delaySeconds: Math.max(
			0,
			Number(raw.delaySeconds ?? raw.delay_seconds) ||
				DEFAULT_RETRY_POLICY.delaySeconds,
		),
		backoffMultiplier: Math.max(
			1,
			Number(raw.backoffMultiplier ?? raw.backoff_multiplier) ||
				DEFAULT_RETRY_POLICY.backoffMultiplier,
		),
		maxDelaySeconds:
			raw.maxDelaySeconds || raw.max_delay_seconds
				? Math.max(0, Number(raw.maxDelaySeconds ?? raw.max_delay_seconds))
				: DEFAULT_RETRY_POLICY.maxDelaySeconds,
		retryOn: retryOn.filter((item): item is RunErrorType =>
			[
				"infra",
				"timeout",
				"rate_limit",
				"account_balance",
				"business",
				"unknown",
			].includes(String(item)),
		),
	};
}

function retryDelay(policy: RetryPolicy, attempt: number) {
	const delay =
		policy.delaySeconds * policy.backoffMultiplier ** Math.max(0, attempt - 1);
	return Math.min(delay, policy.maxDelaySeconds ?? delay);
}

function taskInstructions(task: Record<string, unknown>) {
	return [task.title, task.description].filter(Boolean).join("\n\n");
}

function terminalTaskStatus(completion: RunCompletion | null) {
	if (completion?.status === "completed") return "review";
	if (completion?.status === "cancelled") return "cancelled";
	return "failed";
}

async function dependenciesMet(collections: Collections, taskId: string) {
	const deps = await collections.task_relations.find({
		where: { sourceTask: taskId, relationType: "depends_on" },
		limit: 100,
	});

	for (const dep of deps.docs) {
		const targetId = relationId(dep.targetTask);
		if (!targetId) return false;
		const target = await collections.tasks.findOne({
			where: { id: targetId },
		});
		if (!["review", "approved", "done"].includes(String(target?.status))) {
			return false;
		}
	}

	return true;
}

async function releaseDependentTasks(
	ctx: WorkflowServiceContext,
	taskId: string,
) {
	const downstream = await ctx.collections.task_relations.find({
		where: { targetTask: taskId, relationType: "depends_on" },
		limit: 100,
	});
	const releasedTaskIds: string[] = [];

	for (const relation of downstream.docs) {
		const dependentTaskId = relationId(relation.sourceTask);
		if (!dependentTaskId) continue;

		const task = await ctx.collections.tasks.findOne({
			where: { id: dependentTaskId },
		});
		if (
			!task ||
			!["backlog", "pending", "waiting"].includes(String(task.status))
		) {
			continue;
		}
		if (!(await dependenciesMet(ctx.collections as any, dependentTaskId)))
			continue;

		await ctx.collections.tasks.updateById({
			id: dependentTaskId,
			data: { status: "pending" },
		});
		await workflowsFromContext(ctx).trigger(
			"task-pipeline",
			{
				taskId: dependentTaskId,
				runReason: "dependency-released",
				requestedBy: "workflow:task-pipeline",
			},
			{ idempotencyKey: `task-pipeline:${dependentTaskId}` },
		);
		releasedTaskIds.push(dependentTaskId);
	}

	return releasedTaskIds;
}

export default workflow({
	name: "task-pipeline",
	schema: z.object({
		taskId: z.string(),
		runReason: z.string().optional(),
		requestedBy: z.string().optional(),
		scheduleExecutionId: z.string().optional(),
	}),
	timeout: "14d",
	handler: async ({ input, step, ctx, log }) => {
		const task = await step.run("load-task", async () => {
			return ctx.collections.tasks.findOne({ where: { id: input.taskId } });
		});
		if (!task) throw new Error(`Task not found: ${input.taskId}`);

		if (
			!(await step.run("check-dependencies", async () =>
				dependenciesMet(ctx.collections as any, input.taskId),
			))
		) {
			await step.run("mark-waiting-on-dependencies", async () => {
				await ctx.collections.tasks.updateById({
					id: input.taskId,
					data: {
						status: "waiting",
						metadata: mergeRecords(task.metadata, {
								waitingReason: "dependencies",
							}),
					},
				});
				await ctx.collections.activity.create({
					actor: "workflow:task-pipeline",
					type: "task.waiting",
					summary: `Task is waiting on dependencies: ${task.title}`,
					task: input.taskId,
					project: relationId(task.project) ?? undefined,
					details: { reason: "dependencies" },
				});
			});
			return { taskId: input.taskId, runId: null, status: "waiting" };
		}

		const retryPolicy = retryPolicyFrom(
			asRecord(task.metadata).retryPolicy ??
				asRecord(task.metadata).retry_policy,
		);

		let lastCompletion: RunCompletion | null = null;
		let lastRunId: string | null = null;

		for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt++) {
			const runtime = await step.run(`resolve-runtime-${attempt}`, async () => {
				return resolveRuntimeSelection(ctx, {
					modelId: relationId(task.model),
					projectId: relationId(task.project),
				});
			});

			const run = await step.run(`create-run-${attempt}`, async () => {
				// Run-start progressive disclosure (§8.3): the published-skills L1 block
				// rides the run's `systemPrompt` channel (system-level context), not the
				// task prompt. Drafts excluded; descriptions stay delimited DATA (§8.7).
				// Empty when nothing is published.
				const baseInstructions = taskInstructions(task);
				const skillsSystemPrompt = await buildSkillsSystemPrompt(
					ctx.collections,
					{ projectId: relationId(task.project) },
				);
				// Run-start memory RECALL: prepend the scoped active-memory DATA block to
				// the task instructions so the agent recalls lessons from prior runs on
				// this task/project/company. DELIMITED DATA, never instructions.
				// Best-effort (degrades to `baseInstructions` on no-backend or error).
				// The query is the task's own instructions = this run's intent.
				const instructions = await injectMemoriesIntoInstructions(
					{
						search: ctx.search,
						collections: ctx.collections,
						projectId: relationId(task.project),
						taskId: input.taskId,
					},
					baseInstructions,
					baseInstructions,
					log,
				);
				const projectId = relationId(task.project);
				const cwd = await projectWorkspacePath(
					ctx.collections as any,
					projectId,
				);
				return createAiRunLink({
					ctx: ctx,
					runtime,
					taskId: input.taskId,
					projectId,
					initiatedBy: "task",
					instructions,
					systemPrompt: skillsSystemPrompt || undefined,
					scheduleExecutionId: input.scheduleExecutionId,
					spawnMetadata: cwd ? { cwd } : undefined,
					linkMetadata: {
						runReason: input.runReason ?? "task-pipeline",
						requestedBy: input.requestedBy ?? "system",
						attempt,
					},
				});
			});
			lastRunId = run.id;

			await step.run(`link-schedule-execution-${attempt}`, async () => {
				await linkScheduleExecutionRun({
					ctx: ctx,
					scheduleExecutionId: input.scheduleExecutionId,
					runId: run.id,
				});
			});

			await step.run(`mark-task-running-${attempt}`, async () => {
				await ctx.collections.tasks.updateById({
					id: input.taskId,
					data: {
						status: "running",
						metadata: mergeRecords(task.metadata, {
								workflow: "task-pipeline",
								activeRunId: run.id,
								attempt,
							}),
					},
				});
			});

			await step.run(`enqueue-task-turn-${attempt}`, async () => {
				await (ctx.queue as any).taskTurnProducer.publish({
					runLinkId: run.id,
					taskId: input.taskId,
					projectId: relationId(task.project),
				});
			});

			const claimed = await step.waitForEvent(`wait-run-claimed-${attempt}`, {
				event: "run.claimed",
				match: { runId: run.id },
				timeout: "7d",
			});
			if (!claimed) {
				lastCompletion = {
					status: "failed",
					error: "Run was not claimed before the workflow timeout",
					knowledgeResourceIds: [],
				};
			} else {
				lastCompletion = await step.waitForEvent<RunCompletion>(
					`wait-run-completed-${attempt}`,
					{
						event: "run.completed",
						match: { runId: run.id },
						timeout: "7d",
					},
				);
			}

			if (lastCompletion?.status === "completed") break;

			const errorType = classifyRunError(lastCompletion?.error);
			const canRetry =
				attempt < retryPolicy.maxAttempts &&
				retryPolicy.retryOn.includes(errorType);
			if (!canRetry) break;

			const delay = retryDelay(retryPolicy, attempt);
			await step.run(`record-retry-${attempt}`, async () => {
				await ctx.collections.activity.create({
					actor: "workflow:task-pipeline",
					type: "task.retry",
					summary: `Retrying task: ${task.title}`,
					task: input.taskId,
					run: run.id,
					project: relationId(task.project) ?? undefined,
					details: { errorType, attempt, delaySeconds: delay },
				});
			});
			if (delay > 0) {
				await step.sleep(`sleep-before-retry-${attempt}`, `${delay}s`);
			}
		}

		const status = terminalTaskStatus(lastCompletion);
		await step.run("mark-task-terminal", async () => {
			await ctx.collections.tasks.updateById({
				id: input.taskId,
				data: {
					status,
					metadata: mergeRecords(task.metadata, {
						workflow: "task-pipeline",
						runId: lastRunId,
						status,
						error: lastCompletion?.error ?? null,
						knowledgeResourceIds: lastCompletion?.knowledgeResourceIds ?? [],
					}),
				},
			});
			await ctx.collections.activity.create({
				actor: "workflow:task-pipeline",
				type: status === "review" ? "task.review" : "task.failed",
				summary:
					status === "review"
						? `Task ready for review: ${task.title}`
						: `Task failed: ${task.title}`,
				task: input.taskId,
				run: lastRunId ?? undefined,
				project: relationId(task.project) ?? undefined,
				details: lastCompletion ?? {},
			});
		});

		// Memory WRITE (Reflexion, §9.2): async reflection AFTER the run reaches its
		// terminal status. Off-path — its result never changes the task outcome; a
		// failure is logged and swallowed. Gated by the per-scope "agent may write
		// memory" toggle inside `runReflectionStep`. The model boundary is not wired
		// to a live LLM yet (server has no model client) so this writes nothing today
		// but exercises the full gate/dedupe/persist path (see memory-reflect-step.ts).
		if (lastRunId) {
			await step.run("memory-reflection", async () => {
				await runReflectionStep(ctx.collections, {
					runId: lastRunId as string,
					input: {
						instructions: taskInstructions(task),
						summary: lastCompletion?.summary ?? null,
						outcome:
							lastCompletion?.status === "completed"
								? "completed"
								: lastCompletion?.status === "cancelled"
									? "cancelled"
									: "failed",
						error: lastCompletion?.error ?? null,
						scope: {
							projectId: relationId(task.project),
							taskId: input.taskId,
						},
					},
					scope: {
						projectId: relationId(task.project),
						taskId: input.taskId,
					},
					log,
				});
			});
		}

		const releasedTaskIds =
			status === "review"
				? await step.run("release-dependent-tasks", async () =>
						releaseDependentTasks(ctx, input.taskId),
					)
				: [];

		log.info("Task pipeline completed", {
			taskId: input.taskId,
			runId: lastRunId ?? undefined,
			status,
			releasedTaskIds,
		});

		return { taskId: input.taskId, runId: lastRunId, status, releasedTaskIds };
	},
	onFailure: async ({ input, error, ctx }) => {
		await ctx.collections.tasks.updateById({
			id: input.taskId,
			data: {
				status: "failed",
				metadata: { workflowError: error.message },
			},
		});
		await ctx.collections.activity.create({
			actor: "workflow:task-pipeline",
			type: "task.failed",
			summary: error.message,
			task: input.taskId,
			details: { workflow: "task-pipeline" },
		});
	},
});
