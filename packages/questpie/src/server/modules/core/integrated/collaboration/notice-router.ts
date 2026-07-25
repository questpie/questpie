import type {
	ChangeBroker,
	ChangeBrokerState,
	ChangeWake,
} from "../realtime/transport.js";
import { BoundedQueue } from "./bounded.js";

type RealtimeWake = Exclude<ChangeWake, { kind: "crdt" }>;
type CrdtWake = Extract<ChangeWake, { kind: "crdt" }>;

export type CoreNotice =
	| { kind: "realtime"; wake: RealtimeWake }
	| { kind: "crdt"; wake: CrdtWake };

type NoticeKind = CoreNotice["kind"];
type NoticeFor<TKind extends NoticeKind> = Extract<CoreNotice, { kind: TKind }>;

export type CoreNoticeSubscription<TKind extends NoticeKind> = {
	kind: TKind;
	routingKey?: string;
	onNotice: (notice: NoticeFor<TKind>) => void | Promise<void>;
	onError?: (error: unknown) => void;
	onOverflow?: (dropped: number) => void;
	onStateChange?: (state: ChangeBrokerState) => void;
};

type Subscriber = {
	active: boolean;
	kind: NoticeKind;
	routingKey?: string;
	queue: BoundedQueue<CoreNotice>;
	draining: boolean;
	dropped: number;
	overflowReported: boolean;
	onNotice: (notice: CoreNotice) => void | Promise<void>;
	onError?: (error: unknown) => void;
	onOverflow?: (dropped: number) => void;
	onStateChange?: (state: ChangeBrokerState) => void;
};

const DEFAULT_MAX_SUBSCRIBER_ITEMS = 256;
const DEFAULT_MAX_SUBSCRIBER_BYTES = 128 * 1024;
const encoder = new TextEncoder();

function noticeBytes(notice: CoreNotice): number {
	return encoder.encode(JSON.stringify(notice)).byteLength;
}

/**
 * One core-owned lifecycle and isolated, bounded fanout over a notice-only
 * ChangeBroker. Durable consumers remain responsible for reconciliation.
 */
export class CoreNoticeRouter {
	private readonly subscribers = new Set<Subscriber>();
	private readonly keyedCrdtSubscribers = new Map<string, Set<Subscriber>>();
	private readonly maxSubscriberItems: number;
	private readonly maxSubscriberBytes: number;
	private started = false;
	private startPromise: Promise<void> | null = null;
	private stopPromise: Promise<void> | null = null;

	constructor(
		private readonly broker?: ChangeBroker,
		options: {
			maxSubscriberItems?: number;
			maxSubscriberBytes?: number;
		} = {},
	) {
		this.maxSubscriberItems =
			options.maxSubscriberItems ?? DEFAULT_MAX_SUBSCRIBER_ITEMS;
		this.maxSubscriberBytes =
			options.maxSubscriberBytes ?? DEFAULT_MAX_SUBSCRIBER_BYTES;
	}

	async subscribe<TKind extends NoticeKind>(
		input: CoreNoticeSubscription<TKind>,
	): Promise<() => Promise<void>> {
		if (input.routingKey !== undefined && input.kind !== "crdt") {
			throw new Error("Only CRDT notices support keyed routing");
		}
		const subscriber: Subscriber = {
			active: true,
			kind: input.kind,
			routingKey: input.routingKey,
			queue: new BoundedQueue({
				maxItems: this.maxSubscriberItems,
				maxBytes: this.maxSubscriberBytes,
				sizeOf: noticeBytes,
			}),
			draining: false,
			dropped: 0,
			overflowReported: false,
			onNotice: input.onNotice as Subscriber["onNotice"],
			onError: input.onError,
			onOverflow: input.onOverflow,
			onStateChange: input.onStateChange,
		};
		this.subscribers.add(subscriber);
		if (subscriber.routingKey !== undefined) {
			const keyed =
				this.keyedCrdtSubscribers.get(subscriber.routingKey) ?? new Set();
			keyed.add(subscriber);
			this.keyedCrdtSubscribers.set(subscriber.routingKey, keyed);
		}

		try {
			await this.ensureStarted();
		} catch (error) {
			subscriber.active = false;
			this.removeSubscriber(subscriber);
			throw error;
		}

		let released = false;
		return async () => {
			if (released) return;
			released = true;
			subscriber.active = false;
			subscriber.queue.clear();
			this.removeSubscriber(subscriber);
			if (this.subscribers.size === 0) await this.stop();
		};
	}

	async publish(wake: ChangeWake): Promise<void> {
		if (!this.broker) return;
		if (this.startPromise) await this.startPromise;
		if (!this.started) {
			throw new Error("Core notice router is not started");
		}
		await this.broker.publish(wake);
	}

	private async ensureStarted(): Promise<void> {
		if (!this.broker || this.started) return;
		if (this.stopPromise) await this.stopPromise;
		if (this.started) return;
		if (!this.startPromise) {
			this.startPromise = this.broker.start({
				onWake: (wake) => this.route(wake),
				onError: (error) => this.reportError(error),
				onStateChange: (state) => this.reportState(state),
			});
		}
		const operation = this.startPromise;
		try {
			await operation;
			this.started = true;
		} finally {
			if (this.startPromise === operation) this.startPromise = null;
		}
	}

	private async stop(): Promise<void> {
		if (!this.broker) return;
		if (this.startPromise) {
			try {
				await this.startPromise;
			} catch {
				return;
			}
		}
		if (!this.started || this.subscribers.size > 0) return;
		if (!this.stopPromise) {
			this.stopPromise = this.broker.stop().finally(() => {
				this.started = false;
				this.stopPromise = null;
			});
		}
		await this.stopPromise;
	}

	private route(wake: ChangeWake): void {
		const notice: CoreNotice =
			wake.kind === "crdt"
				? { kind: "crdt", wake }
				: { kind: "realtime", wake };
		if (notice.kind === "crdt") {
			for (const subscriber of this.keyedCrdtSubscribers.get(
				notice.wake.aggregateHash,
			) ?? []) {
				this.enqueue(subscriber, notice);
			}
			for (const subscriber of this.subscribers) {
				if (subscriber.kind !== "crdt" || subscriber.routingKey !== undefined) {
					continue;
				}
				this.enqueue(subscriber, notice);
			}
			return;
		}
		for (const subscriber of this.subscribers) {
			if (subscriber.kind !== notice.kind) continue;
			this.enqueue(subscriber, notice);
		}
	}

	private removeSubscriber(subscriber: Subscriber): void {
		this.subscribers.delete(subscriber);
		if (subscriber.routingKey === undefined) return;
		const keyed = this.keyedCrdtSubscribers.get(subscriber.routingKey);
		keyed?.delete(subscriber);
		if (keyed?.size === 0) {
			this.keyedCrdtSubscribers.delete(subscriber.routingKey);
		}
	}

	private enqueue(subscriber: Subscriber, notice: CoreNotice): void {
		if (!subscriber.active) return;
		const result = subscriber.queue.tryPush(notice);
		if (!result.accepted) {
			subscriber.dropped += 1;
			subscriber.queue.clear();
			const retry = subscriber.queue.tryPush(notice);
			if (!retry.accepted) {
				this.invokeError(
					subscriber,
					new Error("Core notice exceeds subscriber byte budget"),
				);
				return;
			}
			if (!subscriber.overflowReported) {
				subscriber.overflowReported = true;
				this.invokeCallback(() => subscriber.onOverflow?.(subscriber.dropped));
			}
		}
		this.drain(subscriber);
	}

	private drain(subscriber: Subscriber): void {
		if (subscriber.draining) return;
		subscriber.draining = true;
		void (async () => {
			try {
				while (subscriber.active) {
					const notice = subscriber.queue.shift();
					if (!notice) break;
					try {
						await subscriber.onNotice(notice);
					} catch (error) {
						this.invokeError(subscriber, error);
					}
					subscriber.dropped = 0;
					subscriber.overflowReported = false;
				}
			} finally {
				subscriber.draining = false;
				if (subscriber.active && subscriber.queue.length > 0) {
					this.drain(subscriber);
				}
			}
		})();
	}

	private reportError(error: unknown): void {
		for (const subscriber of this.subscribers) {
			this.invokeError(subscriber, error);
		}
	}

	private reportState(state: ChangeBrokerState): void {
		for (const subscriber of this.subscribers) {
			this.invokeCallback(() => subscriber.onStateChange?.(state));
		}
	}

	private invokeError(subscriber: Subscriber, error: unknown): void {
		this.invokeCallback(() => subscriber.onError?.(error));
	}

	private invokeCallback(
		callback: () => void | Promise<void> | undefined,
	): void {
		try {
			void Promise.resolve(callback()).catch(() => {});
		} catch {
			// One observer cannot affect router or sibling subscribers.
		}
	}
}
