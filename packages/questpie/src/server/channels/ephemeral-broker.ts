/** Best-effort fan-out. Messages are bounded UTF-8 strings, never a durable log.
 * One instance is owned by the app runtime. A Redis pub/sub adapter only needs
 * these three operations; delivery APIs do not depend on the broker.
 */
export interface EphemeralBroker {
	start(
		onMessage: (message: string) => void,
		onDisconnect: (error: unknown) => void,
	): Promise<void>;
	/** One flush; adapters may send the packets in one network round trip. */
	publish(messages: readonly string[]): Promise<void>;
	stop(): Promise<void>;
}

/** Single-process default. Share the app runtime between HTTP handlers. */
export class InProcessEphemeralBroker implements EphemeralBroker {
	private listener?: (message: string) => void;
	async start(onMessage: (message: string) => void): Promise<void> {
		this.listener = onMessage;
	}
	async publish(messages: readonly string[]): Promise<void> {
		for (const message of messages) this.listener?.(message);
	}
	async stop(): Promise<void> {
		this.listener = undefined;
	}
}
