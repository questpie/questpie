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
import assets from "../collections/assets";
import { chatMessages } from "../collections/chat-messages";
import { chatSessions } from "../collections/chat-sessions";
import { environments } from "../collections/environments";
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
				},
			},
			{ realtime: { adapter: realtimeAdapter } },
		);
		await runTestDbMigrations(setup.app);

		const mockQueue = {
			runAvailable: {
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

	it("refreshes an active run through the framework direct-subscribe seam", async () => {
		const app = setup!.app;
		await app.collections.run_links.create({
			id: "active-run-realtime",
			status: "running",
			runtime: "codex",
			initiatedBy: "chat",
			instructions: "Observe this run",
		} as any);

		const response = await call("/api/run-stream?runId=active-run-realtime", {
			method: "GET",
		});
		const stream = createSSEReader(response);
		try {
			await realtimeAdapter.waitForSubscribers();
			const initial = await stream.readUntil((events) =>
				events.some(
					(event) =>
						event.event === "run" && event.data.run.status === "running",
				),
			);
			expect(initial.some((event) => event.event === "run")).toBe(true);

			await app.collections.run_links.updateById({
				id: "active-run-realtime",
				data: { status: "completed", endedAt: new Date() },
			});
			const updated = await stream.readUntil((events) =>
				events.some(
					(event) =>
						event.event === "run" && event.data.run.status === "completed",
				),
			);
			expect(
				updated.find((event) => event.event === "run")?.data.run.status,
			).toBe("completed");
		} finally {
			await stream.close();
		}
	});

	// The legacy ai_runs/ai_run_events half of run-stream (and the
	// runs/[runId]/events route) was deleted with the single-model cutover:
	// run_links is the execution record and its snapshot is the whole stream.
	// POST /api/chat is covered by chat-single-model.test.ts.
});
