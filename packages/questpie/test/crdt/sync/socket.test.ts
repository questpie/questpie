import { describe, expect, it } from "bun:test";

import { createCrdtAuthenticatedSyncSocketV1 } from "../../../src/server/modules/core/integrated/crdt/sync-socket.js";
import type { CrdtSyncSource } from "../../../src/server/modules/core/integrated/crdt/sync.js";
import {
	CrdtProtocolMachineV1,
	decodeCrdtFrameV1,
	encodeCrdtFrameV1,
} from "../../../src/shared/crdt-protocol.js";

const TICKET =
	"00000000-0000-4000-8000-000000000001.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

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
});
