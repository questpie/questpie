import { createContextFactory } from "questpie/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { aiModule } from "@questpie/ai/modules/ai";

import {
	buildMockApp,
	type MockApp,
} from "../../../../../../packages/questpie/test/utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../../../../../../packages/questpie/test/utils/test-db";
import { activity } from "../collections/activity";
import { chatMessages } from "../collections/chat-messages";
import { chatSessions } from "../collections/chat-sessions";
import { environments } from "../collections/environments";
import assets from "../collections/assets";
import { models } from "../collections/models";
import { projects } from "../collections/projects";
import { providers } from "../collections/providers";
import { runLinks } from "../collections/run-links";
import { scheduleExecutions } from "../collections/schedule-executions";
import { schedules } from "../collections/schedules";
import { scripts } from "../collections/scripts";
import { secrets } from "../collections/secrets";
import { taskRelations } from "../collections/task-relations";
import { tasks } from "../collections/tasks";
import taskPipeline from "../workflows/task-pipeline";

type WorkflowEvent = {
	event: string;
	data?: unknown;
};

type WaitEvent = {
	name: string;
	event: string;
	match?: Record<string, unknown>;
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
		waitEvents?: WaitEvent[];
	},
) {
	return {
		async run(_name: string, ...args: unknown[]) {
			const fn = args[args.length - 1];
			if (typeof fn !== "function") throw new Error("Missing step callback");
			return fn();
		},
		async waitForEvent(
			name: string,
			opts: { event: string; match?: Record<string, unknown> },
		) {
			options?.waitEvents?.push({
				name,
				event: opts.event,
				match: opts.match,
			});
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
				ai_worker_leases: aiModule.collections.ai_worker_leases,
				ai_workers: aiModule.collections.ai_workers,
				activity,
				chat_messages: chatMessages,
				chat_sessions: chatSessions,
				environments,
				assets,
				models,
				projects,
				providers,
				run_links: runLinks,
				schedule_executions: scheduleExecutions,
				schedules,
				scripts,
				secrets,
				task_relations: taskRelations,
				tasks,
			},
			services: {},
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
			waitEvents?: WaitEvent[];
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
				waitEvents: overrides?.waitEvents,
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

		const waitEvents: WaitEvent[] = [];
		const result = await runPipeline(
			task.id,
			{
				"run.claimed": { runId: "will-be-replaced", workerId: "w1" },
				"run.completed": {
					status: "completed",
					summary: "All tests pass",
					knowledgeResourceIds: ["kr-1"],
				},
			},
			{ waitEvents },
		);

		expect(result).toMatchObject({
			taskId: task.id,
			status: "review",
		});
		expect(result.runId).toBeTruthy();

		const updatedTask = await setup!.app.collections.tasks.findOne({
			where: { id: task.id },
		});
		expect(updatedTask?.status).toBe("review");

		const createdRunLinks = await setup!.app.collections.run_links.find({
			where: { task: task.id },
			limit: 10,
		});
		expect(createdRunLinks.docs).toHaveLength(1);
		expect(createdRunLinks.docs[0]).toMatchObject({
			status: "pending",
			runtime: "codex",
			initiatedBy: "task",
			kind: "task",
			retryPolicy: "none",
		});
		expect(result.runId).toBe(createdRunLinks.docs[0].id);
		expect(waitEvents).toEqual([
			{
				name: "wait-run-claimed-1",
				event: "run.claimed",
				match: { runId: result.runId },
			},
			{
				name: "wait-run-completed-1",
				event: "run.completed",
				match: { runId: result.runId },
			},
		]);

		const reviewActivities = await setup!.app.collections.activity.find({
			where: { task: task.id, type: "task.review" },
			limit: 10,
		});
		expect(reviewActivities.docs).toHaveLength(1);
		expect(relationId(reviewActivities.docs[0]?.run)).toBe(result.runId);
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

		const createdRunLinks = await setup!.app.collections.run_links.find({
			where: { task: task.id },
			limit: 10,
		});
		expect(createdRunLinks.docs).toHaveLength(2);
		expect(
			createdRunLinks.docs.every((run) => run.initiatedBy === "task"),
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
