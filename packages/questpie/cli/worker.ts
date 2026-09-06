export type CliDurableWorker = Readonly<{
	poll(): Promise<unknown>;
	beginDrain(): void;
}>;

/** The ordinary generated worker owns production; the CLI owns only its host cadence. */
export function startDurableWorkerPolling(worker: CliDurableWorker) {
	let stopping = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let wake: (() => void) | undefined;
	let stopped: Promise<void> | undefined;
	const loop = (async () => {
		for (;;) {
			if (stopping) return;
			try {
				await worker.poll();
			} catch {
				if (!stopping) console.error("questpie: durable worker poll failed");
			}
			if (!stopping)
				await new Promise<void>((resolve) => {
					wake = resolve;
					timer = setTimeout(resolve, 1000);
				});
		}
	})();
	return Object.freeze({
		stop(deadlineAt: number): Promise<void> {
			if (stopped) return stopped;
			stopping = true;
			if (timer) clearTimeout(timer);
			wake?.();
			stopped = (async () => {
				worker.beginDrain();
				let deadline: ReturnType<typeof setTimeout> | undefined;
				try {
					await Promise.race([
						loop,
						new Promise<never>((_resolve, reject) => {
							deadline = setTimeout(
								() =>
									reject(
										new Error("durable worker shutdown deadline exceeded"),
									),
								Math.max(0, deadlineAt - Date.now()),
							);
						}),
					]);
				} finally {
					if (deadline) clearTimeout(deadline);
				}
			})();
			return stopped;
		},
	});
}
