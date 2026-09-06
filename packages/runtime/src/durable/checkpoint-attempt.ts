import { DurableCheckpointError } from "./checkpoint-contract";

/** Owns command admission and every started promise until attempt completion. */
export function createMutationCheckpointAttemptOwner<
	Command extends Readonly<{ name: string }>,
	Result,
	Reservation,
	RawCommand,
>(
	adapter: Readonly<{
		historyLength: number;
		capture(command: RawCommand): Command;
		signal?: AbortSignal;
		reserve(command: Command, ordinal: number): Promise<Reservation>;
		invoke(command: Command, reservation: Reservation): Promise<Result>;
		complete(
			command: Command,
			ordinal: number,
			reservation: Reservation,
			result: Result,
		): Promise<void>;
	}>,
) {
	const historyLength = adapter.historyLength;
	if (
		!Number.isSafeInteger(historyLength) ||
		historyLength < 0 ||
		historyLength > 64
	)
		throw new DurableCheckpointError("RESOURCE_LIMIT");
	let consumed = 0;
	let failed: Readonly<{ reason: unknown }> | undefined;
	let inFlight = false;
	let finished = false;
	const pending = new Set<Promise<Result>>();
	const assertUsable = () => {
		if (adapter.signal?.aborted) failed ??= { reason: adapter.signal.reason };
		if (failed) throw failed.reason;
	};
	const execute = async (rawCommand: RawCommand): Promise<Result> => {
		assertUsable();
		if (finished) throw new DurableCheckpointError();
		if (inFlight) {
			failed = { reason: new DurableCheckpointError() };
			throw failed.reason;
		}
		inFlight = true;
		try {
			if (consumed === 64) throw new DurableCheckpointError("RESOURCE_LIMIT");
			// The owning codec captures private canonical values before any await.
			const command = adapter.capture(rawCommand);
			const ordinal = consumed + 1;
			const reservation = await adapter.reserve(command, ordinal);
			assertUsable();
			const result = await adapter.invoke(command, reservation);
			assertUsable();
			await adapter.complete(command, ordinal, reservation, result);
			assertUsable();
			consumed = ordinal;
			return result;
		} catch (reason) {
			failed ??= { reason };
			throw failed.reason;
		} finally {
			inFlight = false;
		}
	};
	return Object.freeze({
		mutation(command: RawCommand): Promise<Result> {
			const work = execute(command);
			pending.add(work);
			// Own forgotten-promise rejection and cleanup; callers still receive
			// the original rejecting promise and finish still reports the failure.
			void work.then(
				() => pending.delete(work),
				() => pending.delete(work),
			);
			return work;
		},
		async finish(
			handlerFailure?: Readonly<{ reason: unknown }>,
		): Promise<void> {
			finished = true;
			if (adapter.signal?.aborted) failed ??= { reason: adapter.signal.reason };
			// Incomplete history prevents successful settlement, not the ordinary
			// retry of a handler that failed before reaching its recorded steps.
			failed ??= handlerFailure;
			const reason = inFlight
				? "INCOMPLETE_STEP"
				: consumed < historyLength
					? "TRUNCATED_HISTORY"
					: null;
			if (reason) {
				failed ??= { reason: new DurableCheckpointError() };
			}
			await Promise.allSettled(pending);
			assertUsable();
		},
	});
}
