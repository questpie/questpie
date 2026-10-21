/** Permanent admission failure; retrying cannot restore the missing prerequisites. */
export class QueueAdmissionError extends Error {}

/** Wait for user code to settle, retaining concurrency and ownership after abort. */
export async function withQueueAbort<T>(
	promise: Promise<T>,
	signal?: AbortSignal,
): Promise<T> {
	const result = await promise;
	if (signal?.aborted) throw new Error("QUESTPIE Queue execution expired");
	return result;
}
