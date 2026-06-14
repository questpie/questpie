/**
 * QUESTPIE KV-backed implementation of ResumableStreamStore.
 *
 * ## Compat spike finding
 *
 * The QUESTPIE realtime adapter (`RealtimeService`) is designed for collection
 * change events — `appendChange()` takes structured
 * `{resourceType, resource, operation, payload}`, not arbitrary data.
 * `readSince(seq)` is private and operates on a shared global outbox table.
 * It cannot be used as a per-stream resumable sink.
 *
 * The QUESTPIE KV adapter (`KVService`) is a simple get/set/delete store with
 * TTL support. It has NO native append-to-stream or read-from-offset operations.
 *
 * **Decision**: Build on top of KV using per-chunk key indexing:
 * - `rs:{streamId}:len`  → current chunk count (number)
 * - `rs:{streamId}:c:{i}` → chunk data at index i (string)
 * - `rs:{streamId}:done`  → finished flag (boolean)
 *
 * This works because each stream has EXACTLY ONE writer (the producer),
 * so no concurrent-append races. Readers may see a slightly stale `len`
 * but will catch up on the next poll — acceptable for SSE resume.
 *
 * If the KV adapter is backed by Redis (via `RedisKVAdapter`), we get
 * actual Redis performance. If in-memory, it works for dev/single-node.
 */

import type { ResumableStreamStore } from "./resumable-uimessage-store.js";

/** Options shared by the QUESTPIE KV adapter — a subset of `KVService`. */
export interface QuestpieKVLike {
	get<T = unknown>(key: string): Promise<T | null>;
	set(key: string, value: unknown, ttl?: number): Promise<void>;
	delete(key: string): Promise<void>;
	has(key: string): Promise<boolean>;
}

export interface QuestpieResumableStreamStoreOptions {
	/** The KV service instance (typically `app.kv`). */
	kv: QuestpieKVLike;

	/**
	 * TTL in seconds for all stream keys.
	 * Streams that aren't cleaned up explicitly will expire after this duration.
	 * Default: 3600 (1 hour).
	 */
	ttlSeconds?: number;

	/**
	 * Key prefix to namespace stream data within the KV store.
	 * Default: "rs:" (resumable-stream).
	 */
	keyPrefix?: string;
}

export class QuestpieResumableStreamStore implements ResumableStreamStore {
	private kv: QuestpieKVLike;
	private ttl: number;
	private prefix: string;

	constructor(options: QuestpieResumableStreamStoreOptions) {
		this.kv = options.kv;
		this.ttl = options.ttlSeconds ?? 3600;
		this.prefix = options.keyPrefix ?? "rs:";
	}

	private lenKey(streamId: string): string {
		return `${this.prefix}${streamId}:len`;
	}

	private chunkKey(streamId: string, index: number): string {
		return `${this.prefix}${streamId}:c:${index}`;
	}

	private doneKey(streamId: string): string {
		return `${this.prefix}${streamId}:done`;
	}

	async append(streamId: string, chunk: string): Promise<number> {
		const len = (await this.kv.get<number>(this.lenKey(streamId))) ?? 0;
		const index = len;
		// Write chunk first, then update length — readers see length only after data is present.
		await this.kv.set(this.chunkKey(streamId, index), chunk, this.ttl);
		await this.kv.set(this.lenKey(streamId), index + 1, this.ttl);
		return index;
	}

	async readFrom(streamId: string, fromOffset: number): Promise<string[]> {
		const len = (await this.kv.get<number>(this.lenKey(streamId))) ?? 0;
		if (fromOffset >= len) return [];

		const chunks: string[] = [];
		for (let i = fromOffset; i < len; i++) {
			const chunk = await this.kv.get<string>(this.chunkKey(streamId, i));
			if (chunk !== null) {
				chunks.push(chunk);
			}
			// If a chunk is missing (expired), skip — the client will see a gap.
			// This is acceptable: TTL expiration means the stream is old enough
			// that a full re-fetch is appropriate.
		}
		return chunks;
	}

	async finish(streamId: string): Promise<void> {
		await this.kv.set(this.doneKey(streamId), true, this.ttl);
	}

	async isFinished(streamId: string): Promise<boolean> {
		const done = await this.kv.get<boolean>(this.doneKey(streamId));
		return done === true;
	}

	async cleanup(streamId: string): Promise<void> {
		const len = (await this.kv.get<number>(this.lenKey(streamId))) ?? 0;
		const deletes: Promise<void>[] = [];
		for (let i = 0; i < len; i++) {
			deletes.push(this.kv.delete(this.chunkKey(streamId, i)));
		}
		deletes.push(this.kv.delete(this.lenKey(streamId)));
		deletes.push(this.kv.delete(this.doneKey(streamId)));
		await Promise.all(deletes);
	}

	async healthCheck(): Promise<void> {
		const testKey = `${this.prefix}__health`;
		try {
			await this.kv.set(testKey, "ok", 10);
			const val = await this.kv.get<string>(testKey);
			if (val !== "ok") {
				throw new Error(
					"KV health check failed: read-after-write returned unexpected value",
				);
			}
			await this.kv.delete(testKey);
		} catch (error) {
			throw new Error(
				`Resumable stream store health check failed (KV backing unavailable): ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}

/**
 * Create a QUESTPIE KV-backed resumable stream store.
 * Call `healthCheck()` at boot to enforce fail-closed semantics.
 */
export function createQuestpieResumableStreamStore(
	options: QuestpieResumableStreamStoreOptions,
): QuestpieResumableStreamStore {
	return new QuestpieResumableStreamStore(options);
}
