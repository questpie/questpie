export type CrdtProjectionRunResult = Readonly<{
	/**
	 * Earliest durable due time still known to the runner. The coordinator also
	 * applies a polling ceiling because another process may insert earlier work.
	 */
	nextDueAt: Date | null;
}>;

export interface CrdtProjectionOperationalRunner {
	runDue(input: { signal: AbortSignal }): Promise<CrdtProjectionRunResult>;
}

export interface CrdtMaintenanceOperationalRunner {
	/**
	 * Claims and executes bounded compaction/GC work. Database leases, rather
	 * than process affinity, must decide which API or queue-worker instance wins.
	 */
	runDue(input: { signal: AbortSignal }): Promise<void>;
}

type TimerHandle = ReturnType<typeof setTimeout>;

export type CrdtOperationalCoordinatorOptions = Readonly<{
	/**
	 * False when the resolved runtime has no collaborative owners, no compatible
	 * engines, or is being used for schema introspection.
	 */
	available: boolean;
	projection: CrdtProjectionOperationalRunner;
	maintenance: CrdtMaintenanceOperationalRunner;
	projectionPollCeilingMs?: number;
	maintenanceIntervalMs?: number;
	minimumDelayMs?: number;
	stopTimeoutMs?: number;
	now?: () => number;
	setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
	clearTimer?: (handle: TimerHandle) => void;
	onError?: (error: unknown, operation: "projection" | "maintenance") => void;
}>;

export type CrdtOperationalCoordinator = Readonly<{
	start(): void;
	wake(): void;
	stop(): Promise<void>;
}>;

const DEFAULT_PROJECTION_POLL_CEILING_MS = 2_000;
const DEFAULT_MAINTENANCE_INTERVAL_MS = 60_000;
const DEFAULT_MINIMUM_DELAY_MS = 10;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;

/**
 * Private in-process scheduler for durable CRDT operations.
 *
 * It owns no database connection, worker process, schema discovery, or lease.
 * Runners remain responsible for bounded database claims and fenced leases, so
 * identical coordinators are safe in API and queue-worker processes.
 */
export function createCrdtOperationalCoordinator(
	options: CrdtOperationalCoordinatorOptions,
): CrdtOperationalCoordinator {
	const projectionPollCeilingMs = positiveDuration(
		options.projectionPollCeilingMs ?? DEFAULT_PROJECTION_POLL_CEILING_MS,
		"projection polling ceiling",
	);
	const maintenanceIntervalMs = positiveDuration(
		options.maintenanceIntervalMs ?? DEFAULT_MAINTENANCE_INTERVAL_MS,
		"maintenance interval",
	);
	const minimumDelayMs = positiveDuration(
		options.minimumDelayMs ?? DEFAULT_MINIMUM_DELAY_MS,
		"minimum delay",
	);
	const stopTimeoutMs = nonnegativeDuration(
		options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS,
		"stop timeout",
	);
	const now = options.now ?? Date.now;
	const setTimer = options.setTimer ?? setTimeout;
	const clearTimer = options.clearTimer ?? clearTimeout;
	const abort = new AbortController();

	let started = false;
	let stopping = false;
	let timer: TimerHandle | undefined;
	let running: Promise<void> | undefined;
	let rerun = false;
	let stopPromise: Promise<void> | undefined;
	let projectionDueAt = 0;
	let maintenanceDueAt = 0;

	const report = (error: unknown, operation: "projection" | "maintenance") => {
		try {
			options.onError?.(error, operation);
		} catch {
			// Observation cannot affect durable operational progress.
		}
	};

	const schedule = () => {
		if (!started || stopping || !options.available || running) return;
		if (timer) clearTimer(timer);
		const delay = Math.max(
			minimumDelayMs,
			Math.min(projectionDueAt, maintenanceDueAt) - now(),
		);
		timer = setTimer(() => {
			timer = undefined;
			trigger();
		}, delay);
		unrefTimer(timer);
	};

	const execute = async () => {
		while (true) {
			rerun = false;
			if (stopping || abort.signal.aborted) return;
			const cycleNow = now();

			if (projectionDueAt <= cycleNow) {
				try {
					const result = await options.projection.runDue({
						signal: abort.signal,
					});
					if (stopping || abort.signal.aborted) return;
					projectionDueAt = rerun
						? now()
						: nextProjectionDueAt(
								result.nextDueAt,
								now(),
								projectionPollCeilingMs,
								minimumDelayMs,
							);
				} catch (error) {
					if (stopping || abort.signal.aborted) return;
					report(error, "projection");
					projectionDueAt = now() + projectionPollCeilingMs;
				}
			}

			if (stopping || abort.signal.aborted) return;
			if (maintenanceDueAt <= cycleNow) {
				try {
					await options.maintenance.runDue({ signal: abort.signal });
				} catch (error) {
					if (!stopping && !abort.signal.aborted) {
						report(error, "maintenance");
					}
				}
				if (stopping || abort.signal.aborted) return;
				maintenanceDueAt = now() + maintenanceIntervalMs;
			}
			if (!rerun || stopping) return;
		}
	};

	const trigger = () => {
		if (!started || stopping || !options.available) return;
		if (running) {
			rerun = true;
			return;
		}
		running = execute()
			.catch((error) => {
				if (!stopping) report(error, "projection");
			})
			.finally(() => {
				running = undefined;
				if (!stopping) schedule();
			});
	};

	return Object.freeze({
		start() {
			if (started || stopping) return;
			started = true;
			if (!options.available) return;
			const current = now();
			projectionDueAt = current;
			maintenanceDueAt = current;
			trigger();
		},
		wake() {
			if (!started || stopping || !options.available) return;
			projectionDueAt = now();
			if (timer) {
				clearTimer(timer);
				timer = undefined;
			}
			trigger();
		},
		async stop() {
			if (stopPromise) return stopPromise;
			stopping = true;
			abort.abort();
			if (timer) {
				clearTimer(timer);
				timer = undefined;
			}
			const operation = running;
			stopPromise = operation
				? boundedWait(operation, stopTimeoutMs, setTimer, clearTimer)
				: Promise.resolve();
			await stopPromise;
		},
	});
}

function nextProjectionDueAt(
	nextDueAt: Date | null,
	now: number,
	pollCeilingMs: number,
	minimumDelayMs: number,
): number {
	const ceiling = now + pollCeilingMs;
	if (!nextDueAt) return ceiling;
	const due = nextDueAt.getTime();
	if (!Number.isFinite(due)) return ceiling;
	return Math.min(ceiling, Math.max(now + minimumDelayMs, due));
}

async function boundedWait(
	operation: Promise<unknown>,
	timeoutMs: number,
	setTimer: (callback: () => void, delayMs: number) => TimerHandle,
	clearTimer: (handle: TimerHandle) => void,
): Promise<void> {
	let timer: TimerHandle | undefined;
	try {
		await Promise.race([
			operation.catch(() => {}),
			new Promise<void>((resolve) => {
				timer = setTimer(resolve, timeoutMs);
				unrefTimer(timer);
			}),
		]);
	} finally {
		if (timer) clearTimer(timer);
	}
}

function unrefTimer(timer: TimerHandle): void {
	const candidate = timer as unknown as { unref?: () => void };
	candidate.unref?.();
}

function positiveDuration(value: number, label: string): number {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new TypeError(`CRDT ${label} must be a positive safe integer`);
	}
	return value;
}

function nonnegativeDuration(value: number, label: string): number {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new TypeError(`CRDT ${label} must be a nonnegative safe integer`);
	}
	return value;
}
