import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { cloudflareQueuesAdapter } from "../../src/server/integrated/queue/adapters/cloudflare-queues.js";
import { createQueueClient } from "../../src/server/integrated/queue/service.js";
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

	test("cloudflare adapter push consumer handles ack and retry", async () => {
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
			],
		});

		expect(handled).toEqual(["ok"]);
		expect(acked).toBe(1);
		expect(retried).toBe(1);
		expect(errors.length).toBe(1);
	});
});
