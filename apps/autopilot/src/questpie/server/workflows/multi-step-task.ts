import { z } from "zod";

import { workflow } from "@questpie/workflows";

import { createAiRunLink } from "../lib/ai-run-links";
import { asRecord, mergeRecords, relationId, stringFrom } from "../lib/records";
import { resolveRuntimeSelection } from "../lib/runtime-selection";

type Collections = Questpie.AppContext["collections"];

type StepType =
	| "run"
	| "agent"
	| "task"
	| "child_task"
	| "fanout"
	| "approval"
	| "human_approval"
	| "join"
	| "wait_for_children"
	| "done";

type RunCompletion = {
	status?: "completed" | "failed" | "cancelled";
	summary?: string | null;
	error?: string | null;
	knowledgeResourceIds?: string[];
};

interface StepConfig extends Record<string, unknown> {
	id?: string;
	name?: string;
	type?: StepType | string;
	title?: string;
	description?: string;
	instructions?: string;
	prompt?: string;
	capabilityId?: string;
	capability_id?: string;
	modelId?: string;
	model_id?: string;
	runtime?: "claude-code" | "codex" | "opencode";
	next?: string;
	timeout?: string;
}

function stepsFrom(value: unknown): StepConfig[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is StepConfig => typeof item === "object");
}

function stepId(step: StepConfig, index: number) {
	return stringFrom(step.id) ?? stringFrom(step.name) ?? `step-${index + 1}`;
}

function safeStepName(value: string) {
	return value.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80);
}

function stepType(step: StepConfig): StepType {
	const type = String(step.type ?? "run");
	if (
		[
			"run",
			"agent",
			"task",
			"child_task",
			"fanout",
			"approval",
			"human_approval",
			"join",
			"wait_for_children",
			"done",
		].includes(type)
	) {
		return type as StepType;
	}
	return "run";
}

function stepRef(step: StepConfig, camel: string, snake: string) {
	return (
		stringFrom(step[camel]) ??
		stringFrom(step[snake]) ??
		relationId(step[camel])
	);
}

function stepInstructions(
	task: Record<string, unknown>,
	step: StepConfig,
	priorSummaries: string[],
) {
	const parts = [
		priorSummaries.length
			? `## Prior Step Outputs\n\n${priorSummaries.join("\n\n")}`
			: null,
		step.instructions ?? step.prompt,
		step.description,
		!step.instructions && !step.prompt ? task.description : null,
	].filter(Boolean);

	return parts.join("\n\n");
}

function childTemplates(step: StepConfig): StepConfig[] {
	const raw = step.tasks ?? step.children ?? step.fanout;
	return stepsFrom(raw);
}

async function recordProgress(
	collections: Collections,
	taskId: string,
	stepIdValue: string,
	status: string,
	details: Record<string, unknown> = {},
) {
	const task = await collections.tasks.findOne({ where: { id: taskId } });
	const metadata = asRecord(task?.metadata);
	const progress = asRecord(metadata.workflowProgress);
	const steps = asRecord(progress.steps);

	await collections.tasks.updateById({
		id: taskId,
		data: {
			metadata: {
				...metadata,
				workflowProgress: {
					...progress,
					currentStepId: stepIdValue,
					steps: {
						...steps,
						[stepIdValue]: {
							status,
							updatedAt: new Date().toISOString(),
							...details,
						},
					},
				},
			},
		},
	});
}

async function createRunForStep(
	ctx: Questpie.AppContext,
	task: Record<string, unknown>,
	workflowConfig: Record<string, unknown>,
	step: StepConfig,
	stepIdValue: string,
	priorSummaries: string[],
) {
	const capabilityId =
		stepRef(step, "capabilityId", "capability_id") ??
		relationId(step.capability) ??
		relationId(workflowConfig.defaultCapability) ??
		relationId(task.capability);
	const modelId =
		stepRef(step, "modelId", "model_id") ??
		relationId(step.model) ??
		relationId(task.model);

	const runtime = await resolveRuntimeSelection(ctx, {
		modelId,
		capabilityId,
		projectId: relationId(task.project),
		runtime: step.runtime ?? null,
	});

	return createAiRunLink({
		ctx,
		runtime,
		taskId: String(task.id),
		projectId: relationId(task.project),
		workflowConfigId: String(workflowConfig.id),
		workflowStep: stepIdValue,
		capabilityId,
		initiatedBy: "workflow",
		instructions: stepInstructions(task, step, priorSummaries),
		spawnMetadata: {
			toolPolicy: runtime.toolPolicy,
			contextRefs: runtime.contextRefs,
			promptRefs: runtime.promptRefs,
			runtimeHints: {
				...runtime.runtimeHints,
				...asRecord(step.runtimeHints),
				...asRecord(step.runtime_hints),
			},
		},
		linkMetadata: {
			...asRecord(step.targeting),
		},
	});
}

async function childTaskFromStep(
	ctx: Questpie.AppContext,
	parentTask: Record<string, unknown>,
	workflowConfig: Record<string, unknown>,
	step: StepConfig,
	stepIdValue: string,
) {
	const child = await ctx.collections.tasks.create({
		title: step.title ?? `${parentTask.title ?? "Task"}: ${stepIdValue}`,
		description:
			step.description ?? step.instructions ?? parentTask.description,
		type: step.taskType ?? step.task_type ?? "task",
		status: "pending",
		priority: step.priority ?? parentTask.priority,
		project: relationId(parentTask.project) ?? undefined,
		scopeType: parentTask.scopeType ?? "company",
		workflowConfig:
			stepRef(step, "workflowConfigId", "workflow_config_id") ??
			relationId(step.workflowConfig) ??
			undefined,
		capability:
			stepRef(step, "capabilityId", "capability_id") ??
			relationId(step.capability) ??
			relationId(workflowConfig.defaultCapability) ??
			undefined,
		model:
			stepRef(step, "modelId", "model_id") ??
			relationId(step.model) ??
			undefined,
		createdBy: "workflow:multi-step-task",
		context: mergeRecords(parentTask.context, asRecord(step.context)),
		metadata: {
			parentTaskId: parentTask.id,
			workflowConfigId: workflowConfig.id,
			workflowStepId: stepIdValue,
			...asRecord(step.metadata),
		},
	});

	await ctx.collections.task_relations.create({
		sourceTask: parentTask.id,
		targetTask: child.id,
		relationType: "parent_of",
		dedupeKey: `${parentTask.id}:${child.id}:parent_of`,
		createdBy: "workflow:multi-step-task",
		metadata: { workflowStepId: stepIdValue },
	});
	await ctx.collections.task_relations.create({
		sourceTask: child.id,
		targetTask: parentTask.id,
		relationType: "spawned_by",
		dedupeKey: `${child.id}:${parentTask.id}:spawned_by`,
		createdBy: "workflow:multi-step-task",
		metadata: { workflowStepId: stepIdValue },
	});

	return child;
}

async function childStatuses(collections: Collections, taskId: string) {
	const relations = await collections.task_relations.find({
		where: { sourceTask: taskId, relationType: "parent_of" },
		limit: 100,
	});
	const statuses: string[] = [];
	for (const relation of relations.docs) {
		const childId = relationId(relation.targetTask);
		if (!childId) continue;
		const child = await collections.tasks.findOne({ where: { id: childId } });
		if (child?.status) statuses.push(String(child.status));
	}
	return statuses;
}

function nextIndex(
	steps: StepConfig[],
	currentIndex: number,
	step: StepConfig,
) {
	if (step.next) {
		const target = steps.findIndex(
			(candidate, index) => stepId(candidate, index) === step.next,
		);
		if (target >= 0) return target;
	}
	return currentIndex + 1;
}

export default workflow({
	name: "multi-step-task",
	schema: z.object({
		taskId: z.string(),
		workflowConfigId: z.string().optional(),
		requestedBy: z.string().optional(),
	}),
	timeout: "30d",
	handler: async ({ input, step, ctx, log }) => {
		const loaded = await step.run("load-task-and-config", async () => {
			const task = await ctx.collections.tasks.findOne({
				where: { id: input.taskId },
				with: { workflowConfig: true },
			});
			if (!task) throw new Error(`Task not found: ${input.taskId}`);

			const workflowConfigId =
				input.workflowConfigId ?? relationId(task.workflowConfig);
			if (!workflowConfigId) {
				throw new Error(`Task has no workflow config: ${input.taskId}`);
			}

			const workflowConfig =
				typeof task.workflowConfig === "object" &&
				task.workflowConfig &&
				relationId(task.workflowConfig) === workflowConfigId
					? task.workflowConfig
					: await ctx.collections.workflow_configs.findOne({
							where: { id: workflowConfigId },
						});
			if (!workflowConfig) {
				throw new Error(`Workflow config not found: ${workflowConfigId}`);
			}
			if (workflowConfig.enabled === false) {
				throw new Error(`Workflow config is disabled: ${workflowConfigId}`);
			}

			return {
				task: task as Record<string, unknown>,
				workflowConfig: workflowConfig as Record<string, unknown>,
				steps: stepsFrom(workflowConfig.steps),
			};
		});

		if (loaded.steps.length === 0) {
			throw new Error(
				`Workflow config has no steps: ${loaded.workflowConfig.id}`,
			);
		}

		await step.run("mark-task-running", async () => {
			await ctx.collections.tasks.updateById({
				id: input.taskId,
				data: {
					status: "running",
					metadata: mergeRecords(loaded.task.metadata, {
						workflow: "multi-step-task",
						workflowConfigId: loaded.workflowConfig.id,
					}),
				},
			});
		});

		const priorSummaries: string[] = [];
		let index = 0;
		let lastRunId: string | null = null;
		let finalStatus: "review" | "done" = "review";

		while (index < loaded.steps.length) {
			const current = loaded.steps[index]!;
			const currentStepId = stepId(current, index);
			const safeName = safeStepName(currentStepId);
			const type = stepType(current);

			await step.run(`progress-${safeName}-started`, async () => {
				await recordProgress(
					ctx.collections,
					input.taskId,
					currentStepId,
					"running",
					{
						type,
					},
				);
			});

			if (type === "done") {
				finalStatus = "done";
				await step.run(`progress-${safeName}-done`, async () => {
					await recordProgress(
						ctx.collections,
						input.taskId,
						currentStepId,
						"done",
					);
				});
				break;
			}

			if (type === "approval" || type === "human_approval") {
				await step.run(`mark-${safeName}-waiting`, async () => {
					await ctx.collections.tasks.updateById({
						id: input.taskId,
						data: {
							status: "waiting",
							workflowStep: currentStepId,
						},
					});
					await ctx.collections.activity.create({
						actor: "workflow:multi-step-task",
						type: "task.approval_required",
						summary: `Approval required for step ${currentStepId}`,
						task: input.taskId,
						project: relationId(loaded.task.project) ?? undefined,
						details: { workflowStepId: currentStepId },
					});
				});

				const approval = await step.waitForEvent<{
					action?: "approved" | "rejected" | "replied";
					message?: string;
				}>(`wait-${safeName}-approval`, {
					event: "task.approval",
					match: { taskId: input.taskId, stepId: currentStepId },
					timeout: current.timeout ?? "30d",
				});

				if (!approval || approval.action === "rejected") {
					await step.run(`progress-${safeName}-rejected`, async () => {
						await recordProgress(
							ctx.collections,
							input.taskId,
							currentStepId,
							"rejected",
							{ approval },
						);
						await ctx.collections.tasks.updateById({
							id: input.taskId,
							data: { status: "cancelled" },
						});
					});
					return {
						taskId: input.taskId,
						status: "cancelled",
						stepId: currentStepId,
					};
				}

				if (approval.message) {
					priorSummaries.push(`## Human Feedback\n\n${approval.message}`);
				}
				await step.run(`progress-${safeName}-approved`, async () => {
					await recordProgress(
						ctx.collections,
						input.taskId,
						currentStepId,
						"completed",
						{ approval },
					);
				});
				index = nextIndex(loaded.steps, index, current);
				continue;
			}

			if (type === "task" || type === "child_task") {
				const child = await step.run(
					`create-child-task-${safeName}`,
					async () =>
						childTaskFromStep(
							ctx,
							loaded.task,
							loaded.workflowConfig,
							current,
							currentStepId,
						),
				);
				const childResult = await step.invoke(`invoke-child-task-${safeName}`, {
					workflow: "task-pipeline",
					input: {
						taskId: child.id,
						runReason: `multi-step:${currentStepId}`,
						requestedBy: input.requestedBy ?? "workflow:multi-step-task",
					},
					timeout: current.timeout ?? "14d",
				});
				const result = asRecord(childResult);
				if (!["review", "done"].includes(String(result.status))) {
					await step.run(`progress-${safeName}-failed`, async () => {
						await recordProgress(
							ctx.collections,
							input.taskId,
							currentStepId,
							"failed",
							{ childTaskId: child.id, result },
						);
						await ctx.collections.tasks.updateById({
							id: input.taskId,
							data: { status: "failed" },
						});
					});
					return {
						taskId: input.taskId,
						status: "failed",
						stepId: currentStepId,
					};
				}
				await step.run(`progress-${safeName}-completed`, async () => {
					await recordProgress(
						ctx.collections,
						input.taskId,
						currentStepId,
						"completed",
						{ childTaskId: child.id, result },
					);
				});
				index = nextIndex(loaded.steps, index, current);
				continue;
			}

			if (type === "fanout") {
				const children = childTemplates(current);
				const results: Array<{
					childTaskId: string;
					result: Record<string, unknown>;
				}> = [];
				for (let childIndex = 0; childIndex < children.length; childIndex++) {
					const childStep = children[childIndex]!;
					const childStepId = `${currentStepId}-${stepId(childStep, childIndex)}`;
					const child = await step.run(
						`create-fanout-child-${safeName}-${childIndex}`,
						async () =>
							childTaskFromStep(
								ctx,
								loaded.task,
								loaded.workflowConfig,
								childStep,
								childStepId,
							),
					);
					const result = await step.invoke(
						`invoke-fanout-child-${safeName}-${childIndex}`,
						{
							workflow: "task-pipeline",
							input: {
								taskId: child.id,
								runReason: `multi-step:${childStepId}`,
								requestedBy: input.requestedBy ?? "workflow:multi-step-task",
							},
							timeout: childStep.timeout ?? current.timeout ?? "14d",
						},
					);
					results.push({ childTaskId: child.id, result: asRecord(result) });
				}

				const failed = results.find(
					(result) =>
						!["review", "done"].includes(String(result.result.status)),
				);
				if (failed) {
					await step.run(`progress-${safeName}-fanout-failed`, async () => {
						await recordProgress(
							ctx.collections,
							input.taskId,
							currentStepId,
							"failed",
							{ results },
						);
						await ctx.collections.tasks.updateById({
							id: input.taskId,
							data: { status: "failed" },
						});
					});
					return {
						taskId: input.taskId,
						status: "failed",
						stepId: currentStepId,
					};
				}

				await step.run(`progress-${safeName}-fanout-completed`, async () => {
					await recordProgress(
						ctx.collections,
						input.taskId,
						currentStepId,
						"completed",
						{ results },
					);
				});
				index = nextIndex(loaded.steps, index, current);
				continue;
			}

			if (type === "join" || type === "wait_for_children") {
				const statuses = await step.run(
					`check-children-${safeName}`,
					async () => childStatuses(ctx.collections, input.taskId),
				);
				if (
					statuses.some((status) => ["failed", "cancelled"].includes(status))
				) {
					await step.run(`progress-${safeName}-join-failed`, async () => {
						await recordProgress(
							ctx.collections,
							input.taskId,
							currentStepId,
							"failed",
							{ statuses },
						);
						await ctx.collections.tasks.updateById({
							id: input.taskId,
							data: { status: "failed" },
						});
					});
					return {
						taskId: input.taskId,
						status: "failed",
						stepId: currentStepId,
					};
				}
				if (
					statuses.some(
						(status) => !["review", "approved", "done"].includes(status),
					)
				) {
					await step.run(`progress-${safeName}-join-waiting`, async () => {
						await recordProgress(
							ctx.collections,
							input.taskId,
							currentStepId,
							"waiting",
							{ statuses },
						);
						await ctx.collections.tasks.updateById({
							id: input.taskId,
							data: { status: "waiting" },
						});
					});
					await step.waitForEvent(`wait-${safeName}-children`, {
						event: "task.children.completed",
						match: { taskId: input.taskId },
						timeout: current.timeout ?? "14d",
					});
				}
				await step.run(`progress-${safeName}-join-completed`, async () => {
					await recordProgress(
						ctx.collections,
						input.taskId,
						currentStepId,
						"completed",
						{ statuses },
					);
				});
				index = nextIndex(loaded.steps, index, current);
				continue;
			}

			const run = await step.run(`create-run-${safeName}`, async () =>
				createRunForStep(
					ctx,
					loaded.task,
					loaded.workflowConfig,
					current,
					currentStepId,
					priorSummaries,
				),
			);
			lastRunId = run.id;

			await step.run(`mark-run-step-${safeName}`, async () => {
				await ctx.collections.tasks.updateById({
					id: input.taskId,
					data: { status: "running", workflowStep: currentStepId },
				});
			});

			await step.waitForEvent(`wait-run-claimed-${safeName}`, {
				event: "run.claimed",
				match: { runId: run.id },
				timeout: current.timeout ?? "7d",
			});
			const completion = await step.waitForEvent<RunCompletion>(
				`wait-run-completed-${safeName}`,
				{
					event: "run.completed",
					match: { runId: run.id },
					timeout: current.timeout ?? "7d",
				},
			);

			if (completion?.status !== "completed") {
				await step.run(`progress-${safeName}-run-failed`, async () => {
					await recordProgress(
						ctx.collections,
						input.taskId,
						currentStepId,
						"failed",
						{ runId: run.id, completion },
					);
					await ctx.collections.tasks.updateById({
						id: input.taskId,
						data: {
							status:
								completion?.status === "cancelled" ? "cancelled" : "failed",
						},
					});
				});
				return {
					taskId: input.taskId,
					runId: run.id,
					status: completion?.status ?? "failed",
					stepId: currentStepId,
				};
			}

			if (completion.summary) {
				priorSummaries.push(`## ${currentStepId}\n\n${completion.summary}`);
			}
			await step.run(`progress-${safeName}-run-completed`, async () => {
				await recordProgress(
					ctx.collections,
					input.taskId,
					currentStepId,
					"completed",
					{
						runId: run.id,
						knowledgeResourceIds: completion.knowledgeResourceIds ?? [],
					},
				);
			});
			index = nextIndex(loaded.steps, index, current);
		}

		await step.run("mark-task-terminal", async () => {
			await ctx.collections.tasks.updateById({
				id: input.taskId,
				data: {
					status: finalStatus,
					workflowStep: "__done__",
					metadata: mergeRecords(loaded.task.metadata, {
						workflow: "multi-step-task",
						workflowConfigId: loaded.workflowConfig.id,
						lastRunId,
						status: finalStatus,
					}),
				},
			});
			await ctx.collections.activity.create({
				actor: "workflow:multi-step-task",
				type: finalStatus === "done" ? "task.done" : "task.review",
				summary: `Workflow completed for task: ${loaded.task.title}`,
				task: input.taskId,
				run: lastRunId ?? undefined,
				project: relationId(loaded.task.project) ?? undefined,
				details: {
					workflowConfigId: loaded.workflowConfig.id,
					status: finalStatus,
				},
			});
		});

		await step.sendEvent("emit-task-completed", {
			event: "task.completed",
			data: {
				taskId: input.taskId,
				status: finalStatus,
				workflowConfigId: loaded.workflowConfig.id,
			},
			match: { taskId: input.taskId },
		});

		log.info("Multi-step task completed", {
			taskId: input.taskId,
			workflowConfigId: loaded.workflowConfig.id,
			status: finalStatus,
		});

		return {
			taskId: input.taskId,
			runId: lastRunId,
			status: finalStatus,
			workflowConfigId: loaded.workflowConfig.id,
		};
	},
	onFailure: async ({ input, error, ctx }) => {
		await ctx.collections.tasks.updateById({
			id: input.taskId,
			data: {
				status: "failed",
				metadata: { workflow: "multi-step-task", workflowError: error.message },
			},
		});
		await ctx.collections.activity.create({
			actor: "workflow:multi-step-task",
			type: "task.failed",
			summary: error.message,
			task: input.taskId,
			details: { workflow: "multi-step-task" },
		});
	},
});
