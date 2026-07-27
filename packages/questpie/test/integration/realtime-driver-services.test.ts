import { afterEach, describe, expect, test } from "bun:test";

import { SQL } from "bun";
import { sql } from "drizzle-orm";
import { Client as PgClient } from "pg";
import { createClient, type RedisClientType } from "redis";

import { collection } from "../../src/exports/index.js";
import { PgNotifyChangeBroker } from "../../src/server/modules/core/integrated/realtime/adapters/pg-notify.js";
import {
	RedisStreamsChangeBroker,
	type RedisStreamsClient,
} from "../../src/server/modules/core/integrated/realtime/adapters/redis-streams.js";
import { questpieChannelEventTable } from "../../src/server/modules/core/integrated/realtime/collection.js";
import type {
	ChangeBroker,
	ChangeWake,
} from "../../src/server/modules/core/integrated/realtime/transport.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { createTestContext } from "../utils/test-context.js";
import { runTestDbMigrations } from "../utils/test-db.js";

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

	test("Postgres reconnects LISTEN after its backend is terminated", async () => {
		const channel = `questpie_rt_${crypto.randomUUID().replaceAll("-", "")}`;
		const applicationName = `questpie_rt_listener_${crypto.randomUUID()}`;
		const states: string[] = [];
		const errors: unknown[] = [];
		let connectedCount = 0;
		let resolveReconnected!: () => void;
		const reconnected = new Promise<void>((resolve) => {
			resolveReconnected = resolve;
		});
		let resolveWake!: (wake: ChangeWake) => void;
		const received = new Promise<ChangeWake>((resolve) => {
			resolveWake = resolve;
		});
		const broker = new PgNotifyChangeBroker({
			connection: {
				connectionString: postgresUrl,
				application_name: applicationName,
			},
			channel,
			reconnectInitialDelayMs: 10,
			reconnectMaxDelayMs: 50,
		});
		brokers.push(broker);
		await broker.start({
			onWake: resolveWake,
			onError: (error) => errors.push(error),
			onStateChange: (state) => {
				states.push(state);
				if (state === "connected" && ++connectedCount === 2) {
					resolveReconnected();
				}
			},
		});

		const admin = new PgClient({ connectionString: postgresUrl });
		await admin.connect();
		try {
			const result = await admin.query<{ pid: number }>(
				"select pid from pg_stat_activity where application_name = $1 and pid <> pg_backend_pid()",
				[applicationName],
			);
			expect(result.rows).toHaveLength(1);
			await admin.query("select pg_terminate_backend($1)", [
				result.rows[0]!.pid,
			]);
			await timeout(reconnected, "pg-notify LISTEN reconnect timed out");

			await broker.publish(wakes[0]!);
			expect(
				await timeout(received, "pg-notify delivery after reconnect timed out"),
			).toEqual(wakes[0]);
			expect(states).toContain("unavailable");
			expect(errors.length).toBeGreaterThanOrEqual(1);
		} finally {
			await admin.end();
		}
	}, 20_000);

	test("Bun SQL create reaches a service subscriber through pg-notify", async () => {
		const schemaName = `questpie_rt_${crypto.randomUUID().replaceAll("-", "")}`;
		const admin = new SQL(postgresUrl);
		await admin.unsafe("create extension if not exists pg_trgm");
		await admin.unsafe(`create schema "${schemaName}"`);
		const scopedUrl = new URL(postgresUrl);
		scopedUrl.searchParams.set("options", `-csearch_path=${schemaName},public`);
		let setup: Awaited<ReturnType<typeof buildMockApp>> | undefined;

		try {
			const posts = collection("posts")
				.fields(({ f }) => ({ title: f.text().required() }))
				.access({ read: true });
			let resolveConnected!: () => void;
			const connected = new Promise<void>((resolve) => {
				resolveConnected = resolve;
			});
			setup = await buildMockApp(
				{ collections: { posts } },
				{
					db: { url: scopedUrl.toString() },
					realtime: {
						observer: {
							record: (event) => {
								if (
									event.type === "broker.lifecycle" &&
									event.state === "connected"
								) {
									resolveConnected();
								}
							},
						},
					},
				},
			);
			await runTestDbMigrations(setup.app);
			const delivered = new Promise((resolve) => {
				setup!.app.realtime.subscribe(resolve, {
					resourceType: "collection",
					resource: "posts",
					where: { title: "Real pg-notify" },
				});
			});
			await timeout(connected, "service pg-notify startup timed out");

			const created = await setup.app.collections.posts.create(
				{ title: "Real pg-notify" },
				createTestContext({ accessMode: "system" }),
			);
			expect(
				await timeout(delivered, "service create-to-push timed out"),
			).toMatchObject({
				operation: "create",
				recordId: created.id,
				resource: "posts",
			});
			const raw = await setup.app.db.execute(
				sql`select jsonb_typeof(payload) as payload_type, payload from questpie_realtime_log order by seq desc limit 1`,
			);
			const row = (raw.rows ?? raw)[0];
			expect(row.payload_type).toBe("object");
			expect(row.payload).toBeObject();
			await setup.app.db.insert(questpieChannelEventTable).values({
				channelHash: "channel-hash",
				seq: 1,
				eventId: "event-id",
				channel: "room-1",
				event: "message",
				schemaIdentity: "message-v1",
				payload: "hello",
				wireJson: JSON.stringify({
					eventId: "event-id",
					event: "message",
					data: "hello",
				}),
				sizeBytes: 7,
			});
			const channelRaw = await setup.app.db.execute(
				sql`select jsonb_typeof(payload) as payload_type, payload from questpie_channel_event limit 1`,
			);
			const channelRow = (channelRaw.rows ?? channelRaw)[0];
			expect(channelRow).toMatchObject({
				payload_type: "string",
				payload: "hello",
			});
			const scalarPayloads: unknown[] = [
				"123",
				"true",
				"null",
				'{"x":1}',
				123,
				true,
				{ x: 1 },
				[1, "two"],
			];
			await setup.app.db.insert(questpieChannelEventTable).values(
				scalarPayloads.map((payload, index) => ({
					channelHash: "scalar-matrix",
					seq: index + 2,
					eventId: `scalar-${index}`,
					channel: "room-1",
					event: "message",
					schemaIdentity: "message-v1",
					payload,
					wireJson: JSON.stringify({
						eventId: `scalar-${index}`,
						event: "message",
						data: payload,
					}),
					sizeBytes: 16,
				})),
			);
			const scalarRows = await setup.app.db
				.select({ payload: questpieChannelEventTable.payload })
				.from(questpieChannelEventTable)
				.orderBy(questpieChannelEventTable.seq);
			expect(scalarRows.slice(1).map(({ payload }) => payload)).toEqual(
				scalarPayloads,
			);
		} finally {
			await setup?.cleanup();
			await admin.unsafe(`drop schema if exists "${schemaName}" cascade`);
			await admin.close({ timeout: 5 });
		}
	}, 30_000);

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
	}, 20_000);
});
