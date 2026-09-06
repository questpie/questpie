type Reservation = Readonly<{ callId: string }>;

/** Proof-only attempt coordinator; adapters own durable identity and receipts. */
export function createMutationCheckpointAttempt<
	Command extends Readonly<{ name: string }>,
	Result,
>(
	adapter: Readonly<{
		historyLength: number;
		signal?: AbortSignal;
		reserve(command: Command, ordinal: number): Promise<Reservation>;
		invoke(command: Command, reservation: Reservation): Promise<Result>;
		complete(
			command: Command,
			ordinal: number,
			reservation: Reservation,
		): Promise<void>;
	}>,
) {
	const historyLength = adapter.historyLength;
	if (
		!Number.isSafeInteger(historyLength) ||
		historyLength < 0 ||
		historyLength > 64
	)
		throw new Error("CHECKPOINT_LIMIT");
	let consumed = 0;
	let failed: Readonly<{ reason: unknown }> | undefined;
	let inFlight = false;
	let finished = false;
	const pending = new Set<Promise<Result>>();
	const assertUsable = () => {
		if (adapter.signal?.aborted) failed ??= { reason: adapter.signal.reason };
		if (failed) throw failed.reason;
	};
	const execute = async (rawCommand: Command): Promise<Result> => {
		assertUsable();
		if (finished) throw new Error("ATTEMPT_FINISHED");
		if (inFlight) {
			failed = { reason: new Error("CONCURRENT_STEP") };
			throw failed.reason;
		}
		inFlight = true;
		try {
			if (consumed === 64) throw new Error("CHECKPOINT_LIMIT");
			// Proof inputs are detached before any await. The production adapter
			// must still validate/canonically encode them with the Mutation codec.
			const command = structuredClone(rawCommand);
			const ordinal = consumed + 1;
			const reservation = await adapter.reserve(command, ordinal);
			assertUsable();
			const result = await adapter.invoke(command, reservation);
			assertUsable();
			await adapter.complete(command, ordinal, reservation);
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
		mutation(command: Command): Promise<Result> {
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
		async finish(): Promise<void> {
			finished = true;
			if (adapter.signal?.aborted) failed ??= { reason: adapter.signal.reason };
			const reason = inFlight
				? "INCOMPLETE_STEP"
				: consumed < historyLength
					? "TRUNCATED_HISTORY"
					: null;
			if (reason) {
				failed ??= { reason: new Error(reason) };
			}
			await Promise.allSettled(pending);
			assertUsable();
		},
	});
}
