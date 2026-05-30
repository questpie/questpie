import { createFetchHandler } from "questpie";
import { createContextFactory } from "questpie/app";
import type { RealtimeAdapter, RealtimeChangeEvent } from "questpie/realtime";
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
import { mirrorAiRunCollectionChange } from "../lib/ai-run-mirror";
import chatRoute from "../routes/chat";
import runStreamRoute from "../routes/run-stream";
import runStatusRoute from "../routes/runs/[runId]";
import runEventsRoute from "../routes/runs/[runId]/events";
import knowledgeResource from "../services/knowledge-resource";
import chatQueryWorkflow from "../workflows/chat-query";

type WorkflowEvent = {
	event: string;
	data?: unknown;
	match?: Record<string, unknown>;
};

type WaitEvent = {
	name: string;
	event: string;
	match?: Record<string, unknown>;
};

type SSEEvent = {
	event: string;
	data: any;
};

class MockRealtimeAdapter implements RealtimeAdapter {
	public notices: RealtimeChangeEvent[] = [];
	private listeners = new Set<(notice: unknown) => void>();
	private subscriberWaiters = new Set<() => void>();

	async start(): Promise<void> {}
	async stop(): Promise<void> {}

	subscribe(handler: (notice: unknown) => void): () => void {
		this.listeners.add(handler);
		for (const waiter of this.subscriberWaiters) waiter();
		return () => {
			this.listeners.delete(handler);
		};
	}

	async notify(event: RealtimeChangeEvent): Promise<void> {
		this.notices.push(event);
		for (const listener of this.listeners) {
			listener({
				seq: event.seq,
				resourceType: event.resourceType,
				resource: event.resource,
				operation: event.operation,
			});
		}
	}

	async waitForSubscribers(count = 1, timeoutMs = 1000) {
		if (this.listeners.size >= count) return;
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.subscriberWaiters.delete(check);
				reject(new Error("Timed out waiting for realtime subscriber"));
			}, timeoutMs);
			const check = () => {
				if (this.listeners.size < count) return;
				clearTimeout(timeout);
				this.subscriberWaiters.delete(check);
				resolve();
			};
			this.subscriberWaiters.add(check);
		});
	}
}

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

function relationId(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (typeof value === "object" && value && "id" in value) {
		const id = (value as { id?: unknown }).id;
		return typeof id === "string" ? id : null;
	}
	return null;
}

function createSSEReader(response: Response) {
	if (!response.body) throw new Error("Expected SSE response body");

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let closed = false;

	const parseBufferedEvent = (): SSEEvent | null => {
		const separatorIndex = buffer.indexOf("\n\n");
		if (separatorIndex === -1) return null;

		const chunk = buffer.slice(0, separatorIndex);
		buffer = buffer.slice(separatorIndex + 2);

		let event = "message";
		let data = "";
		for (const line of chunk.split("\n")) {
			if (line.startsWith("event:")) {
				event = line.slice(6).trim();
			} else if (line.startsWith("data:")) {
				data += line.slice(5).trim();
			}
		}

		return {
			event,
			data: data ? JSON.parse(data) : null,
		};
	};

	const close = async () => {
		if (closed) return;
		closed = true;
		await reader.cancel().catch(() => {});
	};

	const readEvent = async (timeoutMs = 2000): Promise<SSEEvent> => {
		while (!closed) {
			const buffered = parseBufferedEvent();
			if (buffered) return buffered;

			let timeout: ReturnType<typeof setTimeout> | undefined;
			try {
				const result = await Promise.race([
					reader.read(),
					new Promise<never>((_, reject) => {
						timeout = setTimeout(
							() => reject(new Error("Timed out waiting for SSE event")),
							timeoutMs,
						);
					}),
				]);
				if (timeout) clearTimeout(timeout);
				if (result.done) throw new Error("SSE stream closed before event");
				buffer += decoder.decode(result.value, { stream: true });
			} catch (error) {
				if (timeout) clearTimeout(timeout);
				await close();
				throw error;
			}
		}

		throw new Error("SSE reader is closed");
	};

	const readUntil = async (
		predicate: (events: SSEEvent[]) => boolean,
		timeoutMs = 3000,
	) => {
		const events: SSEEvent[] = [];
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const remaining = Math.max(1, deadline - Date.now());
			events.push(await readEvent(remaining));
			if (predicate(events)) return events;
		}
		await close();
		throw new Error("Timed out waiting for expected SSE events");
	};

	return { readEvent, readUntil, close };
}

function fakeStep(
	events: Record<string, unknown>,
	options?: { waitEvents?: WaitEvent[] },
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
			throw new Error("Unexpected child workflow invocation");
		},
		async sendEvent() {},
	};
}

function silentLog() {
	return {
		debug() {},
		info() {},
		warn() {},
		error() {},
	};
}

describe("chat realtime workflow contract", () => {
	let setup:
		| {
				app: MockApp;
				cleanup: () => Promise<void>;
		  }
		| undefined;
	let handler: ReturnType<typeof createFetchHandler>;
	let realtimeAdapter: MockRealtimeAdapter;
	let workflowEvents: WorkflowEvent[];

	beforeEach(async () => {
		realtimeAdapter = new MockRealtimeAdapter();
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

		setup = await buildMockApp(
			{
				collections: {
					ai_run_events: aiModule.collections.ai_run_events,
					ai_runs: aiModule.collections.ai_runs,
					ai_worker_leases: aiModule.collections.ai_worker_leases,
					ai_workers: aiModule.collections.ai_workers,
					activity,
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
				},
				services: {
					knowledgeResource,
				},
				hooks: {
					collections: {
						afterChange: async (ctx) => {
							ctx.onAfterCommit(async () => {
								await mirrorAiRunCollectionChange({ ...ctx, workflows } as any);
							});
						},
					},
				},
				routes: {
					chat: chatRoute,
					"run-stream": runStreamRoute,
					"runs/[runId]": runStatusRoute,
					"runs/[runId]/events": runEventsRoute,
				},
			},
			{ realtime: { adapter: realtimeAdapter } },
		);
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
			signal?: AbortSignal;
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
				signal: options.signal,
			}),
		);
		expect(response).not.toBeNull();
		return response!;
	}

	async function callJson(
		path: string,
		options: Parameters<typeof call>[1] = {},
	) {
		const response = await call(path, options);
		const text = await response.text();
		const payload = text ? JSON.parse(text) : null;
		if (!response.ok) {
			throw new Error(
				`${options.method ?? "POST"} ${path} failed with ${
					response.status
				}: ${JSON.stringify(payload)}`,
			);
		}
		return payload;
	}

	it("requires auth for run compatibility reads", async () => {
		const app = setup!.app;
		const run = await app.collections.run_links.create({
			status: "running",
			runtime: "codex",
			initiatedBy: "chat",
			instructions: "Protect this run",
		} as any);
		const unauthenticatedHandler = createFetchHandler(app, {
			basePath: "/api",
			getSession: async () => null,
		});

		const runResponse = await unauthenticatedHandler(
			new Request(`http://localhost/api/runs/${run.id}`, {
				method: "GET",
			}),
		);
		expect(runResponse?.status).toBe(401);

		const eventsResponse = await unauthenticatedHandler(
			new Request(`http://localhost/api/runs/${run.id}/events`, {
				method: "GET",
			}),
		);
		expect(eventsResponse?.status).toBe(401);
	});

	it("orders initial AI run events by sequence before falling back to creation order", async () => {
		const app = setup!.app;
		const aiRun = await app.collections.ai_runs.create({
			status: "pending",
			runtime: "codex",
			prompt: "Verify stream ordering",
		} as any);
		await app.collections.run_links.create({
			id: "product-run-ordering",
			aiRun: aiRun.id,
			status: "pending",
			runtime: "codex",
			initiatedBy: "chat",
			instructions: "Verify stream ordering",
		} as any);
		await app.collections.ai_run_events.create({
			run: aiRun.id,
			type: "second",
			level: "info",
			summary: "Second sequenced event",
			sequence: 2,
		} as any);
		await app.collections.ai_run_events.create({
			run: aiRun.id,
			type: "unsequenced",
			level: "info",
			summary: "Unsequenced event",
		} as any);
		await app.collections.ai_run_events.create({
			run: aiRun.id,
			type: "first",
			level: "info",
			summary: "First sequenced event",
			sequence: 1,
		} as any);

		const streamResponse = await call(
			"/api/run-stream?run_id=product-run-ordering",
			{ method: "GET" },
		);
		const stream = createSSEReader(streamResponse);

		try {
			expect(await stream.readEvent()).toMatchObject({
				event: "heartbeat",
				data: { type: "heartbeat" },
			});
			const observed = await stream.readUntil(
				(events) =>
					events.filter((event) => event.event === "run_event").length === 3,
			);
			expect(
				observed
					.filter((event) => event.event === "run_event")
					.map((event) => event.data.event.type),
			).toEqual(["first", "second", "unsequenced"]);
			for (const event of observed.filter(
				(item) => item.event === "run_event",
			)) {
				expect(event.data.event).toMatchObject({
					run: "product-run-ordering",
					aiRun: aiRun.id,
				});
			}
		} finally {
			await stream.close();
		}
	});

	it("streams historical run links with mirrored snapshots and no AI event lookup", async () => {
		const app = setup!.app;
		await app.collections.run_links.create({
			id: "legacy-run-snapshot",
			legacyRunId: "legacy-run-snapshot",
			status: "completed",
			runtime: "codex",
			initiatedBy: "chat",
			instructions: "Historical run",
			summary: "Historical summary",
		} as any);

		const streamResponse = await call(
			"/api/run-stream?runId=legacy-run-snapshot",
			{ method: "GET" },
		);
		const stream = createSSEReader(streamResponse);

		try {
			expect(await stream.readEvent()).toMatchObject({
				event: "heartbeat",
				data: { type: "heartbeat" },
			});
			const observed = await stream.readUntil((events) =>
				events.some((event) => event.event === "run"),
			);
			expect(
				observed.find((event) => event.event === "run")?.data.run,
			).toMatchObject({
				id: "legacy-run-snapshot",
				aiRun: null,
				status: "completed",
				summary: "Historical summary",
			});
			await expect(stream.readEvent(150)).rejects.toThrow(
				/Timed out waiting for SSE event/,
			);
		} finally {
			await stream.close();
		}
	});

	it("creates chat runs as AI run links and stores the link id on the user message", async () => {
		const app = setup!.app;
		const provider = await app.collections.providers.create({
			name: "OpenAI",
			type: "openai",
			enabled: true,
		} as any);
		const model = await app.collections.models.create({
			name: "Codex",
			provider: provider.id,
			modelId: "gpt-5.3-codex",
			runtime: "codex",
			enabled: true,
		} as any);

		const chat = await callJson("/api/chat", {
			body: {
				content: "Create a run link for this chat.",
				modelId: model.id,
			},
		});

		const message = await app.collections.chat_messages.findOne({
			where: { id: chat.message.id },
		});
		expect(relationId(message?.run)).toBe(chat.runId);

		const runLink = await app.collections.run_links.findOne({
			where: { id: chat.runId },
		});
		expect(runLink).toMatchObject({
			chatSession: chat.session.id,
			chatMessage: chat.message.id,
			status: "pending",
			runtime: "codex",
			initiatedBy: "chat",
			provider: provider.id,
			model: model.id,
		});

		const aiRunId = relationId(runLink?.aiRun);
		expect(aiRunId).toBeTruthy();
		const aiRun = await app.collections.ai_runs.findOne({
			where: { id: aiRunId! },
		});
		expect(aiRun).toMatchObject({
			status: "pending",
			runtime: "codex",
			prompt: "Create a run link for this chat.",
		});
		expect(aiRun).not.toHaveProperty("provider");
		expect(aiRun).not.toHaveProperty("model");
		expect(
			(aiRun?.meta as Record<string, unknown> | undefined)?.autopilot,
		).toBe(undefined);

		const createContext = createContextFactory(app);
		const ctx = await createContext({ accessMode: "system" });
		const resources = await ctx.services.knowledgeResource.createRunOutputs({
			runId: chat.runId,
			summary: "Knowledge is linked through the product run id.",
			source: "worker",
		});
		expect(resources).toHaveLength(1);
		expect(relationId(resources[0].run)).toBe(chat.runId);
	});

	it("streams run snapshots and AI run events while chat completion stays workflow-driven", async () => {
		const app = setup!.app;
		const worker = await app.collections.ai_workers.create({
			deviceId: "chat-stream-worker",
			name: "Chat stream worker",
			status: "online",
			capabilities: workerCapabilities(),
			secretHash: "unused-local-dev",
		} as any);

		const chat = await callJson("/api/chat", {
			body: {
				content: "Summarize the realtime workflow path.",
				metadata: { source: "test" },
			},
		});
		expect(chat.runId).toBeTruthy();
		const runLink = await app.collections.run_links.findOne({
			where: { id: chat.runId },
		});
		const aiRunId = relationId(runLink?.aiRun);
		expect(aiRunId).toBeTruthy();
		expect(workflowEvents[0]).toMatchObject({
			event: "trigger:chat-query",
			data: {
				chatSessionId: chat.session.id,
				messageId: chat.message.id,
				runId: chat.runId,
			},
		});

		const abortController = new AbortController();
		const streamResponse = await call(`/api/run-stream?runId=${chat.runId}`, {
			method: "GET",
			signal: abortController.signal,
		});
		expect(streamResponse.headers.get("content-type")).toContain(
			"text/event-stream",
		);
		const stream = createSSEReader(streamResponse);

		try {
			expect(await stream.readEvent()).toMatchObject({
				event: "heartbeat",
				data: { type: "heartbeat" },
			});
			const initialRun = await stream.readUntil((events) =>
				events.some((event) => event.event === "run"),
			);
			expect(
				initialRun.find((event) => event.event === "run")?.data.run,
			).toMatchObject({
				id: chat.runId,
				status: "pending",
			});

			await realtimeAdapter.waitForSubscribers();

			await app.collections.ai_runs.updateById({
				id: aiRunId!,
				data: {
					status: "claimed",
					worker: worker.id,
					startedAt: new Date(),
				},
			});

			const progressA = await app.collections.ai_run_events.create({
				run: aiRunId,
				type: "started",
				level: "info",
				summary: "Worker started spawn-agent",
				sequence: 2,
				meta: { phase: "start" },
			} as any);
			const progressB = await app.collections.ai_run_events.create({
				run: aiRunId,
				type: "progress",
				level: "info",
				summary: "Streaming progress",
				sequence: 3,
				meta: { phase: "progress" },
			} as any);
			await app.collections.ai_runs.updateById({
				id: aiRunId!,
				data: {
					status: "completed",
					summary: "Realtime workflow path completed",
					runtimeSessionRef: "chat-runtime-session",
					endedAt: new Date(),
				},
			});

			const observed = await stream.readUntil((events) => {
				const runEvents = events.filter((event) => event.event === "run_event");
				const runEventTypes = new Set(
					runEvents.map((event) => event.data.event.type),
				);
				const completedRun = events.some(
					(event) =>
						event.event === "run" && event.data.run.status === "completed",
				);
				return (
					completedRun &&
					runEventTypes.has("started") &&
					runEventTypes.has("progress")
				);
			});

			const streamedRunEvents = observed.filter(
				(event) => event.event === "run_event",
			);
			const streamedIds = streamedRunEvents.map(
				(event) => event.data.event.id as string,
			);
			expect(streamedIds).toContain(progressA.id);
			expect(streamedIds).toContain(progressB.id);
			expect(new Set(streamedIds).size).toBe(streamedIds.length);
			expect(workflowEvents.map((event) => event.event)).toEqual([
				"trigger:chat-query",
				"run.claimed",
				"run.event",
				"run.event",
				"run.completed",
			]);
			expect(workflowEvents.at(-1)).toMatchObject({
				event: "run.completed",
				data: {
					runId: chat.runId,
					status: "completed",
					summary: "Realtime workflow path completed",
				},
				match: { runId: chat.runId },
			});
			const completedMessage = await app.collections.chat_messages.findOne({
				where: { id: chat.message.id },
			});
			expect(completedMessage?.runStatus).toBe("completed");
			const resources = await app.collections.knowledge.find({
				where: { run: chat.runId },
				limit: 10,
			});
			expect(resources.docs[0]).toMatchObject({
				run: chat.runId,
				path: `runs/${chat.runId}/summary.md`,
			});
		} finally {
			abortController.abort();
			await stream.close();
		}
	});

	it("creates the assistant response when chat-query receives durable run events", async () => {
		const app = setup!.app;
		const createContext = createContextFactory(app);
		const ctx = await createContext({ accessMode: "system" });
		const session = await app.collections.chat_sessions.create({
			title: "Workflow chat",
			status: "active",
			scopeType: "company",
			metadata: { existing: true },
		} as any);
		const userMessage = await app.collections.chat_messages.create({
			chatSession: session.id,
			role: "user",
			content: "What happened?",
		} as any);
		const run = await app.collections.run_links.create({
			id: "chat-completed-run",
			status: "completed",
			runtime: "codex",
			initiatedBy: "chat",
			instructions: userMessage.content,
			runtimeSessionRef: "workflow-runtime-session",
			resumable: true,
			chatSession: session.id,
			chatMessage: userMessage.id,
		} as any);

		const result = await chatQueryWorkflow.handler({
			input: {
				chatSessionId: session.id,
				messageId: userMessage.id,
				runId: run.id,
				prompt: userMessage.content,
				projectId: null,
				taskId: null,
				modelId: null,
			},
			step: fakeStep({
				"run.claimed": {
					runId: run.id,
					workerId: "ai-worker-1",
					leaseId: "lease-1",
				},
				"run.completed": {
					runId: run.id,
					status: "completed",
					summary: "The worker finished cleanly.",
					knowledgeResourceIds: ["knowledge-1"],
				},
			}) as any,
			ctx,
			log: silentLog(),
		});

		expect(result).toMatchObject({
			chatSessionId: session.id,
			runId: run.id,
			status: "completed",
		});

		const messages = await app.collections.chat_messages.find({
			where: { chatSession: session.id },
			orderBy: { createdAt: "asc" },
			limit: 10,
		});
		const assistantMessage = messages.docs.find(
			(message: { role?: string }) => message.role === "assistant",
		);
		expect(assistantMessage).toMatchObject({
			content: "The worker finished cleanly.",
			run: run.id,
			runStatus: "completed",
			metadata: {
				workflow: "chat-query",
				knowledgeResourceIds: ["knowledge-1"],
			},
		});

		const updatedUserMessage = await app.collections.chat_messages.findOne({
			where: { id: userMessage.id },
		});
		expect(updatedUserMessage).toMatchObject({
			run: run.id,
			runStatus: "completed",
		});

		const updatedSession = await app.collections.chat_sessions.findOne({
			where: { id: session.id },
		});
		expect(updatedSession).toMatchObject({
			runtimeSessionRef: "workflow-runtime-session",
			metadata: {
				existing: true,
				lastRunId: run.id,
				lastMessageId: assistantMessage?.id,
				lastRunStatus: "completed",
			},
		});

		const activities = await app.collections.activity.find({
			where: { run: run.id, type: "chat.response" },
			limit: 10,
		});
		expect(activities.docs).toHaveLength(1);
		expect(activities.docs[0]).toMatchObject({
			run: run.id,
			actor: "workflow:chat-query",
			summary: `Chat response created for session ${session.id}`,
			details: {
				chatSessionId: session.id,
				messageId: assistantMessage?.id,
				status: "completed",
				knowledgeResourceIds: ["knowledge-1"],
			},
		});
	});

	it("creates scheduled chat run links and waits on product run ids", async () => {
		const app = setup!.app;
		const createContext = createContextFactory(app);
		const ctx = await createContext({ accessMode: "system" });
		const schedule = await app.collections.schedules.create({
			name: "Scheduled chat query",
			cron: "0 9 * * *",
			timezone: "UTC",
			mode: "chat",
			enabled: true,
			chatPrompt: "Summarize the project.",
			taskTemplate: {},
		} as any);
		const session = await app.collections.chat_sessions.create({
			title: "Scheduled chat",
			status: "active",
			scopeType: "company",
		} as any);
		const message = await app.collections.chat_messages.create({
			chatSession: session.id,
			role: "user",
			content: "Summarize the project.",
		} as any);
		const execution = await app.collections.schedule_executions.create({
			schedule: schedule.id,
			chatSession: session.id,
			status: "triggered",
			triggeredAt: new Date(),
			metadata: { mode: "chat", messageId: message.id },
		} as any);
		const waitEvents: WaitEvent[] = [];

		const result = await chatQueryWorkflow.handler({
			input: {
				chatSessionId: session.id,
				messageId: message.id,
				prompt: message.content,
				scheduleExecutionId: execution.id,
			},
			step: fakeStep(
				{
					"run.claimed": { runId: "ignored", workerId: "w1" },
					"run.completed": {
						status: "completed",
						summary: "Scheduled chat completed.",
					},
				},
				{ waitEvents },
			) as any,
			ctx,
			log: silentLog(),
		});

		const runLink = await app.collections.run_links.findOne({
			where: { id: result.runId },
		});
		expect(runLink).toMatchObject({
			chatSession: session.id,
			chatMessage: message.id,
			schedule: schedule.id,
			scheduleExecution: execution.id,
			initiatedBy: "chat",
			status: "pending",
		});
		expect(relationId(runLink?.aiRun)).toBeTruthy();

		const linkedExecution = await app.collections.schedule_executions.findOne({
			where: { id: execution.id },
		});
		expect(relationId(linkedExecution?.run)).toBe(result.runId);
		expect(waitEvents).toEqual([
			{
				name: "wait-run-claimed",
				event: "run.claimed",
				match: { runId: result.runId },
			},
			{
				name: "wait-run-completed",
				event: "run.completed",
				match: { runId: result.runId },
			},
		]);
	});
});
