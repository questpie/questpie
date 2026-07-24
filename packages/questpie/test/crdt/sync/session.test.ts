import { describe, expect, it } from "bun:test";

import {
	CrdtSyncRejectedError,
	createCrdtSyncSession,
	type CrdtSyncBasis,
	type CrdtSyncSource,
} from "../../../src/server/modules/core/integrated/crdt/sync.js";

const MiB = 1024 * 1024;

function basis(bytes = 16): CrdtSyncBasis {
	return {
		resourceId: "resource",
		resourceEpochId: "epoch",
		schemaId: "schema",
		aggregateEpoch: 1n,
		schemaVersion: 1,
		commitHead: 4n,
		fields: [
			{
				bindingId: "title",
				fieldSlot: 1,
				fieldEpoch: 1n,
				fieldCursor: 4n,
				bytes: new Uint8Array(bytes),
			},
		],
	};
}

function source(initial = basis()) {
	let head = initial.commitHead;
	const commits: Array<{
		commitSeq: bigint;
		fields: Array<{
			fieldSlot: number;
			fieldEpoch: bigint;
			fieldCursor: bigint;
			bytes: Uint8Array;
		}>;
	}> = [];
	const registrations: bigint[] = [];
	const api: CrdtSyncSource = {
		captureBasis: async () => initial,
		registerCursor: async (_sessionId, cursor) => {
			registrations.push(cursor);
		},
		readHead: async () => head,
		readCommits: async (_input, after, through) =>
			commits.filter(
				(commit) => commit.commitSeq > after && commit.commitSeq <= through,
			),
	};
	return {
		api,
		registrations,
		append(
			commitSeq: bigint,
			fieldCursor: bigint,
			bytes = new Uint8Array([Number(commitSeq)]),
		) {
			this.appendFields(commitSeq, [
				{ fieldSlot: 1, fieldEpoch: 1n, fieldCursor, bytes },
			]);
		},
		appendFields(
			commitSeq: bigint,
			fields: Array<{
				fieldSlot: number;
				fieldEpoch: bigint;
				fieldCursor: bigint;
				bytes: Uint8Array;
			}>,
		) {
			head = commitSeq;
			commits.push({
				commitSeq,
				fields,
			});
		},
	};
}

describe("CRDT flow-controlled synchronization", () => {
	it("never has more than 4 MiB unacknowledged and registers before the final basis chunk", async () => {
		const durable = source(basis(16 * MiB));
		const sent: Array<{ chunkIndex: number; bytes: Uint8Array }> = [];
		const sync = createCrdtSyncSession({
			sessionId: "session",
			source: durable.api,
			send: async (frame) => sent.push(frame),
		});

		await sync.start([]);
		expect(sync.unacknowledgedBytes).toBeLessThanOrEqual(4 * MiB);
		expect(sent.length).toBeGreaterThan(0);
		expect(durable.registrations).toEqual([]);

		let index = 0;
		while (durable.registrations.length === 0) {
			await sync.ack(sent[index]!.chunkIndex, 1, 4n);
			index++;
		}
		expect(sync.unacknowledgedBytes).toBeLessThanOrEqual(4 * MiB);
		expect(durable.registrations).toEqual([4n]);

		for (const frame of sent.slice(index)) {
			await sync.ack(frame.chunkIndex, 1, 4n);
		}
		expect(sync.state).toBe("ready");
	});

	it("falls back to verified full state when a peer proof is forged", async () => {
		const durable = source(basis(8));
		const sent: Array<{ bytes: Uint8Array }> = [];
		const sync = createCrdtSyncSession({
			sessionId: "session",
			source: durable.api,
			verifyProof: async () => {
				throw new Error("forged");
			},
			send: async (frame) => sent.push(frame),
		});

		await sync.start([
			{ fieldSlot: 1, fieldEpoch: 1n, proof: new Uint8Array([0xff]) },
		]);

		expect(sent.map((frame) => [...frame.bytes])).toEqual([
			[0, 0, 0, 0, 0, 0, 0, 0],
		]);
	});

	it("includes commits injected after basis, registration, chunk and ACK boundaries", async () => {
		const durable = source(basis(1));
		const cuts: bigint[] = [];
		let nextCommit = 5n;
		const sync = createCrdtSyncSession({
			sessionId: "session",
			source: durable.api,
			send: async () => {},
			onBoundary: async (boundary) => {
				if (
					nextCommit <= 8n &&
					["basis-captured", "cursor-registered", "basis-sent", "ack"].includes(
						boundary,
					)
				) {
					durable.append(nextCommit, nextCommit);
					nextCommit++;
				}
			},
			onReady: async (cut) => cuts.push(cut),
		});

		await sync.start([]);
		while (sync.state !== "ready") {
			const frame = sync.pendingFrames[0];
			expect(frame).toBeDefined();
			await sync.ack(
				frame!.chunkIndex,
				frame!.fieldSlot,
				frame!.throughFieldCursor,
			);
		}

		expect(cuts).toEqual([8n]);
		expect(sync.cursor).toBe(8n);
	});

	it("rejects mismatched ACKs and stops without accepting more work", async () => {
		const durable = source();
		const sync = createCrdtSyncSession({
			sessionId: "session",
			source: durable.api,
			send: async () => {},
		});
		await sync.start([]);

		await expect(sync.ack(9, 1, 4n)).rejects.toBeInstanceOf(
			CrdtSyncRejectedError,
		);
		await sync.stop();
		await expect(sync.poll()).rejects.toBeInstanceOf(CrdtSyncRejectedError);
	});

	it("delivers each ready commit atomically and advances across hidden-only commits", async () => {
		const durable = source(basis(1));
		const updates: Array<{ commitSeq: bigint; fieldSlots: number[] }> = [];
		const sync = createCrdtSyncSession({
			sessionId: "session",
			source: durable.api,
			send: async () => {},
			sendUpdate: async (commit) => {
				updates.push({
					commitSeq: commit.commitSeq,
					fieldSlots: commit.fields.map((field) => field.fieldSlot),
				});
			},
		});
		await sync.start([]);
		const basisFrame = sync.pendingFrames[0]!;
		await sync.ack(
			basisFrame.chunkIndex,
			basisFrame.fieldSlot,
			basisFrame.throughFieldCursor,
		);
		expect(sync.state).toBe("ready");

		durable.appendFields(5n, [
			{
				fieldSlot: 1,
				fieldEpoch: 1n,
				fieldCursor: 5n,
				bytes: new Uint8Array([1]),
			},
			{
				fieldSlot: 2,
				fieldEpoch: 1n,
				fieldCursor: 1n,
				bytes: new Uint8Array([2]),
			},
		]);
		durable.appendFields(6n, []);
		await sync.poll();

		expect(updates).toEqual([{ commitSeq: 5n, fieldSlots: [1, 2] }]);
		expect(sync.cursor).toBe(6n);
	});
});
