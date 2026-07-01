/**
 * T7 — POST /api/chat under AUTOPILOT_SINGLE_MODEL=true (the consolidated path).
 *
 * Flag ON, the route mints a `run_links` row (kind="chat") the fleet worker
 * claims, sets `chat_sessions.activeRun`+`activeStreamId` to the run's own
 * `run-stream:…` id (the T6 stream tail resolves this), publishes the
 * `run-available` kick, and returns `{ runId, streamId }`. A second concurrent
 * turn while a non-terminal run is active is rejected 409 (§3.10 single-flight).
 *
 * Flag OFF is covered verbatim by chat-realtime-workflow.test.ts (background
 * producer) — untouched by this cutover.
 */

import { createFetchHandler } from "questpie";
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
import chatRoute from "../routes/chat";

describe("POST /api/chat (AUTOPILOT_SINGLE_MODEL)", () => {
	let setup: { app: MockApp; cleanup: () => Promise<void> } | undefined;
	let handler: ReturnType<typeof createFetchHandler>;
	let kicks: Array<{ runtime?: string }>;
	let producerPublishes: unknown[];
	let prevFlag: string | undefined;

	beforeEach(async () => {
		prevFlag = process.env.AUTOPILOT_SINGLE_MODEL;
		process.env.AUTOPILOT_SINGLE_MODEL = "true";
		kicks = [];
		producerPublishes = [];

		const workflows = {
			async trigger() {
				return { instanceId: "wf-mock", existing: false };
			},
			async sendEvent() {},
		};

		setup = await buildMockApp({
			collections: {
				ai_run_events: aiModule.collections.ai_run_events,
				ai_runs: aiModule.collections.ai_runs,
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
			routes: { chat: chatRoute },
		});
		await runTestDbMigrations(setup.app);

		const mockQueue = {
			// createAiRunLink's best-effort "worker, wake up" kick.
			runAvailable: {
				async publish(payload: { runtime?: string }) {
					kicks.push(payload);
					return "kick-job";
				},
			},
			// Legacy producer — must NOT be published on the flag-ON path.
			chatTurnProducer: {
				async publish(payload: unknown) {
					producerPublishes.push(payload);
					return "producer-job";
				},
			},
		};

		handler = createFetchHandler(setup.app, {
			basePath: "/api",
			getSession: async () => ({
				user: { id: "operator-1" },
				session: { id: "session-1" },
			}),
			extendContext: async () => ({ workflows, queue: mockQueue }),
		});
	});

	afterEach(async () => {
		if (prevFlag === undefined) delete process.env.AUTOPILOT_SINGLE_MODEL;
		else process.env.AUTOPILOT_SINGLE_MODEL = prevFlag;
		await setup?.cleanup();
		setup = undefined;
	});

	async function postChat(body: unknown) {
		const response = await handler(
			new Request("http://localhost/api/chat", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			}),
		);
		expect(response).not.toBeNull();
		const text = await response!.text();
		return {
			status: response!.status,
			body: text ? JSON.parse(text) : null,
		};
	}

	it("mints a kind='chat' run_links row, sets activeRun, returns runId + run-stream id", async () => {
		const res = await postChat({ content: "Hello there" });

		expect(res.status).toBe(200);
		expect(res.body.runId).toBeTruthy();
		expect(typeof res.body.streamId).toBe("string");
		expect(res.body.streamId.startsWith("run-stream:")).toBe(true);

		// The run_links row is the single execution record — pending, chat kind,
		// addressing the same stream id returned to the client.
		const run = await setup!.app.collections.run_links.findOne({
			where: { id: res.body.runId },
		});
		expect(run).toMatchObject({
			status: "pending",
			kind: "chat",
			initiatedBy: "chat",
		});
		expect(run?.activeStreamId).toBe(res.body.streamId);

		// The session points at the run; the T6 stream tail resolves activeRun →
		// run_links.activeStreamId.
		const session = await setup!.app.collections.chat_sessions.findOne({
			where: { id: res.body.session.id },
		});
		expect(
			typeof session?.activeRun === "string"
				? session?.activeRun
				: (session?.activeRun as { id?: string } | null)?.id,
		).toBe(res.body.runId);
		expect(session?.activeStreamId).toBe(res.body.streamId);

		// Kicked the fleet, did NOT publish the legacy producer.
		expect(kicks).toHaveLength(1);
		expect(producerPublishes).toHaveLength(0);
	});

	it("rejects a second concurrent turn while a run is active (409)", async () => {
		const first = await postChat({ content: "First turn" });
		expect(first.status).toBe(200);

		const second = await postChat({
			chatSessionId: first.body.session.id,
			content: "Second turn while the first is still running",
		});
		expect(second.status).toBe(409);

		// Only the first run exists — the second never minted a row.
		const runs = await setup!.app.collections.run_links.find({
			where: { chatSession: first.body.session.id },
			limit: 10,
		});
		expect(runs.docs).toHaveLength(1);
	});
});
