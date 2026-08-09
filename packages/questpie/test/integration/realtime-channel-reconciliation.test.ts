import { describe, expect, test } from "bun:test";

import { opaqueChannelAuthoritySubject } from "../../src/server/channels/authority.js";
import { channel } from "../../src/server/channels/channel-builder.js";
import { createChannels } from "../../src/server/channels/service.js";
import type {
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
