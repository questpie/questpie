import { afterEach, describe, expect, test } from "bun:test";

import { createClient, type RedisClientType } from "redis";

import { PgNotifyChangeBroker } from "../../src/server/modules/core/integrated/realtime/adapters/pg-notify.js";
import {
	RedisStreamsChangeBroker,
	type RedisStreamsClient,
} from "../../src/server/modules/core/integrated/realtime/adapters/redis-streams.js";
import type {
	ChangeBroker,
	ChangeWake,
} from "../../src/server/modules/core/integrated/realtime/transport.js";

const runDrivers = process.env.QUESTPIE_REALTIME_DRIVER_INTEGRATION === "1";
const postgresUrl =
	process.env.QUESTPIE_REALTIME_POSTGRES_URL ??
	"postgresql://questpie:questpie@127.0.0.1:54329/questpie_realtime";
const redisUrl =
	process.env.QUESTPIE_REALTIME_REDIS_URL ?? "redis://127.0.0.1:6379";

const wakes: ChangeWake[] = [
	{
		kind: "outbox-maybe-advanced",
		highWaterSeq: 41,
		reason: "publish",
	},
	{
		kind: "outbox-maybe-advanced",
		highWaterSeq: 42,
		reason: "publish",
	},
];

function timeout<T>(promise: Promise<T>, message: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(message)), 10_000),
		),
	]);
}

async function startAndReceive(
	broker: ChangeBroker,
	count: number,
): Promise<{ result: Promise<ChangeWake[]> }> {
	let resolve!: (wakes: ChangeWake[]) => void;
	let reject!: (error: unknown) => void;
	const result = new Promise<ChangeWake[]>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	const received: ChangeWake[] = [];
	await broker.start({
		onWake: (wake) => {
			received.push(wake);
			if (received.length === count) resolve(received);
		},
		onError: reject,
	});
	return { result };
}

describe.skipIf(!runDrivers)("realtime ChangeBroker driver matrix", () => {
	const brokers: ChangeBroker[] = [];
	const redisClients: RedisClientType[] = [];

	afterEach(async () => {
		await Promise.allSettled(brokers.splice(0).map((broker) => broker.stop()));
		await Promise.allSettled(
			redisClients.splice(0).map(async (client) => {
				if (client.isOpen) await client.quit();
			}),
		);
	});

	test("Postgres broadcasts every wake to every broker instance", async () => {
		const channel = `questpie_rt_${crypto.randomUUID().replaceAll("-", "")}`;
		const first = new PgNotifyChangeBroker({
			connectionString: postgresUrl,
			channel,
		});
		const second = new PgNotifyChangeBroker({
			connectionString: postgresUrl,
			channel,
		});
		brokers.push(first, second);
		const receivers = await Promise.all([
			startAndReceive(first, wakes.length),
			startAndReceive(second, wakes.length),
		]);
		for (const wake of wakes) await first.publish(wake);

		expect(
			await timeout(
				Promise.all(receivers.map(({ result }) => result)),
				"pg-notify matrix delivery timed out",
			),
		).toEqual([wakes, wakes]);
	});

	test("Redis Streams broadcasts every wake to every broker instance", async () => {
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
		const first = new RedisStreamsChangeBroker({
			client: clients[0] as unknown as RedisStreamsClient,
			stream,
			blockMs: 100,
		});
		const second = new RedisStreamsChangeBroker({
			client: clients[1] as unknown as RedisStreamsClient,
			stream,
			blockMs: 100,
		});
		brokers.push(first, second);
		const receivers = await Promise.all([
			startAndReceive(first, wakes.length),
			startAndReceive(second, wakes.length),
		]);
		for (const wake of wakes) await first.publish(wake);

		expect(
			await timeout(
				Promise.all(receivers.map(({ result }) => result)),
				"redis streams matrix delivery timed out",
			),
		).toEqual([wakes, wakes]);
	});
});
