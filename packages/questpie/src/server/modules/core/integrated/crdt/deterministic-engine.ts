import {
	assertCrdtCandidateSourceState,
	assertCrdtEngineBasis,
	assertReplicaBelongsToEngine,
	createCrdtCandidateToken,
	createCrdtReplica,
	CrdtEngineError,
	hashCrdtEngineState,
	type CrdtEngineBasis,
	type CrdtEngineLimits,
	type CrdtEngineReplica,
	type CrdtFieldEngine,
	type CrdtStagedFieldCandidate,
	type CrdtTextFieldEngine,
	resolveCrdtEngineLimits,
	verifyCrdtCandidateToken,
} from "#questpie/shared/crdt-engine.js";

import type { CrdtTextOperation } from "./types.js";

const TEXT_ENGINE_ID = "questpie.deterministic-text/v1";
const SET_ENGINE_ID = "questpie.deterministic-add-wins-set/v1";
const FORMAT_VERSION = 1;
const ENGINE_VERSION = 1;
const STATE_VERSION = 1;
const TEXT_CODEC_FINGERPRINT =
	"b74cc653f3387d2826ab9764d314791faf492762ae42a20d84f9fba82b001dd7";
const SET_CODEC_FINGERPRINT =
	"86fcad187b9019ecd4399137c4a69116510142858a148b762f0f842a00e8c161";

type TextReplica = CrdtEngineReplica<"text", string>;
type SetReplica = CrdtEngineReplica<"set", string[]>;

export type DeterministicSetUpdateOperation =
	| { type: "add"; value: string; dot: string }
	| { type: "delete"; value: string; observedDots: readonly string[] };

export function createDeterministicTextEngine(): CrdtTextFieldEngine {
	const engine: CrdtTextFieldEngine = {
		engineId: TEXT_ENGINE_ID,
		engineVersion: ENGINE_VERSION,
		stateVersion: STATE_VERSION,
		codecFingerprint: TEXT_CODEC_FINGERPRINT,
		format: "text",
		formatVersion: FORMAT_VERSION,
		relativePositions: Object.freeze({
			create(
				replica: TextReplica,
				input: Readonly<{
					offset: number;
					affinity: "preceding" | "following";
				}>,
			) {
				assertReplicaBelongsToEngine(engine, replica);
				const value = decodeTextSnapshot(replica.state);
				assertTextAnchorOffset(value, input.offset);
				const bytes = new Uint8Array(5);
				const view = new DataView(bytes.buffer);
				view.setUint8(0, input.affinity === "preceding" ? 0 : 1);
				view.setUint32(1, input.offset);
				return encodeBase64Url(bytes);
			},
			resolve(replica: TextReplica, position: string) {
				assertReplicaBelongsToEngine(engine, replica);
				const bytes = decodeBase64Url(position);
				if (bytes.byteLength !== 5 || (bytes[0] !== 0 && bytes[0] !== 1)) {
					throw new CrdtEngineError("invalid relative position");
				}
				const offset = new DataView(
					bytes.buffer,
					bytes.byteOffset,
					bytes.byteLength,
				).getUint32(1);
				assertTextAnchorOffset(decodeTextSnapshot(replica.state), offset);
				return Object.freeze({
					offset,
					affinity: bytes[0] === 0 ? "preceding" : "following",
				});
			},
		}),

		async create({ value, basis }) {
			assertText(value);
			const snapshot = encodeTextSnapshot(value);
			const projectionBytes = new TextEncoder().encode(value).byteLength;
			const limits = resolveCrdtEngineLimits();
			if (
				projectionBytes > limits.maxProjectionBytes ||
				snapshot.byteLength > limits.maxSnapshotBytes
			) {
				throw new CrdtEngineError("initial text value exceeds limits");
			}
			return createCrdtReplica({
				engineId: TEXT_ENGINE_ID,
				format: "text",
				formatVersion: FORMAT_VERSION,
				basis,
				state: snapshot,
			});
		},

		async stage({ replica, update, limits: overrides }) {
			assertReplicaBelongsToEngine(engine, replica);
			const limits = resolveCrdtEngineLimits(overrides);
			assertUpdateLimit(update, limits);
			assertSnapshotByteLimit(replica.state, limits.maxSnapshotBytes);
			const operations = decodeTextUpdate(update, limits.maxOperations);
			let value = decodeTextSnapshot(replica.state);
			for (const operation of operations) {
				value = applyTextOperation(value, operation);
			}
			assertText(value);
			const projectionBytes = new TextEncoder().encode(value).byteLength;
			if (projectionBytes > limits.maxProjectionBytes) {
				throw new CrdtEngineError("text projection exceeds candidate limit");
			}
			const nextSnapshot = encodeTextSnapshot(value);
			if (nextSnapshot.byteLength > limits.maxSnapshotBytes) {
				throw new CrdtEngineError("text snapshot exceeds candidate limit");
			}
			return createCandidate({
				engine,
				basis: replica.basis,
				sourceState: replica.state,
				normalizedUpdate: update,
				nextSnapshot,
				projection: value,
				operationCount: operations.length,
				resultBytes: projectionBytes,
				elementCount: 0,
			});
		},

		async commit({ candidate, current, assignedFieldCursor }) {
			assertReplicaBelongsToEngine(engine, current);
			assertCandidateEngine(engine, candidate);
			assertCrdtEngineBasis(current.basis, candidate.basis);
			if (assignedFieldCursor !== current.basis.fieldCursor + 1n) {
				throw new CrdtEngineError("assigned field cursor must be exact-next");
			}
			await assertCrdtCandidateSourceState(candidate, current.state);
			await verifyCrdtCandidateToken(candidate);
			decodeTextSnapshot(candidate.nextSnapshot);
			return createCrdtReplica({
				engineId: engine.engineId,
				format: engine.format,
				formatVersion: engine.formatVersion,
				basis: {
					fieldEpoch: current.basis.fieldEpoch,
					fieldCursor: assignedFieldCursor,
				},
				state: candidate.nextSnapshot,
			});
		},

		async proof(replica) {
			assertReplicaBelongsToEngine(engine, replica);
			return hash(replica.state);
		},

		async diff({ replica, proof }) {
			assertReplicaBelongsToEngine(engine, replica);
			const current = await hash(replica.state);
			return equalBytes(current, proof)
				? Object.freeze({ kind: "current" as const })
				: Object.freeze({
						kind: "snapshot" as const,
						snapshot: new Uint8Array(replica.state),
					});
		},

		async snapshot(replica) {
			assertReplicaBelongsToEngine(engine, replica);
			decodeTextSnapshot(replica.state);
			return new Uint8Array(replica.state);
		},

		async restore({ snapshot, basis }) {
			const value = decodeTextSnapshot(snapshot);
			const limits = resolveCrdtEngineLimits();
			if (
				snapshot.byteLength > limits.maxSnapshotBytes ||
				new TextEncoder().encode(value).byteLength > limits.maxProjectionBytes
			) {
				throw new CrdtEngineError("text snapshot exceeds limits");
			}
			return textReplica(value, basis);
		},

		project(replica) {
			assertReplicaBelongsToEngine(engine, replica);
			return decodeTextSnapshot(replica.state);
		},
	};
	return Object.freeze(engine);
}

export function createDeterministicSetEngine(): CrdtFieldEngine<
	"set",
	string[]
> {
	const engine: CrdtFieldEngine<"set", string[]> = {
		engineId: SET_ENGINE_ID,
		engineVersion: ENGINE_VERSION,
		stateVersion: STATE_VERSION,
		codecFingerprint: SET_CODEC_FINGERPRINT,
		format: "set",
		formatVersion: FORMAT_VERSION,

		async create({ value, basis }) {
			const limits = resolveCrdtEngineLimits();
			if (value.length > limits.maxElements) {
				throw new CrdtEngineError("initial set value exceeds limits");
			}
			const state = emptySetState();
			const sorted = sortUtf8Strings(value);
			for (let index = 0; index < sorted.length; index++) {
				const element = sorted[index]!;
				assertSetElement(element, limits.maxElementBytes);
				if (index > 0 && element === sorted[index - 1]) {
					throw new CrdtEngineError(
						"set projection contains a duplicate element",
					);
				}
				const dot = `seed:${index + 1}`;
				state.entries.set(element, new Set([dot]));
				state.activeDotOwners.set(dot, element);
			}
			const snapshot = encodeSetSnapshot(state);
			const projectionBytes = sorted.reduce(
				(total, element) =>
					total + new TextEncoder().encode(element).byteLength,
				0,
			);
			if (
				projectionBytes > limits.maxProjectionBytes ||
				snapshot.byteLength > limits.maxSnapshotBytes
			) {
				throw new CrdtEngineError("initial set value exceeds limits");
			}
			return createCrdtReplica({
				engineId: SET_ENGINE_ID,
				format: "set",
				formatVersion: FORMAT_VERSION,
				basis,
				state: snapshot,
			});
		},

		async stage({ replica, update, limits: overrides }) {
			assertReplicaBelongsToEngine(engine, replica);
			const limits = resolveCrdtEngineLimits(overrides);
			assertUpdateLimit(update, limits);
			assertSnapshotByteLimit(replica.state, limits.maxSnapshotBytes);
			const operations = decodeSetUpdate(update, limits);
			const state = decodeSetSnapshot(replica.state);
			for (const operation of operations) {
				applySetOperation(state, operation);
			}
			assertSetStateLimits(state);
			const projection = projectSet(state);
			if (projection.length > limits.maxElements) {
				throw new CrdtEngineError("set element count exceeds candidate limit");
			}
			const projectionBytes = projection.reduce(
				(total, value) => total + new TextEncoder().encode(value).byteLength,
				0,
			);
			if (projectionBytes > limits.maxProjectionBytes) {
				throw new CrdtEngineError("set projection exceeds candidate limit");
			}
			const nextSnapshot = encodeSetSnapshot(state);
			if (nextSnapshot.byteLength > limits.maxSnapshotBytes) {
				throw new CrdtEngineError("set snapshot exceeds candidate limit");
			}
			return createCandidate({
				engine,
				basis: replica.basis,
				sourceState: replica.state,
				normalizedUpdate: update,
				nextSnapshot,
				projection: Object.freeze(projection) as unknown as string[],
				operationCount: operations.length,
				resultBytes: projectionBytes,
				elementCount: projection.length,
			});
		},

		async commit({ candidate, current, assignedFieldCursor }) {
			assertReplicaBelongsToEngine(engine, current);
			assertCandidateEngine(engine, candidate);
			assertCrdtEngineBasis(current.basis, candidate.basis);
			if (assignedFieldCursor !== current.basis.fieldCursor + 1n) {
				throw new CrdtEngineError("assigned field cursor must be exact-next");
			}
			await assertCrdtCandidateSourceState(candidate, current.state);
			await verifyCrdtCandidateToken(candidate);
			decodeSetSnapshot(candidate.nextSnapshot);
			return createCrdtReplica({
				engineId: engine.engineId,
				format: engine.format,
				formatVersion: engine.formatVersion,
				basis: {
					fieldEpoch: current.basis.fieldEpoch,
					fieldCursor: assignedFieldCursor,
				},
				state: candidate.nextSnapshot,
			});
		},

		async proof(replica) {
			assertReplicaBelongsToEngine(engine, replica);
			return hash(replica.state);
		},

		async diff({ replica, proof }) {
			assertReplicaBelongsToEngine(engine, replica);
			const current = await hash(replica.state);
			return equalBytes(current, proof)
				? Object.freeze({ kind: "current" as const })
				: Object.freeze({
						kind: "snapshot" as const,
						snapshot: new Uint8Array(replica.state),
					});
		},

		async snapshot(replica) {
			assertReplicaBelongsToEngine(engine, replica);
			decodeSetSnapshot(replica.state);
			return new Uint8Array(replica.state);
		},

		async restore({ snapshot, basis }) {
			const limits = resolveCrdtEngineLimits();
			if (snapshot.byteLength > limits.maxSnapshotBytes) {
				throw new CrdtEngineError("set snapshot exceeds limits");
			}
			const state = decodeSetSnapshot(snapshot);
			const projection = projectSet(state);
			if (
				projection.length > limits.maxElements ||
				projection.reduce(
					(total, value) => total + new TextEncoder().encode(value).byteLength,
					0,
				) > limits.maxProjectionBytes
			) {
				throw new CrdtEngineError("set snapshot exceeds limits");
			}
			return setReplica(state, basis);
		},

		project(replica) {
			assertReplicaBelongsToEngine(engine, replica);
			return projectSet(decodeSetSnapshot(replica.state));
		},
	};
	return Object.freeze(engine);
}

export function encodeDeterministicTextUpdate(
	operations: readonly CrdtTextOperation[],
): Uint8Array {
	if (operations.length > 0xffff) {
		throw new CrdtEngineError("too many text operations");
	}
	const writer = new BinaryWriter();
	writer.u16(operations.length);
	for (const operation of operations) {
		if (operation.type === "insert") {
			writer.u8(1);
			writer.u32(operation.index);
			writer.utf16(operation.value);
		} else {
			writer.u8(2);
			writer.u32(operation.index);
			writer.u32(operation.length);
		}
	}
	return writer.finish();
}

export function encodeDeterministicSetUpdate(
	operations: readonly DeterministicSetUpdateOperation[],
): Uint8Array {
	if (operations.length > 0xffff) {
		throw new CrdtEngineError("too many set operations");
	}
	const writer = new BinaryWriter();
	writer.u16(operations.length);
	for (const operation of operations) {
		writer.u8(operation.type === "add" ? 1 : 2);
		writer.utf16(operation.value);
		if (operation.type === "add") {
			writer.ascii(operation.dot);
		} else {
			if (operation.observedDots.length > 0xffff) {
				throw new CrdtEngineError("too many observed set dots");
			}
			writer.u16(operation.observedDots.length);
			for (const dot of operation.observedDots) writer.ascii(dot);
		}
	}
	return writer.finish();
}

async function createCandidate<TFormat extends "text" | "set", TValue>(input: {
	engine: CrdtFieldEngine<TFormat, TValue>;
	basis: CrdtEngineBasis;
	sourceState: Uint8Array;
	normalizedUpdate: Uint8Array;
	nextSnapshot: Uint8Array;
	projection: TValue;
	operationCount: number;
	resultBytes: number;
	elementCount: number;
}): Promise<CrdtStagedFieldCandidate<TFormat, TValue>> {
	const normalizedUpdate = new Uint8Array(input.normalizedUpdate);
	const nextSnapshot = new Uint8Array(input.nextSnapshot);
	const basis = Object.freeze({ ...input.basis });
	const basisStateHash = await hashCrdtEngineState(input.sourceState);
	const inspection = Object.freeze({
		operationCount: input.operationCount,
		resultBytes: input.resultBytes,
		elementCount: input.elementCount,
	});
	const token = await createCrdtCandidateToken({
		engineId: input.engine.engineId,
		format: input.engine.format,
		formatVersion: input.engine.formatVersion,
		basis,
		basisStateHash,
		normalizedUpdate,
		nextSnapshot,
		inspection,
	});
	return Object.freeze({
		engineId: input.engine.engineId,
		format: input.engine.format,
		formatVersion: input.engine.formatVersion,
		basis,
		basisStateHash,
		normalizedUpdate,
		nextSnapshot,
		projection: input.projection,
		inspection,
		token,
	});
}

function textReplica(value: string, basis: CrdtEngineBasis): TextReplica {
	return createCrdtReplica({
		engineId: TEXT_ENGINE_ID,
		format: "text",
		formatVersion: FORMAT_VERSION,
		basis,
		state: encodeTextSnapshot(value),
	});
}

function setReplica(state: SetState, basis: CrdtEngineBasis): SetReplica {
	return createCrdtReplica({
		engineId: SET_ENGINE_ID,
		format: "set",
		formatVersion: FORMAT_VERSION,
		basis,
		state: encodeSetSnapshot(state),
	});
}

function assertCandidateEngine(
	engine: CrdtFieldEngine,
	candidate: CrdtStagedFieldCandidate,
): void {
	if (
		candidate.engineId !== engine.engineId ||
		candidate.format !== engine.format ||
		candidate.formatVersion !== engine.formatVersion
	) {
		throw new CrdtEngineError("staged candidate belongs to a different engine");
	}
}

function assertUpdateLimit(update: Uint8Array, limits: CrdtEngineLimits): void {
	if (!(update instanceof Uint8Array)) {
		throw new CrdtEngineError("engine update must be bytes");
	}
	if (update.byteLength > limits.maxUpdateBytes) {
		throw new CrdtEngineError("engine update exceeds candidate limit");
	}
}

function decodeTextUpdate(
	update: Uint8Array,
	maxOperations: number,
): CrdtTextOperation[] {
	const reader = new BinaryReader(update);
	const count = reader.u16();
	if (count > maxOperations) {
		throw new CrdtEngineError("text operation count exceeds candidate limit");
	}
	const operations: CrdtTextOperation[] = [];
	for (let index = 0; index < count; index++) {
		const opcode = reader.u8();
		const operationIndex = reader.u32();
		if (opcode === 1) {
			operations.push({
				type: "insert",
				index: operationIndex,
				value: reader.utf16(),
			});
		} else if (opcode === 2) {
			operations.push({
				type: "delete",
				index: operationIndex,
				length: reader.u32(),
			});
		} else {
			throw new CrdtEngineError("unknown deterministic text operation");
		}
	}
	reader.done();
	return operations;
}

function applyTextOperation(
	value: string,
	operation: CrdtTextOperation,
): string {
	assertIndex(operation.index, value.length, "text operation index");
	assertScalarBoundary(value, operation.index);
	if (operation.type === "insert") {
		assertText(operation.value);
		return (
			value.slice(0, operation.index) +
			operation.value +
			value.slice(operation.index)
		);
	}
	assertIndex(operation.length, value.length, "text delete length");
	const end = operation.index + operation.length;
	if (end > value.length) {
		throw new CrdtEngineError("text delete exceeds current value");
	}
	assertScalarBoundary(value, end);
	return value.slice(0, operation.index) + value.slice(end);
}

function assertText(value: string): void {
	if (typeof value !== "string") {
		throw new CrdtEngineError("text value must be a string");
	}
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code === 0) {
			throw new CrdtEngineError("text value contains NUL");
		}
		if (code >= 0xd800 && code <= 0xdbff) {
			if (index + 1 >= value.length) {
				throw new CrdtEngineError("text value contains an unpaired surrogate");
			}
			const next = value.charCodeAt(index + 1);
			if (next < 0xdc00 || next > 0xdfff) {
				throw new CrdtEngineError("text value contains an unpaired surrogate");
			}
			index++;
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			throw new CrdtEngineError("text value contains an unpaired surrogate");
		}
	}
}

function assertScalarBoundary(value: string, index: number): void {
	if (
		index > 0 &&
		index < value.length &&
		isHighSurrogate(value.charCodeAt(index - 1)) &&
		isLowSurrogate(value.charCodeAt(index))
	) {
		throw new CrdtEngineError("text index splits a UTF-16 scalar boundary");
	}
}

function assertTextAnchorOffset(value: string, offset: number): void {
	assertIndex(offset, value.length, "text anchor offset");
	assertScalarBoundary(value, offset);
}

function decodeBase64Url(value: string): Uint8Array {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > 344 ||
		value.length % 4 === 1 ||
		!/^[A-Za-z0-9_-]+$/.test(value)
	) {
		throw new CrdtEngineError("invalid relative position");
	}
	const binary = atob(
		value.replace(/-/g, "+").replace(/_/g, "/") +
			"=".repeat((4 - (value.length % 4)) % 4),
	);
	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	if (encodeBase64Url(bytes) !== value) {
		throw new CrdtEngineError("invalid relative position");
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

function isHighSurrogate(code: number): boolean {
	return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
	return code >= 0xdc00 && code <= 0xdfff;
}

function assertIndex(value: number, maximum: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
		throw new CrdtEngineError(`invalid ${label}`);
	}
}

function encodeTextSnapshot(value: string): Uint8Array {
	const writer = new BinaryWriter();
	writer.utf16(value);
	return writer.finish();
}

function decodeTextSnapshot(snapshot: Uint8Array): string {
	assertSnapshotByteLimit(snapshot);
	const reader = new BinaryReader(snapshot);
	const value = reader.utf16();
	reader.done();
	assertText(value);
	return value;
}

type SetState = {
	entries: Map<string, Set<string>>;
	activeDotOwners: Map<string, string>;
	removed: Map<string, string>;
};

function emptySetState(): SetState {
	return {
		entries: new Map(),
		activeDotOwners: new Map(),
		removed: new Map(),
	};
}

function decodeSetUpdate(
	update: Uint8Array,
	limits: CrdtEngineLimits,
): DeterministicSetUpdateOperation[] {
	const reader = new BinaryReader(update);
	const count = reader.u16();
	if (count > limits.maxOperations) {
		throw new CrdtEngineError("set operation count exceeds candidate limit");
	}
	const operations: DeterministicSetUpdateOperation[] = [];
	for (let index = 0; index < count; index++) {
		const opcode = reader.u8();
		const value = reader.utf16();
		assertSetElement(value, limits.maxElementBytes);
		if (opcode === 1) {
			const dot = reader.ascii();
			assertDot(dot);
			operations.push({ type: "add", value, dot });
		} else if (opcode === 2) {
			const dotCount = reader.u16();
			if (dotCount > limits.maxOperations) {
				throw new CrdtEngineError(
					"observed set dot count exceeds candidate limit",
				);
			}
			const observedDots: string[] = [];
			for (let dotIndex = 0; dotIndex < dotCount; dotIndex++) {
				const dot = reader.ascii();
				assertDot(dot);
				observedDots.push(dot);
			}
			if (new Set(observedDots).size !== observedDots.length) {
				throw new CrdtEngineError("duplicate observed set dot");
			}
			operations.push({ type: "delete", value, observedDots });
		} else {
			throw new CrdtEngineError("unknown deterministic set operation");
		}
	}
	reader.done();
	return operations;
}

function applySetOperation(
	state: SetState,
	operation: DeterministicSetUpdateOperation,
): void {
	if (operation.type === "add") {
		const activeValue = state.activeDotOwners.get(operation.dot);
		if (activeValue !== undefined && activeValue !== operation.value) {
			throw new CrdtEngineError("set dot is already bound to another element");
		}
		const removedValue = state.removed.get(operation.dot);
		if (removedValue !== undefined) {
			if (removedValue !== operation.value) {
				throw new CrdtEngineError(
					"removed set dot is bound to another element",
				);
			}
			return;
		}
		const dots = state.entries.get(operation.value) ?? new Set<string>();
		dots.add(operation.dot);
		state.entries.set(operation.value, dots);
		state.activeDotOwners.set(operation.dot, operation.value);
		return;
	}
	const dots = state.entries.get(operation.value);
	for (const dot of operation.observedDots) {
		const activeValue = state.activeDotOwners.get(dot);
		if (activeValue !== undefined && activeValue !== operation.value) {
			throw new CrdtEngineError("observed set dot belongs to another element");
		}
		const removedValue = state.removed.get(dot);
		if (removedValue !== undefined && removedValue !== operation.value) {
			throw new CrdtEngineError("removed set dot is bound to another element");
		}
		state.removed.set(dot, operation.value);
		dots?.delete(dot);
		state.activeDotOwners.delete(dot);
	}
	if (dots?.size === 0) state.entries.delete(operation.value);
}

function projectSet(state: SetState): string[] {
	return sortUtf8Strings(
		[...state.entries]
			.filter(([, dots]) => dots.size > 0)
			.map(([value]) => value),
	);
}

function assertSetStateLimits(state: SetState): void {
	if (state.activeDotOwners.size + state.removed.size > 100_000) {
		throw new CrdtEngineError("set dot state exceeds candidate limit");
	}
}

function encodeSetSnapshot(state: SetState): Uint8Array {
	const writer = new BinaryWriter();
	const entries = sortUtf8Strings(
		[...state.entries]
			.filter(([, dots]) => dots.size > 0)
			.map(([value]) => value),
	).map((value) => [value, state.entries.get(value)!] as const);
	writer.u32(entries.length);
	for (const [value, dots] of entries) {
		writer.utf16(value);
		const sortedDots = [...dots].sort();
		writer.u32(sortedDots.length);
		for (const dot of sortedDots) writer.ascii(dot);
	}
	const removed = [...state.removed].sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0,
	);
	writer.u32(removed.length);
	for (const [dot, value] of removed) {
		writer.ascii(dot);
		writer.utf16(value);
	}
	return writer.finish();
}

function decodeSetSnapshot(snapshot: Uint8Array): SetState {
	assertSnapshotByteLimit(snapshot);
	const reader = new BinaryReader(snapshot);
	const state = emptySetState();
	const entryCount = reader.u32();
	if (entryCount > 10_000) {
		throw new CrdtEngineError("set snapshot contains too many elements");
	}
	let previous: string | undefined;
	const activeDots = new Map<string, string>();
	let totalDotCount = 0;
	for (let index = 0; index < entryCount; index++) {
		const value = reader.utf16();
		assertSetElement(value, 4096);
		if (previous !== undefined && compareUtf8(previous, value) >= 0) {
			throw new CrdtEngineError("set snapshot elements are not canonical");
		}
		previous = value;
		const dotCount = reader.u32();
		if (dotCount === 0 || dotCount > 100_000 - totalDotCount) {
			throw new CrdtEngineError("invalid set snapshot dot count");
		}
		totalDotCount += dotCount;
		const dots = new Set<string>();
		let previousDot: string | undefined;
		for (let dotIndex = 0; dotIndex < dotCount; dotIndex++) {
			const dot = reader.ascii();
			assertDot(dot);
			if (previousDot !== undefined && previousDot >= dot) {
				throw new CrdtEngineError("set snapshot dots are not canonical");
			}
			if (activeDots.has(dot)) {
				throw new CrdtEngineError("set snapshot reuses an active dot");
			}
			previousDot = dot;
			activeDots.set(dot, value);
			state.activeDotOwners.set(dot, value);
			dots.add(dot);
		}
		state.entries.set(value, dots);
	}
	const removedCount = reader.u32();
	if (removedCount > 100_000 - totalDotCount) {
		throw new CrdtEngineError("invalid removed set dot count");
	}
	totalDotCount += removedCount;
	let previousRemoved: string | undefined;
	for (let index = 0; index < removedCount; index++) {
		const dot = reader.ascii();
		assertDot(dot);
		if (previousRemoved !== undefined && previousRemoved >= dot) {
			throw new CrdtEngineError("removed set dots are not canonical");
		}
		if (activeDots.has(dot)) {
			throw new CrdtEngineError("set dot cannot be active and removed");
		}
		const value = reader.utf16();
		assertSetElement(value, 4096);
		previousRemoved = dot;
		state.removed.set(dot, value);
	}
	reader.done();
	assertSetStateLimits(state);
	return state;
}

function assertSetElement(value: string, maxBytes: number): void {
	assertText(value);
	const bytes = new TextEncoder().encode(value).byteLength;
	if (bytes === 0 || bytes > maxBytes) {
		throw new CrdtEngineError("invalid set element byte length");
	}
}

function assertDot(value: string): void {
	if (!/^[A-Za-z0-9_-]{1,64}:[1-9][0-9]{0,19}$/.test(value)) {
		throw new CrdtEngineError("invalid set dot");
	}
}

function compareUtf8(left: string, right: string): number {
	const leftBytes = new TextEncoder().encode(left);
	const rightBytes = new TextEncoder().encode(right);
	const length = Math.min(leftBytes.length, rightBytes.length);
	for (let index = 0; index < length; index++) {
		if (leftBytes[index] !== rightBytes[index]) {
			return leftBytes[index]! - rightBytes[index]!;
		}
	}
	return leftBytes.length - rightBytes.length;
}

function sortUtf8Strings(values: readonly string[]): string[] {
	return values
		.map((value) => ({
			value,
			bytes: new TextEncoder().encode(value),
		}))
		.sort((left, right) => compareBytes(left.bytes, right.bytes))
		.map(({ value }) => value);
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
	const length = Math.min(left.length, right.length);
	for (let index = 0; index < length; index++) {
		if (left[index] !== right[index]) {
			return left[index]! - right[index]!;
		}
	}
	return left.length - right.length;
}

class BinaryWriter {
	private readonly chunks: Uint8Array[] = [];
	private size = 0;

	u8(value: number): void {
		assertUnsigned(value, 0xff);
		this.push(Uint8Array.of(value));
	}

	u16(value: number): void {
		assertUnsigned(value, 0xffff);
		const bytes = new Uint8Array(2);
		new DataView(bytes.buffer).setUint16(0, value);
		this.push(bytes);
	}

	u32(value: number): void {
		assertUnsigned(value, 0xffffffff);
		const bytes = new Uint8Array(4);
		new DataView(bytes.buffer).setUint32(0, value);
		this.push(bytes);
	}

	utf16(value: string): void {
		this.u32(value.length);
		const bytes = new Uint8Array(value.length * 2);
		const view = new DataView(bytes.buffer);
		for (let index = 0; index < value.length; index++) {
			view.setUint16(index * 2, value.charCodeAt(index));
		}
		this.push(bytes);
	}

	ascii(value: string): void {
		if (value.length > 0xffff) {
			throw new CrdtEngineError("ASCII value exceeds length limit");
		}
		const bytes = new Uint8Array(value.length);
		for (let index = 0; index < value.length; index++) {
			const code = value.charCodeAt(index);
			if (code > 0x7f) {
				throw new CrdtEngineError("expected ASCII value");
			}
			bytes[index] = code;
		}
		this.u16(bytes.length);
		this.push(bytes);
	}

	finish(): Uint8Array {
		const bytes = new Uint8Array(this.size);
		let offset = 0;
		for (const chunk of this.chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return bytes;
	}

	private push(value: Uint8Array): void {
		this.chunks.push(value);
		this.size += value.byteLength;
	}
}

class BinaryReader {
	private offset = 0;
	private readonly view: DataView;

	constructor(private readonly bytes: Uint8Array) {
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
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

	utf16(): string {
		const length = this.u32();
		if (length > Math.floor((this.bytes.length - this.offset) / 2)) {
			throw new CrdtEngineError("truncated UTF-16 value");
		}
		let value = "";
		const chunk: number[] = [];
		for (let index = 0; index < length; index++) {
			chunk.push(this.u16());
			if (chunk.length === 4096) {
				value += String.fromCharCode(...chunk);
				chunk.length = 0;
			}
		}
		if (chunk.length > 0) value += String.fromCharCode(...chunk);
		return value;
	}

	ascii(): string {
		const length = this.u16();
		this.require(length);
		let value = "";
		for (let index = 0; index < length; index++) {
			const byte = this.u8();
			if (byte > 0x7f) {
				throw new CrdtEngineError("expected ASCII value");
			}
			value += String.fromCharCode(byte);
		}
		return value;
	}

	done(): void {
		if (this.offset !== this.bytes.length) {
			throw new CrdtEngineError("trailing deterministic engine bytes");
		}
	}

	private require(length: number): void {
		if (length > this.bytes.length - this.offset) {
			throw new CrdtEngineError("truncated deterministic engine bytes");
		}
	}
}

function assertUnsigned(value: number, maximum: number): void {
	if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
		throw new CrdtEngineError("invalid unsigned engine integer");
	}
}

function assertSnapshotByteLimit(
	snapshot: Uint8Array,
	maximum = 24 * 1024 * 1024,
): void {
	if (!(snapshot instanceof Uint8Array) || snapshot.byteLength > maximum) {
		throw new CrdtEngineError("engine snapshot exceeds limit");
	}
}

async function hash(value: Uint8Array): Promise<Uint8Array> {
	const bytes = new Uint8Array(value.byteLength);
	bytes.set(value);
	return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.buffer));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) return false;
	let difference = 0;
	for (let index = 0; index < left.byteLength; index++) {
		difference |= left[index]! ^ right[index]!;
	}
	return difference === 0;
}
