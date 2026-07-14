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
	) {}

	async write(
		frame: Uint8Array,
		_delivery: DeliveryClass,
	): Promise<SinkWriteResult> {
		if (this.closed) {
			throw new Error("Realtime SSE session is closed");
		}
		if (
			this.controller.desiredSize !== null &&
			(this.controller.desiredSize <= 0 ||
				frame.byteLength > this.controller.desiredSize)
		) {
			return {
				status: "busy",
				bufferedBytes: Math.max(
					0,
					this.highWaterMark - this.controller.desiredSize,
				),
			};
		}

		try {
			this.controller.enqueue(frame);
			const desiredSize = this.controller.desiredSize;
			return {
				status: "accepted",
				bufferedBytes:
					desiredSize === null
						? null
						: Math.max(0, this.highWaterMark - desiredSize),
			};
		} catch (error) {
			this.reportError(error);
			throw error;
		}
	}

	async close(_reason: ClientCloseReason): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.onClose();
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
	) {}

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
		);
		this.sink = sink;
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
