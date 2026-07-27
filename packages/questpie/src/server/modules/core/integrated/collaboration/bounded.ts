export type BoundedQueuePushResult =
	| { accepted: true }
	| { accepted: false; reason: "items" | "bytes" };

export class BoundedSemaphore {
	private activeCount = 0;
	private readonly maximum: number;

	constructor(maximum: number) {
		if (!Number.isSafeInteger(maximum) || maximum < 1) {
			throw new Error("BoundedSemaphore maximum must be a positive integer");
		}
		this.maximum = maximum;
	}

	get active(): number {
		return this.activeCount;
	}

	tryAcquire(): (() => void) | null {
		if (this.activeCount >= this.maximum) return null;
		this.activeCount += 1;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.activeCount -= 1;
		};
	}
}

export class BoundedQueue<T> {
	private readonly values: Array<{ value: T; bytes: number }> = [];
	private byteCount = 0;
	private readonly maxItems: number;
	private readonly maxBytes: number;
	private readonly sizeOf: (value: T) => number;

	constructor(options: {
		maxItems: number;
		maxBytes: number;
		sizeOf: (value: T) => number;
	}) {
		if (!Number.isSafeInteger(options.maxItems) || options.maxItems < 1) {
			throw new Error("BoundedQueue maxItems must be a positive integer");
		}
		if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) {
			throw new Error("BoundedQueue maxBytes must be a positive integer");
		}
		this.maxItems = options.maxItems;
		this.maxBytes = options.maxBytes;
		this.sizeOf = options.sizeOf;
	}

	get length(): number {
		return this.values.length;
	}

	get bytes(): number {
		return this.byteCount;
	}

	tryPush(value: T): BoundedQueuePushResult {
		const bytes = this.sizeOf(value);
		if (!Number.isSafeInteger(bytes) || bytes < 0) {
			throw new Error("BoundedQueue item size must be a non-negative integer");
		}
		if (this.values.length >= this.maxItems) {
			return { accepted: false, reason: "items" };
		}
		if (this.byteCount + bytes > this.maxBytes) {
			return { accepted: false, reason: "bytes" };
		}
		this.values.push({ value, bytes });
		this.byteCount += bytes;
		return { accepted: true };
	}

	shift(): T | undefined {
		const entry = this.values.shift();
		if (!entry) return undefined;
		this.byteCount -= entry.bytes;
		return entry.value;
	}

	clear(): void {
		this.values.length = 0;
		this.byteCount = 0;
	}
}
