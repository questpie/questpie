import { Buffer } from "node:buffer";

import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { withTransaction } from "#questpie/server/collection/crud/shared/transaction.js";
import type { AnyDrizzleClient } from "#questpie/server/config/types.js";
import {
	type CrdtEngineFormat,
	type CrdtFieldEngine,
	hashCrdtCanonicalValue,
} from "#questpie/shared/crdt-engine.js";

import {
	createCrdtProjectionCoordinator,
	type CrdtPreparedProjection,
	type CrdtProjectionClaim,
	type CrdtProjectionField,
} from "./projection.js";
import {
	questpieCrdtBindingTable,
	questpieCrdtProjectionFieldTable,
	questpieCrdtProjectionTable,
	questpieCrdtResourceEpochTable,
	questpieCrdtResourceTable,
} from "./schema.js";
import { materializeCrdtAggregateAtCut } from "./sync-store.js";

type CrdtDatabase = AnyDrizzleClient<any>;
type AnyEngine = CrdtFieldEngine<CrdtEngineFormat, any>;

type ScheduledField = Readonly<{
	bindingId: string;
	stableFieldId: string;
	fieldEpoch: bigint;
	fieldSlot: number;
	formatVersion: number;
	targetFieldCursor: bigint;
	expectedCanonicalHash: Uint8Array;
	expectedCanonicalRevision: bigint;
	shouldWrite: boolean;
}>;

export type CrdtProjectionOwnerPort<TOwner> = Readonly<{
	lock(
		transaction: CrdtDatabase,
		input: { resourceId: string },
	): Promise<TOwner>;
	readCanonicalHashes(
		transaction: CrdtDatabase,
		owner: TOwner,
		bindings: readonly Readonly<{
			bindingId: string;
			sourcePath: string;
			format: 1 | 2;
		}>[],
	): Promise<ReadonlyMap<string, Uint8Array>>;
	writeCanonical(
		transaction: CrdtDatabase,
		owner: TOwner,
		values: ReadonlyMap<string, string | readonly string[]>,
	): Promise<void>;
	/**
	 * Consumer seam for validating a complete aggregate cut and writing derived
	 * application facts in the projection transaction. Throwing rejects the cut
	 * before canonical data, cursors, receipt, or realtime state are
	 * acknowledged. Returning transformed values is deliberately deferred until
	 * CRDT manifest-transition semantics can preserve their distinct hashes.
	 */
	prepareAcknowledgement?(
		transaction: CrdtDatabase,
		owner: TOwner,
		input: {
			values: ReadonlyMap<string, string | readonly string[]>;
			changed: ReadonlySet<string>;
			resourceId: string;
			resourceEpochId: string;
			basisCommitSeq: bigint;
			commitSeq: bigint;
		},
	): Promise<void | Readonly<{
		values?: ReadonlyMap<string, string | readonly string[]>;
		ownerChanged?: boolean;
	}>>;
	appendRealtimeChange(
		transaction: CrdtDatabase,
		owner: TOwner,
		input: {
			origin: "crdt_projection";
			resourceId: string;
			resourceEpochId: string;
			commitSeq: bigint;
		},
	): Promise<1>;
}>;

export function createCrdtExactCutProjectionMaterializer(input: {
	resolveEngine(binding: { format: number; formatVersion: number }): AnyEngine;
}) {
	return async (
		db: CrdtDatabase,
		claim: CrdtProjectionClaim,
		scheduledFields: readonly ScheduledField[],
		basisProjectedCommitSeq: bigint,
	): Promise<readonly CrdtProjectionField[]> => {
		const [epoch] = await db
			.select()
			.from(questpieCrdtResourceEpochTable)
			.where(
				and(
					eq(questpieCrdtResourceEpochTable.id, claim.resourceEpochId),
					eq(questpieCrdtResourceEpochTable.resourceId, claim.resourceId),
					eq(
						questpieCrdtResourceEpochTable.aggregateEpoch,
						claim.aggregateEpoch,
					),
					eq(questpieCrdtResourceEpochTable.schemaId, claim.schemaId),
				),
			);
		if (
			!epoch ||
			epoch.projectedCommitSeq !== basisProjectedCommitSeq ||
			claim.targetCommitSeq > epoch.headCommitSeq
		) {
			throw new Error("CRDT projection basis changed");
		}
		const bindings = await db
			.select()
			.from(questpieCrdtBindingTable)
			.where(
				and(
					eq(questpieCrdtBindingTable.resourceId, claim.resourceId),
					inArray(questpieCrdtBindingTable.status, [1, 3]),
					isNull(questpieCrdtBindingTable.retiredAt),
				),
			)
			.orderBy(asc(questpieCrdtBindingTable.id));
		const scheduled = new Map(
			scheduledFields.map((field) => [field.bindingId, field]),
		);
		if (
			bindings.length !== scheduled.size ||
			bindings.some((binding) => !scheduled.has(binding.id))
		) {
			throw new Error("CRDT projection manifest changed");
		}
		const engines = new Map<number, AnyEngine>();
		for (const binding of bindings) {
			const engine = input.resolveEngine(binding);
			if (
				engine.formatVersion !== binding.formatVersion ||
				(engine.format === "text" ? 1 : 2) !== binding.format
			) {
				throw new Error("CRDT projection engine is incompatible");
			}
			engines.set(binding.fieldSlot, engine);
		}
		const replicas = await materializeCrdtAggregateAtCut(db, {
			resourceId: claim.resourceId,
			resourceEpochId: claim.resourceEpochId,
			schemaId: claim.schemaId,
			targetCommitSeq: claim.targetCommitSeq,
			currentManifestId: epoch.currentSnapshotManifestId,
			previousManifestId: epoch.previousSnapshotManifestId,
			bindings,
			engines,
			targetFieldCursors: new Map(
				scheduledFields.map((field) => [
					field.bindingId,
					field.targetFieldCursor,
				]),
			),
		});
		if (!replicas) throw new Error("CRDT projection recovery basis is corrupt");
		return Promise.all(
			bindings.map(async (binding) => {
				const engine = engines.get(binding.fieldSlot)!;
				const replica = replicas.get(binding.fieldSlot);
				const scheduledField = scheduled.get(binding.id)!;
				if (!replica) throw new Error("CRDT projection field is incomplete");
				const value = engine.project(replica);
				return Object.freeze({
					bindingId: binding.id,
					stableFieldId: binding.stableFieldId,
					fieldEpoch: binding.fieldEpoch,
					targetFieldCursor: scheduledField.targetFieldCursor,
					canonicalHash: await hashCrdtCanonicalValue(engine.format, value),
					canonicalRevision:
						binding.projectedCanonicalRevision +
						(scheduledField.targetFieldCursor - binding.projectedFieldCursor),
					value,
					shouldWrite: scheduledField.shouldWrite,
				});
			}),
		);
	};
}

export function createCrdtProjectionStore<TOwner>(
	db: CrdtDatabase,
	options: Readonly<{
		owner: CrdtProjectionOwnerPort<TOwner>;
		materializeExactCut(
			database: CrdtDatabase,
			claim: CrdtProjectionClaim,
			scheduled: readonly ScheduledField[],
			basisProjectedCommitSeq: bigint,
		): Promise<readonly CrdtProjectionField[]>;
		publishNotice?: (notice: {
			kind: "crdt";
			resourceId: string;
			resourceEpochId: string;
			commitSeq: bigint;
		}) => Promise<void>;
	}>,
) {
	return Object.freeze({
		async runOnce() {
			const invocationClaim: { value: CrdtProjectionClaim | null } = {
				value: null,
			};
			const coordinator = createCrdtProjectionCoordinator({
				claimDue: async () => {
					invocationClaim.value = await claimDueProjection(db);
					return invocationClaim.value;
				},
				async prepareExactCut(claim) {
					const [epoch] = await db
						.select({
							projectedCommitSeq:
								questpieCrdtResourceEpochTable.projectedCommitSeq,
						})
						.from(questpieCrdtResourceEpochTable)
						.where(
							and(
								eq(questpieCrdtResourceEpochTable.id, claim.resourceEpochId),
								eq(questpieCrdtResourceEpochTable.resourceId, claim.resourceId),
								eq(
									questpieCrdtResourceEpochTable.aggregateEpoch,
									claim.aggregateEpoch,
								),
								eq(questpieCrdtResourceEpochTable.schemaId, claim.schemaId),
							),
						);
					if (!epoch || epoch.projectedCommitSeq >= claim.targetCommitSeq) {
						return {
							basisProjectedCommitSeq: claim.targetCommitSeq - 1n,
							fields: await loadNoopFields(db, claim),
						};
					}
					const scheduled = await loadScheduledFields(db, claim.id);
					return {
						basisProjectedCommitSeq: epoch.projectedCommitSeq,
						fields: await options.materializeExactCut(
							db,
							claim,
							scheduled,
							epoch.projectedCommitSeq,
						),
					};
				},
				commit: (prepared) =>
					withTransaction(db, (tx) =>
						commitProjection(tx as CrdtDatabase, prepared, options.owner),
					),
			});
			const result = await coordinator.runOnce();
			if (result?.status === "applied") {
				const claim = invocationClaim.value;
				if (claim) {
					try {
						await options.publishNotice?.({
							kind: "crdt",
							resourceId: claim.resourceId,
							resourceEpochId: claim.resourceEpochId,
							commitSeq: claim.targetCommitSeq,
						});
					} catch {
						// Durable polling makes this notice a latency hint.
					}
				}
			}
			return result;
		},
	});
}

async function claimDueProjection(
	db: CrdtDatabase,
): Promise<CrdtProjectionClaim | null> {
	return db.transaction(async (tx) => {
		const database = tx as CrdtDatabase;
		const [job] = await database
			.select()
			.from(questpieCrdtProjectionTable)
			.where(
				and(
					or(
						inArray(questpieCrdtProjectionTable.status, [1, 4]),
						and(
							eq(questpieCrdtProjectionTable.status, 2),
							sql`${questpieCrdtProjectionTable.updatedAt} <= clock_timestamp() - interval '30 seconds'`,
						),
					),
					lte(questpieCrdtProjectionTable.dueAt, sql`clock_timestamp()`),
				),
			)
			.orderBy(
				asc(questpieCrdtProjectionTable.dueAt),
				asc(questpieCrdtProjectionTable.targetCommitSeq),
			)
			.limit(1)
			.for("update", { skipLocked: true });
		if (!job) return null;
		const [epoch] = await database
			.select({
				aggregateEpoch: questpieCrdtResourceEpochTable.aggregateEpoch,
			})
			.from(questpieCrdtResourceEpochTable)
			.where(
				and(
					eq(questpieCrdtResourceEpochTable.id, job.resourceEpochId),
					eq(questpieCrdtResourceEpochTable.resourceId, job.resourceId),
					eq(questpieCrdtResourceEpochTable.schemaId, job.schemaId),
				),
			);
		if (!epoch) {
			await database
				.update(questpieCrdtProjectionTable)
				.set({ status: 3 })
				.where(eq(questpieCrdtProjectionTable.id, job.id));
			return null;
		}
		const leaseGeneration = job.leaseGeneration + 1n;
		await database
			.update(questpieCrdtProjectionTable)
			.set({
				status: 2,
				attempts: job.attempts + 1,
				leaseGeneration,
				updatedAt: sql`now()`,
			})
			.where(eq(questpieCrdtProjectionTable.id, job.id));
		return Object.freeze({
			id: job.id,
			resourceId: job.resourceId,
			resourceEpochId: job.resourceEpochId,
			aggregateEpoch: epoch.aggregateEpoch,
			schemaId: job.schemaId,
			targetCommitSeq: job.targetCommitSeq,
			leaseGeneration,
		});
	});
}

async function commitProjection<TOwner>(
	db: CrdtDatabase,
	prepared: CrdtPreparedProjection,
	ownerPort: CrdtProjectionOwnerPort<TOwner>,
) {
	const claim = prepared.claim;
	const owner = await ownerPort.lock(db, { resourceId: claim.resourceId });
	const [resource] = await db
		.select()
		.from(questpieCrdtResourceTable)
		.where(eq(questpieCrdtResourceTable.id, claim.resourceId))
		.for("update");
	const [epoch] = await db
		.select()
		.from(questpieCrdtResourceEpochTable)
		.where(
			and(
				eq(questpieCrdtResourceEpochTable.id, claim.resourceEpochId),
				eq(questpieCrdtResourceEpochTable.resourceId, claim.resourceId),
			),
		)
		.for("update");
	if (
		!resource ||
		!epoch ||
		resource.status !== 1 ||
		resource.currentEpochId !== claim.resourceEpochId ||
		epoch.status !== 1 ||
		epoch.aggregateEpoch !== claim.aggregateEpoch ||
		epoch.schemaId !== claim.schemaId
	) {
		await finishJob(db, claim, 3);
		return {
			status: "noop" as const,
			projectedCommitSeq: claim.targetCommitSeq,
		};
	}
	if (epoch.projectedCommitSeq >= claim.targetCommitSeq) {
		await finishJob(db, claim, 3);
		return {
			status: "noop" as const,
			projectedCommitSeq: epoch.projectedCommitSeq,
		};
	}
	if (epoch.projectedCommitSeq !== prepared.basisProjectedCommitSeq) {
		await finishJob(db, claim, 4);
		return {
			status: "reprepare" as const,
			projectedCommitSeq: epoch.projectedCommitSeq,
		};
	}
	const bindings = await db
		.select()
		.from(questpieCrdtBindingTable)
		.where(
			and(
				eq(questpieCrdtBindingTable.resourceId, claim.resourceId),
				inArray(questpieCrdtBindingTable.status, [1, 3]),
				isNull(questpieCrdtBindingTable.retiredAt),
			),
		)
		.orderBy(asc(questpieCrdtBindingTable.id))
		.for("update");
	const [lockedJob] = await db
		.select({ id: questpieCrdtProjectionTable.id })
		.from(questpieCrdtProjectionTable)
		.where(
			and(
				eq(questpieCrdtProjectionTable.id, claim.id),
				eq(questpieCrdtProjectionTable.status, 2),
				eq(questpieCrdtProjectionTable.leaseGeneration, claim.leaseGeneration),
			),
		)
		.for("update");
	if (!lockedJob) {
		return {
			status: "reprepare" as const,
			projectedCommitSeq: epoch.projectedCommitSeq,
		};
	}
	const scheduled = new Map(
		(await loadScheduledFields(db, claim.id)).map((field) => [
			field.bindingId,
			field,
		]),
	);
	const fields = new Map(
		prepared.fields.map((field) => [field.bindingId, field]),
	);
	if (
		bindings.length !== prepared.fields.length ||
		bindings.length !== scheduled.size ||
		bindings.some((binding) => {
			const field = fields.get(binding.id);
			const scheduledField = scheduled.get(binding.id);
			return (
				!field ||
				!scheduledField ||
				field.stableFieldId !== binding.stableFieldId ||
				scheduledField.stableFieldId !== binding.stableFieldId ||
				field.fieldEpoch !== binding.fieldEpoch ||
				scheduledField.fieldEpoch !== binding.fieldEpoch ||
				scheduledField.fieldSlot !== binding.fieldSlot ||
				scheduledField.formatVersion !== binding.formatVersion ||
				scheduledField.expectedCanonicalRevision >
					binding.projectedCanonicalRevision ||
				(scheduledField.expectedCanonicalRevision ===
					binding.projectedCanonicalRevision &&
					!equalBytes(
						scheduledField.expectedCanonicalHash,
						binding.projectedCanonicalHash,
					)) ||
				field.targetFieldCursor !== scheduledField.targetFieldCursor ||
				field.shouldWrite !== scheduledField.shouldWrite ||
				field.targetFieldCursor < binding.projectedFieldCursor ||
				field.targetFieldCursor > binding.headFieldCursor ||
				field.canonicalRevision !==
					binding.projectedCanonicalRevision +
						(field.targetFieldCursor - binding.projectedFieldCursor) ||
				(field.targetFieldCursor === binding.headFieldCursor &&
					!equalBytes(field.canonicalHash, binding.canonicalHash))
			);
		})
	) {
		await suspendAggregate(db, claim.resourceId);
		await finishJob(db, claim, 5);
		return {
			status: "suspended" as const,
			projectedCommitSeq: epoch.projectedCommitSeq,
		};
	}
	const rawHashes = await ownerPort.readCanonicalHashes(
		db,
		owner,
		bindings.map((binding) => ({
			bindingId: binding.id,
			sourcePath: binding.sourcePath,
			format: binding.format as 1 | 2,
		})),
	);
	const rawConflict = bindings.some((binding) => {
		const rawHash = rawHashes.get(binding.id);
		return !rawHash || !equalBytes(rawHash, binding.projectedCanonicalHash);
	});
	if (rawConflict) {
		await suspendAggregate(db, claim.resourceId);
		await finishJob(db, claim, 5);
		return {
			status: "suspended" as const,
			projectedCommitSeq: epoch.projectedCommitSeq,
		};
	}
	const values = new Map<string, string | readonly string[]>();
	const changed = new Set<string>();
	for (const binding of bindings) {
		const field = fields.get(binding.id)!;
		values.set(binding.sourcePath, field.value);
		if (
			field.shouldWrite &&
			field.targetFieldCursor > binding.projectedFieldCursor
		) {
			changed.add(binding.sourcePath);
		}
	}
	let canonicalValues: ReadonlyMap<string, string | readonly string[]> = values;
	let ownerChanged = false;
	if (changed.size > 0 && ownerPort.prepareAcknowledgement) {
		const preparedAcknowledgement = await ownerPort.prepareAcknowledgement(
			db,
			owner,
			{
				values,
				changed,
				resourceId: claim.resourceId,
				resourceEpochId: claim.resourceEpochId,
				basisCommitSeq: prepared.basisProjectedCommitSeq,
				commitSeq: claim.targetCommitSeq,
			},
		);
		if (preparedAcknowledgement?.values) {
			canonicalValues = validateCanonicalValues(
				preparedAcknowledgement.values,
				bindings,
			);
		}
		ownerChanged = preparedAcknowledgement?.ownerChanged === true;
	}
	const canonicalHashes = new Map<string, Uint8Array>();
	const canonicalWrites = new Map<string, string | readonly string[]>();
	for (const binding of bindings) {
		const value = canonicalValues.get(binding.sourcePath)!;
		const canonicalHash = await hashCrdtCanonicalValue(
			binding.format === 1 ? "text" : "set",
			value,
		);
		canonicalHashes.set(binding.id, canonicalHash);
		const rawHash = rawHashes.get(binding.id)!;
		if (!equalBytes(rawHash, canonicalHash)) {
			canonicalWrites.set(binding.sourcePath, value);
		}
	}
	if (canonicalWrites.size > 0 || ownerChanged) {
		await ownerPort.writeCanonical(db, owner, canonicalWrites);
	}
	for (const binding of bindings) {
		const field = fields.get(binding.id)!;
		const canonicalHash = canonicalHashes.get(binding.id)!;
		const cursorAdvanced =
			field.targetFieldCursor > binding.projectedFieldCursor;
		const canonicalChanged = !equalBytes(
			canonicalHash,
			binding.projectedCanonicalHash,
		);
		if (!cursorAdvanced && !canonicalChanged) continue;
		await db
			.update(questpieCrdtBindingTable)
			.set({
				projectedFieldCursor: field.targetFieldCursor,
				projectedCanonicalHash: Buffer.from(canonicalHash),
				projectedCanonicalRevision: cursorAdvanced
					? field.canonicalRevision
					: binding.projectedCanonicalRevision,
				updatedAt: sql`now()`,
			})
			.where(eq(questpieCrdtBindingTable.id, binding.id));
	}
	await db
		.update(questpieCrdtResourceEpochTable)
		.set({
			projectedCommitSeq: claim.targetCommitSeq,
			updatedAt: sql`now()`,
		})
		.where(eq(questpieCrdtResourceEpochTable.id, claim.resourceEpochId));
	if (canonicalWrites.size > 0 || ownerChanged) {
		const outboxChanges = await ownerPort.appendRealtimeChange(db, owner, {
			origin: "crdt_projection",
			resourceId: claim.resourceId,
			resourceEpochId: claim.resourceEpochId,
			commitSeq: claim.targetCommitSeq,
		});
		if (outboxChanges !== 1) {
			throw new TypeError(
				"CRDT projection must append exactly one realtime change",
			);
		}
	}
	await db
		.update(questpieCrdtProjectionTable)
		.set({ status: 3, updatedAt: sql`now()` })
		.where(
			and(
				eq(questpieCrdtProjectionTable.resourceId, claim.resourceId),
				eq(questpieCrdtProjectionTable.resourceEpochId, claim.resourceEpochId),
				lte(questpieCrdtProjectionTable.targetCommitSeq, claim.targetCommitSeq),
				inArray(questpieCrdtProjectionTable.status, [1, 4]),
			),
		);
	await finishJob(db, claim, 3);
	return Object.freeze({
		status: "applied" as const,
		projectedCommitSeq: claim.targetCommitSeq,
	});
}

function validateCanonicalValues(
	values: ReadonlyMap<string, string | readonly string[]>,
	bindings: readonly (typeof questpieCrdtBindingTable.$inferSelect)[],
): ReadonlyMap<string, string | readonly string[]> {
	if (!(values instanceof Map) || values.size !== bindings.length) {
		throw new TypeError(
			"CRDT projection acknowledgement must return the complete aggregate cut",
		);
	}
	const result = new Map<string, string | readonly string[]>();
	for (const binding of bindings) {
		const value = values.get(binding.sourcePath);
		if (
			(binding.format === 1 && typeof value !== "string") ||
			(binding.format === 2 &&
				(!Array.isArray(value) ||
					value.some((entry) => typeof entry !== "string")))
		) {
			throw new TypeError(
				`CRDT projection acknowledgement returned an invalid value for '${binding.sourcePath}'`,
			);
		}
		result.set(
			binding.sourcePath,
			Array.isArray(value) ? Object.freeze([...value]) : value,
		);
	}
	return result;
}

async function suspendAggregate(
	db: CrdtDatabase,
	resourceId: string,
): Promise<void> {
	await db
		.update(questpieCrdtResourceTable)
		.set({ status: 3, updatedAt: sql`now()` })
		.where(eq(questpieCrdtResourceTable.id, resourceId));
	await db
		.update(questpieCrdtBindingTable)
		.set({ status: 3, updatedAt: sql`now()` })
		.where(
			and(
				eq(questpieCrdtBindingTable.resourceId, resourceId),
				isNull(questpieCrdtBindingTable.retiredAt),
			),
		);
}

async function loadScheduledFields(
	db: CrdtDatabase,
	projectionId: string,
): Promise<readonly ScheduledField[]> {
	const rows = await db
		.select()
		.from(questpieCrdtProjectionFieldTable)
		.where(eq(questpieCrdtProjectionFieldTable.projectionId, projectionId))
		.orderBy(asc(questpieCrdtProjectionFieldTable.bindingId));
	return Object.freeze(
		rows.map((row) =>
			Object.freeze({
				bindingId: row.bindingId,
				stableFieldId: row.stableFieldId,
				fieldEpoch: row.fieldEpoch,
				fieldSlot: row.fieldSlot,
				formatVersion: row.formatVersion,
				targetFieldCursor: row.targetFieldCursor,
				expectedCanonicalHash: new Uint8Array(row.expectedCanonicalHash),
				expectedCanonicalRevision: row.expectedCanonicalRevision,
				shouldWrite: row.shouldWrite === 1,
			}),
		),
	);
}

async function loadNoopFields(
	db: CrdtDatabase,
	claim: CrdtProjectionClaim,
): Promise<readonly CrdtProjectionField[]> {
	const bindings = await db
		.select()
		.from(questpieCrdtBindingTable)
		.where(
			and(
				eq(questpieCrdtBindingTable.resourceId, claim.resourceId),
				inArray(questpieCrdtBindingTable.status, [1, 3]),
				isNull(questpieCrdtBindingTable.retiredAt),
			),
		);
	return bindings.map((binding) => ({
		bindingId: binding.id,
		stableFieldId: binding.stableFieldId,
		fieldEpoch: binding.fieldEpoch,
		targetFieldCursor: binding.projectedFieldCursor,
		canonicalHash: binding.projectedCanonicalHash,
		canonicalRevision: binding.projectedCanonicalRevision,
		value: "",
		shouldWrite: false,
	}));
}

async function finishJob(
	db: CrdtDatabase,
	claim: CrdtProjectionClaim,
	status: 3 | 4 | 5,
): Promise<void> {
	await db
		.update(questpieCrdtProjectionTable)
		.set({ status, updatedAt: sql`now()` })
		.where(
			and(
				eq(questpieCrdtProjectionTable.id, claim.id),
				eq(questpieCrdtProjectionTable.status, 2),
				eq(questpieCrdtProjectionTable.leaseGeneration, claim.leaseGeneration),
			),
		);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	return (
		left.byteLength === right.byteLength &&
		left.every((value, index) => value === right[index])
	);
}
