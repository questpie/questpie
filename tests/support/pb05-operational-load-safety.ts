export const pb05OperationalDatabase =
	"questpie_pb05_operational_measurement" as const;
export const pb05OperationalResetOptIn =
	"questpie_pb05_operational_measurement" as const;

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
