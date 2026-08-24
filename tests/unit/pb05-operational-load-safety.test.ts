import { expect, test } from "bun:test";

import ownerPathScenario from "../../quality/performance/pb05-owner-path-measurement.json";
import {
	assertPb05OperationalMetrics,
	assertPb05OperationalSchemaReset,
	assertPb05OwnerPathSchemaReset,
	countPb05SemanticFailures,
	createPb05ContentionOperationOwner,
	derivePb05OwnerPathMeasurements,
	pb05OperationalDatabase,
	pb05OperationalResetOptIn,
	pb05OwnerPathDatabase,
	pb05OwnerPathResetOptIn,
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

test("owner-path reset has an independent exact database and opt-in", () => {
	for (const input of [
		{ database: pb05OperationalDatabase, resetOptIn: pb05OwnerPathResetOptIn },
		{ database: pb05OwnerPathDatabase, resetOptIn: pb05OperationalResetOptIn },
		{ database: pb05OwnerPathDatabase, resetOptIn: undefined },
	])
		expect(() => assertPb05OwnerPathSchemaReset(input)).toThrow(
			"PB-05 owner-path schema reset is not authorized",
		);
	let resets = 0;
	assertPb05OwnerPathSchemaReset({
		database: pb05OwnerPathDatabase,
		resetOptIn: pb05OwnerPathResetOptIn,
	});
	resets += 1;
	expect(resets).toBe(1);
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

test("owner-path manifest budgets only sample counts and semantic failures", () => {
	expect(ownerPathScenario.status).toBe("PROVISIONAL_INTERNAL_EVIDENCE");
	expect(ownerPathScenario.publicCeilings).toBe(false);
	expect(Object.keys(ownerPathScenario.metrics).toSorted()).toEqual([
		"actualMutationHandlerSamples",
		"actualRealtimeApplySamples",
		"lockWaitProofs",
		"maintenanceOwnerPathSamples",
		"reconciliationOwnerPathSamples",
		"retentionOwnerPathSamples",
		"semanticFailures",
	]);
	for (const [name, metric] of Object.entries(ownerPathScenario.metrics)) {
		expect(metric.unit).toBe("count");
		expect(name.toLowerCase()).not.toContain("duration");
		expect(name.toLowerCase()).not.toContain("latency");
	}
});

function ownerPathSnapshot() {
	return {
		populations: {
			mutation: { transactions: 18 },
			realtime: { transactions: 19 },
		},
		idleGaps: {
			"mutation:fresh:handler": { count: 16 },
			"realtime:apply:apply": { count: 16 },
		},
		contention: {
			maintenance: { samples: 8, acquired: 8 },
			reconciliation: { samples: 8, acquired: 8 },
			retention: { samples: 8, acquired: 8 },
		},
	};
}

test("owner-path metrics require exact observer counts and transaction identities", () => {
	const expected = {
		callbackSamples: 16,
		contentionSamples: 8,
		mutationTransactions: 18,
		reconciliationTransactions: 19,
		semanticChecks: 60,
	} as const;
	expect(
		derivePb05OwnerPathMeasurements({
			snapshot: ownerPathSnapshot(),
			expected,
			lockWaitProofs: 24,
			semanticResults: Array.from({ length: 60 }, () => true),
		}),
	).toEqual({
		actualMutationHandlerSamples: 16,
		actualRealtimeApplySamples: 16,
		maintenanceOwnerPathSamples: 8,
		reconciliationOwnerPathSamples: 8,
		retentionOwnerPathSamples: 8,
		lockWaitProofs: 24,
		semanticFailures: 0,
	});

	for (const snapshot of [
		{
			...ownerPathSnapshot(),
			idleGaps: {
				...ownerPathSnapshot().idleGaps,
				"mutation:fresh:handler": { count: 15 },
			},
		},
		{
			...ownerPathSnapshot(),
			idleGaps: {
				...ownerPathSnapshot().idleGaps,
				"realtime:apply:apply": { count: 17 },
			},
		},
		{
			...ownerPathSnapshot(),
			populations: {
				...ownerPathSnapshot().populations,
				mutation: { transactions: 1 },
			},
		},
	])
		expect(() =>
			derivePb05OwnerPathMeasurements({
				snapshot,
				expected,
				lockWaitProofs: 24,
				semanticResults: Array.from({ length: 60 }, () => true),
			}),
		).toThrow("PB-05 owner-path observer controls are not exact");
});

test("semantic failures are derived from actual owner results", () => {
	expect(countPb05SemanticFailures([true, false, true, false])).toBe(2);
});

test("a closed contention owner refuses a late operation and settles", async () => {
	const owner = createPb05ContentionOperationOwner();
	owner.close();
	let operations = 0;
	await expect(
		owner.start(async () => {
			operations += 1;
		}),
	).rejects.toThrow("PB-05 contention operation owner is closed");
	await expect(owner.settlement).resolves.toBeUndefined();
	expect(operations).toBe(0);
});

test("an in-flight contention operation is captured by the fixed settlement", async () => {
	const owner = createPb05ContentionOperationOwner();
	const operation = Promise.withResolvers<void>();
	const started = owner.start(() => operation.promise);
	owner.close();
	operation.resolve();
	await expect(started).resolves.toBeUndefined();
	await expect(owner.settlement).resolves.toBeUndefined();
	await expect(owner.start(async () => undefined)).rejects.toThrow(
		"PB-05 contention operation owner is closed",
	);
});

test("timeout before readiness closes the start gate and settles the control owner", async () => {
	const ready = Promise.withResolvers<void>();
	const blocker = Promise.withResolvers<void>();
	const owner = createPb05ContentionOperationOwner();
	void ready.promise.catch(() => undefined);
	void blocker.promise.catch(() => undefined);
	let operations = 0;
	let releases = 0;
	await expect(
		withPb05ReleasedBlocker({
			work: async () => {
				await ready.promise;
				await owner.start(async () => {
					operations += 1;
				});
			},
			release: () => {
				releases += 1;
				owner.close();
				ready.reject(new DOMException("control aborted", "AbortError"));
				blocker.reject(new DOMException("control aborted", "AbortError"));
			},
			settlements: () => [
				blocker.promise.catch(() => undefined),
				owner.settlement,
			],
			workTimeoutMs: 10,
			settlementTimeoutMs: 100,
		}),
	).rejects.toThrow("readiness/work timed out");
	expect(releases).toBe(1);
	expect(operations).toBe(0);
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
