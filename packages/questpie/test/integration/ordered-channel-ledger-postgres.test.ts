import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { and, asc, eq, sql } from "drizzle-orm";
import pg from "pg";
import { z } from "zod";

import { channel } from "../../src/server/channels/channel-builder.js";
import { ChannelsService } from "../../src/server/channels/service.js";
import { withTransaction } from "../../src/server/collection/crud/shared/transaction.js";
import {
	ChannelEventLedger,
	hashResolvedChannel,
} from "../../src/server/modules/core/integrated/realtime/channel-event-ledger.js";
import {
	questpieChannelAuthorityFenceTable,
	questpieChannelAuthorityRevocationTable,
	questpieChannelDispatchTable,
	questpieChannelEventTable,
	questpieChannelHeadTable,
} from "../../src/server/modules/core/integrated/realtime/collection.js";
import type {
	ClientCloseReason,
	ClientSink,
	DeliveryClass,
} from "../../src/server/modules/core/integrated/realtime/transport.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../utils/test-db.js";

/**
 * The channel ledger's guarantees are about LOCKS: sequence order equals commit
 * order because the head row is locked, retention runs on one node because of an
 * advisory lock, and multi-channel publishes deadlock unless they agree on an
 * order. None of that is observable on PGlite, which is a single embedded
 * backend where a "second transaction" runs inside the first without blocking —
 * the existing PGlite ordering test passes with the head lock deleted.
 *
 * These are the same claims, against a real server with a real connection pool.
 */
const databaseUrl =
	process.env.QUESTPIE_CHANNEL_LEDGER_DATABASE_URL ??
	process.env.QUESTPIE_TRANSACTION_LOCK_DATABASE_URL;

type TestSink = ClientSink & {
	frames: Array<Record<string, any>>;
	closeReasons: ClientCloseReason[];
};

function createSink(sessionId: string): TestSink {
	const decoder = new TextDecoder();
	return {
		sessionId,
		frames: [],
		closeReasons: [],
		async write(frame: Uint8Array, _delivery: DeliveryClass) {
			this.frames.push(JSON.parse(decoder.decode(frame)));
			return { status: "accepted", bufferedBytes: 0 };
		},
		async close(reason: ClientCloseReason) {
			this.closeReasons.push(reason);
		},
	};
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

describe.skipIf(!databaseUrl)("ordered channel ledger on PostgreSQL", () => {
	const channels = {
		room: channel("room-[roomId]")
			.events({ message: z.object({ order: z.string() }) })
			.authorize(true),
	};
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	const ledgers = new Set<ChannelEventLedger>();

	beforeAll(async () => {
		const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
		try {
			await pool.query("create extension if not exists pg_trgm");
		} finally {
			await pool.end();
		}
		setup = await buildMockApp(
			{ channels },
			{ db: { url: databaseUrl!, pool: { max: 8 } } },
		);
		await runTestDbMigrations(setup.app);
	});

	afterAll(async () => {
		for (const value of ledgers) await value.destroy();
		await setup.cleanup();
	});

	async function reset() {
		await setup.app.db.delete(questpieChannelEventTable);
		await setup.app.db.delete(questpieChannelDispatchTable);
		await setup.app.db.delete(questpieChannelAuthorityRevocationTable);
		await setup.app.db.delete(questpieChannelAuthorityFenceTable);
		await setup.app.db.delete(questpieChannelHeadTable);
	}

	function ledger(
		config: ConstructorParameters<typeof ChannelEventLedger>[3] = {},
		logger?: ConstructorParameters<typeof ChannelEventLedger>[4],
	): ChannelEventLedger {
		const value = new ChannelEventLedger(
			setup.app.db,
			undefined,
			undefined,
			config,
			logger,
		);
		ledgers.add(value);
		return value;
	}

	test("a second publisher cannot take a sequence until the first commits", async () => {
		await reset();
		const events = ledger();
		let markFirstAppended = () => {};
		const firstAppended = new Promise<void>((resolve) => {
			markFirstAppended = resolve;
		});
		let releaseFirst = () => {};
		const holdFirst = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});

		const first = withTransaction(setup.app.db, async (tx) => {
			const receipt = await events.append(
				{
					channel: "room-lock",
					event: "message",
					schemaIdentity: "room:message",
					data: { order: "first" },
				},
				{ db: tx },
			);
			markFirstAppended();
			await holdFirst;
			return receipt;
		});
		await firstAppended;

		let secondSettled = false;
		const second = withTransaction(setup.app.db, (tx) =>
			events.append(
				{
					channel: "room-lock",
					event: "message",
					schemaIdentity: "room:message",
					data: { order: "second" },
				},
				{ db: tx },
			),
		).then((receipt) => {
			secondSettled = true;
			return receipt;
		});
		await new Promise((resolve) => setTimeout(resolve, 200));

		// This is the whole point of the head row, and the assertion PGlite
		// cannot make: the second publisher is blocked on a real row lock.
		expect(secondSettled).toBe(false);
		releaseFirst();
		const [firstReceipt, secondReceipt] = await Promise.all([first, second]);

		const rows = await setup.app.db
			.select()
			.from(questpieChannelEventTable)
			.orderBy(asc(questpieChannelEventTable.seq));
		expect(rows.map((row: any) => row.payload.order)).toEqual([
			"first",
			"second",
		]);
		expect(firstReceipt.eventId).toEndWith(":1");
		expect(secondReceipt.eventId).toEndWith(":2");
	});

	test("60 concurrent publishers on one channel produce a contiguous sequence", async () => {
		await reset();
		const events = ledger();
		await Promise.all(
			Array.from({ length: 60 }, (_, index) =>
				events.append({
					channel: "room-parallel",
					event: "message",
					schemaIdentity: "room:message",
					data: { index },
				}),
			),
		);
		const rows = await setup.app.db
			.select({ seq: questpieChannelEventTable.seq })
			.from(questpieChannelEventTable)
			.orderBy(asc(questpieChannelEventTable.seq));
		expect(rows.map((row: any) => Number(row.seq))).toEqual(
			Array.from({ length: 60 }, (_, index) => index + 1),
		);
	});

	test("publishBatch locks channels in hash order, not caller order", async () => {
		await reset();
		// Deadlock-freedom is exactly "every caller agrees on an order". Assert
		// the order directly: hold the lock on the channel that sorts FIRST, and
		// hand publishBatch the two channels in the opposite order. A batch that
		// respects hash order blocks before writing anything.
		const service = new ChannelsService(channels, setup.app.realtime!, {
			accessMode: "system",
		} as any);
		const resolve = (roomId: string) =>
			service.resolveName("room", { roomId } as any);
		const rooms = ["alpha", "beta"].sort((a, b) => {
			const left = hashResolvedChannel(resolve(a));
			const right = hashResolvedChannel(resolve(b));
			return left < right ? -1 : left > right ? 1 : 0;
		});
		const [firstByHash, secondByHash] = rooms;

		// Seed both heads so the batch takes the fast single-statement path.
		const seed = ledger();
		for (const room of rooms) {
			await seed.append({
				channel: resolve(room),
				event: "message",
				schemaIdentity: "room:message",
				data: { order: "seed" },
			});
		}

		const blocker = new pg.Client({ connectionString: databaseUrl });
		await blocker.connect();
		let batchSettled = false;
		try {
			await blocker.query("begin");
			const locked = await blocker.query(
				"update questpie_channel_head set updated_at = now() where channel_hash = $1",
				[hashResolvedChannel(resolve(firstByHash))],
			);
			expect(locked.rowCount).toBe(1);

			const batch = service
				.publishBatch([
					{
						channel: "room",
						params: { roomId: secondByHash },
						event: "message",
						data: { order: "caller-first" },
					},
					{
						channel: "room",
						params: { roomId: firstByHash },
						event: "message",
						data: { order: "caller-second" },
					},
				] as any)
				.then((receipts) => {
					batchSettled = true;
					return receipts;
				});
			await new Promise((resolve) => setTimeout(resolve, 250));

			expect(batchSettled).toBe(false);
			// Nothing was written to the channel the caller listed FIRST: the
			// batch reordered and is parked on the hash-first channel's lock.
			// In caller order this row exists, which is the deadlock cycle.
			const written = await setup.app.db
				.select()
				.from(questpieChannelEventTable)
				.where(
					and(
						eq(
							questpieChannelEventTable.channelHash,
							hashResolvedChannel(resolve(secondByHash)),
						),
						eq(questpieChannelEventTable.seq, 2),
					),
				);
			expect(written).toEqual([]);

			await blocker.query("commit");
			const receipts = await batch;
			expect(receipts).toHaveLength(2);
			// Receipts still come back in the caller's order.
			expect(receipts[0].eventId).toStartWith(
				hashResolvedChannel(resolve(secondByHash)),
			);
			expect(receipts[1].eventId).toStartWith(
				hashResolvedChannel(resolve(firstByHash)),
			);
		} finally {
			await blocker.query("rollback").catch(() => {});
			await blocker.end();
		}
	});

	test("concurrent nodes do not repeat a retention pass", async () => {
		await reset();
		const seedLedger = ledger({ retentionMs: 0, retentionBytes: 0 });
		for (let index = 0; index < 60; index++) {
			await seedLedger.append({
				channel: "room-retention",
				event: "message",
				schemaIdentity: "room:message",
				data: { index },
			});
		}
		// Age the rows on the SERVER clock so the assertion does not depend on
		// skew between this process and the database.
		await setup.app.db.execute(
			sql`update questpie_channel_event set created_at = now() - interval '1 day'`,
		);

		const nodes = [
			ledger({ retentionMs: 60_000, retentionBytes: 0 }),
			ledger({ retentionMs: 60_000, retentionBytes: 0 }),
			ledger({ retentionMs: 60_000, retentionBytes: 0 }),
		];
		let statements = 0;
		const db = setup.app.db as Record<string, any>;
		const original = {
			execute: db.execute.bind(setup.app.db),
			delete: db.delete.bind(setup.app.db),
			transaction: db.transaction.bind(setup.app.db),
		};
		const count = <T>(value: T): T => {
			statements += 1;
			return value;
		};
		db.execute = (...args: any[]) => count(original.execute(...args));
		db.delete = (...args: any[]) => count(original.delete(...args));
		db.transaction = (callback: (tx: any) => any, ...rest: any[]) =>
			original.transaction(
				(tx: any) =>
					callback(
						new Proxy(tx, {
							get(target, property, receiver) {
								const value = Reflect.get(target, property, receiver);
								if (property !== "execute" && property !== "delete") {
									return value;
								}
								return (...args: any[]) => count(value.apply(target, args));
							},
						}),
					),
				...rest,
			);
		try {
			await Promise.all(nodes.map((node) => node.cleanup()));
		} finally {
			Object.assign(db, original);
		}

		expect(await setup.app.db.select().from(questpieChannelEventTable)).toEqual(
			[],
		);
		// One node deletes; the other two see the advisory lock is taken and
		// stop after probing it. Never 60 deletes, and never 3x anything.
		expect(statements).toBeLessThanOrEqual(8);
	});

	test("fan-out reads the log once per channel across a real connection pool", async () => {
		await reset();
		const events = ledger();
		const reads: number[] = [];
		const store = events as unknown as {
			selectEvents: (channelHash: string, afterSeq: number) => Promise<unknown>;
		};
		const selectEvents = store.selectEvents.bind(events);
		store.selectEvents = (channelHash: string, afterSeq: number) => {
			reads.push(afterSeq);
			return selectEvents(channelHash, afterSeq);
		};

		const sinks: TestSink[] = [];
		for (let index = 0; index < 50; index++) {
			const sink = createSink(`fanout-${index}`);
			sinks.push(sink);
			await events.subscribeLocal({
				subscriptionId: `fanout-${index}`,
				channel: "room-fanout",
				sink,
			});
		}
		await settle();
		reads.length = 0;

		await events.append({
			channel: "room-fanout",
			event: "message",
			schemaIdentity: "room:message",
			data: { id: 1 },
		});
		await events.drain();

		expect(sinks.every((sink) => sink.frames.length === 1)).toBe(true);
		// SQL for one event is a function of the channel, not of how many
		// subscribers are attached to it.
		expect(reads.length).toBeLessThanOrEqual(2);
	});
});
