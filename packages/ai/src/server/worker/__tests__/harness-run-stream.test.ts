/**
 * T4: runHarnessRun streaming core.
 *
 * Drives runHarnessRun with a mock agent whose `stream` returns a REAL
 * StreamTextResult (streamText + MockLanguageModelV3, the T0b-spike recipe), an
 * in-memory KV, and a where-ignoring mock run_links collection. Asserts the
 * Step-4 Verify: chunk-JSON in KV under activeStreamId (start carries the minted
 * messageId), the loop-driven heartbeat advances the lease, resume state is
 * persisted at end-of-turn, summary + tokens accumulated.
 *
 * NOTE: the mock collection ignores the RAW epoch predicate (it can't evaluate
 * a drizzle SQL fragment), so this proves the WIRING (casUpdate invoked, lease
 * bumped, sink persists) — not the RAW SQL predicate itself (that needs an
 * integration test; the superseded → zero-appends path is proven in T3).
 */

import { describe, expect, it } from "bun:test";
import { streamText } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";

import {
	QuestpieResumableStreamStore,
	type QuestpieKVLike,
} from "../../modules/ai/lib/questpie-resumable-streams.js";
import { runHarnessRun } from "../run-harness.js";

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
			return store.has(key);
		},
	};
}

function buildMockAgent(detachValue: unknown) {
	const model = new MockLanguageModelV3({
		doStream: async () => ({
			stream: simulateReadableStream({
				initialDelayInMs: 0,
				chunkDelayInMs: 10, // outlast a tiny heartbeat tick
				chunks: [
					{ type: "stream-start", warnings: [] },
					{ type: "text-start", id: "0" },
					{ type: "text-delta", id: "0", delta: "Hello" },
					{ type: "text-delta", id: "0", delta: " world" },
					{ type: "text-end", id: "0" },
					{
						type: "finish",
						finishReason: { unified: "stop", raw: undefined },
						usage: {
							inputTokens: {
								total: 3,
								noCache: 3,
								cacheRead: undefined,
								cacheWrite: undefined,
							},
							outputTokens: { total: 5, text: 5, reasoning: undefined },
						},
					},
				],
			}),
		}),
	});
	const session = {
		sessionId: "sess1",
		isResume: false,
		async detach() {
			return detachValue;
		},
		async stop() {},
	};
	return {
		async createSession() {
			return session;
		},
		async stream() {
			return streamText({ model, prompt: "hi" });
		},
	};
}

describe("runHarnessRun (T4)", () => {
	it("streams JSONL to KV, heartbeats the lease, persists resume state, accumulates summary+tokens", async () => {
		const kv = createTestKV();
		const detachValue = { checkpoint: "final" };

		const row: Record<string, unknown> = {
			id: "r1",
			activeStreamId: "run-stream:s1",
			runtime: "claude-code",
			instructions: "hi",
			harnessSessionId: "sess1",
			producerLease: { epoch: 1, workerId: "w1" },
			metadata: { cwd: "/tmp/x" },
			harnessResumeState: null,
		};
		let leaseUpdates = 0;
		const collections = {
			run_links: {
				async update({ data }: { where: unknown; data: Record<string, unknown> }) {
					if (data.producerLease) leaseUpdates++;
					Object.assign(row, data);
					return [row];
				},
				async findOne() {
					return { ...row };
				},
			},
		};

		const result = await runHarnessRun({
			run: row as never,
			collections: collections as never,
			kv,
			workerDir: "/tmp/wd",
			heartbeatMs: 5,
			leaseMs: 30,
			cancelPollMs: 1000,
			createAgent: (() => buildMockAgent(detachValue)) as never,
		});

		// 1. chunk-JSON in KV under activeStreamId; start carries the minted id.
		const store = new QuestpieResumableStreamStore({ kv });
		const { chunks } = await store.readFrom("run-stream:s1", 0);
		expect(chunks.length).toBeGreaterThan(0);
		const parsed = chunks.map((chunk) => JSON.parse(chunk));
		expect(parsed[0].type).toBe("start");
		expect(parsed[0].messageId).toBe(result.messageId);
		// stream sealed by the sink on completion
		expect(await store.isFinished("run-stream:s1")).toBe(true);

		// 2. heartbeat advanced the lease, independent of stream activity: the
		// producerLease was bumped more than once (onBeforeFirstAppend + ≥1 tick).
		expect(leaseUpdates).toBeGreaterThanOrEqual(2);
		expect((row.producerLease as { expiresAt?: string }).expiresAt).toBeTruthy();
		expect(
			(row.producerLease as { heartbeatAt?: string }).heartbeatAt,
		).toBeTruthy();

		// 3. resume state persisted once at end-of-turn (via saveResumeState).
		expect(row.harnessResumeState).toEqual(detachValue);

		// 4. summary + tokens accumulated.
		expect(result.summary).toBe("Hello world");
		expect(result.tokensInput).toBe(3);
		expect(result.tokensOutput).toBe(5);
	});
});
