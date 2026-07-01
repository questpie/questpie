/**
 * T6: createRunStreamResponse — the sole SSE framer.
 *
 * In-memory KV + a mock run_links collection; drains the Response body and
 * asserts single framing (id:{seq}\ndata:{json}\n\n + [DONE], no [object
 * Object]), true-index offset resume, 204 when drained, event:expired on a TTL
 * gap, and inline lease-liveness → finalizeRun.
 */

import { describe, expect, it } from "vitest";

import {
	QuestpieResumableStreamStore,
	type QuestpieKVLike,
} from "@questpie/ai/harness-core";

import { createRunStreamResponse } from "../run-stream";

function createTestKV(): QuestpieKVLike {
	const store = new Map<string, { value: unknown; expiresAt?: number }>();
	return {
		async get<T>(key: string): Promise<T | null> {
			const entry = store.get(key);
			if (!entry) return null;
			return entry.value as T;
		},
		async set(key: string, value: unknown): Promise<void> {
			store.set(key, { value });
		},
		async delete(key: string): Promise<void> {
			store.delete(key);
		},
		async has(key: string): Promise<boolean> {
			return store.has(key);
		},
	};
}

async function seed(kv: QuestpieKVLike, streamId: string, chunks: unknown[]) {
	const store = new QuestpieResumableStreamStore({ kv });
	for (const chunk of chunks) {
		await store.append(streamId, JSON.stringify(chunk));
	}
}

async function drain(response: Response): Promise<string> {
	const reader = response.body!.getReader();
	const decoder = new TextDecoder();
	let out = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		out += decoder.decode(value, { stream: true });
	}
	return out + decoder.decode();
}

function mockCtx(
	kv: QuestpieKVLike,
	run: Record<string, unknown>,
	opts?: { offset?: number },
) {
	const updates: Array<{ where: any; data: any }> = [];
	const url =
		opts?.offset != null
			? `http://x/api/runs/r1/stream?offset=${opts.offset}`
			: "http://x/api/runs/r1/stream";
	return {
		updates,
		ctx: {
			request: new Request(url),
			collections: {
				run_links: {
					async findOne() {
						return run;
					},
					async update({ where, data }: { where: any; data: any }) {
						updates.push({ where, data });
						Object.assign(run, data);
						return [{ ...run }];
					},
				},
				chat_messages: {
					async create() {
						return { id: "m1" };
					},
				},
			} as never,
			kv,
			services: {},
			workflows: undefined,
			runId: "r1",
		},
	};
}

const baseRun = () => ({
	id: "r1",
	status: "completed" as string,
	activeStreamId: "run-stream:s1",
	kind: "chat",
	chatSession: "cs1",
	producerLease: { epoch: 1 } as Record<string, unknown>,
});

describe("createRunStreamResponse (T6)", () => {
	it("frames a finished JSONL stream ONCE with [DONE] (no [object Object])", async () => {
		const kv = createTestKV();
		await seed(kv, "run-stream:s1", [
			{ type: "start", messageId: "m1" },
			{ type: "text-delta", id: "0", delta: "hi" },
			{ type: "finish" },
		]);
		const store = new QuestpieResumableStreamStore({ kv });
		await store.finish("run-stream:s1");

		const { ctx } = mockCtx(kv, baseRun());
		const res = await createRunStreamResponse(ctx);
		const text = await drain(res);

		expect(text).not.toContain("[object Object]");
		expect(text).toContain('id: 0\ndata: {"type":"start"');
		expect(text).toContain('id: 2\ndata: {"type":"finish"}');
		expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
	});

	it("resumes at the TRUE index with ?offset=2", async () => {
		const kv = createTestKV();
		await seed(kv, "run-stream:s1", [
			{ type: "start" },
			{ type: "text-delta", id: "0", delta: "hi" },
			{ type: "finish" },
		]);
		await new QuestpieResumableStreamStore({ kv }).finish("run-stream:s1");

		const { ctx } = mockCtx(kv, baseRun(), { offset: 2 });
		const text = await drain(await createRunStreamResponse(ctx));

		expect(text).toContain('id: 2\ndata: {"type":"finish"}');
		expect(text).not.toContain("id: 0");
		expect(text).not.toContain("id: 1");
	});

	it("204 when finished and drained at the offset", async () => {
		const kv = createTestKV();
		await seed(kv, "run-stream:s1", [{ type: "start" }]);
		await new QuestpieResumableStreamStore({ kv }).finish("run-stream:s1");

		const { ctx } = mockCtx(kv, baseRun(), { offset: 1 });
		const res = await createRunStreamResponse(ctx);
		expect(res.status).toBe(204);
	});

	it("emits event: expired on a TTL gap (early chunk expired)", async () => {
		const kv = createTestKV();
		await seed(kv, "run-stream:s1", [
			{ type: "start" },
			{ type: "text-delta", id: "0", delta: "x" },
		]);
		await kv.delete("rs:run-stream:s1:c:0"); // simulate early-chunk TTL expiry

		const run = {
			...baseRun(),
			status: "running",
			producerLease: {
				epoch: 1,
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
			},
		};
		const { ctx } = mockCtx(kv, run, { offset: 0 });
		const text = await drain(await createRunStreamResponse(ctx));

		expect(text).toContain("event: expired");
	});

	it("inline liveness: claimed row with expired lease → finalizeRun(failed) inline + stream sealed", async () => {
		const kv = createTestKV();
		await seed(kv, "run-stream:s1", [{ type: "start" }]); // NOT finished (crashed)

		const run = {
			...baseRun(),
			status: "claimed",
			producerLease: {
				epoch: 1,
				expiresAt: new Date(Date.now() - 60_000).toISOString(), // expired
			},
		};
		const { ctx, updates } = mockCtx(kv, run);
		await drain(await createRunStreamResponse(ctx));

		const finalize = updates.find((u) => u.data.status === "failed");
		expect(finalize).toBeDefined();
		expect(finalize?.data.finalizedAt).toBeDefined();
		expect(
			await new QuestpieResumableStreamStore({ kv }).isFinished("run-stream:s1"),
		).toBe(true);
	});
});
