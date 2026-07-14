import { afterEach, describe, expect, test } from "bun:test";

import { createClient, type RedisClientType } from "redis";

import type { RealtimeAdapter } from "../../src/server/modules/core/integrated/realtime/adapter.js";
import { PgNotifyAdapter } from "../../src/server/modules/core/integrated/realtime/adapters/pg-notify.js";
import {
	RedisStreamsAdapter,
	type RedisStreamsClient,
} from "../../src/server/modules/core/integrated/realtime/adapters/redis-streams.js";
import type {
	RealtimeChangeEvent,
	RealtimeNotice,
} from "../../src/server/modules/core/integrated/realtime/types.js";

const runDrivers = process.env.QUESTPIE_REALTIME_DRIVER_INTEGRATION === "1";
const postgresUrl =
	process.env.QUESTPIE_REALTIME_POSTGRES_URL ??
	"postgresql://questpie:questpie@127.0.0.1:54329/questpie_realtime";
const redisUrl =
	process.env.QUESTPIE_REALTIME_REDIS_URL ?? "redis://127.0.0.1:6379";

const changes: RealtimeChangeEvent[] = [
	{
		seq: 41,
		resourceType: "collection",
		resource: "posts",
		operation: "update",
		createdAt: new Date(),
	},
	{
		seq: 42,
		resourceType: "global",
		resource: "siteSettings",
		operation: "update",
		createdAt: new Date(),
	},
];
const expectedNotices = changes.map(
	({ seq, resourceType, resource, operation }) => ({
		seq,
		resourceType,
		resource,
		operation,
	}),
);

function timeout<T>(promise: Promise<T>, message: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(message)), 10_000),
		),
	]);
}

function receive(
	adapter: RealtimeAdapter,
	count: number,
): Promise<RealtimeNotice[]> {
	return new Promise((resolve) => {
		const notices: RealtimeNotice[] = [];
		const unsubscribe = adapter.subscribe((notice) => {
			notices.push(notice);
			if (notices.length !== count) return;
			unsubscribe();
			resolve(notices);
		});
	});
}

describe.skipIf(!runDrivers)("realtime driver matrix services", () => {
	const adapters: RealtimeAdapter[] = [];
	const redisClients: RedisClientType[] = [];

	afterEach(async () => {
		await Promise.allSettled(
			adapters.splice(0).map((adapter) => adapter.stop()),
		);
		await Promise.allSettled(
			redisClients.splice(0).map(async (client) => {
				if (client.isOpen) await client.quit();
			}),
		);
	});

	test("SSE/pg-notify broadcasts collection and global wakes to every instance", async () => {
		const channel = `questpie_rt_${crypto.randomUUID().replaceAll("-", "")}`;
		const first = new PgNotifyAdapter({
			connectionString: postgresUrl,
			channel,
		});
		const second = new PgNotifyAdapter({
			connectionString: postgresUrl,
			channel,
		});
		adapters.push(first, second);
		const received = [
			receive(first, changes.length),
			receive(second, changes.length),
		];

		await Promise.all([first.start(), second.start()]);
		await Promise.all([first.startPublisher(), second.startPublisher()]);
		for (const change of changes) await first.notify(change);

		const notices = await timeout(
			Promise.all(received),
			"pg-notify matrix delivery timed out",
		);
		expect(notices).toEqual([expectedNotices, expectedNotices]);
	});

	test("SSE/redis streams broadcasts collection and global wakes to every instance", async () => {
		const stream = `questpie:realtime:${crypto.randomUUID()}`;
		const clients = [
			createClient({ url: redisUrl }),
			createClient({ url: redisUrl }),
		];
		redisClients.push(...clients);
		for (const client of clients) {
			client.on("error", () => {});
			await client.connect();
		}
		const first = new RedisStreamsAdapter({
			client: clients[0] as unknown as RedisStreamsClient,
			stream,
			blockMs: 100,
		});
		const second = new RedisStreamsAdapter({
			client: clients[1] as unknown as RedisStreamsClient,
			stream,
			blockMs: 100,
		});
		adapters.push(first, second);
		const received = [
			receive(first, changes.length),
			receive(second, changes.length),
		];

		await Promise.all([first.start(), second.start()]);
		await new Promise((resolve) => setTimeout(resolve, 150));
		for (const change of changes) await first.notify(change);

		const notices = await timeout(
			Promise.all(received),
			"Redis matrix delivery timed out",
		);
		expect(notices).toEqual([expectedNotices, expectedNotices]);
	});
});
