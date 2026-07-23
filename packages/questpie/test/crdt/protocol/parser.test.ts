import { describe, expect, it } from "bun:test";

import {
	CrdtProtocolError,
	CrdtProtocolMachineV1,
	decodeCrdtFrameV1,
	encodeCrdtFrameV1,
	parseCrdtHostMessageV1,
	type CrdtFrameV1,
} from "../../../src/server/modules/core/integrated/crdt/protocol.js";
import { GOLDEN } from "./golden.test.js";

function bytes(hex: string): Uint8Array {
	return Uint8Array.fromHex(hex);
}

function frame(
	vector: string,
	connectionSeq: bigint,
	requestId: bigint,
): CrdtFrameV1 {
	return {
		...decodeCrdtFrameV1(bytes(vector)),
		connectionSeq,
		requestId,
	} as CrdtFrameV1;
}

function protocolError(operation: () => unknown): CrdtProtocolError {
	try {
		operation();
		throw new Error("expected protocol error");
	} catch (error) {
		expect(error).toBeInstanceOf(CrdtProtocolError);
		return error as CrdtProtocolError;
	}
}

describe("QPCR v1 frame boundary", () => {
	it("rejects unknown header values, trailing bytes, and partial frames", () => {
		for (const [offset, value] of [
			[0, 0x00],
			[4, 0x02],
			[5, 0x01],
			[6, 0x7f],
			[7, 0x01],
			[28, 0x01],
		] as const) {
			const malformed = bytes(GOLDEN.auth);
			malformed[offset] = value;
			expect(() => decodeCrdtFrameV1(malformed)).toThrow(CrdtProtocolError);
		}
		expect(() =>
			decodeCrdtFrameV1(Uint8Array.from([...bytes(GOLDEN.auth), 0x00])),
		).toThrow(CrdtProtocolError);
		expect(() => decodeCrdtFrameV1(bytes(GOLDEN.auth).subarray(0, -1))).toThrow(
			CrdtProtocolError,
		);
	});

	it("rejects malformed, noncanonical, duplicate, or unsorted payloads", () => {
		const badBase64 = bytes(GOLDEN.auth);
		badBase64[badBase64.length - 1] = "+".charCodeAt(0);
		expect(() => decodeCrdtFrameV1(badBase64)).toThrow(CrdtProtocolError);

		const noncanonicalAwareness = frame(GOLDEN.awarenessClient, 1n, 0n);
		if (noncanonicalAwareness.opcode !== 0x05) throw new Error();
		noncanonicalAwareness.payload.value = { b: 1, a: 2 };
		const canonical = encodeCrdtFrameV1(noncanonicalAwareness);
		const payload = canonical.subarray(32);
		const jsonOffset = 4;
		payload.set(new TextEncoder().encode('{"b":1,"a":2}'), jsonOffset);
		new DataView(canonical.buffer, canonical.byteOffset).setUint32(
			24,
			payload.byteLength,
		);
		expect(() => decodeCrdtFrameV1(canonical)).toThrow(CrdtProtocolError);

		const duplicatePart = bytes(GOLDEN.updateClient);
		const secondSlotOffset = 32 + 16 + 8 + 4 + 2 + (2 + 8 + 2 + 8 + 4 + 1);
		new DataView(duplicatePart.buffer, duplicatePart.byteOffset).setUint16(
			secondSlotOffset,
			1,
		);
		expect(() => decodeCrdtFrameV1(duplicatePart)).toThrow(CrdtProtocolError);
	});

	it("rejects text, compressed, incomplete, and oversized host messages", () => {
		expect(
			protocolError(() =>
				parseCrdtHostMessageV1({
					data: "text",
					binary: false,
					compressed: false,
					complete: true,
				}),
			).closeCode,
		).toBe(1002);
		expect(
			protocolError(() =>
				parseCrdtHostMessageV1({
					data: bytes(GOLDEN.auth),
					binary: true,
					compressed: true,
					complete: true,
				}),
			).closeCode,
		).toBe(1002);
		expect(
			protocolError(() =>
				parseCrdtHostMessageV1({
					data: bytes(GOLDEN.auth),
					binary: true,
					compressed: false,
					complete: false,
				}),
			).closeCode,
		).toBe(1002);
		expect(
			protocolError(() =>
				parseCrdtHostMessageV1({
					data: new Uint8Array(1024 * 1024 + 33),
					binary: true,
					compressed: false,
					complete: true,
				}),
			).closeCode,
		).toBe(1009);
	});

	it("checks declared and nested sizes before consuming payload bytes", () => {
		const oversizedPayload = bytes(GOLDEN.auth).subarray(0, 32);
		new DataView(
			oversizedPayload.buffer,
			oversizedPayload.byteOffset,
			oversizedPayload.byteLength,
		).setUint32(24, 1024 * 1024 + 1);
		expect(
			protocolError(() => decodeCrdtFrameV1(oversizedPayload)).closeCode,
		).toBe(1009);

		const oversizedTicket = bytes(GOLDEN.auth).subarray(0, 32);
		new DataView(
			oversizedTicket.buffer,
			oversizedTicket.byteOffset,
			oversizedTicket.byteLength,
		).setUint32(24, 513);
		expect(
			protocolError(() => decodeCrdtFrameV1(oversizedTicket)).closeCode,
		).toBe(1009);

		const tooManyProofParts = bytes(GOLDEN.syncProof);
		new DataView(
			tooManyProofParts.buffer,
			tooManyProofParts.byteOffset,
			tooManyProofParts.byteLength,
		).setUint16(32 + 4, 33);
		expect(() => decodeCrdtFrameV1(tooManyProofParts)).toThrow(
			CrdtProtocolError,
		);
	});

	it("rejects non-JSON awareness values at the encoder boundary", () => {
		const awareness = frame(GOLDEN.awarenessClient, 1n, 0n);
		if (awareness.opcode !== 0x05) throw new Error();

		awareness.payload.value = [undefined];
		expect(() => encodeCrdtFrameV1(awareness)).toThrow(CrdtProtocolError);

		const sparse: unknown[] = [];
		sparse.length = 1;
		awareness.payload.value = sparse;
		expect(() => encodeCrdtFrameV1(awareness)).toThrow(CrdtProtocolError);

		awareness.payload.value = Number.POSITIVE_INFINITY;
		expect(() => encodeCrdtFrameV1(awareness)).toThrow(CrdtProtocolError);
	});
});

describe("QPCR v1 state, sequence, and correlation machine", () => {
	it("accepts the authenticated aggregate sync and ready request flow", () => {
		const machine = new CrdtProtocolMachineV1();
		machine.accept("client-to-server", frame(GOLDEN.auth, 1n, 1n));
		machine.accept("server-to-client", frame(GOLDEN.authOk, 1n, 1n));
		machine.accept("client-to-server", frame(GOLDEN.syncProof, 2n, 2n));
		machine.accept("server-to-client", frame(GOLDEN.syncChunk, 2n, 2n));
		machine.accept("server-to-client", frame(GOLDEN.ready, 3n, 2n));
		machine.accept("client-to-server", frame(GOLDEN.heartbeat, 3n, 3n));
		machine.accept("server-to-client", frame(GOLDEN.heartbeatAck, 4n, 3n));
		machine.accept("client-to-server", frame(GOLDEN.updateClient, 4n, 4n));
		machine.accept("server-to-client", frame(GOLDEN.updateAck, 5n, 4n));
		machine.accept("client-to-server", frame(GOLDEN.close, 5n, 0n));
		expect(machine.state).toBe("closed");
	});

	it("rejects direction, sequence, state, request-id, and response mismatches", () => {
		expect(() =>
			new CrdtProtocolMachineV1().accept(
				"server-to-client",
				frame(GOLDEN.auth, 1n, 1n),
			),
		).toThrow(CrdtProtocolError);
		expect(() =>
			new CrdtProtocolMachineV1().accept(
				"client-to-server",
				frame(GOLDEN.auth, 2n, 1n),
			),
		).toThrow(CrdtProtocolError);
		expect(() =>
			new CrdtProtocolMachineV1().accept(
				"client-to-server",
				frame(GOLDEN.heartbeat, 1n, 1n),
			),
		).toThrow(CrdtProtocolError);
		expect(() =>
			new CrdtProtocolMachineV1().accept(
				"client-to-server",
				frame(GOLDEN.auth, 1n, 0n),
			),
		).toThrow(CrdtProtocolError);

		const machine = new CrdtProtocolMachineV1();
		machine.accept("client-to-server", frame(GOLDEN.auth, 1n, 7n));
		expect(() =>
			machine.accept("server-to-client", frame(GOLDEN.authOk, 1n, 8n)),
		).toThrow(CrdtProtocolError);
	});

	it("rejects request reuse and pipelining behind AUTH", () => {
		const machine = new CrdtProtocolMachineV1();
		machine.accept("client-to-server", frame(GOLDEN.auth, 1n, 1n));
		expect(() =>
			machine.accept("client-to-server", frame(GOLDEN.heartbeat, 2n, 2n)),
		).toThrow(CrdtProtocolError);

		const ready = new CrdtProtocolMachineV1();
		ready.accept("client-to-server", frame(GOLDEN.auth, 1n, 1n));
		ready.accept("server-to-client", frame(GOLDEN.authOk, 1n, 1n));
		ready.accept("client-to-server", frame(GOLDEN.syncProof, 2n, 2n));
		ready.accept("server-to-client", frame(GOLDEN.ready, 2n, 2n));
		ready.accept("client-to-server", frame(GOLDEN.heartbeat, 3n, 3n));
		ready.accept("server-to-client", frame(GOLDEN.heartbeatAck, 3n, 3n));
		expect(() =>
			ready.accept("client-to-server", frame(GOLDEN.heartbeat, 4n, 3n)),
		).toThrow(CrdtProtocolError);
	});
});
