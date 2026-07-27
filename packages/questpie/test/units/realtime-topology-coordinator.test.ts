import { describe, expect, test } from "bun:test";

import type { RealtimeObservation } from "../../src/server/modules/core/integrated/realtime/observer.js";
import {
	MAX_REALTIME_TOPOLOGY_BYTES,
	MemoryRealtimeTopologyStore,
	RealtimeTopologyApplyRejectedError,
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

class BlockingTopologyStore extends MemoryRealtimeTopologyStore {
	getOwnedCalls = 0;
	private releaseFirstRead!: () => void;
	private firstReadStartedResolve!: () => void;
	readonly firstReadStarted = new Promise<void>((resolve) => {
		this.firstReadStartedResolve = resolve;
	});
	private readonly firstReadRelease = new Promise<void>((resolve) => {
		this.releaseFirstRead = resolve;
	});

	override async getOwned(
		input: Parameters<MemoryRealtimeTopologyStore["getOwned"]>[0],
	) {
		this.getOwnedCalls += 1;
		if (this.getOwnedCalls === 1) {
			this.firstReadStartedResolve();
			await this.firstReadRelease;
		}
		return super.getOwned(input);
	}

	release(): void {
		this.releaseFirstRead();
	}
}

const emptyTopology = (revision = 0): RealtimeDesiredTopology => ({
	protocol: "questpie-realtime-topology",
	version: 2,
	revision,
	subscriptions: [],
});

describe("realtime topology coordinator", () => {
	test("expires an abrupt managed-provider client lease and releases owned work", async () => {
		let now = new Date("2026-07-15T20:00:00.000Z");
		let admissionSlots = 1;
		let crdtBindings = 1;
		let closes = 0;
		const coordinator = new RealtimeTopologyCoordinator(
			new MemoryRealtimeTopologyStore(() => now),
			{
				leaseMs: 120_000,
				heartbeatMs: 5,
				reconcileMs: 0,
			},
		);
		await coordinator.open({
			sessionId: "session-a",
			token: "token-a",
			identity: "user-session:user-session-a",
			topology: emptyTopology(),
			clientLeaseMs: 45_000,
			apply: async () => {},
			onClose: async () => {
				closes += 1;
				admissionSlots -= 1;
				crdtBindings -= 1;
			},
		});

		now = new Date(now.getTime() + 40_000);
		expect(
			await coordinator.submit({
				sessionId: "session-a",
				token: "token-a",
				identity: "user-session:user-session-a",
				topology: emptyTopology(),
			}),
		).toMatchObject({ status: "duplicate" });
		now = new Date(now.getTime() + 40_000);
		await Bun.sleep(20);
		expect(closes).toBe(0);

		now = new Date(now.getTime() + 45_001);
		await Bun.sleep(20);
		expect({ closes, admissionSlots, crdtBindings }).toEqual({
			closes: 1,
			admissionSlots: 0,
			crdtBindings: 0,
		});
		expect(
			await coordinator.authorizeSession({
				sessionId: "session-a",
				token: "token-a",
				identity: "user-session:user-session-a",
			}),
		).toBeNull();
		await coordinator.stop();
	});

	test("proves a live edge capability without renewing it or accepting confused identity", async () => {
		let now = new Date("2026-07-15T20:00:00.000Z");
		const coordinator = new RealtimeTopologyCoordinator(
			new MemoryRealtimeTopologyStore(() => now),
			{
				leaseMs: 30_000,
				heartbeatMs: 0,
				reconcileMs: 0,
			},
		);
		const opened = await coordinator.open({
			sessionId: "session-a",
			token: "token-a",
			identity: "user-session:user-session-a",
			topology: emptyTopology(),
			apply: async () => {},
			onClose: async () => {},
		});

		expect(
			await coordinator.authorizeSession({
				sessionId: "session-a",
				token: "token-a",
				identity: "user-session:user-session-a",
			}),
		).toEqual({
			sessionKey:
				"fa57a52dbf08190218529730a3e99db6946c6c29220fb6e0551e21598b0b05db",
			ownerGeneration: opened.generation,
		});
		expect(
			await coordinator.authorizeSession({
				sessionId: "session-a",
				token: "wrong-token",
				identity: "user-session:user-session-a",
			}),
		).toBeNull();
		expect(
			await coordinator.authorizeSession({
				sessionId: "session-a",
				token: "token-a",
				identity: "oauth:confused",
			}),
		).toBeNull();

		now = new Date(now.getTime() + 30_001);
		expect(
			await coordinator.authorizeSession({
				sessionId: "session-a",
				token: "token-a",
				identity: "user-session:user-session-a",
			}),
		).toBeNull();
		await coordinator.stop();
	});

	test("uses a bounded idle reconciliation cadence by default", async () => {
		const observations: RealtimeObservation[] = [];
		const coordinator = new RealtimeTopologyCoordinator(
			new MemoryRealtimeTopologyStore(),
			{
				heartbeatMs: 0,
				observer: { record: (event) => observations.push(event) },
			},
		);
		await coordinator.open({
			sessionId: "session-a",
			token: "token-a",
			identity: "anonymous",
			topology: emptyTopology(),
			apply: async () => {},
			onClose: async () => {},
		});

		await Bun.sleep(1_100);

		expect(
			observations.filter(
				(event) =>
					event.type === "topology.lifecycle" &&
					event.phase === "reconcile" &&
					event.outcome === "started",
			),
		).toHaveLength(0);
		await coordinator.stop();
	});

	test("coalesces reconcile requests while a session read is in flight", async () => {
		const store = new BlockingTopologyStore();
		const coordinator = new RealtimeTopologyCoordinator(store, {
			ownerId: "owner-a",
			heartbeatMs: 0,
			reconcileMs: 0,
		});
		const session = await coordinator.open({
			sessionId: "session-a",
			token: "token-a",
			identity: "anonymous",
			topology: emptyTopology(),
			apply: async () => {},
			onClose: async () => {},
		});
		const wake: ChangeWake = {
			kind: "topology-maybe-advanced",
			sessionKey:
				"fa57a52dbf08190218529730a3e99db6946c6c29220fb6e0551e21598b0b05db",
			ownerId: "owner-a",
			ownerGeneration: session.generation,
			desiredRevision: 1,
			reason: "submit",
		};

		coordinator.onWake(wake);
		await store.firstReadStarted;
		for (let index = 0; index < 20; index += 1) coordinator.onWake(wake);
		store.release();
		await coordinator.reconcile();

		expect(store.getOwnedCalls).toBeLessThanOrEqual(2);
		await coordinator.stop();
	});

	test("applies, deduplicates, rejects stale revisions, and detects conflicts", async () => {
		let now = new Date("2026-07-15T20:00:00.000Z");
		const broker = new RecordingBroker();
		const observations: RealtimeObservation[] = [];
		const coordinator = new RealtimeTopologyCoordinator(
			new MemoryRealtimeTopologyStore(() => now),
			{
				broker,
				ownerId: "owner-a",
				now: () => now,
				leaseMs: 30_000,
				heartbeatMs: 0,
				reconcileMs: 0,
				observer: { record: (event) => observations.push(event) },
			},
		);
		const applied: RealtimeDesiredTopology[] = [];
		const session = await coordinator.open({
			sessionId: "session-a",
			token: "token-a",
			identity: "anonymous",
			topology: emptyTopology(),
			apply: async ({ topology }) => {
				applied.push(topology);
			},
			onClose: async () => {},
		});
		const revisionOne: RealtimeDesiredTopology = {
			...emptyTopology(1),
			subscriptions: [
				{
					kind: "query",
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
		expect(broker.wakes).toEqual([
			{
				kind: "topology-maybe-advanced",
				sessionKey: expect.any(String),
				ownerId: "owner-a",
				ownerGeneration: 1,
				desiredRevision: 1,
				reason: "submit",
			},
		]);
		expect(JSON.stringify(broker.wakes)).not.toContain("session-a");
		expect(JSON.stringify(broker.wakes)).not.toContain("token-a");
		expect(JSON.stringify(broker.wakes)).not.toContain("anonymous");
		expect(JSON.stringify(broker.wakes)).not.toContain("topics");
		await coordinator.reconcile();
		expect(applied).toEqual([revisionOne]);
		expect(observations).toContainEqual({
			type: "topology.lifecycle",
			phase: "reconcile",
			outcome: "current",
			desiredRevision: 1,
			appliedRevision: 1,
		});
		expect(observations).toContainEqual({
			type: "topology.lifecycle",
			phase: "apply",
			outcome: "applied",
			desiredRevision: 1,
			appliedRevision: 1,
		});
		expect(JSON.stringify(observations)).not.toContain("session-a");
		expect(JSON.stringify(observations)).not.toContain("token-a");

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
				topology: {
					...emptyTopology(1),
					subscriptions: [
						{ kind: "crdt", id: "changed", bindingId: "binding-one" },
					],
				},
			}),
		).toMatchObject({ status: "conflict", desiredRevision: 1 });
		expect(broker.wakes).toHaveLength(1);
		expect(
			await coordinator.submit({
				sessionId: "session-a",
				token: "token-a",
				identity: "anonymous",
				topology: { ...emptyTopology(2), version: 1 } as never,
			}),
		).toMatchObject({ status: "unsupported" });
		expect(
			await coordinator.submit({
				sessionId: "session-a",
				token: "token-a",
				identity: "anonymous",
				topology: {
					...emptyTopology(2),
					subscriptions: [
						{ kind: "query", id: "duplicate", topic: {} },
						{
							kind: "channel",
							id: "duplicate",
							channel: "room",
							params: {},
						},
					],
				},
			}),
		).toMatchObject({ status: "invalid" });
		expect(
			await coordinator.submit({
				sessionId: "session-a",
				token: "token-a",
				identity: "anonymous",
				topology: {
					...emptyTopology(2),
					subscriptions: [
						{
							kind: "crdt",
							id: "document",
							bindingId: "binding-one",
							ticket: "must-not-cross-the-edge",
						} as never,
					],
				},
			}),
		).toMatchObject({ status: "invalid" });
		expect(
			await coordinator.submit({
				sessionId: "session-a",
				token: "token-a",
				identity: "anonymous",
				topology: {
					...emptyTopology(2),
					subscriptions: [
						{
							kind: "query",
							id: "oversized",
							topic: { value: "x".repeat(MAX_REALTIME_TOPOLOGY_BYTES) },
						},
					],
				},
			}),
		).toMatchObject({ status: "invalid" });
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
			subscriptions: [
				{
					kind: "query" as const,
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

	test("keeps the previous applied revision after candidate admission rejects", async () => {
		const coordinator = new RealtimeTopologyCoordinator(
			new MemoryRealtimeTopologyStore(),
			{ ownerId: "owner-a", heartbeatMs: 0, reconcileMs: 0 },
		);
		const applied: number[] = [];
		let closed = 0;
		await coordinator.open({
			sessionId: "session-a",
			token: "token-a",
			identity: "anonymous",
			topology: emptyTopology(),
			apply: async ({ topology }) => {
				if (topology.revision === 1) {
					throw new RealtimeTopologyApplyRejectedError([
						{
							id: "missing",
							kind: "query",
							code: "REALTIME_SUBSCRIPTION_REJECTED",
							message: "Unavailable on the owner",
						},
					]);
				}
				applied.push(topology.revision);
			},
			onClose: async () => {
				closed += 1;
			},
		});

		expect(
			await coordinator.submit({
				sessionId: "session-a",
				token: "token-a",
				identity: "anonymous",
				topology: {
					...emptyTopology(1),
					subscriptions: [{ kind: "query", id: "missing", topic: {} }],
				},
			}),
		).toMatchObject({ status: "accepted", appliedRevision: 0 });
		expect(applied).toEqual([]);
		expect(closed).toBe(0);
		expect(
			await coordinator.submit({
				sessionId: "session-a",
				token: "token-a",
				identity: "anonymous",
				topology: {
					...emptyTopology(2),
					subscriptions: [
						{ kind: "crdt", id: "document", bindingId: "binding-one" },
					],
				},
			}),
		).toMatchObject({ status: "accepted", appliedRevision: 0 });
		expect(applied).toEqual([2]);
		await coordinator.stop();
		expect(closed).toBe(1);
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
			apply: async ({ topology }) => {
				applied.push(topology);
			},
			onClose: async () => {},
		});
		const desired = {
			...emptyTopology(1),
			subscriptions: [
				{
					kind: "query" as const,
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

	test("fences late owner work with its generation and AbortSignal", async () => {
		const coordinator = new RealtimeTopologyCoordinator(
			new MemoryRealtimeTopologyStore(),
			{ ownerId: "owner-a", heartbeatMs: 0, reconcileMs: 0 },
		);
		let releaseApply!: () => void;
		let applyStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			applyStarted = resolve;
		});
		const blocked = new Promise<void>((resolve) => {
			releaseApply = resolve;
		});
		let observedGeneration = 0;
		let observedSignal: AbortSignal | undefined;
		const session = await coordinator.open({
			sessionId: "session-a",
			token: "token-a",
			identity: "anonymous",
			topology: emptyTopology(),
			apply: async ({ ownerGeneration, signal }) => {
				observedGeneration = ownerGeneration;
				observedSignal = signal;
				applyStarted();
				await blocked;
			},
			onClose: async () => {},
		});
		const submit = coordinator.submit({
			sessionId: "session-a",
			token: "token-a",
			identity: "anonymous",
			topology: {
				...emptyTopology(1),
				subscriptions: [
					{ kind: "crdt", id: "document", bindingId: "binding-one" },
				],
			},
		});
		await started;
		const close = session.close();

		expect(observedGeneration).toBe(session.generation);
		expect(observedSignal?.aborted).toBe(true);
		releaseApply();
		await Promise.all([submit, close]);
		await coordinator.stop();
	});
});
