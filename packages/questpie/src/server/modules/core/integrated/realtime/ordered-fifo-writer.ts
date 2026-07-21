import type { SinkWriteResult } from "./transport.js";

export type OrderedFifoFlushResult = "drained" | "busy" | "overflow";

export type BoundedOrderedFifoWriterOptions<T> = {
	maximumItems: number;
	maximumBytes: number;
	busyRetryMs: number;
	byteLength: (value: T) => number;
	write: (value: T) => Promise<SinkWriteResult>;
	onAccepted?: (value: T) => void;
	onError?: (error: unknown) => void;
	onOverflow?: () => void;
	onRetryDrained?: () => void;
};

type PendingItem<T> = {
	value: T;
	bytes: number;
};

/** Shared bounded, non-coalescing FIFO for ordered realtime delivery. */
export class BoundedOrderedFifoWriter<T> {
	private readonly pending: PendingItem<T>[] = [];
	private operation: Promise<void> = Promise.resolve();
	private retryTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingBytes = 0;
	private transportBytes = 0;
	private isClosed = false;

	constructor(private readonly options: BoundedOrderedFifoWriterOptions<T>) {}

	get length(): number {
		return this.pending.length;
	}

	get bufferedBytes(): number {
		return this.pendingBytes;
	}

	get totalBufferedBytes(): number {
		return this.pendingBytes + this.transportBytes;
	}

	get closed(): boolean {
		return this.isClosed;
	}

	enqueue(value: T): boolean {
		if (this.isClosed) return false;
		const bytes = this.options.byteLength(value);
		if (
			this.pending.length + 1 > this.options.maximumItems ||
			this.pendingBytes + bytes > this.options.maximumBytes
		) {
			this.overflow();
			return false;
		}
		this.pending.push({ value, bytes });
		this.pendingBytes += bytes;
		return true;
	}

	flush(): Promise<OrderedFifoFlushResult> {
		return this.run(() => this.flushPending());
	}

	clear(): void {
		if (this.retryTimer) clearTimeout(this.retryTimer);
		this.retryTimer = null;
		this.isClosed = true;
		this.pending.length = 0;
		this.pendingBytes = 0;
		this.transportBytes = 0;
	}

	private async flushPending(): Promise<OrderedFifoFlushResult> {
		while (!this.isClosed && this.pending.length > 0) {
			const item = this.pending[0]!;
			const result = await this.options.write(item.value);
			this.transportBytes = result.bufferedBytes ?? 0;
			if (result.status === "busy") {
				if (
					this.transportBytes + this.pendingBytes >
					this.options.maximumBytes
				) {
					this.overflow();
					return "overflow";
				}
				this.scheduleRetry();
				return "busy";
			}
			this.pending.shift();
			this.pendingBytes -= item.bytes;
			this.options.onAccepted?.(item.value);
		}

		if (this.retryTimer) clearTimeout(this.retryTimer);
		this.retryTimer = null;
		return this.isClosed ? "overflow" : "drained";
	}

	private scheduleRetry(): void {
		if (this.retryTimer || this.isClosed) return;
		this.retryTimer = setTimeout(() => {
			this.retryTimer = null;
			void this.flush()
				.then((result) => {
					if (result === "drained") this.options.onRetryDrained?.();
				})
				.catch((error) => this.options.onError?.(error));
		}, this.options.busyRetryMs);
	}

	private overflow(): void {
		if (this.isClosed) return;
		this.clear();
		this.options.onOverflow?.();
	}

	private run<TOutput>(operation: () => Promise<TOutput>): Promise<TOutput> {
		const result = this.operation.then(operation);
		this.operation = result.then(
			() => {},
			() => {},
		);
		return result;
	}
}
