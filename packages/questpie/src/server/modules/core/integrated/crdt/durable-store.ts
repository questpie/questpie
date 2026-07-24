import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { AnyDrizzleClient } from "#questpie/server/config/types.js";

import {
	questpieCrdtBindingTable,
	questpieCrdtDefinitionTable,
	questpieCrdtLeaseTable,
	questpieCrdtNamespaceTable,
	questpieCrdtResourceEpochTable,
	questpieCrdtSchemaFieldTable,
	questpieCrdtSchemaTable,
	questpieCrdtSnapshotManifestTable,
	questpieCrdtSnapshotTable,
} from "./schema.js";

type CrdtDatabase = AnyDrizzleClient<any>;

export type CrdtDefinitionSchemaInput = {
	readonly namespace: string;
	readonly owner: {
		readonly kind: 1 | 2;
		readonly key: string;
		readonly identityVersion: number;
	};
	readonly schema: {
		readonly version: bigint;
		readonly fingerprint: Uint8Array;
		readonly fields: readonly CrdtSchemaFieldInput[];
	};
};

export type CrdtSchemaFieldInput = {
	readonly stableFieldId: string;
	readonly fieldSlot: number;
	readonly sourcePath: string;
	readonly format: 1 | 2;
	readonly formatVersion: number;
	readonly codecFingerprint: Uint8Array;
};

export type CrdtDefinitionSchemaIdentity = {
	readonly definitionId: string;
	readonly schemaId: string;
};

export type PublishVerifiedSnapshotInput = {
	readonly resourceId: string;
	readonly resourceEpochId: string;
	readonly schemaId: string;
	readonly manifestId: string;
	readonly manifestChecksum: Uint8Array;
	readonly coversCommitSeq: bigint;
	readonly expectedHeadCommitSeq: bigint;
	readonly leaseOwnerId: string;
	readonly leaseGeneration: bigint;
	readonly fields: readonly CrdtSnapshotCutField[];
};

export type CrdtSnapshotCutField = {
	readonly bindingId: string;
	readonly stableFieldId: string;
	readonly fieldEpoch: bigint;
	readonly fieldSlot: number;
	readonly formatVersion: number;
	readonly fieldCursor: bigint;
	readonly engineId: string;
	readonly engineVersion: number;
	readonly stateVersion: number;
	readonly sizeBytes: number;
	readonly checksum: Uint8Array;
};

export class CrdtDurableStoreConflictError extends Error {
	readonly code = "CRDT_DURABLE_STORE_CONFLICT";

	constructor(message: string) {
		super(message);
		this.name = "CrdtDurableStoreConflictError";
	}
}

export function createCrdtDurableStore(db: CrdtDatabase) {
	return Object.freeze({
		transaction<T>(
			callback: (store: CrdtDurableTransactionStore) => Promise<T>,
		): Promise<T> {
			return db.transaction((tx) =>
				callback(new CrdtDurableTransactionStore(tx as CrdtDatabase)),
			);
		},
	});
}

export class CrdtDurableTransactionStore {
	constructor(private readonly db: CrdtDatabase) {}

	async registerDefinitionSchema(
		input: CrdtDefinitionSchemaInput,
	): Promise<CrdtDefinitionSchemaIdentity> {
		const candidate = snapshotInput(input);
		await this.ensureNamespace(candidate.namespace);

		await this.db
			.insert(questpieCrdtDefinitionTable)
			.values({
				namespaceSingleton: 1,
				ownerKind: candidate.owner.kind,
				ownerKey: candidate.owner.key,
				identityVersion: candidate.owner.identityVersion,
			})
			.onConflictDoNothing();

		const [definition] = await this.db
			.select({
				id: questpieCrdtDefinitionTable.id,
				identityVersion: questpieCrdtDefinitionTable.identityVersion,
			})
			.from(questpieCrdtDefinitionTable)
			.where(
				and(
					eq(questpieCrdtDefinitionTable.namespaceSingleton, 1),
					eq(questpieCrdtDefinitionTable.ownerKind, candidate.owner.kind),
					eq(questpieCrdtDefinitionTable.ownerKey, candidate.owner.key),
				),
			);
		if (!definition) {
			throw conflict("owner definition could not be registered");
		}
		if (definition.identityVersion !== candidate.owner.identityVersion) {
			throw conflict("owner definition identity version is immutable");
		}

		await this.db
			.insert(questpieCrdtSchemaTable)
			.values({
				definitionId: definition.id,
				schemaVersion: candidate.schema.version,
				schemaFingerprint: Buffer.from(candidate.schema.fingerprint),
			})
			.onConflictDoNothing();

		const [schema] = await this.db
			.select({
				id: questpieCrdtSchemaTable.id,
				fingerprint: questpieCrdtSchemaTable.schemaFingerprint,
			})
			.from(questpieCrdtSchemaTable)
			.where(
				and(
					eq(questpieCrdtSchemaTable.definitionId, definition.id),
					eq(questpieCrdtSchemaTable.schemaVersion, candidate.schema.version),
				),
			);
		if (!schema) {
			throw conflict(
				"schema fingerprint is already bound to another schema version",
			);
		}
		if (!equalBytes(schema.fingerprint, candidate.schema.fingerprint)) {
			throw conflict(
				"schema version is permanently bound to another fingerprint",
			);
		}

		if (candidate.schema.fields.length > 0) {
			await this.db
				.insert(questpieCrdtSchemaFieldTable)
				.values(
					candidate.schema.fields.map((field) => ({
						definitionId: definition.id,
						schemaId: schema.id,
						stableFieldId: field.stableFieldId,
						fieldSlot: field.fieldSlot,
						sourcePath: field.sourcePath,
						format: field.format,
						formatVersion: field.formatVersion,
						codecFingerprint: Buffer.from(field.codecFingerprint),
					})),
				)
				.onConflictDoNothing();
		}

		const storedFields = await this.db
			.select({
				stableFieldId: questpieCrdtSchemaFieldTable.stableFieldId,
				fieldSlot: questpieCrdtSchemaFieldTable.fieldSlot,
				sourcePath: questpieCrdtSchemaFieldTable.sourcePath,
				format: questpieCrdtSchemaFieldTable.format,
				formatVersion: questpieCrdtSchemaFieldTable.formatVersion,
				codecFingerprint: questpieCrdtSchemaFieldTable.codecFingerprint,
			})
			.from(questpieCrdtSchemaFieldTable)
			.where(eq(questpieCrdtSchemaFieldTable.schemaId, schema.id))
			.orderBy(asc(questpieCrdtSchemaFieldTable.fieldSlot));

		if (!equalFields(storedFields, candidate.schema.fields)) {
			throw conflict("schema field manifest is immutable");
		}

		return Object.freeze({
			definitionId: definition.id,
			schemaId: schema.id,
		});
	}

	async publishVerifiedSnapshot(input: PublishVerifiedSnapshotInput): Promise<{
		readonly currentManifestId: string;
		readonly previousManifestId: string | null;
	}> {
		const candidate = snapshotPublicationInput(input);
		const [epoch] = await this.db
			.select({
				currentManifestId:
					questpieCrdtResourceEpochTable.currentSnapshotManifestId,
				currentStatus: questpieCrdtResourceEpochTable.currentSnapshotStatus,
				previousManifestId:
					questpieCrdtResourceEpochTable.previousSnapshotManifestId,
			})
			.from(questpieCrdtResourceEpochTable)
			.where(
				and(
					eq(questpieCrdtResourceEpochTable.resourceId, candidate.resourceId),
					eq(questpieCrdtResourceEpochTable.id, candidate.resourceEpochId),
					eq(questpieCrdtResourceEpochTable.schemaId, candidate.schemaId),
					eq(
						questpieCrdtResourceEpochTable.headCommitSeq,
						candidate.expectedHeadCommitSeq,
					),
					eq(questpieCrdtResourceEpochTable.status, 1),
				),
			)
			.for("update");
		if (!epoch) {
			throw conflict("snapshot publication basis is stale");
		}

		const [lease] = await this.db
			.select({
				expiresAt: questpieCrdtLeaseTable.expiresAt,
			})
			.from(questpieCrdtLeaseTable)
			.where(
				and(
					eq(questpieCrdtLeaseTable.resourceId, candidate.resourceId),
					eq(questpieCrdtLeaseTable.kind, 1),
					eq(questpieCrdtLeaseTable.ownerId, candidate.leaseOwnerId),
					eq(questpieCrdtLeaseTable.generation, candidate.leaseGeneration),
				),
			)
			.for("update");
		if (!lease) {
			throw conflict("snapshot publication lease is stale");
		}
		const [databaseClock] = await this.db
			.select({
				leaseIsCurrent: sql<boolean>`${questpieCrdtLeaseTable.expiresAt} > clock_timestamp()`,
			})
			.from(questpieCrdtLeaseTable)
			.where(
				and(
					eq(questpieCrdtLeaseTable.resourceId, candidate.resourceId),
					eq(questpieCrdtLeaseTable.kind, 1),
				),
			);
		if (!databaseClock || !databaseClock.leaseIsCurrent) {
			throw conflict("snapshot publication lease is stale");
		}

		const [manifest] = await this.db
			.select({
				id: questpieCrdtSnapshotManifestTable.id,
				fieldCount: questpieCrdtSnapshotManifestTable.fieldCount,
				totalBytes: questpieCrdtSnapshotManifestTable.totalBytes,
				checksum: questpieCrdtSnapshotManifestTable.checksum,
			})
			.from(questpieCrdtSnapshotManifestTable)
			.where(
				and(
					eq(
						questpieCrdtSnapshotManifestTable.resourceId,
						candidate.resourceId,
					),
					eq(
						questpieCrdtSnapshotManifestTable.resourceEpochId,
						candidate.resourceEpochId,
					),
					eq(questpieCrdtSnapshotManifestTable.id, candidate.manifestId),
					eq(questpieCrdtSnapshotManifestTable.schemaId, candidate.schemaId),
					eq(
						questpieCrdtSnapshotManifestTable.coversCommitSeq,
						candidate.coversCommitSeq,
					),
					eq(questpieCrdtSnapshotManifestTable.status, 2),
					eq(
						questpieCrdtSnapshotManifestTable.leaseGeneration,
						candidate.leaseGeneration,
					),
				),
			);
		if (
			!manifest ||
			!equalBytes(manifest.checksum, candidate.manifestChecksum) ||
			candidate.coversCommitSeq > candidate.expectedHeadCommitSeq
		) {
			throw conflict(
				"snapshot manifest is not the verified publication candidate",
			);
		}

		const activeBindings = await this.db
			.select({
				bindingId: questpieCrdtBindingTable.id,
				schemaId: questpieCrdtBindingTable.schemaId,
				stableFieldId: questpieCrdtBindingTable.stableFieldId,
				fieldEpoch: questpieCrdtBindingTable.fieldEpoch,
				fieldSlot: questpieCrdtBindingTable.fieldSlot,
				formatVersion: questpieCrdtBindingTable.formatVersion,
				fieldCursor: questpieCrdtBindingTable.headFieldCursor,
			})
			.from(questpieCrdtBindingTable)
			.where(
				and(
					eq(questpieCrdtBindingTable.resourceId, candidate.resourceId),
					inArray(questpieCrdtBindingTable.status, [1, 3]),
					isNull(questpieCrdtBindingTable.retiredAt),
				),
			)
			.orderBy(asc(questpieCrdtBindingTable.id));
		const snapshots = await this.db
			.select({
				bindingId: questpieCrdtSnapshotTable.bindingId,
				schemaId: questpieCrdtSnapshotTable.schemaId,
				stableFieldId: questpieCrdtSnapshotTable.stableFieldId,
				fieldEpoch: questpieCrdtSnapshotTable.fieldEpoch,
				fieldSlot: questpieCrdtSnapshotTable.fieldSlot,
				formatVersion: questpieCrdtSnapshotTable.formatVersion,
				fieldCursor: questpieCrdtSnapshotTable.fieldCursor,
				engineId: questpieCrdtSnapshotTable.engineId,
				engineVersion: questpieCrdtSnapshotTable.engineVersion,
				stateVersion: questpieCrdtSnapshotTable.stateVersion,
				bytes: questpieCrdtSnapshotTable.bytes,
				sizeBytes: questpieCrdtSnapshotTable.sizeBytes,
				checksum: questpieCrdtSnapshotTable.checksum,
			})
			.from(questpieCrdtSnapshotTable)
			.where(eq(questpieCrdtSnapshotTable.manifestId, manifest.id))
			.orderBy(asc(questpieCrdtSnapshotTable.bindingId));
		if (
			snapshots.length !== manifest.fieldCount ||
			activeBindings.length !== manifest.fieldCount ||
			candidate.fields.length !== manifest.fieldCount ||
			snapshots.reduce((total, snapshot) => total + snapshot.sizeBytes, 0) !==
				manifest.totalBytes ||
			snapshots.some((snapshot, index) => {
				const binding = activeBindings[index];
				const captured = candidate.fields[index];
				return (
					!binding ||
					!captured ||
					snapshot.bindingId !== binding.bindingId ||
					!equalSnapshotField(snapshot, captured, candidate.schemaId) ||
					!equalBytes(sha256(snapshot.bytes), snapshot.checksum) ||
					!equalBindingCut(binding, captured, candidate.schemaId)
				);
			})
		) {
			throw conflict("verified snapshot manifest is incomplete");
		}
		if (epoch.currentManifestId === manifest.id) {
			return Object.freeze({
				currentManifestId: manifest.id,
				previousManifestId: epoch.previousManifestId,
			});
		}

		const [published] = await this.db
			.update(questpieCrdtResourceEpochTable)
			.set({
				previousSnapshotManifestId: epoch.currentManifestId,
				previousSnapshotStatus: epoch.currentManifestId
					? epoch.currentStatus
					: null,
				currentSnapshotManifestId: manifest.id,
				currentSnapshotStatus: 2,
				updatedAt: sql`now()`,
			})
			.where(
				and(
					eq(questpieCrdtResourceEpochTable.resourceId, candidate.resourceId),
					eq(questpieCrdtResourceEpochTable.id, candidate.resourceEpochId),
					eq(
						questpieCrdtResourceEpochTable.headCommitSeq,
						candidate.expectedHeadCommitSeq,
					),
				),
			)
			.returning({
				currentManifestId:
					questpieCrdtResourceEpochTable.currentSnapshotManifestId,
				previousManifestId:
					questpieCrdtResourceEpochTable.previousSnapshotManifestId,
			});
		if (!published?.currentManifestId) {
			throw conflict("snapshot publication compare-and-swap failed");
		}
		return Object.freeze({
			currentManifestId: published.currentManifestId,
			previousManifestId: published.previousManifestId,
		});
	}

	private async ensureNamespace(namespace: string): Promise<void> {
		await this.db
			.insert(questpieCrdtNamespaceTable)
			.values({ singleton: 1, namespace })
			.onConflictDoNothing();

		const [stored] = await this.db
			.select({ namespace: questpieCrdtNamespaceTable.namespace })
			.from(questpieCrdtNamespaceTable)
			.where(eq(questpieCrdtNamespaceTable.singleton, 1));
		if (!stored || stored.namespace !== namespace) {
			throw conflict(`database CRDT namespace does not match "${namespace}"`);
		}
	}
}

export function createCrdtSnapshotManifestChecksum(input: {
	readonly resourceId: string;
	readonly resourceEpochId: string;
	readonly schemaId: string;
	readonly coversCommitSeq: bigint;
	readonly fields: readonly CrdtSnapshotCutField[];
}): Uint8Array {
	const hash = createHash("sha256");
	hash.update("questpie-crdt-snapshot-manifest-v1\0");
	hash.update(input.resourceId);
	hash.update("\0");
	hash.update(input.resourceEpochId);
	hash.update("\0");
	hash.update(input.schemaId);
	hash.update("\0");
	hash.update(u64(input.coversCommitSeq));
	const fields = [...input.fields].sort((left, right) =>
		left.bindingId.localeCompare(right.bindingId),
	);
	hash.update(u32(fields.length));
	for (const field of fields) {
		hash.update(field.bindingId);
		hash.update("\0");
		hash.update(field.stableFieldId);
		hash.update("\0");
		hash.update(u64(field.fieldEpoch));
		hash.update(u32(field.fieldSlot));
		hash.update(u32(field.formatVersion));
		hash.update(u64(field.fieldCursor));
		hash.update(field.engineId);
		hash.update("\0");
		hash.update(u32(field.engineVersion));
		hash.update(u32(field.stateVersion));
		hash.update(u32(field.sizeBytes));
		hash.update(field.checksum);
	}
	return hash.digest();
}

function snapshotPublicationInput(
	input: PublishVerifiedSnapshotInput,
): PublishVerifiedSnapshotInput {
	validateFingerprint(input.manifestChecksum, "manifest checksum");
	validateAscii(input.leaseOwnerId, 256, "lease owner ID");
	validateUuid(input.resourceId, "snapshot resource ID");
	validateUuid(input.resourceEpochId, "snapshot resource epoch ID");
	validateUuid(input.schemaId, "snapshot schema ID");
	validateUuid(input.manifestId, "snapshot manifest ID");
	validateU64(input.coversCommitSeq, "snapshot commit cursor");
	validateU64(input.expectedHeadCommitSeq, "snapshot head commit cursor");
	validateU64(input.leaseGeneration, "snapshot lease generation");
	if (input.fields.length < 1 || input.fields.length > 32) {
		throw new TypeError("snapshot cut must contain between 1 and 32 fields");
	}
	const bindingIds = new Set<string>();
	const stableFieldIds = new Set<string>();
	const fields = [...input.fields]
		.map((field) => {
			validateUuid(field.bindingId, "snapshot binding ID");
			validateUuid(field.stableFieldId, "snapshot stable field ID");
			validateFingerprint(field.checksum, "snapshot checksum");
			validateAscii(field.engineId, 128, "snapshot engine ID");
			if (
				!Number.isInteger(field.fieldSlot) ||
				field.fieldSlot < 1 ||
				field.fieldSlot > 65_535 ||
				!Number.isInteger(field.formatVersion) ||
				field.formatVersion < 0 ||
				field.formatVersion > 65_535 ||
				!Number.isInteger(field.engineVersion) ||
				field.engineVersion < 0 ||
				field.engineVersion > 65_535 ||
				!Number.isInteger(field.stateVersion) ||
				field.stateVersion < 0 ||
				field.stateVersion > 65_535 ||
				!Number.isInteger(field.sizeBytes) ||
				field.sizeBytes < 0 ||
				field.sizeBytes > 25_165_824
			) {
				throw new TypeError("snapshot field cut contains an invalid counter");
			}
			validateU64(field.fieldEpoch, "snapshot field epoch");
			validateU64(field.fieldCursor, "snapshot field cursor");
			if (
				bindingIds.has(field.bindingId) ||
				stableFieldIds.has(field.stableFieldId)
			) {
				throw new TypeError(
					"snapshot field cut must contain unique bindings and stable fields",
				);
			}
			bindingIds.add(field.bindingId);
			stableFieldIds.add(field.stableFieldId);
			return Object.freeze({
				...field,
				checksum: field.checksum.slice(),
			});
		})
		.sort((left, right) => left.bindingId.localeCompare(right.bindingId));
	const expectedManifestChecksum = createCrdtSnapshotManifestChecksum({
		resourceId: input.resourceId,
		resourceEpochId: input.resourceEpochId,
		schemaId: input.schemaId,
		coversCommitSeq: input.coversCommitSeq,
		fields,
	});
	if (!equalBytes(input.manifestChecksum, expectedManifestChecksum)) {
		throw new TypeError(
			"manifest checksum does not match the captured snapshot cut",
		);
	}
	return Object.freeze({
		...input,
		manifestChecksum: input.manifestChecksum.slice(),
		fields: Object.freeze(fields),
	});
}

function equalSnapshotField(
	stored: {
		bindingId: string;
		schemaId: string;
		stableFieldId: string;
		fieldEpoch: bigint;
		fieldSlot: number;
		formatVersion: number;
		fieldCursor: bigint;
		engineId: string;
		engineVersion: number;
		stateVersion: number;
		bytes: Uint8Array;
		sizeBytes: number;
		checksum: Uint8Array;
	},
	captured: PublishVerifiedSnapshotInput["fields"][number],
	schemaId: string,
): boolean {
	return (
		stored.schemaId === schemaId &&
		stored.bindingId === captured.bindingId &&
		stored.stableFieldId === captured.stableFieldId &&
		stored.fieldEpoch === captured.fieldEpoch &&
		stored.fieldSlot === captured.fieldSlot &&
		stored.formatVersion === captured.formatVersion &&
		stored.fieldCursor === captured.fieldCursor &&
		stored.engineId === captured.engineId &&
		stored.engineVersion === captured.engineVersion &&
		stored.stateVersion === captured.stateVersion &&
		stored.sizeBytes === captured.sizeBytes &&
		equalBytes(stored.checksum, captured.checksum)
	);
}

function equalBindingCut(
	stored: {
		bindingId: string;
		schemaId: string;
		stableFieldId: string;
		fieldEpoch: bigint;
		fieldSlot: number;
		formatVersion: number;
		fieldCursor: bigint;
	},
	captured: PublishVerifiedSnapshotInput["fields"][number],
	schemaId: string,
): boolean {
	return (
		stored.schemaId === schemaId &&
		stored.bindingId === captured.bindingId &&
		stored.stableFieldId === captured.stableFieldId &&
		stored.fieldEpoch === captured.fieldEpoch &&
		stored.fieldSlot === captured.fieldSlot &&
		stored.formatVersion === captured.formatVersion &&
		stored.fieldCursor === captured.fieldCursor
	);
}

function snapshotInput(
	input: CrdtDefinitionSchemaInput,
): CrdtDefinitionSchemaInput {
	validateAscii(input.namespace, 64, "namespace");
	validateAscii(input.owner.key, 128, "owner key");
	if (input.owner.kind !== 1 && input.owner.kind !== 2) {
		throw new TypeError("owner kind must identify a collection or global");
	}
	if (
		!Number.isInteger(input.owner.identityVersion) ||
		input.owner.identityVersion < 1
	) {
		throw new TypeError("owner identity version must be a positive integer");
	}
	if (input.schema.version < 0n || input.schema.version > 4_294_967_295n) {
		throw new TypeError("schema version must be an unsigned 32-bit bigint");
	}
	validateFingerprint(input.schema.fingerprint, "schema fingerprint");
	if (input.schema.fields.length < 1 || input.schema.fields.length > 32) {
		throw new TypeError("schema must contain between 1 and 32 CRDT fields");
	}

	const slots = new Set<number>();
	const stableIds = new Set<string>();
	const paths = new Set<string>();
	const fields = [...input.schema.fields]
		.map((field) => {
			validateUuid(field.stableFieldId, "stable field ID");
			if (field.format !== 1 && field.format !== 2) {
				throw new TypeError("field format must identify text or add-wins set");
			}
			if (
				!Number.isInteger(field.fieldSlot) ||
				field.fieldSlot < 1 ||
				field.fieldSlot > 65_535
			) {
				throw new TypeError(
					"field slot must be an unsigned non-zero 16-bit integer",
				);
			}
			if (
				!Number.isInteger(field.formatVersion) ||
				field.formatVersion < 0 ||
				field.formatVersion > 65_535
			) {
				throw new TypeError(
					"field format version must be an unsigned 16-bit integer",
				);
			}
			if (new TextEncoder().encode(field.sourcePath).byteLength > 256) {
				throw new TypeError(
					"field source path must be between 1 and 256 UTF-8 bytes",
				);
			}
			if (field.sourcePath.length === 0) {
				throw new TypeError(
					"field source path must be between 1 and 256 UTF-8 bytes",
				);
			}
			validateFingerprint(field.codecFingerprint, "codec fingerprint");
			if (
				slots.has(field.fieldSlot) ||
				stableIds.has(field.stableFieldId) ||
				paths.has(field.sourcePath)
			) {
				throw new TypeError(
					"schema fields must have unique slots, stable IDs, and source paths",
				);
			}
			slots.add(field.fieldSlot);
			stableIds.add(field.stableFieldId);
			paths.add(field.sourcePath);
			return Object.freeze({
				...field,
				codecFingerprint: field.codecFingerprint.slice(),
			});
		})
		.sort((left, right) => left.fieldSlot - right.fieldSlot);

	return Object.freeze({
		namespace: input.namespace,
		owner: Object.freeze({ ...input.owner }),
		schema: Object.freeze({
			version: input.schema.version,
			fingerprint: input.schema.fingerprint.slice(),
			fields: Object.freeze(fields),
		}),
	});
}

function equalFields(
	stored: readonly {
		stableFieldId: string;
		fieldSlot: number;
		sourcePath: string;
		format: number;
		formatVersion: number;
		codecFingerprint: Uint8Array;
	}[],
	expected: readonly CrdtSchemaFieldInput[],
): boolean {
	return (
		stored.length === expected.length &&
		stored.every((field, index) => {
			const candidate = expected[index];
			return (
				candidate !== undefined &&
				field.stableFieldId === candidate.stableFieldId &&
				field.fieldSlot === candidate.fieldSlot &&
				field.sourcePath === candidate.sourcePath &&
				field.format === candidate.format &&
				field.formatVersion === candidate.formatVersion &&
				equalBytes(field.codecFingerprint, candidate.codecFingerprint)
			);
		})
	);
}

function validateAscii(value: string, maxBytes: number, label: string): void {
	if (
		value.length < 1 ||
		value.length > maxBytes ||
		!/^[\x21-\x7e]+$/.test(value)
	) {
		throw new TypeError(
			`${label} must contain between 1 and ${maxBytes} printable ASCII bytes`,
		);
	}
}

function validateFingerprint(value: Uint8Array, label: string): void {
	if (!(value instanceof Uint8Array) || value.byteLength !== 32) {
		throw new TypeError(`${label} must contain exactly 32 bytes`);
	}
}

function validateUuid(value: string, label: string): void {
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			value,
		)
	) {
		throw new TypeError(`${label} must be a canonical UUID`);
	}
}

function validateU64(value: bigint, label: string): void {
	if (
		typeof value !== "bigint" ||
		value < 0n ||
		value > 18_446_744_073_709_551_615n
	) {
		throw new TypeError(`${label} must be an unsigned 64-bit bigint`);
	}
}

function u32(value: number): Uint8Array {
	const result = Buffer.allocUnsafe(4);
	result.writeUInt32BE(value);
	return result;
}

function u64(value: bigint): Uint8Array {
	const result = Buffer.allocUnsafe(8);
	result.writeBigUInt64BE(value);
	return result;
}

function sha256(value: Uint8Array): Uint8Array {
	return createHash("sha256").update(value).digest();
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) return false;
	return left.every((value, index) => value === right[index]);
}

function conflict(message: string): CrdtDurableStoreConflictError {
	return new CrdtDurableStoreConflictError(message);
}
