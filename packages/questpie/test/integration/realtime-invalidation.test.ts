import { afterEach, describe, expect, it } from "bun:test";

import { RealtimeService } from "../../src/server/modules/core/integrated/realtime/service.js";
import type {
	ChangeBroker,
	ChangeWake,
} from "../../src/server/modules/core/integrated/realtime/transport.js";

function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

class Broker implements ChangeBroker {
	input?: Parameters<ChangeBroker["start"]>[0];
	starts = 0;
	stops = 0;
	async start(input: Parameters<ChangeBroker["start"]>[0]) {
		this.input = input;
		this.starts++;
	}
	async stop() {
		this.stops++;
	}
	async publish(wake: ChangeWake) {
		this.input?.onWake(wake);
	}
	wake() {
		this.input?.onWake({ kind: "outbox-maybe-advanced", reason: "publish" });
	}
}

async function flush() {
	// Drain the router's microtask queue before releasing a held reader (QFM-30).
	await new Promise<void>((resolve) => setImmediate(resolve));
}

// No committed rows are eligible for ordered delivery. A wake must still reach
// an authoritative reader, without changing the settled cursor (QFM-30).
const emptyDb = {
	select() {
		const query = {
			from: () => query,
			where: () => query,
			orderBy: () => query,
			limit: async () => [],
		};
		return query;
	},
};

describe("backend realtime invalidation", () => {
	let realtime: RealtimeService;
	afterEach(async () => {
		await realtime?.destroy();
	});

	it("wakes before ordered delivery and shares one broker lifecycle", async () => {
		const broker = new Broker();
		realtime = new RealtimeService(emptyDb as never, {
			changeBroker: broker,
			pollIntervalMs: 0,
			retentionDays: 0,
		});
		await realtime.initialize();
		let invalidations = 0;
		let ordered = 0;
		const stop = realtime.subscribeInvalidation(() => {
			invalidations++;
		});
		const stopOrdered = realtime.subscribe(() => {
			ordered++;
		});
		await flush();
		const before = invalidations;
		broker.wake();
		await flush();
		expect(invalidations).toBeGreaterThan(before);
		expect(ordered).toBe(0);
		expect(broker.starts).toBe(1);
		stop();
		stopOrdered();
	});

	it("coalesces a burst during an async read and drops pending work on unsubscribe", async () => {
		const broker = new Broker();
		realtime = new RealtimeService(emptyDb as never, {
			changeBroker: broker,
			pollIntervalMs: 0,
			retentionDays: 0,
		});
		await realtime.initialize();
		let held = deferred();
		let calls = 0;
		let active = 0;
		let maxActive = 0;
		let block = false;
		const stop = realtime.subscribeInvalidation(async () => {
			calls++;
			active++;
			maxActive = Math.max(maxActive, active);
			if (block) await held.promise;
			active--;
		});
		await flush();
		block = true;
		const before = calls;
		broker.wake();
		await flush();
		for (let i = 0; i < 100; i++) broker.wake();
		await flush();
		expect(calls).toBe(before + 1);
		block = false;
		held.resolve();
		await flush();
		expect(calls).toBe(before + 2);
		expect(maxActive).toBe(1);
		held = deferred();
		block = true;
		broker.wake();
		await flush();
		for (let i = 0; i < 100; i++) broker.wake();
		await flush();
		expect(calls).toBe(before + 3);
		stop();
		held.resolve();
		broker.wake();
		await flush();
		expect(calls).toBe(before + 3);
		expect(active).toBe(0);
	});

	it("isolates rejected callbacks and throwing error listeners", async () => {
		const broker = new Broker();
		realtime = new RealtimeService(emptyDb as never, {
			changeBroker: broker,
			pollIntervalMs: 0,
			retentionDays: 0,
		});
		const failure = new Error("reader failed");
		const errors: unknown[] = [];
		let healthy = 0;
		realtime.subscribeInvalidation(
			async () => {
				throw failure;
			},
			(error) => {
				errors.push(error);
				throw new Error("error listener failed");
			},
		);
		realtime.subscribeInvalidation(() => {
			healthy++;
		});
		await flush();
		const before = healthy;
		broker.wake();
		await flush();
		expect(healthy).toBeGreaterThan(before);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.every((error) => error === failure)).toBe(true);
	});

	it("uses existing reconciliation when no broker notice arrives", async () => {
		realtime = new RealtimeService(emptyDb as never, {
			pollIntervalMs: 5,
			retentionDays: 0,
		});
		const reconciled = deferred();
		let calls = 0;
		realtime.subscribeInvalidation(() => {
			if (++calls >= 2) reconciled.resolve();
		});
		await reconciled.promise;
		expect(calls).toBeGreaterThanOrEqual(2);
	}, 2_000);

	it("rechecks after startup and reconnect, and suppresses callbacks after destroy", async () => {
		const broker = new Broker();
		realtime = new RealtimeService(emptyDb as never, {
			changeBroker: broker,
			pollIntervalMs: 0,
			retentionDays: 0,
		});
		let calls = 0;
		realtime.subscribeInvalidation(() => {
			calls++;
		});
		await flush();
		expect(calls).toBeGreaterThan(0);
		const before = calls;
		broker.input?.onStateChange?.("connected");
		await flush();
		expect(calls).toBeGreaterThan(before);
		await realtime.destroy();
		const stopped = calls;
		broker.wake();
		await flush();
		expect(calls).toBe(stopped);
		expect(broker.stops).toBe(1);
	});

	it("closes subscription admission during destroy and drops a busy reader's pending rerun", async () => {
		const broker = new Broker();
		realtime = new RealtimeService(emptyDb as never, {
			changeBroker: broker,
			pollIntervalMs: 0,
			retentionDays: 0,
		});
		const held = deferred();
		let calls = 0;
		let shutdown: Promise<void> | undefined;
		try {
			realtime.subscribeInvalidation(async () => {
				calls++;
				await held.promise;
			});
			await flush();
			broker.wake();
			await flush();
			expect(calls).toBe(1);
			shutdown = realtime.destroy();
			expect(() =>
				realtime.subscribeInvalidation(() => {
					calls++;
				}),
			).toThrow("Realtime invalidation subscriptions are closed");
			await shutdown;
			held.resolve();
			await flush();
			expect(calls).toBe(1);
			expect(() =>
				realtime.subscribeInvalidation(() => {
					calls++;
				}),
			).toThrow("Realtime invalidation subscriptions are closed");
		} finally {
			held.resolve();
			await shutdown;
		}
	});
});
