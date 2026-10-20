/** Reject on execution expiry while observing late handler rejection. */
export function withQueueAbort<T>(
	promise: Promise<T>,
	signal?: AbortSignal,
): Promise<T> {
	if (!signal) return promise;
	return new Promise<T>((resolve, reject) => {
		const aborted = () => reject(new Error("QUESTPIE Queue execution expired"));
		signal.addEventListener("abort", aborted, { once: true });
		if (signal.aborted) aborted();
		promise
			.then(resolve, reject)
			.finally(() => signal.removeEventListener("abort", aborted));
	});
}
