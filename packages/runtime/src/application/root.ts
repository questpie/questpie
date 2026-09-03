import type { Principal } from "questpie";

export function principalIdentity(value: Principal): string {
	return `${value.kind}:${value.id}`;
}

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
	let timer: ReturnType<typeof setTimeout> | undefined;
	const scheduleDeadline = () => {
		if (input.deadline === undefined || controller.signal.aborted) return;
		const remaining = input.deadline - input.now();
		if (remaining <= 0) {
			deadlineExpired = true;
			controller.abort(new DOMException("Deadline exceeded", "AbortError"));
			return;
		}
		timer = setTimeout(scheduleDeadline, Math.min(remaining, 2_147_483_647));
	};
	scheduleDeadline();
	return Object.freeze({
		controller,
		get deadlineExpired() {
			return (
				deadlineExpired ||
				(!controller.signal.aborted &&
					input.deadline !== undefined &&
					input.now() >= input.deadline)
			);
		},
		dispose() {
			if (timer !== undefined) clearTimeout(timer);
			input.signal?.removeEventListener("abort", onAbort);
		},
	});
}
