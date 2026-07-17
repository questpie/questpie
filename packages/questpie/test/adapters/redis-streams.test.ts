import { afterEach, describe, expect, it } from "bun:test";

import {
	RedisStreamsChangeBroker,
	type RedisStreamsClient,
} from "../../src/exports/adapters/redis-streams.js";
import type {
	ChangeWake,
	RealtimeChangeEvent,
} from "../../src/exports/realtime.js";
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

	get waiterCount(): number {
		return this.waiters.size;
	}

	createClient(): RedisStreamsClient {
		return {
			xAdd: async (_stream, _id, fields) => {
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

describe("redis streams change broker", () => {
	const brokers: RedisStreamsChangeBroker[] = [];

	afterEach(async () => {
		await Promise.all(brokers.splice(0).map((broker) => broker.stop()));
	});

	it("fans metadata-only topology wakes out to every instance", async () => {
		const redis = new FakeRedisStream();
		const first = new RedisStreamsChangeBroker({
			client: redis.createClient(),
			blockMs: 10,
		});
		const second = new RedisStreamsChangeBroker({
			client: redis.createClient(),
			blockMs: 10,
		});
		brokers.push(first, second);
		const received: ChangeWake[] = [];
		const wake: ChangeWake = {
			kind: "topology-maybe-advanced",
			sessionKey: "hashed-session",
			ownerId: "owner-one",
			ownerGeneration: 3,
			desiredRevision: 4,
			reason: "submit",
		};

		await Promise.all([
			first.start({
				onWake: (value) => received.push(value),
				onError: () => {},
			}),
			second.start({
				onWake: (value) => received.push(value),
				onError: () => {},
			}),
		]);
		await first.publish(wake);

		for (let attempt = 0; received.length < 2 && attempt < 100; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 1));
		}
		expect(received).toEqual([wake, wake]);
	});

	it("drives the v2 service seam across two app instances", async () => {
		const redis = new FakeRedisStream();
		const firstBroker = new RedisStreamsChangeBroker({
			client: redis.createClient(),
			blockMs: 10,
		});
		const secondBroker = new RedisStreamsChangeBroker({
			client: redis.createClient(),
			blockMs: 10,
		});
		brokers.push(firstBroker, secondBroker);
		const db = await createTestDb();
		const first = await buildMockApp(
			{},
			{ db: { pglite: db }, realtime: { changeBroker: firstBroker } },
		);
		const second = await buildMockApp(
			{},
			{ db: { pglite: db }, realtime: { changeBroker: secondBroker } },
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
	}, 10_000);
});
