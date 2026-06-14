/**
 * Compat test for the resumable stream store.
 *
 * Validates that the backing store supports the required semantics:
 * - append to a live stream
 * - read from offset (resume cursor)
 * - finish / isFinished
 * - TTL (via health check)
 * - fail-closed on outage
 *
 * Uses an in-memory KV implementation so it can run without infra.
 */

import { describe, expect, it } from "bun:test";

import { ResumableUIMessageStore } from "../resumable-uimessage-store.js";
import {
	QuestpieResumableStreamStore,
	type QuestpieKVLike,
} from "../questpie-resumable-streams.js";

/** Minimal in-memory KV for testing. */
function createTestKV(): QuestpieKVLike {
	const store = new Map<string, { value: unknown; expiresAt?: number }>();
	return {
		async get<T>(key: string): Promise<T | null> {
			const entry = store.get(key);
			if (!entry) return null;
			if (entry.expiresAt && Date.now() > entry.expiresAt) {
				store.delete(key);
				return null;
			}
			return entry.value as T;
		},
		async set(key: string, value: unknown, ttl?: number): Promise<void> {
			store.set(key, {
				value,
				expiresAt: ttl ? Date.now() + ttl * 1000 : undefined,
			});
		},
		async delete(key: string): Promise<void> {
			store.delete(key);
		},
		async has(key: string): Promise<boolean> {
			const entry = store.get(key);
			if (!entry) return false;
			if (entry.expiresAt && Date.now() > entry.expiresAt) {
				store.delete(key);
				return false;
			}
			return true;
		},
	};
}

describe("QuestpieResumableStreamStore", () => {
	it("append + readFrom: sequential appends are readable from offset", async () => {
		const kv = createTestKV();
		const store = new QuestpieResumableStreamStore({ kv, ttlSeconds: 60 });

		const streamId = "test-stream-1";
		await store.append(streamId, "chunk-0");
		await store.append(streamId, "chunk-1");
		await store.append(streamId, "chunk-2");

		// Read all from start
		const all = await store.readFrom(streamId, 0);
		expect(all).toEqual(["chunk-0", "chunk-1", "chunk-2"]);

		// Read from offset 1
		const fromOne = await store.readFrom(streamId, 1);
		expect(fromOne).toEqual(["chunk-1", "chunk-2"]);

		// Read from offset 3 (past end)
		const pastEnd = await store.readFrom(streamId, 3);
		expect(pastEnd).toEqual([]);
	});

	it("finish / isFinished lifecycle", async () => {
		const kv = createTestKV();
		const store = new QuestpieResumableStreamStore({ kv, ttlSeconds: 60 });

		const streamId = "test-stream-2";
		expect(await store.isFinished(streamId)).toBe(false);

		await store.append(streamId, "data");
		expect(await store.isFinished(streamId)).toBe(false);

		await store.finish(streamId);
		expect(await store.isFinished(streamId)).toBe(true);
	});

	it("cleanup removes all stream keys", async () => {
		const kv = createTestKV();
		const store = new QuestpieResumableStreamStore({ kv, ttlSeconds: 60 });

		const streamId = "test-stream-3";
		await store.append(streamId, "a");
		await store.append(streamId, "b");
		await store.finish(streamId);

		await store.cleanup(streamId);

		expect(await store.readFrom(streamId, 0)).toEqual([]);
		expect(await store.isFinished(streamId)).toBe(false);
	});

	it("healthCheck passes with a working KV", async () => {
		const kv = createTestKV();
		const store = new QuestpieResumableStreamStore({ kv, ttlSeconds: 60 });

		// Should not throw
		await store.healthCheck();
	});

	it("healthCheck FAILS CLOSED when KV is broken", async () => {
		const brokenKV: QuestpieKVLike = {
			async get() {
				throw new Error("KV unavailable");
			},
			async set() {
				throw new Error("KV unavailable");
			},
			async delete() {
				throw new Error("KV unavailable");
			},
			async has() {
				throw new Error("KV unavailable");
			},
		};
		const store = new QuestpieResumableStreamStore({
			kv: brokenKV,
			ttlSeconds: 60,
		});

		expect(store.healthCheck()).rejects.toThrow(
			/Resumable stream store health check failed/,
		);
	});
});

describe("ResumableUIMessageStore", () => {
	it("createSink persists chunks that can be read back via resumeStream", async () => {
		const kv = createTestKV();
		const backingStore = new QuestpieResumableStreamStore({
			kv,
			ttlSeconds: 60,
		});
		const store = new ResumableUIMessageStore(backingStore);

		const streamId = "test-uimsg-1";
		const sseChunks = [
			'data: {"type":"text"}\n\n',
			'data: {"type":"done"}\n\n',
		];

		// Create a ReadableStream simulating SSE output
		const sseStream = new ReadableStream<string>({
			start(controller) {
				for (const chunk of sseChunks) {
					controller.enqueue(chunk);
				}
				controller.close();
			},
		});

		// Run the sink
		const sink = store.createSink(streamId);
		await sink({ stream: sseStream });

		// Verify the stream is finished
		expect(await backingStore.isFinished(streamId)).toBe(true);

		// Resume from 0 — there is data to read
		const resumed = await store.resumeStream(streamId, 0);
		expect(resumed).not.toBeNull();

		if (resumed) {
			const reader = resumed.getReader();
			const results: string[] = [];
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				results.push(value);
			}
			expect(results).toEqual(sseChunks);
		}
	});

	it("resumeStream from offset skips already-consumed chunks", async () => {
		const kv = createTestKV();
		const backingStore = new QuestpieResumableStreamStore({
			kv,
			ttlSeconds: 60,
		});
		const store = new ResumableUIMessageStore(backingStore);

		const streamId = "test-uimsg-2";
		await backingStore.append(streamId, "chunk-0");
		await backingStore.append(streamId, "chunk-1");
		await backingStore.append(streamId, "chunk-2");
		await backingStore.finish(streamId);

		// Resume from offset 2
		const resumed = await store.resumeStream(streamId, 2);
		expect(resumed).not.toBeNull();

		if (resumed) {
			const reader = resumed.getReader();
			const results: string[] = [];
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				results.push(value);
			}
			expect(results).toEqual(["chunk-2"]);
		}
	});

	it("resumeStream returns null for finished+empty stream", async () => {
		const kv = createTestKV();
		const backingStore = new QuestpieResumableStreamStore({
			kv,
			ttlSeconds: 60,
		});
		const store = new ResumableUIMessageStore(backingStore);

		const streamId = "test-uimsg-3";
		await backingStore.append(streamId, "chunk-0");
		await backingStore.finish(streamId);

		// Resume from offset past all chunks — nothing left to deliver
		const resumed = await store.resumeStream(streamId, 1);
		expect(resumed).toBeNull();
	});
});
