export function controlledRoot(
	input: Readonly<{
		signal?: AbortSignal;
		deadline?: number;
		now: () => number;
	}>,
): Readonly<{
	controller: AbortController;
	readonly deadlineExpired: boolean;
	dispose(): void;
}> {
	const controller = new AbortController();
	let deadlineExpired = false;
	const onAbort = () =>
		controller.abort(
			input.signal?.reason ?? new DOMException("Disconnected", "AbortError"),
		);
	if (input.signal?.aborted) onAbort();
	else input.signal?.addEventListener("abort", onAbort, { once: true });
	const delay =
		input.deadline === undefined
			? undefined
			: Math.max(0, input.deadline - input.now());
	const timer =
		delay === undefined
			? undefined
			: setTimeout(() => {
					deadlineExpired = true;
					controller.abort(new DOMException("Deadline exceeded", "AbortError"));
				}, delay);
	return Object.freeze({
		controller,
		get deadlineExpired() {
			return deadlineExpired;
		},
		dispose() {
			if (timer !== undefined) clearTimeout(timer);
			input.signal?.removeEventListener("abort", onAbort);
		},
	});
}
