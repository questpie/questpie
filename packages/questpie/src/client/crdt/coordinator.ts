type PullWaiter = {
	resolve(): void;
	reject(error: unknown): void;
};

type PullEntry = {
	running: boolean;
	queued: boolean;
	dirty: boolean;
	task: () => Promise<void>;
	runningWaiters: PullWaiter[];
	nextWaiters: PullWaiter[];
};

export type CrdtAwarenessLane = "outbound" | "roster";

type AwarenessEntry = Partial<Record<CrdtAwarenessLane, () => Promise<void>>>;

type AwarenessQueueEntry = Readonly<{
	key: object;
	lane: CrdtAwarenessLane;
}>;

const MAXIMUM_GLOBAL_PULLS = 2;
const AWARENESS_INTERVAL_MS = 50;

/**
 * Client-wide bounded scheduler for all collaborative documents.
 *
 * Pull requests made during an active pull belong to its one coalesced
 * follow-up generation. A hot document rotates behind already queued siblings.
 * Awareness has independent outbound and roster lanes and one fair global
 * 20 Hz limiter.
 */
export class CrdtClientCoordinator {
	private readonly pulls = new Map<object, PullEntry>();
	private readonly ready: object[] = [];
	private activePulls = 0;
	private readonly awareness = new Map<object, AwarenessEntry>();
	private readonly awarenessReady: AwarenessQueueEntry[] = [];
	private awarenessTimer: ReturnType<typeof setTimeout> | undefined;
	private awarenessRunning = false;
	private destroyed = false;
	private readonly maximumConcurrentPulls: number;

	constructor(
		private readonly options: Readonly<{
			maximumConcurrentPulls?: number;
			setTimeout?: typeof globalThis.setTimeout;
			clearTimeout?: typeof globalThis.clearTimeout;
		}> = {},
	) {
		const configured = options.maximumConcurrentPulls ?? MAXIMUM_GLOBAL_PULLS;
		this.maximumConcurrentPulls =
			Number.isSafeInteger(configured) && configured > 0
				? Math.min(configured, MAXIMUM_GLOBAL_PULLS)
				: MAXIMUM_GLOBAL_PULLS;
	}

	requestPull(key: object, task: () => Promise<void>): Promise<void> {
		if (this.destroyed)
			return Promise.reject(new Error("CRDT client is closed"));
		const entry = this.getOrCreatePull(key, task);
		entry.task = task;
		const promise = new Promise<void>((resolve, reject) => {
			entry.nextWaiters.push({ resolve, reject });
		});
		if (entry.running) {
			entry.dirty = true;
		} else if (!entry.queued) {
			this.enqueuePull(key, entry);
		}
		return promise;
	}

	/**
	 * Schedule one waiter-free pull. Repeated hints while a pull is active retain
	 * only one follow-up and the latest task closure.
	 */
	schedulePull(key: object, task: () => Promise<void>): void {
		if (this.destroyed) return;
		const entry = this.getOrCreatePull(key, task);
		entry.task = task;
		if (entry.running) {
			entry.dirty = true;
		} else if (!entry.queued) {
			this.enqueuePull(key, entry);
		}
	}

	queueAwareness(
		key: object,
		lane: CrdtAwarenessLane,
		task: () => Promise<void>,
	): void;
	/** @deprecated Pass an explicit awareness lane. */
	queueAwareness(key: object, task: () => Promise<void>): void;
	queueAwareness(
		key: object,
		laneOrTask: CrdtAwarenessLane | (() => Promise<void>),
		task?: () => Promise<void>,
	): void {
		if (this.destroyed) return;
		const lane = typeof laneOrTask === "function" ? "outbound" : laneOrTask;
		const resolvedTask = typeof laneOrTask === "function" ? laneOrTask : task;
		if (!resolvedTask) return;
		let entry = this.awareness.get(key);
		if (!entry) {
			entry = {};
			this.awareness.set(key, entry);
		}
		if (!entry[lane]) this.awarenessReady.push({ key, lane });
		entry[lane] = resolvedTask;
		this.armAwareness();
	}

	release(key: object): void {
		const entry = this.pulls.get(key);
		if (entry) {
			this.pulls.delete(key);
			this.rejectWaiters(entry.runningWaiters);
			this.rejectWaiters(entry.nextWaiters);
		}
		this.awareness.delete(key);
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		if (this.awarenessTimer !== undefined) {
			(this.options.clearTimeout ?? globalThis.clearTimeout)(
				this.awarenessTimer,
			);
			this.awarenessTimer = undefined;
		}
		for (const key of this.pulls.keys()) this.release(key);
		this.ready.length = 0;
		this.awareness.clear();
		this.awarenessReady.length = 0;
	}

	private getOrCreatePull(key: object, task: () => Promise<void>): PullEntry {
		let entry = this.pulls.get(key);
		if (!entry) {
			entry = {
				running: false,
				queued: false,
				dirty: false,
				task,
				runningWaiters: [],
				nextWaiters: [],
			};
			this.pulls.set(key, entry);
		}
		return entry;
	}

	private enqueuePull(key: object, entry: PullEntry): void {
		entry.queued = true;
		this.ready.push(key);
		queueMicrotask(() => this.drainPulls());
	}

	private drainPulls(): void {
		while (!this.destroyed && this.activePulls < this.maximumConcurrentPulls) {
			const key = this.ready.shift();
			if (!key) return;
			const entry = this.pulls.get(key);
			if (!entry || !entry.queued || entry.running) continue;
			entry.queued = false;
			entry.running = true;
			entry.dirty = false;
			entry.runningWaiters = entry.nextWaiters.splice(0);
			const task = entry.task;
			this.activePulls++;
			void runTask(task)
				.then(() => this.resolveWaiters(entry.runningWaiters))
				.catch((error) => this.rejectWaiters(entry.runningWaiters, error))
				.finally(() => {
					this.activePulls--;
					entry.running = false;
					if (this.pulls.get(key) === entry && entry.dirty) {
						this.enqueuePull(key, entry);
					} else if (this.pulls.get(key) === entry) {
						this.pulls.delete(key);
					}
					this.drainPulls();
				});
		}
	}

	private resolveWaiters(waiters: PullWaiter[]): void {
		for (const waiter of waiters.splice(0)) waiter.resolve();
	}

	private rejectWaiters(
		waiters: PullWaiter[],
		error: unknown = new Error("CRDT document disconnected"),
	): void {
		for (const waiter of waiters.splice(0)) waiter.reject(error);
	}

	private armAwareness(): void {
		if (
			this.destroyed ||
			this.awarenessRunning ||
			this.awarenessTimer !== undefined ||
			this.awarenessReady.length === 0
		) {
			return;
		}
		this.awarenessTimer = (this.options.setTimeout ?? globalThis.setTimeout)(
			() => {
				this.awarenessTimer = undefined;
				void this.flushOneAwareness();
			},
			AWARENESS_INTERVAL_MS,
		);
	}

	private async flushOneAwareness(): Promise<void> {
		if (this.destroyed || this.awarenessRunning) return;
		let task: (() => Promise<void>) | undefined;
		while (!task) {
			const queued = this.awarenessReady.shift();
			if (!queued) return;
			const entry = this.awareness.get(queued.key);
			task = entry?.[queued.lane];
			if (!task || !entry) continue;
			delete entry[queued.lane];
			if (!entry.outbound && !entry.roster) this.awareness.delete(queued.key);
		}
		this.awarenessRunning = true;
		try {
			await task();
		} catch {
			// Awareness is ephemeral; document tasks own observable error handling.
		} finally {
			this.awarenessRunning = false;
			this.armAwareness();
		}
	}
}

async function runTask(task: () => Promise<void>): Promise<void> {
	await task();
}
