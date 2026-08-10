import { describe, expect, test } from "bun:test";

import { z } from "zod";

import type { QueueAdapter } from "../../src/server/modules/core/integrated/queue/adapter.js";
import { cloudflareQueuesAdapter } from "../../src/server/modules/core/integrated/queue/adapters/cloudflare-queues.js";
import { createQueueClient } from "../../src/server/modules/core/integrated/queue/service.js";
import { MockQueueAdapter } from "../utils/mocks/queue.adapter.js";

describe("queue runtime api", () => {
	test("listen and runOnce process jobs", async () => {
		const adapter = new MockQueueAdapter();
		const events: string[] = [];
		let handledDispatchId: string | undefined;

		const jobs = {
			notify: {
				name: "notify",
				schema: z.object({ id: z.string().optional() }),
				handler: async ({ payload, dispatchId }: any) => {
					handledDispatchId = dispatchId;
					events.push(`notify:${payload.id}`);
				},
				options: { cron: "0 * * * *" },
			},
		};

		const queue = createQueueClient(jobs, adapter, {
			createContext: async () => ({ db: {} }),
			getApp: () => ({ name: "app" }),
		});

		await queue.listen({ gracefulShutdown: false, teamSize: 2, batchSize: 2 });
		expect(adapter.getScheduledJob("notify")?.cron).toBe("0 * * * *");

		const dispatchId = await queue.notify.publish({ id: "a" });
		await adapter.processAllJobs();
		expect(events).toEqual(["notify:a"]);
		expect(handledDispatchId).toBe(dispatchId);

		await queue.notify.publish({ id: "b" });
		await queue.notify.publish({ id: "c" });
		const result = await queue.runOnce({ batchSize: 1, jobs: ["notify"] });
		expect(result.processed).toBe(1);
		expect(events.length).toBe(2);

		await queue.stop();
	});

	test("job handler runs inside ambient AppContext (B1: ALS established)", async () => {
		const { getContext } = await import("../../src/server/config/context.js");
		const adapter = new MockQueueAdapter();
		const fakeApp = { name: "app" };
		let captured: any = null;
		let threw: unknown = null;

		const jobs = {
			capture: {
				name: "capture",
				schema: z.object({}).passthrough(),
				handler: async () => {
					// Reads the ambient AppContext (ALS). Before B1 this threw
					// ("called outside request scope") because the queue invoked the
					// handler without runWithContext.
					try {
						captured = getContext();
					} catch (err) {
						threw = err;
					}
				},
			},
		};

		const queue = createQueueClient(jobs, adapter, {
			createContext: async () => ({
				db: { tag: "db" },
				session: { userId: "u1" },
				locale: "sk",
			}),
			getApp: () => fakeApp,
		});

		await queue.capture.publish({});
		await queue.runOnce({ batchSize: 1, jobs: ["capture"] });

		expect(threw).toBeNull();
		expect(captured).not.toBeNull();
		expect(captured.app).toBe(fakeApp);
		expect(captured.db).toEqual({ tag: "db" });
		expect(captured.session).toEqual({ userId: "u1" });
		expect(captured.locale).toBe("sk");
		// Jobs are system scope — matches today's empty-ALS fallback.
		expect(captured.accessMode).toBe("system");

		await queue.stop();
	});

	test("cloudflare adapter retries poison messages toward platform DLQ", async () => {
		const published: any[] = [];
		const adapter = cloudflareQueuesAdapter({
			enqueue: async (message) => {
				published.push(message);
				return "msg-1";
			},
		});

		const dispatchId = "0e79a7d5-da2f-55e7-ae4c-3e95c5633071";
		await adapter.publish(
			"notify",
			{ id: "x" },
			{ idempotencyKey: "notify:one" },
			dispatchId,
		);
		expect(published[0]).toMatchObject({
			jobName: "notify",
			dispatchId,
			idempotencyKey: "notify:one",
		});

		const handled: string[] = [];
		const handledDispatches: Array<{
			dispatchId?: string;
			idempotencyKey?: string;
		}> = [];
		const errors: string[] = [];
		adapter.on("error", (error) => {
			errors.push(error.message);
		});

		const consumer = adapter.createPushConsumer({
			handlers: {
				notify: async (job) => {
					handled.push(String((job.data as any)?.id));
					handledDispatches.push({
						dispatchId: job.dispatchId,
						idempotencyKey: job.idempotencyKey,
					});
				},
				thrower: async () => {
					throw new Error("transient failure");
				},
			},
		});

		let acked = 0;
		let retried = 0;

		await consumer({
			messages: [
				{
					id: "1",
					body: { ...published[0], payload: { id: "ok" } },
					ack: async () => {
						acked += 1;
					},
					retry: async () => {
						retried += 1;
					},
				},
				{
					id: "2",
					body: { jobName: "missing", payload: { id: "nope" } },
					ack: async () => {
						acked += 1;
					},
					retry: async () => {
						retried += 1;
					},
				},
				{
					id: "3",
					body: "not-an-envelope",
					ack: async () => {
						acked += 1;
					},
					retry: async () => {
						retried += 1;
					},
				},
				{
					id: "4",
					body: { jobName: "thrower", payload: { id: "retry" } },
					ack: async () => {
						acked += 1;
					},
					retry: async () => {
						retried += 1;
					},
				},
			],
		});

		expect(handled).toEqual(["ok"]);
		expect(handledDispatches).toEqual([
			{ dispatchId, idempotencyKey: "notify:one" },
		]);
		expect(acked).toBe(1);
		expect(retried).toBe(3);
		expect(errors).toEqual([
			'CloudflareQueuesAdapter missing handler for job "missing".',
			"CloudflareQueuesAdapter failed to decode message envelope.",
			"transient failure",
		]);
	});

	test("cloudflare adapter publish notifies and rethrows enqueue errors", async () => {
		const adapter = cloudflareQueuesAdapter({
			enqueue: async () => {
				throw new Error("queue unavailable");
			},
		});
		const errors: string[] = [];
		adapter.on("error", (error) => {
			errors.push(error.message);
		});

		await expect(adapter.publish("notify", { id: "x" })).rejects.toThrow(
			"queue unavailable",
		);
		expect(errors).toEqual(["queue unavailable"]);
	});

	test("cloudflare adapter maps startAfter and retryDelay", async () => {
		const sent: any[] = [];
		const adapter = cloudflareQueuesAdapter({
			queue: {
				send: async (message, options) => {
					sent.push({ message, options });
				},
			},
		});

		await adapter.publish(
			"notify",
			{ id: "delayed" },
			{ startAfter: 30, retryDelay: 5 },
		);

		expect(sent).toHaveLength(1);
		expect(sent[0].options).toEqual({ delaySeconds: 30 });
		expect(sent[0].message.options).toMatchObject({ retryDelay: 5 });

		const retryCalls: any[] = [];
		const consumer = adapter.createPushConsumer({
			handlers: {
				notify: async () => {
					throw new Error("retry later");
				},
			},
		});

		await consumer({
			messages: [
				{
					id: "msg-1",
					attempts: 1,
					body: sent[0].message,
					ack: async () => {},
					retry: async (options) => {
						retryCalls.push(options);
					},
				},
			],
		});

		expect(retryCalls).toEqual([{ delaySeconds: 5 }]);
	});

	test("cloudflare adapter keeps exhausted failures observable for platform DLQ", async () => {
		const adapter = cloudflareQueuesAdapter({
			enqueue: async () => null,
		});

		const consumer = adapter.createPushConsumer({
			handlers: {
				notify: async () => {
					throw new Error("still failing");
				},
			},
		});

		let acked = 0;
		let retried = 0;
		const errors: string[] = [];
		adapter.on("error", (error) => errors.push(error.message));
		await consumer({
			messages: [
				{
					id: "msg-1",
					attempts: 2,
					body: {
						jobName: "notify",
						payload: {},
						options: { retryLimit: 1 },
					},
					ack: async () => {
						acked += 1;
					},
					retry: async () => {
						retried += 1;
					},
				},
			],
		});

		expect(acked).toBe(0);
		expect(retried).toBe(1);
		expect(errors).toEqual([
			"still failing",
			'CloudflareQueuesAdapter retryLimit reached for job "notify"; Cloudflare max_retries remains the terminal bound, so the message was retried for platform failure metrics or its configured DLQ.',
		]);
	});

	test("registerSchedules supports job selection by key and internal name", async () => {
		const adapter = new MockQueueAdapter();

		const jobs = {
			registrationA: {
				name: "internal-a",
				schema: z.object({}).passthrough(),
				handler: async () => {},
				options: { cron: "*/15 * * * *" },
			},
			registrationB: {
				name: "internal-b",
				schema: z.object({}).passthrough(),
				handler: async () => {},
				options: { cron: "0 * * * *" },
			},
		};

		const queue = createQueueClient(jobs, adapter, {
			createContext: async () => ({ db: {} }),
			getApp: () => ({ name: "app" }),
		});

		await queue.registerSchedules({ jobs: ["registrationA"] });
		expect(adapter.getScheduledJob("internal-a")?.cron).toBe("*/15 * * * *");
		expect(adapter.getScheduledJob("internal-b")).toBeUndefined();

		await queue.registerSchedules({ jobs: ["internal-b"] });
		expect(adapter.getScheduledJob("internal-b")?.cron).toBe("0 * * * *");
	});

	test("registerSchedules passes cron once and omits publish-only timing options", async () => {
		const adapter = new MockQueueAdapter();
		const queue = createQueueClient(
			{
				notify: {
					name: "notify",
					schema: z.object({}).passthrough(),
					handler: async () => {},
					options: {
						cron: "0 * * * *",
						startAfter: 30,
						retryLimit: 4,
					},
				},
			},
			adapter,
			{
				createContext: async () => ({ db: {} }),
				getApp: () => ({ name: "app" }),
			},
		);

		await queue.registerSchedules();

		expect(adapter.getScheduledJob("notify")).toMatchObject({
			cron: "0 * * * *",
			options: { retryLimit: 4 },
		});
		expect(adapter.getScheduledJob("notify")?.options).not.toHaveProperty(
			"cron",
		);
		expect(adapter.getScheduledJob("notify")?.options).not.toHaveProperty(
			"startAfter",
		);
	});

	test("queue exposes literal job name aliases", async () => {
		const adapter = new MockQueueAdapter();
		const queue = createQueueClient(
			{
				wfExecute: {
					name: "questpie-wf-execute",
					schema: z.object({ instanceId: z.string() }),
					handler: async () => {},
				},
			},
			adapter,
			{
				createContext: async () => ({ db: {} }),
				getApp: () => ({ name: "app" }),
			},
		);

		expect(queue["questpie-wf-execute"]).toBe(queue.wfExecute);

		await queue["questpie-wf-execute"].publish(
			{ instanceId: "wf-1" },
			{ singletonKey: "wf-1" },
		);

		expect(adapter.getJobs()[0]).toMatchObject({
			name: "questpie-wf-execute",
			payload: { instanceId: "wf-1" },
			options: { singletonKey: "wf-1" },
		});
	});

	test("throws clear errors when adapter mode is unsupported", async () => {
		class PublishOnlyAdapter implements QueueAdapter {
			capabilities = {
				longRunningConsumer: false,
				runOnceConsumer: false,
				pushConsumer: false,
				scheduling: false,
				singleton: false,
			} as const;

			async start(): Promise<void> {}
			async stop(): Promise<void> {}
			async publish(): Promise<string | null> {
				return "id";
			}
			async schedule(): Promise<void> {
				throw new Error("unsupported");
			}
			async unschedule(): Promise<void> {
				throw new Error("unsupported");
			}
			on(): void {}
		}

		const queue = createQueueClient(
			{
				notify: {
					name: "notify",
					schema: z.object({ id: z.string() }),
					handler: async () => {},
				},
			},
			new PublishOnlyAdapter(),
			{
				createContext: async () => ({ db: {} }),
				getApp: () => ({ name: "app" }),
			},
		);

		await expect(queue.listen({ gracefulShutdown: false })).rejects.toThrow(
			"does not support long-running listen() mode",
		);
		await expect(queue.runOnce({ batchSize: 1 })).rejects.toThrow(
			"does not support runOnce() mode",
		);
		expect(() => queue.createPushConsumer()).toThrow(
			"does not support push consumer mode",
		);
		await expect(
			queue.notify.schedule({ id: "x" }, "* * * * *"),
		).rejects.toThrow("does not support scheduling");
	});

	test("consumer execution fails without runtime context configuration", async () => {
		const adapter = new MockQueueAdapter();
		const queue = createQueueClient(
			{
				notify: {
					name: "notify",
					schema: z.object({ id: z.string() }),
					handler: async () => {},
				},
			},
			adapter,
		);

		await queue.notify.publish({ id: "missing-context" });
		await expect(queue.runOnce({ batchSize: 1 })).rejects.toThrow(
			"createContext is not configured",
		);
	});

	test("cloudflare adapter scheduling APIs fail explicitly", async () => {
		const adapter = cloudflareQueuesAdapter({
			enqueue: async () => null,
		});

		await expect(
			adapter.schedule("notify", "* * * * *", { id: "x" }),
		).rejects.toThrow("does not support cron scheduling");
		await expect(adapter.unschedule("notify")).rejects.toThrow(
			"does not support unschedule",
		);
	});

	test("queue createPushConsumer wires runtime context and handlers", async () => {
		const adapter = cloudflareQueuesAdapter({
			enqueue: async () => null,
		});

		const handled: string[] = [];
		const queue = createQueueClient(
			{
				notify: {
					name: "notify",
					schema: z.object({ id: z.string() }),
					handler: async ({ payload, app }: any) => {
						handled.push(`${payload.id}:${app.kind}`);
					},
				},
			},
			adapter,
			{
				createContext: async () => ({ db: {} }),
				getApp: () => ({ kind: "runtime" }),
			},
		);

		const consumer = queue.createPushConsumer();
		let acked = 0;

		await consumer({
			messages: [
				{
					id: "1",
					body: { jobName: "notify", payload: { id: "cf" } },
					ack: async () => {
						acked += 1;
					},
					retry: async () => {},
				},
			],
		});

		expect(acked).toBe(1);
		expect(handled).toEqual(["cf:runtime"]);
	});

	test("registerSchedules throws when cron schema does not accept empty payload", async () => {
		const queue = createQueueClient(
			{
				notify: {
					name: "notify",
					schema: z.object({ id: z.string() }),
					handler: async () => {},
					options: { cron: "0 * * * *" },
				},
			},
			new MockQueueAdapter(),
			{
				createContext: async () => ({ db: {} }),
				getApp: () => ({ name: "app" }),
			},
		);

		await expect(queue.registerSchedules()).rejects.toThrow(
			"has cron schedule but schema does not accept an empty payload",
		);
	});

	test("secret payloads fail closed without idempotency, root key, or terminal adapter metadata", async () => {
		const jobs = {
			notify: {
				name: "notify",
				schema: z.object({ secret: z.string() }),
				handler: async () => {},
			},
		};
		const mockAdapter = new MockQueueAdapter();
		const withoutRootKey = createQueueClient(jobs, mockAdapter, {
			getDatabase: () => ({}) as any,
		});

		await expect(
			withoutRootKey.notify.publish(
				{ secret: "value" },
				{ secretPayload: true },
			),
		).rejects.toThrow("require idempotencyKey");
		await expect(
			withoutRootKey.notify.publish(
				{ secret: "value" },
				{
					idempotencyKey: "notify:secret",
					secretPayload: true,
				},
			),
		).rejects.toThrow("runtimeConfig.secret with at least 32 bytes");
		expect(mockAdapter.getJobs()).toEqual([]);

		const published: unknown[] = [];
		const cloudflare = cloudflareQueuesAdapter({
			enqueue: async (message) => {
				published.push(message);
				return null;
			},
		});
		const withoutTerminalMetadata = createQueueClient(jobs, cloudflare, {
			getDatabase: () => ({}) as any,
			secret: "queue-secret-root-key-at-least-32-bytes",
		});
		await expect(
			withoutTerminalMetadata.notify.publish(
				{ secret: "value" },
				{
					idempotencyKey: "notify:cloudflare-secret",
					secretPayload: true,
				},
			),
		).rejects.toThrow(
			"cannot reconcile durable broker terminal execution state",
		);
		expect(published).toEqual([]);
	});
});
