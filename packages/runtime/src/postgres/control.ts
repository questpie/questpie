import type { PostgresControl } from "./contract";

export function createPostgresControlSignal(
	control: PostgresControl | undefined,
): Readonly<{ signal: AbortSignal | undefined; close(): void }> {
	let deadline: AbortSignal | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	if (control?.deadlineAt !== undefined) {
		const controller = new AbortController();
		timer = setTimeout(
			() => controller.abort(new Error("PostgreSQL deadline elapsed")),
			Math.max(0, Math.ceil(control.deadlineAt - Date.now())),
		);
		timer.unref();
		deadline = controller.signal;
	}
	const signals = [control?.signal, deadline].filter(
		(signal): signal is AbortSignal => signal !== undefined,
	);
	const signal =
		signals.length === 0
			? undefined
			: signals.length === 1
				? signals[0]
				: AbortSignal.any(signals);
	return Object.freeze({
		signal,
		close() {
			if (timer) clearTimeout(timer);
		},
	});
}
