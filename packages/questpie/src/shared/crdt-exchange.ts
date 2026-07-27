import {
	canonicalCrdtJson,
	CrdtBinaryReader,
	CrdtBinaryWriter,
} from "./crdt-binary.js";

const MAGIC = Uint8Array.of(0x51, 0x50, 0x43, 0x58); // QPCX
const HEADER_BYTES = 32;
const MAX_PAYLOAD_BYTES = 1024 * 1024;
const MAX_FIELD_BYTES = 256 * 1024;
const MAX_PROOF_BYTES = 64 * 1024;
const MAX_AWARENESS_BYTES = 1024;
const MAX_ROSTER_BYTES = 64 * 1024;
const CONTINUATION_BYTES = 78;
const MAX_FIELDS = 32;
const MAX_RECEIPTS = 64;
const ID_BYTES = 16;
const HASH_BYTES = 32;

export const CRDT_EXCHANGE_V1_HEADER_BYTES = HEADER_BYTES;
export const CRDT_EXCHANGE_V1_MAX_PAYLOAD_BYTES = MAX_PAYLOAD_BYTES;
export const CRDT_EXCHANGE_V1_MAX_BODY_BYTES = HEADER_BYTES + MAX_PAYLOAD_BYTES;
export const CRDT_EXCHANGE_V1_CONTENT_TYPE =
	"application/vnd.questpie.crdt-exchange";

type CrdtExchangeFrame<TOpcode extends number, TPayload> = Readonly<{
	major: 1;
	minor: 0;
	opcode: TOpcode;
	requestId: Uint8Array;
	payload: TPayload;
}>;

type CrdtExchangeSessionPayload = Readonly<{
	bindingId: Uint8Array;
	sessionGeneration: bigint;
	deliveryGeneration: bigint;
}>;

export type CrdtExchangePullProofV1 = Readonly<{
	fieldSlot: number;
	fieldEpoch: bigint;
	proof: Uint8Array;
}>;

export type CrdtExchangeAppendPartV1 = Readonly<{
	fieldSlot: number;
	fieldEpoch: bigint;
	formatVersion: number;
	baseFieldCursor: bigint;
	bytes: Uint8Array;
}>;

export type CrdtExchangeReceiptQueryV1 = Readonly<{
	updateId: Uint8Array;
	submittedHash: Uint8Array;
	aggregateEpoch: bigint;
	schemaVersion: number;
}>;

export type CrdtExchangePullFieldV1 = Readonly<{
	fieldSlot: number;
	grant: 0 | 1;
	fieldEpoch: bigint;
	formatVersion: number;
	fieldCursor: bigint;
	byteLength: number;
	digest: Uint8Array;
}>;

export type CrdtExchangePullChunkV1 = Readonly<{
	fieldSlot: number;
	fieldEpoch: bigint;
	formatVersion: number;
	throughFieldCursor: bigint;
	chunkIndex: number;
	offset: number;
	final: boolean;
	bytes: Uint8Array;
}>;

export type CrdtExchangeAppendReceiptV1 = Readonly<{
	updateId: Uint8Array;
	aggregateEpoch: bigint;
	cursors: readonly Readonly<{
		fieldSlot: number;
		fieldCursor: bigint;
	}>[];
}>;

export type CrdtExchangeRequestFrameV1 =
	| CrdtExchangeFrame<
			0x01,
			CrdtExchangeSessionPayload & {
				pullId: Uint8Array;
				schemaVersion: number;
				continuation: string | null;
				proofs: readonly CrdtExchangePullProofV1[];
			}
	  >
	| CrdtExchangeFrame<
			0x02,
			CrdtExchangeSessionPayload & {
				updateId: Uint8Array;
				aggregateEpoch: bigint;
				schemaVersion: number;
				parts: readonly CrdtExchangeAppendPartV1[];
			}
	  >
	| CrdtExchangeFrame<
			0x03,
			CrdtExchangeSessionPayload & {
				receipts: readonly CrdtExchangeReceiptQueryV1[];
			}
	  >
	| CrdtExchangeFrame<
			0x04,
			CrdtExchangeSessionPayload &
				(
					| { action: "write"; value: unknown }
					| { action: "clear" }
					| { action: "roster" }
				)
	  >
	| CrdtExchangeFrame<0x05, CrdtExchangeSessionPayload>
	| CrdtExchangeFrame<0x06, CrdtExchangeSessionPayload>;

export type CrdtExchangeResponseFrameV1 =
	| CrdtExchangeFrame<
			0x81,
			{
				pullId: Uint8Array;
				aggregateEpoch: bigint;
				schemaVersion: number;
				artifactDigest: Uint8Array;
				complete: boolean;
				continuation: string | null;
				fields: readonly CrdtExchangePullFieldV1[];
				chunks: readonly CrdtExchangePullChunkV1[];
			}
	  >
	| CrdtExchangeFrame<0x82, CrdtExchangeAppendReceiptV1>
	| CrdtExchangeFrame<
			0x83,
			{ receipts: readonly CrdtExchangeAppendReceiptV1[] }
	  >
	| CrdtExchangeFrame<0x84, { value: unknown }>
	| CrdtExchangeFrame<0x85, { serverTimeMs: bigint }>
	| CrdtExchangeFrame<0x86, Record<string, never>>
	| CrdtExchangeFrame<0xfe, { retryAfterMs: number }>
	| CrdtExchangeFrame<0xff, { action: 1 }>;

export type CrdtExchangeFrameV1 =
	| CrdtExchangeRequestFrameV1
	| CrdtExchangeResponseFrameV1;

const REQUEST_OPCODES = new Set([1, 2, 3, 4, 5, 6]);
const RESPONSE_OPCODES = new Set([
	0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0xfe, 0xff,
]);
const ALL_OPCODES = new Set([...REQUEST_OPCODES, ...RESPONSE_OPCODES]);

export class CrdtExchangeProtocolError extends Error {
	constructor(message = "Invalid CRDT exchange frame", options?: ErrorOptions) {
		super(message, options);
		this.name = "CrdtExchangeProtocolError";
	}
}

export function encodeCrdtExchangeFrameV1(
	frame: CrdtExchangeFrameV1,
): Uint8Array {
	try {
		if (
			frame.major !== 1 ||
			frame.minor !== 0 ||
			!ALL_OPCODES.has(frame.opcode)
		) {
			throw rejected();
		}
		const payload = encodePayload(frame);
		if (payload.byteLength > MAX_PAYLOAD_BYTES) throw rejected();
		const writer = new CrdtBinaryWriter();
		writer.bytes(MAGIC);
		writer.u8(1);
		writer.u8(0);
		writer.u8(frame.opcode);
		writer.u8(0);
		writer.bytes(checkedId(frame.requestId, "requestId"), ID_BYTES);
		writer.u32(payload.byteLength);
		writer.u32(0);
		writer.bytes(payload);
		return writer.finish();
	} catch (error) {
		throw wrap(error);
	}
}

export function encodeStoredCrdtExchangeResponseV1(
	opcode: CrdtExchangeResponseFrameV1["opcode"],
	requestId: Uint8Array,
	payload: Uint8Array,
): Uint8Array {
	try {
		if (
			!RESPONSE_OPCODES.has(opcode) ||
			!(payload instanceof Uint8Array) ||
			payload.byteLength > MAX_PAYLOAD_BYTES
		) {
			throw rejected();
		}
		const writer = new CrdtBinaryWriter();
		writer.bytes(MAGIC);
		writer.u8(1);
		writer.u8(0);
		writer.u8(opcode);
		writer.u8(0);
		writer.bytes(checkedId(requestId, "requestId"), ID_BYTES);
		writer.u32(payload.byteLength);
		writer.u32(0);
		writer.bytes(payload);
		const frame = writer.finish();
		decodeCrdtExchangeFrameV1(frame);
		return frame;
	} catch (error) {
		throw wrap(error);
	}
}

export function decodeCrdtExchangeFrameV1(
	input: Uint8Array,
): CrdtExchangeFrameV1 {
	try {
		if (!(input instanceof Uint8Array) || input.byteLength < HEADER_BYTES) {
			throw rejected("Truncated CRDT exchange frame");
		}
		if (input.byteLength > CRDT_EXCHANGE_V1_MAX_BODY_BYTES) {
			throw rejected("CRDT exchange frame exceeds the maximum size");
		}
		const header = new CrdtBinaryReader(input.subarray(0, HEADER_BYTES));
		if (
			header.u8() !== MAGIC[0] ||
			header.u8() !== MAGIC[1] ||
			header.u8() !== MAGIC[2] ||
			header.u8() !== MAGIC[3]
		) {
			throw rejected("Invalid CRDT exchange magic");
		}
		if (header.u8() !== 1 || header.u8() !== 0) {
			throw rejected("Unsupported CRDT exchange version");
		}
		const opcode = header.u8();
		if (!ALL_OPCODES.has(opcode) || header.u8() !== 0) throw rejected();
		const requestId = checkedId(header.bytes(ID_BYTES), "requestId");
		const payloadLength = header.u32();
		if (header.u32() !== 0) throw rejected();
		header.done();
		if (
			payloadLength > MAX_PAYLOAD_BYTES ||
			input.byteLength !== HEADER_BYTES + payloadLength
		) {
			throw rejected("Invalid CRDT exchange payload length");
		}
		const payload = decodePayload(
			opcode,
			new CrdtBinaryReader(input.subarray(HEADER_BYTES)),
		);
		return {
			major: 1,
			minor: 0,
			opcode,
			requestId,
			payload,
		} as CrdtExchangeFrameV1;
	} catch (error) {
		throw wrap(error);
	}
}

function encodePayload(frame: CrdtExchangeFrameV1): Uint8Array {
	const writer = new CrdtBinaryWriter();
	switch (frame.opcode) {
		case 0x01:
			writeSession(writer, frame.payload);
			writer.bytes(checkedId(frame.payload.pullId, "pullId"), ID_BYTES);
			writer.u32(frame.payload.schemaVersion);
			writeContinuation(writer, frame.payload.continuation);
			writeProofs(writer, frame.payload.proofs, frame.payload.continuation);
			break;
		case 0x02:
			writeSession(writer, frame.payload);
			writer.bytes(checkedId(frame.payload.updateId, "updateId"), ID_BYTES);
			writer.u64(frame.payload.aggregateEpoch);
			writer.u32(frame.payload.schemaVersion);
			writeAppendParts(writer, frame.payload.parts);
			break;
		case 0x03:
			writeSession(writer, frame.payload);
			writeReceiptQueries(writer, frame.payload.receipts);
			break;
		case 0x04:
			writeSession(writer, frame.payload);
			switch (frame.payload.action) {
				case "write":
					writer.u8(1);
					writeJson(writer, frame.payload.value, MAX_AWARENESS_BYTES);
					break;
				case "clear":
					writer.u8(2);
					break;
				case "roster":
					writer.u8(3);
					break;
				default:
					throw rejected();
			}
			break;
		case 0x05:
		case 0x06:
			writeSession(writer, frame.payload);
			break;
		case 0x81:
			if (typeof frame.payload.complete !== "boolean") throw rejected();
			writer.bytes(checkedId(frame.payload.pullId, "pullId"), ID_BYTES);
			writer.u64(frame.payload.aggregateEpoch);
			writer.u32(frame.payload.schemaVersion);
			writer.bytes(
				checkedHash(frame.payload.artifactDigest, "artifactDigest"),
				HASH_BYTES,
			);
			writer.u8(frame.payload.complete ? 1 : 0);
			writeContinuation(writer, frame.payload.continuation);
			if (frame.payload.complete === (frame.payload.continuation !== null)) {
				throw rejected("Pull completion and continuation disagree");
			}
			writePullFields(writer, frame.payload.fields);
			writePullChunks(writer, frame.payload.chunks);
			break;
		case 0x82:
			writeAppendReceipt(writer, frame.payload);
			break;
		case 0x83:
			if (frame.payload.receipts.length > MAX_RECEIPTS) throw rejected();
			assertUniqueIds(frame.payload.receipts);
			writer.u16(frame.payload.receipts.length);
			for (const receipt of frame.payload.receipts) {
				writeAppendReceipt(writer, receipt);
			}
			break;
		case 0x84:
			writeJson(writer, frame.payload.value, MAX_ROSTER_BYTES);
			break;
		case 0x85:
			writer.u64(frame.payload.serverTimeMs);
			break;
		case 0x86:
			break;
		case 0xfe:
			if (
				!Number.isSafeInteger(frame.payload.retryAfterMs) ||
				frame.payload.retryAfterMs < 1 ||
				frame.payload.retryAfterMs > 5_000
			) {
				throw rejected();
			}
			writer.u32(frame.payload.retryAfterMs);
			break;
		case 0xff:
			if (frame.payload.action !== 1) throw rejected();
			writer.u8(1);
			break;
		default:
			throw rejected();
	}
	return writer.finish();
}

function decodePayload(
	opcode: number,
	reader: CrdtBinaryReader,
): CrdtExchangeFrameV1["payload"] {
	let payload: CrdtExchangeFrameV1["payload"];
	switch (opcode) {
		case 0x01: {
			const session = readSession(reader);
			const pullId = checkedId(reader.bytes(ID_BYTES), "pullId");
			const schemaVersion = reader.u32();
			const continuation = readContinuation(reader);
			const proofs = readProofs(reader);
			if (continuation !== null && proofs.length !== 0) {
				throw rejected("Continuation pulls cannot include proofs");
			}
			payload = { ...session, pullId, schemaVersion, continuation, proofs };
			break;
		}
		case 0x02:
			payload = {
				...readSession(reader),
				updateId: checkedId(reader.bytes(ID_BYTES), "updateId"),
				aggregateEpoch: reader.u64(),
				schemaVersion: reader.u32(),
				parts: readAppendParts(reader),
			};
			break;
		case 0x03:
			payload = {
				...readSession(reader),
				receipts: readReceiptQueries(reader),
			};
			break;
		case 0x04: {
			const session = readSession(reader);
			const action = reader.u8();
			if (action === 1) {
				payload = {
					...session,
					action: "write",
					value: readJson(reader, MAX_AWARENESS_BYTES),
				};
			} else if (action === 2) {
				payload = { ...session, action: "clear" };
			} else if (action === 3) {
				payload = { ...session, action: "roster" };
			} else {
				throw rejected();
			}
			break;
		}
		case 0x05:
		case 0x06:
			payload = readSession(reader);
			break;
		case 0x81: {
			const pullId = checkedId(reader.bytes(ID_BYTES), "pullId");
			const aggregateEpoch = reader.u64();
			const schemaVersion = reader.u32();
			const artifactDigest = checkedHash(
				reader.bytes(HASH_BYTES),
				"artifactDigest",
			);
			const completeValue = reader.u8();
			if (completeValue !== 0 && completeValue !== 1) throw rejected();
			const complete = completeValue === 1;
			const continuation = readContinuation(reader);
			if (complete === (continuation !== null)) {
				throw rejected("Pull completion and continuation disagree");
			}
			payload = {
				pullId,
				aggregateEpoch,
				schemaVersion,
				artifactDigest,
				complete,
				continuation,
				fields: readPullFields(reader),
				chunks: readPullChunks(reader),
			};
			break;
		}
		case 0x82:
			payload = readAppendReceipt(reader);
			break;
		case 0x83: {
			const count = reader.u16();
			assertCount(count, MAX_RECEIPTS, reader, 26);
			const receipts = Array.from({ length: count }, () =>
				readAppendReceipt(reader),
			);
			assertUniqueIds(receipts);
			payload = {
				receipts,
			};
			break;
		}
		case 0x84:
			payload = { value: readJson(reader, MAX_ROSTER_BYTES) };
			break;
		case 0x85:
			payload = { serverTimeMs: reader.u64() };
			break;
		case 0x86:
			payload = {};
			break;
		case 0xfe: {
			const retryAfterMs = reader.u32();
			if (retryAfterMs < 1 || retryAfterMs > 5_000) throw rejected();
			payload = { retryAfterMs };
			break;
		}
		case 0xff: {
			const action = reader.u8();
			if (action !== 1) throw rejected();
			payload = { action };
			break;
		}
		default:
			throw rejected();
	}
	reader.done();
	return payload;
}

function writeSession(
	writer: CrdtBinaryWriter,
	payload: CrdtExchangeSessionPayload,
): void {
	writer.bytes(checkedId(payload.bindingId, "bindingId"), ID_BYTES);
	writer.u64(payload.sessionGeneration);
	writer.u64(payload.deliveryGeneration);
}

function readSession(reader: CrdtBinaryReader): CrdtExchangeSessionPayload {
	return {
		bindingId: checkedId(reader.bytes(ID_BYTES), "bindingId"),
		sessionGeneration: reader.u64(),
		deliveryGeneration: reader.u64(),
	};
}

function writeProofs(
	writer: CrdtBinaryWriter,
	proofs: readonly CrdtExchangePullProofV1[],
	continuation: string | null,
): void {
	if (
		proofs.length > MAX_FIELDS ||
		(continuation !== null && proofs.length !== 0)
	) {
		throw rejected();
	}
	assertSortedFieldSlots(proofs);
	writer.u16(proofs.length);
	for (const proof of proofs) {
		if (proof.proof.byteLength > MAX_PROOF_BYTES) throw rejected();
		writer.u16(proof.fieldSlot);
		writer.u64(proof.fieldEpoch);
		writer.u32(proof.proof.byteLength);
		writer.bytes(proof.proof);
	}
}

function readProofs(reader: CrdtBinaryReader): CrdtExchangePullProofV1[] {
	const count = reader.u16();
	assertCount(count, MAX_FIELDS, reader, 14);
	const proofs = Array.from({ length: count }, () => {
		const fieldSlot = reader.u16();
		const fieldEpoch = reader.u64();
		const length = reader.u32();
		return {
			fieldSlot,
			fieldEpoch,
			proof: reader.bytes(length, MAX_PROOF_BYTES),
		};
	});
	assertSortedFieldSlots(proofs);
	return proofs;
}

function writeAppendParts(
	writer: CrdtBinaryWriter,
	parts: readonly CrdtExchangeAppendPartV1[],
): void {
	if (parts.length === 0 || parts.length > MAX_FIELDS) throw rejected();
	assertSortedFieldSlots(parts, false);
	writer.u16(parts.length);
	for (const part of parts) {
		if (
			part.bytes.byteLength === 0 ||
			part.bytes.byteLength > MAX_FIELD_BYTES
		) {
			throw rejected();
		}
		writer.u16(part.fieldSlot);
		writer.u64(part.fieldEpoch);
		writer.u16(part.formatVersion);
		writer.u64(part.baseFieldCursor);
		writer.u32(part.bytes.byteLength);
		writer.bytes(part.bytes);
	}
}

function readAppendParts(reader: CrdtBinaryReader): CrdtExchangeAppendPartV1[] {
	const count = reader.u16();
	assertCount(count, MAX_FIELDS, reader, 24);
	if (count === 0) throw rejected();
	const parts = Array.from({ length: count }, () => {
		const fieldSlot = reader.u16();
		const fieldEpoch = reader.u64();
		const formatVersion = reader.u16();
		const baseFieldCursor = reader.u64();
		const length = reader.u32();
		if (length === 0) throw rejected();
		return {
			fieldSlot,
			fieldEpoch,
			formatVersion,
			baseFieldCursor,
			bytes: reader.bytes(length, MAX_FIELD_BYTES),
		};
	});
	assertSortedFieldSlots(parts, false);
	return parts;
}

function writeReceiptQueries(
	writer: CrdtBinaryWriter,
	receipts: readonly CrdtExchangeReceiptQueryV1[],
): void {
	if (receipts.length > MAX_RECEIPTS) throw rejected();
	assertUniqueIds(receipts);
	writer.u16(receipts.length);
	for (const receipt of receipts) {
		writer.bytes(checkedId(receipt.updateId, "updateId"), ID_BYTES);
		writer.bytes(
			checkedHash(receipt.submittedHash, "submittedHash"),
			HASH_BYTES,
		);
		writer.u64(receipt.aggregateEpoch);
		writer.u32(receipt.schemaVersion);
	}
}

function readReceiptQueries(
	reader: CrdtBinaryReader,
): CrdtExchangeReceiptQueryV1[] {
	const count = reader.u16();
	assertCount(count, MAX_RECEIPTS, reader, 60);
	const receipts = Array.from({ length: count }, () => ({
		updateId: checkedId(reader.bytes(ID_BYTES), "updateId"),
		submittedHash: checkedHash(reader.bytes(HASH_BYTES), "submittedHash"),
		aggregateEpoch: reader.u64(),
		schemaVersion: reader.u32(),
	}));
	assertUniqueIds(receipts);
	return receipts;
}

function writePullFields(
	writer: CrdtBinaryWriter,
	fields: readonly CrdtExchangePullFieldV1[],
): void {
	if (fields.length > MAX_FIELDS) throw rejected();
	assertSortedFieldSlots(fields);
	writer.u16(fields.length);
	for (const field of fields) {
		if (field.grant !== 0 && field.grant !== 1) throw rejected();
		writer.u16(field.fieldSlot);
		writer.u8(field.grant);
		writer.u64(field.fieldEpoch);
		writer.u16(field.formatVersion);
		writer.u64(field.fieldCursor);
		writer.u32(field.byteLength);
		writer.bytes(checkedHash(field.digest, "digest"), HASH_BYTES);
	}
}

function readPullFields(reader: CrdtBinaryReader): CrdtExchangePullFieldV1[] {
	const count = reader.u16();
	assertCount(count, MAX_FIELDS, reader, 57);
	const fields = Array.from({ length: count }, () => {
		const fieldSlot = reader.u16();
		const grant = reader.u8();
		if (grant !== 0 && grant !== 1) throw rejected();
		return {
			fieldSlot,
			grant,
			fieldEpoch: reader.u64(),
			formatVersion: reader.u16(),
			fieldCursor: reader.u64(),
			byteLength: reader.u32(),
			digest: checkedHash(reader.bytes(HASH_BYTES), "digest"),
		} as const;
	});
	assertSortedFieldSlots(fields);
	return fields;
}

function writePullChunks(
	writer: CrdtBinaryWriter,
	chunks: readonly CrdtExchangePullChunkV1[],
): void {
	if (chunks.length > 0xffff) throw rejected();
	writer.u16(chunks.length);
	let previousChunkIndex = -1;
	for (const chunk of chunks) {
		if (
			typeof chunk.final !== "boolean" ||
			chunk.chunkIndex <= previousChunkIndex ||
			chunk.bytes.byteLength > MAX_FIELD_BYTES
		) {
			throw rejected();
		}
		previousChunkIndex = chunk.chunkIndex;
		writer.u16(checkedFieldSlot(chunk.fieldSlot));
		writer.u64(chunk.fieldEpoch);
		writer.u16(chunk.formatVersion);
		writer.u64(chunk.throughFieldCursor);
		writer.u32(chunk.chunkIndex);
		writer.u32(chunk.offset);
		writer.u8(chunk.final ? 1 : 0);
		writer.u32(chunk.bytes.byteLength);
		writer.bytes(chunk.bytes);
	}
}

function readPullChunks(reader: CrdtBinaryReader): CrdtExchangePullChunkV1[] {
	const count = reader.u16();
	assertCount(count, 0xffff, reader, 33);
	const chunks: CrdtExchangePullChunkV1[] = [];
	let previousChunkIndex = -1;
	for (let index = 0; index < count; index++) {
		const fieldSlot = checkedFieldSlot(reader.u16());
		const fieldEpoch = reader.u64();
		const formatVersion = reader.u16();
		const throughFieldCursor = reader.u64();
		const chunkIndex = reader.u32();
		const offset = reader.u32();
		const finalValue = reader.u8();
		if (
			chunkIndex <= previousChunkIndex ||
			(finalValue !== 0 && finalValue !== 1)
		) {
			throw rejected();
		}
		previousChunkIndex = chunkIndex;
		const length = reader.u32();
		chunks.push({
			fieldSlot,
			fieldEpoch,
			formatVersion,
			throughFieldCursor,
			chunkIndex,
			offset,
			final: finalValue === 1,
			bytes: reader.bytes(length, MAX_FIELD_BYTES),
		});
	}
	return chunks;
}

function writeAppendReceipt(
	writer: CrdtBinaryWriter,
	receipt: CrdtExchangeAppendReceiptV1,
): void {
	writer.bytes(checkedId(receipt.updateId, "updateId"), ID_BYTES);
	writer.u64(receipt.aggregateEpoch);
	writeCursors(writer, receipt.cursors);
}

function readAppendReceipt(
	reader: CrdtBinaryReader,
): CrdtExchangeAppendReceiptV1 {
	return {
		updateId: checkedId(reader.bytes(ID_BYTES), "updateId"),
		aggregateEpoch: reader.u64(),
		cursors: readCursors(reader),
	};
}

function writeCursors(
	writer: CrdtBinaryWriter,
	cursors: CrdtExchangeAppendReceiptV1["cursors"],
): void {
	if (cursors.length > MAX_FIELDS) throw rejected();
	assertSortedFieldSlots(cursors);
	writer.u16(cursors.length);
	for (const cursor of cursors) {
		writer.u16(cursor.fieldSlot);
		writer.u64(cursor.fieldCursor);
	}
}

function readCursors(
	reader: CrdtBinaryReader,
): Array<{ fieldSlot: number; fieldCursor: bigint }> {
	const count = reader.u16();
	assertCount(count, MAX_FIELDS, reader, 10);
	const cursors = Array.from({ length: count }, () => ({
		fieldSlot: reader.u16(),
		fieldCursor: reader.u64(),
	}));
	assertSortedFieldSlots(cursors);
	return cursors;
}

function writeContinuation(
	writer: CrdtBinaryWriter,
	continuation: string | null,
): void {
	if (continuation === null) {
		writer.u16(0);
		return;
	}
	if (!/^[A-Za-z0-9_-]+$/.test(continuation)) throw rejected();
	const bytes = new TextEncoder().encode(continuation);
	if (bytes.byteLength !== CONTINUATION_BYTES) {
		throw rejected();
	}
	writer.u16(bytes.byteLength);
	writer.bytes(bytes);
}

function readContinuation(reader: CrdtBinaryReader): string | null {
	const length = reader.u16();
	if (length === 0) return null;
	if (length !== CONTINUATION_BYTES) throw rejected();
	const bytes = reader.bytes(length, CONTINUATION_BYTES);
	if (bytes.some((byte) => byte > 0x7f)) throw rejected();
	const value = new TextDecoder().decode(bytes);
	if (!/^[A-Za-z0-9_-]+$/.test(value)) throw rejected();
	return value;
}

function writeJson(
	writer: CrdtBinaryWriter,
	value: unknown,
	maximumBytes: number,
): void {
	const bytes = new TextEncoder().encode(canonicalCrdtJson(value));
	if (bytes.byteLength > maximumBytes) throw rejected();
	writer.u32(bytes.byteLength);
	writer.bytes(bytes);
}

function readJson(reader: CrdtBinaryReader, maximumBytes: number): unknown {
	const length = reader.u32();
	const bytes = reader.bytes(length, maximumBytes);
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw rejected();
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw rejected();
	}
	if (canonicalCrdtJson(value) !== text) throw rejected();
	return value;
}

function checkedId(value: Uint8Array, label: string): Uint8Array {
	if (
		!(value instanceof Uint8Array) ||
		value.byteLength !== ID_BYTES ||
		value.every((byte) => byte === 0)
	) {
		throw rejected(`${label} must be a nonzero 16-byte value`);
	}
	return value;
}

function checkedHash(value: Uint8Array, label: string): Uint8Array {
	if (!(value instanceof Uint8Array) || value.byteLength !== HASH_BYTES) {
		throw rejected(`${label} must be a 32-byte value`);
	}
	return value;
}

function checkedFieldSlot(value: number): number {
	if (!Number.isInteger(value) || value < 1 || value > 0xffff) {
		throw rejected("fieldSlot must be between 1 and 65535");
	}
	return value;
}

function assertSortedFieldSlots(
	values: readonly { fieldSlot: number }[],
	allowEmpty = true,
): void {
	if (!allowEmpty && values.length === 0) throw rejected();
	let previous = 0;
	for (const value of values) {
		if (
			!Number.isInteger(value.fieldSlot) ||
			value.fieldSlot < 1 ||
			value.fieldSlot > 0xffff ||
			value.fieldSlot <= previous
		) {
			throw rejected("Field slots must be strictly increasing");
		}
		previous = value.fieldSlot;
	}
}

function assertUniqueIds(values: readonly { updateId: Uint8Array }[]): void {
	const ids = new Set<string>();
	for (const value of values) {
		const key = [...checkedId(value.updateId, "updateId")]
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join("");
		if (ids.has(key)) throw rejected("Duplicate updateId");
		ids.add(key);
	}
}

function assertCount(
	count: number,
	maximum: number,
	reader: CrdtBinaryReader,
	minimumEntryBytes: number,
): void {
	if (count > maximum || count * minimumEntryBytes > reader.remaining) {
		throw rejected("Invalid repeated payload count");
	}
}

function rejected(message?: string): CrdtExchangeProtocolError {
	return new CrdtExchangeProtocolError(message);
}

function wrap(error: unknown): CrdtExchangeProtocolError {
	return error instanceof CrdtExchangeProtocolError
		? error
		: new CrdtExchangeProtocolError(undefined, { cause: error });
}
