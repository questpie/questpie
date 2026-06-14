/**
 * Resumable UIMessage stream store.
 *
 * Provides append/read-from-offset/finish semantics for SSE chunks
 * so that a client can reconnect and resume an in-flight stream.
 *
 * The store is agnostic to the backing implementation — see
 * `questpie-resumable-streams.ts` for the QUESTPIE KV-backed impl.
 */

/**
 * Low-level stream storage interface.
 * Implementations MUST be safe for single-writer / multi-reader access.
 */
export interface ResumableStreamStore {
	/** Append a chunk to the stream. Returns the 0-based offset of the appended chunk. */
	append(streamId: string, chunk: string): Promise<number>;

	/** Read chunks starting at `fromOffset` (inclusive). Returns `[]` when caught up. */
	readFrom(streamId: string, fromOffset: number): Promise<string[]>;

	/** Mark the stream as finished (no more appends). */
	finish(streamId: string): Promise<void>;

	/** Check if the stream has been marked finished. */
	isFinished(streamId: string): Promise<boolean>;

	/** Delete a stream and all its chunks. */
	cleanup(streamId: string): Promise<void>;

	/**
	 * Health check — MUST throw if the backing store is unavailable.
	 * Called at boot to enforce fail-closed semantics.
	 */
	healthCheck(): Promise<void>;
}

/**
 * A `consumeSseStream`-compatible sink that persists SSE chunks
 * into a `ResumableStreamStore`, plus a reader for resuming.
 */
export class ResumableUIMessageStore {
	constructor(private store: ResumableStreamStore) {}

	/**
	 * Returns a `consumeSseStream` callback for `createUIMessageStreamResponse`.
	 *
	 * Usage:
	 * ```ts
	 * createUIMessageStreamResponse({
	 *   stream,
	 *   consumeSseStream: resumableStore.createSink(streamId),
	 * })
	 * ```
	 */
	createSink(
		streamId: string,
	): (options: { stream: ReadableStream<string> }) => Promise<void> {
		return async ({ stream }) => {
			const reader = stream.getReader();
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					await this.store.append(streamId, value);
				}
			} finally {
				reader.releaseLock();
				await this.store.finish(streamId);
			}
		};
	}

	/**
	 * Resume a stream from the given offset.
	 * Returns a `ReadableStream<string>` of SSE chunks, or `null` if the stream
	 * doesn't exist (already cleaned up or never created).
	 *
	 * The stream stays open (polling) until the backing stream is marked finished,
	 * then closes cleanly.
	 */
	async resumeStream(
		streamId: string,
		fromOffset = 0,
		pollIntervalMs = 500,
	): Promise<ReadableStream<string> | null> {
		// Quick check: if finished and nothing to read, return null (stream completed)
		const finished = await this.store.isFinished(streamId);
		const initial = await this.store.readFrom(streamId, fromOffset);
		if (finished && initial.length === 0) return null;

		const store = this.store;
		let offset = fromOffset;

		return new ReadableStream<string>({
			async pull(controller) {
				const chunks = await store.readFrom(streamId, offset);
				if (chunks.length > 0) {
					for (const chunk of chunks) {
						controller.enqueue(chunk);
					}
					offset += chunks.length;
				}
				const done = await store.isFinished(streamId);
				if (done) {
					// Drain any remaining
					const remaining = await store.readFrom(streamId, offset);
					for (const chunk of remaining) {
						controller.enqueue(chunk);
					}
					controller.close();
				} else if (chunks.length === 0) {
					// Wait before next pull to avoid busy-looping
					await new Promise((r) => setTimeout(r, pollIntervalMs));
				}
			},
		});
	}

	/** Clean up a stream after the client has fully consumed it. */
	async cleanup(streamId: string): Promise<void> {
		await this.store.cleanup(streamId);
	}

	/** Validate the backing store is operational. Throws on failure. */
	async healthCheck(): Promise<void> {
		await this.store.healthCheck();
	}
}
