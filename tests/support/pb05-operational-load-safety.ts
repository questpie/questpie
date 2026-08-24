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
	const mutationCallbacks =
		input.snapshot.idleGaps["mutation:fresh:handler"]?.count;
	const realtimeCallbacks =
		input.snapshot.idleGaps["realtime:apply:apply"]?.count;
	const maintenance = input.snapshot.contention.maintenance;
	const reconciliation = input.snapshot.contention.reconciliation;
	const retention = input.snapshot.contention.retention;
	const expectedLockProofs = input.expected.contentionSamples * 3;
	if (
		mutationCallbacks !== input.expected.callbackSamples ||
		realtimeCallbacks !== input.expected.callbackSamples ||
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

export function createPb05ContentionOperationOwner() {
	const settled = Promise.withResolvers<void>();
	void settled.promise.catch(() => undefined);
	let accepting = true;
	let started = false;
	return Object.freeze({
		get settlement(): Promise<void> {
			return settled.promise;
		},
		start<Result>(use: () => Promise<Result>): Promise<Result> {
			if (!accepting || started)
				return Promise.reject(
					new Error("PB-05 contention operation owner is closed"),
				);
			accepting = false;
			started = true;
			let operation: Promise<Result>;
			try {
				operation = use();
			} catch (error) {
				operation = Promise.reject(error);
			}
			void operation.then(
				() => settled.resolve(),
				(error) => settled.reject(error),
			);
			void operation.catch(() => undefined);
			return operation;
		},
		close(): void {
			accepting = false;
			if (!started) settled.resolve();
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
