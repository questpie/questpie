import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { SseChannelPresenceRegistry } from "../../src/server/modules/core/integrated/realtime/sse-channel-presence.js";
import type {
	ClientCloseReason,
	ClientSink,
	DeliveryClass,
} from "../../src/server/modules/core/integrated/realtime/transport.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { createTestDb, runTestDbMigrations } from "../utils/test-db.js";

type PresenceSink = ClientSink & {
	rosters: Array<readonly Record<string, unknown>[]>;
};

function createSink(sessionId: string): PresenceSink {
	const decoder = new TextDecoder();
	return {
		sessionId,
		rosters: [],
		async write(frame: Uint8Array, _delivery: DeliveryClass) {
			const data = decoder
				.decode(frame)
				.split("\n")
				.find((line) => line.startsWith("data: "))
				?.slice(6);
			if (data) {
				const payload = JSON.parse(data) as {
					members: readonly Record<string, unknown>[];
				};
				this.rosters.push(payload.members);
			}
			return { status: "accepted", bufferedBytes: 0 } as const;
		},
		async close(_reason: ClientCloseReason) {},
	};
}

async function waitFor(assertion: () => boolean, timeoutMs = 1000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (assertion()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("Timed out waiting for presence assertion");
}

describe("core channel presence", () => {
	let testDb: Awaited<ReturnType<typeof createTestDb>>;
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	const registries = new Set<SseChannelPresenceRegistry>();

	beforeAll(async () => {
		testDb = await createTestDb();
		setup = await buildMockApp({}, { db: { pglite: testDb } });
		await runTestDbMigrations(setup.app);
	});

	afterAll(async () => {
		for (const registry of registries) {
			await registry.destroy();
		}
		await setup.cleanup();
		await testDb.close();
	});

	function registry(
		config: Partial<
			ConstructorParameters<typeof SseChannelPresenceRegistry>[1]
		> = {},
	) {
		const value = new SseChannelPresenceRegistry(setup.app.db, {
			leaseMs: 80,
			heartbeatMs: 20,
			reconciliationMs: 10,
			...config,
		});
		registries.add(value);
		return value;
	}

	test("reconciles the same isolated roster across application instances", async () => {
		const first = registry();
		const second = registry();
		const firstSink = createSink("first");
		const secondSink = createSink("second");
		const otherRoomSink = createSink("other-room");

		const stopFirst = await first.register({
			channel: "presence-room-one",
			connectionId: "first",
			principalId: "user:one",
			sink: firstSink,
			data: { id: "one" },
		});
		const stopSecondMember = await second.register({
			channel: "presence-room-one",
			connectionId: "second-member",
			principalId: "user:two",
			sink: secondSink,
			data: { id: "two" },
		});
		const stopOtherRoom = await second.register({
			channel: "presence-room-two",
			connectionId: "other-room",
			principalId: "user:three",
			sink: otherRoomSink,
			data: { id: "three" },
		});

		await waitFor(
			() =>
				firstSink.rosters.at(-1)?.length === 2 &&
				secondSink.rosters.at(-1)?.length === 2,
		);
		expect(firstSink.rosters.at(-1)).toEqual([{ id: "one" }, { id: "two" }]);
		expect(secondSink.rosters.at(-1)).toEqual([{ id: "one" }, { id: "two" }]);
		expect(otherRoomSink.rosters.at(-1)).toEqual([{ id: "three" }]);

		await stopFirst();
		await stopSecondMember();
		await stopOtherRoom();
	});

	test("aggregates multiple tabs into one principal join and one final leave", async () => {
		const tabs = registry();
		const observer = registry();
		const firstTabSink = createSink("first-tab");
		const secondTabSink = createSink("second-tab");
		const observerSink = createSink("tab-observer");

		const stopObserver = await observer.register({
			channel: "presence-room-tabs",
			connectionId: "observer",
			principalId: "user:two",
			sink: observerSink,
			data: { id: "two" },
		});
		const stopFirstTab = await tabs.register({
			channel: "presence-room-tabs",
			connectionId: "first-tab",
			principalId: "user:one",
			sink: firstTabSink,
			data: { id: "one" },
		});
		await waitFor(() => observerSink.rosters.at(-1)?.length === 2);
		const observerUpdatesAfterJoin = observerSink.rosters.length;
		const firstTabUpdatesAfterJoin = firstTabSink.rosters.length;

		const stopSecondTab = await tabs.register({
			channel: "presence-room-tabs",
			connectionId: "second-tab",
			principalId: "user:one",
			sink: secondTabSink,
			data: { id: "one" },
		});
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(secondTabSink.rosters).toEqual([[{ id: "one" }, { id: "two" }]]);
		expect(observerSink.rosters).toHaveLength(observerUpdatesAfterJoin);
		expect(firstTabSink.rosters).toHaveLength(firstTabUpdatesAfterJoin);

		await stopFirstTab();
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(observerSink.rosters).toHaveLength(observerUpdatesAfterJoin);

		await stopSecondTab();
		await waitFor(() => observerSink.rosters.at(-1)?.length === 1);
		expect(observerSink.rosters).toHaveLength(observerUpdatesAfterJoin + 1);
		expect(observerSink.rosters.at(-1)).toEqual([{ id: "two" }]);

		await stopObserver();
	});

	test("expires a member after its instance disappears without teardown", async () => {
		const observer = registry();
		const crashed = registry();
		const observerSink = createSink("observer");
		const crashedSink = createSink("crashed");

		const stopObserver = await observer.register({
			channel: "presence-room-crash",
			connectionId: "observer",
			principalId: "user:observer",
			sink: observerSink,
			data: { id: "observer" },
		});
		await crashed.register({
			channel: "presence-room-crash",
			connectionId: "crashed",
			principalId: "user:crashed",
			sink: crashedSink,
			data: { id: "crashed" },
		});
		await waitFor(() => observerSink.rosters.at(-1)?.length === 2);

		await crashed.destroy({ removeMemberships: false });
		registries.delete(crashed);
		await waitFor(
			() =>
				observerSink.rosters.at(-1)?.length === 1 &&
				observerSink.rosters.at(-1)?.[0]?.id === "observer",
			500,
		);
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(observerSink.rosters).toHaveLength(3);

		await stopObserver();
	});

	test("reconnects the same leased connection without a duplicate principal join", async () => {
		const observer = registry();
		const original = registry();
		const observerSink = createSink("reconnect-observer");
		const originalSink = createSink("reconnect-original");

		const stopObserver = await observer.register({
			channel: "presence-room-reconnect",
			connectionId: "observer",
			principalId: "user:observer",
			sink: observerSink,
			data: { id: "observer" },
		});
		await original.register({
			channel: "presence-room-reconnect",
			connectionId: "stable-connection",
			principalId: "user:member",
			sink: originalSink,
			data: { id: "member" },
		});
		await waitFor(() => observerSink.rosters.at(-1)?.length === 2);
		const updatesBeforeReconnect = observerSink.rosters.length;

		await original.destroy({ removeMemberships: false });
		registries.delete(original);
		const replacement = registry();
		const stopReplacement = await replacement.register({
			channel: "presence-room-reconnect",
			connectionId: "stable-connection",
			principalId: "user:member",
			sink: createSink("reconnect-replacement"),
			data: { id: "member" },
		});
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(observerSink.rosters).toHaveLength(updatesBeforeReconnect);
		expect(observerSink.rosters.at(-1)).toEqual([
			{ id: "member" },
			{ id: "observer" },
		]);

		await stopReplacement();
		await waitFor(() => observerSink.rosters.at(-1)?.length === 1);
		await stopObserver();
	});

	test("rejects anonymous, oversized, and over-cap presence joins", async () => {
		const limited = registry({ maxMembers: 1, maxMemberBytes: 24 });
		const sink = createSink("limits");

		await expect(
			limited.register({
				channel: "presence-limits",
				connectionId: "anonymous",
				principalId: "",
				sink,
				data: { id: "anonymous" },
			}),
		).rejects.toThrow("requires a principal");
		await expect(
			limited.register({
				channel: "presence-limits",
				connectionId: "oversized",
				principalId: "user:oversized",
				sink,
				data: { description: "this payload is too large" },
			}),
		).rejects.toThrow("too large");

		const stop = await limited.register({
			channel: "presence-limits",
			connectionId: "one",
			principalId: "user:one",
			sink,
			data: { id: "one" },
		});
		await expect(
			limited.register({
				channel: "presence-limits",
				connectionId: "two",
				principalId: "user:two",
				sink: createSink("second"),
				data: { id: "two" },
			}),
		).rejects.toThrow("member limit exceeded");
		expect(sink.rosters.at(-1)).toEqual([{ id: "one" }]);

		await stop();

		const concurrent = registry({ maxMembers: 1 });
		const attempts = await Promise.allSettled([
			concurrent.register({
				channel: "presence-concurrent-limit",
				connectionId: "concurrent-one",
				principalId: "user:concurrent-one",
				sink: createSink("concurrent-one"),
				data: { id: "one" },
			}),
			concurrent.register({
				channel: "presence-concurrent-limit",
				connectionId: "concurrent-two",
				principalId: "user:concurrent-two",
				sink: createSink("concurrent-two"),
				data: { id: "two" },
			}),
		]);
		expect(attempts.map((attempt) => attempt.status).sort()).toEqual([
			"fulfilled",
			"rejected",
		]);
		for (const attempt of attempts) {
			if (attempt.status === "fulfilled") await attempt.value();
		}
	});
});
