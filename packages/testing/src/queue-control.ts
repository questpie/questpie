import type { Evidence } from "./evidence.js";
import { positive } from "./validate.js";

const DEFAULT_POLL_INTERVAL_MS = 25;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_QUIET_POLLS = 3;

export interface DrainQueueOptions {
	/**
	 * Outstanding work: pending plus active. The caller supplies it, so this
	 * helper names no queue, adapter or channel and works against any of them
	 * through their public contract.
	 */
	pending: () => number | Promise<number>;
	pollIntervalMs?: number;
	timeoutMs?: number;
	/** Consecutive zero readings required before the queue counts as settled. */
	quietPolls?: number;
	evidence?: Evidence;
}

export interface QueueDrainResult {
	polls: number;
	lastPending: number;
	/** Every count read, in order, for a flaky drain worth reading back. */
	observed: readonly number[];
}

export class QueueDrainError extends Error {
	constructor(
		public readonly lastPending: number,
		public readonly observed: readonly number[],
		timeoutMs: number,
	) {
		super(
			`Queue did not settle within ${timeoutMs}ms. Last outstanding count: ${lastPending}. ` +
				"Check that the worker is running and that the probe counts pending plus active work.",
		);
		this.name = "QueueDrainError";
	}
}

/**
 * Waits for a queue to go quiet, then returns.
 *
 * Quiet means several consecutive zero readings, not the first one. A job that
 * enqueues its follow-up leaves a gap where the queue is briefly empty, and a
 * drain that returns on that gap is the flake that fails one run in twenty.
 */
export async function drainQueue(
	options: DrainQueueOptions,
): Promise<QueueDrainResult> {
	const pollIntervalMs = positive(
		options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
		"pollIntervalMs",
	);
	const timeoutMs = positive(
		options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		"timeoutMs",
	);
	const quietPolls = positive(
		options.quietPolls ?? DEFAULT_QUIET_POLLS,
		"quietPolls",
	);

	const observed: number[] = [];
	const deadline = Date.now() + timeoutMs;
	let quiet = 0;

	while (Date.now() < deadline) {
		const pending = await options.pending();
		if (!Number.isFinite(pending) || pending < 0) {
			throw new TypeError(
				`pending must return a count of zero or more, received ${pending}`,
			);
		}
		observed.push(pending);
		options.evidence?.push("stdout", `queue poll pending=${pending}`);

		quiet = pending === 0 ? quiet + 1 : 0;
		if (quiet >= quietPolls) {
			options.evidence?.push(
				"stdout",
				`queue drained after ${observed.length} poll(s)`,
			);
			return { polls: observed.length, lastPending: pending, observed };
		}
		await Bun.sleep(pollIntervalMs);
	}

	const lastPending = observed.at(-1) ?? 0;
	options.evidence?.push(
		"stderr",
		`queue drain timed out with pending=${lastPending}`,
	);
	throw new QueueDrainError(lastPending, observed, timeoutMs);
}
