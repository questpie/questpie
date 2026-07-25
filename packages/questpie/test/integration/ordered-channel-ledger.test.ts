import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";

import { asc } from "drizzle-orm";

import { withTransaction } from "../../src/server/collection/crud/shared/transaction.js";
import {
	ChannelEventLedger,
	hashResolvedChannel,
} from "../../src/server/modules/core/integrated/realtime/channel-event-ledger.js";
import {
	questpieChannelDispatchTable,
	questpieChannelEventTable,
	questpieChannelHeadTable,
} from "../../src/server/modules/core/integrated/realtime/collection.js";
import type {
	ClientCloseReason,
	ClientSink,
	DeliveryClass,
	EdgeSessionInput,
	OrderedChannelDelivery,
	SharedProviderClientTransport,
	SinkWriteResult,
} from "../../src/server/modules/core/integrated/realtime/transport.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { createTestDb, runTestDbMigrations } from "../utils/test-db.js";

type TestSink = ClientSink & {
	frames: Array<Record<string, any>>;
	closeReasons: ClientCloseReason[];
	busy: boolean;
};

function createSink(sessionId: string, busy = false): TestSink {
	const decoder = new TextDecoder();
	return {
		sessionId,
		frames: [],
		closeReasons: [],
		busy,
		async write(frame: Uint8Array, _delivery: DeliveryClass) {
			if (this.busy) return { status: "busy", bufferedBytes: 1 };
			this.frames.push(JSON.parse(decoder.decode(frame)));
			return { status: "accepted", bufferedBytes: 0 };
		},
		async close(reason: ClientCloseReason) {
			this.closeReasons.push(reason);
		},
	};
}

class SharedTestTransport implements SharedProviderClientTransport {
	readonly channelDeliveryScope = "shared-provider" as const;
	readonly deliveries: OrderedChannelDelivery[] = [];

	async start(): Promise<void> {}
	async openSession(_input: EdgeSessionInput): Promise<ClientSink> {
		return createSink("shared");
	}
	async getClientConfig() {
		return { transport: "shared-provider" as const, config: {} };
	}
	async generateAuth() {
		return { auth: "test" };
	}
	async publishChannel(
		delivery: OrderedChannelDelivery,
	): Promise<SinkWriteResult> {
		this.deliveries.push(delivery);
		return { status: "accepted", bufferedBytes: null };
	}
	async stop(): Promise<void> {}
}

describe("ordered channel event ledger", () => {
	let testDb: Awaited<ReturnType<typeof createTestDb>>;
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	const ledgers = new Set<ChannelEventLedger>();

	beforeAll(async () => {
		testDb = await createTestDb();
		setup = await buildMockApp({}, { db: { pglite: testDb } });
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		for (const ledger of ledgers) ledger.destroy();
		ledgers.clear();
		await setup.app.db.delete(questpieChannelEventTable);
		await setup.app.db.delete(questpieChannelDispatchTable);
		await setup.app.db.delete(questpieChannelHeadTable);
	});

	afterAll(async () => {
		await setup.cleanup();
		await testDb.close();
	});

	function ledger(
		transport?: SharedProviderClientTransport,
		config: ConstructorParameters<typeof ChannelEventLedger>[3] = {},
	): ChannelEventLedger {
		const value = new ChannelEventLedger(
			setup.app.db,
			undefined,
			transport,
			config,
		);
		ledgers.add(value);
		return value;
	}

	test("orders concurrent channel transactions by their locked commit sequence", async () => {
		const events = ledger();
		const sink = createSink("ordered");
		await events.subscribeLocal({
			subscriptionId: "ordered-room",
			channel: "private-room-1",
			sink,
		});
		const receipts = await Promise.all([
			events.append({
				channel: "private-room-1",
				event: "message",
				schemaIdentity: "room:message",
				data: { order: "a" },
			}),
			events.append({
				channel: "private-room-1",
				event: "message",
				schemaIdentity: "room:message",
				data: { order: "b" },
			}),
		]);
		const rows = await setup.app.db
			.select()
			.from(questpieChannelEventTable)
			.orderBy(asc(questpieChannelEventTable.seq));
		await events.drain();

		expect(rows.map((row: any) => Number(row.seq))).toEqual([1, 2]);
		expect(sink.frames.map((frame) => frame.data.order)).toEqual(
			rows.map((row: any) => row.payload.order),
		);
		expect(new Set(receipts.map((receipt) => receipt.eventId)).size).toBe(2);
	});

	test("rollback creates no deliverable event id gap", async () => {
		const events = ledger();
		await expect(
			withTransaction(setup.app.db, async (tx) => {
				await events.append(
					{
						channel: "private-room-1",
						event: "message",
						schemaIdentity: "room:message",
						data: { rolledBack: true },
					},
					{ db: tx },
				);
				throw new Error("rollback");
			}),
		).rejects.toThrow("rollback");

		const receipt = await events.append({
			channel: "private-room-1",
			event: "message",
			schemaIdentity: "room:message",
			data: { rolledBack: false },
		});
		expect(receipt.eventId).toEndWith(":1");
		expect(
			await setup.app.db.select().from(questpieChannelEventTable),
		).toHaveLength(1);
	});

	test("measures the exact canonical provider envelope before ledger commit", async () => {
		const events = ledger();
		const channel = "private-room-1";
		const event = "message";
		const eventId = `${hashResolvedChannel(channel)}:1`;
		const emptyEnvelopeBytes = new TextEncoder().encode(
			JSON.stringify({ eventId, event, data: "" }),
		).byteLength;
		const exact = "x".repeat(10_000 - emptyEnvelopeBytes);

		const receipt = await events.append({
			channel,
			event,
			schemaIdentity: "room:message",
			data: exact,
		});
		expect(receipt.eventId).toBe(eventId);

		await expect(
			events.append({
				channel,
				event,
				schemaIdentity: "room:message",
				data: `${exact}x`,
			}),
		).rejects.toThrow("10,000-byte");

		const rows = await setup.app.db.select().from(questpieChannelEventTable);
		const heads = await setup.app.db.select().from(questpieChannelHeadTable);
		expect(rows).toHaveLength(1);
		expect(rows[0].sizeBytes).toBe(10_000);
		expect(Number(heads[0].lastSeq)).toBe(1);
	});

	test("includes event id sequence digit growth in the byte boundary", async () => {
		const events = ledger();
		const channel = "private-room-1";
		const event = "message";
		for (let index = 0; index < 9; index++) {
			await events.append({
				channel,
				event,
				schemaIdentity: "room:message",
				data: { index },
			});
		}
		const ninthId = `${hashResolvedChannel(channel)}:9`;
		const emptyEnvelopeBytes = new TextEncoder().encode(
			JSON.stringify({ eventId: ninthId, event, data: "" }),
		).byteLength;
		const fitsSequenceNine = "x".repeat(10_000 - emptyEnvelopeBytes);

		await expect(
			events.append({
				channel,
				event,
				schemaIdentity: "room:message",
				data: fitsSequenceNine,
			}),
		).rejects.toThrow("10,000-byte");

		const heads = await setup.app.db.select().from(questpieChannelHeadTable);
		expect(Number(heads[0].lastSeq)).toBe(9);
	});

	test("counts multibyte UTF-8 in the canonical envelope", async () => {
		const events = ledger();
		const channel = "private-room-1";
		const event = "message";
		const eventId = `${hashResolvedChannel(channel)}:1`;
		const emptyEnvelopeBytes = new TextEncoder().encode(
			JSON.stringify({ eventId, event, data: "" }),
		).byteLength;
		const remaining = 10_000 - emptyEnvelopeBytes;
		const exact = `${"😀".repeat(Math.floor(remaining / 4))}${"x".repeat(
			remaining % 4,
		)}`;

		await events.append({
			channel,
			event,
			schemaIdentity: "room:message",
			data: exact,
		});
		await expect(
			events.append({
				channel,
				event,
				schemaIdentity: "room:message",
				data: `${exact}x`,
			}),
		).rejects.toThrow("10,000-byte");
	});

	test("two local instances deliver to every local sink exactly once", async () => {
		const first = ledger();
		const second = ledger();
		const firstSink = createSink("first");
		const secondSink = createSink("second");
		await first.subscribeLocal({
			subscriptionId: "first-room",
			channel: "private-room-1",
			sink: firstSink,
		});
		await second.subscribeLocal({
			subscriptionId: "second-room",
			channel: "private-room-1",
			sink: secondSink,
		});

		await first.append({
			channel: "private-room-1",
			event: "message",
			schemaIdentity: "room:message",
			data: { id: 1 },
		});
		await Promise.all([first.drain(), second.drain()]);
		await Promise.all([first.drain(), second.drain()]);

		expect(firstSink.frames.map((frame) => frame.data.id)).toEqual([1]);
		expect(secondSink.frames.map((frame) => frame.data.id)).toEqual([1]);
	});

	test("shared-provider coordinators publish globally once and in order", async () => {
		const transport = new SharedTestTransport();
		const first = ledger(transport);
		const second = ledger(transport);
		await first.append({
			channel: "private-room-1",
			event: "message",
			schemaIdentity: "room:message",
			data: { order: 1 },
		});
		await first.append({
			channel: "private-room-1",
			event: "message",
			schemaIdentity: "room:message",
			data: { order: 2 },
		});
		await Promise.all([first.drain(), second.drain()]);
		await Promise.all([second.drain(), first.drain()]);

		expect(
			transport.deliveries.map(
				(delivery) =>
					JSON.parse(new TextDecoder().decode(delivery.frame)).data.order,
			),
		).toEqual([1, 2]);
	});

	test("duplicate drains dedupe and reconciliation heals a missed wake", async () => {
		const publisher = ledger();
		const reconciler = ledger();
		const sink = createSink("reconciler");
		await reconciler.subscribeLocal({
			subscriptionId: "room",
			channel: "private-room-1",
			sink,
		});
		await publisher.append({
			channel: "private-room-1",
			event: "message",
			schemaIdentity: "room:message",
			data: { id: "missed" },
		});
		expect(sink.frames).toHaveLength(0);

		await reconciler.drain();
		await Promise.all([reconciler.drain(), reconciler.drain()]);
		expect(sink.frames.map((frame) => frame.data.id)).toEqual(["missed"]);
	});

	test("reconnect replays retained events after the last applied event id", async () => {
		const events = ledger();
		const first = await events.append({
			channel: "private-room-1",
			event: "message",
			schemaIdentity: "room:message",
			data: { id: 1 },
		});
		for (const id of [2, 3]) {
			await events.append({
				channel: "private-room-1",
				event: "message",
				schemaIdentity: "room:message",
				data: { id },
			});
		}
		const sink = createSink("resume");
		await events.subscribeLocal({
			subscriptionId: "resume-room",
			channel: "private-room-1",
			sink,
			lastEventId: first.eventId,
		});

		expect(sink.frames.map((frame) => frame.data.id)).toEqual([2, 3]);
	});

	test("expired resume cursor emits channel_gap and closes only that subscription", async () => {
		const events = ledger(undefined, { retentionBytes: 9, retentionMs: 0 });
		const first = await events.append({
			channel: "private-room-1",
			event: "message",
			schemaIdentity: "room:message",
			data: { id: 1 },
		});
		for (const id of [2, 3]) {
			await events.append({
				channel: "private-room-1",
				event: "message",
				schemaIdentity: "room:message",
				data: { id },
			});
		}
		await events.cleanup();
		const sink = createSink("expired");
		await events.subscribeLocal({
			subscriptionId: "expired-room",
			channel: "private-room-1",
			sink,
			lastEventId: first.eventId,
		});

		expect(sink.frames).toEqual([
			expect.objectContaining({ type: "channel_gap" }),
		]);
		await events.append({
			channel: "private-room-1",
			event: "message",
			schemaIdentity: "room:message",
			data: { id: 4 },
		});
		await events.drain();
		expect(sink.frames).toHaveLength(1);
		expect(sink.closeReasons).toEqual([]);
	});

	test("slow local sink closes instead of dropping and continuing", async () => {
		const events = ledger(undefined, {
			maxBufferedEvents: 2,
			maxBufferedBytes: 1024,
			busyRetryMs: 60_000,
		});
		const sink = createSink("slow", true);
		await events.subscribeLocal({
			subscriptionId: "slow-room",
			channel: "private-room-1",
			sink,
		});
		for (const id of [1, 2, 3]) {
			await events.append({
				channel: "private-room-1",
				event: "message",
				schemaIdentity: "room:message",
				data: { id },
			});
			await events.drain();
		}

		expect(sink.frames).toHaveLength(0);
		expect(sink.closeReasons).toEqual(["slow_consumer"]);
	});

	test("retention cleanup runs with zero subscribers across instances", async () => {
		const first = ledger(undefined, { retentionBytes: 1, retentionMs: 0 });
		const second = ledger(undefined, { retentionBytes: 1, retentionMs: 0 });
		await first.append({
			channel: "private-room-1",
			event: "message",
			schemaIdentity: "room:message",
			data: { id: 1 },
		});

		await Promise.all([first.cleanup(), second.cleanup()]);
		expect(await setup.app.db.select().from(questpieChannelEventTable)).toEqual(
			[],
		);
		expect(hashResolvedChannel("private-room-1")).toHaveLength(64);
	});
});
