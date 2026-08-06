import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

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
	questpieChannelPresenceTable,
} from "../../src/server/modules/core/integrated/realtime/collection.js";
import { SseChannelPresenceRegistry } from "../../src/server/modules/core/integrated/realtime/sse-channel-presence.js";
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
	readonly authorityRevocationScope = "principal-connections" as const;
	readonly deliveries: OrderedChannelDelivery[] = [];
	readonly revocations: unknown[] = [];
	rejectRevocation = false;

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
	async generateUserAuth() {
		return { auth: "test", user_data: '{"id":"opaque"}' };
	}
	async revokeAuthority(input: unknown): Promise<void> {
		this.revocations.push(input);
		if (this.rejectRevocation) {
			throw new Error("provider termination unavailable");
		}
	}
	async publishChannel(
		delivery: OrderedChannelDelivery,
	): Promise<SinkWriteResult> {
		this.deliveries.push(delivery);
		return { status: "accepted", bufferedBytes: null };
	}
	async stop(): Promise<void> {}
}

class CapabilitylessSharedTransport implements SharedProviderClientTransport {
	readonly channelDeliveryScope = "shared-provider" as const;
	readonly deliveries: OrderedChannelDelivery[] = [];

	async start(): Promise<void> {}
	async openSession(_input: EdgeSessionInput): Promise<ClientSink> {
		return createSink("capabilityless-shared");
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

class ControlledAckSharedTransport extends SharedTestTransport {
	readonly acknowledgements: Array<() => void> = [];

	override async revokeAuthority(input: unknown): Promise<void> {
		this.revocations.push(input);
		await new Promise<void>((resolve) => {
			this.acknowledgements.push(resolve);
		});
	}
}

async function waitFor(assertion: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (assertion()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("Timed out waiting for ordered channel test condition");
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
		await setup.app.db.delete(questpieChannelAuthorityRevocationTable);
		await setup.app.db.delete(questpieChannelAuthorityFenceTable);
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

	test("provider revocation failure leaves the authority fence pending and blocks publish cursor advancement", async () => {
		const transport = new SharedTestTransport();
		const events = ledger(transport);
		transport.rejectRevocation = true;
		await expect(
			events.revokeAuthority({
				channel: "private-room-1",
				subject: "opaque-user-1",
				transportSubject: { kind: "user", id: "user-1" },
				idempotencyKey: "room-1:user-1:membership-v2",
			}),
		).rejects.toThrow("provider termination unavailable");

		await events.append({
			channel: "private-room-1",
			event: "message",
			schemaIdentity: "room:message",
			data: { id: "must-not-dispatch" },
		});
		await events.drain();
		const [dispatch] = await setup.app.db
			.select()
			.from(questpieChannelDispatchTable);
		expect(transport.deliveries).toEqual([]);
		expect(Number(dispatch.publishedSeq)).toBe(0);

		transport.rejectRevocation = false;
		const retried = await events.revokeAuthority({
			channel: "private-room-1",
			subject: "opaque-user-1",
			transportSubject: { kind: "user", id: "user-1" },
			idempotencyKey: "room-1:user-1:membership-v2",
		});
		await events.drain();
		expect(retried).toEqual({
			generation: 1,
			scope: "principal-connections",
		});
		expect(transport.revocations).toHaveLength(2);
		expect(transport.deliveries).toHaveLength(1);
	});

	test("a shared provider without an explicit revocation capability fails closed", async () => {
		const transport = new CapabilitylessSharedTransport();
		const events = ledger(transport);

		await expect(
			events.revokeAuthority({
				channel: "private-room-1",
				subject: "opaque-user-1",
				transportSubject: { kind: "user", id: "user-1" },
				idempotencyKey: "room-1:user-1:unsupported-provider",
			}),
		).rejects.toThrow("revocation capability");

		await events.append({
			channel: "private-room-1",
			event: "message",
			schemaIdentity: "room:message",
			data: { id: "must-remain-fenced" },
		});
		await events.drain();
		expect(transport.deliveries).toEqual([]);
	});

	test("out-of-order provider acknowledgements never regress the applied generation", async () => {
		const transport = new ControlledAckSharedTransport();
		const events = ledger(transport);
		const first = events.revokeAuthority({
			channel: "private-room-1",
			subject: "opaque-user-1",
			transportSubject: { kind: "user", id: "user-1" },
			idempotencyKey: "room-1:user-1:authority-v1",
		});
		await waitFor(() => transport.acknowledgements.length === 1);
		const second = events.revokeAuthority({
			channel: "private-room-1",
			subject: "opaque-user-1",
			transportSubject: { kind: "user", id: "user-1" },
			idempotencyKey: "room-1:user-1:authority-v2",
		});
		await waitFor(() => transport.acknowledgements.length === 2);

		await events.append({
			channel: "private-room-1",
			event: "message",
			schemaIdentity: "room:message",
			data: { id: "behind-both-cuts" },
		});
		await events.drain();
		expect(transport.deliveries).toEqual([]);

		transport.acknowledgements[1]!();
		await expect(second).resolves.toMatchObject({ generation: 2 });
		await events.drain();
		expect(transport.deliveries).toHaveLength(1);

		transport.acknowledgements[0]!();
		await expect(first).resolves.toMatchObject({ generation: 1 });
		await events.append({
			channel: "private-room-1",
			event: "message",
			schemaIdentity: "room:message",
			data: { id: "after-late-older-ack" },
		});
		await events.drain();
		const [fence] = await setup.app.db
			.select()
			.from(questpieChannelAuthorityFenceTable)
			.where(
				and(
					eq(
						questpieChannelAuthorityFenceTable.channelHash,
						hashResolvedChannel("private-room-1"),
					),
					eq(questpieChannelAuthorityFenceTable.subject, "opaque-user-1"),
				),
			);
		expect(Number(fence.appliedGeneration)).toBe(2);
		expect(transport.deliveries).toHaveLength(2);
	});

	test("ChannelsService reports managed provider effects truthfully inside the caller transaction", async () => {
		const transport = new SharedTestTransport();
		const definitions = {
			room: channel("room-[roomId]").authorize(true),
		};
		const providerSetup = await buildMockApp(
			{ channels: definitions },
			{
				db: { pglite: testDb },
				realtime: { clientTransport: transport, retentionDays: 0 },
			},
		);
		const revokeIn = (db: any, idempotencyKey: string) =>
			new ChannelsService(definitions, providerSetup.app.realtime!, {
				accessMode: "system",
				db,
			} as any).revokeAuthority("room", {
				params: { roomId: "one" },
				subject: { kind: "user", id: "user-1" },
				idempotencyKey,
			});

		try {
			transport.rejectRevocation = true;
			await expect(
				withTransaction(setup.app.db, async (tx) =>
					revokeIn(tx, "room-one:user-1:membership-v4-failure"),
				),
			).rejects.toThrow("provider termination unavailable");
			expect(
				await setup.app.db
					.select()
					.from(questpieChannelAuthorityRevocationTable),
			).toEqual([]);

			transport.rejectRevocation = false;
			const retried = await revokeIn(
				setup.app.db,
				"room-one:user-1:membership-v4-failure",
			);
			expect(retried).toEqual({
				generation: 1,
				scope: "principal-connections",
			});
			await expect(
				withTransaction(setup.app.db, async (tx) => {
					await revokeIn(tx, "room-one:user-1:membership-v4-rollback");
					throw new Error("related domain write rolled back");
				}),
			).rejects.toThrow("related domain write rolled back");
			expect(
				await setup.app.db
					.select()
					.from(questpieChannelAuthorityRevocationTable),
			).toHaveLength(1);

			await expect(
				withTransaction(setup.app.db, async (tx) =>
					revokeIn(tx, "room-one:user-1:membership-v4-success"),
				),
			).resolves.toEqual({
				generation: 2,
				scope: "principal-connections",
			});
			const committed = await setup.app.db
				.select()
				.from(questpieChannelAuthorityRevocationTable);
			expect(committed.every((row) => row.applied)).toBe(true);
			expect(committed.map((row) => Number(row.generation)).sort()).toEqual([
				1, 2,
			]);
			expect(transport.revocations).toHaveLength(4);
		} finally {
			await providerSetup.cleanup();
		}
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
		const order: string[] = [];
		await events.subscribeLocal({
			subscriptionId: "resume-room",
			channel: "private-room-1",
			sink: {
				...sink,
				write: async (frame, delivery) => {
					const result = await sink.write(frame, delivery);
					order.push(`event:${String(sink.frames.at(-1)?.data.id)}`);
					return result;
				},
			},
			onReady: () => order.push("ready"),
			lastEventId: first.eventId,
		});

		expect(sink.frames.map((frame) => frame.data.id)).toEqual([2, 3]);
		expect(order).toEqual(["event:2", "event:3", "ready"]);
	});

	test("orders a racing post-admission event after readiness delivery", async () => {
		const events = ledger();
		const sink = createSink("admission-race");
		const order: string[] = [];
		let markReadyStarted!: () => void;
		const readyStarted = new Promise<void>((resolve) => {
			markReadyStarted = resolve;
		});
		let releaseReady!: () => void;
		const readyRelease = new Promise<void>((resolve) => {
			releaseReady = resolve;
		});
		const subscribing = events.subscribeLocal({
			subscriptionId: "admission-race-room",
			channel: "private-room-1",
			sink: {
				...sink,
				write: async (frame, delivery) => {
					const result = await sink.write(frame, delivery);
					order.push(`event:${String(sink.frames.at(-1)?.data.id)}`);
					return result;
				},
			},
			onReady: async () => {
				markReadyStarted();
				await readyRelease;
				order.push("ready");
			},
		});

		await readyStarted;
		await events.append({
			channel: "private-room-1",
			event: "message",
			schemaIdentity: "room:message",
			data: { id: 1 },
		});
		const racingDrain = events.drain();
		releaseReady();
		const unsubscribe = await subscribing;
		await racingDrain;
		await waitFor(() => sink.frames.length === 1);

		expect(order).toEqual(["ready", "event:1"]);
		await unsubscribe();
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
		let ready = 0;
		await events.subscribeLocal({
			subscriptionId: "expired-room",
			channel: "private-room-1",
			sink,
			onReady: () => {
				ready += 1;
			},
			lastEventId: first.eventId,
		});

		expect(sink.frames).toEqual([
			expect.objectContaining({ type: "channel_gap" }),
		]);
		expect(ready).toBe(0);
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

	test("a connected subscriber whose unread events are removed gets a gap, not the next surviving event", async () => {
		// Retention cleanup on another node deletes rows a live subscriber has
		// not read yet. Delivery used to jump the hole in silence: the sink saw
		// 1, 2, 3, 6 with no gap frame, no close and nothing logged.
		const events = ledger(undefined, { retentionMs: 0, retentionBytes: 0 });
		// A second instance stands in for the node that owns the publish and the
		// retention pass; it never touches this subscriber's sink.
		const publisher = ledger(undefined, { retentionMs: 0, retentionBytes: 0 });
		const sink = createSink("live-gap");
		await events.subscribeLocal({
			subscriptionId: "live-gap-room",
			channel: "private-room-1",
			sink,
		});
		for (const id of [1, 2, 3]) {
			await publisher.append({
				channel: "private-room-1",
				event: "message",
				schemaIdentity: "room:message",
				data: { id },
			});
		}
		await events.drain();
		expect(sink.frames.map((frame) => frame.data.id)).toEqual([1, 2, 3]);

		for (const id of [4, 5, 6]) {
			await publisher.append({
				channel: "private-room-1",
				event: "message",
				schemaIdentity: "room:message",
				data: { id },
			});
		}
		await setup.app.db
			.delete(questpieChannelEventTable)
			.where(
				and(
					eq(
						questpieChannelEventTable.channelHash,
						hashResolvedChannel("private-room-1"),
					),
					inArray(questpieChannelEventTable.seq, [4, 5]),
				),
			);
		await events.drain();

		expect(sink.frames.at(-1)).toEqual(
			expect.objectContaining({
				type: "channel_gap",
				channel: "private-room-1",
			}),
		);
		expect(
			sink.frames
				.filter((frame) => frame.type === "channel_event")
				.map((frame) => frame.data.id),
		).toEqual([1, 2, 3]);
		expect(events.hasLocalSubscription("live-gap-room")).toBe(false);

		// The torn-down subscription receives nothing further.
		await publisher.append({
			channel: "private-room-1",
			event: "message",
			schemaIdentity: "room:message",
			data: { id: 7 },
		});
		await events.drain();
		expect(
			sink.frames.filter((frame) => frame.type === "channel_event"),
		).toHaveLength(3);
	});

	test("one log read serves every subscriber on a channel", async () => {
		// Reads were issued per subscriber: 50 subscribers on one channel cost
		// 50 identical `seq > cursor` scans for a single event.
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

		const sinks = [] as ReturnType<typeof createSink>[];
		for (let index = 0; index < 20; index++) {
			const sink = createSink(`shared-read-${index}`);
			sinks.push(sink);
			await events.subscribeLocal({
				subscriptionId: `shared-read-${index}`,
				channel: "private-room-1",
				sink,
			});
		}
		reads.length = 0;
		await events.append({
			channel: "private-room-1",
			event: "message",
			schemaIdentity: "room:message",
			data: { id: 1 },
		});
		await events.drain();

		expect(sinks.every((sink) => sink.frames.length === 1)).toBe(true);
		// Two drain passes (the append's own, and the explicit one), one read each.
		expect(reads.length).toBeLessThanOrEqual(2);
	});

	test("cleanup names the retention cap that actually bound", async () => {
		// retentionBytes defaults to 64 MB and retentionMs to 24 h. The byte cap
		// wins long before the day is up and used to do it silently.
		const warnings: string[] = [];
		const events = new ChannelEventLedger(
			setup.app.db,
			undefined,
			undefined,
			{ retentionMs: 24 * 60 * 60 * 1000, retentionBytes: 200 },
			{ warn: (message: string) => warnings.push(message), error: () => {} },
		);
		ledgers.add(events);
		for (const id of [1, 2, 3, 4]) {
			await events.append({
				channel: "private-room-1",
				event: "message",
				schemaIdentity: "room:message",
				data: { id, filler: "z".repeat(120) },
			});
		}
		await events.cleanup();

		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("retentionBytes");
		expect(warnings[0]).toContain("retentionMs");
		const remaining = await setup.app.db
			.select()
			.from(questpieChannelEventTable);
		expect(remaining.length).toBeLessThan(4);
	});

	test("cleanup deletes in bounded statements instead of one transaction per row", async () => {
		const events = ledger(undefined, {
			retentionMs: 60_000,
			retentionBytes: 0,
		});
		for (let id = 0; id < 40; id++) {
			await events.append({
				channel: "private-room-1",
				event: "message",
				schemaIdentity: "room:message",
				data: { id },
			});
		}
		await setup.app.db.execute(
			sql`update questpie_channel_event set created_at = now() - interval '1 day'`,
		);
		// Count every write statement cleanup issues, whether it goes through the
		// query builder or raw SQL, and whether it runs on the connection or
		// inside a transaction.
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
			await events.cleanup();
		} finally {
			Object.assign(db, original);
		}

		expect(await setup.app.db.select().from(questpieChannelEventTable)).toEqual(
			[],
		);
		// Advisory lock, retention report and the deletes. Never proportional to
		// the row count.
		expect(statements).toBeLessThanOrEqual(4);
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

	test("revocation discards a paused frame and closes only the exact authority binding once", async () => {
		const events = ledger(undefined, { busyRetryMs: 60_000 });
		const revokedSink = createSink("revoked", true);
		const retainedSink = createSink("retained");
		let revokedAuthorized = true;

		await events.subscribeLocal({
			subscriptionId: "space-a:user-1",
			channel: "private-space-a",
			subject: "opaque-user-1",
			reauthorize: async () => revokedAuthorized,
			sink: revokedSink,
		});
		await events.subscribeLocal({
			subscriptionId: "space-b:user-1",
			channel: "private-space-b",
			subject: "opaque-user-1",
			reauthorize: async () => true,
			sink: retainedSink,
		});

		await events.append({
			channel: "private-space-a",
			event: "message",
			schemaIdentity: "space:message",
			data: { id: "paused-before-write" },
		});
		await events.drain();
		expect(revokedSink.frames).toHaveLength(0);

		revokedAuthorized = false;
		const firstRevocation = await events.revokeAuthority({
			channel: "private-space-a",
			subject: "opaque-user-1",
			idempotencyKey: "space-a:user-1:membership-v2",
		});
		const duplicateRevocation = await events.revokeAuthority({
			channel: "private-space-a",
			subject: "opaque-user-1",
			idempotencyKey: "space-a:user-1:membership-v2",
		});

		revokedSink.busy = false;
		await events.append({
			channel: "private-space-a",
			event: "message",
			schemaIdentity: "space:message",
			data: { id: "after-revocation" },
		});
		await events.append({
			channel: "private-space-b",
			event: "message",
			schemaIdentity: "space:message",
			data: { id: "still-authorized" },
		});
		await events.drain();

		expect(revokedSink.frames).toEqual([]);
		expect(revokedSink.closeReasons).toEqual(["access_revoked"]);
		expect(duplicateRevocation).toEqual(firstRevocation);
		expect(firstRevocation).toEqual({
			generation: 1,
			scope: "exact-subscription",
		});
		expect(retainedSink.closeReasons).toEqual([]);
		expect(retainedSink.frames.map((frame) => frame.data.id)).toEqual([
			"still-authorized",
		]);
	});

	test("a blocked sink write never delays an authority cut", async () => {
		const events = ledger();
		const sink = createSink("blocked-write");
		let writeStarted!: () => void;
		let releaseWrite!: () => void;
		const writeEntered = new Promise<void>((resolve) => {
			writeStarted = resolve;
		});
		const writeRelease = new Promise<void>((resolve) => {
			releaseWrite = resolve;
		});
		sink.write = async (frame) => {
			writeStarted();
			await writeRelease;
			sink.frames.push(JSON.parse(new TextDecoder().decode(frame)));
			return { status: "accepted", bufferedBytes: 0 };
		};
		let authorized = true;
		await events.subscribeLocal({
			subscriptionId: "space-a:user-1:blocked-write",
			channel: "private-space-a",
			subject: "opaque-user-1",
			reauthorize: async () => authorized,
			sink,
		});
		await events.append({
			channel: "private-space-a",
			event: "message",
			schemaIdentity: "space:message",
			data: { id: "admitted-before-cut" },
		});
		await writeEntered;

		authorized = false;
		await Promise.race([
			events.revokeAuthority({
				channel: "private-space-a",
				subject: "opaque-user-1",
				idempotencyKey: "space-a:user-1:blocked-write",
			}),
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new Error("Revocation waited for the blocked sink")),
					250,
				),
			),
		]);
		expect(sink.closeReasons).toEqual(["access_revoked"]);

		releaseWrite();
		await events.drain();
		expect(sink.frames.map((frame) => frame.data.id)).toEqual([
			"admitted-before-cut",
		]);
	});

	test("a blocked fresh authorization cannot delay a cut or publish its stale result", async () => {
		const events = ledger();
		const sink = createSink("registration-race");
		let authorized = true;
		let authorizationCalls = 0;
		let authorizationStarted!: () => void;
		let releaseAuthorization!: () => void;
		const authorizationEntered = new Promise<void>((resolve) => {
			authorizationStarted = resolve;
		});
		const authorizationRelease = new Promise<void>((resolve) => {
			releaseAuthorization = resolve;
		});
		const subscription = events.subscribeLocal({
			subscriptionId: "space-a:user-1:registration-race",
			channel: "private-space-a",
			subject: "opaque-user-1",
			reauthorize: async () => {
				authorizationCalls += 1;
				const result = authorized;
				if (authorizationCalls === 1) {
					authorizationStarted();
					await authorizationRelease;
				}
				return result;
			},
			sink,
		});
		await authorizationEntered;

		authorized = false;
		await events.revokeAuthority({
			channel: "private-space-a",
			subject: "opaque-user-1",
			idempotencyKey: "space-a:user-1:registration-race",
		});

		releaseAuthorization();
		await subscription;

		expect(authorizationCalls).toBe(2);
		expect(sink.closeReasons).toEqual(["access_revoked"]);
	});

	test("a stale presence admission publishes no row, timer snapshot, or binding after a cut", async () => {
		const events = ledger();
		const presence = new SseChannelPresenceRegistry(setup.app.db, {
			heartbeatMs: 5,
			reconciliationMs: 5,
		});
		const sink = createSink("presence-race");
		let authorized = true;
		let authorizationCalls = 0;
		let authorizationStarted!: () => void;
		let releaseAuthorization!: () => void;
		const authorizationEntered = new Promise<void>((resolve) => {
			authorizationStarted = resolve;
		});
		const authorizationRelease = new Promise<void>((resolve) => {
			releaseAuthorization = resolve;
		});
		const subscription = events.subscribeLocal({
			subscriptionId: "presence-space-a:user-1:registration-race",
			channel: "presence-space-a",
			subject: "opaque-user-1",
			reauthorize: async () => {
				authorizationCalls += 1;
				const result = authorized;
				if (authorizationCalls === 1) {
					authorizationStarted();
					await authorizationRelease;
				}
				return result;
			},
			sink,
			stage: presence.stage({
				channel: "presence-space-a",
				connectionId: "presence-space-a:user-1:registration-race",
				principalId: "opaque-user-1",
				sink,
				data: { id: "member-1" },
			}),
		});
		await authorizationEntered;

		authorized = false;
		await events.revokeAuthority({
			channel: "presence-space-a",
			subject: "opaque-user-1",
			idempotencyKey: "presence-space-a:user-1:heartbeat-race",
		});
		releaseAuthorization();
		await subscription;
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(authorizationCalls).toBe(2);
		expect(sink.closeReasons).toEqual(["access_revoked"]);
		expect(sink.frames).toEqual([]);
		expect(
			await setup.app.db.select().from(questpieChannelPresenceTable),
		).toEqual([]);
		await presence.destroy();
	});

	test("a retried presence admission publishes only the latest fresh member data", async () => {
		const events = ledger();
		const presence = new SseChannelPresenceRegistry(setup.app.db, {
			heartbeatMs: 60_000,
			reconciliationMs: 60_000,
		});
		const sink = createSink("presence-fresh-data");
		sink.write = async () => ({
			status: "accepted",
			bufferedBytes: 0,
		});
		let authorizationCalls = 0;
		let authorizationStarted!: () => void;
		let releaseAuthorization!: () => void;
		const authorizationEntered = new Promise<void>((resolve) => {
			authorizationStarted = resolve;
		});
		const authorizationRelease = new Promise<void>((resolve) => {
			releaseAuthorization = resolve;
		});
		const subscription = events.subscribeLocal({
			subscriptionId: "presence-space-a:user-1:fresh-data",
			channel: "presence-space-a",
			subject: "opaque-user-1",
			reauthorize: async () => {
				authorizationCalls += 1;
				if (authorizationCalls === 1) {
					authorizationStarted();
					await authorizationRelease;
					return {
						authorized: true,
						presence: { id: "member-1", role: "old" },
					};
				}
				return {
					authorized: true,
					presence: { id: "member-1", role: "new" },
				};
			},
			sink,
			stage: presence.stage({
				channel: "presence-space-a",
				connectionId: "presence-space-a:user-1:fresh-data",
				principalId: "opaque-user-1",
				sink,
				data: { id: "member-1", role: "initial" },
			}),
		});
		await authorizationEntered;

		await events.revokeAuthority({
			channel: "presence-space-a",
			subject: "opaque-user-1",
			idempotencyKey: "presence-space-a:user-1:fresh-data",
		});
		releaseAuthorization();
		const release = await subscription;

		expect(authorizationCalls).toBe(2);
		const rows = await setup.app.db.select().from(questpieChannelPresenceTable);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.data).toEqual({ id: "member-1", role: "new" });
		expect(JSON.stringify(rows)).not.toContain('"old"');
		expect(JSON.stringify(rows)).not.toContain('"initial"');
		await release();
		await presence.destroy();
	});

	test("a dropped authority wake reconciles from the durable fence on another instance", async () => {
		const revoker = ledger();
		const subscriber = ledger();
		const sink = createSink("cross-instance");
		let authorized = true;
		await subscriber.subscribeLocal({
			subscriptionId: "space-a:user-1:cross-instance",
			channel: "private-space-a",
			subject: "opaque-user-1",
			reauthorize: async () => authorized,
			sink,
		});

		authorized = false;
		await revoker.revokeAuthority({
			channel: "private-space-a",
			subject: "opaque-user-1",
			idempotencyKey: "space-a:user-1:membership-v3",
		});
		expect(sink.closeReasons).toEqual([]);

		await subscriber.drain();
		expect(sink.frames).toEqual([]);
		expect(sink.closeReasons).toEqual(["access_revoked"]);
	});

	test("an externally managed transaction commits before exact local reconciliation", async () => {
		const events = ledger();
		const sink = createSink("raw-transaction");
		let authorized = true;
		await events.subscribeLocal({
			subscriptionId: "space-a:user-1:raw-transaction",
			channel: "private-space-a",
			subject: "opaque-user-1",
			reauthorize: async () => authorized,
			sink,
		});

		authorized = false;
		await setup.app.db.transaction(async (tx) => {
			await events.revokeAuthority(
				{
					channel: "private-space-a",
					subject: "opaque-user-1",
					idempotencyKey: "space-a:user-1:membership-raw-tx",
				},
				{ db: tx },
			);
		});
		for (
			let attempt = 0;
			sink.closeReasons.length === 0 && attempt < 100;
			attempt++
		) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		expect(sink.closeReasons).toEqual(["access_revoked"]);
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
