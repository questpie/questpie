import { notifyChannelConsumer } from "./consumer-callback.js";
import { BoundedChannelQueue } from "./ordered-events.js";

type ReadyRegistration = {
	callback: () => void;
	onEnd?: () => void;
	active: boolean;
	notifiedEpoch: number;
};

/** Per-logical-registration readiness over one shared channel transport entry. */
export class ChannelReadiness {
	private readonly registrations = new Set<ReadyRegistration>();
	private epoch = 0;
	private admitted = false;

	get isReady(): boolean {
		return this.admitted;
	}

	register(callback: (() => void) | undefined, onEnd?: () => void): () => void {
		if (!callback && !onEnd) return () => {};
		const registration: ReadyRegistration = {
			callback: callback ?? (() => {}),
			onEnd,
			active: true,
			notifiedEpoch: 0,
		};
		this.registrations.add(registration);
		if (this.admitted) {
			const epoch = this.epoch;
			queueMicrotask(() => this.notify(registration, epoch));
		}
		return () => {
			registration.active = false;
			this.registrations.delete(registration);
		};
	}

	admit(): void {
		if (this.admitted) return;
		this.admitted = true;
		this.epoch += 1;
		const registrations = Array.from(this.registrations);
		for (const registration of registrations) {
			this.notify(registration, this.epoch);
		}
	}

	end(): void {
		this.admitted = false;
		for (const registration of this.registrations) {
			if (!registration.active) continue;
			try {
				registration.onEnd?.();
			} catch {
				// One subscriber cannot block epoch reset for its siblings.
			}
		}
	}

	destroy(): void {
		this.admitted = false;
		for (const registration of this.registrations) {
			registration.active = false;
		}
		this.registrations.clear();
	}

	private notify(registration: ReadyRegistration, epoch: number): void {
		if (
			!registration.active ||
			!this.admitted ||
			this.epoch !== epoch ||
			registration.notifiedEpoch === epoch
		) {
			return;
		}
		registration.notifiedEpoch = epoch;
		try {
			registration.callback();
		} catch {
			// Consumer readiness failures cannot tear down a shared transport entry.
		}
	}
}

/**
 * Keeps a logical subscriber that joins an admitted shared entry inactive until
 * its guarded readiness callback runs. Frames racing that microtask remain FIFO
 * and bounded instead of crossing the subscriber's admission boundary.
 */
export class ChannelReadyDelivery<T> {
	private readonly pending = new BoundedChannelQueue<T>();
	private readonly releaseReady: () => void;
	private awaitingReady: boolean;
	private draining = false;
	private active = true;

	readonly accept = (value: T): void => {
		if (!this.active) return;
		if (this.waitForAdmission && !this.readiness.isReady) {
			this.awaitingReady = true;
		}
		if (!this.pending.push(value)) {
			this.overflow();
			return;
		}
		this.drain();
	};

	constructor(
		private readonly readiness: ChannelReadiness,
		private readonly callback: (value: T) => void,
		onReady: (() => void) | undefined,
		private readonly onOverflow: () => void,
		private readonly waitForAdmission = false,
	) {
		this.awaitingReady = waitForAdmission || readiness.isReady;
		this.releaseReady = readiness.register(
			onReady || this.awaitingReady
				? () => {
						try {
							onReady?.();
						} finally {
							if (this.active && this.awaitingReady) {
								this.awaitingReady = false;
								this.drain();
							}
						}
					}
				: undefined,
			() => this.endEpoch(),
		);
	}

	private endEpoch(): void {
		if (!this.active || !this.waitForAdmission) return;
		this.pending.clear();
		this.awaitingReady = true;
	}

	private drain(): void {
		if (!this.active || this.awaitingReady || this.draining) return;
		if (this.waitForAdmission && !this.readiness.isReady) {
			this.awaitingReady = true;
			return;
		}
		this.draining = true;
		try {
			while (this.active && this.pending.length > 0) {
				if (this.waitForAdmission && !this.readiness.isReady) {
					this.awaitingReady = true;
					break;
				}
				notifyChannelConsumer(this.callback, this.pending.shift()!);
			}
		} finally {
			this.draining = false;
		}
	}

	private overflow(): void {
		if (!this.active) return;
		this.active = false;
		this.pending.clear();
		this.releaseReady();
		this.onOverflow();
	}

	stop(): void {
		if (!this.active) return;
		this.active = false;
		this.pending.clear();
		this.releaseReady();
	}
}
