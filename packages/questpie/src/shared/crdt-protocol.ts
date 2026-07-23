const HEADER_BYTES = 32;
const MAX_BUNDLE_BYTES = 1024 * 1024;
const MAX_FIELD_BYTES = 256 * 1024;
const MAX_PROOF_BYTES = 64 * 1024;
const MAX_AWARENESS_BYTES = 1024;
const MAX_FIELDS = 32;
const MAX_RECEIPTS = 64;
const MAX_U64 = (1n << 64n) - 1n;

export const CRDT_PROTOCOL_V1_MAX_FRAME_BYTES = HEADER_BYTES + MAX_BUNDLE_BYTES;

export type CrdtProtocolDirection = "client-to-server" | "server-to-client";

export type CrdtProtocolState =
	| "unauthenticated"
	| "syncing"
	| "ready"
	| "field-syncing"
	| "suspended"
	| "closed";

export type CrdtFieldCursor = {
	fieldSlot: number;
	fieldCursor: bigint;
};

export type CrdtFrameV1 =
	| CrdtFrame<0x01, { ticket: string }>
	| CrdtFrame<
			0x02,
			{
				schemaVersion: number;
				parts: Array<{
					fieldSlot: number;
					fieldEpoch: bigint;
					proof: Uint8Array;
				}>;
			}
	  >
	| CrdtFrame<
			0x03,
			{
				chunkIndex: number;
				fieldSlot: number;
				throughFieldCursor: bigint;
			}
	  >
	| CrdtFrame<
			0x04,
			{
				updateId: Uint8Array;
				aggregateEpoch: bigint;
				schemaVersion: number;
				parts: Array<{
					fieldSlot: number;
					fieldEpoch: bigint;
					formatVersion: number;
					baseFieldCursor: bigint;
					bytes: Uint8Array;
				}>;
			}
	  >
	| CrdtFrame<0x05, { value: unknown }>
	| CrdtFrame<0x06, Record<string, never>>
	| CrdtFrame<0x07, Record<string, never>>
	| CrdtFrame<
			0x08,
			{
				receipts: Array<{
					updateId: Uint8Array;
					submittedHash: Uint8Array;
					aggregateEpoch: bigint;
					schemaVersion: number;
				}>;
			}
	  >
	| CrdtFrame<
			0x81,
			{
				aggregateEpoch: bigint;
				schemaVersion: number;
				grants: Array<{
					fieldSlot: number;
					grant: 0 | 1;
					fieldEpoch: bigint;
					headFieldCursor: bigint;
				}>;
			}
	  >
	| CrdtFrame<
			0x82,
			{
				chunkIndex: number;
				fieldSlot: number;
				fieldEpoch: bigint;
				throughFieldCursor: bigint;
				final: boolean;
				bytes: Uint8Array;
			}
	  >
	| CrdtFrame<
			0x83,
			{
				commitId: Uint8Array;
				aggregateEpoch: bigint;
				parts: Array<{
					fieldSlot: number;
					fieldEpoch: bigint;
					formatVersion: number;
					fieldCursor: bigint;
					bytes: Uint8Array;
				}>;
			}
	  >
	| CrdtFrame<
			0x84,
			{
				updateId: Uint8Array;
				aggregateEpoch: bigint;
				cursors: CrdtFieldCursor[];
			}
	  >
	| CrdtFrame<0x85, { value: unknown }>
	| CrdtFrame<
			0x86,
			{
				schemaVersion: number;
				transitions: Array<{
					fieldSlot: number;
					action: 0 | 1 | 2;
					grant: 0 | 1;
					fieldEpoch: bigint;
					headFieldCursor: bigint;
				}>;
			}
	  >
	| CrdtFrame<
			0x87,
			{
				code: 1 | 2 | 3 | 4 | 5 | 6;
				retryable: boolean;
				retryAfterMs: number;
				correlationId: Uint8Array;
			}
	  >
	| CrdtFrame<0x88, { serverTimeMs: bigint }>
	| CrdtFrame<0x89, { aggregateEpoch: bigint; schemaVersion: number }>
	| CrdtFrame<0x8a, { reason: 1 | 2 | 3 }>
	| CrdtFrame<
			0x8b,
			{
				receipts: Array<{
					updateId: Uint8Array;
					aggregateEpoch: bigint;
					cursors: CrdtFieldCursor[];
				}>;
			}
	  >;

type CrdtFrame<TOpcode extends number, TPayload> = {
	major: 1;
	minor: 0;
	opcode: TOpcode;
	connectionSeq: bigint;
	requestId: bigint;
	payload: TPayload;
};

const CLIENT_OPCODES = new Set([1, 2, 3, 4, 5, 6, 7, 8]);
const SERVER_OPCODES = new Set([
	0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b,
]);
const ALL_OPCODES = new Set([...CLIENT_OPCODES, ...SERVER_OPCODES]);

export class CrdtProtocolError extends Error {
	readonly closeCode: 1002 | 1008 | 1009 | 1011;

	constructor(reason: string, closeCode: 1002 | 1008 | 1009 | 1011 = 1002) {
		super(reason);
		this.name = "CrdtProtocolError";
		this.closeCode = closeCode;
	}
}

class Reader {
	private offset = 0;
	private readonly view: DataView;

	constructor(private readonly input: Uint8Array) {
		this.view = new DataView(input.buffer, input.byteOffset, input.byteLength);
	}

	get remaining(): number {
		return this.input.byteLength - this.offset;
	}

	u8(): number {
		this.require(1);
		return this.view.getUint8(this.offset++);
	}

	u16(): number {
		this.require(2);
		const value = this.view.getUint16(this.offset);
		this.offset += 2;
		return value;
	}

	u32(): number {
		this.require(4);
		const value = this.view.getUint32(this.offset);
		this.offset += 4;
		return value;
	}

	u64(): bigint {
		this.require(8);
		const value = this.view.getBigUint64(this.offset);
		this.offset += 8;
		return value;
	}

	bytes(length: number, maximum = length): Uint8Array {
		if (!Number.isSafeInteger(length) || length < 0 || length > maximum) {
			throw new CrdtProtocolError("invalid length", 1009);
		}
		this.require(length);
		const value = this.input.subarray(this.offset, this.offset + length);
		this.offset += length;
		return value;
	}

	done(): void {
		if (this.remaining !== 0) {
			throw new CrdtProtocolError("trailing payload bytes");
		}
	}

	private require(length: number): void {
		if (length > this.remaining) {
			throw new CrdtProtocolError("truncated frame");
		}
	}
}

class Writer {
	private readonly chunks: Uint8Array[] = [];
	private length = 0;

	u8(value: number): void {
		assertInteger(value, 0xff, "u8");
		this.push(Uint8Array.of(value));
	}

	u16(value: number): void {
		assertInteger(value, 0xffff, "u16");
		const bytes = new Uint8Array(2);
		new DataView(bytes.buffer).setUint16(0, value);
		this.push(bytes);
	}

	u32(value: number): void {
		assertInteger(value, 0xffffffff, "u32");
		const bytes = new Uint8Array(4);
		new DataView(bytes.buffer).setUint32(0, value);
		this.push(bytes);
	}

	u64(value: bigint): void {
		if (typeof value !== "bigint" || value < 0n || value > MAX_U64) {
			throw new CrdtProtocolError("invalid u64");
		}
		const bytes = new Uint8Array(8);
		new DataView(bytes.buffer).setBigUint64(0, value);
		this.push(bytes);
	}

	bytes(value: Uint8Array, length?: number): void {
		if (!(value instanceof Uint8Array)) {
			throw new CrdtProtocolError("expected bytes");
		}
		if (length !== undefined && value.byteLength !== length) {
			throw new CrdtProtocolError("invalid fixed byte length");
		}
		this.push(value);
	}

	finish(): Uint8Array {
		const output = new Uint8Array(this.length);
		let offset = 0;
		for (const chunk of this.chunks) {
			output.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return output;
	}

	private push(value: Uint8Array): void {
		this.chunks.push(value);
		this.length += value.byteLength;
	}
}

function assertInteger(value: number, maximum: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
		throw new CrdtProtocolError(`invalid ${label}`);
	}
}

function assertCount(
	count: number,
	maximum: number,
	reader: Reader,
	minimumEntryBytes: number,
): void {
	if (count > maximum || count * minimumEntryBytes > reader.remaining) {
		throw new CrdtProtocolError("invalid repeated payload count");
	}
}

function assertSortedFieldSlots(
	values: ReadonlyArray<{ fieldSlot: number }>,
	allowEmpty = true,
): void {
	if (!allowEmpty && values.length === 0) {
		throw new CrdtProtocolError("field parts must be nonempty");
	}
	let previous = -1;
	for (const value of values) {
		assertInteger(value.fieldSlot, 0xffff, "field slot");
		if (value.fieldSlot <= previous) {
			throw new CrdtProtocolError("field slots must be strictly increasing");
		}
		previous = value.fieldSlot;
	}
}

function readFieldCursors(reader: Reader): CrdtFieldCursor[] {
	const count = reader.u16();
	assertCount(count, MAX_FIELDS, reader, 10);
	const cursors = Array.from({ length: count }, () => ({
		fieldSlot: reader.u16(),
		fieldCursor: reader.u64(),
	}));
	assertSortedFieldSlots(cursors);
	return cursors;
}

function writeFieldCursors(
	writer: Writer,
	cursors: ReadonlyArray<CrdtFieldCursor>,
): void {
	if (cursors.length > MAX_FIELDS) {
		throw new CrdtProtocolError("too many cursors", 1009);
	}
	assertSortedFieldSlots(cursors);
	writer.u16(cursors.length);
	for (const cursor of cursors) {
		writer.u16(cursor.fieldSlot);
		writer.u64(cursor.fieldCursor);
	}
}

function readAwareness(reader: Reader): { value: unknown } {
	const length = reader.u32();
	const value = reader.bytes(length, MAX_AWARENESS_BYTES);
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(value);
	} catch {
		throw new CrdtProtocolError("invalid awareness UTF-8");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new CrdtProtocolError("invalid awareness JSON");
	}
	if (canonicalJson(parsed) !== text) {
		throw new CrdtProtocolError("noncanonical awareness JSON");
	}
	return { value: parsed };
}

function writeAwareness(writer: Writer, value: unknown): void {
	const bytes = new TextEncoder().encode(canonicalJson(value));
	if (bytes.byteLength > MAX_AWARENESS_BYTES) {
		throw new CrdtProtocolError("awareness exceeds limit", 1009);
	}
	writer.u32(bytes.byteLength);
	writer.bytes(bytes);
}

function canonicalJson(
	value: unknown,
	ancestors: Set<object> = new Set(),
): string {
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "string"
	) {
		if (typeof value === "string" && hasUnpairedSurrogate(value)) {
			throw new CrdtProtocolError("invalid awareness string");
		}
		return JSON.stringify(value);
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new CrdtProtocolError("invalid awareness number");
		}
		return JSON.stringify(value);
	}
	if (typeof value !== "object") {
		throw new CrdtProtocolError("invalid awareness value");
	}
	if (ancestors.has(value)) {
		throw new CrdtProtocolError("cyclic awareness value");
	}
	ancestors.add(value);
	let result: string;
	if (Array.isArray(value)) {
		const items: string[] = [];
		for (let index = 0; index < value.length; index++) {
			if (!Object.hasOwn(value, index)) {
				throw new CrdtProtocolError("sparse awareness array");
			}
			items.push(canonicalJson(value[index], ancestors));
		}
		result = `[${items.join(",")}]`;
	} else {
		const object = value as Record<string, unknown>;
		const keys = Object.keys(object).sort();
		for (const key of keys) {
			if (
				hasUnpairedSurrogate(key) ||
				object[key] === undefined ||
				typeof object[key] === "function" ||
				typeof object[key] === "symbol"
			) {
				throw new CrdtProtocolError("invalid awareness object");
			}
		}
		result = `{${keys
			.map(
				(key) =>
					`${JSON.stringify(key)}:${canonicalJson(object[key], ancestors)}`,
			)
			.join(",")}}`;
	}
	ancestors.delete(value);
	return result;
}

function hasUnpairedSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (next < 0xdc00 || next > 0xdfff) return true;
			index++;
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			return true;
		}
	}
	return false;
}

function payloadLimit(opcode: number): number {
	switch (opcode) {
		case 0x01:
			return 512;
		case 0x05:
		case 0x85:
			return MAX_AWARENESS_BYTES + 4;
		case 0x04:
		case 0x83:
			return MAX_BUNDLE_BYTES;
		case 0x82:
			return MAX_FIELD_BYTES + 27;
		case 0x02:
			return MAX_FIELDS * (14 + MAX_PROOF_BYTES) + 6;
		default:
			return 8 * 1024;
	}
}

export function decodeCrdtFrameV1(input: Uint8Array): CrdtFrameV1 {
	if (!(input instanceof Uint8Array)) {
		throw new CrdtProtocolError("expected binary frame");
	}
	if (input.byteLength < HEADER_BYTES) {
		throw new CrdtProtocolError("truncated frame");
	}
	if (input.byteLength > CRDT_PROTOCOL_V1_MAX_FRAME_BYTES) {
		throw new CrdtProtocolError("frame exceeds limit", 1009);
	}
	const header = new Reader(input.subarray(0, HEADER_BYTES));
	if (
		header.u8() !== 0x51 ||
		header.u8() !== 0x50 ||
		header.u8() !== 0x43 ||
		header.u8() !== 0x52
	) {
		throw new CrdtProtocolError("invalid protocol magic");
	}
	if (header.u8() !== 1 || header.u8() !== 0) {
		throw new CrdtProtocolError("unsupported protocol version");
	}
	const opcode = header.u8();
	if (!ALL_OPCODES.has(opcode)) {
		throw new CrdtProtocolError("unknown opcode");
	}
	if (header.u8() !== 0) {
		throw new CrdtProtocolError("unknown frame flags");
	}
	const connectionSeq = header.u64();
	const requestId = header.u64();
	const payloadLength = header.u32();
	if (header.u32() !== 0) {
		throw new CrdtProtocolError("reserved header bytes are nonzero");
	}
	if (
		payloadLength > payloadLimit(opcode) ||
		payloadLength > MAX_BUNDLE_BYTES
	) {
		throw new CrdtProtocolError("payload exceeds limit", 1009);
	}
	if (input.byteLength !== HEADER_BYTES + payloadLength) {
		throw new CrdtProtocolError("frame boundary mismatch");
	}
	const payload = decodePayload(
		opcode,
		new Reader(input.subarray(HEADER_BYTES)),
	);
	return {
		major: 1,
		minor: 0,
		opcode,
		connectionSeq,
		requestId,
		payload,
	} as CrdtFrameV1;
}

function decodePayload(opcode: number, reader: Reader): CrdtFrameV1["payload"] {
	let payload: CrdtFrameV1["payload"];
	switch (opcode) {
		case 0x01: {
			const length = reader.u16();
			if (length === 0 || length > 256) {
				throw new CrdtProtocolError("invalid ticket length", 1009);
			}
			const value = reader.bytes(length, 256);
			if (value.some((byte) => byte > 0x7f)) {
				throw new CrdtProtocolError("ticket must be ASCII");
			}
			const ticket = new TextDecoder().decode(value);
			if (!/^[A-Za-z0-9_-]+$/.test(ticket)) {
				throw new CrdtProtocolError("ticket must be base64url");
			}
			payload = { ticket };
			break;
		}
		case 0x02: {
			const schemaVersion = reader.u32();
			const count = reader.u16();
			assertCount(count, MAX_FIELDS, reader, 14);
			const parts = Array.from({ length: count }, () => {
				const fieldSlot = reader.u16();
				const fieldEpoch = reader.u64();
				const length = reader.u32();
				return {
					fieldSlot,
					fieldEpoch,
					proof: reader.bytes(length, MAX_PROOF_BYTES),
				};
			});
			assertSortedFieldSlots(parts);
			payload = { schemaVersion, parts };
			break;
		}
		case 0x03:
			payload = {
				chunkIndex: reader.u32(),
				fieldSlot: reader.u16(),
				throughFieldCursor: reader.u64(),
			};
			break;
		case 0x04: {
			const updateId = reader.bytes(16);
			const aggregateEpoch = reader.u64();
			const schemaVersion = reader.u32();
			const count = reader.u16();
			assertCount(count, MAX_FIELDS, reader, 25);
			const parts = Array.from({ length: count }, () => {
				const fieldSlot = reader.u16();
				const fieldEpoch = reader.u64();
				const formatVersion = reader.u16();
				const baseFieldCursor = reader.u64();
				const length = reader.u32();
				if (length === 0) {
					throw new CrdtProtocolError("field update must be nonempty");
				}
				return {
					fieldSlot,
					fieldEpoch,
					formatVersion,
					baseFieldCursor,
					bytes: reader.bytes(length, MAX_FIELD_BYTES),
				};
			});
			assertSortedFieldSlots(parts, false);
			payload = {
				updateId,
				aggregateEpoch,
				schemaVersion,
				parts,
			};
			break;
		}
		case 0x05:
		case 0x85:
			payload = readAwareness(reader);
			break;
		case 0x06:
		case 0x07:
			payload = {};
			break;
		case 0x08: {
			const count = reader.u16();
			assertCount(count, MAX_RECEIPTS, reader, 60);
			const receipts = Array.from({ length: count }, () => ({
				updateId: reader.bytes(16),
				submittedHash: reader.bytes(32),
				aggregateEpoch: reader.u64(),
				schemaVersion: reader.u32(),
			}));
			payload = { receipts };
			break;
		}
		case 0x81: {
			const aggregateEpoch = reader.u64();
			const schemaVersion = reader.u32();
			const count = reader.u16();
			assertCount(count, MAX_FIELDS, reader, 19);
			const grants = Array.from({ length: count }, () => {
				const fieldSlot = reader.u16();
				const grant = reader.u8();
				if (grant !== 0 && grant !== 1) {
					throw new CrdtProtocolError("invalid field grant");
				}
				return {
					fieldSlot,
					grant,
					fieldEpoch: reader.u64(),
					headFieldCursor: reader.u64(),
				} as const;
			});
			assertSortedFieldSlots(grants);
			payload = { aggregateEpoch, schemaVersion, grants };
			break;
		}
		case 0x82: {
			const chunkIndex = reader.u32();
			const fieldSlot = reader.u16();
			const fieldEpoch = reader.u64();
			const throughFieldCursor = reader.u64();
			const final = reader.u8();
			if (final !== 0 && final !== 1) {
				throw new CrdtProtocolError("invalid final marker");
			}
			const length = reader.u32();
			payload = {
				chunkIndex,
				fieldSlot,
				fieldEpoch,
				throughFieldCursor,
				final: final === 1,
				bytes: reader.bytes(length, MAX_FIELD_BYTES),
			};
			break;
		}
		case 0x83: {
			const commitId = reader.bytes(16);
			const aggregateEpoch = reader.u64();
			const count = reader.u16();
			assertCount(count, MAX_FIELDS, reader, 25);
			const parts = Array.from({ length: count }, () => {
				const fieldSlot = reader.u16();
				const fieldEpoch = reader.u64();
				const formatVersion = reader.u16();
				const fieldCursor = reader.u64();
				const length = reader.u32();
				if (length === 0) {
					throw new CrdtProtocolError("field update must be nonempty");
				}
				return {
					fieldSlot,
					fieldEpoch,
					formatVersion,
					fieldCursor,
					bytes: reader.bytes(length, MAX_FIELD_BYTES),
				};
			});
			assertSortedFieldSlots(parts, false);
			payload = { commitId, aggregateEpoch, parts };
			break;
		}
		case 0x84:
			payload = {
				updateId: reader.bytes(16),
				aggregateEpoch: reader.u64(),
				cursors: readFieldCursors(reader),
			};
			break;
		case 0x86: {
			const schemaVersion = reader.u32();
			const count = reader.u16();
			assertCount(count, MAX_FIELDS, reader, 20);
			const transitions = Array.from({ length: count }, () => {
				const fieldSlot = reader.u16();
				const action = reader.u8();
				const grant = reader.u8();
				if (
					(action !== 0 && action !== 1 && action !== 2) ||
					(grant !== 0 && grant !== 1)
				) {
					throw new CrdtProtocolError("invalid field transition");
				}
				const fieldEpoch = reader.u64();
				const headFieldCursor = reader.u64();
				if (
					(action === 1 &&
						(grant !== 0 || fieldEpoch !== 0n || headFieldCursor !== 0n)) ||
					(action === 2 && grant !== 0)
				) {
					throw new CrdtProtocolError("noncanonical field transition");
				}
				return {
					fieldSlot,
					action,
					grant,
					fieldEpoch,
					headFieldCursor,
				} as const;
			});
			assertSortedFieldSlots(transitions);
			payload = { schemaVersion, transitions };
			break;
		}
		case 0x87: {
			const code = reader.u16();
			const retryable = reader.u8();
			if (code < 1 || code > 6 || (retryable !== 0 && retryable !== 1)) {
				throw new CrdtProtocolError("invalid error payload");
			}
			payload = {
				code: code as 1 | 2 | 3 | 4 | 5 | 6,
				retryable: retryable === 1,
				retryAfterMs: reader.u32(),
				correlationId: reader.bytes(16),
			};
			break;
		}
		case 0x88:
			payload = { serverTimeMs: reader.u64() };
			break;
		case 0x89:
			payload = {
				aggregateEpoch: reader.u64(),
				schemaVersion: reader.u32(),
			};
			break;
		case 0x8a: {
			const reason = reader.u8();
			if (reason < 1 || reason > 3) {
				throw new CrdtProtocolError("invalid suspension reason");
			}
			payload = { reason: reason as 1 | 2 | 3 };
			break;
		}
		case 0x8b: {
			const count = reader.u16();
			assertCount(count, MAX_RECEIPTS, reader, 26);
			const receipts = Array.from({ length: count }, () => ({
				updateId: reader.bytes(16),
				aggregateEpoch: reader.u64(),
				cursors: readFieldCursors(reader),
			}));
			payload = { receipts };
			break;
		}
		default:
			throw new CrdtProtocolError("unknown opcode");
	}
	reader.done();
	return payload;
}

export function encodeCrdtFrameV1(frame: CrdtFrameV1): Uint8Array {
	if (
		frame.major !== 1 ||
		frame.minor !== 0 ||
		!ALL_OPCODES.has(frame.opcode)
	) {
		throw new CrdtProtocolError("invalid frame header");
	}
	const payload = encodePayload(frame);
	if (
		payload.byteLength > payloadLimit(frame.opcode) ||
		payload.byteLength > MAX_BUNDLE_BYTES
	) {
		throw new CrdtProtocolError("payload exceeds limit", 1009);
	}
	const writer = new Writer();
	writer.bytes(Uint8Array.of(0x51, 0x50, 0x43, 0x52));
	writer.u8(1);
	writer.u8(0);
	writer.u8(frame.opcode);
	writer.u8(0);
	writer.u64(frame.connectionSeq);
	writer.u64(frame.requestId);
	writer.u32(payload.byteLength);
	writer.u32(0);
	writer.bytes(payload);
	return writer.finish();
}

function encodePayload(frame: CrdtFrameV1): Uint8Array {
	const writer = new Writer();
	switch (frame.opcode) {
		case 0x01: {
			if (!/^[A-Za-z0-9_-]+$/.test(frame.payload.ticket)) {
				throw new CrdtProtocolError("ticket must be base64url");
			}
			const ticket = new TextEncoder().encode(frame.payload.ticket);
			if (ticket.byteLength === 0 || ticket.byteLength > 256) {
				throw new CrdtProtocolError("invalid ticket length", 1009);
			}
			writer.u16(ticket.byteLength);
			writer.bytes(ticket);
			break;
		}
		case 0x02:
			if (frame.payload.parts.length > MAX_FIELDS) {
				throw new CrdtProtocolError("too many proof parts", 1009);
			}
			assertSortedFieldSlots(frame.payload.parts);
			writer.u32(frame.payload.schemaVersion);
			writer.u16(frame.payload.parts.length);
			for (const part of frame.payload.parts) {
				if (part.proof.byteLength > MAX_PROOF_BYTES) {
					throw new CrdtProtocolError("proof exceeds limit", 1009);
				}
				writer.u16(part.fieldSlot);
				writer.u64(part.fieldEpoch);
				writer.u32(part.proof.byteLength);
				writer.bytes(part.proof);
			}
			break;
		case 0x03:
			writer.u32(frame.payload.chunkIndex);
			writer.u16(frame.payload.fieldSlot);
			writer.u64(frame.payload.throughFieldCursor);
			break;
		case 0x04:
			if (frame.payload.parts.length > MAX_FIELDS) {
				throw new CrdtProtocolError("too many update parts", 1009);
			}
			assertSortedFieldSlots(frame.payload.parts, false);
			writer.bytes(frame.payload.updateId, 16);
			writer.u64(frame.payload.aggregateEpoch);
			writer.u32(frame.payload.schemaVersion);
			writer.u16(frame.payload.parts.length);
			for (const part of frame.payload.parts) {
				if (
					part.bytes.byteLength === 0 ||
					part.bytes.byteLength > MAX_FIELD_BYTES
				) {
					throw new CrdtProtocolError("invalid field update length", 1009);
				}
				writer.u16(part.fieldSlot);
				writer.u64(part.fieldEpoch);
				writer.u16(part.formatVersion);
				writer.u64(part.baseFieldCursor);
				writer.u32(part.bytes.byteLength);
				writer.bytes(part.bytes);
			}
			break;
		case 0x05:
		case 0x85:
			writeAwareness(writer, frame.payload.value);
			break;
		case 0x06:
		case 0x07:
			break;
		case 0x08:
			if (frame.payload.receipts.length > MAX_RECEIPTS) {
				throw new CrdtProtocolError("too many receipts", 1009);
			}
			writer.u16(frame.payload.receipts.length);
			for (const receipt of frame.payload.receipts) {
				writer.bytes(receipt.updateId, 16);
				writer.bytes(receipt.submittedHash, 32);
				writer.u64(receipt.aggregateEpoch);
				writer.u32(receipt.schemaVersion);
			}
			break;
		case 0x81:
			if (frame.payload.grants.length > MAX_FIELDS) {
				throw new CrdtProtocolError("too many grants", 1009);
			}
			assertSortedFieldSlots(frame.payload.grants);
			writer.u64(frame.payload.aggregateEpoch);
			writer.u32(frame.payload.schemaVersion);
			writer.u16(frame.payload.grants.length);
			for (const grant of frame.payload.grants) {
				if (grant.grant !== 0 && grant.grant !== 1) {
					throw new CrdtProtocolError("invalid field grant");
				}
				writer.u16(grant.fieldSlot);
				writer.u8(grant.grant);
				writer.u64(grant.fieldEpoch);
				writer.u64(grant.headFieldCursor);
			}
			break;
		case 0x82:
			if (frame.payload.bytes.byteLength > MAX_FIELD_BYTES) {
				throw new CrdtProtocolError("sync chunk exceeds limit", 1009);
			}
			writer.u32(frame.payload.chunkIndex);
			writer.u16(frame.payload.fieldSlot);
			writer.u64(frame.payload.fieldEpoch);
			writer.u64(frame.payload.throughFieldCursor);
			writer.u8(frame.payload.final ? 1 : 0);
			writer.u32(frame.payload.bytes.byteLength);
			writer.bytes(frame.payload.bytes);
			break;
		case 0x83:
			if (frame.payload.parts.length > MAX_FIELDS) {
				throw new CrdtProtocolError("too many update parts", 1009);
			}
			assertSortedFieldSlots(frame.payload.parts, false);
			writer.bytes(frame.payload.commitId, 16);
			writer.u64(frame.payload.aggregateEpoch);
			writer.u16(frame.payload.parts.length);
			for (const part of frame.payload.parts) {
				if (
					part.bytes.byteLength === 0 ||
					part.bytes.byteLength > MAX_FIELD_BYTES
				) {
					throw new CrdtProtocolError("invalid field update length", 1009);
				}
				writer.u16(part.fieldSlot);
				writer.u64(part.fieldEpoch);
				writer.u16(part.formatVersion);
				writer.u64(part.fieldCursor);
				writer.u32(part.bytes.byteLength);
				writer.bytes(part.bytes);
			}
			break;
		case 0x84:
			writer.bytes(frame.payload.updateId, 16);
			writer.u64(frame.payload.aggregateEpoch);
			writeFieldCursors(writer, frame.payload.cursors);
			break;
		case 0x86:
			if (frame.payload.transitions.length > MAX_FIELDS) {
				throw new CrdtProtocolError("too many transitions", 1009);
			}
			assertSortedFieldSlots(frame.payload.transitions);
			writer.u32(frame.payload.schemaVersion);
			writer.u16(frame.payload.transitions.length);
			for (const transition of frame.payload.transitions) {
				if (
					(transition.action !== 0 &&
						transition.action !== 1 &&
						transition.action !== 2) ||
					(transition.grant !== 0 && transition.grant !== 1) ||
					(transition.action === 1 &&
						(transition.grant !== 0 ||
							transition.fieldEpoch !== 0n ||
							transition.headFieldCursor !== 0n)) ||
					(transition.action === 2 && transition.grant !== 0)
				) {
					throw new CrdtProtocolError("noncanonical field transition");
				}
				writer.u16(transition.fieldSlot);
				writer.u8(transition.action);
				writer.u8(transition.grant);
				writer.u64(transition.fieldEpoch);
				writer.u64(transition.headFieldCursor);
			}
			break;
		case 0x87:
			if (
				frame.payload.code < 1 ||
				frame.payload.code > 6 ||
				typeof frame.payload.retryable !== "boolean"
			) {
				throw new CrdtProtocolError("invalid error payload");
			}
			writer.u16(frame.payload.code);
			writer.u8(frame.payload.retryable ? 1 : 0);
			writer.u32(frame.payload.retryAfterMs);
			writer.bytes(frame.payload.correlationId, 16);
			break;
		case 0x88:
			writer.u64(frame.payload.serverTimeMs);
			break;
		case 0x89:
			writer.u64(frame.payload.aggregateEpoch);
			writer.u32(frame.payload.schemaVersion);
			break;
		case 0x8a:
			if (
				frame.payload.reason !== 1 &&
				frame.payload.reason !== 2 &&
				frame.payload.reason !== 3
			) {
				throw new CrdtProtocolError("invalid suspension reason");
			}
			writer.u8(frame.payload.reason);
			break;
		case 0x8b:
			if (frame.payload.receipts.length > MAX_RECEIPTS) {
				throw new CrdtProtocolError("too many receipts", 1009);
			}
			writer.u16(frame.payload.receipts.length);
			for (const receipt of frame.payload.receipts) {
				writer.bytes(receipt.updateId, 16);
				writer.u64(receipt.aggregateEpoch);
				writeFieldCursors(writer, receipt.cursors);
			}
			break;
	}
	return writer.finish();
}

export function parseCrdtHostMessageV1(input: {
	data: string | ArrayBuffer | Uint8Array;
	binary: boolean;
	compressed: boolean;
	complete: boolean;
}): CrdtFrameV1 {
	if (!input.binary || typeof input.data === "string") {
		throw new CrdtProtocolError("QPCR requires binary messages");
	}
	if (input.compressed) {
		throw new CrdtProtocolError("QPCR v1 compression is disabled");
	}
	if (!input.complete) {
		throw new CrdtProtocolError("partial QPCR message");
	}
	const bytes =
		input.data instanceof Uint8Array ? input.data : new Uint8Array(input.data);
	if (bytes.byteLength > CRDT_PROTOCOL_V1_MAX_FRAME_BYTES) {
		throw new CrdtProtocolError("frame exceeds limit", 1009);
	}
	return decodeCrdtFrameV1(bytes);
}

const REQUEST_OPCODES = new Set([0x01, 0x02, 0x04, 0x06, 0x08]);
const ZERO_REQUEST_OPCODES = new Set([
	0x03, 0x05, 0x07, 0x83, 0x85, 0x86, 0x8a,
]);

const RESPONSE_TO_REQUEST = new Map<number, number>([
	[0x81, 0x02],
	[0x82, 0x02],
	[0x84, 0x04],
	[0x88, 0x06],
	[0x89, 0x01],
	[0x8b, 0x08],
]);

export class CrdtProtocolMachineV1 {
	state: CrdtProtocolState = "unauthenticated";
	private nextClientSequence = 1n;
	private nextServerSequence = 1n;
	private readonly seenRequestIds = new Set<bigint>();
	private readonly pendingRequests = new Map<bigint, number>();

	accept(direction: CrdtProtocolDirection, frame: CrdtFrameV1): void {
		this.assertDirection(direction, frame.opcode);
		this.acceptSequence(direction, frame.connectionSeq);
		this.assertRequest(direction, frame);
		this.assertState(direction, frame.opcode);
		this.transition(direction, frame);
	}

	private assertDirection(
		direction: CrdtProtocolDirection,
		opcode: number,
	): void {
		const valid =
			direction === "client-to-server"
				? CLIENT_OPCODES.has(opcode)
				: SERVER_OPCODES.has(opcode);
		if (!valid) throw new CrdtProtocolError("wrong-direction opcode");
	}

	private acceptSequence(
		direction: CrdtProtocolDirection,
		sequence: bigint,
	): void {
		const expected =
			direction === "client-to-server"
				? this.nextClientSequence
				: this.nextServerSequence;
		if (sequence !== expected || sequence > MAX_U64) {
			throw new CrdtProtocolError("invalid connection sequence");
		}
		if (sequence === MAX_U64) {
			throw new CrdtProtocolError("connection sequence wrapped");
		}
		if (direction === "client-to-server") {
			this.nextClientSequence++;
		} else {
			this.nextServerSequence++;
		}
	}

	private assertRequest(
		direction: CrdtProtocolDirection,
		frame: CrdtFrameV1,
	): void {
		if (direction === "client-to-server") {
			if (REQUEST_OPCODES.has(frame.opcode)) {
				if (
					frame.requestId === 0n ||
					this.seenRequestIds.has(frame.requestId)
				) {
					throw new CrdtProtocolError("invalid or reused request id");
				}
				if (this.state === "unauthenticated" && this.pendingRequests.size > 0) {
					throw new CrdtProtocolError("frame pipelined behind AUTH");
				}
				this.seenRequestIds.add(frame.requestId);
				this.pendingRequests.set(frame.requestId, frame.opcode);
				return;
			}
			if (!ZERO_REQUEST_OPCODES.has(frame.opcode) || frame.requestId !== 0n) {
				throw new CrdtProtocolError("request id misuse");
			}
			return;
		}

		if (frame.opcode === 0x87) {
			if (
				frame.requestId !== 0n &&
				!this.pendingRequests.has(frame.requestId)
			) {
				throw new CrdtProtocolError("ERROR correlation mismatch");
			}
			if (frame.requestId !== 0n) {
				this.pendingRequests.delete(frame.requestId);
			}
			return;
		}
		if (ZERO_REQUEST_OPCODES.has(frame.opcode)) {
			if (frame.requestId !== 0n) {
				throw new CrdtProtocolError("unsolicited request id misuse");
			}
			return;
		}
		const requestOpcode = RESPONSE_TO_REQUEST.get(frame.opcode);
		if (
			frame.requestId === 0n ||
			requestOpcode === undefined ||
			this.pendingRequests.get(frame.requestId) !== requestOpcode
		) {
			throw new CrdtProtocolError("response correlation mismatch");
		}
		if (frame.opcode !== 0x82) {
			this.pendingRequests.delete(frame.requestId);
		}
	}

	private assertState(direction: CrdtProtocolDirection, opcode: number): void {
		if (this.state === "closed") {
			throw new CrdtProtocolError("frame after close");
		}
		if (direction === "client-to-server") {
			const valid =
				(opcode === 0x01 && this.state === "unauthenticated") ||
				(opcode === 0x02 &&
					(this.state === "syncing" ||
						this.state === "ready" ||
						this.state === "field-syncing")) ||
				(opcode === 0x03 &&
					(this.state === "syncing" ||
						this.state === "ready" ||
						this.state === "field-syncing")) ||
				(opcode === 0x04 && this.state === "ready") ||
				(opcode === 0x05 && this.state === "ready") ||
				((opcode === 0x06 || opcode === 0x07) &&
					this.state !== "unauthenticated") ||
				(opcode === 0x08 &&
					(this.state === "syncing" ||
						this.state === "ready" ||
						this.state === "field-syncing"));
			if (!valid) throw new CrdtProtocolError("wrong-state frame");
			return;
		}

		const valid =
			opcode === 0x87 ||
			(opcode === 0x89 && this.state === "unauthenticated") ||
			((opcode === 0x81 || opcode === 0x82) &&
				(this.state === "syncing" ||
					this.state === "ready" ||
					this.state === "field-syncing")) ||
			((opcode === 0x83 || opcode === 0x84 || opcode === 0x85) &&
				this.state === "ready") ||
			(opcode === 0x86 &&
				(this.state === "syncing" ||
					this.state === "ready" ||
					this.state === "field-syncing")) ||
			(opcode === 0x88 && this.state !== "unauthenticated") ||
			(opcode === 0x8a &&
				(this.state === "syncing" ||
					this.state === "ready" ||
					this.state === "field-syncing")) ||
			(opcode === 0x8b &&
				(this.state === "syncing" ||
					this.state === "ready" ||
					this.state === "field-syncing"));
		if (!valid) throw new CrdtProtocolError("wrong-state frame");
	}

	private transition(
		direction: CrdtProtocolDirection,
		frame: CrdtFrameV1,
	): void {
		if (direction === "client-to-server" && frame.opcode === 0x07) {
			this.state = "closed";
			return;
		}
		if (direction !== "server-to-client") return;
		if (frame.opcode === 0x89) {
			this.state = "syncing";
		} else if (frame.opcode === 0x81) {
			this.state = "ready";
		} else if (frame.opcode === 0x8a) {
			this.state = "suspended";
		} else if (frame.opcode === 0x86) {
			if (frame.payload.transitions.some(({ action }) => action === 2)) {
				this.state = "field-syncing";
			} else if (
				this.state === "field-syncing" &&
				frame.payload.transitions.some(({ action }) => action === 0)
			) {
				this.state = "ready";
			}
		}
	}
}
