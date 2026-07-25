import { describe, expect, test } from "bun:test";

import {
	decodeCrdtExchangeFrameV1,
	encodeCrdtExchangeFrameV1,
} from "../../../src/shared/crdt-exchange.js";

describe("CRDT HTTP exchange codec", () => {
	test("round-trips one typed heartbeat without socket connection state", () => {
		const requestId = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
		const bindingId = Uint8Array.from(
			{ length: 16 },
			(_, index) => 0xf0 - index,
		);

		const bytes = encodeCrdtExchangeFrameV1({
			major: 1,
			minor: 0,
			opcode: 0x05,
			requestId,
			payload: {
				bindingId,
				sessionGeneration: 7n,
				deliveryGeneration: 3n,
			},
		});

		expect(decodeCrdtExchangeFrameV1(bytes)).toEqual({
			major: 1,
			minor: 0,
			opcode: 0x05,
			requestId,
			payload: {
				bindingId,
				sessionGeneration: 7n,
				deliveryGeneration: 3n,
			},
		});
	});

	test("rejects truncated, trailing, flagged, and unknown frames", () => {
		const valid = encodeCrdtExchangeFrameV1({
			major: 1,
			minor: 0,
			opcode: 0x05,
			requestId: Uint8Array.from({ length: 16 }, (_, index) => index + 1),
			payload: {
				bindingId: Uint8Array.from({ length: 16 }, (_, index) => 0xf0 - index),
				sessionGeneration: 7n,
				deliveryGeneration: 3n,
			},
		});
		const flagged = valid.slice();
		flagged[7] = 1;
		const unknown = valid.slice();
		unknown[6] = 0x7f;

		for (const malformed of [
			valid.subarray(0, valid.byteLength - 1),
			Uint8Array.from([...valid, 0]),
			flagged,
			unknown,
		]) {
			expect(() => decodeCrdtExchangeFrameV1(malformed)).toThrow();
		}
	});

	test("round-trips a sorted atomic append bundle", () => {
		const requestId = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
		const bindingId = Uint8Array.from(
			{ length: 16 },
			(_, index) => 0xf0 - index,
		);
		const updateId = Uint8Array.from(
			{ length: 16 },
			(_, index) => 0x80 + index,
		);
		const frame = {
			major: 1 as const,
			minor: 0 as const,
			opcode: 0x02 as const,
			requestId,
			payload: {
				bindingId,
				sessionGeneration: 7n,
				deliveryGeneration: 3n,
				updateId,
				aggregateEpoch: 11n,
				schemaVersion: 3,
				parts: [
					{
						fieldSlot: 1,
						fieldEpoch: 2n,
						formatVersion: 1,
						baseFieldCursor: 8n,
						bytes: Uint8Array.of(0xaa),
					},
					{
						fieldSlot: 4,
						fieldEpoch: 5n,
						formatVersion: 1,
						baseFieldCursor: 13n,
						bytes: Uint8Array.of(0xbb, 0xcc),
					},
				],
			},
		};

		expect(decodeCrdtExchangeFrameV1(encodeCrdtExchangeFrameV1(frame))).toEqual(
			frame,
		);
	});

	test("rejects duplicate or unsorted append fields before encoding", () => {
		const base = {
			major: 1 as const,
			minor: 0 as const,
			opcode: 0x02 as const,
			requestId: Uint8Array.from({ length: 16 }, (_, index) => index + 1),
			payload: {
				bindingId: Uint8Array.from({ length: 16 }, (_, index) => 0xf0 - index),
				sessionGeneration: 7n,
				deliveryGeneration: 3n,
				updateId: Uint8Array.from({ length: 16 }, (_, index) => 0x80 + index),
				aggregateEpoch: 11n,
				schemaVersion: 3,
			},
		};
		const part = (fieldSlot: number) => ({
			fieldSlot,
			fieldEpoch: 2n,
			formatVersion: 1,
			baseFieldCursor: 8n,
			bytes: Uint8Array.of(0xaa),
		});

		for (const parts of [
			[part(1), part(1)],
			[part(2), part(1)],
		]) {
			expect(() =>
				encodeCrdtExchangeFrameV1({
					...base,
					payload: { ...base.payload, parts },
				}),
			).toThrow();
		}
	});

	test("round-trips the closed pull artifact and continuation contract", () => {
		const requestId = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
		const pullId = Uint8Array.from({ length: 16 }, (_, index) => 0x80 + index);
		const digest = new Uint8Array(32).fill(0x5a);
		const request = {
			major: 1 as const,
			minor: 0 as const,
			opcode: 0x01 as const,
			requestId,
			payload: {
				bindingId: Uint8Array.from({ length: 16 }, (_, index) => 0xf0 - index),
				sessionGeneration: 7n,
				deliveryGeneration: 3n,
				pullId,
				schemaVersion: 2,
				continuation: null,
				proofs: [{ fieldSlot: 1, fieldEpoch: 4n, proof: Uint8Array.of(1, 2) }],
			},
		};
		expect(
			decodeCrdtExchangeFrameV1(encodeCrdtExchangeFrameV1(request)),
		).toEqual(request);
		const continued = {
			...request,
			payload: {
				...request.payload,
				continuation: "A".repeat(78),
				proofs: [],
			},
		};
		expect(
			decodeCrdtExchangeFrameV1(encodeCrdtExchangeFrameV1(continued)),
		).toEqual(continued);
		for (const continuation of ["A".repeat(77), "A".repeat(79)]) {
			expect(() =>
				encodeCrdtExchangeFrameV1({
					...continued,
					payload: { ...continued.payload, continuation },
				}),
			).toThrow();
		}

		const response = {
			major: 1 as const,
			minor: 0 as const,
			opcode: 0x81 as const,
			requestId,
			payload: {
				pullId,
				aggregateEpoch: 9n,
				schemaVersion: 2,
				artifactDigest: digest,
				complete: true,
				continuation: null,
				fields: [
					{
						fieldSlot: 1,
						grant: 1 as const,
						fieldEpoch: 4n,
						formatVersion: 1,
						fieldCursor: 8n,
						byteLength: 2,
						digest,
					},
				],
				chunks: [
					{
						fieldSlot: 1,
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
		};
		expect(
			decodeCrdtExchangeFrameV1(encodeCrdtExchangeFrameV1(response)),
		).toEqual(response);
	});

	test("round-trips receipts, awareness actions and closed busy/recovery responses", () => {
		const requestId = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
		const session = {
			bindingId: Uint8Array.from({ length: 16 }, (_, index) => 0xf0 - index),
			sessionGeneration: 7n,
			deliveryGeneration: 3n,
		};
		const updateId = Uint8Array.from(
			{ length: 16 },
			(_, index) => 0x80 + index,
		);
		const frames = [
			{
				major: 1 as const,
				minor: 0 as const,
				opcode: 0x03 as const,
				requestId,
				payload: {
					...session,
					receipts: [
						{
							updateId,
							submittedHash: new Uint8Array(32).fill(0x33),
							aggregateEpoch: 9n,
							schemaVersion: 2,
						},
					],
				},
			},
			{
				major: 1 as const,
				minor: 0 as const,
				opcode: 0x04 as const,
				requestId,
				payload: { ...session, action: "write" as const, value: { x: 1 } },
			},
			{
				major: 1 as const,
				minor: 0 as const,
				opcode: 0x04 as const,
				requestId,
				payload: { ...session, action: "clear" as const },
			},
			{
				major: 1 as const,
				minor: 0 as const,
				opcode: 0x04 as const,
				requestId,
				payload: { ...session, action: "roster" as const },
			},
			{
				major: 1 as const,
				minor: 0 as const,
				opcode: 0xfe as const,
				requestId,
				payload: { retryAfterMs: 250 },
			},
			{
				major: 1 as const,
				minor: 0 as const,
				opcode: 0xff as const,
				requestId,
				payload: { action: 1 as const },
			},
		];
		for (const frame of frames) {
			expect(
				decodeCrdtExchangeFrameV1(encodeCrdtExchangeFrameV1(frame)),
			).toEqual(frame);
		}
	});

	test("rejects client proofs on an authenticated continuation", () => {
		expect(() =>
			encodeCrdtExchangeFrameV1({
				major: 1,
				minor: 0,
				opcode: 0x01,
				requestId: Uint8Array.from({ length: 16 }, (_, index) => index + 1),
				payload: {
					bindingId: Uint8Array.from(
						{ length: 16 },
						(_, index) => 0xf0 - index,
					),
					sessionGeneration: 7n,
					deliveryGeneration: 3n,
					pullId: Uint8Array.from({ length: 16 }, (_, index) => 0x80 + index),
					schemaVersion: 2,
					continuation: "abc",
					proofs: [{ fieldSlot: 1, fieldEpoch: 1n, proof: Uint8Array.of(1) }],
				},
			}),
		).toThrow();
	});
});
