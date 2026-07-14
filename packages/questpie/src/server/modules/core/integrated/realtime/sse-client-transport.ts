import type {
	ClientCloseReason,
	ClientConfigInput,
	ClientSink,
	ClientTransportConfig,
	DeliveryClass,
	EdgeSessionInput,
	LocalSessionClientTransport,
	SinkWriteResult,
} from "./transport.js";

type SseController = Pick<
	ReadableStreamDefaultController<Uint8Array>,
	"close" | "enqueue"
>;

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

		try {
			this.controller.enqueue(frame);
			return { status: "accepted", bufferedBytes: null };
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

/** Behavior-compatible SSE implementation of the client-delivery seam. */
export class SseClientTransport implements LocalSessionClientTransport {
	readonly channelDeliveryScope = "local-sessions" as const;

	private onError: (error: unknown) => void = () => {};
	private sink: SseClientSink | null = null;
	private stopped = false;

	constructor(private readonly controller: SseController) {}

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

	async stop(): Promise<void> {
		if (this.stopped) return;
		this.stopped = true;
		await this.sink?.close("normal");
		this.sink = null;
	}
}
