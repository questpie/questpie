import { expect, test } from "bun:test";

import {
	assertPb05OperationalMetrics,
	assertPb05OperationalSchemaReset,
	pb05OperationalDatabase,
	pb05OperationalResetOptIn,
	withPb05ReleasedBlocker,
} from "../support/pb05-operational-load-safety";

const deadlines = { workTimeoutMs: 100, settlementTimeoutMs: 100 } as const;

test("schema reset requires the exact isolated database and explicit opt-in", () => {
	for (const input of [
		{ database: "postgres", resetOptIn: pb05OperationalResetOptIn },
		{ database: pb05OperationalDatabase, resetOptIn: undefined },
		{ database: pb05OperationalDatabase, resetOptIn: "yes" },
	])
		expect(() => assertPb05OperationalSchemaReset(input)).toThrow(
			"PB-05 operational schema reset is not authorized",
		);

	expect(() =>
		assertPb05OperationalSchemaReset({
			database: pb05OperationalDatabase,
			resetOptIn: pb05OperationalResetOptIn,
		}),
	).not.toThrow();
});

test("a wrong database cannot reach destructive reset work", () => {
	let resets = 0;
	expect(() => {
		assertPb05OperationalSchemaReset({
			database: "postgres",
			resetOptIn: pb05OperationalResetOptIn,
		});
		resets += 1;
	}).toThrow("PB-05 operational schema reset is not authorized");
	expect(resets).toBe(0);
});

test("metric contracts reject missing, surplus, and nonfinite evidence", () => {
	const contracts = { samples: { direction: "min" as const, budget: 1 } };
	for (const measurements of [
		{},
		{ samples: 1, surplus: 0 },
		{ samples: Number.NaN },
	])
		expect(() =>
			assertPb05OperationalMetrics(measurements, contracts),
		).toThrow();
	expect(() =>
		assertPb05OperationalMetrics({ samples: 1 }, contracts),
	).not.toThrow();
	expect(() =>
		assertPb05OperationalMetrics(
			{ samples: 1 },
			{ samples: { direction: "sideways", budget: 1 } },
		),
	).toThrow("direction is invalid");
});

test("failed lock proof releases and settles while preserving the primary error", async () => {
	const primary = new Error("lock waiter proof timed out");
	const cleanup = new Error("blocker rollback failed");
	let releases = 0;
	let settlements = 0;

	await expect(
		withPb05ReleasedBlocker({
			...deadlines,
			work: () => Promise.reject(primary),
			release: () => {
				releases += 1;
			},
			settlements: () => {
				settlements += 1;
				return [Promise.reject(cleanup), Promise.resolve()];
			},
		}),
	).rejects.toBe(primary);
	expect(releases).toBe(1);
	expect(settlements).toBe(1);
});

test("successful work surfaces a blocker or waiter settlement failure", async () => {
	const cleanup = new Error("waiter settlement failed");
	await expect(
		withPb05ReleasedBlocker({
			...deadlines,
			work: () => Promise.resolve("measured"),
			release: () => undefined,
			settlements: () => [Promise.resolve(), Promise.reject(cleanup)],
		}),
	).rejects.toBe(cleanup);
});

test("undefined remains an exact primary rejection value", async () => {
	let rejected = false;
	try {
		await withPb05ReleasedBlocker({
			...deadlines,
			work: () => Promise.reject(undefined),
			release: () => undefined,
			settlements: () => [Promise.resolve()],
		});
	} catch (error) {
		rejected = true;
		expect(error).toBeUndefined();
	}
	expect(rejected).toBe(true);
});

test("a settlement callback throw cannot replace the primary failure", async () => {
	const primary = new Error("wait proof failed");
	const settlement = new Error("settlement callback failed");
	await expect(
		withPb05ReleasedBlocker({
			...deadlines,
			work: () => Promise.reject(primary),
			release: () => undefined,
			settlements: () => {
				throw settlement;
			},
		}),
	).rejects.toBe(primary);
	await expect(
		withPb05ReleasedBlocker({
			...deadlines,
			work: () => Promise.resolve(),
			release: () => undefined,
			settlements: () => {
				throw settlement;
			},
		}),
	).rejects.toBe(settlement);
});

test("a never-ready blocker times out, releases once, and cannot hang settlement", async () => {
	let releases = 0;
	const startedAt = performance.now();
	await expect(
		withPb05ReleasedBlocker({
			work: () => new Promise<never>(() => undefined),
			release: () => {
				releases += 1;
			},
			settlements: () => [new Promise<never>(() => undefined)],
			workTimeoutMs: 10,
			settlementTimeoutMs: 10,
		}),
	).rejects.toThrow("readiness/work timed out");
	expect(releases).toBe(1);
	expect(performance.now() - startedAt).toBeLessThan(200);
});

test("a never-settling blocker is bounded after successful work", async () => {
	let releases = 0;
	await expect(
		withPb05ReleasedBlocker({
			work: () => Promise.resolve(),
			release: () => {
				releases += 1;
			},
			settlements: () => [new Promise<never>(() => undefined)],
			workTimeoutMs: 10,
			settlementTimeoutMs: 10,
		}),
	).rejects.toThrow("settlement timed out");
	expect(releases).toBe(1);
});
