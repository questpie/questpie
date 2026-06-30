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

	/**
	 * Read a CONTIGUOUS slice of chunks starting at `fromOffset` (inclusive).
	 * `nextOffset` advances by the true index span (it stops at the first missing
	 * chunk rather than skipping it). `gap` is true when `fromOffset` is below the
	 * present floor (its chunk TTL-expired) — the caller must treat that as
	 * `expired` (fall back to persisted parts), not as a transient empty read.
	 */
	readFrom(
		streamId: string,
		fromOffset: number,
	): Promise<{ chunks: string[]; nextOffset: number; gap: boolean }>;

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
	 * Persist a `toUIMessages` **chunk-object** stream as JSONL (one
	 * `JSON.stringify(chunk)` per KV entry). The route frames SSE exactly once at
	 * the edge from these raw chunks — eliminating the double-frame class.
	 *
	 * `onBeforeFirstAppend` is the single-writer fence: before the first append
	 * the worker performs an epoch-guarded lease-touch on `run_links`; if it
	 * returns `false` the worker has been superseded by a re-claim and the sink
	 * aborts with ZERO appends and does NOT seal the stream (the re-claimer's sink
	 * owns + seals it). A superseded/zombie writer is further blocked by
	 * `append()`'s post-finish guard.
	 *
	 * Usage:
	 * ```ts
	 * const sink = resumableStore.createSink(streamId, { onBeforeFirstAppend });
	 * await sink({ stream: toUIMessages(result) });
	 * ```
	 */
	createSink(
		streamId: string,
		options?: { onBeforeFirstAppend?: () => Promise<boolean> },
	): (sinkOptions: { stream: ReadableStream<unknown> }) => Promise<void> {
		return async ({ stream }) => {
			const reader = stream.getReader();
			let firstChunk = true;
			let aborted = false;
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					if (firstChunk) {
						firstChunk = false;
						// NOTE: a zero-chunk stream skips this fence entirely. Not a real
						// path — the worker mints a `start` chunk up front (§3.6), so
						// every stream has ≥1 chunk; revisit if a zero-chunk producer
						// is ever introduced.
						if (options?.onBeforeFirstAppend) {
							const stillOwn = await options.onBeforeFirstAppend();
							if (!stillOwn) {
								aborted = true;
								break;
							}
						}
					}
					await this.store.append(streamId, JSON.stringify(value));
				}
			} finally {
				reader.releaseLock();
				// Do NOT seal when superseded — the re-claimer's sink owns the stream.
				if (!aborted) await this.store.finish(streamId);
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
		// Quick check: if finished and nothing to read, return null (stream completed
		// or fully expired — the caller falls back to persisted parts).
		const finished = await this.store.isFinished(streamId);
		const initial = await this.store.readFrom(streamId, fromOffset);
		if (finished && initial.chunks.length === 0) return null;

		const store = this.store;
		let offset = fromOffset;

		return new ReadableStream<string>({
			async pull(controller) {
				const { chunks, nextOffset, gap } = await store.readFrom(
					streamId,
					offset,
				);
				if (gap) {
					// Requested offset is below the expired floor — close rather than
					// tear. (The T6 route surfaces this as `event: expired` by reading
					// `gap` from readFrom directly; the legacy route just ends.)
					controller.close();
					return;
				}
				for (const chunk of chunks) {
					controller.enqueue(chunk);
				}
				offset = nextOffset; // TRUE index span, not += chunks.length
				const done = await store.isFinished(streamId);
				if (done) {
					// Drain any remaining contiguous tail, then close.
					const tail = await store.readFrom(streamId, offset);
					if (!tail.gap) {
						for (const chunk of tail.chunks) {
							controller.enqueue(chunk);
						}
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
