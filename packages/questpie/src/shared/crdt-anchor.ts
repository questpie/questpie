import type { CrdtTextAffinity } from "./crdt-engine.js";

declare const crdtTextAnchorTokenBrand: unique symbol;

export type CrdtTextAnchorToken = string & {
	readonly [crdtTextAnchorTokenBrand]: true;
};

export type CrdtTextAnchorInput =
	| Readonly<{
			kind: "point";
			offset: number;
			affinity?: CrdtTextAffinity;
	  }>
	| Readonly<{
			kind: "range";
			start: number;
			end: number;
			startAffinity?: CrdtTextAffinity;
			endAffinity?: CrdtTextAffinity;
	  }>;

export type CrdtTextAnchorResolution =
	| Readonly<{ status: "resolved"; kind: "point"; offset: number }>
	| Readonly<{
			status: "resolved";
			kind: "range";
			start: number;
			end: number;
	  }>
	| Readonly<{ status: "detached" }>;

export type CrdtTextAnchorBinding = Readonly<{
	namespace: string;
	incarnationKey: string;
	fieldSlot: number;
	fieldEpoch: bigint;
	engineId: string;
	formatVersion: number;
}>;

type RelativePositionPort<TReplica> = Readonly<{
	create(
		replica: TReplica,
		input: Readonly<{ offset: number; affinity: CrdtTextAffinity }>,
	): string;
	resolve(
		replica: TReplica,
		position: string,
	): Readonly<{ offset: number; affinity: CrdtTextAffinity }> | undefined;
}>;

const TOKEN_PREFIX = "qpa1_";
const MAX_TOKEN_LENGTH = 2_048;
const MAX_RELATIVE_POSITION_BYTES = 258;
const DETACHED = Object.freeze({
	status: "detached",
}) satisfies CrdtTextAnchorResolution;

export function createCrdtTextAnchorToken<TReplica>(input: {
	binding: CrdtTextAnchorBinding;
	replica: TReplica;
	value: string;
	anchor: CrdtTextAnchorInput;
	relativePositions: RelativePositionPort<TReplica>;
}): CrdtTextAnchorToken {
	assertBinding(input.binding);
	let kind: 1 | 2;
	let start: string;
	let end: string | undefined;
	if (input.anchor.kind === "point") {
		kind = 1;
		assertTextOffset(input.value, input.anchor.offset);
		start = input.relativePositions.create(input.replica, {
			offset: input.anchor.offset,
			affinity: input.anchor.affinity ?? "following",
		});
	} else {
		kind = 2;
		assertTextOffset(input.value, input.anchor.start);
		assertTextOffset(input.value, input.anchor.end);
		if (input.anchor.start >= input.anchor.end) {
			throw new TypeError(
				"CRDT text anchor range must be nonempty and ordered",
			);
		}
		start = input.relativePositions.create(input.replica, {
			offset: input.anchor.start,
			affinity: input.anchor.startAffinity ?? "following",
		});
		end = input.relativePositions.create(input.replica, {
			offset: input.anchor.end,
			affinity: input.anchor.endAffinity ?? "preceding",
		});
	}
	const startBytes = decodeBase64Url(start, MAX_RELATIVE_POSITION_BYTES);
	const endBytes =
		end === undefined
			? new Uint8Array()
			: decodeBase64Url(end, MAX_RELATIVE_POSITION_BYTES);
	const namespace = encodeBoundedText(input.binding.namespace, 64, "namespace");
	const engineId = encodeBoundedText(input.binding.engineId, 256, "engine ID");
	const writer = new AnchorWriter();
	writer.u8(kind);
	writer.u16(input.binding.fieldSlot);
	writer.u64(input.binding.fieldEpoch);
	writer.raw(uuidToBytes(input.binding.incarnationKey));
	writer.length8(namespace);
	writer.length16(engineId);
	writer.u16(input.binding.formatVersion);
	writer.length16(startBytes);
	writer.length16(endBytes);
	const token = `${TOKEN_PREFIX}${encodeBase64Url(writer.finish())}`;
	if (token.length > MAX_TOKEN_LENGTH) {
		throw new TypeError("CRDT text anchor token exceeds its maximum length");
	}
	return token as CrdtTextAnchorToken;
}

export function resolveCrdtTextAnchorToken<TReplica>(input: {
	binding: CrdtTextAnchorBinding;
	replica: TReplica;
	value: string;
	token: string;
	relativePositions: RelativePositionPort<TReplica>;
}): CrdtTextAnchorResolution {
	let decoded: ReturnType<typeof decodeAnchor>;
	try {
		assertBinding(input.binding);
		decoded = decodeAnchor(input.token);
	} catch {
		return DETACHED;
	}
	if (
		decoded.namespace !== input.binding.namespace ||
		decoded.incarnationKey !== input.binding.incarnationKey ||
		decoded.fieldSlot !== input.binding.fieldSlot ||
		decoded.fieldEpoch !== input.binding.fieldEpoch ||
		decoded.engineId !== input.binding.engineId ||
		decoded.formatVersion !== input.binding.formatVersion
	) {
		return DETACHED;
	}
	try {
		const start = input.relativePositions.resolve(
			input.replica,
			encodeBase64Url(decoded.start),
		);
		if (!start) return DETACHED;
		assertTextOffset(input.value, start.offset);
		if (decoded.kind === 1) {
			return Object.freeze({
				status: "resolved",
				kind: "point",
				offset: start.offset,
			});
		}
		const end = input.relativePositions.resolve(
			input.replica,
			encodeBase64Url(decoded.end),
		);
		if (!end) return DETACHED;
		assertTextOffset(input.value, end.offset);
		if (start.offset > end.offset) return DETACHED;
		return Object.freeze({
			status: "resolved",
			kind: "range",
			start: start.offset,
			end: end.offset,
		});
	} catch {
		return DETACHED;
	}
}

function decodeAnchor(token: string): Readonly<{
	kind: 1 | 2;
	fieldSlot: number;
	fieldEpoch: bigint;
	incarnationKey: string;
	namespace: string;
	engineId: string;
	formatVersion: number;
	start: Uint8Array;
	end: Uint8Array;
}> {
	if (
		typeof token !== "string" ||
		token.length <= TOKEN_PREFIX.length ||
		token.length > MAX_TOKEN_LENGTH ||
		!token.startsWith(TOKEN_PREFIX)
	) {
		throw new TypeError("invalid CRDT text anchor token");
	}
	const reader = new AnchorReader(
		decodeBase64Url(token.slice(TOKEN_PREFIX.length), 1_532),
	);
	const kind = reader.u8();
	if (kind !== 1 && kind !== 2) {
		throw new TypeError("invalid CRDT text anchor kind");
	}
	const fieldSlot = reader.u16();
	const fieldEpoch = reader.u64();
	const incarnationKey = bytesToUuid(reader.raw(16));
	const namespace = decodeBoundedText(reader.length8(), 64, "namespace");
	const engineId = decodeBoundedText(reader.length16(), 256, "engine ID");
	const formatVersion = reader.u16();
	const start = reader.length16(MAX_RELATIVE_POSITION_BYTES);
	const end = reader.length16(MAX_RELATIVE_POSITION_BYTES);
	if (
		start.byteLength === 0 ||
		(kind === 1 && end.byteLength !== 0) ||
		(kind === 2 && end.byteLength === 0) ||
		!reader.done()
	) {
		throw new TypeError("invalid CRDT text anchor positions");
	}
	return Object.freeze({
		kind,
		fieldSlot,
		fieldEpoch,
		incarnationKey,
		namespace,
		engineId,
		formatVersion,
		start,
		end,
	});
}

function assertBinding(binding: CrdtTextAnchorBinding): void {
	encodeBoundedText(binding.namespace, 64, "namespace");
	encodeBoundedText(binding.engineId, 256, "engine ID");
	uuidToBytes(binding.incarnationKey);
	if (
		!Number.isSafeInteger(binding.fieldSlot) ||
		binding.fieldSlot < 1 ||
		binding.fieldSlot > 0xffff ||
		binding.fieldEpoch < 0n ||
		binding.fieldEpoch > 0xffff_ffff_ffff_ffffn ||
		!Number.isSafeInteger(binding.formatVersion) ||
		binding.formatVersion < 0 ||
		binding.formatVersion > 0xffff
	) {
		throw new TypeError("invalid CRDT text anchor binding");
	}
}

function assertTextOffset(value: string, offset: number): void {
	if (
		!Number.isSafeInteger(offset) ||
		offset < 0 ||
		offset > value.length ||
		(offset > 0 &&
			offset < value.length &&
			isHighSurrogate(value.charCodeAt(offset - 1)) &&
			isLowSurrogate(value.charCodeAt(offset)))
	) {
		throw new TypeError("invalid CRDT text anchor offset");
	}
}

function encodeBoundedText(
	value: string,
	maximumBytes: number,
	label: string,
): Uint8Array {
	if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
		throw new TypeError(`invalid CRDT text anchor ${label}`);
	}
	const encoded = new TextEncoder().encode(value);
	if (encoded.byteLength > maximumBytes) {
		throw new TypeError(`invalid CRDT text anchor ${label}`);
	}
	return encoded;
}

function decodeBoundedText(
	value: Uint8Array,
	maximumBytes: number,
	label: string,
): string {
	if (value.byteLength === 0 || value.byteLength > maximumBytes) {
		throw new TypeError(`invalid CRDT text anchor ${label}`);
	}
	let decoded: string;
	try {
		decoded = new TextDecoder("utf-8", { fatal: true }).decode(value);
	} catch {
		throw new TypeError(`invalid CRDT text anchor ${label}`);
	}
	if (
		decoded.includes("\0") ||
		!equalBytes(new TextEncoder().encode(decoded), value)
	) {
		throw new TypeError(`invalid CRDT text anchor ${label}`);
	}
	return decoded;
}

function decodeBase64Url(value: string, maximumBytes: number): Uint8Array {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > Math.ceil((maximumBytes * 4) / 3) ||
		value.length % 4 === 1 ||
		!/^[A-Za-z0-9_-]+$/.test(value)
	) {
		throw new TypeError("invalid base64url");
	}
	const decoded = atob(
		value.replace(/-/g, "+").replace(/_/g, "/") +
			"=".repeat((4 - (value.length % 4)) % 4),
	);
	if (decoded.length > maximumBytes) throw new TypeError("invalid base64url");
	const bytes = Uint8Array.from(decoded, (character) =>
		character.charCodeAt(0),
	);
	if (encodeBase64Url(bytes) !== value) {
		throw new TypeError("noncanonical base64url");
	}
	return bytes;
}

function encodeBase64Url(value: Uint8Array): string {
	let binary = "";
	for (const byte of value) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function uuidToBytes(value: string): Uint8Array {
	if (
		typeof value !== "string" ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
			value,
		)
	) {
		throw new TypeError("invalid CRDT text anchor incarnation");
	}
	const hex = value.replaceAll("-", "");
	return Uint8Array.from({ length: 16 }, (_, index) =>
		Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
	);
}

function bytesToUuid(value: Uint8Array): string {
	const hex = [...value]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) return false;
	let difference = 0;
	for (let index = 0; index < left.byteLength; index++) {
		difference |= left[index]! ^ right[index]!;
	}
	return difference === 0;
}

function isHighSurrogate(value: number): boolean {
	return value >= 0xd800 && value <= 0xdbff;
}

function isLowSurrogate(value: number): boolean {
	return value >= 0xdc00 && value <= 0xdfff;
}

class AnchorWriter {
	private readonly chunks: Uint8Array[] = [];

	u8(value: number): void {
		this.chunks.push(Uint8Array.of(value));
	}

	u16(value: number): void {
		const bytes = new Uint8Array(2);
		new DataView(bytes.buffer).setUint16(0, value);
		this.chunks.push(bytes);
	}

	u64(value: bigint): void {
		const bytes = new Uint8Array(8);
		new DataView(bytes.buffer).setBigUint64(0, value);
		this.chunks.push(bytes);
	}

	raw(value: Uint8Array): void {
		this.chunks.push(new Uint8Array(value));
	}

	length8(value: Uint8Array): void {
		if (value.byteLength > 0xff) throw new TypeError("length overflow");
		this.u8(value.byteLength);
		this.raw(value);
	}

	length16(value: Uint8Array): void {
		if (value.byteLength > 0xffff) throw new TypeError("length overflow");
		this.u16(value.byteLength);
		this.raw(value);
	}

	finish(): Uint8Array {
		const length = this.chunks.reduce(
			(total, chunk) => total + chunk.byteLength,
			0,
		);
		const result = new Uint8Array(length);
		let offset = 0;
		for (const chunk of this.chunks) {
			result.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return result;
	}
}

class AnchorReader {
	private offset = 0;
	private readonly view: DataView;

	constructor(private readonly bytes: Uint8Array) {
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	}

	u8(): number {
		return this.raw(1)[0]!;
	}

	u16(): number {
		const value = this.view.getUint16(this.offset);
		this.offset += 2;
		return value;
	}

	u64(): bigint {
		const value = this.view.getBigUint64(this.offset);
		this.offset += 8;
		return value;
	}

	length8(maximum = 0xff): Uint8Array {
		const length = this.u8();
		if (length > maximum) throw new TypeError("length overflow");
		return this.raw(length);
	}

	length16(maximum = 0xffff): Uint8Array {
		const length = this.u16();
		if (length > maximum) throw new TypeError("length overflow");
		return this.raw(length);
	}

	raw(length: number): Uint8Array {
		if (
			!Number.isSafeInteger(length) ||
			length < 0 ||
			this.offset + length > this.bytes.byteLength
		) {
			throw new TypeError("truncated CRDT text anchor token");
		}
		const value = this.bytes.slice(this.offset, this.offset + length);
		this.offset += length;
		return value;
	}

	done(): boolean {
		return this.offset === this.bytes.byteLength;
	}
}
