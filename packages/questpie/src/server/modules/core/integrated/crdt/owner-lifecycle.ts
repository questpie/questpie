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
	questpieCrdtCommitTable,
	questpieCrdtDefinitionTable,
	questpieCrdtResourceEpochTable,
	questpieCrdtResourceTable,
	questpieCrdtSchemaCompatibilityFieldTable,
	questpieCrdtSchemaCompatibilityTable,
	questpieCrdtSchemaFieldTable,
	questpieCrdtSchemaTable,
	questpieCrdtSessionTable,
	questpieCrdtSnapshotManifestTable,
	questpieCrdtSnapshotTable,
} from "./schema.js";

type CrdtDatabase = AnyDrizzleClient<any>;
type CrdtCanonicalValue = string | readonly string[];
const MAX_AGGREGATE_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const SCHEMA_COMPATIBILITY_HORIZON_DAYS = 30;

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
	const totalBytes = fields.reduce(
		(total, field) => total + field.stateBytes,
		0,
	);
	if (totalBytes > MAX_AGGREGATE_SNAPSHOT_BYTES) {
		throw new TypeError("CRDT aggregate snapshot exceeds 32 MiB");
	}
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
		assertStagedOwnerValues(staged, input.owner.values);

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
			return this.ensureExistingActivation({
				resourceId: existing.id,
				resourceEpochId: existing.currentEpochId,
				definitionId,
				schemaId,
				staged,
				fields: staged.fields,
			});
		}

		const identity = await this.createActiveEpoch({
			resourceId: staged.resourceId,
			definitionId,
			schemaId,
			aggregateEpoch: 1n,
			staged,
			fieldEpochs: new Map(
				staged.fields.map((field) => [field.manifestField.stableFieldId, 1n]),
			),
		});
		await this.db
			.update(questpieCrdtResourceTable)
			.set({
				status: 1,
				currentEpochId: identity.resourceEpochId,
				currentEpochStatus: 1,
				updatedAt: sql`now()`,
			})
			.where(eq(questpieCrdtResourceTable.id, staged.resourceId));

		return identity;
	}

	async retire(input: {
		manifest: CrdtDesiredManifest;
		locator: string;
	}): Promise<CrdtOwnerActivationIdentity> {
		const locator = canonicalLocator(input.manifest.owner.kind, input.locator);
		const [definition] = await this.db
			.select({
				id: questpieCrdtDefinitionTable.id,
				identityVersion: questpieCrdtDefinitionTable.identityVersion,
			})
			.from(questpieCrdtDefinitionTable)
			.where(
				and(
					eq(questpieCrdtDefinitionTable.ownerKind, input.manifest.owner.kind),
					eq(questpieCrdtDefinitionTable.ownerKey, input.manifest.owner.key),
				),
			);
		if (
			!definition ||
			definition.identityVersion !== input.manifest.owner.identityVersion
		) {
			throw conflict("CRDT owner definition is not active");
		}

		const locatorHash = Buffer.from(sha256(new TextEncoder().encode(locator)));
		const [resource] = await this.db
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
					eq(questpieCrdtResourceTable.definitionId, definition.id),
					eq(questpieCrdtResourceTable.locatorHash, locatorHash),
					sql`${questpieCrdtResourceTable.retiredAt} IS NULL`,
				),
			)
			.for("update");
		if (
			!resource?.currentEpochId ||
			resource.locator !== locator ||
			resource.identityVersion !== input.manifest.owner.identityVersion ||
			resource.status !== 1
		) {
			throw conflict("CRDT resource incarnation is not active");
		}

		const [epoch] = await this.db
			.select({
				id: questpieCrdtResourceEpochTable.id,
				schemaId: questpieCrdtResourceEpochTable.schemaId,
				status: questpieCrdtResourceEpochTable.status,
			})
			.from(questpieCrdtResourceEpochTable)
			.where(
				and(
					eq(questpieCrdtResourceEpochTable.resourceId, resource.id),
					eq(questpieCrdtResourceEpochTable.id, resource.currentEpochId),
				),
			)
			.for("update");
		if (!epoch || epoch.status !== 1) {
			throw conflict("CRDT resource epoch is not active");
		}
		await this.db
			.select({ id: questpieCrdtBindingTable.id })
			.from(questpieCrdtBindingTable)
			.where(
				and(
					eq(questpieCrdtBindingTable.resourceId, resource.id),
					sql`${questpieCrdtBindingTable.retiredAt} IS NULL`,
				),
			)
			.orderBy(questpieCrdtBindingTable.stableFieldId)
			.for("update");

		await this.db
			.update(questpieCrdtResourceTable)
			.set({
				status: 2,
				currentEpochId: null,
				currentEpochStatus: null,
				readFence: sql`${questpieCrdtResourceTable.readFence} + 1`,
				editFence: sql`${questpieCrdtResourceTable.editFence} + 1`,
				retiredAt: sql`now()`,
				updatedAt: sql`now()`,
			})
			.where(eq(questpieCrdtResourceTable.id, resource.id));
		await this.db
			.update(questpieCrdtResourceEpochTable)
			.set({ status: 2, closedAt: sql`now()`, updatedAt: sql`now()` })
			.where(eq(questpieCrdtResourceEpochTable.id, epoch.id));
		await this.db
			.update(questpieCrdtBindingTable)
			.set({
				status: 2,
				readFence: sql`${questpieCrdtBindingTable.readFence} + 1`,
				editFence: sql`${questpieCrdtBindingTable.editFence} + 1`,
				retiredAt: sql`now()`,
				updatedAt: sql`now()`,
			})
			.where(
				and(
					eq(questpieCrdtBindingTable.resourceId, resource.id),
					sql`${questpieCrdtBindingTable.retiredAt} IS NULL`,
				),
			);
		await this.db
			.update(questpieCrdtSessionTable)
			.set({
				closedAt: sql`now()`,
				closeReason: 1,
				updatedAt: sql`now()`,
			})
			.where(
				and(
					eq(questpieCrdtSessionTable.resourceId, resource.id),
					sql`${questpieCrdtSessionTable.closedAt} IS NULL`,
				),
			);

		return Object.freeze({
			resourceId: resource.id,
			resourceEpochId: epoch.id,
			schemaId: epoch.schemaId,
		});
	}

	async restore(input: {
		staged: StagedCrdtOwnerActivation;
		owner: CrdtOwnerCanonicalState;
	}): Promise<CrdtOwnerActivationIdentity> {
		const staged = snapshotAndVerifyStagedActivation(input.staged);
		const locator = canonicalLocator(
			staged.manifest.owner.kind,
			input.owner.locator,
		);
		assertStagedOwnerValues(staged, input.owner.values);
		const { definitionId, schemaId } = await this.registerCurrentManifest(
			staged.manifest,
		);
		const locatorHash = Buffer.from(sha256(new TextEncoder().encode(locator)));
		const [resource] = await this.db
			.select({
				id: questpieCrdtResourceTable.id,
				locator: questpieCrdtResourceTable.locator,
				identityVersion: questpieCrdtResourceTable.identityVersion,
				status: questpieCrdtResourceTable.status,
			})
			.from(questpieCrdtResourceTable)
			.where(
				and(
					eq(questpieCrdtResourceTable.definitionId, definitionId),
					eq(questpieCrdtResourceTable.locatorHash, locatorHash),
					sql`${questpieCrdtResourceTable.retiredAt} IS NOT NULL`,
				),
			)
			.orderBy(desc(questpieCrdtResourceTable.createdAt))
			.limit(1)
			.for("update");
		if (
			!resource ||
			resource.locator !== locator ||
			resource.identityVersion !== staged.manifest.owner.identityVersion ||
			resource.status !== 2
		) {
			throw conflict("CRDT retired incarnation is not restorable");
		}

		const [previousEpoch] = await this.db
			.select({
				aggregateEpoch: questpieCrdtResourceEpochTable.aggregateEpoch,
			})
			.from(questpieCrdtResourceEpochTable)
			.where(eq(questpieCrdtResourceEpochTable.resourceId, resource.id))
			.orderBy(desc(questpieCrdtResourceEpochTable.aggregateEpoch))
			.limit(1)
			.for("update");
		if (!previousEpoch) {
			throw conflict("CRDT retired incarnation has no epoch history");
		}
		const previousBindings = await this.db
			.select({
				stableFieldId: questpieCrdtBindingTable.stableFieldId,
				fieldEpoch: questpieCrdtBindingTable.fieldEpoch,
			})
			.from(questpieCrdtBindingTable)
			.where(eq(questpieCrdtBindingTable.resourceId, resource.id))
			.orderBy(questpieCrdtBindingTable.stableFieldId)
			.for("update");
		const fieldEpochs = new Map<string, bigint>();
		for (const binding of previousBindings) {
			const next = binding.fieldEpoch + 1n;
			if ((fieldEpochs.get(binding.stableFieldId) ?? 0n) < next) {
				fieldEpochs.set(binding.stableFieldId, next);
			}
		}
		for (const field of staged.fields) {
			if (!fieldEpochs.has(field.manifestField.stableFieldId)) {
				fieldEpochs.set(field.manifestField.stableFieldId, 1n);
			}
		}

		const identity = await this.createActiveEpoch({
			resourceId: resource.id,
			definitionId,
			schemaId,
			aggregateEpoch: previousEpoch.aggregateEpoch + 1n,
			staged,
			fieldEpochs,
		});
		await this.db
			.update(questpieCrdtResourceTable)
			.set({
				status: 1,
				currentEpochId: identity.resourceEpochId,
				currentEpochStatus: 1,
				readFence: sql`${questpieCrdtResourceTable.readFence} + 1`,
				editFence: sql`${questpieCrdtResourceTable.editFence} + 1`,
				retiredAt: null,
				updatedAt: sql`now()`,
			})
			.where(eq(questpieCrdtResourceTable.id, resource.id));
		return identity;
	}

	private async createActiveEpoch(input: {
		resourceId: string;
		definitionId: string;
		schemaId: string;
		aggregateEpoch: bigint;
		staged: StagedCrdtOwnerActivation;
		fieldEpochs: ReadonlyMap<string, bigint>;
	}): Promise<CrdtOwnerActivationIdentity> {
		const resourceEpochId = randomUUID();
		await this.db.insert(questpieCrdtResourceEpochTable).values({
			id: resourceEpochId,
			resourceId: input.resourceId,
			definitionId: input.definitionId,
			aggregateEpoch: input.aggregateEpoch,
			schemaId: input.schemaId,
			status: 1,
		});

		const schemaFields = await this.db
			.select({
				id: questpieCrdtSchemaFieldTable.id,
				stableFieldId: questpieCrdtSchemaFieldTable.stableFieldId,
			})
			.from(questpieCrdtSchemaFieldTable)
			.where(eq(questpieCrdtSchemaFieldTable.schemaId, input.schemaId));
		const schemaFieldIds = new Map(
			schemaFields.map((field) => [field.stableFieldId, field.id]),
		);
		const bindings = input.staged.fields.map((field) => {
			const stableFieldId = field.manifestField.stableFieldId;
			const schemaFieldId = schemaFieldIds.get(stableFieldId);
			const fieldEpoch = input.fieldEpochs.get(stableFieldId);
			if (!schemaFieldId || fieldEpoch === undefined) {
				throw conflict("CRDT schema field registration is incomplete");
			}
			return Object.freeze({
				id: randomUUID(),
				schemaFieldId,
				fieldEpoch,
				field,
			});
		});
		await this.db.insert(questpieCrdtBindingTable).values(
			bindings.map(({ id, schemaFieldId, fieldEpoch, field }) => ({
				id,
				resourceId: input.resourceId,
				definitionId: input.definitionId,
				schemaId: input.schemaId,
				schemaFieldId,
				stableFieldId: field.manifestField.stableFieldId,
				fieldSlot: field.manifestField.fieldSlot,
				sourcePath: field.manifestField.sourcePath,
				format: formatNumber(field.manifestField.format),
				formatVersion: field.manifestField.formatVersion,
				fieldEpoch,
				canonicalHash: Buffer.from(field.canonicalHash),
				projectedCanonicalHash: Buffer.from(field.canonicalHash),
				status: 1,
				stateBytes: BigInt(field.stateBytes),
				elementCount: BigInt(field.elementCount),
			})),
		);

		const manifestId = randomUUID();
		const snapshotFields = bindings.map(({ id, fieldEpoch, field }) => ({
			bindingId: id,
			stableFieldId: field.manifestField.stableFieldId,
			fieldEpoch,
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
			resourceId: input.resourceId,
			resourceEpochId,
			schemaId: input.schemaId,
			coversCommitSeq: 0n,
			fields: snapshotFields,
		});
		await this.db.insert(questpieCrdtSnapshotManifestTable).values({
			id: manifestId,
			resourceId: input.resourceId,
			resourceEpochId,
			definitionId: input.definitionId,
			schemaId: input.schemaId,
			coversCommitSeq: 0n,
			status: 2,
			totalBytes: input.staged.fields.reduce(
				(total, field) => total + field.stateBytes,
				0,
			),
			fieldCount: input.staged.fields.length,
			checksum: Buffer.from(manifestChecksum),
			leaseGeneration: 0n,
			verifiedAt: sql`now()`,
		});
		await this.db.insert(questpieCrdtSnapshotTable).values(
			bindings.map(({ id, fieldEpoch, field }) => ({
				manifestId,
				resourceId: input.resourceId,
				resourceEpochId,
				schemaId: input.schemaId,
				bindingId: id,
				stableFieldId: field.manifestField.stableFieldId,
				fieldEpoch,
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
					eq(questpieCrdtResourceEpochTable.resourceId, input.resourceId),
					eq(questpieCrdtResourceEpochTable.id, resourceEpochId),
				),
			);

		return Object.freeze({
			resourceId: input.resourceId,
			resourceEpochId,
			schemaId: input.schemaId,
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

	private async ensureExistingActivation(input: {
		resourceId: string;
		resourceEpochId: string;
		definitionId: string;
		schemaId: string;
		staged: StagedCrdtOwnerActivation;
		fields: readonly StagedCrdtOwnerField[];
	}): Promise<CrdtOwnerActivationIdentity> {
		const [epoch] = await this.db
			.select({
				schemaId: questpieCrdtResourceEpochTable.schemaId,
				status: questpieCrdtResourceEpochTable.status,
				headCommitSeq: questpieCrdtResourceEpochTable.headCommitSeq,
				projectedCommitSeq: questpieCrdtResourceEpochTable.projectedCommitSeq,
				currentSnapshotManifestId:
					questpieCrdtResourceEpochTable.currentSnapshotManifestId,
			})
			.from(questpieCrdtResourceEpochTable)
			.where(
				and(
					eq(questpieCrdtResourceEpochTable.resourceId, input.resourceId),
					eq(questpieCrdtResourceEpochTable.id, input.resourceEpochId),
				),
			)
			.for("update");
		if (!epoch || epoch.status !== 1) {
			throw conflict("existing CRDT activation has no current schema epoch");
		}
		const bindings = await this.db
			.select()
			.from(questpieCrdtBindingTable)
			.where(
				and(
					eq(questpieCrdtBindingTable.resourceId, input.resourceId),
					sql`${questpieCrdtBindingTable.retiredAt} IS NULL`,
				),
			)
			.orderBy(questpieCrdtBindingTable.stableFieldId)
			.for("update");
		if (epoch.schemaId !== input.schemaId) {
			return this.transitionManifest({
				...input,
				sourceSchemaId: epoch.schemaId,
				epoch,
				bindings,
			});
		}
		const fieldsByStableId = new Map(
			input.fields.map((field) => [field.manifestField.stableFieldId, field]),
		);
		if (
			bindings.length !== input.fields.length ||
			bindings.some((binding) => {
				const field = fieldsByStableId.get(binding.stableFieldId);
				return (
					!field ||
					binding.schemaId !== input.schemaId ||
					binding.stableFieldId !== field.manifestField.stableFieldId ||
					!equalBytes(binding.projectedCanonicalHash, field.canonicalHash)
				);
			})
		) {
			throw conflict(
				"existing CRDT activation does not match the locked owner",
			);
		}
		return Object.freeze({
			resourceId: input.resourceId,
			resourceEpochId: input.resourceEpochId,
			schemaId: input.schemaId,
		});
	}

	private async transitionManifest(input: {
		resourceId: string;
		resourceEpochId: string;
		definitionId: string;
		sourceSchemaId: string;
		schemaId: string;
		staged: StagedCrdtOwnerActivation;
		fields: readonly StagedCrdtOwnerField[];
		epoch: {
			headCommitSeq: bigint;
			projectedCommitSeq: bigint;
			currentSnapshotManifestId: string | null;
		};
		bindings: Array<typeof questpieCrdtBindingTable.$inferSelect>;
	}): Promise<CrdtOwnerActivationIdentity> {
		if (
			input.epoch.headCommitSeq !== input.epoch.projectedCommitSeq ||
			!input.epoch.currentSnapshotManifestId
		) {
			throw conflict(
				"CRDT manifest transition requires a fully projected verified cut",
			);
		}
		for (const binding of input.bindings) {
			if (
				binding.schemaId !== input.sourceSchemaId ||
				binding.status !== 1 ||
				binding.headFieldCursor !== binding.projectedFieldCursor ||
				binding.canonicalRevision !== binding.projectedCanonicalRevision ||
				!equalBytes(binding.canonicalHash, binding.projectedCanonicalHash)
			) {
				throw conflict(
					"CRDT manifest transition source binding is not quiescent",
				);
			}
		}

		const sourceSchemaFields = await this.db
			.select()
			.from(questpieCrdtSchemaFieldTable)
			.where(eq(questpieCrdtSchemaFieldTable.schemaId, input.sourceSchemaId));
		const targetSchemaFields = await this.db
			.select()
			.from(questpieCrdtSchemaFieldTable)
			.where(eq(questpieCrdtSchemaFieldTable.schemaId, input.schemaId));
		const [sourceSchema] = await this.db
			.select()
			.from(questpieCrdtSchemaTable)
			.where(eq(questpieCrdtSchemaTable.id, input.sourceSchemaId));
		const [targetSchema] = await this.db
			.select()
			.from(questpieCrdtSchemaTable)
			.where(eq(questpieCrdtSchemaTable.id, input.schemaId));
		if (
			!sourceSchema ||
			!targetSchema ||
			sourceSchema.definitionId !== input.definitionId ||
			targetSchema.definitionId !== input.definitionId ||
			targetSchema.schemaVersion <= sourceSchema.schemaVersion
		) {
			throw conflict("CRDT manifest transition schema order is invalid");
		}
		const sourceFieldsByStableId = new Map(
			sourceSchemaFields.map((field) => [field.stableFieldId, field]),
		);
		const targetFieldsByStableId = new Map(
			targetSchemaFields.map((field) => [field.stableFieldId, field]),
		);
		const stagedByStableId = new Map(
			input.fields.map((field) => [field.manifestField.stableFieldId, field]),
		);
		const sourceBindingsByStableId = new Map(
			input.bindings.map((binding) => [binding.stableFieldId, binding]),
		);
		if (
			sourceSchemaFields.length !== input.bindings.length ||
			sourceFieldsByStableId.size !== sourceSchemaFields.length ||
			sourceSchemaFields.some(
				(field) => !sourceBindingsByStableId.has(field.stableFieldId),
			)
		) {
			throw conflict("CRDT source schema binding set is incomplete");
		}
		for (const binding of input.bindings) {
			const sourceField = sourceFieldsByStableId.get(binding.stableFieldId);
			const targetField = targetFieldsByStableId.get(binding.stableFieldId);
			const stagedField = stagedByStableId.get(binding.stableFieldId);
			if (
				!sourceField ||
				!targetField ||
				!stagedField ||
				sourceField.fieldSlot !== targetField.fieldSlot ||
				sourceField.format !== targetField.format ||
				sourceField.formatVersion !== targetField.formatVersion ||
				!equalBytes(
					sourceField.codecFingerprint,
					targetField.codecFingerprint,
				) ||
				!equalBytes(binding.projectedCanonicalHash, stagedField.canonicalHash)
			) {
				throw conflict("CRDT manifest transition is not compatibility-safe");
			}
		}
		if (
			targetSchemaFields.length !== input.fields.length ||
			targetSchemaFields.some(
				(field) => !stagedByStableId.has(field.stableFieldId),
			)
		) {
			throw conflict("CRDT target schema fields are incomplete");
		}

		const [sourceManifest] = await this.db
			.select()
			.from(questpieCrdtSnapshotManifestTable)
			.where(
				and(
					eq(
						questpieCrdtSnapshotManifestTable.id,
						input.epoch.currentSnapshotManifestId,
					),
					eq(questpieCrdtSnapshotManifestTable.resourceId, input.resourceId),
					eq(
						questpieCrdtSnapshotManifestTable.resourceEpochId,
						input.resourceEpochId,
					),
				),
			);
		if (
			!sourceManifest ||
			sourceManifest.status !== 2 ||
			sourceManifest.schemaId !== input.sourceSchemaId ||
			sourceManifest.coversCommitSeq !== input.epoch.headCommitSeq ||
			sourceManifest.fieldCount !== input.bindings.length
		) {
			throw conflict(
				"CRDT manifest transition source snapshot is not head-covering",
			);
		}
		const sourceSnapshots = (
			await this.db
				.select()
				.from(questpieCrdtSnapshotTable)
				.where(eq(questpieCrdtSnapshotTable.manifestId, sourceManifest.id))
		).map((snapshot) => ({
			...snapshot,
			bytes: Buffer.from(snapshot.bytes),
			checksum: Buffer.from(snapshot.checksum),
		}));
		const sourceSnapshotsByBinding = new Map(
			sourceSnapshots.map((snapshot) => [snapshot.bindingId, snapshot]),
		);
		if (
			sourceSnapshots.length !== input.bindings.length ||
			input.bindings.some((binding) => {
				const snapshot = sourceSnapshotsByBinding.get(binding.id);
				return (
					!snapshot ||
					snapshot.schemaId !== input.sourceSchemaId ||
					snapshot.stableFieldId !== binding.stableFieldId ||
					snapshot.fieldEpoch !== binding.fieldEpoch ||
					snapshot.fieldCursor !== binding.headFieldCursor ||
					snapshot.sizeBytes !== snapshot.bytes.byteLength ||
					!equalBytes(snapshot.checksum, sha256(snapshot.bytes)) ||
					snapshot.engineId !==
						stagedByStableId.get(binding.stableFieldId)?.engineId ||
					snapshot.engineVersion !==
						stagedByStableId.get(binding.stableFieldId)?.engineVersion
				);
			})
		) {
			throw conflict("CRDT manifest transition source snapshot is invalid");
		}
		const sourceSnapshotCut = sourceSnapshots.map((snapshot) => ({
			bindingId: snapshot.bindingId,
			stableFieldId: snapshot.stableFieldId,
			fieldEpoch: snapshot.fieldEpoch,
			fieldSlot: snapshot.fieldSlot,
			formatVersion: snapshot.formatVersion,
			fieldCursor: snapshot.fieldCursor,
			engineId: snapshot.engineId,
			engineVersion: snapshot.engineVersion,
			stateVersion: snapshot.stateVersion,
			sizeBytes: snapshot.sizeBytes,
			checksum: snapshot.checksum,
		}));
		if (
			!equalBytes(
				sourceManifest.checksum,
				createCrdtSnapshotManifestChecksum({
					resourceId: input.resourceId,
					resourceEpochId: input.resourceEpochId,
					schemaId: input.sourceSchemaId,
					coversCommitSeq: input.epoch.headCommitSeq,
					fields: sourceSnapshotCut,
				}),
			) ||
			sourceManifest.totalBytes !==
				sourceSnapshots.reduce(
					(total, snapshot) => total + snapshot.sizeBytes,
					0,
				)
		) {
			throw conflict(
				"CRDT manifest transition source manifest checksum is invalid",
			);
		}

		const targetBindings = input.fields.map((field) => {
			const targetSchemaField = targetFieldsByStableId.get(
				field.manifestField.stableFieldId,
			);
			if (!targetSchemaField) {
				throw conflict("CRDT target schema field registration is incomplete");
			}
			const sourceBinding = sourceBindingsByStableId.get(
				field.manifestField.stableFieldId,
			);
			const sourceSnapshot = sourceBinding
				? sourceSnapshotsByBinding.get(sourceBinding.id)
				: undefined;
			if (sourceBinding && !sourceSnapshot) {
				throw conflict("CRDT source snapshot binding is missing");
			}
			return {
				id: randomUUID(),
				schemaFieldId: targetSchemaField.id,
				field,
				sourceBinding,
				fieldEpoch: sourceBinding ? sourceBinding.fieldEpoch + 1n : 1n,
				fieldCursor: sourceBinding?.headFieldCursor ?? 0n,
				snapshotBytes: Buffer.from(sourceSnapshot?.bytes ?? field.snapshot),
				snapshotChecksum: Buffer.from(
					sourceSnapshot?.checksum ?? field.snapshotChecksum,
				),
				engineId: sourceSnapshot?.engineId ?? field.engineId,
				engineVersion: sourceSnapshot?.engineVersion ?? field.engineVersion,
				stateVersion: sourceSnapshot?.stateVersion ?? field.stateVersion,
			};
		});
		const totalBytes = targetBindings.reduce(
			(total, binding) => total + binding.snapshotBytes.byteLength,
			0,
		);
		if (totalBytes > MAX_AGGREGATE_SNAPSHOT_BYTES) {
			throw conflict("CRDT target aggregate snapshot exceeds 32 MiB");
		}

		await this.db
			.update(questpieCrdtBindingTable)
			.set({
				status: 2,
				readFence: sql`${questpieCrdtBindingTable.readFence} + 1`,
				editFence: sql`${questpieCrdtBindingTable.editFence} + 1`,
				retiredAt: sql`now()`,
				updatedAt: sql`now()`,
			})
			.where(
				and(
					eq(questpieCrdtBindingTable.resourceId, input.resourceId),
					sql`${questpieCrdtBindingTable.retiredAt} IS NULL`,
				),
			);
		await this.db.insert(questpieCrdtBindingTable).values(
			targetBindings.map((binding) => ({
				id: binding.id,
				resourceId: input.resourceId,
				definitionId: input.definitionId,
				schemaId: input.schemaId,
				schemaFieldId: binding.schemaFieldId,
				stableFieldId: binding.field.manifestField.stableFieldId,
				fieldSlot: binding.field.manifestField.fieldSlot,
				sourcePath: binding.field.manifestField.sourcePath,
				format: formatNumber(binding.field.manifestField.format),
				formatVersion: binding.field.manifestField.formatVersion,
				fieldEpoch: binding.fieldEpoch,
				headFieldCursor: binding.fieldCursor,
				projectedFieldCursor: binding.fieldCursor,
				readFence: (binding.sourceBinding?.readFence ?? -1n) + 1n,
				editFence: (binding.sourceBinding?.editFence ?? -1n) + 1n,
				canonicalHash: Buffer.from(binding.field.canonicalHash),
				canonicalRevision: binding.sourceBinding?.canonicalRevision ?? 0n,
				projectedCanonicalHash: Buffer.from(binding.field.canonicalHash),
				projectedCanonicalRevision:
					binding.sourceBinding?.projectedCanonicalRevision ?? 0n,
				status: 1,
				stateBytes: BigInt(binding.snapshotBytes.byteLength),
				elementCount:
					binding.sourceBinding?.elementCount ??
					BigInt(binding.field.elementCount),
			})),
		);

		const manifestCommitSeq = input.epoch.headCommitSeq + 1n;
		const targetSnapshotFields = targetBindings.map((binding) => ({
			bindingId: binding.id,
			stableFieldId: binding.field.manifestField.stableFieldId,
			fieldEpoch: binding.fieldEpoch,
			fieldSlot: binding.field.manifestField.fieldSlot,
			formatVersion: binding.field.manifestField.formatVersion,
			fieldCursor: binding.fieldCursor,
			engineId: binding.engineId,
			engineVersion: binding.engineVersion,
			stateVersion: binding.stateVersion,
			sizeBytes: binding.snapshotBytes.byteLength,
			checksum: binding.snapshotChecksum,
		}));
		const targetManifestChecksum = createCrdtSnapshotManifestChecksum({
			resourceId: input.resourceId,
			resourceEpochId: input.resourceEpochId,
			schemaId: input.schemaId,
			coversCommitSeq: manifestCommitSeq,
			fields: targetSnapshotFields,
		});
		const mapping = targetBindings
			.filter(
				(
					binding,
				): binding is typeof binding & {
					sourceBinding: NonNullable<typeof binding.sourceBinding>;
				} => !!binding.sourceBinding,
			)
			.map((binding) => ({
				stableFieldId: binding.field.manifestField.stableFieldId,
				sourceBindingId: binding.sourceBinding.id,
				sourceFieldEpoch: binding.sourceBinding.fieldEpoch.toString(),
				targetBindingId: binding.id,
				targetFieldEpoch: binding.fieldEpoch.toString(),
				fieldSlot: binding.field.manifestField.fieldSlot,
				formatVersion: binding.field.manifestField.formatVersion,
			}))
			.sort((left, right) => left.fieldSlot - right.fieldSlot);
		const controlPayload = {
			version: 1,
			kind: "manifest_change",
			sourceSchemaId: input.sourceSchemaId,
			sourceSchemaFingerprint: Buffer.from(
				sourceSchema.schemaFingerprint,
			).toString("hex"),
			targetSchemaId: input.schemaId,
			targetSchemaFingerprint: Buffer.from(
				targetSchema.schemaFingerprint,
			).toString("hex"),
			targetSnapshotChecksum: Buffer.from(targetManifestChecksum).toString(
				"hex",
			),
			mapping,
		};
		const controlHash = createCrdtManifestChangeControlHash({
			resourceId: input.resourceId,
			resourceEpochId: input.resourceEpochId,
			commitSeq: manifestCommitSeq,
			payload: controlPayload,
		});
		await this.db.insert(questpieCrdtCommitTable).values({
			resourceId: input.resourceId,
			resourceEpochId: input.resourceEpochId,
			definitionId: input.definitionId,
			commitSeq: manifestCommitSeq,
			kind: 4,
			schemaId: input.schemaId,
			canonicalBundleHash: Buffer.from(controlHash),
			deliveryCommitId: randomUUID(),
			controlPayload,
		});

		const compatibilityId = randomUUID();
		await this.db.insert(questpieCrdtSchemaCompatibilityTable).values({
			id: compatibilityId,
			resourceId: input.resourceId,
			resourceEpochId: input.resourceEpochId,
			definitionId: input.definitionId,
			sourceSchemaId: input.sourceSchemaId,
			targetSchemaId: input.schemaId,
			manifestCommitSeq,
			manifestCommitKind: 4,
			expiresAt: sql`clock_timestamp() + (${SCHEMA_COMPATIBILITY_HORIZON_DAYS} * interval '1 day')`,
		});
		if (mapping.length > 0) {
			await this.db.insert(questpieCrdtSchemaCompatibilityFieldTable).values(
				mapping.map((entry) => {
					const sourceBinding = sourceBindingsByStableId.get(
						entry.stableFieldId,
					)!;
					const targetBinding = targetBindings.find(
						(candidate) =>
							candidate.field.manifestField.stableFieldId ===
							entry.stableFieldId,
					)!;
					return {
						compatibilityId,
						resourceId: input.resourceId,
						sourceSchemaId: input.sourceSchemaId,
						sourceSchemaFieldId: sourceBinding.schemaFieldId,
						sourceBindingId: sourceBinding.id,
						sourceFieldEpoch: sourceBinding.fieldEpoch,
						sourceFieldSlot: sourceBinding.fieldSlot,
						sourceFormatVersion: sourceBinding.formatVersion,
						targetSchemaId: input.schemaId,
						targetSchemaFieldId: targetBinding.schemaFieldId,
						targetBindingId: targetBinding.id,
						targetFieldEpoch: targetBinding.fieldEpoch,
						targetFieldSlot: targetBinding.field.manifestField.fieldSlot,
						targetFormatVersion:
							targetBinding.field.manifestField.formatVersion,
					};
				}),
			);
		}

		const targetManifestId = randomUUID();
		await this.db.insert(questpieCrdtSnapshotManifestTable).values({
			id: targetManifestId,
			resourceId: input.resourceId,
			resourceEpochId: input.resourceEpochId,
			definitionId: input.definitionId,
			schemaId: input.schemaId,
			coversCommitSeq: manifestCommitSeq,
			status: 2,
			totalBytes,
			fieldCount: targetBindings.length,
			checksum: Buffer.from(targetManifestChecksum),
			leaseGeneration: 0n,
			verifiedAt: sql`now()`,
		});
		await this.db.insert(questpieCrdtSnapshotTable).values(
			targetBindings.map((binding) => ({
				manifestId: targetManifestId,
				resourceId: input.resourceId,
				resourceEpochId: input.resourceEpochId,
				schemaId: input.schemaId,
				bindingId: binding.id,
				stableFieldId: binding.field.manifestField.stableFieldId,
				fieldEpoch: binding.fieldEpoch,
				fieldSlot: binding.field.manifestField.fieldSlot,
				formatVersion: binding.field.manifestField.formatVersion,
				fieldCursor: binding.fieldCursor,
				engineId: binding.engineId,
				engineVersion: binding.engineVersion,
				stateVersion: binding.stateVersion,
				bytes: binding.snapshotBytes,
				sizeBytes: binding.snapshotBytes.byteLength,
				checksum: binding.snapshotChecksum,
			})),
		);
		await this.db
			.update(questpieCrdtResourceEpochTable)
			.set({
				schemaId: input.schemaId,
				headCommitSeq: manifestCommitSeq,
				projectedCommitSeq: manifestCommitSeq,
				previousSnapshotManifestId: sourceManifest.id,
				previousSnapshotStatus: 2,
				currentSnapshotManifestId: targetManifestId,
				currentSnapshotStatus: 2,
				updatedAt: sql`now()`,
			})
			.where(
				and(
					eq(questpieCrdtResourceEpochTable.resourceId, input.resourceId),
					eq(questpieCrdtResourceEpochTable.id, input.resourceEpochId),
				),
			);
		await this.db
			.update(questpieCrdtResourceTable)
			.set({
				readFence: sql`${questpieCrdtResourceTable.readFence} + 1`,
				editFence: sql`${questpieCrdtResourceTable.editFence} + 1`,
				updatedAt: sql`now()`,
			})
			.where(eq(questpieCrdtResourceTable.id, input.resourceId));
		await this.db
			.update(questpieCrdtSessionTable)
			.set({
				closedAt: sql`now()`,
				closeReason: 2,
				updatedAt: sql`now()`,
			})
			.where(
				and(
					eq(questpieCrdtSessionTable.resourceId, input.resourceId),
					sql`${questpieCrdtSessionTable.closedAt} IS NULL`,
				),
			);

		return Object.freeze({
			resourceId: input.resourceId,
			resourceEpochId: input.resourceEpochId,
			schemaId: input.schemaId,
		});
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

function assertStagedOwnerValues(
	staged: StagedCrdtOwnerActivation,
	values: Readonly<Record<string, unknown>>,
): void {
	for (const field of staged.fields) {
		const rawValue = values[field.manifestField.sourcePath];
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

export function createCrdtManifestChangeControlHash(input: {
	resourceId: string;
	resourceEpochId: string;
	commitSeq: bigint;
	payload: unknown;
}): Uint8Array {
	const hash = createHash("sha256");
	hash.update("questpie-crdt-manifest-change-v1\0");
	hash.update(input.resourceId);
	hash.update("\0");
	hash.update(input.resourceEpochId);
	hash.update("\0");
	hash.update(input.commitSeq.toString());
	hash.update("\0");
	hash.update(canonicalJson(input.payload));
	return hash.digest();
}

function canonicalJson(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number") {
		if (!Number.isSafeInteger(value)) {
			throw new TypeError("CRDT control payload numbers must be safe integers");
		}
		return String(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map(canonicalJson).join(",")}]`;
	}
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		const keys = Object.keys(record).sort(compareUtf8);
		return `{${keys
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
			.join(",")}}`;
	}
	throw new TypeError("CRDT control payload is not canonical JSON");
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
