import { describe, expect, test } from "bun:test";

import { opaqueChannelAuthoritySubject } from "../../src/server/channels/authority.js";
import { channel } from "../../src/server/channels/channel-builder.js";
import { createChannels } from "../../src/server/channels/service.js";
import {
	ChannelEventLedger,
	hashResolvedChannel,
} from "../../src/server/modules/core/integrated/realtime/channel-event-ledger.js";
import { RealtimeService } from "../../src/server/modules/core/integrated/realtime/service.js";
import type {
	ChangeBroker,
	ChangeWake,
	ClientCloseReason,
	ClientSink,
	DeliveryClass,
} from "../../src/server/modules/core/integrated/realtime/transport.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { createTestDb, runTestDbMigrations } from "../utils/test-db.js";

async function waitFor(assertion: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt++) {
		if (assertion()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("Timed out waiting for channel reconciliation");
}

/** Delivers only the wakes a test emits; publishes are dropped. */
class EmittingChangeBroker implements ChangeBroker {
	private onWake: ((wake: ChangeWake) => void) | undefined;

	async start(input: Parameters<ChangeBroker["start"]>[0]): Promise<void> {
		this.onWake = input.onWake;
	}

	async publish(_wake: ChangeWake): Promise<void> {}

	async stop(): Promise<void> {
		this.onWake = undefined;
	}

	emit(wake: ChangeWake): void {
		this.onWake?.(wake);
	}
}

describe("channel wake ownership", () => {
	const roomWake: ChangeWake = {
		kind: "channel-events-maybe-advanced",
		channelHash: hashResolvedChannel("private-room-1"),
		reason: "publish",
	};

	function observeChannel(realtime: RealtimeService) {
		const ledger = (realtime as any).channelEventLedger;
		const drain = ledger.drain.bind(ledger);
		const observed = { drains: 0, frames: [] as Array<Record<string, any>> };
		ledger.drain = (...args: unknown[]) => {
			observed.drains += 1;
			return drain(...args);
		};
		const sink: ClientSink = {
			sessionId: "channel-wake-ownership",
			async write(frame: Uint8Array) {
				observed.frames.push(JSON.parse(new TextDecoder().decode(frame)));
				return { status: "accepted", bufferedBytes: 0 };
			},
			async close() {},
		};
		return { observed, sink };
	}

	async function expectOneDrainPerWake(
		realtime: RealtimeService,
		broker: EmittingChangeBroker,
		observed: ReturnType<typeof observeChannel>["observed"],
		db: any,
	): Promise<void> {
		// Another node's commit; only the broker wake can deliver it here.
		await new ChannelEventLedger(db, undefined, undefined).append({
			channel: "private-room-1",
			event: "message",
			schemaIdentity: "room:message",
			data: { id: "woken" },
		});
		observed.drains = 0;
		broker.emit(roomWake);
		await waitFor(() => observed.frames.length === 1);
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(observed.frames.map((frame) => frame.data.id)).toEqual(["woken"]);
		expect(observed.drains).toBe(1);
	}

	test("a binding opened after initialize relies on its subscription alone", async () => {
		const database = await createTestDb();
		const broker = new EmittingChangeBroker();
		const setup = await buildMockApp(
			{},
			{
				db: { pglite: database },
				realtime: {
					changeBroker: broker,
					pollIntervalMs: 0,
					retentionDays: 0,
					rowLiveQueries: false,
				},
			},
		);
		try {
			await runTestDbMigrations(setup.app);
			const realtime = setup.app.realtime as RealtimeService;
			// The realtime service factory initializes at boot.
			await realtime.initialize();
			const { observed, sink } = observeChannel(realtime);
			const release = await realtime.subscribeChannel({
				subscriptionId: "room-1:after-initialize",
				channel: "private-room-1",
				sink,
			});

			await expectOneDrainPerWake(realtime, broker, observed, setup.app.db);
			await release();
		} finally {
			await setup.cleanup();
			await database.close();
		}
	});

	test("a binding opened before initialize hands its drains over", async () => {
		const database = await createTestDb();
		const setup = await buildMockApp({}, { db: { pglite: database } });
		const broker = new EmittingChangeBroker();
		const realtime = new RealtimeService(setup.app.db as any, {
			changeBroker: broker,
			pollIntervalMs: 0,
			retentionDays: 0,
		});
		try {
			await runTestDbMigrations(setup.app);
			const { observed, sink } = observeChannel(realtime);
			const release = await realtime.subscribeChannel({
				subscriptionId: "room-1:before-initialize",
				channel: "private-room-1",
				sink,
			});
			await realtime.initialize();

			await expectOneDrainPerWake(realtime, broker, observed, setup.app.db);
			await release();
		} finally {
			await realtime.destroy();
			await setup.cleanup();
			await database.close();
		}
	});
});

describe("default SSE channel reconciliation", () => {
	test("a demand-driven ledger poll heals a dropped authority wake and stops with the last binding", async () => {
		const database = await createTestDb();
		const definitions = {
			space: channel("space-[spaceId]").authorize(true),
		};
		const revoker = await buildMockApp(
			{ channels: definitions },
			{
				db: { pglite: database },
				realtime: {
					pollIntervalMs: 20,
					retentionDays: 0,
					rowLiveQueries: false,
				},
			},
		);
		const subscriber = await buildMockApp(
			{},
			{
				db: { pglite: database },
				realtime: {
					pollIntervalMs: 20,
					retentionDays: 0,
					rowLiveQueries: false,
				},
			},
		);
		try {
			await runTestDbMigrations(subscriber.app);
			const realtime = subscriber.app.realtime as any;
			let topologyStarts = 0;
			realtime.topologyCoordinator.start = async () => {
				topologyStarts += 1;
			};
			expect(
				await subscriber.app.realtime.getClientTransportConfig({}),
			).toEqual({ transport: "sse" });
			expect(topologyStarts).toBe(0);
			let ledgerDrains = 0;
			const originalDrain = realtime.channelEventLedger.drain.bind(
				realtime.channelEventLedger,
			);
			realtime.channelEventLedger.drain = async (...args: unknown[]) => {
				ledgerDrains += 1;
				return originalDrain(...args);
			};
			const deniedSink: ClientSink = {
				sessionId: "default-sse-denied-channel",
				async write() {
					return { status: "accepted", bufferedBytes: 0 };
				},
				async close() {},
			};
			const releaseDenied = await subscriber.app.realtime.subscribeChannel({
				subscriptionId: "space-a:user-1:denied",
				channel: "private-space-a",
				subject: opaqueChannelAuthoritySubject({
					kind: "user",
					id: "user-1",
				}),
				reauthorize: async () => false,
				sink: deniedSink,
			});
			const drainsBeforeDeniedWait = ledgerDrains;
			await new Promise((resolve) => setTimeout(resolve, 60));
			expect(ledgerDrains).toBe(drainsBeforeDeniedWait);
			await releaseDenied();

			const closeReasons: ClientCloseReason[] = [];
			const sink: ClientSink = {
				sessionId: "default-sse-channel-reconciliation",
				async write(_frame: Uint8Array, _delivery: DeliveryClass) {
					return { status: "accepted", bufferedBytes: 0 };
				},
				async close(reason) {
					closeReasons.push(reason);
				},
			};
			let authorized = true;
			const release = await subscriber.app.realtime.subscribeChannel({
				subscriptionId: "space-a:user-1:dropped-wake",
				channel: "private-space-a",
				subject: opaqueChannelAuthoritySubject({
					kind: "user",
					id: "user-1",
				}),
				reauthorize: async () => authorized,
				sink,
			});
			expect(topologyStarts).toBe(0);

			authorized = false;
			const channels = createChannels(definitions, revoker.app.realtime, {
				accessMode: "system",
				db: revoker.app.db,
			} as any);
			await expect(
				channels.space({ spaceId: "a" }).invalidateAuthority({
					subject: { kind: "user", id: "user-1" },
					idempotencyKey: "space-a:user-1:dropped-wake",
				}),
			).resolves.toEqual({
				generation: 1,
				transportEffect: "exact-binding",
			});
			expect(closeReasons).toEqual([]);
			await waitFor(() => closeReasons.length === 1);
			expect(closeReasons).toEqual(["access_revoked"]);
			expect(topologyStarts).toBe(0);

			const drainsAfterInternalClose = ledgerDrains;
			await new Promise((resolve) => setTimeout(resolve, 60));
			expect(ledgerDrains).toBe(drainsAfterInternalClose);
			await release();
		} finally {
			await Promise.all([revoker.cleanup(), subscriber.cleanup()]);
			await database.close();
		}
	});
});
