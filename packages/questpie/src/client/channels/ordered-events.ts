import type { ChannelTransportMessage } from "./types.js";

export const CHANNEL_CLIENT_MAX_BUFFERED_EVENTS = 100;
export const CHANNEL_CLIENT_MAX_BUFFERED_BYTES = 1024 * 1024;

type ParsedEventId = Readonly<{ channelHash: string; sequence: number }>;

export type OrderedChannelDecision =
	| Readonly<{ status: "accepted" }>
	| Readonly<{ status: "duplicate" }>
	| Readonly<{ status: "gap"; expected: number; received: number }>;

/** Channel-local cursor shared by SSE and managed-provider delivery. */
export class OrderedChannelCursor {
	private last?: ParsedEventId;
	private lastId?: string;

	get eventId(): string | undefined {
		return this.lastId;
	}

	accept(message: ChannelTransportMessage): OrderedChannelDecision {
		const parsed = parseEventId(message.eventId);
		if (!parsed) {
			return {
				status: "gap",
				expected: this.last ? this.last.sequence + 1 : 1,
				received: -1,
			};
		}
		if (!this.last) {
			this.last = parsed;
			this.lastId = message.eventId;
			return { status: "accepted" };
		}
		if (parsed.channelHash !== this.last.channelHash) {
			return {
				status: "gap",
				expected: this.last.sequence + 1,
				received: parsed.sequence,
			};
		}
		if (parsed.sequence <= this.last.sequence) return { status: "duplicate" };
		if (parsed.sequence !== this.last.sequence + 1) {
			return {
				status: "gap",
				expected: this.last.sequence + 1,
				received: parsed.sequence,
			};
		}
		this.last = parsed;
		this.lastId = message.eventId;
		return { status: "accepted" };
	}
}

/** Count- and UTF-8-byte-bounded FIFO used at client delivery seams. */
export class BoundedChannelQueue<T> {
	private readonly values: Array<{ value: T; bytes: number }> = [];
	private bufferedBytes = 0;

	constructor(
		private readonly maximumItems = CHANNEL_CLIENT_MAX_BUFFERED_EVENTS,
		private readonly maximumBytes = CHANNEL_CLIENT_MAX_BUFFERED_BYTES,
		private readonly sizeOf: (value: T) => number = jsonByteLength,
	) {}

	push(value: T): boolean {
		const bytes = this.sizeOf(value);
		if (
			this.values.length + 1 > this.maximumItems ||
			this.bufferedBytes + bytes > this.maximumBytes
		) {
			return false;
		}
		this.values.push({ value, bytes });
		this.bufferedBytes += bytes;
		return true;
	}

	shift(): T | undefined {
		const entry = this.values.shift();
		if (!entry) return undefined;
		this.bufferedBytes -= entry.bytes;
		return entry.value;
	}

	clear(): void {
		this.values.length = 0;
		this.bufferedBytes = 0;
	}

	get length(): number {
		return this.values.length;
	}
}

export function channelGapError(): Error {
	return new Error("Channel event replay gap");
}

export function channelSlowConsumerError(): Error {
	return new Error("Channel client slow consumer");
}

function parseEventId(eventId: string): ParsedEventId | null {
	const match = /^([a-f0-9]{64}):(\d+)$/.exec(eventId);
	if (!match) return null;
	const sequence = Number(match[2]);
	if (!Number.isSafeInteger(sequence) || sequence < 1) return null;
	return { channelHash: match[1], sequence };
}

function jsonByteLength(value: unknown): number {
	try {
		const encoded = JSON.stringify(value);
		return new TextEncoder().encode(encoded ?? "").byteLength;
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}
