import { describe, expect, it } from "bun:test";

import {
	createCrdtOperationalCoordinator,
	type CrdtProjectionRunResult,
} from "../../../src/server/modules/core/integrated/crdt/operational-coordinator.js";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("CRDT operational coordinator", () => {
	it("stays inert when CRDT operations are unavailable", async () => {
		let calls = 0;
		const coordinator = createCrdtOperationalCoordinator({
			available: false,
			projection: {
				runDue: async () => {
					calls++;
					return { nextDueAt: null };
				},
			},
			maintenance: {
				runDue: async () => {
					calls++;
				},
			},
		});

		coordinator.start();
		coordinator.wake();
		await tick();
		await coordinator.stop();

		expect(calls).toBe(0);
	});

	it("runs projection at its earliest bounded due time and maintenance slower", async () => {
		const timers = new ManualTimers();
		const events: string[] = [];
		let projectionResult: CrdtProjectionRunResult = {
			nextDueAt: new Date(250),
		};
		const coordinator = createCrdtOperationalCoordinator({
			available: true,
			now: () => timers.now,
			setTimer: timers.set,
			clearTimer: timers.clear,
			minimumDelayMs: 1,
			projectionPollCeilingMs: 100,
			maintenanceIntervalMs: 500,
			projection: {
				runDue: async () => {
					events.push(`projection:${timers.now}`);
					return projectionResult;
				},
			},
			maintenance: {
				runDue: async () => {
					events.push(`maintenance:${timers.now}`);
				},
			},
		});

		coordinator.start();
		await tick();
		expect(events).toEqual(["projection:0", "maintenance:0"]);
		expect(timers.nextDue()).toBe(100);

		await timers.advanceTo(100);
		expect(events).toEqual(["projection:0", "maintenance:0", "projection:100"]);
		projectionResult = { nextDueAt: new Date(220) };
		await timers.advanceTo(200);
		await timers.advanceTo(220);
		expect(events.at(-1)).toBe("projection:220");
		expect(events).not.toContain("maintenance:220");

		await timers.advanceTo(500);
		expect(events).toContain("maintenance:500");
		await coordinator.stop();
	});

	it("is non-reentrant and coalesces wakes received during a run", async () => {
		let active = 0;
		let maximum = 0;
		let calls = 0;
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		const coordinator = createCrdtOperationalCoordinator({
			available: true,
			projectionPollCeilingMs: 60_000,
			maintenanceIntervalMs: 60_000,
			projection: {
				runDue: async () => {
					active++;
					maximum = Math.max(maximum, active);
					calls++;
					if (calls === 1) await blocked;
					active--;
					return { nextDueAt: null };
				},
			},
			maintenance: { runDue: async () => {} },
		});

		coordinator.start();
		await tick();
		coordinator.wake();
		coordinator.wake();
		release();
		await tick();
		await tick();

		expect(maximum).toBe(1);
		expect(calls).toBe(2);
		await coordinator.stop();
	});

	it("aborts work, bounds stop, and never schedules after late completion", async () => {
		let signal: AbortSignal | undefined;
		let calls = 0;
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		const coordinator = createCrdtOperationalCoordinator({
			available: true,
			stopTimeoutMs: 5,
			projectionPollCeilingMs: 60_000,
			maintenanceIntervalMs: 60_000,
			projection: {
				runDue: async (input) => {
					calls++;
					signal = input.signal;
					await blocked;
					return { nextDueAt: new Date(0) };
				},
			},
			maintenance: { runDue: async () => {} },
		});

		coordinator.start();
		await tick();
		await coordinator.stop();
		expect(signal?.aborted).toBe(true);

		release();
		coordinator.wake();
		await tick();
		await tick();
		expect(calls).toBe(1);
	});

	it("isolates runner and observer failures and retries on bounded cadence", async () => {
		const errors: string[] = [];
		let attempts = 0;
		const coordinator = createCrdtOperationalCoordinator({
			available: true,
			projectionPollCeilingMs: 5,
			maintenanceIntervalMs: 60_000,
			projection: {
				runDue: async () => {
					attempts++;
					if (attempts === 1) throw new Error("projection failed");
					return { nextDueAt: null };
				},
			},
			maintenance: { runDue: async () => {} },
			onError: (_error, operation) => {
				errors.push(operation);
				throw new Error("observer failed");
			},
		});

		coordinator.start();
		await new Promise((resolve) => setTimeout(resolve, 15));
		expect(attempts).toBeGreaterThanOrEqual(2);
		expect(errors).toEqual(["projection"]);
		await coordinator.stop();
	});
});

class ManualTimers {
	now = 0;
	private nextId = 1;
	private readonly timers = new Map<
		number,
		{ dueAt: number; callback: () => void }
	>();

	readonly set = (callback: () => void, delayMs: number) => {
		const id = this.nextId++;
		this.timers.set(id, { dueAt: this.now + delayMs, callback });
		return id as unknown as ReturnType<typeof setTimeout>;
	};

	readonly clear = (handle: ReturnType<typeof setTimeout>) => {
		this.timers.delete(handle as unknown as number);
	};

	nextDue(): number | undefined {
		return [...this.timers.values()]
			.map((timer) => timer.dueAt)
			.sort((left, right) => left - right)[0];
	}

	async advanceTo(target: number): Promise<void> {
		while (true) {
			const entry = [...this.timers.entries()]
				.filter(([, timer]) => timer.dueAt <= target)
				.sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
			if (!entry) break;
			this.now = entry[1].dueAt;
			this.timers.delete(entry[0]);
			entry[1].callback();
			await tick();
		}
		this.now = target;
		await tick();
	}
}
