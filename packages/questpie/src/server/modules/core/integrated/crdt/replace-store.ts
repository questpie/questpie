import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { withTransaction } from "#questpie/server/collection/crud/shared/transaction.js";
import type { AnyDrizzleClient } from "#questpie/server/config/types.js";
import type {
	CrdtEngineFormat,
	CrdtFieldEngine,
} from "#questpie/shared/crdt-engine.js";
import { hashCrdtCanonicalValue } from "#questpie/shared/crdt-engine.js";

import { loadCrdtAuthoritativeReplica } from "./append-store.js";
import { createDeterministicSetEngine } from "./deterministic-engine.js";
import { createCrdtSnapshotManifestChecksum } from "./durable-store.js";
import {
	type CrdtAggregateReplaceInput,
	type CrdtFieldReplaceInput,
	type CrdtReplaceResult,
	createCrdtReplaceCoordinator,
} from "./replace.js";
import {
	questpieCrdtBindingTable,
	questpieCrdtCommitTable,
	questpieCrdtProjectionFieldTable,
	questpieCrdtProjectionTable,
	questpieCrdtResourceEpochTable,
	questpieCrdtResourceTable,
	questpieCrdtSessionTable,
	questpieCrdtSnapshotManifestTable,
	questpieCrdtSnapshotTable,
} from "./schema.js";

type CrdtDatabase = AnyDrizzleClient<any>;
type CanonicalValue = string | readonly string[];

export type CrdtReplaceOwnerPort<TOwner> = Readonly<{
	lock(
		transaction: CrdtDatabase,
		input: { resourceId: string; definitionId: string },
	): Promise<TOwner>;
	writeCanonical(
		transaction: CrdtDatabase,
		owner: TOwner,
		values: ReadonlyMap<string, CanonicalValue>,
	): Promise<void>;
	appendRealtimeChange(
		transaction: CrdtDatabase,
		owner: TOwner,
		input: {
			origin: "crdt_replace";
			resourceId: string;
			resourceEpochId: string;
			commitSeq: bigint;
		},
	): Promise<1>;
}>;

type StagedField = Readonly<{
	sourceBindingId: string;
	targetBindingId: string;
	stableFieldId: string;
	schemaFieldId: string;
	sourcePath: string;
	format: 1 | 2;
	formatVersion: number;
	fieldSlot: number;
	sourceFieldEpoch: bigint;
	targetFieldEpoch: bigint;
	headFieldCursor: bigint;
	projectedFieldCursor: bigint;
	canonicalHash: Uint8Array;
	canonicalRevision: bigint;
	projectedCanonicalHash: Uint8Array;
	projectedCanonicalRevision: bigint;
	readFence: bigint;
	editFence: bigint;
	stateBytes: bigint;
	elementCount: bigint;
	targetValue: CanonicalValue;
	targetCanonicalHash: Uint8Array;
	targetCanonicalRevision: bigint;
	targetSnapshot: Uint8Array;
	targetSnapshotChecksum: Uint8Array;
	engineId: string;
	engineVersion: number;
	stateVersion: number;
}>;

type StagedReplace = Readonly<{
	mode: "field" | "aggregate";
	resourceId: string;
	resourceEpochId: string;
	definitionId: string;
	schemaId: string;
	aggregateEpoch: bigint;
	headCommitSeq: bigint;
	projectedCommitSeq: bigint;
	currentManifestId: string;
	targetResourceEpochId: string;
	targetAggregateEpoch: bigint;
	fields: readonly StagedField[];
}>;

const stagedProofs = new WeakMap<object, object>();

export function createCrdtReplaceStore<TOwner>(
	db: CrdtDatabase,
	options: Readonly<{
		owner: CrdtReplaceOwnerPort<TOwner>;
		engines: Readonly<{
			text: CrdtFieldEngine<"text", string>;
			set?: CrdtFieldEngine<"set", readonly string[]>;
		}>;
		publishNotice?: (notice: {
			kind: "crdt";
			resourceId: string;
			resourceEpochId: string;
			commitSeq: bigint;
		}) => Promise<void>;
	}>,
) {
	const setEngine =
		options.engines.set ??
		(createDeterministicSetEngine() as CrdtFieldEngine<
			"set",
			readonly string[]
		>);
	const engines = {
		text: options.engines.text,
		set: setEngine,
	} as const;
	const coordinator = createCrdtReplaceCoordinator<StagedReplace>({
		async fieldKeys(resourceId) {
			const rows = await db
				.select({ sourcePath: questpieCrdtBindingTable.sourcePath })
				.from(questpieCrdtBindingTable)
				.where(
					and(
						eq(questpieCrdtBindingTable.resourceId, resourceId),
						inArray(questpieCrdtBindingTable.status, [1, 3]),
						isNull(questpieCrdtBindingTable.retiredAt),
					),
				)
				.orderBy(asc(questpieCrdtBindingTable.sourcePath));
			return rows.map((row) => row.sourcePath);
		},
		async stageField(input) {
			const staged = await stageReplace(db, engines, "field", input);
			stagedProofs.set(staged, input);
			return staged;
		},
		async stageAggregate(input) {
			const staged = await stageReplace(db, engines, "aggregate", input);
			stagedProofs.set(staged, input);
			return staged;
		},
		async commitField(input, staged) {
			verifyStaged(staged, input, "field");
			const result = await withTransaction(db, (tx) =>
				commitFieldReplace(tx as CrdtDatabase, input, staged, options.owner),
			);
			await publish(options.publishNotice, result, staged.resourceEpochId);
			return result;
		},
		async commitAggregate(input, staged) {
			verifyStaged(staged, input, "aggregate");
			const result = await withTransaction(db, (tx) =>
				commitAggregateReplace(
					tx as CrdtDatabase,
					input,
					staged,
					options.owner,
				),
			);
			await publish(
				options.publishNotice,
				result,
				staged.targetResourceEpochId,
			);
			return result;
		},
	});
	return coordinator;
}

async function stageReplace(
	db: CrdtDatabase,
	engines: Readonly<{
		text: CrdtFieldEngine<"text", string>;
		set: CrdtFieldEngine<"set", readonly string[]>;
	}>,
	mode: "field" | "aggregate",
	input: CrdtFieldReplaceInput | CrdtAggregateReplaceInput,
): Promise<StagedReplace> {
	const [resource] = await db
		.select()
		.from(questpieCrdtResourceTable)
		.where(eq(questpieCrdtResourceTable.id, input.resourceId));
	if (
		!resource ||
		resource.status !== 1 ||
		!resource.currentEpochId ||
		resource.currentEpochStatus !== 1
	) {
		throw conflict();
	}
	const [epoch] = await db
		.select()
		.from(questpieCrdtResourceEpochTable)
		.where(
			and(
				eq(questpieCrdtResourceEpochTable.resourceId, input.resourceId),
				eq(questpieCrdtResourceEpochTable.id, resource.currentEpochId),
				eq(questpieCrdtResourceEpochTable.status, 1),
			),
		);
	if (!epoch?.currentSnapshotManifestId) throw conflict();
	const bindings = await db
		.select()
		.from(questpieCrdtBindingTable)
		.where(
			and(
				eq(questpieCrdtBindingTable.resourceId, input.resourceId),
				eq(questpieCrdtBindingTable.status, 1),
				isNull(questpieCrdtBindingTable.retiredAt),
			),
		)
		.orderBy(asc(questpieCrdtBindingTable.id));
	if (bindings.length === 0) throw conflict();
	const targetStableFieldId =
		mode === "field" ? (input as CrdtFieldReplaceInput).stableFieldId : null;
	if (
		targetStableFieldId &&
		!bindings.some((binding) => binding.stableFieldId === targetStableFieldId)
	) {
		throw conflict();
	}
	const fields = await Promise.all(
		bindings.map(async (binding): Promise<StagedField> => {
			const engine = binding.format === 1 ? engines.text : engines.set;
			const anyEngine = engine as CrdtFieldEngine<CrdtEngineFormat, any>;
			const authoritative = await loadCrdtAuthoritativeReplica(db, {
				bindingId: binding.id,
				engine: anyEngine,
			});
			const replacing =
				mode === "aggregate" || binding.stableFieldId === targetStableFieldId;
			const targetValue = replacing
				? mode === "field"
					? (input as CrdtFieldReplaceInput).value
					: (input as CrdtAggregateReplaceInput).values[binding.sourcePath]!
				: anyEngine.project(authoritative.replica);
			const targetFieldEpoch = replacing
				? binding.fieldEpoch + 1n
				: binding.fieldEpoch;
			const targetReplica = replacing
				? await anyEngine.create({
						value: targetValue,
						basis: { fieldEpoch: targetFieldEpoch, fieldCursor: 0n },
					})
				: authoritative.replica;
			const targetSnapshot = new Uint8Array(
				await anyEngine.snapshot(targetReplica),
			);
			const targetCanonicalHash = await hashCrdtCanonicalValue(
				binding.format === 1 ? "text" : "set",
				targetValue,
			);
			const verifiedReplica = await anyEngine.restore({
				snapshot: targetSnapshot,
				basis: {
					fieldEpoch: targetFieldEpoch,
					fieldCursor: replacing ? 0n : binding.headFieldCursor,
				},
			});
			const verifiedCanonicalHash = await hashCrdtCanonicalValue(
				binding.format === 1 ? "text" : "set",
				anyEngine.project(verifiedReplica),
			);
			if (!equalBytes(targetCanonicalHash, verifiedCanonicalHash)) {
				throw new TypeError(
					"CRDT replacement engine snapshot does not preserve canonical value",
				);
			}
			return Object.freeze({
				sourceBindingId: binding.id,
				targetBindingId: replacing ? randomUUID() : binding.id,
				stableFieldId: binding.stableFieldId,
				schemaFieldId: binding.schemaFieldId,
				sourcePath: binding.sourcePath,
				format: binding.format as 1 | 2,
				formatVersion: binding.formatVersion,
				fieldSlot: binding.fieldSlot,
				sourceFieldEpoch: binding.fieldEpoch,
				targetFieldEpoch,
				headFieldCursor: binding.headFieldCursor,
				projectedFieldCursor: binding.projectedFieldCursor,
				canonicalHash: new Uint8Array(binding.canonicalHash),
				canonicalRevision: binding.canonicalRevision,
				projectedCanonicalHash: new Uint8Array(binding.projectedCanonicalHash),
				projectedCanonicalRevision: binding.projectedCanonicalRevision,
				readFence: binding.readFence,
				editFence: binding.editFence,
				stateBytes: binding.stateBytes,
				elementCount: binding.elementCount,
				targetValue: snapshotValue(targetValue),
				targetCanonicalHash,
				targetCanonicalRevision: replacing
					? binding.canonicalRevision + 1n
					: binding.canonicalRevision,
				targetSnapshot,
				targetSnapshotChecksum: sha256(targetSnapshot),
				engineId: engine.engineId,
				engineVersion: engine.engineVersion,
				stateVersion: engine.stateVersion,
			});
		}),
	);
	if (
		fields.length > 32 ||
		fields.reduce(
			(total, field) => total + field.targetSnapshot.byteLength,
			0,
		) >
			32 * 1024 * 1024
	) {
		throw new TypeError("CRDT replacement snapshot exceeds aggregate limits");
	}
	return Object.freeze({
		mode,
		resourceId: resource.id,
		resourceEpochId: epoch.id,
		definitionId: resource.definitionId,
		schemaId: epoch.schemaId,
		aggregateEpoch: epoch.aggregateEpoch,
		headCommitSeq: epoch.headCommitSeq,
		projectedCommitSeq: epoch.projectedCommitSeq,
		currentManifestId: epoch.currentSnapshotManifestId,
		targetResourceEpochId: mode === "aggregate" ? randomUUID() : epoch.id,
		targetAggregateEpoch:
			mode === "aggregate" ? epoch.aggregateEpoch + 1n : epoch.aggregateEpoch,
		fields: Object.freeze(fields),
	});
}

async function commitFieldReplace<TOwner>(
	db: CrdtDatabase,
	input: CrdtFieldReplaceInput,
	staged: StagedReplace,
	ownerPort: CrdtReplaceOwnerPort<TOwner>,
): Promise<CrdtReplaceResult> {
	const owner = await ownerPort.lock(db, {
		resourceId: staged.resourceId,
		definitionId: staged.definitionId,
	});
	const locked = await lockBasis(db, staged);
	const target = staged.fields.find(
		(field) => field.stableFieldId === input.stableFieldId,
	);
	if (
		!target ||
		input.expected.fieldEpoch !== target.sourceFieldEpoch ||
		input.expected.canonicalRevision !== target.canonicalRevision
	) {
		throw conflict();
	}
	verifyLockedBasis(locked, staged);
	const commitSeq = locked.epoch.headCommitSeq + 1n;
	const manifestId = randomUUID();
	const controlPayload = {
		version: 1,
		kind: "field_reset",
		stableFieldId: target.stableFieldId,
		sourceBindingId: target.sourceBindingId,
		targetBindingId: target.targetBindingId,
		sourceFieldEpoch: target.sourceFieldEpoch.toString(),
		targetFieldEpoch: target.targetFieldEpoch.toString(),
		reason: input.reason,
	};
	await db.insert(questpieCrdtCommitTable).values({
		resourceId: staged.resourceId,
		resourceEpochId: staged.resourceEpochId,
		definitionId: staged.definitionId,
		commitSeq,
		kind: 2,
		schemaId: staged.schemaId,
		canonicalBundleHash: Buffer.from(controlHash(controlPayload)),
		deliveryCommitId: randomUUID(),
		controlPayload,
	});
	await db
		.update(questpieCrdtBindingTable)
		.set({
			status: 2,
			readFence: target.readFence + 1n,
			editFence: target.editFence + 1n,
			retiredAt: sql`now()`,
			updatedAt: sql`now()`,
		})
		.where(eq(questpieCrdtBindingTable.id, target.sourceBindingId));
	await insertReplacementBinding(db, staged, target);
	await installManifest(db, staged, manifestId, commitSeq);
	await db
		.update(questpieCrdtResourceEpochTable)
		.set({
			headCommitSeq: commitSeq,
			previousSnapshotManifestId: staged.currentManifestId,
			previousSnapshotStatus: 2,
			currentSnapshotManifestId: manifestId,
			currentSnapshotStatus: 2,
			updatedAt: sql`now()`,
		})
		.where(eq(questpieCrdtResourceEpochTable.id, staged.resourceEpochId));
	await insertProjectionBarrier(
		db,
		staged,
		commitSeq,
		target.stableFieldId,
		false,
	);
	await fenceSessions(db, staged.resourceId);
	await ownerPort.writeCanonical(
		db,
		owner,
		new Map([[target.sourcePath, target.targetValue]]),
	);
	const count = await ownerPort.appendRealtimeChange(db, owner, {
		origin: "crdt_replace",
		resourceId: staged.resourceId,
		resourceEpochId: staged.resourceEpochId,
		commitSeq,
	});
	if (count !== 1)
		throw new TypeError("CRDT replace requires one outbox change");
	return result(staged.resourceId, staged.aggregateEpoch, commitSeq);
}

async function commitAggregateReplace<TOwner>(
	db: CrdtDatabase,
	input: CrdtAggregateReplaceInput,
	staged: StagedReplace,
	ownerPort: CrdtReplaceOwnerPort<TOwner>,
): Promise<CrdtReplaceResult> {
	const owner = await ownerPort.lock(db, {
		resourceId: staged.resourceId,
		definitionId: staged.definitionId,
	});
	const locked = await lockBasis(db, staged);
	if (input.expected.aggregateEpoch !== staged.aggregateEpoch) throw conflict();
	for (const field of staged.fields) {
		if (
			input.expected.canonicalRevisions[field.sourcePath] !==
			field.canonicalRevision
		) {
			throw conflict();
		}
	}
	verifyLockedBasis(locked, staged);
	const commitSeq = 1n;
	const manifestId = randomUUID();
	await db
		.update(questpieCrdtResourceTable)
		.set({
			status: 3,
			currentEpochId: null,
			currentEpochStatus: null,
			updatedAt: sql`now()`,
		})
		.where(eq(questpieCrdtResourceTable.id, staged.resourceId));
	await db
		.update(questpieCrdtBindingTable)
		.set({ status: 2, retiredAt: sql`now()`, updatedAt: sql`now()` })
		.where(
			and(
				eq(questpieCrdtBindingTable.resourceId, staged.resourceId),
				isNull(questpieCrdtBindingTable.retiredAt),
			),
		);
	await db
		.update(questpieCrdtResourceEpochTable)
		.set({ status: 2, closedAt: sql`now()`, updatedAt: sql`now()` })
		.where(eq(questpieCrdtResourceEpochTable.id, staged.resourceEpochId));
	await db.insert(questpieCrdtResourceEpochTable).values({
		id: staged.targetResourceEpochId,
		resourceId: staged.resourceId,
		definitionId: staged.definitionId,
		aggregateEpoch: staged.targetAggregateEpoch,
		schemaId: staged.schemaId,
		headCommitSeq: commitSeq,
		projectedCommitSeq: commitSeq,
	});
	for (const field of staged.fields) {
		await insertReplacementBinding(db, staged, field);
	}
	const controlPayload = {
		version: 1,
		kind: "aggregate_reset",
		sourceResourceEpochId: staged.resourceEpochId,
		targetResourceEpochId: staged.targetResourceEpochId,
		reason: input.reason,
	};
	await db.insert(questpieCrdtCommitTable).values({
		resourceId: staged.resourceId,
		resourceEpochId: staged.targetResourceEpochId,
		definitionId: staged.definitionId,
		commitSeq,
		kind: 3,
		schemaId: staged.schemaId,
		canonicalBundleHash: Buffer.from(controlHash(controlPayload)),
		deliveryCommitId: randomUUID(),
		controlPayload,
	});
	await installManifest(db, staged, manifestId, commitSeq);
	await db
		.update(questpieCrdtResourceEpochTable)
		.set({
			currentSnapshotManifestId: manifestId,
			currentSnapshotStatus: 2,
			updatedAt: sql`now()`,
		})
		.where(eq(questpieCrdtResourceEpochTable.id, staged.targetResourceEpochId));
	await db
		.update(questpieCrdtResourceTable)
		.set({
			status: 1,
			currentEpochId: staged.targetResourceEpochId,
			currentEpochStatus: 1,
			readFence: sql`${questpieCrdtResourceTable.readFence} + 1`,
			editFence: sql`${questpieCrdtResourceTable.editFence} + 1`,
			ownerPolicyRevision: sql`${questpieCrdtResourceTable.ownerPolicyRevision} + 1`,
			sessionGeneration: sql`${questpieCrdtResourceTable.sessionGeneration} + 1`,
			updatedAt: sql`now()`,
		})
		.where(eq(questpieCrdtResourceTable.id, staged.resourceId));
	await insertProjectionBarrier(db, staged, commitSeq, null, true);
	await fenceSessions(db, staged.resourceId);
	await ownerPort.writeCanonical(
		db,
		owner,
		new Map(
			staged.fields.map((field) => [field.sourcePath, field.targetValue]),
		),
	);
	const count = await ownerPort.appendRealtimeChange(db, owner, {
		origin: "crdt_replace",
		resourceId: staged.resourceId,
		resourceEpochId: staged.targetResourceEpochId,
		commitSeq,
	});
	if (count !== 1)
		throw new TypeError("CRDT replace requires one outbox change");
	return result(staged.resourceId, staged.targetAggregateEpoch, commitSeq);
}

async function lockBasis(db: CrdtDatabase, staged: StagedReplace) {
	const [resource] = await db
		.select()
		.from(questpieCrdtResourceTable)
		.where(eq(questpieCrdtResourceTable.id, staged.resourceId))
		.for("update");
	const [epoch] = await db
		.select()
		.from(questpieCrdtResourceEpochTable)
		.where(
			and(
				eq(questpieCrdtResourceEpochTable.resourceId, staged.resourceId),
				eq(questpieCrdtResourceEpochTable.id, staged.resourceEpochId),
			),
		)
		.for("update");
	const bindings = await db
		.select()
		.from(questpieCrdtBindingTable)
		.where(
			and(
				eq(questpieCrdtBindingTable.resourceId, staged.resourceId),
				eq(questpieCrdtBindingTable.status, 1),
				isNull(questpieCrdtBindingTable.retiredAt),
			),
		)
		.orderBy(asc(questpieCrdtBindingTable.id))
		.for("update");
	if (!resource || !epoch) throw conflict();
	return { resource, epoch, bindings };
}

function verifyLockedBasis(
	locked: Awaited<ReturnType<typeof lockBasis>>,
	staged: StagedReplace,
): void {
	if (
		locked.resource.status !== 1 ||
		locked.resource.currentEpochId !== staged.resourceEpochId ||
		locked.epoch.status !== 1 ||
		locked.epoch.aggregateEpoch !== staged.aggregateEpoch ||
		locked.epoch.schemaId !== staged.schemaId ||
		locked.epoch.headCommitSeq !== staged.headCommitSeq ||
		locked.epoch.projectedCommitSeq !== staged.projectedCommitSeq ||
		locked.epoch.currentSnapshotManifestId !== staged.currentManifestId ||
		locked.bindings.length !== staged.fields.length
	) {
		throw conflict();
	}
	for (let index = 0; index < locked.bindings.length; index++) {
		const binding = locked.bindings[index]!;
		const field = staged.fields[index]!;
		if (
			binding.id !== field.sourceBindingId ||
			binding.fieldEpoch !== field.sourceFieldEpoch ||
			binding.headFieldCursor !== field.headFieldCursor ||
			binding.projectedFieldCursor !== field.projectedFieldCursor ||
			binding.canonicalRevision !== field.canonicalRevision ||
			!equalBytes(binding.canonicalHash, field.canonicalHash) ||
			binding.projectedCanonicalRevision !== field.projectedCanonicalRevision ||
			!equalBytes(binding.projectedCanonicalHash, field.projectedCanonicalHash)
		) {
			throw conflict();
		}
	}
}

async function insertReplacementBinding(
	db: CrdtDatabase,
	staged: StagedReplace,
	field: StagedField,
): Promise<void> {
	await db.insert(questpieCrdtBindingTable).values({
		id: field.targetBindingId,
		resourceId: staged.resourceId,
		definitionId: staged.definitionId,
		schemaId: staged.schemaId,
		schemaFieldId: field.schemaFieldId,
		stableFieldId: field.stableFieldId,
		fieldSlot: field.fieldSlot,
		sourcePath: field.sourcePath,
		format: field.format,
		formatVersion: field.formatVersion,
		fieldEpoch: field.targetFieldEpoch,
		headFieldCursor: 0n,
		projectedFieldCursor: 0n,
		readFence: field.readFence + 1n,
		editFence: field.editFence + 1n,
		canonicalHash: Buffer.from(field.targetCanonicalHash),
		canonicalRevision: field.targetCanonicalRevision,
		projectedCanonicalHash: Buffer.from(field.targetCanonicalHash),
		projectedCanonicalRevision: field.targetCanonicalRevision,
		status: 1,
		stateBytes: BigInt(field.targetSnapshot.byteLength),
		elementCount: Array.isArray(field.targetValue)
			? BigInt(field.targetValue.length)
			: 0n,
	});
}

async function installManifest(
	db: CrdtDatabase,
	staged: StagedReplace,
	manifestId: string,
	commitSeq: bigint,
): Promise<void> {
	const resourceEpochId =
		staged.mode === "aggregate"
			? staged.targetResourceEpochId
			: staged.resourceEpochId;
	const fields = staged.fields.map((field) => ({
		bindingId: field.targetBindingId,
		stableFieldId: field.stableFieldId,
		fieldEpoch: field.targetFieldEpoch,
		fieldSlot: field.fieldSlot,
		formatVersion: field.formatVersion,
		fieldCursor:
			field.targetBindingId === field.sourceBindingId
				? field.headFieldCursor
				: 0n,
		engineId: field.engineId,
		engineVersion: field.engineVersion,
		stateVersion: field.stateVersion,
		sizeBytes: field.targetSnapshot.byteLength,
		checksum: field.targetSnapshotChecksum,
	}));
	const checksum = createCrdtSnapshotManifestChecksum({
		resourceId: staged.resourceId,
		resourceEpochId,
		schemaId: staged.schemaId,
		coversCommitSeq: commitSeq,
		fields,
	});
	await db.insert(questpieCrdtSnapshotManifestTable).values({
		id: manifestId,
		resourceId: staged.resourceId,
		resourceEpochId,
		definitionId: staged.definitionId,
		schemaId: staged.schemaId,
		coversCommitSeq: commitSeq,
		status: 2,
		totalBytes: fields.reduce((total, field) => total + field.sizeBytes, 0),
		fieldCount: fields.length,
		checksum: Buffer.from(checksum),
		leaseGeneration: 0n,
		verifiedAt: sql`now()`,
	});
	await db.insert(questpieCrdtSnapshotTable).values(
		fields.map((field, index) => ({
			manifestId,
			resourceId: staged.resourceId,
			resourceEpochId,
			schemaId: staged.schemaId,
			...field,
			bytes: Buffer.from(staged.fields[index]!.targetSnapshot),
			checksum: Buffer.from(field.checksum),
		})),
	);
}

async function insertProjectionBarrier(
	db: CrdtDatabase,
	staged: StagedReplace,
	commitSeq: bigint,
	resetStableFieldId: string | null,
	completed: boolean,
): Promise<void> {
	const projectionId = randomUUID();
	const resourceEpochId = completed
		? staged.targetResourceEpochId
		: staged.resourceEpochId;
	await db.insert(questpieCrdtProjectionTable).values({
		id: projectionId,
		resourceId: staged.resourceId,
		resourceEpochId,
		schemaId: staged.schemaId,
		targetCommitSeq: commitSeq,
		status: completed ? 3 : 1,
		idempotencyKey: randomUUID(),
		dueAt: sql`now()`,
		leaseGeneration: 0n,
	});
	await db.insert(questpieCrdtProjectionFieldTable).values(
		staged.fields.map((field) => ({
			projectionId,
			resourceId: staged.resourceId,
			schemaId: staged.schemaId,
			bindingId: field.targetBindingId,
			stableFieldId: field.stableFieldId,
			fieldEpoch: field.targetFieldEpoch,
			fieldSlot: field.fieldSlot,
			formatVersion: field.formatVersion,
			targetFieldCursor:
				field.targetBindingId === field.sourceBindingId
					? field.headFieldCursor
					: 0n,
			expectedCanonicalHash: Buffer.from(
				field.targetBindingId === field.sourceBindingId
					? field.projectedCanonicalHash
					: field.targetCanonicalHash,
			),
			expectedCanonicalRevision:
				field.targetBindingId === field.sourceBindingId
					? field.projectedCanonicalRevision
					: field.targetCanonicalRevision,
			shouldWrite:
				!completed &&
				field.stableFieldId !== resetStableFieldId &&
				field.headFieldCursor > field.projectedFieldCursor
					? 1
					: 0,
		})),
	);
}

async function fenceSessions(
	db: CrdtDatabase,
	resourceId: string,
): Promise<void> {
	await db
		.update(questpieCrdtSessionTable)
		.set({ closedAt: sql`now()`, closeReason: 2, updatedAt: sql`now()` })
		.where(
			and(
				eq(questpieCrdtSessionTable.resourceId, resourceId),
				isNull(questpieCrdtSessionTable.closedAt),
			),
		);
}

function verifyStaged(
	staged: StagedReplace,
	input: object,
	mode: StagedReplace["mode"],
): void {
	if (staged.mode !== mode || stagedProofs.get(staged) !== input) {
		throw new TypeError("CRDT replace staging capability is invalid");
	}
}

async function publish(
	publishNotice: Parameters<typeof createCrdtReplaceStore>[1]["publishNotice"],
	result: CrdtReplaceResult,
	resourceEpochId: string,
): Promise<void> {
	try {
		await publishNotice?.({
			kind: "crdt",
			resourceId: result.resourceId,
			resourceEpochId,
			commitSeq: result.commitSeq,
		});
	} catch {
		// Durable polling and reconnect make notices latency hints only.
	}
}

function result(
	resourceId: string,
	aggregateEpoch: bigint,
	commitSeq: bigint,
): CrdtReplaceResult {
	return Object.freeze({
		resourceId,
		aggregateEpoch,
		commitSeq,
		outboxChanges: 1,
		origin: "crdt_replace",
	});
}

function conflict(): Error {
	const error = new Error("CRDT replace basis is stale");
	error.name = "CrdtReplaceConflictError";
	return error;
}

function snapshotValue(value: CanonicalValue): CanonicalValue {
	return Array.isArray(value) ? Object.freeze([...value]) : value;
}

function sha256(value: Uint8Array): Uint8Array {
	return new Uint8Array(createHash("sha256").update(value).digest());
}

function controlHash(value: unknown): Uint8Array {
	return new Uint8Array(
		createHash("sha256")
			.update("questpie-crdt-replace-control-v1\0")
			.update(JSON.stringify(value))
			.digest(),
	);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	return Buffer.from(left).equals(Buffer.from(right));
}
