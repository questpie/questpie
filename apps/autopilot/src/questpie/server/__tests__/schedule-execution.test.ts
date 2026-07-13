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
import scheduleTick from "../jobs/schedule-tick";

type WorkflowEvent = {
	event: string;
	data?: unknown;
};

function relationId(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (typeof value === "object" && value && "id" in value) {
		const id = (value as { id?: unknown }).id;
		return typeof id === "string" ? id : null;
	}
	return null;
}

describe("schedule-tick job execution", () => {
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
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup?.cleanup();
		setup = undefined;
	});

	async function runTickJob(now?: string) {
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

		const mockQueue = {
			// createAiRunLink's best-effort "worker, wake up" kick.
			runAvailable: {
				async publish(payload: unknown) {
					workflowEvents.push({
						event: "queue:run-available",
						data: payload,
					});
					return "mock-job-id";
				},
			},
		};

		const createContext = createContextFactory(setup!.app);
		const ctx = await createContext({ accessMode: "system" });
		(ctx as any).workflows = workflows;
		(ctx as any).queue = mockQueue;

		return scheduleTick.handler({
			...ctx,
			payload: {
				now: now ?? new Date().toISOString(),
				limit: 100,
			},
		} as any);
	}

	it("creates a task and triggers task-pipeline for a due task-mode schedule", async () => {
		const now = new Date("2026-05-07T10:00:00.000Z");
		const pastDue = new Date("2026-05-07T09:59:00.000Z");

		await setup!.app.collections.schedules.create({
			name: "Hourly code review",
			cron: "0 * * * *",
			timezone: "UTC",
			mode: "task",
			enabled: true,
			concurrencyPolicy: "allow",
			nextRunAt: pastDue,
			taskTemplate: {
				title: "Scheduled code review {{date}}",
				type: "review",
				priority: "medium",
			},
		} as any);

		const result = await runTickJob(now.toISOString());

		expect(result.checked).toBe(1);
		expect(result.results).toHaveLength(1);
		expect(result.results[0]).toMatchObject({
			status: "triggered",
		});
		expect(result.results[0].taskId).toBeTruthy();

		const task = await setup!.app.collections.tasks.findOne({
			where: { id: result.results[0].taskId },
		});
		expect(task).toMatchObject({
			title: "Scheduled code review 2026-05-07",
			type: "review",
			priority: "medium",
			status: "pending",
		});

		const executions = await setup!.app.collections.schedule_executions.find({
			limit: 10,
		});
		expect(executions.docs).toHaveLength(1);
		expect(executions.docs[0]).toMatchObject({
			status: "triggered",
			metadata: { mode: "task" },
		});

		expect(workflowEvents).toHaveLength(1);
		expect(workflowEvents[0]).toMatchObject({
			event: "trigger:task-pipeline",
			data: {
				taskId: result.results[0].taskId,
				runReason: "schedule",
				scheduleExecutionId: result.results[0].executionId,
			},
		});
	});

	it("creates a chat session and mints a chat run for a due chat-mode schedule", async () => {
		const now = new Date("2026-05-07T10:00:00.000Z");
		const pastDue = new Date("2026-05-07T09:59:00.000Z");

		await setup!.app.collections.schedules.create({
			name: "Daily standup summary",
			cron: "0 9 * * *",
			timezone: "UTC",
			mode: "chat",
			enabled: true,
			concurrencyPolicy: "allow",
			nextRunAt: pastDue,
			chatPrompt: "Summarize yesterday's activity for {{date}}",
			taskTemplate: {},
		} as any);

		const result = await runTickJob(now.toISOString());

		expect(result.checked).toBe(1);
		expect(result.results).toHaveLength(1);
		expect(result.results[0]).toMatchObject({
			status: "triggered",
		});
		expect(result.results[0].chatSessionId).toBeTruthy();

		const session = await setup!.app.collections.chat_sessions.findOne({
			where: { id: result.results[0].chatSessionId },
		});
		expect(session).toMatchObject({
			status: "active",
			scopeType: "company",
		});

		const messages = await setup!.app.collections.chat_messages.find({
			where: { chatSession: result.results[0].chatSessionId },
			limit: 10,
		});
		expect(messages.docs).toHaveLength(1);
		expect(messages.docs[0]).toMatchObject({
			role: "user",
			content: "Summarize yesterday's activity for 2026-05-07",
		});

		// The run_links row is the execution record the fleet worker claims —
		// kind="chat", schedule-initiated, linked to the schedule execution.
		const runs = await setup!.app.collections.run_links.find({
			where: { chatSession: result.results[0].chatSessionId },
			limit: 10,
		});
		expect(runs.docs).toHaveLength(1);
		expect(runs.docs[0]).toMatchObject({
			kind: "chat",
			initiatedBy: "schedule",
			status: "pending",
		});
		expect(relationId(runs.docs[0].scheduleExecution)).toBe(
			result.results[0].executionId,
		);

		// The session points at the run; the stream tail resolves activeRun →
		// run_links.activeStreamId.
		const updatedSession = await setup!.app.collections.chat_sessions.findOne({
			where: { id: result.results[0].chatSessionId },
		});
		expect(relationId(updatedSession?.activeRun)).toBe(runs.docs[0].id);
		expect(updatedSession?.activeStreamId).toBe(runs.docs[0].activeStreamId);

		// The best-effort run-available kick was published.
		expect(workflowEvents).toHaveLength(1);
		expect(workflowEvents[0]).toMatchObject({
			event: "queue:run-available",
		});
	});

	it("skips a schedule with active execution when concurrencyPolicy is skip", async () => {
		const now = new Date("2026-05-07T10:00:00.000Z");
		const pastDue = new Date("2026-05-07T09:59:00.000Z");

		const schedule = await setup!.app.collections.schedules.create({
			name: "Skip-policy schedule",
			cron: "* * * * *",
			timezone: "UTC",
			mode: "task",
			enabled: true,
			concurrencyPolicy: "skip",
			nextRunAt: pastDue,
			taskTemplate: { title: "Should be skipped" },
		} as any);

		const activeTask = await setup!.app.collections.tasks.create({
			title: "Still running",
			type: "task",
			status: "running",
			priority: "medium",
			scopeType: "company",
			createdBy: "schedule",
		} as any);

		await setup!.app.collections.schedule_executions.create({
			schedule: schedule.id,
			task: activeTask.id,
			status: "triggered",
			triggeredAt: new Date("2026-05-07T09:00:00.000Z"),
		} as any);

		const result = await runTickJob(now.toISOString());

		expect(result.results).toHaveLength(1);
		expect(result.results[0]).toMatchObject({
			status: "skipped",
		});

		expect(workflowEvents).toHaveLength(0);

		const executions = await setup!.app.collections.schedule_executions.find({
			where: { schedule: schedule.id },
			limit: 10,
			orderBy: { triggeredAt: "desc" },
		});
		const skippedExecution = executions.docs.find(
			(execution: any) => execution.status === "skipped",
		);
		expect(skippedExecution).toBeTruthy();
	});

	it("skips schedules that are not yet due", async () => {
		const now = new Date("2026-05-07T10:00:00.000Z");
		const futureRun = new Date("2026-05-07T11:00:00.000Z");

		await setup!.app.collections.schedules.create({
			name: "Not yet due",
			cron: "0 11 * * *",
			timezone: "UTC",
			mode: "task",
			enabled: true,
			concurrencyPolicy: "allow",
			nextRunAt: futureRun,
			taskTemplate: { title: "Future task" },
		} as any);

		const result = await runTickJob(now.toISOString());

		expect(result.checked).toBe(1);
		expect(result.results).toHaveLength(0);
		expect(workflowEvents).toHaveLength(0);
	});

	it("advances schedule nextRunAt after trigger", async () => {
		const now = new Date("2026-05-07T10:00:00.000Z");
		const pastDue = new Date("2026-05-07T09:59:00.000Z");

		const schedule = await setup!.app.collections.schedules.create({
			name: "Advancing schedule",
			cron: "0 * * * *",
			timezone: "UTC",
			mode: "task",
			enabled: true,
			concurrencyPolicy: "allow",
			nextRunAt: pastDue,
			taskTemplate: { title: "Advancing" },
		} as any);

		await runTickJob(now.toISOString());

		const updated = await setup!.app.collections.schedules.findOne({
			where: { id: schedule.id },
		});
		expect(updated).toBeTruthy();
		expect(new Date(updated!.lastRunAt as string).getTime()).toBe(
			now.getTime(),
		);
		const nextRun = new Date(updated!.nextRunAt as string);
		expect(nextRun.getTime()).toBeGreaterThan(now.getTime());
	});
});
