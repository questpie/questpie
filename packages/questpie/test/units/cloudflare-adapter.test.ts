import { describe, expect, test } from "bun:test";

import { memory } from "files-sdk/memory";
import { z } from "zod";

import {
	cloudflareKVAdapter,
	cloudflareQueuesAdapter,
	cloudflareRealtimeAdapter,
	createCloudflareFetchHandler,
	createCloudflareQueueHandler,
	createCloudflareRealtimeDurableObjectHandler,
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

function createDurableObjectNamespace() {
	const requests: Request[] = [];
	const objectNames: string[] = [];
	const namespace = {
		requests,
		objectNames,
		idFromName: (name: string) => ({ name }),
		get: (id: { name: string }) => ({
			fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
				objectNames.push(id.name);
				const request =
					input instanceof Request ? input : new Request(input, init);
				requests.push(request);
				return new Response(null, { status: 204 });
			},
		}),
	};
	return namespace;
}

function createApp(queueOverrides: Record<string, unknown> = {}) {
	const durableObjects = createDurableObjectNamespace();
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
			realtime: {
				adapter: cloudflareRealtimeAdapter({ namespace: durableObjects }),
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

	test("Cloudflare adapters accept lazy runtime binding providers", async () => {
		const sent: unknown[] = [];
		const scheduled: Promise<unknown>[] = [];
		const durableObjects = createDurableObjectNamespace();
		const queue = cloudflareQueuesAdapter({
			queue: async () => ({
				send: async (message) => {
					sent.push(message);
				},
			}),
		});
		const kv = cloudflareKVAdapter({ namespace: async () => kvNamespace });
		const realtime = cloudflareRealtimeAdapter({
			namespace: async () => durableObjects,
			waitUntil: (promise) => scheduled.push(promise),
		});

		await queue.publish("daily-digest", {});
		await kv.set("cache-key", { ok: true });
		await realtime.notify({
			seq: 1,
			resourceType: "collection",
			resource: "posts",
			operation: "update",
			createdAt: new Date(),
		});
		await Promise.all(scheduled);

		expect(sent).toEqual([{ jobName: "daily-digest", payload: {} }]);
		expect(
			durableObjects.requests.map((request) => new URL(request.url).pathname),
		).toEqual(["/__questpie/realtime/notify"]);
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

	test("Cloudflare realtime adapter proxies notify and subscribe to Durable Object", async () => {
		const durableObjects = createDurableObjectNamespace();
		const scheduled: Promise<unknown>[] = [];
		const adapter = cloudflareRealtimeAdapter({
			namespace: durableObjects,
			waitUntil: (promise) => scheduled.push(promise),
		});

		await adapter.notify({
			seq: 1,
			resourceType: "collection",
			resource: "posts",
			operation: "create",
			createdAt: new Date(),
		});
		await Promise.all(scheduled);
		await adapter.fetch(
			new Request("https://example.com/api/realtime", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					topics: [
						{
							id: "posts-list",
							resourceType: "collection",
							resource: "posts",
						},
					],
				}),
			}),
		);

		expect(durableObjects.objectNames).toEqual([
			"questpie-realtime:collection:posts",
			"questpie-realtime:collection:posts",
		]);
		expect(
			durableObjects.requests.map((request) => new URL(request.url).pathname),
		).toEqual([
			"/__questpie/realtime/notify",
			"/__questpie/realtime/subscribe",
		]);
	});

	test("Cloudflare realtime publishes notice-only payloads to resource shards", async () => {
		const durableObjects = createDurableObjectNamespace();
		const scheduled: Promise<unknown>[] = [];
		const adapter = cloudflareRealtimeAdapter({
			namespace: durableObjects,
			waitUntil: (promise) => scheduled.push(promise),
		});

		await adapter.notify({
			seq: 7,
			resourceType: "collection",
			resource: "posts",
			operation: "update",
			recordId: "post-1",
			locale: "sk",
			payload: { id: "post-1", title: "Never broadcast this row" },
			createdAt: new Date("2026-07-13T20:00:00.000Z"),
		});
		await scheduled[0];

		expect(durableObjects.objectNames).toEqual([
			"questpie-realtime:collection:posts",
		]);
		expect(await durableObjects.requests[0]!.json()).toEqual({
			seq: 7,
			resourceType: "collection",
			resource: "posts",
			operation: "update",
		});
	});

	test("Cloudflare realtime schedules notify with waitUntil and reports failures", async () => {
		let resolveFetch = (_response: Response) => {};
		const fetchResult = new Promise<Response>((resolve) => {
			resolveFetch = resolve;
		});
		const scheduled: Promise<unknown>[] = [];
		const errors: unknown[] = [];
		const adapter = cloudflareRealtimeAdapter({
			namespace: {
				idFromName: (name: string) => ({ name }),
				get: () => ({ fetch: () => fetchResult }),
			},
			waitUntil: (promise: Promise<unknown>) => scheduled.push(promise),
			onError: (error: unknown) => errors.push(error),
		});

		let notifyResolved = false;
		const notifyResult = adapter
			.notify({
				seq: 8,
				resourceType: "collection",
				resource: "posts",
				operation: "create",
				createdAt: new Date("2026-07-13T20:00:00.000Z"),
			})
			.then(() => {
				notifyResolved = true;
			});
		await Promise.resolve();
		await Promise.resolve();

		try {
			expect(notifyResolved).toBe(true);
			expect(scheduled).toHaveLength(1);
		} finally {
			resolveFetch(new Response(null, { status: 503 }));
			await notifyResult.catch(() => {});
		}

		await scheduled[0];
		expect(errors).toHaveLength(1);
		expect(String(errors[0])).toContain(
			"CloudflareRealtimeAdapter notify failed with 503",
		);
	});

	test("Cloudflare Durable Object is a notice-only fan-out hub", async () => {
		const handler = createCloudflareRealtimeDurableObjectHandler(
			createApp() as any,
		);
		const subscription = await handler(
			new Request("https://questpie.internal/__questpie/realtime/subscribe", {
				method: "POST",
			}),
		);

		expect(subscription.status).toBe(200);
		expect(subscription.headers.get("Content-Type")).toBe(
			"application/x-ndjson",
		);

		const reader = subscription.body!.getReader();
		const nextNotice = reader.read();
		const notice = {
			seq: 9,
			resourceType: "collection",
			resource: "posts",
			operation: "delete",
		} as const;
		const notified = await handler(
			new Request("https://questpie.internal/__questpie/realtime/notify", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(notice),
			}),
		);

		expect(notified.status).toBe(204);
		const chunk = await nextNotice;
		expect(new TextDecoder().decode(chunk.value)).toBe(
			`${JSON.stringify(notice)}\n`,
		);
		await reader.cancel();
	});

	test("Cloudflare Worker relay connects resource shards and delivers notices", async () => {
		const objectNames: string[] = [];
		const namespace = {
			idFromName: (name: string) => ({ name }),
			get: (id: { name: string }) => ({
				fetch: async () => {
					objectNames.push(id.name);
					const [, resourceType, resource] = id.name.split(":");
					const notice = {
						seq: objectNames.length,
						resourceType,
						resource,
						operation: "update",
					};
					return new Response(`${JSON.stringify(notice)}\n`, {
						headers: { "Content-Type": "application/x-ndjson" },
					});
				},
			}),
		};
		const adapter = cloudflareRealtimeAdapter({ namespace });
		const delivered: unknown[] = [];
		adapter.subscribe((notice) => delivered.push(notice));

		const connection = adapter.connect([
			{ resourceType: "collection", resource: "posts" },
			{ resourceType: "collection", resource: "posts" },
			{ resourceType: "global", resource: "settings" },
		]);
		await connection.done;

		expect(objectNames).toEqual([
			"questpie-realtime:collection:posts",
			"questpie-realtime:global:settings",
		]);
		expect(delivered).toEqual([
			{
				seq: 1,
				resourceType: "collection",
				resource: "posts",
				operation: "update",
			},
			{
				seq: 2,
				resourceType: "global",
				resource: "settings",
				operation: "update",
			},
		]);
	});
});
