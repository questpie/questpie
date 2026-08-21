type Dispose = () => void;

export type PostgresWakeTickSource = Readonly<{
	armInterval(milliseconds: number, tick: () => void): Dispose;
	armDeadline(milliseconds: number, expire: () => void): Dispose;
}>;

export interface PostgresReconciliationWake {
	start(): Promise<void>;
	requestScan(): Promise<void>;
	drain(input: Readonly<{ deadlineAt: number }>): Promise<void>;
}

const scanMilliseconds = 10_000;

const systemTicks: PostgresWakeTickSource = Object.freeze({
	armInterval(milliseconds, tick) {
		const timer = setInterval(tick, milliseconds);
		timer.unref?.();
		return () => clearInterval(timer);
	},
	armDeadline(milliseconds, expire) {
		const timer = setTimeout(expire, milliseconds);
		timer.unref?.();
		return () => clearTimeout(timer);
	},
});

function timeoutError(): Error {
	return new Error(`PostgreSQL reconciliation exceeded ${scanMilliseconds}ms`);
}

export function createPostgresReconciliationWake(
	input: Readonly<{
		reconcile(signal: AbortSignal): Promise<void>;
		tickSource?: PostgresWakeTickSource;
		signal?: AbortSignal;
	}>,
): PostgresReconciliationWake {
	const ticks = input.tickSource ?? systemTicks;
	let state: "idle" | "armed" | "draining" | "drained" = "idle";
	let queued = false;
	let intervalDispose: Dispose | undefined;
	let deadlineDispose: Dispose | undefined;
	let attemptController: AbortController | undefined;
	let inFlight: Promise<void> | undefined;
	let drainPromise: Promise<void> | undefined;

	const attempt = async (): Promise<void> => {
		const controller = new AbortController();
		attemptController = controller;
		let expired = false;
		const expiredError = timeoutError();
		deadlineDispose = ticks.armDeadline(scanMilliseconds, () => {
			expired = true;
			controller.abort(expiredError);
		});
		try {
			await input.reconcile(controller.signal);
			if (expired) throw expiredError;
		} finally {
			deadlineDispose();
			deadlineDispose = undefined;
			attemptController = undefined;
		}
	};

	const requestScan = (): Promise<void> => {
		if (state === "draining" || state === "drained") return Promise.resolve();
		if (inFlight) {
			queued = true;
			return inFlight;
		}
		const run = (async () => {
			for (;;) {
				queued = false;
				await attempt();
				if (!queued || state !== "armed") break;
			}
		})();
		inFlight = run.finally(() => {
			inFlight = undefined;
		});
		return inFlight;
	};

	const drain = (shutdown: Readonly<{ deadlineAt: number }>): Promise<void> => {
		if (drainPromise) return drainPromise;
		const deadlineAt = shutdown.deadlineAt;
		state = "draining";
		queued = false;
		intervalDispose?.();
		intervalDispose = undefined;
		attemptController?.abort(
			new DOMException("PostgreSQL reconciliation stopped", "AbortError"),
		);
		const active = inFlight;
		drainPromise = (async () => {
			if (active) {
				const remaining = Math.max(0, deadlineAt - Date.now());
				let timer: ReturnType<typeof setTimeout> | undefined;
				try {
					await Promise.race([
						active.catch(() => {}),
						new Promise<void>((resolve) => {
							timer = setTimeout(resolve, remaining);
						}),
					]);
				} finally {
					if (timer) clearTimeout(timer);
				}
			}
			state = "drained";
			input.signal?.removeEventListener("abort", ownerAborted);
		})();
		return drainPromise;
	};
	const ownerAborted = (): void => {
		void drain({ deadlineAt: Date.now() + scanMilliseconds });
	};
	input.signal?.addEventListener("abort", ownerAborted, { once: true });

	return Object.freeze({
		start() {
			if (state !== "idle")
				throw new Error("PostgreSQL reconciliation wake is already started");
			if (input.signal?.aborted) {
				void drain({ deadlineAt: Date.now() + scanMilliseconds });
				return Promise.reject(input.signal.reason);
			}
			state = "armed";
			intervalDispose = ticks.armInterval(scanMilliseconds, () => {
				void requestScan().catch(() => {});
			});
			return requestScan();
		},
		requestScan,
		drain,
	});
}
