import { createContextFactory } from "questpie/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { aiModule } from "@questpie/ai/modules/ai";

import {
	buildMockApp,
	type MockApp,
} from "../../../../../../packages/questpie/test/utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../../../../../../packages/questpie/test/utils/test-db";
import { activity } from "../collections/activity";
import { capabilities } from "../collections/capabilities";
import { chatMessages } from "../collections/chat-messages";
import { chatSessions } from "../collections/chat-sessions";
import { environments } from "../collections/environments";
import { joinTokens } from "../collections/join-tokens";
import { knowledge } from "../collections/knowledge";
import { models } from "../collections/models";
import { projects } from "../collections/projects";
import { providers } from "../collections/providers";
import { runEvents } from "../collections/run-events";
import { runLinks } from "../collections/run-links";
import { runs } from "../collections/runs";
import { scheduleExecutions } from "../collections/schedule-executions";
import { schedules } from "../collections/schedules";
import { scripts } from "../collections/scripts";
import { secrets } from "../collections/secrets";
import { taskRelations } from "../collections/task-relations";
import { tasks } from "../collections/tasks";
import { workerLeases } from "../collections/worker-leases";
import { workers } from "../collections/workers";
import { workflowConfigs } from "../collections/workflow-configs";
import providerRuntime from "../services/provider-runtime";
import workerManager from "../services/worker-manager";
import multiStepTask from "../workflows/multi-step-task";
import taskPipeline from "../workflows/task-pipeline";

type WorkflowEvent = {
	event: string;
	data?: unknown;
};

function silentLog() {
	return {
		debug() {},
		info() {},
		warn() {},
		error() {},
	};
}

function relationId(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (typeof value === "object" && value && "id" in value) {
		const id = (value as { id?: unknown }).id;
		return typeof id === "string" ? id : null;
	}
	return null;
}

function fakeStep(
	events: Record<string, unknown>,
	options?: {
		invokeResult?: unknown;
	},
) {
	return {
		async run(_name: string, ...args: unknown[]) {
			const fn = args[args.length - 1];
			if (typeof fn !== "function") throw new Error("Missing step callback");
			return fn();
		},
		async waitForEvent(_name: string, opts: { event: string }) {
			return events[opts.event] ?? null;
		},
		async sleep() {},
		async sleepUntil() {},
		async invoke() {
			return options?.invokeResult ?? null;
		},
		async sendEvent() {},
	};
}

describe("task-pipeline workflow", () => {
	let setup:
		| {
				app: MockApp;
				cleanup: () => Promise<void>;
		  }
		| undefined;
	let workflowEvents: WorkflowEvent[];

	beforeEach(async () => {
		workflowEvents = [];

		setup = await buildMockApp({
			collections: {
				ai_run_events: aiModule.collections.ai_run_events,
				ai_runs: aiModule.collections.ai_runs,
				ai_worker_leases: aiModule.collections.ai_worker_leases,
				ai_workers: aiModule.collections.ai_workers,
				activity,
				capabilities,
				chat_messages: chatMessages,
				chat_sessions: chatSessions,
				environments,
				join_tokens: joinTokens,
				knowledge,
				models,
				projects,
				providers,
				run_events: runEvents,
				run_links: runLinks,
				runs,
				schedule_executions: scheduleExecutions,
				schedules,
				scripts,
				secrets,
				task_relations: taskRelations,
				tasks,
				worker_leases: workerLeases,
				workers,
				workflow_configs: workflowConfigs,
			},
			services: {
				providerRuntime,
				workerManager,
			},
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup?.cleanup();
		setup = undefined;
	});

	async function runPipeline(
		taskId: string,
		events: Record<string, unknown>,
		overrides?: {
			requestedBy?: string;
			runReason?: string;
			invokeResult?: unknown;
			scheduleExecutionId?: string;
		},
	) {
		workflowEvents = [];
		const workflows = {
			async trigger(name: string, input: unknown) {
				workflowEvents.push({ event: `trigger:${name}`, data: input });
				return { instanceId: `wf-${workflowEvents.length}`, existing: false };
			},
			async sendEvent(event: string, data?: unknown) {
				workflowEvents.push({ event, data });
			},
		};

		const createContext = createContextFactory(setup!.app);
		const ctx = await createContext({ accessMode: "system" });
		(ctx as any).workflows = workflows;

		return taskPipeline.handler({
			input: {
				taskId,
				runReason: overrides?.runReason ?? "test",
				requestedBy: overrides?.requestedBy ?? "test-runner",
				scheduleExecutionId: overrides?.scheduleExecutionId,
			},
			step: fakeStep(events, {
				invokeResult: overrides?.invokeResult,
			}) as any,
			ctx,
			log: silentLog(),
		});
	}

	it("creates a run and moves task to review on successful completion", async () => {
		const task = await setup!.app.collections.tasks.create({
			title: "Successful task",
			type: "feature",
			status: "pending",
			priority: "medium",
			scopeType: "company",
			createdBy: "test",
		} as any);

		const result = await runPipeline(task.id, {
			"run.claimed": { runId: "will-be-replaced", workerId: "w1" },
			"run.completed": {
				status: "completed",
				summary: "All tests pass",
				knowledgeResourceIds: ["kr-1"],
			},
		});

		expect(result).toMatchObject({
			taskId: task.id,
			status: "review",
		});
		expect(result.runId).toBeTruthy();

		const updatedTask = await setup!.app.collections.tasks.findOne({
			where: { id: task.id },
		});
		expect(updatedTask?.status).toBe("review");

		const createdRuns = await setup!.app.collections.runs.find({
			where: { task: task.id },
			limit: 10,
		});
		expect(createdRuns.docs).toHaveLength(0);

		const createdRunLinks = await setup!.app.collections.run_links.find({
			where: { task: task.id },
			limit: 10,
		});
		expect(createdRunLinks.docs).toHaveLength(1);
		expect(createdRunLinks.docs[0]).toMatchObject({
			status: "pending",
			runtime: "codex",
			initiatedBy: "task",
		});
		expect(result.runId).toBe(createdRunLinks.docs[0].id);

		const aiRunId = relationId(createdRunLinks.docs[0].aiRun);
		expect(aiRunId).toBeTruthy();
		const aiRun = await setup!.app.collections.ai_runs.findOne({
			where: { id: aiRunId! },
		});
		expect(aiRun).toMatchObject({
			status: "pending",
			runtime: "codex",
			prompt: "Successful task",
		});
		expect(aiRun).not.toHaveProperty("task");
		expect(aiRun).not.toHaveProperty("provider");
		expect(aiRun).not.toHaveProperty("model");
		expect(
			(aiRun?.meta as Record<string, unknown> | undefined)?.autopilot,
		).toBe(undefined);

		const reviewActivities = await setup!.app.collections.activity.find({
			where: { task: task.id, type: "task.review" },
			limit: 10,
		});
		expect(reviewActivities.docs).toHaveLength(1);
	});

	it("marks task as failed on non-retryable error", async () => {
		const task = await setup!.app.collections.tasks.create({
			title: "Failing task",
			type: "bug",
			status: "pending",
			priority: "high",
			scopeType: "company",
			createdBy: "test",
		} as any);

		const result = await runPipeline(task.id, {
			"run.claimed": { runId: "claimed", workerId: "w1" },
			"run.completed": {
				status: "failed",
				error: "Permission denied: cannot access /restricted",
			},
		});

		expect(result).toMatchObject({
			taskId: task.id,
			status: "failed",
		});

		const updatedTask = await setup!.app.collections.tasks.findOne({
			where: { id: task.id },
		});
		expect(updatedTask?.status).toBe("failed");

		const failActivities = await setup!.app.collections.activity.find({
			where: { task: task.id, type: "task.failed" },
			limit: 10,
		});
		expect(failActivities.docs).toHaveLength(1);
	});

	it("retries on retryable infra error and succeeds on second attempt", async () => {
		const task = await setup!.app.collections.tasks.create({
			title: "Retryable task",
			type: "feature",
			status: "pending",
			priority: "medium",
			scopeType: "company",
			createdBy: "test",
			metadata: {
				retryPolicy: {
					maxAttempts: 2,
					delaySeconds: 0,
					backoffMultiplier: 1,
					retryOn: ["infra", "timeout"],
					onExhausted: "fail",
				},
			},
		} as any);

		let attemptCount = 0;
		const step = {
			async run(_name: string, ...args: unknown[]) {
				const fn = args[args.length - 1];
				if (typeof fn !== "function") throw new Error("Missing step callback");
				return fn();
			},
			async waitForEvent(_name: string, opts: { event: string }) {
				if (opts.event === "run.claimed") {
					return { runId: "run-x", workerId: "w1" };
				}
				if (opts.event === "run.completed") {
					attemptCount++;
					if (attemptCount === 1) {
						return {
							status: "failed",
							error: "ECONNRESET: socket hang up",
						};
					}
					return {
						status: "completed",
						summary: "Succeeded on retry",
						knowledgeResourceIds: [],
					};
				}
				return null;
			},
			async sleep() {},
			async sleepUntil() {},
			async invoke() {
				throw new Error("Unexpected invoke");
			},
			async sendEvent() {},
		};

		const createContext = createContextFactory(setup!.app);
		const ctx = await createContext({ accessMode: "system" });

		const result = await taskPipeline.handler({
			input: {
				taskId: task.id,
				runReason: "test",
				requestedBy: "test-runner",
			},
			step: step as any,
			ctx,
			log: silentLog(),
		});

		expect(result).toMatchObject({
			taskId: task.id,
			status: "review",
		});
		expect(attemptCount).toBe(2);

		const createdRuns = await setup!.app.collections.runs.find({
			where: { task: task.id },
			limit: 10,
		});
		expect(createdRuns.docs).toHaveLength(0);

		const createdRunLinks = await setup!.app.collections.run_links.find({
			where: { task: task.id },
			limit: 10,
		});
		expect(createdRunLinks.docs).toHaveLength(2);
		expect(
			createdRunLinks.docs.every(
				(run) => relationId(run.aiRun) && run.initiatedBy === "task",
			),
		).toBe(true);

		const retryActivities = await setup!.app.collections.activity.find({
			where: { task: task.id, type: "task.retry" },
			limit: 10,
		});
		expect(retryActivities.docs).toHaveLength(1);
	});

	it("waits on unmet dependencies", async () => {
		const depTask = await setup!.app.collections.tasks.create({
			title: "Dependency task",
			type: "feature",
			status: "pending",
			priority: "medium",
			scopeType: "company",
			createdBy: "test",
		} as any);
		const task = await setup!.app.collections.tasks.create({
			title: "Blocked task",
			type: "feature",
			status: "pending",
			priority: "medium",
			scopeType: "company",
			createdBy: "test",
		} as any);
		await setup!.app.collections.task_relations.create({
			sourceTask: task.id,
			targetTask: depTask.id,
			relationType: "depends_on",
			createdBy: "test",
		} as any);

		const result = await runPipeline(task.id, {});

		expect(result).toMatchObject({
			taskId: task.id,
			runId: null,
			status: "waiting",
		});

		const updatedTask = await setup!.app.collections.tasks.findOne({
			where: { id: task.id },
		});
		expect(updatedTask?.status).toBe("waiting");
	});

	it("links schedule-triggered task runs to the schedule execution", async () => {
		const schedule = await setup!.app.collections.schedules.create({
			name: "Scheduled task",
			cron: "* * * * *",
			timezone: "UTC",
			mode: "task",
			enabled: true,
			taskTemplate: {},
		} as any);
		const task = await setup!.app.collections.tasks.create({
			title: "Scheduled pipeline task",
			type: "task",
			status: "pending",
			priority: "medium",
			scopeType: "company",
			createdBy: "schedule",
		} as any);
		const execution = await setup!.app.collections.schedule_executions.create({
			schedule: schedule.id,
			task: task.id,
			status: "triggered",
			triggeredAt: new Date(),
		} as any);

		const result = await runPipeline(
			task.id,
			{
				"run.claimed": { runId: "claimed", workerId: "w1" },
				"run.completed": { status: "completed", summary: "Done" },
			},
			{ runReason: "schedule", scheduleExecutionId: execution.id },
		);

		const runLink = await setup!.app.collections.run_links.findOne({
			where: { id: result.runId },
		});
		expect(runLink).toMatchObject({
			task: task.id,
			schedule: schedule.id,
			scheduleExecution: execution.id,
			initiatedBy: "task",
		});

		const updatedExecution =
			await setup!.app.collections.schedule_executions.findOne({
				where: { id: execution.id },
			});
		expect(relationId(updatedExecution?.run)).toBe(result.runId);
	});

	it("stores workflow provenance on run links for configured workflow steps", async () => {
		const workflowConfig = await setup!.app.collections.workflow_configs.create(
			{
				name: "Single step workflow",
				enabled: true,
				steps: [
					{
						id: "implement",
						type: "run",
						instructions: "Implement the workflow step.",
					},
				],
			} as any,
		);
		const task = await setup!.app.collections.tasks.create({
			title: "Workflow task",
			description: "Use the configured workflow.",
			type: "feature",
			status: "pending",
			priority: "medium",
			scopeType: "company",
			workflowConfig: workflowConfig.id,
			createdBy: "test",
		} as any);

		const createContext = createContextFactory(setup!.app);
		const ctx = await createContext({ accessMode: "system" });
		const result = await multiStepTask.handler({
			input: {
				taskId: task.id,
				workflowConfigId: workflowConfig.id,
				requestedBy: "test-runner",
			},
			step: fakeStep({
				"run.claimed": { runId: "claimed", workerId: "w1" },
				"run.completed": {
					status: "completed",
					summary: "Workflow step done",
				},
			}) as any,
			ctx,
			log: silentLog(),
		});

		expect(result).toMatchObject({
			taskId: task.id,
			runId: expect.any(String),
			status: "review",
		});

		const runLink = await setup!.app.collections.run_links.findOne({
			where: { id: result.runId },
		});
		expect(runLink).toMatchObject({
			task: task.id,
			workflowConfig: workflowConfig.id,
			workflowStep: "implement",
			initiatedBy: "workflow",
			runtime: "codex",
		});
		expect(relationId(runLink?.aiRun)).toBeTruthy();

		const legacyRuns = await setup!.app.collections.runs.find({
			where: { task: task.id },
			limit: 10,
		});
		expect(legacyRuns.docs).toHaveLength(0);
	});

	it("proceeds when dependencies are met", async () => {
		const depTask = await setup!.app.collections.tasks.create({
			title: "Completed dependency",
			type: "feature",
			status: "done",
			priority: "medium",
			scopeType: "company",
			createdBy: "test",
		} as any);
		const task = await setup!.app.collections.tasks.create({
			title: "Unblocked task",
			type: "feature",
			status: "pending",
			priority: "medium",
			scopeType: "company",
			createdBy: "test",
		} as any);
		await setup!.app.collections.task_relations.create({
			sourceTask: task.id,
			targetTask: depTask.id,
			relationType: "depends_on",
			createdBy: "test",
		} as any);

		const result = await runPipeline(task.id, {
			"run.claimed": { runId: "r1", workerId: "w1" },
			"run.completed": { status: "completed", summary: "Done" },
		});

		expect(result).toMatchObject({
			taskId: task.id,
			status: "review",
		});
	});

	it("releases dependent tasks on successful completion", async () => {
		const parentTask = await setup!.app.collections.tasks.create({
			title: "Parent task",
			type: "feature",
			status: "pending",
			priority: "medium",
			scopeType: "company",
			createdBy: "test",
		} as any);
		const childTask = await setup!.app.collections.tasks.create({
			title: "Dependent child",
			type: "feature",
			status: "waiting",
			priority: "medium",
			scopeType: "company",
			createdBy: "test",
		} as any);
		await setup!.app.collections.task_relations.create({
			sourceTask: childTask.id,
			targetTask: parentTask.id,
			relationType: "depends_on",
			createdBy: "test",
		} as any);

		const createContext = createContextFactory(setup!.app);
		const ctx = await createContext({ accessMode: "system" });
		const workflows = {
			async trigger(name: string, input: unknown) {
				workflowEvents.push({ event: `trigger:${name}`, data: input });
				return { instanceId: `wf-${workflowEvents.length}`, existing: false };
			},
			async sendEvent(event: string, data?: unknown) {
				workflowEvents.push({ event, data });
			},
		};
		(ctx as any).workflows = workflows;
		workflowEvents = [];

		const result = await taskPipeline.handler({
			input: {
				taskId: parentTask.id,
				runReason: "test",
				requestedBy: "test-runner",
			},
			step: fakeStep({
				"run.claimed": { runId: "r1", workerId: "w1" },
				"run.completed": { status: "completed", summary: "Parent done" },
			}) as any,
			ctx,
			log: silentLog(),
		});

		expect(result.releasedTaskIds).toContain(childTask.id);

		const updatedChild = await setup!.app.collections.tasks.findOne({
			where: { id: childTask.id },
		});
		expect(updatedChild?.status).toBe("pending");

		const childTrigger = workflowEvents.find(
			(event) =>
				event.event === "trigger:task-pipeline" &&
				(event.data as any)?.taskId === childTask.id,
		);
		expect(childTrigger).toBeTruthy();
	});

	it("throws for non-existent task", async () => {
		await expect(runPipeline("non-existent-task-id", {})).rejects.toThrow(
			"Task not found",
		);
	});
});
