import {
	assertCrdtCandidateSourceState,
	assertCrdtEngineBasis,
	assertReplicaBelongsToEngine,
	createCrdtCandidateToken,
	createCrdtReplica,
	CrdtEngineError,
	hashCrdtEngineState,
	type CrdtFieldEngine,
	resolveCrdtEngineLimits,
	verifyCrdtCandidateToken,
} from "questpie/crdt";
import * as Y from "yjs";

const ENGINE_ID = "questpie.yjs-text/v1";
const FORMAT_VERSION = 1;
const MAXIMUM_JOB_ARRAY_BUFFER_BYTES = 64 * 1024 * 1024;
const CODEC_FINGERPRINT =
	"fd9143e742c66683554636070a6ca3fc182e159511921b4dc91a4d49361f5c45";

export function createYjsTextEngineCore(): CrdtFieldEngine<"text", string> {
	const engine: CrdtFieldEngine<"text", string> = {
		engineId: ENGINE_ID,
		engineVersion: 1,
		stateVersion: 1,
		codecFingerprint: CODEC_FINGERPRINT,
		format: "text",
		formatVersion: FORMAT_VERSION,

		async create({ value, basis }) {
			assertText(value);
			const document = new Y.Doc();
			document.getText("text").insert(0, value);
			const state = Y.encodeStateAsUpdate(document);
			assertDocument(document);
			return createCrdtReplica({
				engineId: ENGINE_ID,
				format: "text",
				formatVersion: FORMAT_VERSION,
				basis,
				state,
			});
		},

		async stage({ replica, update, limits: overrides }) {
			assertReplicaBelongsToEngine(engine, replica);
			const limits = resolveCrdtEngineLimits(overrides);
			if (!(update instanceof Uint8Array) || update.byteLength === 0) {
				throw new CrdtEngineError("Yjs update must be nonempty bytes");
			}
			if (update.byteLength > limits.maxUpdateBytes) {
				throw new CrdtEngineError("Yjs update exceeds candidate limit");
			}
			const document = restoreDocument(replica.state);
			try {
				Y.applyUpdate(document, new Uint8Array(update));
			} catch {
				throw new CrdtEngineError("invalid Yjs update");
			}
			assertDocument(document);
			const projection = document.getText("text").toString();
			assertText(projection);
			const projectionBytes = new TextEncoder().encode(projection).byteLength;
			const nextSnapshot = Y.encodeStateAsUpdate(document);
			if (
				projectionBytes > limits.maxProjectionBytes ||
				nextSnapshot.byteLength > limits.maxSnapshotBytes
			) {
				throw new CrdtEngineError("Yjs candidate exceeds result limits");
			}
			const jobArrayBufferBytes =
				replica.state.byteLength +
				update.byteLength +
				nextSnapshot.byteLength +
				update.byteLength;
			if (jobArrayBufferBytes > MAXIMUM_JOB_ARRAY_BUFFER_BYTES) {
				throw new CrdtEngineError("Yjs job exceeds ArrayBuffer ceiling");
			}
			const inspection = Object.freeze({
				operationCount: decodedStructCount(update),
				resultBytes: projectionBytes,
				elementCount: 0,
			});
			if (inspection.operationCount > limits.maxOperations) {
				throw new CrdtEngineError("Yjs update exceeds operation limit");
			}
			const basisStateHash = await hashCrdtEngineState(replica.state);
			const normalizedUpdate = new Uint8Array(update);
			const token = await createCrdtCandidateToken({
				engineId: ENGINE_ID,
				format: "text",
				formatVersion: FORMAT_VERSION,
				basis: replica.basis,
				basisStateHash,
				normalizedUpdate,
				nextSnapshot,
				inspection,
			});
			return Object.freeze({
				engineId: ENGINE_ID,
				format: "text" as const,
				formatVersion: FORMAT_VERSION,
				basis: Object.freeze({ ...replica.basis }),
				basisStateHash,
				normalizedUpdate,
				nextSnapshot,
				projection,
				inspection,
				token,
			});
		},

		async commit({ candidate, current, assignedFieldCursor }) {
			assertReplicaBelongsToEngine(engine, current);
			assertCrdtEngineBasis(candidate.basis, current.basis);
			if (assignedFieldCursor !== current.basis.fieldCursor + 1n) {
				throw new CrdtEngineError("assigned field cursor must be exact-next");
			}
			await assertCrdtCandidateSourceState(candidate, current.state);
			await verifyCrdtCandidateToken(candidate);
			assertDocument(restoreDocument(candidate.nextSnapshot));
			return createCrdtReplica({
				engineId: ENGINE_ID,
				format: "text",
				formatVersion: FORMAT_VERSION,
				basis: {
					fieldEpoch: current.basis.fieldEpoch,
					fieldCursor: assignedFieldCursor,
				},
				state: candidate.nextSnapshot,
			});
		},

		async proof(replica) {
			assertReplicaBelongsToEngine(engine, replica);
			return Y.encodeStateVectorFromUpdate(replica.state);
		},

		async diff({ replica, proof }) {
			assertReplicaBelongsToEngine(engine, replica);
			let missing: Uint8Array;
			try {
				missing = Y.diffUpdate(replica.state, proof);
			} catch {
				throw new CrdtEngineError("invalid Yjs state vector");
			}
			return missing.byteLength <= 2
				? Object.freeze({ kind: "current" as const })
				: Object.freeze({
						kind: "snapshot" as const,
						snapshot: new Uint8Array(replica.state),
					});
		},

		async snapshot(replica) {
			assertReplicaBelongsToEngine(engine, replica);
			assertDocument(restoreDocument(replica.state));
			return new Uint8Array(replica.state);
		},

		async restore({ snapshot, basis }) {
			const document = restoreDocument(snapshot);
			assertDocument(document);
			return createCrdtReplica({
				engineId: ENGINE_ID,
				format: "text",
				formatVersion: FORMAT_VERSION,
				basis,
				state: snapshot,
			});
		},

		project(replica) {
			assertReplicaBelongsToEngine(engine, replica);
			return restoreDocument(replica.state).getText("text").toString();
		},
	};
	return Object.freeze(engine);
}

function restoreDocument(snapshot: Uint8Array): Y.Doc {
	if (!(snapshot instanceof Uint8Array)) {
		throw new CrdtEngineError("Yjs snapshot must be bytes");
	}
	const document = new Y.Doc();
	try {
		Y.applyUpdate(document, new Uint8Array(snapshot));
		document.getText("text");
	} catch {
		throw new CrdtEngineError("invalid Yjs snapshot");
	}
	return document;
}

function assertDocument(document: Y.Doc): void {
	const roots = [...document.share.entries()];
	if (
		roots.length !== 1 ||
		roots[0]?.[0] !== "text" ||
		!(roots[0][1] instanceof Y.Text)
	) {
		throw new CrdtEngineError(
			"Yjs document must contain exactly one named text root",
		);
	}
	const store = document.store as typeof document.store & {
		pendingStructs?: unknown;
		pendingDs?: unknown;
	};
	if (store.pendingStructs || store.pendingDs) {
		throw new CrdtEngineError("Yjs update has unresolved dependencies");
	}
}

function assertText(value: string): void {
	if (
		typeof value !== "string" ||
		value.includes("\0") ||
		hasUnpairedSurrogate(value)
	) {
		throw new CrdtEngineError("invalid Yjs text projection");
	}
}

function hasUnpairedSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			if (index + 1 >= value.length) return true;
			const next = value.charCodeAt(index + 1);
			if (next < 0xdc00 || next > 0xdfff) return true;
			index++;
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			return true;
		}
	}
	return false;
}

function decodedStructCount(update: Uint8Array): number {
	try {
		const decoded = Y.decodeUpdate(update);
		let deleteRanges = 0;
		for (const ranges of decoded.ds.clients.values()) {
			deleteRanges += ranges.length;
		}
		return decoded.structs.length + deleteRanges;
	} catch {
		throw new CrdtEngineError("invalid Yjs update");
	}
}
