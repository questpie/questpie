import { describe, expect, it } from "bun:test";

import {
	BoundedQueue,
	BoundedSemaphore,
} from "../../../src/server/modules/core/integrated/collaboration/bounded.js";
import {
	CoreNoticeRouter,
	type CoreNotice,
} from "../../../src/server/modules/core/integrated/collaboration/notice-router.js";
import type {
	ChangeBroker,
	ChangeBrokerState,
	ChangeWake,
} from "../../../src/server/modules/core/integrated/realtime/transport.js";
import { normalizeChangeWake } from "../../../src/server/modules/core/integrated/realtime/transport.js";

class TestBroker implements ChangeBroker {
	startCount = 0;
	stopCount = 0;
	published: ChangeWake[] = [];
	private input?: {
		onWake: (wake: ChangeWake) => void;
		onError: (error: unknown) => void;
		onStateChange?: (state: ChangeBrokerState) => void;
	};

	async start(input: NonNullable<TestBroker["input"]>): Promise<void> {
		this.startCount += 1;
		this.input = input;
	}

	async publish(wake: ChangeWake): Promise<void> {
		this.published.push(wake);
	}

	async stop(): Promise<void> {
		this.stopCount += 1;
		this.input = undefined;
	}

	wake(wake: ChangeWake): void {
		this.input?.onWake(wake);
	}

	state(state: ChangeBrokerState): void {
		this.input?.onStateChange?.(state);
	}
}

const realtimeWake = {
	kind: "outbox-maybe-advanced",
	highWaterSeq: 12,
	reason: "publish",
} as const;

const crdtWake = {
	kind: "crdt",
	aggregateHash: "a".repeat(64),
	aggregateEpoch: 2,
	head: 15,
	fenceGeneration: 4,
	reason: "publish",
} as const;

async function flushTasks(): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("core notice router", () => {
	it("owns one physical lifecycle across realtime and CRDT subscribers", async () => {
		const broker = new TestBroker();
		const router = new CoreNoticeRouter(broker);

		const releaseRealtime = await router.subscribe({
			kind: "realtime",
			onNotice: () => {},
		});
		const releaseCrdt = await router.subscribe({
			kind: "crdt",
			onNotice: () => {},
		});

		expect(broker.startCount).toBe(1);
		await releaseRealtime();
		expect(broker.stopCount).toBe(0);
		await releaseCrdt();
		expect(broker.stopCount).toBe(1);
	});

	it("coalesces concurrent startup and can restart after the last release", async () => {
		const broker = new TestBroker();
		const router = new CoreNoticeRouter(broker);

		const [first, second] = await Promise.all([
			router.subscribe({ kind: "realtime", onNotice: () => {} }),
			router.subscribe({ kind: "crdt", onNotice: () => {} }),
		]);
		expect(broker.startCount).toBe(1);
		await Promise.all([first(), second()]);
		expect(broker.stopCount).toBe(1);

		const third = await router.subscribe({
			kind: "realtime",
			onNotice: () => {},
		});
		expect(broker.startCount).toBe(2);
		await third();
		expect(broker.stopCount).toBe(2);
	});

	it("normalizes realtime and CRDT wakes without cross-delivery", async () => {
		const broker = new TestBroker();
		const router = new CoreNoticeRouter(broker);
		const realtime: CoreNotice[] = [];
		const crdt: CoreNotice[] = [];
		const releaseRealtime = await router.subscribe({
			kind: "realtime",
			onNotice: (notice) => realtime.push(notice),
		});
		const releaseCrdt = await router.subscribe({
			kind: "crdt",
			onNotice: (notice) => crdt.push(notice),
		});

		broker.wake(realtimeWake);
		broker.wake(crdtWake);
		await flushTasks();

		expect(realtime).toEqual([{ kind: "realtime", wake: realtimeWake }]);
		expect(crdt).toEqual([{ kind: "crdt", wake: crdtWake }]);
		await releaseRealtime();
		await releaseCrdt();
	});

	it("isolates a slow and failing CRDT subscriber from realtime", async () => {
		const broker = new TestBroker();
		const errors: unknown[] = [];
		const router = new CoreNoticeRouter(broker);
		let unblock!: () => void;
		const blocked = new Promise<void>((resolve) => {
			unblock = resolve;
		});
		let realtimeDelivered = false;
		const releaseSlow = await router.subscribe({
			kind: "crdt",
			onNotice: async () => blocked,
			onError: (error) => errors.push(error),
		});
		const releaseFailing = await router.subscribe({
			kind: "crdt",
			onNotice: () => {
				throw new Error("subscriber failed");
			},
			onError: (error) => errors.push(error),
		});
		const releaseRealtime = await router.subscribe({
			kind: "realtime",
			onNotice: () => {
				realtimeDelivered = true;
			},
		});

		broker.wake(crdtWake);
		broker.wake(realtimeWake);
		await flushTasks();

		expect(realtimeDelivered).toBe(true);
		expect(errors).toHaveLength(1);
		unblock();
		await releaseSlow();
		await releaseFailing();
		await releaseRealtime();
	});

	it("fans reconnect state out to every subscriber", async () => {
		const broker = new TestBroker();
		const router = new CoreNoticeRouter(broker);
		const states: string[] = [];
		const first = await router.subscribe({
			kind: "realtime",
			onNotice: () => {},
			onStateChange: (state) => states.push(`realtime:${state}`),
		});
		const second = await router.subscribe({
			kind: "crdt",
			onNotice: () => {},
			onStateChange: (state) => states.push(`crdt:${state}`),
		});

		broker.state("connected");
		await flushTasks();

		expect(states).toEqual(["realtime:connected", "crdt:connected"]);
		await first();
		await second();
	});

	it("reports bounded subscriber overflow instead of silently growing", async () => {
		const broker = new TestBroker();
		const router = new CoreNoticeRouter(broker, {
			maxSubscriberItems: 1,
			maxSubscriberBytes: 1024,
		});
		let unblock!: () => void;
		const blocked = new Promise<void>((resolve) => {
			unblock = resolve;
		});
		const overflows: number[] = [];
		const release = await router.subscribe({
			kind: "crdt",
			onNotice: async () => blocked,
			onOverflow: (count) => overflows.push(count),
		});

		broker.wake(crdtWake);
		broker.wake({ ...crdtWake, head: 16 });
		broker.wake({ ...crdtWake, head: 17 });
		await flushTasks();

		expect(overflows).toEqual([1]);
		unblock();
		await release();
	});
});

describe("bounded collaboration primitives", () => {
	it("offers a non-waiting semaphore with idempotent release", () => {
		const semaphore = new BoundedSemaphore(2);
		const first = semaphore.tryAcquire();
		const second = semaphore.tryAcquire();
		expect(first).not.toBeNull();
		expect(second).not.toBeNull();
		expect(semaphore.tryAcquire()).toBeNull();

		first!();
		first!();
		expect(semaphore.active).toBe(1);
		expect(semaphore.tryAcquire()).not.toBeNull();
	});

	it("bounds a queue by both item count and bytes", () => {
		const queue = new BoundedQueue<string>({
			maxItems: 2,
			maxBytes: 5,
			sizeOf: (value) => value.length,
		});
		expect(queue.tryPush("ab")).toEqual({ accepted: true });
		expect(queue.tryPush("cde")).toEqual({ accepted: true });
		expect(queue.tryPush("x")).toEqual({
			accepted: false,
			reason: "items",
		});
		expect(queue.shift()).toBe("ab");
		expect(queue.tryPush("xyz")).toEqual({
			accepted: false,
			reason: "bytes",
		});
		expect(queue.bytes).toBe(3);
	});
});

describe("CRDT broker wake validation", () => {
	it("accepts only bounded opaque hashes and finite cursor metadata", () => {
		expect(normalizeChangeWake(crdtWake)).toEqual(crdtWake);
		expect(
			normalizeChangeWake({ ...crdtWake, aggregateHash: "article-1" }),
		).toBeNull();
		expect(
			normalizeChangeWake({
				...crdtWake,
				head: Number.MAX_SAFE_INTEGER + 1,
			}),
		).toBeNull();
		expect(
			normalizeChangeWake({
				...crdtWake,
				applicationIdentity: "articles/article-1",
			}),
		).toEqual(crdtWake);
	});
});
