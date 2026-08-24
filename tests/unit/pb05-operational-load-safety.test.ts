import { expect, test } from "bun:test";

import {
	QuestpiePostgresError,
	transactionBrand,
	type PostgresTransactionRunner,
} from "../../packages/runtime/src/postgres";
import { postgresFailure } from "../../packages/runtime/src/postgres/errors";
import ownerPathScenario from "../../quality/performance/pb05-owner-path-measurement.json";
import {
	assertPb05OperationalMetrics,
	assertPb05OperationalSchemaReset,
	assertPb05OwnerPathSchemaReset,
	countPb05SemanticFailures,
	createPb05ContentionOperationOwner,
	createPb05OperationAbortBoundary,
	derivePb05OwnerPathMeasurements,
	pb05OwnerPathStageAttribution,
	pb05OperationalDatabase,
	pb05OperationalResetOptIn,
	pb05OwnerPathDatabase,
	pb05OwnerPathResetOptIn,
	settlePb05OwnedBlocker,
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
	] as Readonly<Record<string, number>>[])
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
		acceptedCallbacks: {
			"mutation:fresh:handler": {
				count: 16,
				transactions: Array.from(
					{ length: 16 },
					(_, index) => `mutation:${index}`,
				),
				unowned: 0,
			},
			"realtime:apply:apply": {
				count: 16,
				transactions: Array.from(
					{ length: 16 },
					(_, index) => `realtime:${index}`,
				),
				unowned: 0,
			},
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
		{
			...ownerPathSnapshot(),
			acceptedCallbacks: {
				...ownerPathSnapshot().acceptedCallbacks,
				"mutation:fresh:handler": {
					count: 16,
					transactions: ["mutation:two-callbacks-one-transaction"],
					unowned: 0,
				},
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
	expect(
		owner.start(async () => {
			operations += 1;
		}),
	).toEqual({ accepted: false });
	await expect(owner.settlement).resolves.toBeUndefined();
	expect(operations).toBe(0);
});

test("an in-flight contention operation is captured by the fixed settlement", async () => {
	const owner = createPb05ContentionOperationOwner();
	const operation = Promise.withResolvers<void>();
	const started = owner.start(() => operation.promise);
	expect(started.accepted).toBe(true);
	owner.close();
	operation.resolve();
	if (started.accepted) await expect(started.result).resolves.toBeUndefined();
	await expect(owner.settlement).resolves.toBeUndefined();
	expect(owner.start(async () => undefined)).toEqual({ accepted: false });
});

test("closing an already settled operation never arms its abort deadline", async () => {
	const owner = createPb05ContentionOperationOwner({ abortAfterCloseMs: 10 });
	const admission = owner.start(async () => "settled");
	if (!admission.accepted)
		throw new Error("operation was unexpectedly refused");
	await expect(admission.result).resolves.toBe("settled");
	await expect(owner.settlement).resolves.toBeUndefined();
	owner.close();
	await Bun.sleep(20);
	expect(owner.signal.aborted).toBe(false);
});

test("blocker settlement suppresses only its exact owned abort reason", async () => {
	const controller = new AbortController();
	const owned = new DOMException("owned antagonist release", "AbortError");
	controller.abort(owned);
	await expect(
		settlePb05OwnedBlocker(Promise.reject(owned), {
			released: () => true,
			signal: controller.signal,
		}),
	).resolves.toBeUndefined();

	const runtimeCancellation = postgresFailure({
		error: owned,
		phase: "statement",
		signal: controller.signal,
	});
	await expect(
		settlePb05OwnedBlocker(Promise.reject(runtimeCancellation), {
			released: () => true,
			signal: controller.signal,
		}),
	).resolves.toBeUndefined();

	const unrelatedOwned = new DOMException(
		"unrelated cancellation",
		"AbortError",
	);
	const unrelatedCancellation = new QuestpiePostgresError({
		code: "cancelled",
		phase: "statement",
		cause: unrelatedOwned,
	});
	await expect(
		settlePb05OwnedBlocker(Promise.reject(unrelatedCancellation), {
			released: () => true,
			signal: controller.signal,
		}),
	).rejects.toBe(unrelatedCancellation);

	const wrongPhase = new QuestpiePostgresError({
		code: "cancelled",
		phase: "commit",
		cause: owned,
	});
	await expect(
		settlePb05OwnedBlocker(Promise.reject(wrongPhase), {
			released: () => true,
			signal: controller.signal,
		}),
	).rejects.toBe(wrongPhase);

	const timeout = new QuestpiePostgresError({
		code: "statementTimeout",
		phase: "statement",
		cause: owned,
	});
	await expect(
		settlePb05OwnedBlocker(Promise.reject(timeout), {
			released: () => true,
			signal: controller.signal,
		}),
	).rejects.toBe(timeout);

	for (const failure of [
		new QuestpiePostgresError({
			code: "queryFailed",
			phase: "rollback",
			cause: owned,
		}),
		new QuestpiePostgresError({
			code: "connectionLost",
			phase: "statement",
			cause: owned,
		}),
	])
		await expect(
			settlePb05OwnedBlocker(Promise.reject(failure), {
				released: () => true,
				signal: controller.signal,
			}),
		).rejects.toBe(failure);

	const lookalike = {
		code: "cancelled",
		phase: "statement",
		cause: owned,
	};
	await expect(
		settlePb05OwnedBlocker(Promise.reject(lookalike), {
			released: () => true,
			signal: controller.signal,
		}),
	).rejects.toBe(lookalike);

	await expect(
		settlePb05OwnedBlocker(Promise.reject(runtimeCancellation), {
			released: () => false,
			signal: controller.signal,
		}),
	).rejects.toBe(runtimeCancellation);

	const unrelated = new Error("blocker commit failed");
	await expect(
		settlePb05OwnedBlocker(Promise.reject(unrelated), {
			released: () => true,
			signal: controller.signal,
		}),
	).rejects.toBe(unrelated);
});

test("owner-path stage attribution is bounded and redacts unknown reasons", () => {
	const antagonist = new AbortController();
	antagonist.abort(new DOMException("PB-05 antagonist released", "AbortError"));
	const unknown = new AbortController();
	const secretError = new Error(
		"postgres://user:secret@example.invalid/database",
	);
	secretError.name = "credential-user-secret";
	unknown.abort(secretError);
	const unknownReason = new AbortController();
	unknownReason.abort({ token: "secret-token" });
	const attribution = pb05OwnerPathStageAttribution(
		{ phase: "contention", operation: "maintenance", sample: 0 },
		{
			unknownReason: unknownReason.signal,
			unknown: unknown.signal,
			antagonist: antagonist.signal,
		},
	);
	expect(attribution).toEqual({
		phase: "contention",
		operation: "maintenance",
		sample: 0,
		signals: {
			antagonist: { aborted: true, reason: "antagonist-release" },
			unknown: { aborted: true, reason: "other-error" },
			unknownReason: { aborted: true, reason: "other-reason" },
		},
	});
	expect(JSON.stringify(attribution)).not.toContain("secret");
	expect(JSON.stringify(attribution)).not.toContain("postgres://");
});

test("an admitted operation that never settles is aborted after owner close", async () => {
	let admittedSignal: AbortSignal | undefined;
	const underlying: PostgresTransactionRunner = {
		transaction(request) {
			admittedSignal = request.control?.signal;
			return new Promise((_, reject) => {
				request.control?.signal?.addEventListener(
					"abort",
					() => reject(request.control?.signal?.reason),
					{ once: true },
				);
			});
		},
	};
	const boundary = createPb05OperationAbortBoundary(underlying);
	const owner = createPb05ContentionOperationOwner({ abortAfterCloseMs: 10 });
	const admission = owner.start(() =>
		boundary.run(owner.signal, () =>
			boundary.database.transaction({
				mode: { isolation: "readCommitted", access: "readWrite" },
				use: async () => ({ [transactionBrand]: true }),
			}),
		),
	);
	expect(admission.accepted).toBe(true);
	owner.close();
	await expect(owner.settlement).rejects.toBeInstanceOf(DOMException);
	expect(admittedSignal?.aborted).toBe(true);
});

test("timeout before readiness closes the start gate and settles the control owner", async () => {
	const ready = Promise.withResolvers<void>();
	const blocker = Promise.withResolvers<void>();
	const owner = createPb05ContentionOperationOwner();
	void ready.promise.catch(() => undefined);
	void blocker.promise.catch(() => undefined);
	let operations = 0;
	let probes = 0;
	let releases = 0;
	const unhandled: unknown[] = [];
	const observeUnhandled = (event: PromiseRejectionEvent) => {
		unhandled.push(event.reason);
	};
	globalThis.addEventListener("unhandledrejection", observeUnhandled);
	try {
		await expect(
			withPb05ReleasedBlocker({
				work: async () => {
					await ready.promise;
					const admission = owner.start(async () => {
						operations += 1;
					});
					if (!admission.accepted) return;
					probes += 1;
					await admission.result;
				},
				release: () => {
					releases += 1;
					owner.close();
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
		ready.resolve();
		await Bun.sleep(0);
	} finally {
		globalThis.removeEventListener("unhandledrejection", observeUnhandled);
	}
	expect(releases).toBe(1);
	expect(operations).toBe(0);
	expect(probes).toBe(0);
	expect(unhandled).toEqual([]);
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
