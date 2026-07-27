import type { CrdtSetOperation } from "../../server/modules/core/integrated/crdt/types.js";
import { CrdtMutationError } from "./types.js";

const MAX_SNAPSHOT_BYTES = 24 * 1024 * 1024;
const MAX_UPDATE_BYTES = 256 * 1024;
const MAX_ELEMENTS = 10_000;
const MAX_ELEMENT_BYTES = 4 * 1024;
const MAX_DOTS = 100_000;

export type CrdtClientSetReplica = {
	entries: Map<string, Set<string>>;
	activeDotOwners: Map<string, string>;
	removed: Map<string, string>;
};

export function restoreClientSetReplica(
	snapshot: Uint8Array,
): CrdtClientSetReplica {
	if (
		!(snapshot instanceof Uint8Array) ||
		snapshot.byteLength > MAX_SNAPSHOT_BYTES
	) {
		throw invalid();
	}
	const reader = new Reader(snapshot);
	const replica = emptyReplica();
	const entryCount = reader.u32();
	if (entryCount > MAX_ELEMENTS) throw invalid();
	let previousValue: string | undefined;
	let dots = 0;
	for (let index = 0; index < entryCount; index++) {
		const value = reader.utf16();
		assertElement(value);
		if (previousValue !== undefined && compareUtf8(previousValue, value) >= 0) {
			throw invalid();
		}
		previousValue = value;
		const dotCount = reader.u32();
		if (dotCount < 1 || dotCount > MAX_DOTS - dots) throw invalid();
		dots += dotCount;
		const active = new Set<string>();
		let previousDot: string | undefined;
		for (let dotIndex = 0; dotIndex < dotCount; dotIndex++) {
			const dot = reader.ascii();
			assertDot(dot);
			if (
				(previousDot !== undefined && previousDot >= dot) ||
				replica.activeDotOwners.has(dot)
			) {
				throw invalid();
			}
			previousDot = dot;
			active.add(dot);
			replica.activeDotOwners.set(dot, value);
		}
		replica.entries.set(value, active);
	}
	const removedCount = reader.u32();
	if (removedCount > MAX_DOTS - dots) throw invalid();
	let previousRemoved: string | undefined;
	for (let index = 0; index < removedCount; index++) {
		const dot = reader.ascii();
		assertDot(dot);
		if (
			(previousRemoved !== undefined && previousRemoved >= dot) ||
			replica.activeDotOwners.has(dot)
		) {
			throw invalid();
		}
		const value = reader.utf16();
		assertElement(value);
		previousRemoved = dot;
		replica.removed.set(dot, value);
	}
	reader.done();
	return replica;
}

export function snapshotClientSetReplica(
	replica: CrdtClientSetReplica,
): Uint8Array {
	const writer = new Writer();
	const values = projectClientSetReplica(replica);
	writer.u32(values.length);
	for (const value of values) {
		writer.utf16(value);
		const dots = [...replica.entries.get(value)!].sort();
		writer.u32(dots.length);
		for (const dot of dots) writer.ascii(dot);
	}
	const removed = [...replica.removed].sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0,
	);
	writer.u32(removed.length);
	for (const [dot, value] of removed) {
		writer.ascii(dot);
		writer.utf16(value);
	}
	const bytes = writer.finish();
	if (bytes.byteLength > MAX_SNAPSHOT_BYTES) throw invalid();
	return bytes;
}

export function projectClientSetReplica(
	replica: CrdtClientSetReplica,
): readonly string[] {
	return Object.freeze(
		[...replica.entries]
			.filter(([, dots]) => dots.size > 0)
			.map(([value]) => value)
			.sort(compareUtf8),
	);
}

export function applyClientSetOperations(
	replica: CrdtClientSetReplica,
	operations: readonly CrdtSetOperation<string>[],
	dotPrefix: string,
	startingDot = 1,
): Readonly<{
	replica: CrdtClientSetReplica;
	update: Uint8Array;
	nextDot: number;
}> {
	if (!Array.isArray(operations) || operations.length === 0) throw invalid();
	const next = cloneReplica(replica);
	const internal: InternalOperation[] = [];
	let dotCounter = startingDot;
	for (const operation of operations) {
		if (!operation || typeof operation !== "object") throw invalid();
		assertElement(operation.value);
		if (operation.type === "add") {
			const dot = `${dotPrefix}:${dotCounter++}`;
			assertDot(dot);
			const normalized = { type: "add" as const, value: operation.value, dot };
			applyInternal(next, normalized);
			internal.push(normalized);
		} else if (operation.type === "delete") {
			const observedDots = [
				...(next.entries.get(operation.value) ?? []),
			].sort();
			const normalized = {
				type: "delete" as const,
				value: operation.value,
				observedDots,
			};
			applyInternal(next, normalized);
			internal.push(normalized);
		} else {
			throw invalid();
		}
	}
	const update = encodeUpdate(internal);
	return Object.freeze({ replica: next, update, nextDot: dotCounter });
}

export function applyClientSetUpdate(
	replica: CrdtClientSetReplica,
	update: Uint8Array,
): CrdtClientSetReplica {
	const next = cloneReplica(replica);
	for (const operation of decodeUpdate(update)) applyInternal(next, operation);
	return next;
}

export function mergeClientSetUpdates(
	updates: readonly Uint8Array[],
): Uint8Array {
	return encodeUpdate(updates.flatMap((update) => decodeUpdate(update)));
}

export function createClientSetSnapshot(values: readonly string[]): Uint8Array {
	const replica = emptyReplica();
	for (let index = 0; index < values.length; index++) {
		const value = values[index]!;
		assertElement(value);
		applyInternal(replica, {
			type: "add",
			value,
			dot: `seed:${index + 1}`,
		});
	}
	return snapshotClientSetReplica(replica);
}

type InternalOperation =
	| { type: "add"; value: string; dot: string }
	| { type: "delete"; value: string; observedDots: string[] };

function decodeUpdate(update: Uint8Array): InternalOperation[] {
	if (
		!(update instanceof Uint8Array) ||
		update.byteLength === 0 ||
		update.byteLength > MAX_UPDATE_BYTES
	) {
		throw invalid();
	}
	const reader = new Reader(update);
	const count = reader.u16();
	if (count < 1 || count > 4096) throw invalid();
	const operations: InternalOperation[] = [];
	for (let index = 0; index < count; index++) {
		const opcode = reader.u8();
		const value = reader.utf16();
		assertElement(value);
		if (opcode === 1) {
			const dot = reader.ascii();
			assertDot(dot);
			operations.push({ type: "add", value, dot });
		} else if (opcode === 2) {
			const dotCount = reader.u16();
			if (dotCount > 4096) throw invalid();
			const observedDots: string[] = [];
			for (let dotIndex = 0; dotIndex < dotCount; dotIndex++) {
				const dot = reader.ascii();
				assertDot(dot);
				observedDots.push(dot);
			}
			if (new Set(observedDots).size !== observedDots.length) throw invalid();
			operations.push({ type: "delete", value, observedDots });
		} else {
			throw invalid();
		}
	}
	reader.done();
	return operations;
}

function encodeUpdate(operations: readonly InternalOperation[]): Uint8Array {
	if (operations.length < 1 || operations.length > 4096) throw invalid();
	const writer = new Writer();
	writer.u16(operations.length);
	for (const operation of operations) {
		writer.u8(operation.type === "add" ? 1 : 2);
		writer.utf16(operation.value);
		if (operation.type === "add") {
			writer.ascii(operation.dot);
		} else {
			writer.u16(operation.observedDots.length);
			for (const dot of operation.observedDots) writer.ascii(dot);
		}
	}
	const update = writer.finish();
	if (update.byteLength > MAX_UPDATE_BYTES) throw invalid();
	return update;
}

function applyInternal(
	replica: CrdtClientSetReplica,
	operation: InternalOperation,
): void {
	if (operation.type === "add") {
		const activeOwner = replica.activeDotOwners.get(operation.dot);
		const removedOwner = replica.removed.get(operation.dot);
		if (
			(activeOwner !== undefined && activeOwner !== operation.value) ||
			(removedOwner !== undefined && removedOwner !== operation.value)
		) {
			throw invalid();
		}
		if (removedOwner !== undefined) return;
		const dots = replica.entries.get(operation.value) ?? new Set<string>();
		dots.add(operation.dot);
		replica.entries.set(operation.value, dots);
		replica.activeDotOwners.set(operation.dot, operation.value);
		if (
			replica.entries.size > MAX_ELEMENTS ||
			replica.activeDotOwners.size + replica.removed.size > MAX_DOTS
		) {
			throw invalid();
		}
		return;
	}
	const dots = replica.entries.get(operation.value);
	for (const dot of operation.observedDots) {
		const activeOwner = replica.activeDotOwners.get(dot);
		const removedOwner = replica.removed.get(dot);
		if (
			(activeOwner !== undefined && activeOwner !== operation.value) ||
			(removedOwner !== undefined && removedOwner !== operation.value)
		) {
			throw invalid();
		}
		replica.removed.set(dot, operation.value);
		replica.activeDotOwners.delete(dot);
		dots?.delete(dot);
	}
	if (dots?.size === 0) replica.entries.delete(operation.value);
	if (replica.activeDotOwners.size + replica.removed.size > MAX_DOTS) {
		throw invalid();
	}
}

function emptyReplica(): CrdtClientSetReplica {
	return {
		entries: new Map(),
		activeDotOwners: new Map(),
		removed: new Map(),
	};
}

function cloneReplica(replica: CrdtClientSetReplica): CrdtClientSetReplica {
	return {
		entries: new Map(
			[...replica.entries].map(([value, dots]) => [value, new Set(dots)]),
		),
		activeDotOwners: new Map(replica.activeDotOwners),
		removed: new Map(replica.removed),
	};
}

function assertElement(value: string): void {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.includes("\0") ||
		hasUnpairedSurrogate(value) ||
		new TextEncoder().encode(value).byteLength > MAX_ELEMENT_BYTES
	) {
		throw invalid();
	}
}

function assertDot(value: string): void {
	if (!/^[A-Za-z0-9_-]{1,64}:[1-9][0-9]{0,19}$/.test(value)) throw invalid();
}

function hasUnpairedSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(++index);
			if (next < 0xdc00 || next > 0xdfff) return true;
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			return true;
		}
	}
	return false;
}

function compareUtf8(left: string, right: string): number {
	const a = new TextEncoder().encode(left);
	const b = new TextEncoder().encode(right);
	for (let index = 0; index < Math.min(a.length, b.length); index++) {
		if (a[index] !== b[index]) return a[index]! - b[index]!;
	}
	return a.length - b.length;
}

class Reader {
	private offset = 0;
	private readonly view: DataView;

	constructor(private readonly input: Uint8Array) {
		this.view = new DataView(input.buffer, input.byteOffset, input.byteLength);
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

	ascii(): string {
		const length = this.u16();
		this.require(length);
		const bytes = this.input.subarray(this.offset, this.offset + length);
		this.offset += length;
		if (bytes.some((value) => value < 0x20 || value > 0x7e)) throw invalid();
		return String.fromCharCode(...bytes);
	}

	utf16(): string {
		const length = this.u32();
		if (length > MAX_SNAPSHOT_BYTES / 2) throw invalid();
		this.require(length * 2);
		let value = "";
		for (let index = 0; index < length; index++) {
			value += String.fromCharCode(this.view.getUint16(this.offset));
			this.offset += 2;
		}
		return value;
	}

	done(): void {
		if (this.offset !== this.input.byteLength) throw invalid();
	}

	private require(length: number): void {
		if (
			!Number.isSafeInteger(length) ||
			length < 0 ||
			this.offset + length > this.input.byteLength
		) {
			throw invalid();
		}
	}
}

class Writer {
	private readonly chunks: Uint8Array[] = [];
	private length = 0;

	u8(value: number): void {
		this.push(Uint8Array.of(value));
	}

	u16(value: number): void {
		if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) {
			throw invalid();
		}
		const bytes = new Uint8Array(2);
		new DataView(bytes.buffer).setUint16(0, value);
		this.push(bytes);
	}

	u32(value: number): void {
		if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
			throw invalid();
		}
		const bytes = new Uint8Array(4);
		new DataView(bytes.buffer).setUint32(0, value);
		this.push(bytes);
	}

	ascii(value: string): void {
		assertDot(value);
		this.u16(value.length);
		this.push(Uint8Array.from(value, (character) => character.charCodeAt(0)));
	}

	utf16(value: string): void {
		assertElement(value);
		this.u32(value.length);
		const bytes = new Uint8Array(value.length * 2);
		const view = new DataView(bytes.buffer);
		for (let index = 0; index < value.length; index++) {
			view.setUint16(index * 2, value.charCodeAt(index));
		}
		this.push(bytes);
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

	private push(bytes: Uint8Array): void {
		this.chunks.push(bytes);
		this.length += bytes.byteLength;
	}
}

function invalid(): CrdtMutationError {
	return new CrdtMutationError("INVALID_OPERATION");
}
