import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import type { AnyDrizzleClient } from "#questpie/server/config/types.js";
import type {
	CrdtEngineFormat,
	CrdtFieldEngine,
} from "#questpie/shared/crdt-engine.js";

import { createDeterministicSetEngine } from "./deterministic-engine.js";
import {
	createCrdtSnapshotManifestChecksum,
	CrdtDurableStoreConflictError,
	CrdtDurableTransactionStore,
} from "./durable-store.js";
import type {
	CrdtDesiredManifest,
	CrdtDesiredManifestField,
} from "./manifest.js";
import {
	questpieCrdtBindingTable,
	questpieCrdtResourceEpochTable,
	questpieCrdtResourceTable,
	questpieCrdtSchemaFieldTable,
	questpieCrdtSchemaTable,
	questpieCrdtSnapshotManifestTable,
	questpieCrdtSnapshotTable,
} from "./schema.js";

type CrdtDatabase = AnyDrizzleClient<any>;
type CrdtCanonicalValue = string | readonly string[];

export type CrdtOwnerCanonicalState = Readonly<{
	locator: string;
	values: Readonly<Record<string, unknown>>;
}>;

export type StagedCrdtOwnerActivation = Readonly<{
	resourceId: string;
	manifest: CrdtDesiredManifest;
	fields: readonly StagedCrdtOwnerField[];
}>;

type StagedCrdtOwnerField = Readonly<{
	manifestField: CrdtDesiredManifestField;
	engineId: string;
	engineVersion: number;
	stateVersion: number;
	snapshot: Uint8Array;
	snapshotChecksum: Uint8Array;
	canonicalHash: Uint8Array;
	stateBytes: number;
	elementCount: number;
}>;

export type CrdtOwnerActivationIdentity = Readonly<{
	resourceId: string;
	resourceEpochId: string;
	schemaId: string;
}>;

const stagedActivationIntegrity = new WeakMap<object, Uint8Array>();

export async function stageCrdtOwnerActivation(input: {
	manifest: CrdtDesiredManifest;
	resourceId: string;
	values: Readonly<Record<string, unknown>>;
	textEngine?: CrdtFieldEngine<"text", string>;
}): Promise<StagedCrdtOwnerActivation> {
	assertUuid(input.resourceId, "CRDT resource ID");
	const setEngine = createDeterministicSetEngine();
	const fields = await Promise.all(
		input.manifest.fields.map(async (field) => {
			if (field.format === "text") {
				if (!input.textEngine) {
					throw new TypeError("CRDT text activation requires a text engine");
				}
				return stageActivationField({
					field,
					engine: input.textEngine,
					value: canonicalValue("text", input.values[field.sourcePath]),
				});
			}
			return stageActivationField({
				field,
				engine: setEngine,
				value: canonicalValue("set", input.values[field.sourcePath]),
			});
		}),
	);
	const staged = Object.freeze({
		resourceId: input.resourceId,
		manifest: input.manifest,
		fields: Object.freeze(fields),
	});
	stagedActivationIntegrity.set(staged, activationDigest(staged));
	return staged;
}

/**
 * Transaction-bound lifecycle port. The caller owns the surrounding owner
 * transaction and must invoke this only after its final application callback.
 */
export class CrdtOwnerLifecycleTransaction {
	constructor(private readonly db: CrdtDatabase) {}

	async activate(input: {
		staged: StagedCrdtOwnerActivation;
		owner: CrdtOwnerCanonicalState;
		mode: "create" | "ensure";
	}): Promise<CrdtOwnerActivationIdentity> {
		const staged = snapshotAndVerifyStagedActivation(input.staged);
		const locator = canonicalLocator(
			staged.manifest.owner.kind,
			input.owner.locator,
		);
		for (const field of staged.fields) {
			const rawValue = input.owner.values[field.manifestField.sourcePath];
			const value =
				field.manifestField.format === "text"
					? canonicalValue("text", rawValue)
					: canonicalValue("set", rawValue);
			if (
				!equalBytes(
					field.canonicalHash,
					hashCanonicalValue(field.manifestField.format, value),
				)
			) {
				throw conflict(
					`locked owner value changed after CRDT staging (${field.manifestField.sourcePath})`,
				);
			}
		}

		const { definitionId, schemaId } = await this.registerCurrentManifest(
			staged.manifest,
		);
		const locatorHash = sha256(new TextEncoder().encode(locator));
		const [inserted] = await this.db
			.insert(questpieCrdtResourceTable)
			.values({
				id: staged.resourceId,
				definitionId,
				locator,
				locatorHash: Buffer.from(locatorHash),
				identityVersion: staged.manifest.owner.identityVersion,
				status: 3,
			})
			.onConflictDoNothing()
			.returning({ id: questpieCrdtResourceTable.id });
		if (!inserted) {
			const [existing] = await this.db
				.select({
					id: questpieCrdtResourceTable.id,
					locator: questpieCrdtResourceTable.locator,
					identityVersion: questpieCrdtResourceTable.identityVersion,
					status: questpieCrdtResourceTable.status,
					currentEpochId: questpieCrdtResourceTable.currentEpochId,
				})
				.from(questpieCrdtResourceTable)
				.where(
					and(
						eq(questpieCrdtResourceTable.definitionId, definitionId),
						eq(questpieCrdtResourceTable.locatorHash, Buffer.from(locatorHash)),
						sql`${questpieCrdtResourceTable.retiredAt} IS NULL`,
					),
				)
				.for("update");
			if (
				input.mode === "create" ||
				!existing ||
				existing.locator !== locator ||
				existing.identityVersion !== staged.manifest.owner.identityVersion ||
				existing.status !== 1 ||
				!existing.currentEpochId
			) {
				throw conflict("CRDT resource incarnation already exists");
			}
			await this.assertExistingActivation({
				resourceId: existing.id,
				schemaId,
				fields: staged.fields,
			});
			return Object.freeze({
				resourceId: existing.id,
				resourceEpochId: existing.currentEpochId,
				schemaId,
			});
		}

		const resourceEpochId = randomUUID();
		await this.db.insert(questpieCrdtResourceEpochTable).values({
			id: resourceEpochId,
			resourceId: staged.resourceId,
			definitionId,
			aggregateEpoch: 1n,
			schemaId,
			status: 1,
		});

		const schemaFields = await this.db
			.select({
				id: questpieCrdtSchemaFieldTable.id,
				stableFieldId: questpieCrdtSchemaFieldTable.stableFieldId,
			})
			.from(questpieCrdtSchemaFieldTable)
			.where(eq(questpieCrdtSchemaFieldTable.schemaId, schemaId));
		const schemaFieldIds = new Map(
			schemaFields.map((field) => [field.stableFieldId, field.id]),
		);
		const bindings = staged.fields.map((field) => {
			const schemaFieldId = schemaFieldIds.get(
				field.manifestField.stableFieldId,
			);
			if (!schemaFieldId) {
				throw conflict("CRDT schema field registration is incomplete");
			}
			return Object.freeze({
				id: randomUUID(),
				schemaFieldId,
				field,
			});
		});
		await this.db.insert(questpieCrdtBindingTable).values(
			bindings.map(({ id, schemaFieldId, field }) => ({
				id,
				resourceId: staged.resourceId,
				definitionId,
				schemaId,
				schemaFieldId,
				stableFieldId: field.manifestField.stableFieldId,
				fieldSlot: field.manifestField.fieldSlot,
				sourcePath: field.manifestField.sourcePath,
				format: formatNumber(field.manifestField.format),
				formatVersion: field.manifestField.formatVersion,
				fieldEpoch: 1n,
				canonicalHash: Buffer.from(field.canonicalHash),
				projectedCanonicalHash: Buffer.from(field.canonicalHash),
				status: 1,
				stateBytes: BigInt(field.stateBytes),
				elementCount: BigInt(field.elementCount),
			})),
		);

		const manifestId = randomUUID();
		const snapshotFields = bindings.map(({ id, field }) => ({
			bindingId: id,
			stableFieldId: field.manifestField.stableFieldId,
			fieldEpoch: 1n,
			fieldSlot: field.manifestField.fieldSlot,
			formatVersion: field.manifestField.formatVersion,
			fieldCursor: 0n,
			engineId: field.engineId,
			engineVersion: field.engineVersion,
			stateVersion: field.stateVersion,
			sizeBytes: field.stateBytes,
			checksum: field.snapshotChecksum,
		}));
		const manifestChecksum = createCrdtSnapshotManifestChecksum({
			resourceId: staged.resourceId,
			resourceEpochId,
			schemaId,
			coversCommitSeq: 0n,
			fields: snapshotFields,
		});
		await this.db.insert(questpieCrdtSnapshotManifestTable).values({
			id: manifestId,
			resourceId: staged.resourceId,
			resourceEpochId,
			definitionId,
			schemaId,
			coversCommitSeq: 0n,
			status: 2,
			totalBytes: staged.fields.reduce(
				(total, field) => total + field.stateBytes,
				0,
			),
			fieldCount: staged.fields.length,
			checksum: Buffer.from(manifestChecksum),
			leaseGeneration: 0n,
			verifiedAt: sql`now()`,
		});
		await this.db.insert(questpieCrdtSnapshotTable).values(
			bindings.map(({ id, field }) => ({
				manifestId,
				resourceId: staged.resourceId,
				resourceEpochId,
				schemaId,
				bindingId: id,
				stableFieldId: field.manifestField.stableFieldId,
				fieldEpoch: 1n,
				fieldSlot: field.manifestField.fieldSlot,
				formatVersion: field.manifestField.formatVersion,
				fieldCursor: 0n,
				engineId: field.engineId,
				engineVersion: field.engineVersion,
				stateVersion: field.stateVersion,
				bytes: Buffer.from(field.snapshot),
				sizeBytes: field.stateBytes,
				checksum: Buffer.from(field.snapshotChecksum),
			})),
		);
		await this.db
			.update(questpieCrdtResourceEpochTable)
			.set({
				currentSnapshotManifestId: manifestId,
				currentSnapshotStatus: 2,
				updatedAt: sql`now()`,
			})
			.where(
				and(
					eq(questpieCrdtResourceEpochTable.resourceId, staged.resourceId),
					eq(questpieCrdtResourceEpochTable.id, resourceEpochId),
				),
			);
		await this.db
			.update(questpieCrdtResourceTable)
			.set({
				status: 1,
				currentEpochId: resourceEpochId,
				currentEpochStatus: 1,
				updatedAt: sql`now()`,
			})
			.where(eq(questpieCrdtResourceTable.id, staged.resourceId));

		return Object.freeze({
			resourceId: staged.resourceId,
			resourceEpochId,
			schemaId,
		});
	}

	private async registerCurrentManifest(
		manifest: CrdtDesiredManifest,
	): Promise<{ definitionId: string; schemaId: string }> {
		const store = new CrdtDurableTransactionStore(this.db);
		const identity = await store.registerDefinitionSchema({
			namespace: manifest.namespace,
			owner: manifest.owner,
			schema: {
				version: BigInt(manifest.version),
				fingerprint: manifest.fingerprint,
				fields: manifest.fields.map((field) => ({
					stableFieldId: field.stableFieldId,
					fieldSlot: field.fieldSlot,
					sourcePath: field.sourcePath,
					format: formatNumber(field.format),
					formatVersion: field.formatVersion,
					codecFingerprint: field.codecFingerprint,
				})),
			},
		});
		const [latest] = await this.db
			.select({
				version: questpieCrdtSchemaTable.schemaVersion,
				fingerprint: questpieCrdtSchemaTable.schemaFingerprint,
			})
			.from(questpieCrdtSchemaTable)
			.where(eq(questpieCrdtSchemaTable.definitionId, identity.definitionId))
			.orderBy(desc(questpieCrdtSchemaTable.schemaVersion))
			.limit(1)
			.for("update");
		if (
			!latest ||
			latest.version !== BigInt(manifest.version) ||
			!equalBytes(latest.fingerprint, manifest.fingerprint)
		) {
			throw conflict(
				"CRDT runtime manifest is not the latest persisted schema",
			);
		}
		if (manifest.version > 1) {
			const [predecessor] = await this.db
				.select({
					fingerprint: questpieCrdtSchemaTable.schemaFingerprint,
				})
				.from(questpieCrdtSchemaTable)
				.where(
					and(
						eq(questpieCrdtSchemaTable.definitionId, identity.definitionId),
						eq(
							questpieCrdtSchemaTable.schemaVersion,
							BigInt(manifest.version - 1),
						),
					),
				);
			if (
				!predecessor ||
				!manifest.predecessorFingerprint ||
				!equalBytes(predecessor.fingerprint, manifest.predecessorFingerprint)
			) {
				throw conflict("CRDT manifest predecessor is not persisted exactly");
			}
		}
		return identity;
	}

	private async assertExistingActivation(input: {
		resourceId: string;
		schemaId: string;
		fields: readonly StagedCrdtOwnerField[];
	}): Promise<void> {
		const bindings = await this.db
			.select({
				schemaId: questpieCrdtBindingTable.schemaId,
				stableFieldId: questpieCrdtBindingTable.stableFieldId,
				canonicalHash: questpieCrdtBindingTable.canonicalHash,
			})
			.from(questpieCrdtBindingTable)
			.where(
				and(
					eq(questpieCrdtBindingTable.resourceId, input.resourceId),
					sql`${questpieCrdtBindingTable.retiredAt} IS NULL`,
				),
			)
			.orderBy(questpieCrdtBindingTable.fieldSlot)
			.for("update");
		if (
			bindings.length !== input.fields.length ||
			bindings.some((binding, index) => {
				const field = input.fields[index];
				return (
					!field ||
					binding.schemaId !== input.schemaId ||
					binding.stableFieldId !== field.manifestField.stableFieldId ||
					!equalBytes(binding.canonicalHash, field.canonicalHash)
				);
			})
		) {
			throw conflict(
				"existing CRDT activation does not match the locked owner",
			);
		}
	}
}

export function canonicalCrdtCollectionLocator(id: string | number): string {
	if (
		(typeof id !== "string" && typeof id !== "number") ||
		(typeof id === "number" && !Number.isSafeInteger(id))
	) {
		throw new TypeError("CRDT collection locator must be a string or integer");
	}
	return JSON.stringify([
		"id",
		typeof id === "string" ? "string" : "number",
		id,
	]);
}

export function canonicalCrdtGlobalLocator(): string {
	return '["global"]';
}

function canonicalLocator(kind: 1 | 2, locator: string): string {
	const expected = kind === 2 ? canonicalCrdtGlobalLocator() : locator;
	if (locator !== expected) {
		throw new TypeError("CRDT owner locator is not schema-canonical");
	}
	const bytes = new TextEncoder().encode(locator).byteLength;
	if (bytes < 1 || bytes > 4096) {
		throw new TypeError("CRDT owner locator exceeds the 4 KiB limit");
	}
	return locator;
}

function canonicalValue(format: "text", value: unknown): string;
function canonicalValue(format: "set", value: unknown): string[];
function canonicalValue(
	format: CrdtEngineFormat,
	value: unknown,
): CrdtCanonicalValue {
	if (format === "text") {
		if (typeof value !== "string") {
			throw new TypeError("CRDT canonical text value must be a string");
		}
		return value;
	}
	if (
		!Array.isArray(value) ||
		value.some((entry) => typeof entry !== "string")
	) {
		throw new TypeError("CRDT canonical set value must be a string array");
	}
	const sorted = [...new Set(value)].sort(compareUtf8);
	if (
		sorted.length !== value.length ||
		sorted.some((entry, index) => entry !== value[index])
	) {
		throw new TypeError(
			"CRDT canonical set value must be duplicate-free UTF-8 order",
		);
	}
	return Object.freeze(sorted) as unknown as string[];
}

function hashCanonicalValue(
	format: CrdtEngineFormat,
	value: CrdtCanonicalValue,
): Uint8Array {
	const hash = createHash("sha256");
	hash.update("questpie-crdt-canonical-value-v1\0");
	hash.update(format);
	hash.update("\0");
	if (format === "text") {
		hash.update(value as string, "utf8");
	} else {
		const values = value as readonly string[];
		writeU32(hash, values.length);
		for (const entry of values) {
			const bytes = Buffer.from(entry, "utf8");
			writeU32(hash, bytes.byteLength);
			hash.update(bytes);
		}
	}
	return hash.digest();
}

function assertEngineContract(
	field: CrdtDesiredManifestField,
	engine: CrdtFieldEngine,
): void {
	if (
		engine.engineId !== field.engineId ||
		engine.engineVersion !== field.engineVersion ||
		engine.format !== field.format ||
		engine.formatVersion !== field.formatVersion ||
		engine.codecFingerprint !==
			Buffer.from(field.codecFingerprint).toString("hex")
	) {
		throw new TypeError(
			`CRDT engine does not match checked-in manifest (${field.sourcePath})`,
		);
	}
}

async function stageActivationField<
	TFormat extends CrdtEngineFormat,
	TValue extends TFormat extends "text" ? string : string[],
>(input: {
	field: CrdtDesiredManifestField & { format: TFormat };
	engine: CrdtFieldEngine<TFormat, TValue>;
	value: TValue;
}): Promise<StagedCrdtOwnerField> {
	assertEngineContract(input.field, input.engine);
	const replica = await input.engine.create({
		value: input.value,
		basis: { fieldEpoch: 1n, fieldCursor: 0n },
	});
	const snapshot = new Uint8Array(await input.engine.snapshot(replica));
	const projected =
		input.field.format === "text"
			? canonicalValue("text", input.engine.project(replica))
			: canonicalValue("set", input.engine.project(replica));
	const canonicalHash = hashCanonicalValue(input.field.format, input.value);
	if (
		!equalBytes(
			canonicalHash,
			hashCanonicalValue(input.field.format, projected),
		)
	) {
		throw new TypeError(
			`CRDT engine projection does not preserve ${input.field.sourcePath}`,
		);
	}
	return Object.freeze({
		manifestField: input.field,
		engineId: input.engine.engineId,
		engineVersion: input.engine.engineVersion,
		stateVersion: input.engine.stateVersion,
		snapshot,
		snapshotChecksum: sha256(snapshot),
		canonicalHash,
		stateBytes: snapshot.byteLength,
		elementCount: input.field.format === "set" ? input.value.length : 0,
	});
}

function snapshotAndVerifyStagedActivation(
	staged: StagedCrdtOwnerActivation,
): StagedCrdtOwnerActivation {
	const expected = stagedActivationIntegrity.get(staged);
	if (!expected || !equalBytes(expected, activationDigest(staged))) {
		throw new TypeError("CRDT owner activation proof is invalid");
	}
	return Object.freeze({
		resourceId: staged.resourceId,
		manifest: staged.manifest,
		fields: Object.freeze(
			staged.fields.map((field) =>
				Object.freeze({
					...field,
					snapshot: new Uint8Array(field.snapshot),
					snapshotChecksum: new Uint8Array(field.snapshotChecksum),
					canonicalHash: new Uint8Array(field.canonicalHash),
				}),
			),
		),
	});
}

function activationDigest(staged: StagedCrdtOwnerActivation): Uint8Array {
	const hash = createHash("sha256");
	hash.update("questpie-crdt-owner-activation-v1\0");
	hash.update(staged.resourceId);
	hash.update("\0");
	hash.update(staged.manifest.namespace);
	hash.update("\0");
	hash.update(String(staged.manifest.owner.kind));
	hash.update("\0");
	hash.update(staged.manifest.owner.key);
	hash.update("\0");
	writeU32(hash, staged.manifest.owner.identityVersion);
	hash.update(staged.manifest.fingerprint);
	for (const field of staged.fields) {
		hash.update(field.manifestField.stableFieldId);
		hash.update("\0");
		writeU32(hash, field.manifestField.fieldSlot);
		hash.update(field.canonicalHash);
		hash.update(field.snapshotChecksum);
		writeU32(hash, field.stateBytes);
		writeU32(hash, field.elementCount);
	}
	return hash.digest();
}

function formatNumber(format: CrdtEngineFormat): 1 | 2 {
	return format === "text" ? 1 : 2;
}

function compareUtf8(left: string, right: string): number {
	return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function sha256(value: Uint8Array): Uint8Array {
	return createHash("sha256").update(value).digest();
}

function writeU32(hash: ReturnType<typeof createHash>, value: number): void {
	const bytes = Buffer.allocUnsafe(4);
	bytes.writeUInt32BE(value);
	hash.update(bytes);
}

function assertUuid(value: string, label: string): void {
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
			value,
		)
	) {
		throw new TypeError(`${label} must be a UUID`);
	}
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	return (
		left.byteLength === right.byteLength &&
		left.every((value, index) => value === right[index])
	);
}

function conflict(message: string): CrdtDurableStoreConflictError {
	return new CrdtDurableStoreConflictError(message);
}
