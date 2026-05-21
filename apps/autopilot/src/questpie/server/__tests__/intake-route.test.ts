import { createFetchHandler } from "questpie";
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
import { knowledge } from "../collections/knowledge";
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
import { workflowConfigs } from "../collections/workflow-configs";
import intakeRoute from "../routes/intake";

type WorkflowEvent = {
	event: string;
	data?: unknown;
};

describe("intake route", () => {
	let setup:
		| {
				app: MockApp;
				cleanup: () => Promise<void>;
		  }
		| undefined;
	let handler: ReturnType<typeof createFetchHandler>;
	let workflowEvents: WorkflowEvent[];

	beforeEach(async () => {
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
				knowledge,
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
				workflow_configs: workflowConfigs,
			},
			routes: {
				intake: intakeRoute,
			},
		});
		await runTestDbMigrations(setup.app);

		handler = createFetchHandler(setup.app, {
			basePath: "/api",
			getSession: async () => ({
				user: { id: "operator-1" },
				session: { id: "session-1" },
			}),
			extendContext: async () => ({ workflows }),
		});
	});

	afterEach(async () => {
		await setup?.cleanup();
		setup = undefined;
	});

	async function callIntake(body: unknown) {
		const response = await handler(
			new Request("http://localhost/api/intake", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			}),
		);
		expect(response).not.toBeNull();
		const text = await response!.text();
		const payload = text ? JSON.parse(text) : null;
		return { status: response!.status, payload };
	}

	it("creates a task, activity, and triggers the task-pipeline workflow", async () => {
		const { status, payload } = await callIntake({
			title: "Fix the login bug",
			description: "Users cannot log in after password reset",
			type: "bug",
			priority: "high",
		});

		expect(status).toBe(200);
		expect(payload.taskId).toBeTruthy();
		expect(payload.workflowInstanceId).toBeTruthy();
		expect(payload.existingWorkflow).toBe(false);

		const task = await setup!.app.collections.tasks.findOne({
			where: { id: payload.taskId },
		});
		expect(task).toMatchObject({
			title: "Fix the login bug",
			description: "Users cannot log in after password reset",
			type: "bug",
			priority: "high",
			status: "pending",
			scopeType: "company",
			createdBy: "operator-1",
		});

		const activities = await setup!.app.collections.activity.find({
			where: { task: payload.taskId, type: "task.intake" },
			limit: 10,
		});
		expect(activities.docs).toHaveLength(1);
		expect(activities.docs[0]).toMatchObject({
			actor: "operator-1",
			summary: "Created task: Fix the login bug",
			details: { source: "intake", start: true },
		});

		expect(workflowEvents).toHaveLength(1);
		expect(workflowEvents[0]).toMatchObject({
			event: "trigger:task-pipeline",
			data: {
				taskId: payload.taskId,
				runReason: "intake",
				requestedBy: "operator-1",
			},
		});
	});

	it("creates a task without starting when start=false", async () => {
		const { status, payload } = await callIntake({
			title: "Research caching strategies",
			type: "research",
			priority: "low",
			start: false,
		});

		expect(status).toBe(200);
		expect(payload.taskId).toBeTruthy();
		expect(payload.workflowInstanceId).toBeNull();
		expect(payload.existingWorkflow).toBe(false);

		const task = await setup!.app.collections.tasks.findOne({
			where: { id: payload.taskId },
		});
		expect(task?.status).toBe("backlog");

		expect(workflowEvents).toHaveLength(0);
	});

	it("associates the task with a project when projectId is provided", async () => {
		const project = await setup!.app.collections.projects.create({
			name: "Main App",
			slug: "main-app",
			gitProvider: "github",
			defaultBranch: "main",
		} as any);

		const { status, payload } = await callIntake({
			title: "Add feature flag system",
			projectId: project.id,
			type: "feature",
		});

		expect(status).toBe(200);
		const task = await setup!.app.collections.tasks.findOne({
			where: { id: payload.taskId },
		});
		expect(task).toMatchObject({
			project: project.id,
			scopeType: "project",
		});
	});

	it("returns 404 for non-existent project", async () => {
		const { status } = await callIntake({
			title: "Bad project ref",
			projectId: "non-existent-id",
		});

		expect(status).toBe(404);
	});

	it("rejects missing title", async () => {
		const { status } = await callIntake({
			description: "No title provided",
		});

		expect(status).toBeGreaterThanOrEqual(400);
	});
});
