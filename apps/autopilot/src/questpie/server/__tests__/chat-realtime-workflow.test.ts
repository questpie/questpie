import { createFetchHandler } from "questpie";
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
import { mirrorAiRunCollectionChange } from "../lib/ai-run-mirror";
import chatRoute from "../routes/chat";
import runStreamRoute from "../routes/run-stream";
import runStatusRoute from "../routes/runs/[runId]";
import runEventsRoute from "../routes/runs/[runId]/events";
import knowledgeResource from "../services/knowledge-resource";
// chat-query workflow deleted in chat v7 cutover (background producer architecture).

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

describe("chat realtime workflow contract", () => {
	let setup:
		| {
				app: MockApp;
				cleanup: () => Promise<void>;
		  }
		| undefined;
	let handler: ReturnType<typeof createFetchHandler>;
	let realtimeAdapter: MockRealtimeAdapter;

	beforeEach(async () => {
		realtimeAdapter = new MockRealtimeAdapter();
		const workflows = {
			async trigger(_name: string, _input: unknown) {
				return { instanceId: "wf-mock", existing: false };
			},
			async sendEvent(_event: string, _data?: unknown) {},
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

		const mockQueue = {
			chatTurnProducer: {
				async publish() {
					return "mock-job-id";
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
		expect(runResponse?.status).toBe(403);

		const eventsResponse = await unauthenticatedHandler(
			new Request(`http://localhost/api/runs/${run.id}/events`, {
				method: "GET",
			}),
		);
		expect(eventsResponse?.status).toBe(403);
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

	it("creates chat sessions and user messages via POST /api/chat", async () => {
		const app = setup!.app;
		const chat = await callJson("/api/chat", {
			body: {
				content: "Create a chat with the new producer architecture.",
			},
		});

		expect(chat.session).toBeTruthy();
		expect(chat.message).toBeTruthy();
		expect(chat.streamId).toBeTruthy();

		const message = await app.collections.chat_messages.findOne({
			where: { id: chat.message.id },
		});
		expect(message?.role).toBe("user");
		expect(message?.content).toBe(
			"Create a chat with the new producer architecture.",
		);

		const session = await app.collections.chat_sessions.findOne({
			where: { id: chat.session.id },
		});
		expect(session?.activeStreamId).toBe(chat.streamId);
	});

	// The following tests verified the old chat-query workflow which has been
	// replaced by the background chat-turn-producer job in the chat v7 cutover.
	// The run-stream and ai-run-mirror paths remain untouched and are still
	// covered by the SSE-ordering and run-auth tests above.
});
