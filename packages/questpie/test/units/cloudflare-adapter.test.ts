import { describe, expect, test } from "bun:test";

import { memory } from "files-sdk/memory";
import { z } from "zod";

import {
	cloudflareKVAdapter,
	cloudflareQueuesAdapter,
	createCloudflareFetchHandler,
	createCloudflareQueueHandler,
	createCloudflareScheduledHandler,
	publishScheduledJobs,
	toCloudflareQueuePushBatch,
	type CloudflareQueueBatch,
	type CloudflareKVNamespace,
} from "../../src/exports/adapters/cloudflare.js";

const kvNamespace: CloudflareKVNamespace = {
	async get() {
		return null;
	},
	async put() {},
	async delete() {},
	async list() {
		return { keys: [], list_complete: true };
	},
};

function createApp(queueOverrides: Record<string, unknown> = {}) {
	const queueAdapter = cloudflareQueuesAdapter({
		queue: { send: async () => undefined },
	});

	return {
		config: {
			app: { url: "https://example.com" },
			db: { create: () => ({ marker: "drizzle" }) },
			collections: {},
			storage: { adapter: memory() },
			queue: {
				jobs: {
					dailyDigest: {
						name: "daily-digest",
						schema: z.object({}),
						handler: async () => {},
						options: { cron: "0 8 * * *" },
					},
				},
				adapter: queueAdapter,
			},
			kv: {
				adapter: cloudflareKVAdapter({ namespace: kvNamespace }),
			},
		},
		queue: {
			createPushConsumer: () => async () => {},
			...queueOverrides,
		},
	};
}

describe("Cloudflare adapter helpers", () => {
	test("normalizes Cloudflare queue batches", async () => {
		let acked = 0;
		let retried = 0;

		const batch = toCloudflareQueuePushBatch({
			messages: [
				{
					id: "msg_1",
					body: { jobName: "daily-digest", payload: {} },
					ack: () => {
						acked += 1;
					},
					retry: () => {
						retried += 1;
					},
				},
			],
		});

		await batch.messages[0]!.ack();
		await batch.messages[0]!.retry();

		expect(batch.messages[0]).toMatchObject({
			id: "msg_1",
			body: { jobName: "daily-digest", payload: {} },
		});
		expect(acked).toBe(1);
		expect(retried).toBe(1);
	});

	test("queue handler delegates to app queue push consumer", async () => {
		let received: CloudflareQueueBatch | undefined;
		const app = createApp({
			createPushConsumer: () => async (batch: any) => {
				received = batch.raw;
			},
		});

		const handler = createCloudflareQueueHandler(app as any);
		const batch = {
			messages: [
				{
					id: "msg_1",
					body: { jobName: "daily-digest", payload: {} },
					ack: async () => {},
					retry: async () => {},
				},
			],
		};

		await handler(batch);

		expect(received).toBe(batch);
	});

	test("scheduled handler publishes jobs matching the Cloudflare cron", async () => {
		const published: unknown[] = [];
		const app = createApp({
			dailyDigest: {
				publish: async (payload: unknown) => {
					published.push(payload);
					return "job_1";
				},
			},
		});

		expect(await publishScheduledJobs(app as any, "0 8 * * *")).toBe(1);
		expect(await publishScheduledJobs(app as any, "0 9 * * *")).toBe(0);

		await createCloudflareScheduledHandler(app as any)({ cron: "0 8 * * *" });

		expect(published).toEqual([{}, {}]);
	});

	test("Cloudflare queue adapter can publish through a Queues binding", async () => {
		const sent: unknown[] = [];
		const adapter = cloudflareQueuesAdapter({
			queue: {
				send: async (message) => {
					sent.push(message);
				},
			},
		});

		await expect(adapter.publish("daily-digest", {})).resolves.toBeNull();
		expect(sent).toEqual([{ jobName: "daily-digest", payload: {} }]);
	});

	test("Cloudflare queue and KV adapters accept lazy runtime binding providers", async () => {
		const sent: unknown[] = [];
		const queue = cloudflareQueuesAdapter({
			queue: async () => ({
				send: async (message) => {
					sent.push(message);
				},
			}),
		});
		const kv = cloudflareKVAdapter({ namespace: async () => kvNamespace });

		await queue.publish("daily-digest", {});
		await kv.set("cache-key", { ok: true });

		expect(sent).toEqual([{ jobName: "daily-digest", payload: {} }]);
	});

	test("fetch handler returns 404 when request misses basePath", async () => {
		const handler = createCloudflareFetchHandler(createApp() as any, {
			basePath: "/api",
		});

		const response = await handler(new Request("https://example.com/health"));

		expect(response.status).toBe(404);
	});

	test("fetch handler delegates basePath misses to fallback", async () => {
		const handler = createCloudflareFetchHandler(createApp() as any, {
			basePath: "/api",
			fallback: () => new Response("frontend", { status: 200 }),
		});

		const response = await handler(new Request("https://example.com/"));

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("frontend");
	});
});
