export const pb05OperationalDatabase =
	"questpie_pb05_operational_measurement" as const;
export const pb05OperationalResetOptIn =
	"questpie_pb05_operational_measurement" as const;
export const pb05OwnerPathDatabase = "questpie_pb05_owner_path" as const;
export const pb05OwnerPathResetOptIn = "questpie_pb05_owner_path" as const;

export function assertPb05OperationalSchemaReset(
	input: Readonly<{
		database: string | undefined;
		resetOptIn: string | undefined;
	}>,
): void {
	if (
		input.database !== pb05OperationalDatabase ||
		input.resetOptIn !== pb05OperationalResetOptIn
	)
		throw new TypeError("PB-05 operational schema reset is not authorized");
}

export function assertPb05OwnerPathSchemaReset(
	input: Readonly<{
		database: string | undefined;
		resetOptIn: string | undefined;
	}>,
): void {
	if (
		input.database !== pb05OwnerPathDatabase ||
		input.resetOptIn !== pb05OwnerPathResetOptIn
	)
		throw new TypeError("PB-05 owner-path schema reset is not authorized");
}

export function assertPb05OperationalMetrics(
	measurements: Readonly<Record<string, number>>,
	contracts: Readonly<
		Record<string, Readonly<{ direction: string; budget: number }>>
	>,
): void {
	const measurementNames = Object.keys(measurements).toSorted();
	const contractNames = Object.keys(contracts).toSorted();
	if (JSON.stringify(measurementNames) !== JSON.stringify(contractNames))
		throw new TypeError("PB-05 operational metric contract is not exact");
	for (const name of contractNames) {
		const value = measurements[name];
		const contract = contracts[name]!;
		if (contract.direction !== "min" && contract.direction !== "max")
			throw new TypeError(
				`PB-05 operational metric ${name} direction is invalid`,
			);
		if (!Number.isFinite(value))
			throw new TypeError(`PB-05 operational metric ${name} is invalid`);
		if (contract.direction === "min" && value! < contract.budget)
			throw new TypeError(`${name} ${value} is below ${contract.budget}`);
		if (contract.direction === "max" && value! > contract.budget)
			throw new TypeError(`${name} ${value} exceeds ${contract.budget}`);
	}
}

type Pb05OwnerPathSnapshot = Readonly<{
	populations: Readonly<Record<string, Readonly<{ transactions: number }>>>;
	idleGaps: Readonly<Record<string, Readonly<{ count: number }>>>;
	acceptedCallbacks: Readonly<
		Record<
			string,
			Readonly<{
				count: number;
				transactions: readonly string[];
				unowned: number;
			}>
		>
	>;
	contention: Readonly<
		Record<string, Readonly<{ samples: number; acquired: number }>>
	>;
}>;

export function countPb05SemanticFailures(results: readonly boolean[]): number {
	return results.reduce((count, result) => count + (result ? 0 : 1), 0);
}

export function derivePb05OwnerPathMeasurements(
	input: Readonly<{
		snapshot: Pb05OwnerPathSnapshot;
		expected: Readonly<{
			callbackSamples: number;
			contentionSamples: number;
			mutationTransactions: number;
			reconciliationTransactions: number;
			semanticChecks: number;
		}>;
		lockWaitProofs: number;
		semanticResults: readonly boolean[];
	}>,
): Readonly<Record<string, number>> {
	const mutationAssociation =
		input.snapshot.acceptedCallbacks["mutation:fresh:handler"];
	const realtimeAssociation =
		input.snapshot.acceptedCallbacks["realtime:apply:apply"];
	const mutationCallbacks = mutationAssociation?.count;
	const realtimeCallbacks = realtimeAssociation?.count;
	const mutationGapCount =
		input.snapshot.idleGaps["mutation:fresh:handler"]?.count;
	const realtimeGapCount =
		input.snapshot.idleGaps["realtime:apply:apply"]?.count;
	const maintenance = input.snapshot.contention.maintenance;
	const reconciliation = input.snapshot.contention.reconciliation;
	const retention = input.snapshot.contention.retention;
	const expectedLockProofs = input.expected.contentionSamples * 3;
	if (
		mutationCallbacks !== input.expected.callbackSamples ||
		realtimeCallbacks !== input.expected.callbackSamples ||
		mutationGapCount !== input.expected.callbackSamples ||
		realtimeGapCount !== input.expected.callbackSamples ||
		mutationAssociation?.transactions.length !==
			input.expected.callbackSamples ||
		realtimeAssociation?.transactions.length !==
			input.expected.callbackSamples ||
		mutationAssociation?.unowned !== 0 ||
		realtimeAssociation?.unowned !== 0 ||
		input.snapshot.populations.mutation?.transactions !==
			input.expected.mutationTransactions ||
		input.snapshot.populations.realtime?.transactions !==
			input.expected.reconciliationTransactions ||
		maintenance?.samples !== input.expected.contentionSamples ||
		maintenance.acquired !== input.expected.contentionSamples ||
		reconciliation?.samples !== input.expected.contentionSamples ||
		reconciliation.acquired !== input.expected.contentionSamples ||
		retention?.samples !== input.expected.contentionSamples ||
		retention.acquired !== input.expected.contentionSamples ||
		input.lockWaitProofs !== expectedLockProofs ||
		input.semanticResults.length !== input.expected.semanticChecks
	)
		throw new TypeError("PB-05 owner-path observer controls are not exact");
	return Object.freeze({
		actualMutationHandlerSamples: mutationCallbacks,
		actualRealtimeApplySamples: realtimeCallbacks,
		maintenanceOwnerPathSamples: maintenance.samples,
		reconciliationOwnerPathSamples: reconciliation.samples,
		retentionOwnerPathSamples: retention.samples,
		lockWaitProofs: input.lockWaitProofs,
		semanticFailures: countPb05SemanticFailures(input.semanticResults),
	});
}

export function createPb05ContentionOperationOwner(
	options: Readonly<{ abortAfterCloseMs?: number }> = {},
) {
	const abortAfterCloseMs = options.abortAfterCloseMs ?? 100;
	if (!Number.isSafeInteger(abortAfterCloseMs) || abortAfterCloseMs <= 0)
		throw new TypeError("PB-05 contention abort deadline is invalid");
	const settled = Promise.withResolvers<void>();
	void settled.promise.catch(() => undefined);
	const controller = new AbortController();
	let accepting = true;
	let started = false;
	let finished = false;
	let abortTimer: ReturnType<typeof setTimeout> | undefined;
	return Object.freeze({
		get signal(): AbortSignal {
			return controller.signal;
		},
		get settlement(): Promise<void> {
			return settled.promise;
		},
		start<Result>(
			use: () => Promise<Result>,
		):
			| Readonly<{ accepted: false }>
			| Readonly<{ accepted: true; result: Promise<Result> }> {
			if (!accepting || started) return Object.freeze({ accepted: false });
			accepting = false;
			started = true;
			let operation: Promise<Result>;
			try {
				operation = use();
			} catch (error) {
				operation = Promise.reject(error);
			}
			void operation.then(
				() => {
					finished = true;
					if (abortTimer !== undefined) clearTimeout(abortTimer);
					settled.resolve();
				},
				(error) => {
					finished = true;
					if (abortTimer !== undefined) clearTimeout(abortTimer);
					settled.reject(error);
				},
			);
			void operation.catch(() => undefined);
			return Object.freeze({ accepted: true, result: operation });
		},
		close(): void {
			accepting = false;
			if (!started) settled.resolve();
			else if (!finished && abortTimer === undefined)
				abortTimer = setTimeout(
					() =>
						controller.abort(
							new DOMException(
								"PB-05 contention operation exceeded its close deadline",
								"AbortError",
							),
						),
					abortAfterCloseMs,
				);
		},
	});
}

export async function settlePb05OwnedBlocker(
	blocker: Promise<void>,
	input: Readonly<{ released(): boolean; signal: AbortSignal }>,
): Promise<void> {
	try {
		await blocker;
	} catch (error) {
		if (
			input.released() &&
			input.signal.aborted &&
			error === input.signal.reason
		)
			return;
		throw error;
	}
}

export function createPb05OperationAbortBoundary(
	database: PostgresTransactionRunner,
) {
	const context = new AsyncLocalStorage<AbortSignal>();
	return Object.freeze({
		database: Object.freeze({
			transaction(request) {
				const owned = context.getStore();
				const signal =
					owned && request.control?.signal
						? AbortSignal.any([owned, request.control.signal])
						: (owned ?? request.control?.signal);
				return database.transaction({
					...request,
					...(signal
						? { control: { ...request.control, signal } }
						: { control: request.control }),
				});
			},
		}) satisfies PostgresTransactionRunner,
		run<Result>(signal: AbortSignal, use: () => Promise<Result>) {
			return context.run(signal, use);
		},
	});
}

export async function withPb05ReleasedBlocker<Value>(
	input: Readonly<{
		work(): Promise<Value>;
		release(): void;
		settlements(): readonly Promise<unknown>[];
		workTimeoutMs: number;
		settlementTimeoutMs: number;
	}>,
): Promise<Value> {
	const deadline = async <Result>(
		promise: Promise<Result>,
		timeoutMs: number,
		label: string,
	): Promise<Result> => {
		if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
			throw new TypeError("PB-05 blocker timeout is invalid");
		void promise.catch(() => undefined);
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				promise,
				new Promise<never>((_, reject) => {
					timer = setTimeout(
						() => reject(new Error(`PB-05 blocker ${label} timed out`)),
						timeoutMs,
					);
				}),
			]);
		} finally {
			if (timer !== undefined) clearTimeout(timer);
		}
	};
	let value: Value | undefined;
	let workFailed = false;
	let primary: unknown;
	try {
		value = await deadline(input.work(), input.workTimeoutMs, "readiness/work");
	} catch (error) {
		workFailed = true;
		primary = error;
	}
	let releaseFailed = false;
	let releaseFailure: unknown;
	try {
		input.release();
	} catch (error) {
		releaseFailed = true;
		releaseFailure = error;
	}
	let settlementCallbackFailed = false;
	let settlementCallbackFailure: unknown;
	let settlements: readonly Promise<unknown>[] = [];
	try {
		settlements = input.settlements();
	} catch (error) {
		settlementCallbackFailed = true;
		settlementCallbackFailure = error;
	}
	let settlementFailed = false;
	let settlementFailure: unknown;
	let settled: PromiseSettledResult<unknown>[] = [];
	try {
		settled = await deadline(
			Promise.allSettled(settlements),
			input.settlementTimeoutMs,
			"settlement",
		);
	} catch (error) {
		settlementFailed = true;
		settlementFailure = error;
	}
	if (workFailed) throw primary;
	if (releaseFailed) throw releaseFailure;
	if (settlementCallbackFailed) throw settlementCallbackFailure;
	if (settlementFailed) throw settlementFailure;
	const rejected = settled.find(
		(result): result is PromiseRejectedResult => result.status === "rejected",
	);
	if (rejected) throw rejected.reason;
	return value as Value;
}
import { AsyncLocalStorage } from "node:async_hooks";

import type { PostgresTransactionRunner } from "../../packages/runtime/src/postgres";
