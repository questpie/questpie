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

		const jobs = {
			notify: {
				name: "notify",
				schema: z.object({ id: z.string().optional() }),
				handler: async ({ payload }: any) => {
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

		await queue.notify.publish({ id: "a" });
		await adapter.processAllJobs();
		expect(events).toEqual(["notify:a"]);

		await queue.notify.publish({ id: "b" });
		await queue.notify.publish({ id: "c" });
		const result = await queue.runOnce({ batchSize: 1, jobs: ["notify"] });
		expect(result.processed).toBe(1);
		expect(events.length).toBe(2);

		await queue.stop();
	});

	test("cloudflare adapter push consumer acks permanent failures and retries handler errors", async () => {
		const published: any[] = [];
		const adapter = cloudflareQueuesAdapter({
			enqueue: async (message) => {
				published.push(message);
				return "msg-1";
			},
		});

		await adapter.publish("notify", { id: "x" });
		expect(published[0]?.jobName).toBe("notify");

		const handled: string[] = [];
		const errors: string[] = [];
		adapter.on("error", (error) => {
			errors.push(error.message);
		});

		const consumer = adapter.createPushConsumer({
			handlers: {
				notify: async (job) => {
					handled.push(String((job.data as any)?.id));
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
					body: { jobName: "notify", payload: { id: "ok" } },
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
		expect(acked).toBe(3);
		expect(retried).toBe(1);
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

	test("cloudflare adapter acks handler failures after retryLimit", async () => {
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

		expect(acked).toBe(1);
		expect(retried).toBe(0);
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
});
