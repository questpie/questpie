export async function awaitExecutionPhase<Value>(
	signal: AbortSignal,
	use: () => Value | PromiseLike<Value>,
): Promise<Value> {
	let rejectAbort: ((reason?: unknown) => void) | undefined;
	const aborted = new Promise<never>((_resolve, reject) => {
		rejectAbort = reject;
	});
	const onAbort = () => rejectAbort?.(signal.reason);
	signal.addEventListener("abort", onAbort, { once: true });
	if (signal.aborted) onAbort();
	const pending = Promise.resolve().then(() => {
		if (signal.aborted) throw signal.reason;
		return use();
	});
	void pending.catch(() => undefined);
	try {
		return await Promise.race([pending, aborted]);
	} finally {
		signal.removeEventListener("abort", onAbort);
		rejectAbort = undefined;
	}
}
