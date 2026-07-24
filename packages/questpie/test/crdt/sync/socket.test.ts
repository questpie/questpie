import { describe, expect, it } from "bun:test";

import { createCrdtDrainCoordinator } from "../../../src/server/modules/core/integrated/crdt/sync-coordinator.js";
import { createCrdtAuthenticatedSyncSocketV1 } from "../../../src/server/modules/core/integrated/crdt/sync-socket.js";
import type { CrdtSyncSource } from "../../../src/server/modules/core/integrated/crdt/sync.js";
import {
	CrdtProtocolMachineV1,
	decodeCrdtFrameV1,
	encodeCrdtFrameV1,
} from "../../../src/shared/crdt-protocol.js";

const TICKET =
	"00000000-0000-4000-8000-000000000001.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const passiveCoordinator = {
	register: () => () => {},
};

function setupProtocol(): CrdtProtocolMachineV1 {
	const protocol = new CrdtProtocolMachineV1();
	protocol.accept("client-to-server", {
		major: 1,
		minor: 0,
		opcode: 0x01,
		connectionSeq: 1n,
		requestId: 1n,
		payload: { ticket: TICKET },
	});
	return protocol;
}

function source(): CrdtSyncSource {
	return {
		captureBasis: async (sessionId) => ({
			sessionId,
			resourceId: "resource",
			resourceEpochId: "epoch",
			schemaId: "schema",
			aggregateEpoch: 1n,
			schemaVersion: 1,
			commitHead: 0n,
			fields: [
				{
					bindingId: "binding",
					fieldSlot: 1,
					fieldEpoch: 1n,
					formatVersion: 1,
					grant: 1,
					fieldCursor: 0n,
					readFence: 0n,
					editFence: 0n,
					bytes: new Uint8Array([1, 2, 3]),
				},
			],
		}),
		registerCursor: async () => {},
		readHead: async () => 0n,
		readCommits: async () => [],
	};
}

function proofFrame() {
	return encodeCrdtFrameV1({
		major: 1,
		minor: 0,
		opcode: 0x02,
		connectionSeq: 2n,
		requestId: 2n,
		payload: { schemaVersion: 1, parts: [] },
	});
}

describe("CRDT synchronized protocol socket", () => {
	it("fails closed when the mandatory coordinator is omitted", async () => {
		await expect(
			createCrdtAuthenticatedSyncSocketV1({
				sessionId: "session",
				authRequestId: 1n,
				protocol: setupProtocol(),
				source: source(),
				aggregateHash: "0".repeat(64),
				coordinator: undefined as never,
				peer: {
					send: () => true,
					close: () => {},
				},
			}),
		).rejects.toThrow("CRDT synchronized socket rejected");
	});

	it("closes an idle registered socket during coordinator shutdown", async () => {
		let closes = 0;
		const coordinator = createCrdtDrainCoordinator({
			router: {
				subscribe: async () => async () => {},
			},
			healthyPollMs: 60_000,
			behindPollMs: 60_000,
		});
		await coordinator.start();
		const socket = await createCrdtAuthenticatedSyncSocketV1({
			sessionId: "session",
			authRequestId: 1n,
			protocol: setupProtocol(),
			source: source(),
			aggregateHash: "0".repeat(64),
			coordinator,
			peer: {
				send: () => true,
				close: () => {
					closes++;
				},
			},
		});
		await socket.message(proofFrame());

		await coordinator.stop();

		expect(closes).toBe(1);
	});

	it("closes an authenticated socket that never sends SYNC_PROOF before releasing the router", async () => {
		const events: string[] = [];
		const errors: unknown[] = [];
		let closes = 0;
		const coordinator = createCrdtDrainCoordinator({
			router: {
				subscribe: async () => async () => {
					events.push("router");
				},
			},
			healthyPollMs: 60_000,
			behindPollMs: 60_000,
			onError: (error) => errors.push(error),
		});
		await coordinator.start();
		await createCrdtAuthenticatedSyncSocketV1({
			sessionId: "silent-session",
			authRequestId: 1n,
			protocol: setupProtocol(),
			source: source(),
			aggregateHash: "1".repeat(64),
			coordinator,
			peer: {
				send: () => true,
				close: () => {
					closes++;
					events.push("close");
				},
			},
		});

		await coordinator.poll();
		expect(errors).toEqual([]);
		expect(closes).toBe(0);
		await coordinator.stop();

		expect(closes).toBe(1);
		expect(events).toEqual(["close", "router"]);
	});

	it("sends AUTH_OK, flow-controlled chunks and READY through the frozen protocol", async () => {
		const frames: ReturnType<typeof decodeCrdtFrameV1>[] = [];
		let registered = 0;
		const socket = await createCrdtAuthenticatedSyncSocketV1({
			sessionId: "session",
			authRequestId: 1n,
			protocol: setupProtocol(),
			source: source(),
			aggregateHash: "a".repeat(64),
			coordinator: {
				register: () => {
					registered++;
					return () => {
						registered--;
					};
				},
			},
			peer: {
				send: (bytes) => {
					frames.push(decodeCrdtFrameV1(bytes));
					return true;
				},
				close: () => {},
			},
		});
		expect(frames.map((frame) => frame.opcode)).toEqual([0x89]);

		await socket.message(proofFrame());
		expect(frames.map((frame) => frame.opcode)).toEqual([0x89, 0x82]);
		expect(registered).toBe(1);
		const chunk = frames[1]!;
		if (chunk.opcode !== 0x82) throw new Error("expected sync chunk");
		await socket.message(
			encodeCrdtFrameV1({
				major: 1,
				minor: 0,
				opcode: 0x03,
				connectionSeq: 3n,
				requestId: 0n,
				payload: {
					chunkIndex: chunk.payload.chunkIndex,
					fieldSlot: chunk.payload.fieldSlot,
					throughFieldCursor: chunk.payload.throughFieldCursor,
				},
			}),
		);
		expect(frames.map((frame) => frame.opcode)).toEqual([0x89, 0x82, 0x81]);
		expect(frames[2]?.requestId).toBe(2n);

		await socket.close(1000, "done");
		expect(registered).toBe(0);
	});

	it("waits for transport drain when the peer is busy", async () => {
		const frames: Uint8Array[] = [];
		let writable = true;
		const socket = await createCrdtAuthenticatedSyncSocketV1({
			sessionId: "session",
			authRequestId: 1n,
			protocol: setupProtocol(),
			source: source(),
			aggregateHash: "b".repeat(64),
			coordinator: passiveCoordinator,
			peer: {
				send: (bytes) => {
					if (!writable) return false;
					frames.push(bytes);
					return true;
				},
				close: () => {},
			},
		});
		writable = false;
		let completed = false;
		const message = socket.message(proofFrame()).then(() => {
			completed = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(completed).toBe(false);
		expect(frames).toHaveLength(1);

		writable = true;
		await socket.drain();
		await message;
		expect(frames).toHaveLength(2);
		await socket.close(1000, "done");
	});

	it("returns a drainable downstream socket when the first AUTH_OK send is busy", async () => {
		const frames: Uint8Array[] = [];
		let writable = false;
		const socket = await createCrdtAuthenticatedSyncSocketV1({
			sessionId: "session",
			authRequestId: 1n,
			protocol: setupProtocol(),
			source: source(),
			aggregateHash: "c".repeat(64),
			coordinator: passiveCoordinator,
			peer: {
				send: (bytes) => {
					if (!writable) return false;
					frames.push(bytes);
					return true;
				},
				close: () => {},
			},
		});
		expect(frames).toHaveLength(0);

		writable = true;
		await socket.drain();
		expect(frames.map(decodeCrdtFrameV1).map((frame) => frame.opcode)).toEqual([
			0x89,
		]);
		await socket.close(1000, "done");
	});

	it("owns a rejected initial AUTH_OK when closed before transport drain", async () => {
		let closes = 0;
		const socket = await createCrdtAuthenticatedSyncSocketV1({
			sessionId: "session",
			authRequestId: 1n,
			protocol: setupProtocol(),
			source: source(),
			aggregateHash: "e".repeat(64),
			coordinator: passiveCoordinator,
			peer: {
				send: () => false,
				close: () => {
					closes++;
				},
			},
		});

		await socket.close(1000, "closed before drain");
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(closes).toBe(1);
	});

	it("delivers one atomic live UPDATE through coordinator reconciliation", async () => {
		let head = 0n;
		let registered:
			| {
					reconcile(
						reason: "wake" | "reconnect" | "poll",
						signal: AbortSignal,
					): Promise<{ behind: boolean }>;
			  }
			| undefined;
		const durable = source();
		durable.readHead = async () => head;
		durable.readCommits = async (_basis, after, through) =>
			after === 0n && through === 1n
				? [
						{
							commitSeq: 1n,
							kind: 1,
							commitId: new Uint8Array(16).fill(0x44),
							fields: [
								{
									fieldSlot: 1,
									fieldEpoch: 1n,
									formatVersion: 1,
									fieldCursor: 1n,
									bytes: new Uint8Array([9]),
								},
							],
						},
					]
				: [];
		const frames: ReturnType<typeof decodeCrdtFrameV1>[] = [];
		const socket = await createCrdtAuthenticatedSyncSocketV1({
			sessionId: "session",
			authRequestId: 1n,
			protocol: setupProtocol(),
			source: durable,
			aggregateHash: "d".repeat(64),
			coordinator: {
				register: (session) => {
					registered = session;
					return () => {};
				},
			},
			peer: {
				send: (bytes) => {
					frames.push(decodeCrdtFrameV1(bytes));
					return true;
				},
				close: () => {},
			},
		});
		await socket.message(proofFrame());
		const chunk = frames[1]!;
		if (chunk.opcode !== 0x82) throw new Error("expected sync chunk");
		await socket.message(
			encodeCrdtFrameV1({
				major: 1,
				minor: 0,
				opcode: 0x03,
				connectionSeq: 3n,
				requestId: 0n,
				payload: {
					chunkIndex: chunk.payload.chunkIndex,
					fieldSlot: chunk.payload.fieldSlot,
					throughFieldCursor: chunk.payload.throughFieldCursor,
				},
			}),
		);
		head = 1n;

		await registered!.reconcile("wake", new AbortController().signal);

		expect(frames.map((frame) => frame.opcode)).toEqual([
			0x89, 0x82, 0x81, 0x83,
		]);
		const update = frames[3]!;
		if (update.opcode !== 0x83) throw new Error("expected live update");
		expect(update.payload.parts).toHaveLength(1);
		await socket.close(1000, "done");
	});

	it("keeps the aggregate socket open and emits a field-only reset transition", async () => {
		let head = 0n;
		let registered:
			| {
					reconcile(
						reason: "wake" | "reconnect" | "poll",
						signal: AbortSignal,
					): Promise<{ behind: boolean }>;
			  }
			| undefined;
		let closes = 0;
		const durable = source();
		durable.readHead = async () => head;
		durable.readCommits = async (_basis, after, through) =>
			after === 0n && through === 1n
				? [
						{
							commitSeq: 1n,
							kind: 2,
							commitId: new Uint8Array(16).fill(0x55),
							field: {
								bindingId: "binding-reset",
								fieldSlot: 1,
								fieldEpoch: 2n,
								formatVersion: 1,
								grant: 1,
								fieldCursor: 0n,
								readFence: 0n,
								editFence: 0n,
								bytes: new Uint8Array([4, 5, 6]),
							},
							transition: {
								fieldSlot: 1,
								grant: 1,
								fieldEpoch: 2n,
								headFieldCursor: 0n,
							},
						},
					]
				: [];
		const frames: ReturnType<typeof decodeCrdtFrameV1>[] = [];
		const socket = await createCrdtAuthenticatedSyncSocketV1({
			sessionId: "session",
			authRequestId: 1n,
			protocol: setupProtocol(),
			source: durable,
			aggregateHash: "f".repeat(64),
			coordinator: {
				register: (session) => {
					registered = session;
					return () => {};
				},
			},
			peer: {
				send: (bytes) => {
					frames.push(decodeCrdtFrameV1(bytes));
					return true;
				},
				close: () => {
					closes++;
				},
			},
		});
		await socket.message(proofFrame());
		const chunk = frames[1]!;
		if (chunk.opcode !== 0x82) throw new Error("expected sync chunk");
		await socket.message(
			encodeCrdtFrameV1({
				major: 1,
				minor: 0,
				opcode: 0x03,
				connectionSeq: 3n,
				requestId: 0n,
				payload: {
					chunkIndex: chunk.payload.chunkIndex,
					fieldSlot: chunk.payload.fieldSlot,
					throughFieldCursor: chunk.payload.throughFieldCursor,
				},
			}),
		);
		head = 1n;

		await registered!.reconcile("wake", new AbortController().signal);

		expect(frames.map((frame) => frame.opcode)).toEqual([
			0x89, 0x82, 0x81, 0x86,
		]);
		const reset = frames[3]!;
		if (reset.opcode !== 0x86) throw new Error("expected field state");
		expect(reset.payload.transitions).toEqual([
			{
				fieldSlot: 1,
				action: 2,
				grant: 0,
				fieldEpoch: 2n,
				headFieldCursor: 0n,
			},
		]);
		expect(closes).toBe(0);
		await socket.close(1000, "done");
	});

	it("completes consecutive field-only resets while unrelated updates keep the aggregate ready", async () => {
		let head = 0n;
		let registered:
			| {
					reconcile(
						reason: "wake" | "reconnect" | "poll",
						signal: AbortSignal,
					): Promise<{ behind: boolean }>;
			  }
			| undefined;
		let closes = 0;
		const durable = source();
		durable.captureBasis = async (sessionId) => ({
			sessionId,
			resourceId: "resource",
			resourceEpochId: "epoch",
			schemaId: "schema",
			aggregateEpoch: 1n,
			schemaVersion: 1,
			commitHead: 0n,
			fields: [
				{
					bindingId: "title-1",
					fieldSlot: 1,
					fieldEpoch: 1n,
					formatVersion: 1,
					grant: 1,
					fieldCursor: 0n,
					readFence: 0n,
					editFence: 0n,
					bytes: new Uint8Array([1]),
				},
				{
					bindingId: "content-1",
					fieldSlot: 2,
					fieldEpoch: 1n,
					formatVersion: 1,
					grant: 1,
					fieldCursor: 0n,
					readFence: 0n,
					editFence: 0n,
					bytes: new Uint8Array([2]),
				},
			],
		});
		durable.readHead = async () => head;
		durable.readCommits = async (_basis, after, through) => {
			if (through !== after + 1n) return [];
			if (through === 1n || through === 2n) {
				const epoch = through + 1n;
				return [
					{
						commitSeq: through,
						kind: 2,
						commitId: new Uint8Array(16).fill(Number(through)),
						transition: {
							fieldSlot: 1,
							grant: 1,
							fieldEpoch: epoch,
							headFieldCursor: 0n,
						},
						field: {
							bindingId: `title-${epoch}`,
							fieldSlot: 1,
							fieldEpoch: epoch,
							formatVersion: 1,
							grant: 1,
							fieldCursor: 0n,
							readFence: epoch - 1n,
							editFence: epoch - 1n,
							bytes: new Uint8Array([Number(epoch)]),
						},
					},
				];
			}
			if (through === 3n) {
				return [
					{
						commitSeq: 3n,
						kind: 1,
						commitId: new Uint8Array(16).fill(3),
						fields: [
							{
								fieldSlot: 2,
								fieldEpoch: 1n,
								formatVersion: 1,
								fieldCursor: 1n,
								bytes: new Uint8Array([9]),
							},
						],
					},
				];
			}
			return [];
		};
		const frames: ReturnType<typeof decodeCrdtFrameV1>[] = [];
		const socket = await createCrdtAuthenticatedSyncSocketV1({
			sessionId: "session",
			authRequestId: 1n,
			protocol: setupProtocol(),
			source: durable,
			aggregateHash: "1".repeat(64),
			coordinator: {
				register: (session) => {
					registered = session;
					return () => {};
				},
			},
			peer: {
				send: (bytes) => {
					frames.push(decodeCrdtFrameV1(bytes));
					return true;
				},
				close: () => {
					closes++;
				},
			},
		});
		await socket.message(proofFrame());
		let clientSequence = 3n;
		for (const chunk of frames.filter((frame) => frame.opcode === 0x82)) {
			if (chunk.opcode !== 0x82) continue;
			await socket.message(
				encodeCrdtFrameV1({
					major: 1,
					minor: 0,
					opcode: 0x03,
					connectionSeq: clientSequence++,
					requestId: 0n,
					payload: {
						chunkIndex: chunk.payload.chunkIndex,
						fieldSlot: chunk.payload.fieldSlot,
						throughFieldCursor: chunk.payload.throughFieldCursor,
					},
				}),
			);
		}

		for (const commitSeq of [1n, 2n]) {
			head = commitSeq;
			await registered!.reconcile("wake", new AbortController().signal);
			const reset = frames.at(-1)!;
			expect(reset.opcode).toBe(0x86);

			await socket.message(
				encodeCrdtFrameV1({
					major: 1,
					minor: 0,
					opcode: 0x02,
					connectionSeq: clientSequence++,
					requestId: 10n + commitSeq,
					payload: {
						schemaVersion: 1,
						parts: [
							{
								fieldSlot: 1,
								fieldEpoch: commitSeq + 1n,
								proof: new Uint8Array(),
							},
						],
					},
				}),
			);
			const chunk = frames.at(-1)!;
			if (chunk.opcode !== 0x82) throw new Error("expected field chunk");
			await socket.message(
				encodeCrdtFrameV1({
					major: 1,
					minor: 0,
					opcode: 0x03,
					connectionSeq: clientSequence++,
					requestId: 0n,
					payload: {
						chunkIndex: chunk.payload.chunkIndex,
						fieldSlot: chunk.payload.fieldSlot,
						throughFieldCursor: chunk.payload.throughFieldCursor,
					},
				}),
			);
			const grant = frames.at(-1)!;
			if (grant.opcode !== 0x86) throw new Error("expected field grant");
			expect(grant.payload.transitions).toEqual([
				{
					fieldSlot: 1,
					action: 0,
					grant: 1,
					fieldEpoch: commitSeq + 1n,
					headFieldCursor: 0n,
				},
			]);
		}

		head = 3n;
		await registered!.reconcile("wake", new AbortController().signal);
		const unrelated = frames.at(-1)!;
		if (unrelated.opcode !== 0x83) throw new Error("expected unrelated update");
		expect(unrelated.payload.parts.map((part) => part.fieldSlot)).toEqual([2]);
		expect(closes).toBe(0);
		await socket.close(1000, "done");
	});

	it("does not regrant a retired basis field when reset races initial drain", async () => {
		const durable = source();
		durable.readHead = async () => 1n;
		durable.readCommits = async (_basis, after, through) =>
			after === 0n && through === 1n
				? [
						{
							commitSeq: 1n,
							kind: 2,
							commitId: new Uint8Array(16).fill(1),
							field: {
								bindingId: "binding-reset",
								fieldSlot: 1,
								fieldEpoch: 2n,
								formatVersion: 1,
								grant: 1,
								fieldCursor: 0n,
								readFence: 1n,
								editFence: 1n,
								bytes: new Uint8Array([4]),
							},
							transition: {
								fieldSlot: 1,
								grant: 1,
								fieldEpoch: 2n,
								headFieldCursor: 0n,
							},
						},
					]
				: [];
		const frames: ReturnType<typeof decodeCrdtFrameV1>[] = [];
		const socket = await createCrdtAuthenticatedSyncSocketV1({
			sessionId: "session",
			authRequestId: 1n,
			protocol: setupProtocol(),
			source: durable,
			aggregateHash: "9".repeat(64),
			coordinator: passiveCoordinator,
			peer: {
				send: (bytes) => {
					frames.push(decodeCrdtFrameV1(bytes));
					return true;
				},
				close: () => {},
			},
		});
		await socket.message(proofFrame());
		const initial = frames.at(-1)!;
		if (initial.opcode !== 0x82) throw new Error("expected initial chunk");
		await socket.message(
			encodeCrdtFrameV1({
				major: 1,
				minor: 0,
				opcode: 0x03,
				connectionSeq: 3n,
				requestId: 0n,
				payload: {
					chunkIndex: initial.payload.chunkIndex,
					fieldSlot: initial.payload.fieldSlot,
					throughFieldCursor: initial.payload.throughFieldCursor,
				},
			}),
		);
		expect(frames.map((frame) => frame.opcode)).toEqual([0x89, 0x82, 0x86]);

		await socket.message(
			encodeCrdtFrameV1({
				major: 1,
				minor: 0,
				opcode: 0x02,
				connectionSeq: 4n,
				requestId: 3n,
				payload: {
					schemaVersion: 1,
					parts: [
						{
							fieldSlot: 1,
							fieldEpoch: 2n,
							proof: new Uint8Array(),
						},
					],
				},
			}),
		);
		const resetChunk = frames.at(-1)!;
		if (resetChunk.opcode !== 0x82) throw new Error("expected reset chunk");
		await socket.message(
			encodeCrdtFrameV1({
				major: 1,
				minor: 0,
				opcode: 0x03,
				connectionSeq: 5n,
				requestId: 0n,
				payload: {
					chunkIndex: resetChunk.payload.chunkIndex,
					fieldSlot: resetChunk.payload.fieldSlot,
					throughFieldCursor: resetChunk.payload.throughFieldCursor,
				},
			}),
		);
		expect(frames.map((frame) => frame.opcode)).toEqual([
			0x89, 0x82, 0x86, 0x82, 0x86, 0x81,
		]);
		const ready = frames.at(-1)!;
		if (ready.opcode !== 0x81) throw new Error("expected ready");
		expect(ready.payload.grants[0]?.fieldEpoch).toBe(2n);
		await socket.close(1000, "done");
	});
});
