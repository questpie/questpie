import { createContextFactory } from "questpie/app";
import { createFetchHandler } from "questpie";
import type { RealtimeAdapter, RealtimeChangeEvent } from "questpie/realtime";
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
import chatRoute from "../routes/chat";
import runStreamRoute from "../routes/run-stream";
import runCompleteRoute from "../routes/runs/[runId]/complete";
import runEventsRoute from "../routes/runs/[runId]/events";
import workerClaimRoute from "../routes/workers/claim";
import knowledgeResource from "../services/knowledge-resource";
import providerRuntime from "../services/provider-runtime";
import { hashWorkerSecret } from "../services/worker-manager";
import workerManager from "../services/worker-manager";
import chatQueryWorkflow from "../workflows/chat-query";

type WorkflowEvent = {
	event: string;
	data?: unknown;
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

function fakeStep(events: Record<string, unknown>) {
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
					providerRuntime,
					workerManager,
				},
				routes: {
					chat: chatRoute,
					"run-stream": runStreamRoute,
					"runs/[runId]/complete": runCompleteRoute,
					"runs/[runId]/events": runEventsRoute,
					"workers/claim": workerClaimRoute,
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

	it("orders initial run events by sequence before falling back to creation order", async () => {
		const app = setup!.app;
		const run = await app.collections.runs.create({
			status: "pending",
			runtime: "codex",
			initiatedBy: "chat",
			instructions: "Verify stream ordering",
		} as any);
		await app.collections.run_events.create({
			run: run.id,
			type: "second",
			level: "info",
			summary: "Second sequenced event",
			sequence: 2,
		} as any);
		await app.collections.run_events.create({
			run: run.id,
			type: "unsequenced",
			level: "info",
			summary: "Unsequenced event",
		} as any);
		await app.collections.run_events.create({
			run: run.id,
			type: "first",
			level: "info",
			summary: "First sequenced event",
			sequence: 1,
		} as any);

		const streamResponse = await call(`/api/run-stream?run_id=${run.id}`, {
			method: "GET",
		});
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
		} finally {
			await stream.close();
		}
	});

	it("streams run snapshots and worker run events while chat completion stays workflow-driven", async () => {
		const app = setup!.app;
		const localWorkerHeaders = { "x-local-dev": "true" };
		const worker = await app.collections.workers.create({
			deviceId: "chat-stream-worker",
			name: "Chat stream worker",
			status: "online",
			capabilities: workerCapabilities(),
			machineSecretHash: hashWorkerSecret("unused-local-dev"),
		} as any);

		const chat = await callJson("/api/chat", {
			body: {
				content: "Summarize the realtime workflow path.",
				metadata: { source: "test" },
			},
		});
		expect(chat.runId).toBeTruthy();
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

			const claim = await callJson("/api/workers/claim", {
				headers: localWorkerHeaders,
				body: {
					worker_id: worker.id,
					runtime: "codex",
					capabilities: workerCapabilities(),
					shared_checkout_enabled: true,
					worktree_isolation_available: true,
				},
			});
			expect(claim.run).toMatchObject({ id: chat.runId });

			const progressA = await callJson(`/api/runs/${chat.runId}/events`, {
				headers: localWorkerHeaders,
				body: {
					type: "started",
					summary: "Worker started spawn-agent",
					sequence: 2,
					metadata: { phase: "start" },
				},
			});
			const progressB = await callJson(`/api/runs/${chat.runId}/events`, {
				headers: localWorkerHeaders,
				body: {
					type: "progress",
					summary: "Streaming progress",
					sequence: 3,
					metadata: { phase: "progress" },
				},
			});
			const completion = await callJson(`/api/runs/${chat.runId}/complete`, {
				headers: localWorkerHeaders,
				body: {
					status: "completed",
					summary: "Realtime workflow path completed",
					runtime_session_ref: "chat-runtime-session",
					resumable: true,
				},
			});
			expect(completion.ok).toBe(true);

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
					runEventTypes.has("progress") &&
					runEventTypes.has("completed")
				);
			});

			const streamedRunEvents = observed.filter(
				(event) => event.event === "run_event",
			);
			const streamedIds = streamedRunEvents.map(
				(event) => event.data.event.id as string,
			);
			expect(streamedIds).toContain(progressA.event_id);
			expect(streamedIds).toContain(progressB.event_id);
			expect(new Set(streamedIds).size).toBe(streamedIds.length);
			expect(workflowEvents.map((event) => event.event)).toEqual([
				"trigger:chat-query",
				"run.claimed",
				"run.event",
				"run.event",
				"run.completed",
			]);
		} finally {
			abortController.abort();
			await stream.close();
		}
	});

	it("creates the assistant response when chat-query receives durable run events", async () => {
		const app = setup!.app;
		const createContext = createContextFactory(app);
		const ctx = await createContext({ accessMode: "system" });
		const worker = await app.collections.workers.create({
			deviceId: "chat-workflow-worker",
			name: "Chat workflow worker",
			status: "busy",
			capabilities: workerCapabilities(),
			machineSecretHash: hashWorkerSecret("unused-workflow"),
		} as any);
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
		const run = await app.collections.runs.create({
			status: "completed",
			runtime: "codex",
			initiatedBy: "chat",
			instructions: userMessage.content,
			worker: worker.id,
			runtimeSessionRef: "workflow-runtime-session",
			resumable: true,
			targeting: {
				chatSessionId: session.id,
				messageId: userMessage.id,
			},
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
					workerId: worker.id,
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
			preferredWorker: worker.id,
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
});
