import type { CrdtClientTextEngine } from "questpie/client";
import type { CrdtTextAffinity } from "questpie/crdt";
import * as Y from "yjs";

import {
	createYjsRelativePosition,
	resolveYjsRelativePosition,
} from "./relative-position.js";

const ENGINE_ID = "questpie.yjs-text/v1";
const FORMAT_VERSION = 1;
const TEXT_ROOT = "text";

type ClientReplica = Readonly<{
	document: Y.Doc;
	text: Y.Text;
}>;

type TextOperation =
	| { type: "insert"; index: number; value: string }
	| { type: "delete"; index: number; length: number };

export function createYjsClientEngine(): CrdtClientTextEngine<unknown> {
	const engine: CrdtClientTextEngine<unknown> = {
		engineId: ENGINE_ID,
		formatVersion: FORMAT_VERSION,
		relativePositions: Object.freeze({
			create(
				replica: unknown,
				input: Readonly<{ offset: number; affinity: CrdtTextAffinity }>,
			) {
				const current = asReplica(replica);
				return createYjsRelativePosition(current.document, current.text, input);
			},
			resolve(replica: unknown, position: string) {
				const current = asReplica(replica);
				return resolveYjsRelativePosition(
					current.document,
					current.text,
					position,
				);
			},
		}),
		restore: (snapshot) => restore(snapshot),
		snapshot: (replica) =>
			new Uint8Array(Y.encodeStateAsUpdate(asReplica(replica).document)),
		proof: (replica) =>
			new Uint8Array(Y.encodeStateVector(asReplica(replica).document)),
		value: (replica) => asReplica(replica).text.toString(),
		apply(replica, operations) {
			const next = restore(Y.encodeStateAsUpdate(asReplica(replica).document));
			const before = Y.encodeStateVector(next.document);
			next.document.transact(() => applyOperations(next.text, operations));
			assertDocument(next.document);
			const update = new Uint8Array(
				Y.encodeStateAsUpdate(next.document, before),
			);
			if (update.byteLength === 0) {
				throw new Error("Yjs client update must be nonempty");
			}
			return Object.freeze({ replica: next, update });
		},
		applyUpdate(replica, update) {
			if (!(update instanceof Uint8Array) || update.byteLength === 0) {
				throw new Error("Yjs client update must be nonempty bytes");
			}
			const next = restore(Y.encodeStateAsUpdate(asReplica(replica).document));
			try {
				Y.applyUpdate(next.document, new Uint8Array(update));
			} catch {
				throw new Error("invalid Yjs client update");
			}
			assertDocument(next.document);
			return next;
		},
		mergeUpdates(updates) {
			if (
				updates.length === 0 ||
				updates.some(
					(update) =>
						!(update instanceof Uint8Array) || update.byteLength === 0,
				)
			) {
				throw new Error("Yjs client updates must be nonempty bytes");
			}
			try {
				return new Uint8Array(
					Y.mergeUpdates(updates.map((update) => new Uint8Array(update))),
				);
			} catch {
				throw new Error("invalid Yjs client updates");
			}
		},
	};
	return Object.freeze(engine);
}

function restore(snapshot: Uint8Array): ClientReplica {
	if (!(snapshot instanceof Uint8Array)) {
		throw new Error("Yjs client snapshot must be bytes");
	}
	const document = new Y.Doc();
	try {
		Y.applyUpdate(document, new Uint8Array(snapshot));
	} catch {
		throw new Error("invalid Yjs client snapshot");
	}
	const text = document.getText(TEXT_ROOT);
	assertDocument(document);
	return Object.freeze({ document, text });
}

function asReplica(value: unknown): ClientReplica {
	if (
		!value ||
		typeof value !== "object" ||
		!((value as ClientReplica).document instanceof Y.Doc) ||
		!((value as ClientReplica).text instanceof Y.Text) ||
		(value as ClientReplica).document.getText(TEXT_ROOT) !==
			(value as ClientReplica).text
	) {
		throw new Error("invalid Yjs client replica");
	}
	return value as ClientReplica;
}

function applyOperations(
	text: Y.Text,
	operations: readonly TextOperation[],
): void {
	if (!Array.isArray(operations) || operations.length === 0) {
		throw new Error("Yjs text operations must be nonempty");
	}
	for (const operation of operations) {
		const current = text.toString();
		assertOffset(current, operation.index);
		if (operation.type === "insert") {
			if (
				typeof operation.value !== "string" ||
				operation.value.length === 0 ||
				operation.value.includes("\0") ||
				hasUnpairedSurrogate(operation.value)
			) {
				throw new Error("invalid Yjs text insertion");
			}
			text.insert(operation.index, operation.value);
		} else {
			if (
				!Number.isSafeInteger(operation.length) ||
				operation.length <= 0 ||
				operation.index + operation.length > current.length
			) {
				throw new Error("invalid Yjs text deletion");
			}
			assertOffset(current, operation.index + operation.length);
			text.delete(operation.index, operation.length);
		}
	}
}

function assertOffset(value: string, offset: number): void {
	if (
		!Number.isSafeInteger(offset) ||
		offset < 0 ||
		offset > value.length ||
		(offset > 0 &&
			offset < value.length &&
			isHighSurrogate(value.charCodeAt(offset - 1)) &&
			isLowSurrogate(value.charCodeAt(offset)))
	) {
		throw new Error("invalid UTF-16 text offset");
	}
}

function assertDocument(document: Y.Doc): void {
	const roots = [...document.share.entries()];
	if (
		roots.length !== 1 ||
		roots[0]?.[0] !== TEXT_ROOT ||
		!(roots[0][1] instanceof Y.Text)
	) {
		throw new Error("Yjs document must contain exactly one named text root");
	}
	const store = document.store as typeof document.store & {
		pendingStructs?: unknown;
		pendingDs?: unknown;
	};
	if (store.pendingStructs || store.pendingDs) {
		throw new Error("Yjs update has unresolved dependencies");
	}
}

function hasUnpairedSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (isHighSurrogate(code)) {
			if (!isLowSurrogate(value.charCodeAt(++index))) return true;
		} else if (isLowSurrogate(code)) {
			return true;
		}
	}
	return false;
}

function isHighSurrogate(value: number): boolean {
	return value >= 0xd800 && value <= 0xdbff;
}

function isLowSurrogate(value: number): boolean {
	return value >= 0xdc00 && value <= 0xdfff;
}
