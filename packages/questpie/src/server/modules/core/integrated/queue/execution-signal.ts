/** Permanent admission failure; retrying cannot restore the missing prerequisites. */
export class QueueAdmissionError extends Error {}

/**
 * Abort reason for an attempt that ran past its execution deadline. Unlike a
 * shutdown abort, this is a failure of the attempt, so it is reported.
 */
export class QueueExecutionTimeoutError extends Error {
	constructor() {
		super("QUESTPIE Queue execution timed out");
		this.name = "QueueExecutionTimeoutError";
	}
}

/** True when `signal` was aborted because the attempt timed out. */
export function abortedByTimeout(signal?: AbortSignal): boolean {
	return (
		signal?.aborted === true &&
		signal.reason instanceof QueueExecutionTimeoutError
	);
}

/** Wait for user code to settle, retaining concurrency and ownership after abort. */
export async function withQueueAbort<T>(
	promise: Promise<T>,
	signal?: AbortSignal,
): Promise<T> {
	const result = await promise;
	if (signal?.aborted) throw new Error("QUESTPIE Queue execution expired");
	return result;
}
