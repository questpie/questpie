import type {
	CoreNotice,
	CoreNoticeSubscription,
} from "../collaboration/notice-router.js";

export interface CrdtDrainNoticeRouter {
	subscribe(
		input: CoreNoticeSubscription<"crdt">,
	): Promise<() => Promise<void>>;
}

export type CrdtDrainSession = Readonly<{
	id: string;
	aggregateHash: string;
	reconcile(
		reason: "wake" | "reconnect" | "poll",
		signal: AbortSignal,
	): Promise<{
		behind: boolean;
	}>;
}>;

type Entry = {
	session: CrdtDrainSession;
	active: boolean;
	running: boolean;
	dirty: boolean;
	reason: "wake" | "reconnect" | "poll";
	behind: boolean;
	pending?: Promise<void>;
};

export function createCrdtDrainCoordinator(
	input: Readonly<{
		router: CrdtDrainNoticeRouter;
		healthyPollMs?: number;
		behindPollMs?: number;
		stopTimeoutMs?: number;
		onError?(error: unknown): void;
	}>,
) {
	const healthyPollMs = input.healthyPollMs ?? 2_000;
	const behindPollMs = input.behindPollMs ?? 250;
	const stopTimeoutMs = input.stopTimeoutMs ?? 5_000;
	const entries = new Map<string, Entry>();
	let releaseRouter: (() => Promise<void>) | undefined;
	let healthyTimer: ReturnType<typeof setInterval> | undefined;
	let behindTimer: ReturnType<typeof setInterval> | undefined;
	let started = false;
	let stopping = false;
	let startPromise: Promise<void> | undefined;
	let stopPromise: Promise<void> | undefined;
	const abort = new AbortController();

	const report = (error: unknown) => {
		try {
			input.onError?.(error);
		} catch {
			// Observation cannot affect reconciliation.
		}
	};

	const run = (entry: Entry) => {
		if (!entry.active || stopping) return;
		entry.dirty = true;
		if (entry.running) return;
		entry.running = true;
		entry.pending = (async () => {
			try {
				while (entry.dirty) {
					if (!entry.active || stopping) break;
					entry.dirty = false;
					try {
						const result = await entry.session.reconcile(
							entry.reason,
							abort.signal,
						);
						if (entry.active && !stopping) entry.behind = result.behind;
					} catch (error) {
						entry.behind = true;
						report(error);
					}
				}
			} finally {
				entry.running = false;
				entry.pending = undefined;
			}
		})();
	};

	const scheduleAll = (reason: Entry["reason"], behindOnly = false) => {
		for (const entry of entries.values()) {
			if (behindOnly && !entry.behind) continue;
			entry.reason = reason;
			run(entry);
		}
	};

	const onNotice = (notice: Extract<CoreNotice, { kind: "crdt" }>) => {
		for (const entry of entries.values()) {
			if (entry.session.aggregateHash !== notice.wake.aggregateHash) continue;
			entry.reason = "wake";
			run(entry);
		}
	};

	return Object.freeze({
		async start(): Promise<void> {
			if (started) return;
			if (stopping) throw new Error("CRDT drain coordinator is stopped");
			if (!startPromise) {
				startPromise = (async () => {
					releaseRouter = await input.router.subscribe({
						kind: "crdt",
						onNotice,
						onError: report,
						onOverflow: () => scheduleAll("poll"),
						onStateChange: (state) => {
							if (state === "connected") scheduleAll("reconnect");
						},
					});
					if (stopping) return;
					started = true;
					healthyTimer = setInterval(
						() => scheduleAll("poll"),
						Math.max(1, healthyPollMs),
					);
					behindTimer = setInterval(
						() => scheduleAll("poll", true),
						Math.max(1, behindPollMs),
					);
				})().finally(() => {
					startPromise = undefined;
				});
			}
			await startPromise;
		},
		register(session: CrdtDrainSession): () => void {
			if (!started || stopping || entries.has(session.id)) {
				throw new Error("CRDT drain session cannot be registered");
			}
			if (!/^[a-f0-9]{64}$/.test(session.aggregateHash)) {
				throw new Error("CRDT aggregate hash is invalid");
			}
			const entry: Entry = {
				session,
				active: true,
				running: false,
				dirty: false,
				reason: "poll",
				behind: false,
			};
			entries.set(session.id, entry);
			let released = false;
			return () => {
				if (released) return;
				released = true;
				entry.active = false;
				entry.dirty = false;
				entries.delete(session.id);
			};
		},
		async poll(): Promise<void> {
			if (!started || stopping) return;
			scheduleAll("poll");
			await Promise.all(
				[...entries.values()]
					.map((entry) => entry.pending)
					.filter((pending): pending is Promise<void> => Boolean(pending)),
			);
		},
		async stop(): Promise<void> {
			if (stopPromise) return stopPromise;
			stopping = true;
			abort.abort();
			stopPromise = (async () => {
				await startPromise?.catch(() => {});
				if (healthyTimer) clearInterval(healthyTimer);
				if (behindTimer) clearInterval(behindTimer);
				healthyTimer = undefined;
				behindTimer = undefined;
				const pending = [...entries.values()]
					.map((entry) => {
						entry.active = false;
						entry.dirty = false;
						return entry.pending;
					})
					.filter((operation): operation is Promise<void> =>
						Boolean(operation),
					);
				entries.clear();
				await boundedWait(Promise.allSettled(pending), stopTimeoutMs);
				if (releaseRouter) {
					await boundedWait(releaseRouter(), stopTimeoutMs);
				}
				releaseRouter = undefined;
				started = false;
			})();
			return stopPromise;
		},
	});
}

async function boundedWait(
	operation: Promise<unknown>,
	timeoutMs: number,
): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			operation,
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, Math.max(0, timeoutMs));
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
