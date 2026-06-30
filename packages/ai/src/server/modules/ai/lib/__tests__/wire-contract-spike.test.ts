/**
 * T0b — Step 0 wire-contract spike (gates T3 / T6 / T9).
 *
 * Proves the TARGET SSE framing contract end-to-end BEFORE T3/T6 bake it into
 * the production sink/store/route:
 *
 *   worker chunk-OBJECTS (`toUIMessages`)
 *     → persist `JSON.stringify(chunk)`, one chunk per KV entry (JSONL)
 *       via the real `QuestpieResumableStreamStore`
 *     → a route frames SSE EXACTLY ONCE (`id: {seq}\ndata: {json}\n\n`,
 *       terminal `data: [DONE]\n\n`)
 *     → the real `DefaultChatTransport.reconnectToStream` (NO React) parses it
 *       and yields the original `UIMessageChunk` objects with ZERO parse errors.
 *
 * Acceptance §10(g): "reconnectToStream parses route SSE with zero JSON.parse
 * errors." A parse/schema failure surfaces as a THROW while draining
 * `processResponseStream` (it `throw chunk.error` on `!chunk.success`), so the
 * gate ≡ "draining the reconnect stream does not throw."
 *
 * Scope: this file is ADDITIVE and self-contained. The JSONL sink and the
 * single-frame `frameRunStreamSSE` route below are the CONTRACT UNDER PROOF —
 * T6 supersedes the framer with the real `/api/runs/{id}/stream` route, and T3
 * moves the JSONL persistence into the production `createSink`. The durable
 * value kept here is a regression guard for that contract. It deliberately does
 * NOT touch the epoch fence / lease-touch / post-finish guard / contiguity
 * `expired` typing (T3/T5) or any harness/LLM/Redis wiring.
 */

import { describe, expect, it } from "bun:test";
import {
	DefaultChatTransport,
	streamText,
	type UIMessage,
	type UIMessageChunk,
} from "ai";
import {
	convertReadableStreamToArray,
	MockLanguageModelV3,
	simulateReadableStream,
} from "ai/test";

import { toUIMessages } from "../harness-core.js";
import {
	QuestpieResumableStreamStore,
	type QuestpieKVLike,
} from "../questpie-resumable-streams.js";

// ── In-memory KV (mirrors resumable-stream-compat.test.ts) ──────────────────
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

// ── The JSONL sink contract (T3 target): one `JSON.stringify(chunk)` per entry ─
async function persistChunksAsJsonl(
	store: QuestpieResumableStreamStore,
	streamId: string,
	chunks: UIMessageChunk[],
): Promise<void> {
	for (const chunk of chunks) {
		await store.append(streamId, JSON.stringify(chunk));
	}
	await store.finish(streamId);
}

// ── The sole framer (T6 target): frame raw chunk JSON ONCE at the edge ───────
// Reads already-persisted (finished) JSONL and frames it; no live polling —
// the spike persists+finishes up front, so a one-shot framer is sufficient.
function frameRunStreamSSE(
	store: QuestpieResumableStreamStore,
	streamId: string,
	fromOffset: number,
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		async start(controller) {
			const raw = await store.readFrom(streamId, fromOffset);
			raw.forEach((json, k) => {
				// `json` is ALREADY a JSON string — frame once, never re-stringify.
				controller.enqueue(
					encoder.encode(`id: ${fromOffset + k}\ndata: ${json}\n\n`),
				);
			});
			controller.enqueue(encoder.encode("data: [DONE]\n\n"));
			controller.close();
		},
	});
}

async function decodeStream(
	stream: ReadableStream<Uint8Array>,
): Promise<string> {
	const decoder = new TextDecoder();
	let out = "";
	for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
		out += decoder.decode(chunk, { stream: true });
	}
	out += decoder.decode();
	return out;
}

// ── Build a real DefaultChatTransport whose fetch serves the framed route ────
// `fetch` is the only stub (no socket); the entire real reconnectToStream →
// processResponseStream → parseJsonEventStream → EventSourceParserStream +
// safeParseJSON(uiMessageChunkSchema) path runs.
function makeTransport(
	store: QuestpieResumableStreamStore,
	streamId: string,
	offset = 0,
) {
	let lastInit: RequestInit | undefined;
	const transport = new DefaultChatTransport<UIMessage>({
		api: "/api/runs",
		prepareReconnectToStreamRequest: ({ api, id }) => ({
			api: `${api}/${id}/stream?offset=${offset}`,
		}),
		fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
			lastInit = init;
			const url = new URL(String(input), "http://spike.local");
			const fromOffset =
				Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0;
			const raw = await store.readFrom(streamId, fromOffset);
			const finished = await store.isFinished(streamId);
			// Drained + finished → 204 (reconnectToStream resolves null).
			if (raw.length === 0 && finished) {
				return new Response(null, { status: 204 });
			}
			return new Response(frameRunStreamSSE(store, streamId, fromOffset), {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			});
		}) as unknown as typeof globalThis.fetch,
	});
	return { transport, getLastInit: () => lastInit };
}

describe("T0b wire-contract spike", () => {
	// Canonical UIMessageChunk sequence (shapes verified against ai d.ts:2401).
	const messageId = "msg_spike";
	const producedChunks: UIMessageChunk[] = [
		{ type: "start", messageId },
		{ type: "text-start", id: "0" },
		{ type: "text-delta", id: "0", delta: "Hello" },
		{ type: "text-delta", id: "0", delta: " world" },
		{ type: "text-end", id: "0" },
		{ type: "finish" },
	];

	it("E1/E2/E5: canonical chunks → JSONL → framed once → reconnectToStream parses with ZERO errors", async () => {
		const kv = createTestKV();
		const store = new QuestpieResumableStreamStore({ kv, ttlSeconds: 60 });
		const streamId = "spike-gate";

		await persistChunksAsJsonl(store, streamId, producedChunks);

		// E5: JSONL invariant — every stored value is a STRING that JSON-parses
		// back to the source object (guards the `[object Object]` sink bug).
		const stored = await store.readFrom(streamId, 0);
		expect(stored.length).toBe(producedChunks.length);
		stored.forEach((s, i) => {
			expect(typeof s).toBe("string");
			expect(JSON.parse(s)).toEqual(producedChunks[i]);
		});

		// E1: single framing — inspect the raw bytes the route emits.
		const framedText = await decodeStream(
			frameRunStreamSSE(store, streamId, 0),
		);
		expect(framedText).not.toContain("[object Object]");
		expect(framedText).not.toContain("data: data:");
		// Every event block carries exactly one `data:` line.
		for (const block of framedText.split("\n\n")) {
			if (!block.includes("data:")) continue;
			const dataLines = block
				.split("\n")
				.filter((l) => l.startsWith("data:"));
			expect(dataLines.length).toBe(1);
		}
		expect(framedText.trimEnd().endsWith("data: [DONE]")).toBe(true);

		// THE GATE: drive the real reconnectToStream and drain it.
		const { transport, getLastInit } = makeTransport(store, streamId, 0);
		const parsedStream = await transport.reconnectToStream({
			chatId: streamId,
		});
		expect(parsedStream).not.toBeNull();
		expect(getLastInit()?.method).toBe("GET");

		let threw: unknown = null;
		let parsed: UIMessageChunk[] = [];
		try {
			parsed = await convertReadableStreamToArray(parsedStream!);
		} catch (error) {
			threw = error;
		}
		expect(threw).toBeNull(); // zero JSON.parse / schema errors (§10g)
		expect(parsed).toEqual(producedChunks);

		// E2: the start chunk's messageId survives (dedupe-key contract, §3.6).
		expect(parsed[0]?.type).toBe("start");
		expect((parsed[0] as { messageId?: string }).messageId).toBe(messageId);
	});

	it("E3: drained + finished stream → reconnectToStream resolves null (204)", async () => {
		const kv = createTestKV();
		const store = new QuestpieResumableStreamStore({ kv, ttlSeconds: 60 });
		const streamId = "spike-drained";
		await persistChunksAsJsonl(store, streamId, producedChunks);

		const { transport } = makeTransport(
			store,
			streamId,
			producedChunks.length, // offset == len → nothing left
		);
		const res = await transport.reconnectToStream({ chatId: streamId });
		expect(res).toBeNull();
	});

	it("E4: offset reconnect resumes at the TRUE index", async () => {
		const kv = createTestKV();
		const store = new QuestpieResumableStreamStore({ kv, ttlSeconds: 60 });
		const streamId = "spike-offset";
		await persistChunksAsJsonl(store, streamId, producedChunks);

		// Framed `id:` must reflect the true index, not re-zero.
		const framedText = await decodeStream(
			frameRunStreamSSE(store, streamId, 2),
		);
		expect(framedText.startsWith("id: 2\n")).toBe(true);

		const { transport } = makeTransport(store, streamId, 2);
		const parsed = await convertReadableStreamToArray(
			(await transport.reconnectToStream({ chatId: streamId }))!,
		);
		expect(parsed).toEqual(producedChunks.slice(2));
	});

	it("faithful: real toUIMessages output frames + parses with zero errors", async () => {
		// Drive the actual worker chunk producer (toUIMessages over a streamText
		// result) with a mock model — proves the REAL producer emits wire-valid,
		// schema-canonical UIMessageChunks (not just hand-authored ones).
		// Derive the model's stream-part type from the mock so the chunk literals
		// type-check without importing the transitive `@ai-sdk/provider` type.
		type V3StreamResult = Awaited<ReturnType<MockLanguageModelV3["doStream"]>>;
		type V3Part = V3StreamResult["stream"] extends ReadableStream<infer P>
			? P
			: never;
		const modelChunks: V3Part[] = [
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
					outputTokens: { total: 2, text: 2, reasoning: undefined },
				},
			},
		];
		const model = new MockLanguageModelV3({
			doStream: async () => ({
				stream: simulateReadableStream({
					initialDelayInMs: 0,
					chunkDelayInMs: 0,
					chunks: modelChunks,
				}),
			}),
		});

		const result = streamText({ model, prompt: "hi" });
		// Match the production call site (chat-turn-producer.ts) `as any`.
		const produced = await convertReadableStreamToArray(
			toUIMessages(result as any),
		);
		expect(produced.length).toBeGreaterThan(0);

		const kv = createTestKV();
		const store = new QuestpieResumableStreamStore({ kv, ttlSeconds: 60 });
		const streamId = "spike-faithful";
		await persistChunksAsJsonl(store, streamId, produced as UIMessageChunk[]);

		const { transport } = makeTransport(store, streamId, 0);
		const parsedStream = await transport.reconnectToStream({
			chatId: streamId,
		});
		expect(parsedStream).not.toBeNull();

		let threw: unknown = null;
		let parsed: UIMessageChunk[] = [];
		try {
			parsed = await convertReadableStreamToArray(parsedStream!);
		} catch (error) {
			threw = error;
		}
		expect(threw).toBeNull(); // zero parse errors over the real producer's output
		expect(parsed).toEqual(produced);
	});
});
