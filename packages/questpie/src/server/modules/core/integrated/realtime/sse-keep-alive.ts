import { encodeSseComment } from "./sse-client-transport.js";

type TimerApi = {
	now: () => number;
	setTimeout: (callback: () => void, delayMs: number) => unknown;
	clearTimeout: (timer: unknown) => void;
};

type Registration = {
	intervalMs: number;
	nextAt: number;
	onPing: (frame: Uint8Array) => void;
};

const defaultTimerApi: TimerApi = {
	now: Date.now,
	setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
	clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

/** Process-wide keepalive scheduler with at most one active timer. */
export class SharedSseKeepAliveTicker {
	private readonly registrations = new Set<Registration>();
	private timer: unknown;
	private timerDueAt: number | null = null;

	constructor(private readonly timerApi: TimerApi = defaultTimerApi) {}

	get size(): number {
		return this.registrations.size;
	}

	register(
		intervalMs: number,
		onPing: (frame: Uint8Array) => void,
	): () => void {
		const normalizedIntervalMs = Math.max(1, intervalMs);
		const registration: Registration = {
			intervalMs: normalizedIntervalMs,
			nextAt: this.timerApi.now() + normalizedIntervalMs,
			onPing,
		};
		this.registrations.add(registration);
		this.schedule();

		return () => {
			if (!this.registrations.delete(registration)) return;
			this.schedule();
		};
	}

	private schedule(): void {
		let nextAt = Infinity;
		for (const registration of this.registrations) {
			nextAt = Math.min(nextAt, registration.nextAt);
		}

		if (nextAt === Infinity) {
			this.clearTimer();
			return;
		}
		if (this.timerDueAt !== null && this.timerDueAt <= nextAt) return;

		this.clearTimer();
		this.timerDueAt = nextAt;
		this.timer = this.timerApi.setTimeout(
			() => this.tick(),
			Math.max(0, nextAt - this.timerApi.now()),
		);
	}

	private tick(): void {
		this.timer = undefined;
		this.timerDueAt = null;
		const now = this.timerApi.now();
		const frame = encodeSseComment(`ping ${now}`);

		for (const registration of this.registrations) {
			if (registration.nextAt > now) continue;
			registration.nextAt = now + registration.intervalMs;
			try {
				registration.onPing(frame);
			} catch {
				// A connection owns its teardown; one callback must not stop the ticker.
			}
		}
		this.schedule();
	}

	private clearTimer(): void {
		if (this.timer !== undefined) this.timerApi.clearTimeout(this.timer);
		this.timer = undefined;
		this.timerDueAt = null;
	}
}

export const sharedSseKeepAliveTicker = new SharedSseKeepAliveTicker();
