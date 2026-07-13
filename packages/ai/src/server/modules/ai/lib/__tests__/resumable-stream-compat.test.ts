/**
 * Compat test for the resumable stream store.
 *
 * Validates the T3 contracts:
 * - append persists / post-finish guard (no write after finish)
 * - readFrom returns a CONTIGUOUS slice with a typed `{chunks, nextOffset, gap}`
 *   (advance by true index; gap signals an expired prefix, never a torn slice)
 * - createSink persists chunk-OBJECTS as JSONL (JSON.stringify per entry) with an
 *   epoch-guard seam (superseded → zero appends, no seal)
 * - resumeStream resumes from offset and closes cleanly
 * - health check / fail-closed
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
	it("append + readFrom: contiguous slice advances nextOffset by true index", async () => {
		const kv = createTestKV();
		const store = new QuestpieResumableStreamStore({ kv, ttlSeconds: 60 });

		const streamId = "test-stream-1";
		await store.append(streamId, "chunk-0");
		await store.append(streamId, "chunk-1");
		await store.append(streamId, "chunk-2");

		const all = await store.readFrom(streamId, 0);
		expect(all.chunks).toEqual(["chunk-0", "chunk-1", "chunk-2"]);
		expect(all.nextOffset).toBe(3);
		expect(all.gap).toBe(false);

		const fromOne = await store.readFrom(streamId, 1);
		expect(fromOne.chunks).toEqual(["chunk-1", "chunk-2"]);
		expect(fromOne.nextOffset).toBe(3);
		expect(fromOne.gap).toBe(false);

		// Past end → caught up, NOT a gap.
		const pastEnd = await store.readFrom(streamId, 3);
		expect(pastEnd.chunks).toEqual([]);
		expect(pastEnd.nextOffset).toBe(3);
		expect(pastEnd.gap).toBe(false);
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

	it("append is a no-op after finish (post-finish guard)", async () => {
		const kv = createTestKV();
		const store = new QuestpieResumableStreamStore({ kv, ttlSeconds: 60 });

		const streamId = "test-postfinish";
		await store.append(streamId, "a");
		await store.finish(streamId);

		// A zombie/superseded writer's late append must be dropped, not appended
		// past the seal.
		const idx = await store.append(streamId, "b");
		expect(idx).toBe(1); // returns current len, no write
		expect((await store.readFrom(streamId, 0)).chunks).toEqual(["a"]);
	});

	it("readFrom reports a typed gap for an expired prefix, not a torn slice", async () => {
		const kv = createTestKV();
		const store = new QuestpieResumableStreamStore({ kv, ttlSeconds: 60 });

		const streamId = "test-expired";
		await store.append(streamId, "chunk-0");
		await store.append(streamId, "chunk-1");
		await store.append(streamId, "chunk-2");

		// Simulate TTL expiry of the earliest chunk (KV expires oldest-first).
		await kv.delete("rs:test-expired:c:0");

		// From the expired floor → gap, NOT a torn ["chunk-1","chunk-2"].
		const fromZero = await store.readFrom(streamId, 0);
		expect(fromZero.chunks).toEqual([]);
		expect(fromZero.gap).toBe(true);

		// From the present floor → contiguous, no gap, true-index nextOffset.
		const fromOne = await store.readFrom(streamId, 1);
		expect(fromOne.chunks).toEqual(["chunk-1", "chunk-2"]);
		expect(fromOne.gap).toBe(false);
		expect(fromOne.nextOffset).toBe(3);
	});

	it("cleanup removes all stream keys", async () => {
		const kv = createTestKV();
		const store = new QuestpieResumableStreamStore({ kv, ttlSeconds: 60 });

		const streamId = "test-stream-3";
		await store.append(streamId, "a");
		await store.append(streamId, "b");
		await store.finish(streamId);

		await store.cleanup(streamId);

		expect((await store.readFrom(streamId, 0)).chunks).toEqual([]);
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
	it("createSink persists chunk-objects as JSONL readable via resumeStream", async () => {
		const kv = createTestKV();
		const backingStore = new QuestpieResumableStreamStore({
			kv,
			ttlSeconds: 60,
		});
		const store = new ResumableUIMessageStore(backingStore);

		const streamId = "test-uimsg-1";
		const chunks = [
			{ type: "start", messageId: "m1" },
			{ type: "text-delta", id: "0", delta: "hello" },
			{ type: "finish" },
		];

		const objectStream = new ReadableStream<unknown>({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(chunk);
				controller.close();
			},
		});

		await store.createSink(streamId)({ stream: objectStream });

		expect(await backingStore.isFinished(streamId)).toBe(true);

		const resumed = await store.resumeStream(streamId, 0);
		expect(resumed).not.toBeNull();

		const results: string[] = [];
		if (resumed) {
			const reader = resumed.getReader();
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				results.push(value);
			}
		}
		// Each stored entry is JSON.stringify(chunk) and round-trips back.
		expect(results).toEqual(chunks.map((chunk) => JSON.stringify(chunk)));
		expect(results.map((result) => JSON.parse(result))).toEqual(chunks);
	});

	it("createSink aborts with zero appends and no seal when superseded", async () => {
		const kv = createTestKV();
		const backingStore = new QuestpieResumableStreamStore({
			kv,
			ttlSeconds: 60,
		});
		const store = new ResumableUIMessageStore(backingStore);

		const streamId = "test-superseded";
		const objectStream = new ReadableStream<unknown>({
			start(controller) {
				controller.enqueue({ type: "start" });
				controller.enqueue({ type: "text-delta", id: "0", delta: "x" });
				controller.close();
			},
		});

		// onBeforeFirstAppend → false: the worker was superseded by a re-claim.
		await store.createSink(streamId, {
			onBeforeFirstAppend: async () => false,
		})({ stream: objectStream });

		// Zero appends AND not sealed (the re-claimer's sink owns + seals it).
		expect((await backingStore.readFrom(streamId, 0)).chunks).toEqual([]);
		expect(await backingStore.isFinished(streamId)).toBe(false);
	});

	it("createSink leaves a THROWING stream unsealed (finalizeRun owns the error tail)", async () => {
		const kv = createTestKV();
		const backingStore = new QuestpieResumableStreamStore({
			kv,
			ttlSeconds: 60,
		});
		const store = new ResumableUIMessageStore(backingStore);

		const streamId = "test-throwing";
		// Error on a LATER pull — erroring in start() would discard the queued
		// chunks before the sink ever reads them.
		let pulls = 0;
		const objectStream = new ReadableStream<unknown>({
			pull(controller) {
				pulls++;
				if (pulls === 1) {
					controller.enqueue({ type: "start" });
					controller.enqueue({ type: "text-delta", id: "0", delta: "x" });
					return;
				}
				controller.error(new Error("mid-stream harness failure"));
			},
		});

		await expect(
			store.createSink(streamId)({ stream: objectStream }),
		).rejects.toThrow("mid-stream harness failure");

		// Partial chunks persisted, but NOT sealed — finalizeRun(failed) must be
		// able to append its {error, finish} tail (the post-finish guard would
		// silently drop it on a sealed stream, hiding the failure from the FE).
		expect(
			(await backingStore.readFrom(streamId, 0)).chunks.length,
		).toBeGreaterThan(0);
		expect(await backingStore.isFinished(streamId)).toBe(false);
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
