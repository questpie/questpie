import { afterEach, describe, expect, it } from "bun:test";

import {
	RedisStreamsAdapter,
	type RedisStreamsClient,
} from "../../src/exports/adapters/redis-streams.js";
import type { RealtimeChangeEvent } from "../../src/exports/realtime.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { createTestDb, runTestDbMigrations } from "../utils/test-db.js";

type StreamMessage = {
	id: string;
	message: Record<string, string>;
};

class FakeRedisStream {
	private messages: StreamMessage[] = [];
	private waiters = new Set<{
		lastId: string;
		resolve: (value: unknown) => void;
	}>();
	private nextId = 1;
	public xAddOptions: unknown[] = [];
	public readFailures: unknown[] = [];

	get waiterCount(): number {
		return this.waiters.size;
	}

	createClient(): RedisStreamsClient {
		return {
			xAdd: async (_stream, _id, fields, options) => {
				this.xAddOptions.push(options);
				const message = {
					id: `${this.nextId++}-0`,
					message: fields,
				};
				this.messages.push(message);
				for (const waiter of this.waiters) {
					this.waiters.delete(waiter);
					waiter.resolve(this.response([message]));
				}
				return message.id;
			},
			xRead: async (streams, options) => {
				const failure = this.readFailures.shift();
				if (failure) throw failure;

				const lastId = streams[0]?.id ?? "$";
				const existing =
					lastId === "$"
						? []
						: this.messages.filter((message) => message.id > lastId);
				if (existing.length > 0) return this.response(existing);

				return new Promise((resolve) => {
					const waiter = { lastId, resolve };
					this.waiters.add(waiter);
					setTimeout(() => {
						if (!this.waiters.delete(waiter)) return;
						resolve(null);
					}, options?.BLOCK ?? 10);
				});
			},
		};
	}

	private response(messages: StreamMessage[]): unknown {
		return [{ name: "questpie:realtime", messages }];
	}
}

const change: RealtimeChangeEvent = {
	seq: 1,
	resourceType: "collection",
	resource: "posts",
	operation: "create",
	createdAt: new Date(),
};

describe("redis streams adapter", () => {
	const adapters: RedisStreamsAdapter[] = [];

	afterEach(async () => {
		await Promise.all(adapters.splice(0).map((adapter) => adapter.stop()));
	});

	it("wakes two realtime service instances from one published change", async () => {
		const redis = new FakeRedisStream();
		const firstAdapter = new RedisStreamsAdapter({
			client: redis.createClient(),
			blockMs: 10,
		});
		const secondAdapter = new RedisStreamsAdapter({
			client: redis.createClient(),
			blockMs: 10,
		});
		adapters.push(firstAdapter, secondAdapter);
		const db = await createTestDb();
		const first = await buildMockApp(
			{},
			{ db: { pglite: db }, realtime: { adapter: firstAdapter } },
		);
		const second = await buildMockApp(
			{},
			{ db: { pglite: db }, realtime: { adapter: secondAdapter } },
		);

		try {
			await runTestDbMigrations(first.app);
			const received = Promise.all([
				new Promise((resolve) =>
					first.app.realtime.subscribe(resolve, {
						resourceType: "collection",
						resource: "posts",
					}),
				),
				new Promise((resolve) =>
					second.app.realtime.subscribe(resolve, {
						resourceType: "collection",
						resource: "posts",
					}),
				),
			]);
			for (let attempt = 0; redis.waiterCount < 2 && attempt < 100; attempt++) {
				await new Promise((resolve) => setTimeout(resolve, 1));
			}
			expect(redis.waiterCount).toBe(2);

			const event = await first.app.realtime.appendChange(change);
			await first.app.realtime.notify(event);

			expect(await received).toEqual([
				expect.objectContaining({ seq: event.seq, resource: "posts" }),
				expect.objectContaining({ seq: event.seq, resource: "posts" }),
			]);
		} finally {
			await Promise.all([first.cleanup(), second.cleanup()]);
			await db.close();
		}
	});

	it("broadcasts one wake to every subscribed instance", async () => {
		const redis = new FakeRedisStream();
		const first = new RedisStreamsAdapter({
			client: redis.createClient(),
			blockMs: 10,
		});
		const second = new RedisStreamsAdapter({
			client: redis.createClient(),
			blockMs: 10,
		});
		adapters.push(first, second);

		const received = Promise.all([
			new Promise((resolve) => first.subscribe(resolve)),
			new Promise((resolve) => second.subscribe(resolve)),
		]);
		await Promise.all([first.start(), second.start()]);

		await first.notify(change);

		expect(await received).toEqual([
			expect.objectContaining({ seq: 1, resource: "posts" }),
			expect.objectContaining({ seq: 1, resource: "posts" }),
		]);
		expect(redis.xAddOptions).toEqual([
			{
				TRIM: {
					strategy: "MAXLEN",
					strategyModifier: "~",
					threshold: 10_000,
				},
			},
		]);
	});

	it("logs a read failure, backs off, and resumes the per-instance tail", async () => {
		const redis = new FakeRedisStream();
		const readFailure = new Error("redis read failed");
		redis.readFailures.push(readFailure);
		const errors: unknown[] = [];
		const adapter = new RedisStreamsAdapter({
			client: redis.createClient(),
			blockMs: 10,
			retryDelayMs: 1,
			onError: (error) => errors.push(error),
		});
		adapters.push(adapter);

		const received = new Promise((resolve) => adapter.subscribe(resolve));
		await adapter.start();
		await new Promise((resolve) => setTimeout(resolve, 5));
		await adapter.notify(change);

		expect(await received).toMatchObject({ seq: 1, resource: "posts" });
		expect(errors).toEqual([readFailure]);
	});

	it("duplicates node-redis clients so blocking reads never hold the publisher", async () => {
		const redis = new FakeRedisStream();
		const publisher = redis.createClient();
		const reader = redis.createClient();
		let publisherReads = 0;
		let readerConnects = 0;
		let readerDestroys = 0;
		publisher.xRead = async () => {
			publisherReads += 1;
			return null;
		};
		publisher.duplicate = () => ({
			...reader,
			connect: async () => {
				readerConnects += 1;
			},
			destroy: () => {
				readerDestroys += 1;
			},
		});
		const adapter = new RedisStreamsAdapter({ client: publisher, blockMs: 10 });
		adapters.push(adapter);

		const received = new Promise((resolve) => adapter.subscribe(resolve));
		await adapter.start();
		await adapter.notify(change);

		expect(await received).toMatchObject({ seq: 1, resource: "posts" });
		expect(publisherReads).toBe(0);
		expect(readerConnects).toBe(1);
		await adapter.stop();
		expect(readerDestroys).toBe(1);
	});

	it("waits for the blocking read to exit before restarting", async () => {
		const releases: Array<() => void> = [];
		let activeReads = 0;
		let maxActiveReads = 0;
		const client: RedisStreamsClient = {
			xAdd: async () => "1-0",
			xRead: async () => {
				activeReads += 1;
				maxActiveReads = Math.max(maxActiveReads, activeReads);
				return new Promise((resolve) => {
					releases.push(() => {
						activeReads -= 1;
						resolve(null);
					});
				});
			},
		};
		const adapter = new RedisStreamsAdapter({ client });
		adapters.push(adapter);

		await adapter.start();
		expect(activeReads).toBe(1);
		let stopped = false;
		const stopping = adapter.stop().then(() => {
			stopped = true;
		});
		const restarting = adapter.start();
		await Promise.resolve();
		expect(stopped).toBe(false);
		expect(activeReads).toBe(1);

		releases.shift()?.();
		await stopping;
		await restarting;
		expect(activeReads).toBe(1);
		expect(maxActiveReads).toBe(1);

		const finalStop = adapter.stop();
		releases.shift()?.();
		await finalStop;
	});
});
