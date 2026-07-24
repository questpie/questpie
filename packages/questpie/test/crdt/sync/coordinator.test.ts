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

	async subscribe(
		input: Parameters<CrdtDrainNoticeRouter["subscribe"]>[0],
	): Promise<() => Promise<void>> {
		this.input = input;
		this.subscriptions++;
		return async () => {
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
			reconcile: async () => {
				drains.first++;
				return { behind: false };
			},
		});
		coordinator.register({
			id: "second",
			aggregateHash: "b".repeat(64),
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
});
