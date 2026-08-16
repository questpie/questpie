import { expect, test } from "bun:test";

import {
	createPostgresReconciliationWake,
	type PostgresWakeTickSource,
} from "../../packages/runtime/src/live-query/postgres-wake";

function deferred() {
	let resolve!: () => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<void>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, reject, resolve };
}

function tickHarness() {
	let tick: (() => void) | undefined;
	let deadline: (() => void) | undefined;
	let intervalDisposed = 0;
	let deadlineDisposed = 0;
	const intervals: number[] = [];
	const deadlines: number[] = [];
	const source: PostgresWakeTickSource = {
		armInterval(milliseconds, callback) {
			intervals.push(milliseconds);
			tick = callback;
			return () => {
				intervalDisposed += 1;
			};
		},
		armDeadline(milliseconds, callback) {
			deadlines.push(milliseconds);
			deadline = callback;
			return () => {
				deadlineDisposed += 1;
			};
		},
	};
	return {
		source,
		intervals,
		deadlines,
		get intervalDisposed() {
			return intervalDisposed;
		},
		get deadlineDisposed() {
			return deadlineDisposed;
		},
		tick: () => tick?.(),
		deadline: () => deadline?.(),
	};
}

test("arms the exact bounded scan before startup reconciliation", async () => {
	const ticks = tickHarness();
	const order: string[] = [];
	const source: PostgresWakeTickSource = {
		armInterval(milliseconds, callback) {
			order.push(`arm:${milliseconds}`);
			return ticks.source.armInterval(milliseconds, callback);
		},
		armDeadline: ticks.source.armDeadline,
	};
	const wake = createPostgresReconciliationWake({
		tickSource: source,
		reconcile: async () => {
			order.push("reconcile");
		},
	});

	await wake.start();

	expect(order).toEqual(["arm:10000", "reconcile"]);
	expect(ticks.deadlines).toEqual([10_000]);
	expect(ticks.deadlineDisposed).toBe(1);
	await wake.drain();
});

test("queues one rerun for ticks arriving during a scan and coalesces duplicates", async () => {
	const ticks = tickHarness();
	const first = deferred();
	let attempts = 0;
	const wake = createPostgresReconciliationWake({
		tickSource: ticks.source,
		reconcile: async () => {
			attempts += 1;
			if (attempts === 1) await first.promise;
		},
	});

	const startup = wake.start();
	expect(attempts).toBe(1);
	ticks.tick();
	ticks.tick();
	first.resolve();
	await startup;

	expect(attempts).toBe(2);
	expect(ticks.deadlines).toEqual([10_000, 10_000]);
	await wake.drain();
});

test("aborts an over-bound attempt and retries only on the next tick", async () => {
	const ticks = tickHarness();
	const firstAborted = deferred();
	const retried = deferred();
	let attempts = 0;
	let durableHorizon = 0;
	const wake = createPostgresReconciliationWake({
		tickSource: ticks.source,
		reconcile: async (signal) => {
			attempts += 1;
			if (attempts === 1) {
				await new Promise<void>((_resolve, reject) => {
					signal.addEventListener(
						"abort",
						() => {
							firstAborted.resolve();
							reject(signal.reason);
						},
						{ once: true },
					);
				});
			}
			durableHorizon += 1;
			retried.resolve();
		},
	});

	const startup = wake.start();
	ticks.deadline();
	await firstAborted.promise;
	await expect(startup).rejects.toThrow("exceeded 10000ms");
	expect(attempts).toBe(1);
	expect(durableHorizon).toBe(0);

	ticks.tick();
	await retried.promise;
	expect(attempts).toBe(2);
	expect(durableHorizon).toBe(1);
	await wake.drain();
});

test("drain and owner abort dispose ticks, abort active work, and prevent later work", async () => {
	for (const ownerAborts of [false, true]) {
		const ticks = tickHarness();
		const entered = deferred();
		const owner = new AbortController();
		let attempts = 0;
		const wake = createPostgresReconciliationWake({
			tickSource: ticks.source,
			signal: owner.signal,
			reconcile: async (signal) => {
				attempts += 1;
				entered.resolve();
				await new Promise<void>((_resolve, reject) => {
					signal.addEventListener("abort", () => reject(signal.reason), {
						once: true,
					});
				});
			},
		});

		const startup = wake.start();
		await entered.promise;
		const stopping = ownerAborts
			? (owner.abort(new DOMException("owner stopped", "AbortError")),
				wake.drain())
			: wake.drain();
		await stopping;
		await expect(startup).rejects.toMatchObject({ name: "AbortError" });
		expect(ticks.intervalDisposed).toBe(1);
		expect(ticks.deadlineDisposed).toBe(1);

		ticks.tick();
		await Promise.resolve();
		expect(attempts).toBe(1);
	}
});
