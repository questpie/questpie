import { describe, expect, it } from "bun:test";

import { createCrdtChangeWake } from "../../../src/server/modules/core/integrated/crdt/notice.js";
import {
	createCrdtDrainCoordinator,
	type CrdtDrainNoticeRouter,
} from "../../../src/server/modules/core/integrated/crdt/sync-coordinator.js";

class FakeRouter implements CrdtDrainNoticeRouter {
	private input?: Parameters<CrdtDrainNoticeRouter["subscribe"]>[0];
	subscriptions = 0;
	releases = 0;
	onRelease?: () => void;

	async subscribe(
		input: Parameters<CrdtDrainNoticeRouter["subscribe"]>[0],
	): Promise<() => Promise<void>> {
		this.input = input;
		this.subscriptions++;
		return async () => {
			this.onRelease?.();
			this.releases++;
			this.input = undefined;
		};
	}

	wake(aggregateHash: string): void {
		this.input?.onNotice({
			kind: "crdt",
			wake: {
				kind: "crdt",
				aggregateHash,
				aggregateEpoch: Number.MAX_SAFE_INTEGER,
				head: Number.MAX_SAFE_INTEGER,
				fenceGeneration: Number.MAX_SAFE_INTEGER,
				reason: "publish",
			},
		});
	}

	reconnect(): void {
		this.input?.onStateChange?.("connected");
	}

	overflow(): void {
		this.input?.onOverflow?.(1);
	}
}

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("CRDT HA drain coordinator", () => {
	it("saturates bigint wake hints without making them authoritative", () => {
		const wake = createCrdtChangeWake({
			namespace: "app",
			resourceId: "resource",
			resourceEpochId: "epoch",
			aggregateEpoch: 2n ** 63n,
			head: 2n ** 63n + 1n,
			fenceGeneration: 2n ** 63n + 2n,
			reason: "publish",
		});

		expect(wake.aggregateHash).toMatch(/^[a-f0-9]{64}$/);
		expect(wake.aggregateEpoch).toBe(Number.MAX_SAFE_INTEGER);
		expect(wake.head).toBe(Number.MAX_SAFE_INTEGER);
		expect(wake.fenceGeneration).toBe(Number.MAX_SAFE_INTEGER);
	});

	it("drains matching local sessions on lossy hints and all sessions on reconnect/overflow/poll", async () => {
		const router = new FakeRouter();
		const drains = { first: 0, second: 0 };
		const coordinator = createCrdtDrainCoordinator({
			router,
			healthyPollMs: 60_000,
			behindPollMs: 60_000,
		});
		await coordinator.start();
		const releaseFirst = coordinator.register({
			id: "first",
			aggregateHash: "a".repeat(64),
			terminate: async () => {},
			reconcile: async () => {
				drains.first++;
				return { behind: false };
			},
		});
		coordinator.register({
			id: "second",
			aggregateHash: "b".repeat(64),
			terminate: async () => {},
			reconcile: async () => {
				drains.second++;
				return { behind: false };
			},
		});

		router.wake("a".repeat(64));
		await settle();
		expect(drains).toEqual({ first: 1, second: 0 });

		router.reconnect();
		await settle();
		router.overflow();
		await settle();
		await coordinator.poll();
		expect(drains).toEqual({ first: 4, second: 3 });

		releaseFirst();
		router.wake("a".repeat(64));
		await settle();
		expect(drains.first).toBe(4);
		await coordinator.stop();
		expect(router.releases).toBe(1);
	});

	it("forwards broker wakes and reconnects to app-owned operational work", async () => {
		const router = new FakeRouter();
		const operational: string[] = [];
		const coordinator = createCrdtDrainCoordinator({
			router,
			healthyPollMs: 60_000,
			behindPollMs: 60_000,
			onOperationalWake: (reason) => operational.push(reason),
		});
		await coordinator.start();

		router.wake("a".repeat(64));
		router.reconnect();
		await settle();

		expect(operational).toEqual(["notice", "reconnect"]);
		await coordinator.stop();
	});

	it("coalesces duplicate/reordered wakes and never invokes a session concurrently", async () => {
		const router = new FakeRouter();
		let active = 0;
		let maximum = 0;
		let calls = 0;
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const coordinator = createCrdtDrainCoordinator({
			router,
			healthyPollMs: 60_000,
			behindPollMs: 60_000,
		});
		await coordinator.start();
		coordinator.register({
			id: "session",
			aggregateHash: "c".repeat(64),
			terminate: async () => {},
			reconcile: async () => {
				active++;
				maximum = Math.max(maximum, active);
				calls++;
				if (calls === 1) await gate;
				active--;
				return { behind: false };
			},
		});

		router.wake("c".repeat(64));
		router.wake("c".repeat(64));
		router.wake("c".repeat(64));
		await settle();
		expect(calls).toBe(1);
		release();
		await settle();
		await settle();
		expect(maximum).toBe(1);
		expect(calls).toBe(2);
		await coordinator.stop();
	});

	it("makes late callbacks inert after bounded stop", async () => {
		const router = new FakeRouter();
		let calls = 0;
		const coordinator = createCrdtDrainCoordinator({
			router,
			stopTimeoutMs: 5,
			healthyPollMs: 60_000,
			behindPollMs: 60_000,
		});
		await coordinator.start();
		coordinator.register({
			id: "session",
			aggregateHash: "d".repeat(64),
			terminate: async () => {
				await new Promise(() => {});
			},
			reconcile: async () => {
				calls++;
				await new Promise(() => {});
				return { behind: false };
			},
		});
		router.wake("d".repeat(64));
		await settle();

		await coordinator.stop();
		router.wake("d".repeat(64));
		await settle();
		expect(calls).toBe(1);
	});

	it("converges two nodes from shared durable bigint state without affinity or reliable wakes", async () => {
		const firstRouter = new FakeRouter();
		const secondRouter = new FakeRouter();
		let durableHead = 2n ** 60n;
		const cursors = { first: durableHead, second: durableHead };
		const first = createCrdtDrainCoordinator({
			router: firstRouter,
			healthyPollMs: 60_000,
			behindPollMs: 60_000,
		});
		const second = createCrdtDrainCoordinator({
			router: secondRouter,
			healthyPollMs: 60_000,
			behindPollMs: 60_000,
		});
		await Promise.all([first.start(), second.start()]);
		first.register({
			id: "first",
			aggregateHash: "e".repeat(64),
			terminate: async () => {},
			reconcile: async () => {
				cursors.first = durableHead;
				return { behind: false };
			},
		});
		second.register({
			id: "second",
			aggregateHash: "e".repeat(64),
			terminate: async () => {},
			reconcile: async () => {
				cursors.second = durableHead;
				return { behind: false };
			},
		});

		durableHead++;
		firstRouter.wake("e".repeat(64));
		firstRouter.wake("e".repeat(64));
		await settle();
		expect(cursors).toEqual({ first: durableHead, second: durableHead - 1n });

		await second.poll();
		expect(cursors.second).toBe(durableHead);
		durableHead++;
		secondRouter.reconnect();
		await settle();
		await first.poll();
		expect(cursors).toEqual({ first: durableHead, second: durableHead });
		await Promise.all([first.stop(), second.stop()]);
	});

	it("terminates idle sessions before releasing the router", async () => {
		const router = new FakeRouter();
		const events: string[] = [];
		router.onRelease = () => events.push("router");
		const coordinator = createCrdtDrainCoordinator({
			router,
			healthyPollMs: 60_000,
			behindPollMs: 60_000,
		});
		await coordinator.start();
		coordinator.register({
			id: "idle",
			aggregateHash: "f".repeat(64),
			reconcile: async () => ({ behind: false }),
			terminate: async () => {
				events.push("terminate");
			},
		});

		await coordinator.stop();

		expect(events).toEqual(["terminate", "router"]);
	});
});
