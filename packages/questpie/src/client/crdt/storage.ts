import {
	CRDT_OFFLINE_HORIZON_MS,
	type CrdtClientPartitionCommitResult,
	type CrdtClientStorage,
	type CrdtClientStoredDocument,
	type CrdtClientStoredPartition,
} from "./types.js";

const DATABASE_NAME = "questpie-crdt-v2";
const STORE_NAME = "records";

type BasisRecord = Readonly<{
	kind: "basis";
	revision: number;
	generation: number;
	exactKey: string;
	document: CrdtClientStoredDocument;
}>;

type PurgedRecord = Readonly<{
	kind: "purged";
	revision: number;
	generation: number;
}>;

type BundleRecord = Readonly<{
	kind: "bundle";
	bundle: unknown;
}>;

type TombstoneRecord = Readonly<{
	kind: "tombstone";
	expiresAt: number;
}>;

export function createIndexedDbCrdtStorage(): CrdtClientStorage {
	return Object.freeze({
		async load(key: string) {
			return transact("readonly", (store) => request(store.get(key)));
		},
		async save(key: string, value: CrdtClientStoredDocument) {
			await transact("readwrite", (store) => request(store.put(value, key)));
		},
		async remove(key: string) {
			await transact("readwrite", (store) => request(store.delete(key)));
		},
		async loadPartition(bindingKey: string, now: number) {
			assertTimestamp(now);
			return transact("readonly", async (store) => {
				const head = await request<BasisRecord | PurgedRecord | undefined>(
					store.get(basisKey(bindingKey)),
				);
				if (head === undefined) return emptyPartition();
				if (isPurgedRecord(head)) {
					return Object.freeze({
						revision: head.revision,
						generation: head.generation,
					});
				}
				if (!isBasisRecord(head)) {
					throw new Error("Invalid CRDT partition head");
				}
				const records = await partitionRecords(store, bindingKey);
				const tombstones = new Set(
					records.flatMap(([key, record]) =>
						isTombstoneRecord(record) && record.expiresAt > now
							? [bundleIdFromKey(key)]
							: [],
					),
				);
				const bundles = records
					.flatMap(([key, record]) =>
						isBundleRecord(record) && !tombstones.has(bundleIdFromKey(key))
							? [record.bundle]
							: [],
					)
					.sort(compareBundles);
				const value = head.document.value;
				if (!isPartitionDocument(value)) {
					throw new Error("Invalid CRDT partition basis");
				}
				return Object.freeze({
					revision: head.revision,
					generation: head.generation,
					document: Object.freeze({
						...head.document,
						value: Object.freeze({
							...value,
							pending: Object.freeze(bundles),
						}),
					}),
				}) satisfies CrdtClientStoredPartition;
			});
		},
		async commitPartition({
			bindingKey,
			exactKey,
			document,
			now,
			expectedRevision,
			expectedGeneration,
		}: {
			bindingKey: string;
			exactKey: string;
			document: CrdtClientStoredDocument;
			now: number;
			expectedRevision: number;
			expectedGeneration: number;
		}) {
			assertTimestamp(now);
			assertRevision(expectedRevision);
			assertRevision(expectedGeneration);
			return transact("readwrite", async (store) => {
				const value = document.value;
				if (!isPartitionDocument(value)) {
					throw new Error("Invalid CRDT partition document");
				}
				const existing = await request<BasisRecord | PurgedRecord | undefined>(
					store.get(basisKey(bindingKey)),
				);
				if (
					existing !== undefined &&
					!isBasisRecord(existing) &&
					!isPurgedRecord(existing)
				) {
					throw new Error("Invalid CRDT partition head");
				}
				const currentRevision = existing?.revision ?? 0;
				const currentGeneration = existing?.generation ?? 0;
				if (expectedGeneration !== currentGeneration) {
					return commitResult(currentRevision, currentGeneration, false, false);
				}
				const records = await partitionRecords(store, bindingKey);
				const liveTombstones = new Set<string>();
				const bundles = new Map<string, BundleRecord>();
				for (const [key, record] of records) {
					const id = bundleIdFromKey(key);
					if (isTombstoneRecord(record)) {
						if (record.expiresAt > now) {
							liveTombstones.add(id);
						} else {
							await request(store.delete(key));
						}
					} else if (isBundleRecord(record)) {
						bundles.set(id, record);
					}
				}
				for (const bundle of value.pending) {
					const id = bundleId(bundle);
					if (liveTombstones.has(id)) continue;
					const prior = bundles.get(id);
					if (prior && !equalStoredValue(prior.bundle, bundle)) {
						throw new Error("CRDT immutable bundle conflict");
					}
					if (!prior) {
						const record = Object.freeze({
							kind: "bundle",
							bundle,
						} satisfies BundleRecord);
						await request(store.add(record, bundleKey(bindingKey, id)));
						bundles.set(id, record);
					}
				}
				if (expectedRevision !== currentRevision) {
					return commitResult(currentRevision, currentGeneration, false, true);
				}
				if (
					isBasisRecord(existing) &&
					!isCrdtPartitionBasisMonotonic(
						existing.document.value,
						value,
						[...bundles.values()].map((record) => record.bundle),
					)
				) {
					throw new Error("CRDT partition basis regression");
				}
				const basisDocument = Object.freeze({
					...document,
					value: Object.freeze({ ...value, pending: Object.freeze([]) }),
				});
				await request(
					store.put(
						Object.freeze({
							kind: "basis",
							revision: currentRevision + 1,
							generation: currentGeneration,
							exactKey,
							document: basisDocument,
						} satisfies BasisRecord),
						basisKey(bindingKey),
					),
				);
				return commitResult(currentRevision + 1, currentGeneration, true, true);
			});
		},
		async ackPartitionBundle({
			bindingKey,
			updateId,
			acknowledgedAt,
		}: {
			bindingKey: string;
			updateId: Uint8Array;
			acknowledgedAt: number;
		}) {
			assertTimestamp(acknowledgedAt);
			const id = bytesHex(updateId);
			await transact("readwrite", async (store) => {
				await request(store.delete(bundleKey(bindingKey, id)));
				await request(
					store.put(
						Object.freeze({
							kind: "tombstone",
							expiresAt: acknowledgedAt + CRDT_OFFLINE_HORIZON_MS,
						} satisfies TombstoneRecord),
						tombstoneKey(bindingKey, id),
					),
				);
			});
		},
		async ackPartitionBundles({
			bindingKey,
			updateIds,
			acknowledgedAt,
		}: {
			bindingKey: string;
			updateIds: readonly Uint8Array[];
			acknowledgedAt: number;
		}) {
			assertTimestamp(acknowledgedAt);
			const ids = updateIds.map(bytesHex);
			if (new Set(ids).size !== ids.length) {
				throw new Error("Duplicate CRDT bundle ACK");
			}
			await transact("readwrite", async (store) => {
				for (const id of ids) {
					await request(store.delete(bundleKey(bindingKey, id)));
					await request(
						store.put(
							Object.freeze({
								kind: "tombstone",
								expiresAt: acknowledgedAt + CRDT_OFFLINE_HORIZON_MS,
							} satisfies TombstoneRecord),
							tombstoneKey(bindingKey, id),
						),
					);
				}
			});
		},
		async purgePartition(bindingKey: string) {
			await transact("readwrite", async (store) => {
				const existing = await request<BasisRecord | PurgedRecord | undefined>(
					store.get(basisKey(bindingKey)),
				);
				if (
					existing !== undefined &&
					!isBasisRecord(existing) &&
					!isPurgedRecord(existing)
				) {
					throw new Error("Invalid CRDT partition head");
				}
				await request(
					store.put(
						Object.freeze({
							kind: "purged",
							revision: (existing?.revision ?? 0) + 1,
							generation: (existing?.generation ?? 0) + 1,
						} satisfies PurgedRecord),
						basisKey(bindingKey),
					),
				);
				for (const [key] of await partitionRecords(store, bindingKey)) {
					await request(store.delete(key));
				}
			});
		},
	});
}

async function partitionRecords(
	store: IDBObjectStore,
	bindingKey: string,
): Promise<readonly (readonly [string, unknown])[]> {
	const prefix = partitionPrefix(bindingKey);
	const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
	const [keys, values] = await Promise.all([
		request<IDBValidKey[]>(store.getAllKeys(range)),
		request<unknown[]>(store.getAll(range)),
	]);
	if (
		keys.length !== values.length ||
		keys.some((key) => typeof key !== "string")
	) {
		throw new Error("Invalid CRDT partition records");
	}
	return Object.freeze(
		keys.map(
			(key, index) =>
				Object.freeze([key as string, values[index]]) as readonly [
					string,
					unknown,
				],
		),
	);
}

export function isCrdtPartitionBasisMonotonic(
	previous: unknown,
	next: unknown,
	liveBundles: readonly unknown[],
): boolean {
	if (
		!isPartitionDocument(previous) ||
		!isPartitionDocument(next) ||
		!Array.isArray(liveBundles)
	) {
		return false;
	}
	const touchedSlots = liveBundleFieldSlots(liveBundles);
	if (!touchedSlots) return false;
	const previousEpoch = parseCounter(previous.aggregateEpoch);
	const nextEpoch = parseCounter(next.aggregateEpoch);
	if (previousEpoch === undefined || nextEpoch === undefined) return false;
	if (
		nextEpoch < previousEpoch ||
		next.schemaVersion < previous.schemaVersion
	) {
		return false;
	}
	if (nextEpoch > previousEpoch) return liveBundles.length === 0;
	if (next.schemaVersion > previous.schemaVersion) return true;
	const previousCursors = fieldCursorMap(previous.fields);
	const nextCursors = fieldCursorMap(next.fields);
	if (!previousCursors || !nextCursors) return false;
	return [...nextCursors].every(([fieldSlot, after]) => {
		const before = previousCursors.get(fieldSlot);
		if (!before) return true;
		if (after.epoch < before.epoch) return false;
		if (after.epoch > before.epoch) return !touchedSlots.has(fieldSlot);
		return after.cursor >= before.cursor;
	});
}

function fieldCursorMap(
	fields: PartitionDocument["fields"],
): Map<number, Readonly<{ epoch: bigint; cursor: bigint }>> | undefined {
	const result = new Map<number, Readonly<{ epoch: bigint; cursor: bigint }>>();
	for (const field of fields) {
		const epoch = parseCounter(field.fieldEpoch);
		const cursor = parseCounter(field.fieldCursor);
		if (
			epoch === undefined ||
			cursor === undefined ||
			result.has(field.fieldSlot)
		) {
			return undefined;
		}
		result.set(field.fieldSlot, Object.freeze({ epoch, cursor }));
	}
	return result;
}

function liveBundleFieldSlots(
	bundles: readonly unknown[],
): ReadonlySet<number> | undefined {
	const slots = new Set<number>();
	for (const bundle of bundles) {
		if (!bundle || typeof bundle !== "object") return undefined;
		const parts = (bundle as { parts?: unknown }).parts;
		if (!Array.isArray(parts)) return undefined;
		for (const part of parts) {
			if (
				!part ||
				typeof part !== "object" ||
				!Number.isSafeInteger((part as { fieldSlot?: unknown }).fieldSlot) ||
				(part as { fieldSlot: number }).fieldSlot < 1
			) {
				return undefined;
			}
			slots.add((part as { fieldSlot: number }).fieldSlot);
		}
	}
	return slots;
}

type PartitionDocument = Readonly<{
	aggregateEpoch: string;
	schemaVersion: number;
	fields: readonly Readonly<{
		fieldSlot: number;
		fieldEpoch: string;
		fieldCursor: string;
	}>[];
	pending: readonly unknown[];
}>;

function isPartitionDocument(value: unknown): value is PartitionDocument {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<PartitionDocument>;
	return (
		typeof candidate.aggregateEpoch === "string" &&
		Number.isSafeInteger(candidate.schemaVersion) &&
		Array.isArray(candidate.fields) &&
		candidate.fields.every(
			(field) =>
				Boolean(field) &&
				typeof field === "object" &&
				Number.isSafeInteger(field.fieldSlot) &&
				typeof field.fieldEpoch === "string" &&
				typeof field.fieldCursor === "string",
		) &&
		Array.isArray(candidate.pending)
	);
}

function isBasisRecord(value: unknown): value is BasisRecord {
	return (
		Boolean(value) &&
		typeof value === "object" &&
		(value as BasisRecord).kind === "basis" &&
		isRevision((value as BasisRecord).revision) &&
		isRevision((value as BasisRecord).generation) &&
		typeof (value as BasisRecord).exactKey === "string" &&
		isStoredDocument((value as BasisRecord).document)
	);
}

function isPurgedRecord(value: unknown): value is PurgedRecord {
	return (
		Boolean(value) &&
		typeof value === "object" &&
		(value as PurgedRecord).kind === "purged" &&
		isRevision((value as PurgedRecord).revision) &&
		isRevision((value as PurgedRecord).generation)
	);
}

function isBundleRecord(value: unknown): value is BundleRecord {
	return (
		Boolean(value) &&
		typeof value === "object" &&
		(value as BundleRecord).kind === "bundle" &&
		Object.hasOwn(value as object, "bundle")
	);
}

function isTombstoneRecord(value: unknown): value is TombstoneRecord {
	return (
		Boolean(value) &&
		typeof value === "object" &&
		(value as TombstoneRecord).kind === "tombstone" &&
		Number.isSafeInteger((value as TombstoneRecord).expiresAt)
	);
}

function bundleId(value: unknown): string {
	if (
		!value ||
		typeof value !== "object" ||
		!((value as { updateId?: unknown }).updateId instanceof Uint8Array)
	) {
		throw new Error("Invalid CRDT bundle id");
	}
	return bytesHex((value as { updateId: Uint8Array }).updateId);
}

function compareBundles(left: unknown, right: unknown): number {
	const leftCreated = bundleCreatedAt(left);
	const rightCreated = bundleCreatedAt(right);
	return (
		leftCreated - rightCreated || bundleId(left).localeCompare(bundleId(right))
	);
}

function bundleCreatedAt(value: unknown): number {
	if (
		!value ||
		typeof value !== "object" ||
		!Number.isSafeInteger((value as { createdAt?: unknown }).createdAt)
	) {
		throw new Error("Invalid CRDT bundle timestamp");
	}
	return (value as { createdAt: number }).createdAt;
}

function equalStoredValue(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (left instanceof Uint8Array && right instanceof Uint8Array) {
		return (
			left.byteLength === right.byteLength &&
			left.every((byte, index) => byte === right[index])
		);
	}
	if (Array.isArray(left) && Array.isArray(right)) {
		return (
			left.length === right.length &&
			left.every((value, index) => equalStoredValue(value, right[index]))
		);
	}
	if (
		!left ||
		!right ||
		typeof left !== "object" ||
		typeof right !== "object" ||
		Array.isArray(left) ||
		Array.isArray(right)
	) {
		return false;
	}
	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	return (
		leftKeys.length === rightKeys.length &&
		leftKeys.every(
			(key) =>
				Object.hasOwn(right, key) &&
				equalStoredValue(
					(left as Record<string, unknown>)[key],
					(right as Record<string, unknown>)[key],
				),
		)
	);
}

function parseCounter(value: string): bigint | undefined {
	return /^(0|[1-9][0-9]*)$/.test(value) ? BigInt(value) : undefined;
}

function assertTimestamp(value: number): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error("Invalid CRDT storage time");
	}
}

function assertRevision(value: number): void {
	if (!isRevision(value)) throw new Error("Invalid CRDT storage revision");
}

function isRevision(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function emptyPartition(): CrdtClientStoredPartition {
	return Object.freeze({ revision: 0, generation: 0 });
}

function commitResult(
	revision: number,
	generation: number,
	basisAccepted: boolean,
	bundlesAccepted: boolean,
): CrdtClientPartitionCommitResult {
	return Object.freeze({
		revision,
		generation,
		basisAccepted,
		bundlesAccepted,
	});
}

function bytesHex(bytes: Uint8Array): string {
	if (bytes.byteLength !== 16) throw new Error("Invalid CRDT bundle id");
	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function basisKey(bindingKey: string): string {
	return `basis\u0000${bindingKey}`;
}

function partitionPrefix(bindingKey: string): string {
	return `partition\u0000${bindingKey}\u0000`;
}

function bundleKey(bindingKey: string, id: string): string {
	return `${partitionPrefix(bindingKey)}bundle\u0000${id}`;
}

function tombstoneKey(bindingKey: string, id: string): string {
	return `${partitionPrefix(bindingKey)}tombstone\u0000${id}`;
}

function bundleIdFromKey(key: string): string {
	return key.slice(key.lastIndexOf("\u0000") + 1);
}

async function transact<T>(
	mode: IDBTransactionMode,
	operation: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
	if (typeof indexedDB === "undefined") {
		throw new Error("IndexedDB is unavailable");
	}
	const database = await openDatabase();
	const transaction = database.transaction(STORE_NAME, mode);
	try {
		const result = await operation(transaction.objectStore(STORE_NAME));
		await transactionDone(transaction);
		return result;
	} catch (error) {
		try {
			transaction.abort();
		} catch {
			// The transaction already aborted or completed.
		}
		throw error;
	} finally {
		database.close();
	}
}

function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const pending = indexedDB.open(DATABASE_NAME, 1);
		pending.addEventListener(
			"upgradeneeded",
			() => {
				if (!pending.result.objectStoreNames.contains(STORE_NAME)) {
					pending.result.createObjectStore(STORE_NAME);
				}
			},
			{ once: true },
		);
		pending.addEventListener("success", () => resolve(pending.result), {
			once: true,
		});
		pending.addEventListener(
			"error",
			() => reject(pending.error ?? new Error("IndexedDB failed")),
			{ once: true },
		);
	});
}

function request<T>(pending: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		pending.addEventListener("success", () => resolve(pending.result), {
			once: true,
		});
		pending.addEventListener(
			"error",
			() => reject(pending.error ?? new Error("IndexedDB request failed")),
			{ once: true },
		);
	});
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.addEventListener("complete", () => resolve(), { once: true });
		transaction.addEventListener(
			"abort",
			() =>
				reject(transaction.error ?? new Error("IndexedDB transaction aborted")),
			{ once: true },
		);
		transaction.addEventListener(
			"error",
			() =>
				reject(transaction.error ?? new Error("IndexedDB transaction failed")),
			{ once: true },
		);
	});
}

export function isStoredDocument(
	value: unknown,
): value is CrdtClientStoredDocument {
	return (
		Boolean(value) &&
		typeof value === "object" &&
		(value as CrdtClientStoredDocument).version === 1 &&
		Number.isSafeInteger((value as CrdtClientStoredDocument).updatedAt) &&
		(value as CrdtClientStoredDocument).updatedAt >= 0
	);
}
