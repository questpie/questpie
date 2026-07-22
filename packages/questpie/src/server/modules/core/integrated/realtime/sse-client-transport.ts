import type { RealtimeObservation, RealtimeObserver } from "./observer.js";
import { BoundedOrderedFifoWriter } from "./ordered-fifo-writer.js";
import type {
	ClientCloseReason,
	ClientConfigInput,
	ClientSink,
	ClientTransportConfig,
	ChannelGapFrame,
	DeliveryClass,
	EdgeSessionInput,
	LocalSessionClientTransport,
	OrderedChannelEventFrame,
	SinkWriteResult,
} from "./transport.js";

type SseController = Pick<
	ReadableStreamDefaultController<Uint8Array>,
	"close" | "desiredSize" | "enqueue"
>;

export function encodeSseComment(comment: string): Uint8Array {
	const lines = comment.replaceAll("\r", "").split("\n");
	return new TextEncoder().encode(
		`${lines.map((line) => `: ${line}`).join("\n")}\n\n`,
	);
}

export function encodeSseEvent(event: string, data: unknown): Uint8Array {
	return new TextEncoder().encode(
		`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
	);
}

class SseClientSink implements ClientSink {
	private closed = false;

	constructor(
		readonly sessionId: string,
		private readonly controller: SseController,
		private readonly highWaterMark: number,
		private readonly reportError: (error: unknown) => void,
		private readonly onClose: () => void,
		private readonly observe: (event: RealtimeObservation) => void,
	) {}

	async write(
		frame: Uint8Array,
		delivery: DeliveryClass,
	): Promise<SinkWriteResult> {
		if (this.closed) {
			this.observe({
				type: "sink.write",
				delivery,
				outcome: "failed",
				bufferedBytes: 0,
			});
			throw new Error("Realtime SSE session is closed");
		}
		if (
			this.controller.desiredSize !== null &&
			(this.controller.desiredSize <= 0 ||
				frame.byteLength > this.controller.desiredSize)
		) {
			const result = {
				status: "busy",
				bufferedBytes: Math.max(
					0,
					this.highWaterMark - this.controller.desiredSize,
				),
			} as const;
			this.observe({
				type: "sink.write",
				delivery,
				outcome: "busy",
				bufferedBytes: result.bufferedBytes,
			});
			return result;
		}

		try {
			this.controller.enqueue(frame);
			const desiredSize = this.controller.desiredSize;
			const result = {
				status: "accepted",
				bufferedBytes:
					desiredSize === null
						? null
						: Math.max(0, this.highWaterMark - desiredSize),
			} as const;
			this.observe({
				type: "sink.write",
				delivery,
				outcome: "accepted",
				bufferedBytes: result.bufferedBytes ?? 0,
			});
			return result;
		} catch (error) {
			this.observe({
				type: "sink.write",
				delivery,
				outcome: "failed",
				bufferedBytes: 0,
			});
			this.reportError(error);
			throw error;
		}
	}

	async close(reason: ClientCloseReason): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.onClose();
		this.observe({ type: "session.closed", transport: "sse", reason });
		try {
			this.controller.close();
		} catch {
			// The stream controller may already have been closed by the runtime.
		}
	}
}

export class RealtimeSnapshotBufferOverflowError extends Error {
	constructor(readonly maximumBytes: number) {
		super(`Realtime snapshot buffer exceeds ${maximumBytes} bytes`);
		this.name = "RealtimeSnapshotBufferOverflowError";
	}
}

export class RealtimeDeltaBufferOverflowError extends Error {
	constructor(
		readonly maximumEvents: number,
		readonly maximumBytes: number,
	) {
		super(
			`Realtime delta buffer exceeds ${maximumEvents} events or ${maximumBytes} bytes`,
		);
		this.name = "RealtimeDeltaBufferOverflowError";
	}
}

export type SseOrderedDeltaWriterOptions = {
	maximumBufferedEvents?: number;
	maximumBufferedBytes?: number;
	busyRetryMs?: number;
	onBuffer?: (events: number, bytes: number) => void;
};

/** Per-session append-only writer for row deltas. Overflow closes the session. */
export class SseOrderedDeltaWriter {
	private readonly queue: BoundedOrderedFifoWriter<Uint8Array>;
	private readonly maximumEvents: number;
	private readonly maximumBytes: number;
	private overflowClose: Promise<void> = Promise.resolve();

	constructor(
		private readonly sink: ClientSink,
		private readonly options: SseOrderedDeltaWriterOptions = {},
	) {
		this.maximumEvents = options.maximumBufferedEvents ?? 512;
		this.maximumBytes = options.maximumBufferedBytes ?? 1024 * 1024;
		this.queue = new BoundedOrderedFifoWriter({
			maximumItems: this.maximumEvents,
			maximumBytes: this.maximumBytes,
			busyRetryMs: options.busyRetryMs ?? 25,
			byteLength: (frame) => frame.byteLength,
			write: (frame) => this.sink.write(frame, "row-delta"),
			onAccepted: () => this.observeBuffer(),
			onOverflow: () => {
				this.observeBuffer();
				this.overflowClose = this.sink.close("slow_consumer");
			},
			onError: () => {
				this.queue.clear();
				this.observeBuffer();
				this.overflowClose = this.sink.close("write_failed");
			},
			onRetryDrained: () => this.observeBuffer(),
		});
	}

	get bufferedBytes(): number {
		return this.queue.bufferedBytes;
	}

	async write(frame: Uint8Array): Promise<SinkWriteResult> {
		if (!this.queue.enqueue(frame)) {
			await this.overflowClose;
			throw this.overflowError();
		}
		this.observeBuffer();
		const result = await this.queue.flush();
		this.observeBuffer();
		if (result === "overflow") {
			await this.overflowClose;
			throw this.overflowError();
		}
		return result === "busy"
			? { status: "busy", bufferedBytes: this.queue.totalBufferedBytes }
			: {
					status: "accepted",
					bufferedBytes: this.queue.totalBufferedBytes,
				};
	}

	clear(): void {
		this.queue.clear();
		this.observeBuffer();
	}

	private observeBuffer(): void {
		try {
			this.options.onBuffer?.(this.queue.length, this.queue.totalBufferedBytes);
		} catch {
			// Observability cannot break ordered delivery.
		}
	}

	private overflowError(): RealtimeDeltaBufferOverflowError {
		return new RealtimeDeltaBufferOverflowError(
			this.maximumEvents,
			this.maximumBytes,
		);
	}
}

/** Per-session latest-wins queue used when an SSE stream applies backpressure. */
export class SseLatestSnapshotWriter {
	private readonly pending = new Map<string, Uint8Array>();
	private operation: Promise<void> = Promise.resolve();
	private closed = false;
	private pendingBytes = 0;

	constructor(
		private readonly sink: ClientSink,
		private readonly maximumBufferedBytes = 1024 * 1024,
	) {}

	get bufferedBytes(): number {
		return this.pendingBytes;
	}

	write(topicId: string, frame: Uint8Array): Promise<SinkWriteResult> {
		return this.run(async () => {
			if (this.closed)
				throw new Error("Realtime SSE snapshot writer is closed");
			this.removePending(topicId);
			const result = await this.sink.write(frame, "latest-snapshot");
			if (!this.closed && result.status === "busy") {
				this.setPending(topicId, frame, result.bufferedBytes);
			}
			return result.status === "busy"
				? { ...result, bufferedBytes: result.bufferedBytes + this.pendingBytes }
				: result;
		});
	}

	flush(): Promise<void> {
		return this.run(async () => {
			if (this.closed) return;
			for (const [topicId, frame] of this.pending) {
				this.removePending(topicId);
				const result = await this.sink.write(frame, "latest-snapshot");
				if (result.status === "busy") {
					this.setPending(topicId, frame, result.bufferedBytes);
					break;
				}
			}
		});
	}

	clear(): void {
		this.closed = true;
		this.pending.clear();
		this.pendingBytes = 0;
	}

	private run<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.operation.then(operation);
		this.operation = result.then(
			() => {},
			() => {},
		);
		return result;
	}

	private removePending(topicId: string): void {
		const previous = this.pending.get(topicId);
		if (!previous) return;
		this.pending.delete(topicId);
		this.pendingBytes -= previous.byteLength;
	}

	private setPending(
		topicId: string,
		frame: Uint8Array,
		transportBufferedBytes: number,
	): void {
		if (
			transportBufferedBytes + this.pendingBytes + frame.byteLength >
			this.maximumBufferedBytes
		) {
			throw new RealtimeSnapshotBufferOverflowError(this.maximumBufferedBytes);
		}
		this.pending.set(topicId, frame);
		this.pendingBytes += frame.byteLength;
	}
}

/** Behavior-compatible SSE implementation of the client-delivery seam. */
export class SseClientTransport implements LocalSessionClientTransport {
	readonly channelDeliveryScope = "local-sessions" as const;

	private onError: (error: unknown) => void = () => {};
	private sink: SseClientSink | null = null;
	private stopped = false;

	constructor(
		private readonly controller: SseController,
		private readonly highWaterMark = 1024 * 1024,
		private readonly observer?: RealtimeObserver,
	) {}

	private observe(event: RealtimeObservation): void {
		try {
			this.observer?.record(event);
		} catch {
			// Observability cannot break edge delivery.
		}
	}

	async start(input: { onError: (error: unknown) => void }): Promise<void> {
		this.onError = input.onError;
	}

	async openSession(input: EdgeSessionInput): Promise<ClientSink> {
		if (this.stopped) {
			throw new Error("Realtime SSE transport is stopped");
		}
		if (this.sink) {
			throw new Error("Realtime SSE transport already has an open session");
		}

		const sink = new SseClientSink(
			input.sessionId,
			this.controller,
			this.highWaterMark,
			(error) => this.onError(error),
			() => {
				if (this.sink === sink) this.sink = null;
			},
			(event) => this.observe(event),
		);
		this.sink = sink;
		this.observe({ type: "session.opened", transport: "sse" });
		return sink;
	}

	async getClientConfig(
		_input: ClientConfigInput,
	): Promise<ClientTransportConfig> {
		return { transport: "sse" };
	}

	encodeChannelFrame(
		frame: OrderedChannelEventFrame | ChannelGapFrame,
	): Uint8Array {
		return encodeSseEvent(frame.type, frame);
	}

	async stop(): Promise<void> {
		if (this.stopped) return;
		this.stopped = true;
		await this.sink?.close("normal");
		this.sink = null;
	}
}
