import { describe, expect, test } from "bun:test";

import {
	CRDT_EXCHANGE_V1_MAX_BODY_BYTES,
	CrdtExchangeProtocolError,
	decodeCrdtExchangeFrameV1,
	encodeCrdtExchangeFrameV1,
	encodeStoredCrdtExchangeResponseV1,
	type CrdtExchangeFrameV1,
} from "../../../src/shared/crdt-exchange.js";

const GOLDEN = {
	pull: "51504358010001000102030405060708090a0b0c0d0e0f100000004800000000202122232425262728292a2b2c2d2e2f00000000000000070000000000000003303132333435363738393a3b3c3d3e3f000000020000000100020000000000000004000000020102",
	append:
		"51504358010002000102030405060708090a0b0c0d0e0f100000005800000000202122232425262728292a2b2c2d2e2f00000000000000070000000000000003404142434445464748494a4b4c4d4e4f0000000000000009000000020001000200000000000000040001000000000000000800000002aabb",
	receiptQuery:
		"51504358010003000102030405060708090a0b0c0d0e0f100000005e00000000202122232425262728292a2b2c2d2e2f000000000000000700000000000000030001404142434445464748494a4b4c4d4e4f3333333333333333333333333333333333333333333333333333333333333333000000000000000900000002",
	awareness:
		"51504358010004000102030405060708090a0b0c0d0e0f100000003e00000000202122232425262728292a2b2c2d2e2f0000000000000007000000000000000301000000197b22637572736f72223a332c2275736572223a22416461227d",
	heartbeat:
		"51504358010005000102030405060708090a0b0c0d0e0f100000002000000000202122232425262728292a2b2c2d2e2f00000000000000070000000000000003",
	close:
		"51504358010006000102030405060708090a0b0c0d0e0f100000002000000000202122232425262728292a2b2c2d2e2f00000000000000070000000000000003",
	pullResponse:
		"51504358010081000102030405060708090a0b0c0d0e0f100000009f00000000303132333435363738393a3b3c3d3e3f0000000000000009000000025a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a0100000001000201000000000000000400010000000000000008000000025a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a0001000200000000000000040001000000000000000800000000000000000100000002aabb",
	appendReceipt:
		"51504358010082000102030405060708090a0b0c0d0e0f100000002400000000404142434445464748494a4b4c4d4e4f0000000000000009000100020000000000000008",
	receiptResponse:
		"51504358010083000102030405060708090a0b0c0d0e0f1000000026000000000001404142434445464748494a4b4c4d4e4f0000000000000009000100020000000000000008",
	roster:
		"51504358010084000102030405060708090a0b0c0d0e0f100000002a00000000000000267b2267656e65726174696f6e223a322c227573657273223a5b7b226964223a227531227d5d7d",
	heartbeatAck:
		"51504358010085000102030405060708090a0b0c0d0e0f100000000800000000000000000000007b",
	closeAck: "51504358010086000102030405060708090a0b0c0d0e0f100000000000000000",
	busy: "515043580100fe000102030405060708090a0b0c0d0e0f100000000400000000000000fa",
	recovery:
		"515043580100ff000102030405060708090a0b0c0d0e0f10000000010000000001",
	pullContinuation:
		"51504358010001000102030405060708090a0b0c0d0e0f100000008600000000202122232425262728292a2b2c2d2e2f00000000000000070000000000000003303132333435363738393a3b3c3d3e3f00000002004e4141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141410000",
	awarenessClear:
		"51504358010004000102030405060708090a0b0c0d0e0f100000002100000000202122232425262728292a2b2c2d2e2f0000000000000007000000000000000302",
	awarenessRoster:
		"51504358010004000102030405060708090a0b0c0d0e0f100000002100000000202122232425262728292a2b2c2d2e2f0000000000000007000000000000000303",
	pullMore:
		"51504358010081000102030405060708090a0b0c0d0e0f100000009100000000303132333435363738393a3b3c3d3e3f0000000000000009000000025a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a00004e41414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414100000000",
} as const;

const REQUEST_ID = id(0x01);
const CONTINUATION = "A".repeat(78);
const SESSION = {
	bindingId: id(0x20),
	sessionGeneration: 7n,
	deliveryGeneration: 3n,
};
const RECEIPT = {
	updateId: id(0x40),
	aggregateEpoch: 9n,
	cursors: [{ fieldSlot: 2, fieldCursor: 8n }],
};

const FRAMES = [
	{
		major: 1,
		minor: 0,
		opcode: 0x01,
		requestId: REQUEST_ID,
		payload: {
			...SESSION,
			pullId: id(0x30),
			schemaVersion: 2,
			continuation: null,
			proofs: [{ fieldSlot: 2, fieldEpoch: 4n, proof: Uint8Array.of(1, 2) }],
		},
	},
	{
		major: 1,
		minor: 0,
		opcode: 0x02,
		requestId: REQUEST_ID,
		payload: {
			...SESSION,
			updateId: id(0x40),
			aggregateEpoch: 9n,
			schemaVersion: 2,
			parts: [
				{
					fieldSlot: 2,
					fieldEpoch: 4n,
					formatVersion: 1,
					baseFieldCursor: 8n,
					bytes: Uint8Array.of(0xaa, 0xbb),
				},
			],
		},
	},
	{
		major: 1,
		minor: 0,
		opcode: 0x03,
		requestId: REQUEST_ID,
		payload: {
			...SESSION,
			receipts: [
				{
					updateId: id(0x40),
					submittedHash: hash(0x33),
					aggregateEpoch: 9n,
					schemaVersion: 2,
				},
			],
		},
	},
	{
		major: 1,
		minor: 0,
		opcode: 0x04,
		requestId: REQUEST_ID,
		payload: {
			...SESSION,
			action: "write",
			value: { cursor: 3, user: "Ada" },
		},
	},
	{
		major: 1,
		minor: 0,
		opcode: 0x05,
		requestId: REQUEST_ID,
		payload: SESSION,
	},
	{
		major: 1,
		minor: 0,
		opcode: 0x06,
		requestId: REQUEST_ID,
		payload: SESSION,
	},
	{
		major: 1,
		minor: 0,
		opcode: 0x81,
		requestId: REQUEST_ID,
		payload: {
			pullId: id(0x30),
			aggregateEpoch: 9n,
			schemaVersion: 2,
			artifactDigest: hash(0x5a),
			complete: true,
			continuation: null,
			fields: [
				{
					fieldSlot: 2,
					grant: 1,
					fieldEpoch: 4n,
					formatVersion: 1,
					fieldCursor: 8n,
					byteLength: 2,
					digest: hash(0x5a),
				},
			],
			chunks: [
				{
					fieldSlot: 2,
					fieldEpoch: 4n,
					formatVersion: 1,
					throughFieldCursor: 8n,
					chunkIndex: 0,
					offset: 0,
					final: true,
					bytes: Uint8Array.of(0xaa, 0xbb),
				},
			],
		},
	},
	{
		major: 1,
		minor: 0,
		opcode: 0x82,
		requestId: REQUEST_ID,
		payload: RECEIPT,
	},
	{
		major: 1,
		minor: 0,
		opcode: 0x83,
		requestId: REQUEST_ID,
		payload: { receipts: [RECEIPT] },
	},
	{
		major: 1,
		minor: 0,
		opcode: 0x84,
		requestId: REQUEST_ID,
		payload: { value: { generation: 2, users: [{ id: "u1" }] } },
	},
	{
		major: 1,
		minor: 0,
		opcode: 0x85,
		requestId: REQUEST_ID,
		payload: { serverTimeMs: 123n },
	},
	{
		major: 1,
		minor: 0,
		opcode: 0x86,
		requestId: REQUEST_ID,
		payload: {},
	},
	{
		major: 1,
		minor: 0,
		opcode: 0xfe,
		requestId: REQUEST_ID,
		payload: { retryAfterMs: 250 },
	},
	{
		major: 1,
		minor: 0,
		opcode: 0xff,
		requestId: REQUEST_ID,
		payload: { action: 1 },
	},
	{
		major: 1,
		minor: 0,
		opcode: 0x01,
		requestId: REQUEST_ID,
		payload: {
			...SESSION,
			pullId: id(0x30),
			schemaVersion: 2,
			continuation: CONTINUATION,
			proofs: [],
		},
	},
	{
		major: 1,
		minor: 0,
		opcode: 0x04,
		requestId: REQUEST_ID,
		payload: { ...SESSION, action: "clear" },
	},
	{
		major: 1,
		minor: 0,
		opcode: 0x04,
		requestId: REQUEST_ID,
		payload: { ...SESSION, action: "roster" },
	},
	{
		major: 1,
		minor: 0,
		opcode: 0x81,
		requestId: REQUEST_ID,
		payload: {
			pullId: id(0x30),
			aggregateEpoch: 9n,
			schemaVersion: 2,
			artifactDigest: hash(0x5a),
			complete: false,
			continuation: CONTINUATION,
			fields: [],
			chunks: [],
		},
	},
] satisfies CrdtExchangeFrameV1[];

describe("QPCX v1 normative golden vectors", () => {
	test("encodes and decodes every request and response opcode byte-for-byte", () => {
		const vectors = Object.values(GOLDEN);
		expect(FRAMES.map((frame) => frame.opcode)).toEqual([
			0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86,
			0xfe, 0xff, 0x01, 0x04, 0x04, 0x81,
		]);
		expect(vectors).toHaveLength(FRAMES.length);

		for (const [index, frame] of FRAMES.entries()) {
			expect(encodeCrdtExchangeFrameV1(frame).toHex()).toBe(vectors[index]);
			expect(
				decodeCrdtExchangeFrameV1(Uint8Array.fromHex(vectors[index]!)),
			).toEqual(frame);
		}
	});

	test("preserves the fixed network-order header", () => {
		const bytes = Uint8Array.fromHex(GOLDEN.append);
		expect(bytes.subarray(0, 8)).toEqual(
			Uint8Array.of(0x51, 0x50, 0x43, 0x58, 1, 0, 2, 0),
		);
		expect(bytes.subarray(8, 24)).toEqual(REQUEST_ID);
		expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(24)).toBe(
			bytes.byteLength - 32,
		);
		expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(28)).toBe(0);
	});
});

describe("QPCX v1 malformed and fuzz boundary", () => {
	test("rejects every noncanonical envelope field", () => {
		const heartbeat = Uint8Array.fromHex(GOLDEN.heartbeat);
		expect(() =>
			decodeCrdtExchangeFrameV1("binary required" as unknown as Uint8Array),
		).toThrow(CrdtExchangeProtocolError);

		for (const [offset, value] of [
			[0, 0],
			[1, 0],
			[2, 0],
			[3, 0],
			[4, 2],
			[5, 1],
			[6, 0x7f],
			[7, 1],
			[28, 1],
		] as const) {
			const candidate = heartbeat.slice();
			candidate[offset] = value;
			expect(() => decodeCrdtExchangeFrameV1(candidate)).toThrow(
				CrdtExchangeProtocolError,
			);
		}

		const zeroRequestId = heartbeat.slice();
		zeroRequestId.fill(0, 8, 24);
		expect(() => decodeCrdtExchangeFrameV1(zeroRequestId)).toThrow(
			CrdtExchangeProtocolError,
		);

		for (const payloadLength of [31, 33]) {
			const candidate = heartbeat.slice();
			new DataView(
				candidate.buffer,
				candidate.byteOffset,
				candidate.byteLength,
			).setUint32(24, payloadLength);
			expect(() => decodeCrdtExchangeFrameV1(candidate)).toThrow(
				CrdtExchangeProtocolError,
			);
		}

		expect(() =>
			decodeCrdtExchangeFrameV1(
				new Uint8Array(CRDT_EXCHANGE_V1_MAX_BODY_BYTES + 1),
			),
		).toThrow(CrdtExchangeProtocolError);
	});

	test("rejects every truncated vector and trailing bytes", () => {
		for (const vector of Object.values(GOLDEN)) {
			const bytes = Uint8Array.fromHex(vector);
			for (let length = 0; length < bytes.byteLength; length++) {
				expect(() =>
					decodeCrdtExchangeFrameV1(bytes.subarray(0, length)),
				).toThrow(CrdtExchangeProtocolError);
			}
			expect(() =>
				decodeCrdtExchangeFrameV1(Uint8Array.from([...bytes, 0])),
			).toThrow(CrdtExchangeProtocolError);
		}
	});

	test("accepts only canonical single-bit mutations", () => {
		for (const vector of Object.values(GOLDEN)) {
			const bytes = Uint8Array.fromHex(vector);
			for (let offset = 0; offset < bytes.byteLength; offset++) {
				const candidate = bytes.slice();
				candidate[offset]! ^= 1 << (offset % 8);
				expectCanonicalOrRejected(candidate);
			}
		}
	});

	test("terminates deterministically for seeded arbitrary binary input", () => {
		let state = 0x9e3779b9;
		const random = () => {
			state ^= state << 13;
			state ^= state >>> 17;
			state ^= state << 5;
			return state >>> 0;
		};

		for (let iteration = 0; iteration < 10_000; iteration++) {
			const candidate = Uint8Array.from(
				{ length: random() % 513 },
				() => random() & 0xff,
			);
			expectCanonicalOrRejected(candidate);
		}

		for (const length of [
			31,
			32,
			33,
			CRDT_EXCHANGE_V1_MAX_BODY_BYTES - 1,
			CRDT_EXCHANGE_V1_MAX_BODY_BYTES,
			CRDT_EXCHANGE_V1_MAX_BODY_BYTES + 1,
		]) {
			expectCanonicalOrRejected(new Uint8Array(length));
		}
	});
});

describe("QPCX v1 nested and aggregate bounds", () => {
	test("rejects every encoded collection and nested byte ceiling", () => {
		const proof = FRAMES[0];
		const append = FRAMES[1];
		const receiptQuery = FRAMES[2];
		const awareness = FRAMES[3];
		const pullResponse = FRAMES[6];
		const receiptResponse = FRAMES[8];

		expect(() =>
			encodeCrdtExchangeFrameV1({
				...proof,
				payload: {
					...proof.payload,
					proofs: fieldItems(33, (fieldSlot) => ({
						fieldSlot,
						fieldEpoch: 1n,
						proof: Uint8Array.of(1),
					})),
				},
			}),
		).toThrow(CrdtExchangeProtocolError);
		expect(() =>
			encodeCrdtExchangeFrameV1({
				...proof,
				payload: {
					...proof.payload,
					proofs: [
						{
							fieldSlot: 1,
							fieldEpoch: 1n,
							proof: new Uint8Array(64 * 1024 + 1),
						},
					],
				},
			}),
		).toThrow(CrdtExchangeProtocolError);
		expect(() =>
			encodeCrdtExchangeFrameV1({
				...append,
				payload: {
					...append.payload,
					parts: fieldItems(33, appendPart),
				},
			}),
		).toThrow(CrdtExchangeProtocolError);
		expect(() =>
			encodeCrdtExchangeFrameV1({
				...append,
				payload: {
					...append.payload,
					parts: [appendPart(1, new Uint8Array(256 * 1024 + 1))],
				},
			}),
		).toThrow(CrdtExchangeProtocolError);
		expect(() =>
			encodeCrdtExchangeFrameV1({
				...receiptQuery,
				payload: {
					...receiptQuery.payload,
					receipts: Array.from({ length: 65 }, (_, index) => ({
						updateId: id(0x40 + index),
						submittedHash: hash(index),
						aggregateEpoch: 1n,
						schemaVersion: 1,
					})),
				},
			}),
		).toThrow(CrdtExchangeProtocolError);
		expect(() =>
			encodeCrdtExchangeFrameV1({
				...awareness,
				payload: {
					...awareness.payload,
					value: "x".repeat(1024),
				},
			}),
		).toThrow(CrdtExchangeProtocolError);
		expect(() =>
			encodeCrdtExchangeFrameV1({
				...pullResponse,
				payload: {
					...pullResponse.payload,
					fields: fieldItems(33, (fieldSlot) => ({
						fieldSlot,
						grant: 1,
						fieldEpoch: 1n,
						formatVersion: 1,
						fieldCursor: 1n,
						byteLength: 0,
						digest: hash(1),
					})),
				},
			}),
		).toThrow(CrdtExchangeProtocolError);
		expect(() =>
			encodeCrdtExchangeFrameV1({
				...receiptResponse,
				payload: {
					receipts: [
						{
							...RECEIPT,
							cursors: fieldItems(33, (fieldSlot) => ({
								fieldSlot,
								fieldCursor: 1n,
							})),
						},
					],
				},
			}),
		).toThrow(CrdtExchangeProtocolError);
		expect(() =>
			encodeCrdtExchangeFrameV1({
				...receiptResponse,
				payload: {
					receipts: Array.from({ length: 65 }, (_, index) => ({
						updateId: id(0x40 + index),
						aggregateEpoch: 1n,
						cursors: [],
					})),
				},
			}),
		).toThrow(CrdtExchangeProtocolError);
		expect(() =>
			encodeCrdtExchangeFrameV1({
				...FRAMES[9],
				payload: { value: "x".repeat(64 * 1024) },
			}),
		).toThrow(CrdtExchangeProtocolError);
	});

	test("accepts every exact nested byte and collection ceiling", () => {
		const proof = FRAMES[0];
		const append = FRAMES[1];
		const receiptQuery = FRAMES[2];
		const awareness = FRAMES[3];
		const pullResponse = FRAMES[6];
		const receiptResponse = FRAMES[8];

		for (const frame of [
			{
				...proof,
				payload: {
					...proof.payload,
					proofs: fieldItems(32, (fieldSlot) => ({
						fieldSlot,
						fieldEpoch: 1n,
						proof:
							fieldSlot === 1 ? new Uint8Array(64 * 1024) : new Uint8Array(),
					})),
				},
			},
			{
				...append,
				payload: {
					...append.payload,
					parts: [appendPart(1, new Uint8Array(256 * 1024))],
				},
			},
			{
				...receiptQuery,
				payload: {
					...receiptQuery.payload,
					receipts: Array.from({ length: 64 }, (_, index) => ({
						updateId: id(0x40 + index),
						submittedHash: hash(index),
						aggregateEpoch: 1n,
						schemaVersion: 1,
					})),
				},
			},
			{
				...awareness,
				payload: {
					...awareness.payload,
					value: "x".repeat(1022),
				},
			},
			{
				...pullResponse,
				payload: {
					...pullResponse.payload,
					fields: fieldItems(32, (fieldSlot) => ({
						fieldSlot,
						grant: 1 as const,
						fieldEpoch: 1n,
						formatVersion: 1,
						fieldCursor: 1n,
						byteLength: 0,
						digest: hash(1),
					})),
					chunks: [
						{
							...pullResponse.payload.chunks[0]!,
							bytes: new Uint8Array(256 * 1024),
						},
					],
				},
			},
			{
				...receiptResponse,
				payload: {
					receipts: Array.from({ length: 64 }, (_, index) => ({
						updateId: id(0x40 + index),
						aggregateEpoch: 1n,
						cursors: [],
					})),
				},
			},
			{
				...FRAMES[9],
				payload: { value: "x".repeat(64 * 1024 - 2) },
			},
		] satisfies CrdtExchangeFrameV1[]) {
			const encoded = encodeCrdtExchangeFrameV1(frame);
			expect(
				encodeCrdtExchangeFrameV1(decodeCrdtExchangeFrameV1(encoded)),
			).toEqual(encoded);
		}
	});

	test("rejects runtime values that would otherwise be silently normalized", () => {
		const pullResponse = FRAMES[6];
		for (const frame of [
			{
				...pullResponse,
				payload: {
					...pullResponse.payload,
					complete: 1 as unknown as boolean,
				},
			},
			{
				...pullResponse,
				payload: {
					...pullResponse.payload,
					chunks: [
						{
							...pullResponse.payload.chunks[0]!,
							final: 1 as unknown as boolean,
						},
					],
				},
			},
			{
				...FRAMES[3],
				payload: {
					...SESSION,
					action: "invalid",
				},
			} as unknown as CrdtExchangeFrameV1,
		]) {
			expect(() => encodeCrdtExchangeFrameV1(frame)).toThrow(
				CrdtExchangeProtocolError,
			);
		}
	});

	test("rejects invalid pull chunks, duplicate response IDs and busy ranges", () => {
		const pullResponse = FRAMES[6];
		expect(() =>
			encodeCrdtExchangeFrameV1({
				...pullResponse,
				payload: {
					...pullResponse.payload,
					chunks: [
						{
							...pullResponse.payload.chunks[0]!,
							fieldSlot: 0,
						},
					],
				},
			}),
		).toThrow(CrdtExchangeProtocolError);

		const duplicateReceipt = {
			...RECEIPT,
			cursors: [],
		};
		expect(() =>
			encodeCrdtExchangeFrameV1({
				...FRAMES[8],
				payload: {
					receipts: [duplicateReceipt, duplicateReceipt],
				},
			}),
		).toThrow(CrdtExchangeProtocolError);

		for (const retryAfterMs of [0, 5_001]) {
			expect(() =>
				encodeCrdtExchangeFrameV1({
					...FRAMES[12],
					payload: { retryAfterMs },
				}),
			).toThrow(CrdtExchangeProtocolError);
		}
	});

	test("validates already-stored response payloads against the same closed codec", () => {
		const heartbeatAck = Uint8Array.fromHex(GOLDEN.heartbeatAck);
		const payload = heartbeatAck.subarray(32);
		expect(
			encodeStoredCrdtExchangeResponseV1(0x85, REQUEST_ID, payload),
		).toEqual(heartbeatAck);

		for (const [opcode, requestId, stored] of [
			[0x05, REQUEST_ID, payload],
			[0x85, new Uint8Array(16), payload],
			[0x85, REQUEST_ID, Uint8Array.from([...payload, 0])],
			[0x85, REQUEST_ID, new Uint8Array(1024 * 1024 + 1)],
		] as const) {
			expect(() =>
				encodeStoredCrdtExchangeResponseV1(opcode as 0x85, requestId, stored),
			).toThrow(CrdtExchangeProtocolError);
		}
	});

	test("rejects an aggregate payload above one MiB", () => {
		const append = FRAMES[1];
		expect(() =>
			encodeCrdtExchangeFrameV1({
				...append,
				payload: {
					...append.payload,
					parts: fieldItems(5, (fieldSlot) =>
						appendPart(fieldSlot, new Uint8Array(256 * 1024)),
					),
				},
			}),
		).toThrow(CrdtExchangeProtocolError);
	});

	test("rejects hostile declared counts and lengths before consuming bytes", () => {
		for (const [name, offset, width, value] of [
			["pull", 86, 2, 33],
			["pull", 98, 4, 64 * 1024 + 1],
			["append", 92, 2, 33],
			["append", 114, 4, 256 * 1024 + 1],
			["receiptQuery", 64, 2, 65],
			["awareness", 65, 4, 1024 + 1],
			["pullResponse", 95, 2, 33],
			["pullResponse", 185, 4, 256 * 1024 + 1],
			["pullResponse", 156, 2, 0],
			["appendReceipt", 56, 2, 33],
			["receiptResponse", 32, 2, 65],
			["receiptResponse", 58, 2, 33],
			["roster", 32, 4, 64 * 1024 + 1],
		] as const) {
			const bytes = Uint8Array.fromHex(GOLDEN[name]);
			const view = new DataView(
				bytes.buffer,
				bytes.byteOffset,
				bytes.byteLength,
			);
			if (width === 2) view.setUint16(offset, value);
			else view.setUint32(offset, value);
			expect(() => decodeCrdtExchangeFrameV1(bytes)).toThrow(
				CrdtExchangeProtocolError,
			);
		}

		const oversizedHeader = Uint8Array.fromHex(GOLDEN.heartbeat).subarray(
			0,
			32,
		);
		new DataView(
			oversizedHeader.buffer,
			oversizedHeader.byteOffset,
			oversizedHeader.byteLength,
		).setUint32(24, 1024 * 1024 + 1);
		expect(() => decodeCrdtExchangeFrameV1(oversizedHeader)).toThrow(
			CrdtExchangeProtocolError,
		);
	});
});

function id(start: number): Uint8Array {
	return Uint8Array.from({ length: 16 }, (_, index) => (start + index) & 0xff);
}

function hash(value: number): Uint8Array {
	return new Uint8Array(32).fill(value & 0xff);
}

function fieldItems<T>(count: number, create: (fieldSlot: number) => T): T[] {
	return Array.from({ length: count }, (_, index) => create(index + 1));
}

function appendPart(
	fieldSlot: number,
	bytes = Uint8Array.of(1),
): Extract<CrdtExchangeFrameV1, { opcode: 0x02 }>["payload"]["parts"][number] {
	return {
		fieldSlot,
		fieldEpoch: 1n,
		formatVersion: 1,
		baseFieldCursor: 1n,
		bytes,
	};
}

function expectCanonicalOrRejected(candidate: Uint8Array): void {
	try {
		const decoded = decodeCrdtExchangeFrameV1(candidate);
		expect(encodeCrdtExchangeFrameV1(decoded)).toEqual(candidate);
	} catch (error) {
		expect(error).toBeInstanceOf(CrdtExchangeProtocolError);
	}
}
