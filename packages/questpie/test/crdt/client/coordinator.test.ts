import { describe, expect, it } from "bun:test";

import { CrdtClientCoordinator } from "../../../src/client/crdt/coordinator.js";

describe("CRDT client coordinator", () => {
	it("caps global pull concurrency at two", async () => {
		const coordinator = new CrdtClientCoordinator({
			maximumConcurrentPulls: 20,
		});
		const gates = [deferred(), deferred(), deferred()];
		let active = 0;
		let maximumActive = 0;
		const starts: number[] = [];
		const pulls = gates.map((gate, index) =>
			coordinator.requestPull({ index }, async () => {
				starts.push(index);
				active++;
				maximumActive = Math.max(maximumActive, active);
				await gate.promise;
				active--;
			}),
		);

		await settle();
		expect(starts).toEqual([0, 1]);
		expect(maximumActive).toBe(2);

		gates[0]!.resolve();
		await settle();
		expect(starts).toEqual([0, 1, 2]);
		expect(maximumActive).toBe(2);

		gates[1]!.resolve();
		gates[2]!.resolve();
		await Promise.all(pulls);
	});

	it("settles requests against the pull generation they requested", async () => {
		const coordinator = new CrdtClientCoordinator();
		const key = {};
		const firstGate = deferred();
		const secondGate = deferred();
		let calls = 0;
		let firstSettled = false;
		let secondSettled = false;
		const first = coordinator
			.requestPull(key, async () => {
				calls++;
				await firstGate.promise;
			})
			.finally(() => {
				firstSettled = true;
			});
		await settle();

		const second = coordinator
			.requestPull(key, async () => {
				calls++;
				await secondGate.promise;
			})
			.finally(() => {
				secondSettled = true;
			});
		firstGate.resolve();
		await settle();

		expect(calls).toBe(2);
		expect(firstSettled).toBe(true);
		expect(secondSettled).toBe(false);

		secondGate.resolve();
		await Promise.all([first, second]);
		expect(secondSettled).toBe(true);
	});

	it("coalesces waiter-free dirty hints into one latest follow-up", async () => {
		const coordinator = new CrdtClientCoordinator();
		const key = {};
		const firstGate = deferred();
		const calls: string[] = [];
		const initial = coordinator.requestPull(key, async () => {
			calls.push("initial");
			await firstGate.promise;
		});
		await settle();

		coordinator.schedulePull(key, async () => {
			calls.push("stale");
		});
		coordinator.schedulePull(key, async () => {
			calls.push("latest");
		});
		coordinator.schedulePull(key, async () => {
			calls.push("latest");
		});
		firstGate.resolve();
		await initial;
		await settle();

		expect(calls).toEqual(["initial", "latest"]);
	});

	it("rotates a dirty follow-up behind already queued documents", async () => {
		const coordinator = new CrdtClientCoordinator({
			maximumConcurrentPulls: 1,
		});
		const firstGate = deferred();
		const order: string[] = [];
		const keyA = {};
		const keyB = {};
		const first = coordinator.requestPull(keyA, async () => {
			order.push("a1");
			await firstGate.promise;
		});
		const sibling = coordinator.requestPull(keyB, async () => {
			order.push("b");
		});
		await settle();
		coordinator.schedulePull(keyA, async () => {
			order.push("a2");
		});

		firstGate.resolve();
		await Promise.all([first, sibling]);
		await settle();

		expect(order).toEqual(["a1", "b", "a2"]);
	});

	it("rejects generation waiters on release and destroy", async () => {
		const coordinator = new CrdtClientCoordinator({
			maximumConcurrentPulls: 1,
		});
		const runningKey = {};
		const queuedKey = {};
		const gate = deferred();
		const running = settled(
			coordinator.requestPull(runningKey, () => gate.promise),
		);
		await settle();
		const followUp = settled(
			coordinator.requestPull(runningKey, async () => undefined),
		);
		const queued = settled(
			coordinator.requestPull(queuedKey, async () => undefined),
		);

		coordinator.release(runningKey);
		expect(await running).toEqual({
			status: "rejected",
			message: "CRDT document disconnected",
		});
		expect(await followUp).toEqual({
			status: "rejected",
			message: "CRDT document disconnected",
		});

		coordinator.destroy();
		expect(await queued).toEqual({
			status: "rejected",
			message: "CRDT document disconnected",
		});
		gate.resolve();
		await settle();
	});

	it("keeps outbound and roster awareness lanes distinct under one global 20 Hz limit", async () => {
		const clock = fakeClock();
		const coordinator = new CrdtClientCoordinator({
			setTimeout: clock.setTimeout as typeof setTimeout,
			clearTimeout: clock.clearTimeout as typeof clearTimeout,
		});
		const first = {};
		const second = {};
		const calls: Array<{ name: string; at: number }> = [];
		const task = (name: string) => async () => {
			calls.push({ name, at: clock.now() });
		};

		coordinator.queueAwareness(first, "outbound", task("stale"));
		coordinator.queueAwareness(first, "outbound", task("outbound"));
		coordinator.queueAwareness(first, "roster", task("roster"));
		coordinator.queueAwareness(second, "outbound", task("second"));

		clock.advance(49);
		await settle();
		expect(calls).toEqual([]);
		clock.advance(1);
		await settle();
		expect(calls).toEqual([{ name: "outbound", at: 50 }]);

		clock.advance(50);
		await settle();
		clock.advance(50);
		await settle();
		expect(calls).toEqual([
			{ name: "outbound", at: 50 },
			{ name: "roster", at: 100 },
			{ name: "second", at: 150 },
		]);
		expect(
			calls.slice(1).every((call, index) => call.at - calls[index]!.at >= 50),
		).toBe(true);
	});
});

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function settled(promise: Promise<void>) {
	return promise.then(
		() => ({ status: "fulfilled" as const }),
		(error: unknown) => ({
			status: "rejected" as const,
			message: error instanceof Error ? error.message : String(error),
		}),
	);
}

function fakeClock() {
	let now = 0;
	let nextId = 1;
	const timers = new Map<number, { due: number; callback: () => void }>();
	return {
		now: () => now,
		setTimeout(callback: () => void, delayMs: number) {
			const id = nextId++;
			timers.set(id, { due: now + delayMs, callback });
			return id;
		},
		clearTimeout(handle: unknown) {
			timers.delete(handle as number);
		},
		advance(ms: number) {
			now += ms;
			for (;;) {
				const ready = [...timers.entries()]
					.filter(([, timer]) => timer.due <= now)
					.sort((left, right) => left[1].due - right[1].due)[0];
				if (!ready) return;
				timers.delete(ready[0]);
				ready[1].callback();
			}
		},
	};
}

async function settle(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
}
