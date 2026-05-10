import { createFetchHandler } from "questpie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
import enrollmentEnrollRoute from "../routes/enrollment/enroll";
import enrollmentTokensRoute from "../routes/enrollment/tokens";
import runStatusRoute from "../routes/runs/[runId]";
import runArtifactsRoute from "../routes/runs/[runId]/artifacts";
import runCompleteRoute from "../routes/runs/[runId]/complete";
import runEventsRoute from "../routes/runs/[runId]/events";
import workerClaimRoute from "../routes/workers/claim";
import workerDeregisterRoute from "../routes/workers/deregister";
import workerHeartbeatRoute from "../routes/workers/heartbeat";
import workerRegisterRoute from "../routes/workers/register";
import knowledgeResource from "../services/knowledge-resource";
import workerManager from "../services/worker-manager";

type WorkflowEvent = {
	event: string;
	data?: unknown;
	match?: Record<string, unknown>;
};

function workerCapabilities() {
	return [
		{
			runtime: "codex",
			models: ["gpt-5.3-codex"],
			maxConcurrent: 1,
			tags: ["mock"],
		},
	];
}

async function responseJson(response: Response) {
	const text = await response.text();
	return text ? JSON.parse(text) : null;
}

describe("mock worker E2E contract", () => {
	let setup:
		| {
				app: MockApp;
				cleanup: () => Promise<void>;
		  }
		| undefined;
	let workflowEvents: WorkflowEvent[];
	let handler: ReturnType<typeof createFetchHandler>;

	beforeEach(async () => {
		workflowEvents = [];
		const workflows = {
			async trigger(name: string, input: unknown) {
				workflowEvents.push({ event: `trigger:${name}`, data: input });
				return { instanceId: `wf-${workflowEvents.length}`, existing: false };
			},
			async sendEvent(
				event: string,
				data?: unknown,
				match?: Record<string, unknown>,
			) {
				workflowEvents.push({ event, data, match });
			},
		};

		setup = await buildMockApp({
			collections: {
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
				knowledgeResource,
				workerManager,
			},
			routes: {
				"enrollment/enroll": enrollmentEnrollRoute,
				"enrollment/tokens": enrollmentTokensRoute,
				"runs/[runId]": runStatusRoute,
				"runs/[runId]/artifacts": runArtifactsRoute,
				"runs/[runId]/complete": runCompleteRoute,
				"runs/[runId]/events": runEventsRoute,
				"workers/claim": workerClaimRoute,
				"workers/deregister": workerDeregisterRoute,
				"workers/heartbeat": workerHeartbeatRoute,
				"workers/register": workerRegisterRoute,
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

	async function call(
		path: string,
		options: {
			method?: string;
			body?: unknown;
			headers?: Record<string, string>;
		} = {},
	) {
		const headers: Record<string, string> = {
			...(options.body === undefined
				? {}
				: { "content-type": "application/json" }),
			...(options.headers ?? {}),
		};
		const response = await handler(
			new Request(`http://localhost${path}`, {
				method: options.method ?? "POST",
				headers,
				body:
					options.body === undefined ? undefined : JSON.stringify(options.body),
			}),
		);
		expect(response).not.toBeNull();
		const payload = await responseJson(response!);
		if (!response!.ok) {
			throw new Error(
				`${options.method ?? "POST"} ${path} failed with ${
					response!.status
				}: ${JSON.stringify(payload)}`,
			);
		}
		return payload;
	}

	it("enrolls, claims, reports events/artifacts, and completes a run", async () => {
		const app = setup!.app;

		const token = await call("/api/enrollment/tokens", {
			body: { description: "mock worker", ttl_seconds: 3600 },
		});
		expect(token.secret).toBeTruthy();

		const enrollment = await call("/api/enrollment/enroll", {
			body: {
				token: token.secret,
				name: "Mock worker",
				device_id: "mock-device",
				capabilities: workerCapabilities(),
			},
		});
		const workerId = enrollment.worker_id as string;
		const workerSecret = enrollment.machine_secret as string;
		expect(workerId).toBeTruthy();
		expect(workerSecret).toBeTruthy();

		const workerHeaders = { "x-worker-secret": workerSecret };
		const registered = await call("/api/workers/register", {
			headers: workerHeaders,
			body: {
				id: workerId,
				device_id: "mock-device",
				name: "Mock worker",
				capabilities: workerCapabilities(),
			},
		});
		expect(registered.workerId).toBe(workerId);

		const heartbeat = await call("/api/workers/heartbeat", {
			headers: workerHeaders,
			body: { worker_id: workerId },
		});
		expect(heartbeat).toMatchObject({
			ok: true,
			worker_id: workerId,
			status: "online",
		});

		const task = await app.collections.tasks.create({
			title: "Mock worker task",
			description: "Exercise the worker route contract",
			type: "feature",
			status: "pending",
			priority: "high",
			scopeType: "company",
			createdBy: "operator-1",
		} as any);
		const run = await app.collections.runs.create({
			task: task.id,
			status: "pending",
			runtime: "codex",
			initiatedBy: "task",
			instructions: "Return a mocked artifact and summary.",
			targeting: {
				runtimeHints: {
					workspace_mode: "none",
				},
			},
		} as any);

		const claim = await call("/api/workers/claim", {
			headers: workerHeaders,
			body: {
				worker_id: workerId,
				shared_checkout_enabled: true,
				worktree_isolation_available: true,
			},
		});
		expect(claim.lease_id).toBeTruthy();
		expect(claim.run).toMatchObject({
			id: run.id,
			task_id: task.id,
			runtime: "codex",
			workspace_mode: "none",
		});

		const claimedStatus = await call(`/api/runs/${run.id}`, {
			method: "GET",
			headers: workerHeaders,
		});
		expect(claimedStatus).toMatchObject({
			id: run.id,
			task_id: task.id,
			worker_id: workerId,
			status: "claimed",
		});

		const started = await call(`/api/runs/${run.id}/events`, {
			headers: workerHeaders,
			body: {
				type: "started",
				summary: "Starting mocked spawn-agent",
				metadata: { phase: "start" },
			},
		});
		expect(started.event_id).toBeTruthy();

		const artifact = await call(`/api/runs/${run.id}/artifacts`, {
			headers: workerHeaders,
			body: {
				title: "result.md",
				kind: "preview_file",
				content: "# Result",
				mime_type: "text/markdown",
			},
		});
		expect(artifact.knowledge_resource_id).toBeTruthy();

		const artifactResource = await app.collections.knowledge.findOne({
			where: { id: artifact.knowledge_resource_id },
		});
		expect(artifactResource).toMatchObject({
			run: run.id,
			task: task.id,
			source: "worker",
			body: "# Result",
		});

		const completion = await call(`/api/runs/${run.id}/complete`, {
			headers: workerHeaders,
			body: {
				status: "completed",
				summary: "Mocked run completed",
				tokens: { input: 11, output: 22 },
				outputs: { outcome: "done" },
				runtime_session_ref: "mock-session",
				resumable: true,
			},
		});
		expect(completion.ok).toBe(true);
		expect(completion.knowledge_resource_ids.length).toBeGreaterThanOrEqual(2);

		const completedRun = await app.collections.runs.findOne({
			where: { id: run.id },
		});
		expect(completedRun).toMatchObject({
			status: "completed",
			summary: "Mocked run completed",
			tokensInput: 11,
			tokensOutput: 22,
			runtimeSessionRef: "mock-session",
			resumable: true,
		});

		const updatedTask = await app.collections.tasks.findOne({
			where: { id: task.id },
		});
		expect(updatedTask?.status).toBe("review");

		const leases = await app.collections.worker_leases.find({
			where: { run: run.id },
			limit: 10,
		});
		expect(leases.docs).toHaveLength(1);
		expect(leases.docs[0]?.status).toBe("completed");

		const events = await app.collections.run_events.find({
			where: { run: run.id },
			limit: 20,
			orderBy: { createdAt: "asc" },
		});
		expect(events.docs.map((event: { type: string }) => event.type)).toEqual([
			"started",
			"artifact",
			"completed",
		]);
		expect(workflowEvents.map((event) => event.event)).toEqual([
			"run.claimed",
			"run.event",
			"run.event",
			"run.completed",
		]);
	});
});
