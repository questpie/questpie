import { describe, expect, test } from "bun:test";

import {
	MemoryRealtimeTopologyStore,
	RealtimeTopologyCoordinator,
	type RealtimeDesiredTopology,
} from "../../src/server/modules/core/integrated/realtime/topology-coordinator.js";
import type {
	ChangeBroker,
	ChangeWake,
} from "../../src/server/modules/core/integrated/realtime/transport.js";

class RecordingBroker implements ChangeBroker {
	wakes: ChangeWake[] = [];

	async start(): Promise<void> {}

	async publish(wake: ChangeWake): Promise<void> {
		this.wakes.push(wake);
	}

	async stop(): Promise<void> {}
}

const emptyTopology = (revision = 0): RealtimeDesiredTopology => ({
	protocol: "questpie-realtime-topology",
	version: 1,
	revision,
	topics: [],
	channels: [],
});

describe("realtime topology coordinator", () => {
	test("applies, deduplicates, rejects stale revisions, and detects conflicts", async () => {
		let now = new Date("2026-07-15T20:00:00.000Z");
		const broker = new RecordingBroker();
		const coordinator = new RealtimeTopologyCoordinator(
			new MemoryRealtimeTopologyStore(() => now),
			{
				broker,
				ownerId: "owner-a",
				now: () => now,
				leaseMs: 30_000,
				heartbeatMs: 0,
				reconcileMs: 0,
			},
		);
		const applied: RealtimeDesiredTopology[] = [];
		const session = await coordinator.open({
			sessionId: "session-a",
			token: "token-a",
			identity: "anonymous",
			topology: emptyTopology(),
			apply: async (topology) => applied.push(topology),
			onClose: async () => {},
		});
		const revisionOne: RealtimeDesiredTopology = {
			...emptyTopology(1),
			topics: [
				{
					id: "posts",
					topic: { resourceType: "collection", resource: "posts" },
				},
			],
		};

		expect(
			await coordinator.submit({
				sessionId: "session-a",
				token: "token-a",
				identity: "anonymous",
				topology: revisionOne,
			}),
		).toMatchObject({ status: "accepted", desiredRevision: 1 });
		await coordinator.reconcile();
		expect(applied).toEqual([revisionOne]);

		expect(
			await coordinator.submit({
				sessionId: "session-a",
				token: "token-a",
				identity: "anonymous",
				topology: revisionOne,
			}),
		).toMatchObject({ status: "duplicate", desiredRevision: 1 });
		expect(
			await coordinator.submit({
				sessionId: "session-a",
				token: "token-a",
				identity: "anonymous",
				topology: emptyTopology(0),
			}),
		).toMatchObject({ status: "stale", desiredRevision: 1 });
		expect(
			await coordinator.submit({
				sessionId: "session-a",
				token: "token-a",
				identity: "anonymous",
				topology: { ...emptyTopology(1), channels: [] },
			}),
		).toMatchObject({ status: "conflict", desiredRevision: 1 });
		expect(broker.wakes).toHaveLength(1);

		await session.close();
		await coordinator.stop();
	});

	test("fences an expired owner and rejects its capability uniformly", async () => {
		let now = new Date("2026-07-15T20:00:00.000Z");
		let closed = 0;
		const coordinator = new RealtimeTopologyCoordinator(
			new MemoryRealtimeTopologyStore(() => now),
			{
				ownerId: "owner-a",
				now: () => now,
				leaseMs: 30_000,
				heartbeatMs: 0,
				reconcileMs: 0,
			},
		);
		await coordinator.open({
			sessionId: "session-a",
			token: "token-a",
			identity: "anonymous",
			topology: emptyTopology(),
			apply: async () => {},
			onClose: async () => {
				closed += 1;
			},
		});
		expect(
			await coordinator.submit({
				sessionId: "session-a",
				token: "wrong-token",
				identity: "anonymous",
				topology: emptyTopology(1),
			}),
		).toEqual({ status: "unavailable" });
		expect(
			await coordinator.submit({
				sessionId: "session-a",
				token: "token-a",
				identity: "someone-else",
				topology: emptyTopology(1),
			}),
		).toEqual({ status: "unavailable" });
		now = new Date(now.getTime() + 30_001);
		await coordinator.reconcile();

		expect(closed).toBe(1);
		expect(
			await coordinator.submit({
				sessionId: "session-a",
				token: "wrong-token",
				identity: "someone-else",
				topology: emptyTopology(1),
			}),
		).toEqual({ status: "unavailable" });
		await coordinator.stop();
	});

	test("closes the session without marking a failed owner apply", async () => {
		const coordinator = new RealtimeTopologyCoordinator(
			new MemoryRealtimeTopologyStore(),
			{
				ownerId: "owner-a",
				heartbeatMs: 0,
				reconcileMs: 0,
			},
		);
		let closed = 0;
		await coordinator.open({
			sessionId: "session-a",
			token: "token-a",
			identity: "anonymous",
			topology: emptyTopology(),
			apply: async () => {
				throw new Error("owner apply failed");
			},
			onClose: () => {
				closed += 1;
			},
		});
		const desired = {
			...emptyTopology(1),
			topics: [
				{
					id: "posts",
					topic: { resourceType: "collection", resource: "posts" },
				},
			],
		};

		expect(
			await coordinator.submit({
				sessionId: "session-a",
				token: "token-a",
				identity: "anonymous",
				topology: desired,
			}),
		).toMatchObject({ status: "accepted", appliedRevision: 0 });
		expect(closed).toBe(1);
		expect(
			await coordinator.submit({
				sessionId: "session-a",
				token: "token-a",
				identity: "anonymous",
				topology: desired,
			}),
		).toEqual({ status: "unavailable" });
		await coordinator.stop();
	});

	test("heals a dropped cross-instance wake from durable state", async () => {
		const store = new MemoryRealtimeTopologyStore();
		const owner = new RealtimeTopologyCoordinator(store, {
			ownerId: "owner-a",
			heartbeatMs: 0,
			reconcileMs: 0,
		});
		const handler = new RealtimeTopologyCoordinator(store, {
			ownerId: "owner-b",
			heartbeatMs: 0,
			reconcileMs: 0,
		});
		const applied: RealtimeDesiredTopology[] = [];
		await owner.open({
			sessionId: "session-a",
			token: "token-a",
			identity: "anonymous",
			topology: emptyTopology(),
			apply: async (topology) => applied.push(topology),
			onClose: async () => {},
		});
		const desired = {
			...emptyTopology(1),
			topics: [
				{
					id: "posts",
					topic: { resourceType: "collection", resource: "posts" },
				},
			],
		};

		expect(
			await handler.submit({
				sessionId: "session-a",
				token: "token-a",
				identity: "anonymous",
				topology: desired,
			}),
		).toMatchObject({ status: "accepted" });
		expect(applied).toEqual([]);
		await owner.reconcile();
		expect(applied).toEqual([desired]);

		await Promise.all([owner.stop(), handler.stop()]);
	});
});
