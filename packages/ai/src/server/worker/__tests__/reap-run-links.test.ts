/**
 * T8: reapExpiredRunLinks — the orphan reaper over run_links.
 *
 * Real QuestpieResumableStreamStore over an in-memory KV (proves the failed
 * path appends a real error+finish chunk and seals) + a mock run_links honoring
 * id + status(in/notIn) + finalizedAt (the RAW jsonb-epoch predicate is a no-op
 * at unit level, like finalize-run.test — the epoch fence is integration-proven).
 */

import { describe, expect, it } from "bun:test";

import {
	type QuestpieKVLike,
	QuestpieResumableStreamStore,
} from "../../modules/ai/lib/questpie-resumable-streams.js";
import { reapExpiredRunLinks, type ReapRunLinksDeps } from "../reap-run-links.js";

const PAST = () => new Date(Date.now() - 60_000).toISOString();
const FUTURE = () => new Date(Date.now() + 60_000).toISOString();

function createTestKV(): QuestpieKVLike {
	const store = new Map<string, { value: unknown }>();
	return {
		async get<T>(key: string): Promise<T | null> {
			return (store.get(key)?.value as T) ?? null;
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

function makeRunLinks(rows: Array<Record<string, unknown>>) {
	return {
		async find({ where }: { where: any; limit?: number }) {
			const statusIn = where?.status?.in as string[] | undefined;
			return {
				docs: rows.filter(
					(row) => !statusIn || statusIn.includes(row.status as string),
				),
			};
		},
		async update({ where, data }: { where: any; data: any }) {
			const row = rows.find((candidate) => candidate.id === where.id);
			if (!row) return [];
			// finalize latch
			if (where.finalizedAt === null && row.finalizedAt != null) return [];
			// status in/notIn gates
			const inList = where.status?.in as string[] | undefined;
			if (Array.isArray(inList) && !inList.includes(row.status as string)) {
				return [];
			}
			const notIn = where.status?.notIn as string[] | undefined;
			if (Array.isArray(notIn) && notIn.includes(row.status as string)) {
				return [];
			}
			Object.assign(row, data);
			return [{ ...row }];
		},
	};
}

function makeDeps(rows: Array<Record<string, unknown>>, store: QuestpieResumableStreamStore) {
	const events: Array<{ event: string; data: any; match: any }> = [];
	const created: Array<Record<string, unknown>> = [];
	const deps: ReapRunLinksDeps = {
		collections: {
			run_links: makeRunLinks(rows) as never,
			chat_messages: {
				async create(data: Record<string, unknown>) {
					created.push(data);
					return { id: "m" };
				},
			},
		},
		streamStore: store,
		workflows: {
			sendEvent(event: string, data: any, match: any) {
				events.push({ event, data, match });
			},
		},
	};
	return { deps, events, created };
}

describe("reapExpiredRunLinks (T8)", () => {
	it("none (task): expired run → failed, stream sealed with real error+finish, ONE run.completed", async () => {
		const kv = createTestKV();
		const store = new QuestpieResumableStreamStore({ kv });
		const streamId = "run-stream:t1";
		await store.append(streamId, JSON.stringify({ type: "start", messageId: "m" }));
		// NOT finished — the worker vanished mid-stream.

		const rows = [
			{
				id: "r1",
				status: "running",
				kind: "task",
				retryPolicy: "none",
				activeStreamId: streamId,
				producerLease: { epoch: 3, expiresAt: PAST() },
				finalizedAt: null,
			},
		];
		const { deps, events } = makeDeps(rows, store);

		const res = await reapExpiredRunLinks(deps);

		expect(res).toEqual({ reapedFailed: 1, reapedRequeued: 0 });
		expect(rows[0].status).toBe("failed");
		expect(rows[0].finalizedAt).not.toBeNull();

		// Stream sealed, and its tail carries a canonical error part + finish.
		expect(await store.isFinished(streamId)).toBe(true);
		const { chunks } = await store.readFrom(streamId, 0);
		expect(chunks).toContain(
			'{"type":"error","errorText":"worker lease expired"}',
		);
		expect(chunks[chunks.length - 1]).toBe('{"type":"finish"}');

		// Task kind → exactly one run.completed{failed} unblocks the workflow.
		const completed = events.filter((e) => e.event === "run.completed");
		expect(completed).toHaveLength(1);
		expect(completed[0].data.status).toBe("failed");
	});

	it("auto: expired run → requeued pending, epoch++ (fence), worker cleared, NOT finalized", async () => {
		const kv = createTestKV();
		const store = new QuestpieResumableStreamStore({ kv });
		const streamId = "run-stream:a1";
		await store.append(streamId, JSON.stringify({ type: "start" }));

		const rows = [
			{
				id: "r2",
				status: "claimed",
				kind: "manual",
				retryPolicy: "auto",
				worker: "w1",
				activeStreamId: streamId,
				producerLease: { epoch: 5, expiresAt: PAST() },
				finalizedAt: null,
			},
		];
		const { deps, events } = makeDeps(rows, store);

		const res = await reapExpiredRunLinks(deps);

		expect(res).toEqual({ reapedFailed: 0, reapedRequeued: 1 });
		expect(rows[0].status).toBe("pending"); // re-claimable
		const lease = rows[0].producerLease as Record<string, unknown>;
		expect(lease.epoch).toBe(6); // bumped → fences the zombie holding epoch 5
		expect(lease.expiresAt).toBeUndefined(); // lease cleared
		expect(rows[0].worker).toBeNull();
		expect(rows[0].finalizedAt).toBeNull(); // NOT finalized
		expect(await store.isFinished(streamId)).toBe(false); // stream not sealed
		expect(events).toHaveLength(0); // no run.completed
	});

	it("leaves a claimed run with a future lease untouched", async () => {
		const kv = createTestKV();
		const store = new QuestpieResumableStreamStore({ kv });
		const rows = [
			{
				id: "r3",
				status: "running",
				kind: "task",
				retryPolicy: "none",
				activeStreamId: "run-stream:f1",
				producerLease: { epoch: 1, expiresAt: FUTURE() },
				finalizedAt: null,
			},
		];
		const { deps } = makeDeps(rows, store);

		const res = await reapExpiredRunLinks(deps);

		expect(res).toEqual({ reapedFailed: 0, reapedRequeued: 0 });
		expect(rows[0].status).toBe("running");
	});

	it("never touches pending rows (§3.8)", async () => {
		const kv = createTestKV();
		const store = new QuestpieResumableStreamStore({ kv });
		const rows = [
			{
				id: "r4",
				status: "pending",
				kind: "task",
				retryPolicy: "none",
				producerLease: { epoch: 1, expiresAt: PAST() },
				finalizedAt: null,
			},
		];
		const { deps } = makeDeps(rows, store);

		const res = await reapExpiredRunLinks(deps);

		expect(res).toEqual({ reapedFailed: 0, reapedRequeued: 0 });
		expect(rows[0].status).toBe("pending");
	});

	it("is idempotent: the now-failed row is not re-reaped (status filter)", async () => {
		const kv = createTestKV();
		const store = new QuestpieResumableStreamStore({ kv });
		const streamId = "run-stream:i1";
		await store.append(streamId, JSON.stringify({ type: "start" }));
		const rows = [
			{
				id: "r5",
				status: "running",
				kind: "task",
				retryPolicy: "none",
				activeStreamId: streamId,
				producerLease: { epoch: 2, expiresAt: PAST() },
				finalizedAt: null,
			},
		];
		const { deps, events } = makeDeps(rows, store);

		await reapExpiredRunLinks(deps);
		const res2 = await reapExpiredRunLinks(deps);

		expect(res2).toEqual({ reapedFailed: 0, reapedRequeued: 0 });
		expect(events.filter((e) => e.event === "run.completed")).toHaveLength(1);
	});
});
