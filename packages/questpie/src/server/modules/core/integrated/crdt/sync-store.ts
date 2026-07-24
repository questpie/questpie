import { createHash } from "node:crypto";

import { and, asc, desc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";

import type { AnyDrizzleClient } from "#questpie/server/config/types.js";
import type {
	CrdtEngineFormat,
	CrdtEngineReplica,
	CrdtFieldEngine,
} from "#questpie/shared/crdt-engine.js";

import { loadCrdtAuthoritativeReplica } from "./append-store.js";
import {
	questpieCrdtBindingTable,
	questpieCrdtCommitTable,
	questpieCrdtResourceEpochTable,
	questpieCrdtSchemaTable,
	questpieCrdtSessionGrantTable,
	questpieCrdtSessionTable,
	questpieCrdtSnapshotManifestTable,
	questpieCrdtSnapshotTable,
	questpieCrdtUpdateTable,
} from "./schema.js";
import type {
	CrdtSyncBasis,
	CrdtSyncCommit,
	CrdtSyncField,
	CrdtSyncSource,
	CrdtSyncUpdateCommit,
} from "./sync.js";
import { CrdtSyncRecoveryRequiredError } from "./sync.js";

type CrdtDatabase = AnyDrizzleClient<any>;
type AnyEngine = CrdtFieldEngine<CrdtEngineFormat, any>;

type MaterializedField = {
	engine: AnyEngine;
	replica: CrdtEngineReplica<CrdtEngineFormat, any>;
};

const materializedBases = new WeakMap<object, Map<number, MaterializedField>>();
const activeFieldsByBasis = new WeakMap<object, Map<number, CrdtSyncField>>();
const pendingFieldsByBasis = new WeakMap<object, Map<number, CrdtSyncField>>();

/**
 * Durable aggregate synchronization source. Basis materialization happens in
 * one repeatable-read transaction so independently authorized fields cannot
 * observe mixed aggregate cuts.
 */
export function createCrdtDatabaseSyncSource(
	db: CrdtDatabase,
	input: Readonly<{
		resolveEngine(binding: {
			format: number;
			formatVersion: number;
		}): AnyEngine;
	}>,
): CrdtSyncSource {
	const source: CrdtSyncSource = {
		async captureBasis(sessionId) {
			return db.transaction(
				async (transaction) => {
					const tx = transaction as CrdtDatabase;
					const [session] = await tx
						.select()
						.from(questpieCrdtSessionTable)
						.where(
							and(
								eq(questpieCrdtSessionTable.id, sessionId),
								isNull(questpieCrdtSessionTable.closedAt),
							),
						)
						.limit(1);
					if (!session) throw rejected();
					const [epoch] = await tx
						.select()
						.from(questpieCrdtResourceEpochTable)
						.where(
							and(
								eq(
									questpieCrdtResourceEpochTable.resourceId,
									session.resourceId,
								),
								eq(questpieCrdtResourceEpochTable.id, session.resourceEpochId),
								eq(questpieCrdtResourceEpochTable.schemaId, session.schemaId),
								eq(questpieCrdtResourceEpochTable.status, 1),
							),
						)
						.limit(1);
					if (!epoch) throw rejected();
					const [schema] = await tx
						.select({ version: questpieCrdtSchemaTable.schemaVersion })
						.from(questpieCrdtSchemaTable)
						.where(eq(questpieCrdtSchemaTable.id, session.schemaId))
						.limit(1);
					if (
						!schema ||
						schema.version < 0n ||
						schema.version > BigInt(0xffff_ffff)
					) {
						throw rejected();
					}
					const grants = await tx
						.select({
							bindingId: questpieCrdtSessionGrantTable.bindingId,
							fieldSlot: questpieCrdtSessionGrantTable.fieldSlot,
							fieldEpoch: questpieCrdtSessionGrantTable.fieldEpoch,
							grant: questpieCrdtSessionGrantTable.grant,
							fieldReadFence: questpieCrdtSessionGrantTable.fieldReadFence,
							fieldEditFence: questpieCrdtSessionGrantTable.fieldEditFence,
						})
						.from(questpieCrdtSessionGrantTable)
						.where(eq(questpieCrdtSessionGrantTable.sessionId, sessionId))
						.orderBy(asc(questpieCrdtSessionGrantTable.fieldSlot));
					const readable = grants.filter((grant) => grant.grant >= 0);
					const bindings =
						readable.length === 0
							? []
							: await tx
									.select()
									.from(questpieCrdtBindingTable)
									.where(
										and(
											eq(
												questpieCrdtBindingTable.resourceId,
												session.resourceId,
											),
											inArray(
												questpieCrdtBindingTable.id,
												readable.map((grant) => grant.bindingId),
											),
											eq(questpieCrdtBindingTable.status, 1),
											isNull(questpieCrdtBindingTable.retiredAt),
										),
									);
					const bindingById = new Map(
						bindings.map((binding) => [binding.id, binding]),
					);
					const fields: CrdtSyncField[] = [];
					const materialized = new Map<number, MaterializedField>();
					const engines = new Map<number, AnyEngine>();
					for (const grant of readable) {
						const binding = bindingById.get(grant.bindingId);
						if (
							!binding ||
							binding.fieldSlot !== grant.fieldSlot ||
							binding.fieldEpoch !== grant.fieldEpoch ||
							binding.readFence !== grant.fieldReadFence ||
							binding.editFence !== grant.fieldEditFence
						) {
							throw rejected();
						}
						const engine = input.resolveEngine(binding);
						if (
							engine.formatVersion !== binding.formatVersion ||
							(engine.format === "text" ? 1 : 2) !== binding.format
						) {
							throw rejected();
						}
						engines.set(binding.fieldSlot, engine);
					}
					const selected = await materializeCrdtAggregateAtCut(tx, {
						resourceId: session.resourceId,
						resourceEpochId: session.resourceEpochId,
						schemaId: session.schemaId,
						targetCommitSeq: epoch.headCommitSeq,
						currentManifestId: epoch.currentSnapshotManifestId,
						previousManifestId: epoch.previousSnapshotManifestId,
						bindings,
						engines,
						targetFieldCursors: new Map(
							bindings.map((binding) => [binding.id, binding.headFieldCursor]),
						),
					});
					if (!selected) throw rejected();
					let totalBytes = 0;
					for (const grant of readable) {
						const binding = bindingById.get(grant.bindingId)!;
						const replica = selected.get(binding.fieldSlot);
						const engine = engines.get(binding.fieldSlot)!;
						if (!replica) throw rejected();
						const bytes = await engine.snapshot(replica);
						totalBytes += bytes.byteLength;
						if (totalBytes > 64 * 1024 * 1024) throw rejected();
						fields.push(
							Object.freeze({
								bindingId: binding.id,
								fieldSlot: binding.fieldSlot,
								fieldEpoch: binding.fieldEpoch,
								grant: grant.grant as 0 | 1,
								formatVersion: binding.formatVersion,
								readFence: binding.readFence,
								editFence: binding.editFence,
								fieldCursor: replica.basis.fieldCursor,
								bytes,
							}),
						);
						materialized.set(binding.fieldSlot, { engine, replica });
					}
					const basis = Object.freeze({
						sessionId,
						resourceId: session.resourceId,
						resourceEpochId: session.resourceEpochId,
						schemaId: session.schemaId,
						aggregateEpoch: epoch.aggregateEpoch,
						schemaVersion: Number(schema.version),
						commitHead: epoch.headCommitSeq,
						fields: Object.freeze(fields),
					});
					materializedBases.set(basis, materialized);
					activeFieldsByBasis.set(
						basis,
						new Map(fields.map((field) => [field.fieldSlot, field])),
					);
					pendingFieldsByBasis.set(basis, new Map());
					return basis;
				},
				{
					accessMode: "read only",
					isolationLevel: "repeatable read",
				},
			);
		},
		async registerCursor(sessionId, cursor) {
			const updated = await db
				.update(questpieCrdtSessionTable)
				.set({ lastSeenCommitSeq: cursor })
				.where(
					and(
						eq(questpieCrdtSessionTable.id, sessionId),
						isNull(questpieCrdtSessionTable.closedAt),
						lte(questpieCrdtSessionTable.lastSeenCommitSeq, cursor),
					),
				)
				.returning({ id: questpieCrdtSessionTable.id });
			if (updated.length !== 1) throw rejected();
		},
		async verifyProof(basis, { field, proof }) {
			return createCrdtBasisProofVerifier(basis)({ field, proof });
		},
		async validateBasis(basis) {
			await validateBasisAuthority(db, basis);
		},
		async activateField(basis, field) {
			const active = activeFieldsByBasis.get(basis);
			const pending = pendingFieldsByBasis.get(basis);
			if (!active || pending?.get(field.fieldSlot) !== field) throw rejected();
			active.set(field.fieldSlot, field);
			pending.delete(field.fieldSlot);
		},
		async readHead(basis) {
			await validateBasisAuthority(db, basis);
			const [epoch] = await db
				.select({ head: questpieCrdtResourceEpochTable.headCommitSeq })
				.from(questpieCrdtResourceEpochTable)
				.where(
					and(
						eq(questpieCrdtResourceEpochTable.resourceId, basis.resourceId),
						eq(questpieCrdtResourceEpochTable.id, basis.resourceEpochId),
						eq(
							questpieCrdtResourceEpochTable.aggregateEpoch,
							basis.aggregateEpoch,
						),
						eq(questpieCrdtResourceEpochTable.status, 1),
					),
				)
				.limit(1);
			if (!epoch) throw rejected();
			return epoch.head;
		},
		async readCommits(basis, after, through) {
			if (through < after) throw rejected();
			const activeFields = activeFieldsByBasis.get(basis);
			const pendingFields = pendingFieldsByBasis.get(basis);
			const materialized = materializedBases.get(basis);
			if (!activeFields || !pendingFields || !materialized) throw rejected();
			const visibleFields = [...activeFields.values()];
			const commits = await db
				.select({
					commitSeq: questpieCrdtCommitTable.commitSeq,
					kind: questpieCrdtCommitTable.kind,
					schemaId: questpieCrdtCommitTable.schemaId,
					deliveryCommitId: questpieCrdtCommitTable.deliveryCommitId,
					controlPayload: questpieCrdtCommitTable.controlPayload,
				})
				.from(questpieCrdtCommitTable)
				.where(
					and(
						eq(questpieCrdtCommitTable.resourceId, basis.resourceId),
						eq(questpieCrdtCommitTable.resourceEpochId, basis.resourceEpochId),
						gt(questpieCrdtCommitTable.commitSeq, after),
						lte(questpieCrdtCommitTable.commitSeq, through),
					),
				)
				.orderBy(asc(questpieCrdtCommitTable.commitSeq));
			const updates =
				commits.length === 0 || visibleFields.length === 0
					? []
					: await db
							.select()
							.from(questpieCrdtUpdateTable)
							.where(
								and(
									eq(questpieCrdtUpdateTable.resourceId, basis.resourceId),
									eq(
										questpieCrdtUpdateTable.resourceEpochId,
										basis.resourceEpochId,
									),
									gt(questpieCrdtUpdateTable.commitSeq, after),
									lte(questpieCrdtUpdateTable.commitSeq, through),
									inArray(
										questpieCrdtUpdateTable.bindingId,
										visibleFields.map((field) => field.bindingId),
									),
								),
							)
							.orderBy(
								asc(questpieCrdtUpdateTable.commitSeq),
								asc(questpieCrdtUpdateTable.fieldSlot),
							);
			const visibleSlots = new Set(
				visibleFields.map((field) => field.fieldSlot),
			);
			const visibleBySlot = new Map(
				visibleFields.map((field) => [field.fieldSlot, field]),
			);
			if (commits.some((commit) => commit.schemaId !== basis.schemaId)) {
				throw new CrdtSyncRecoveryRequiredError();
			}
			const updatesByCommit = new Map<
				bigint,
				CrdtSyncUpdateCommit["fields"][number][]
			>();
			const expectedCursors = new Map<number, bigint>();
			for (const field of visibleFields) {
				if (after === basis.commitHead) {
					expectedCursors.set(field.fieldSlot, field.fieldCursor);
					continue;
				}
				const [latest] = await db
					.select({ fieldCursor: questpieCrdtUpdateTable.fieldCursor })
					.from(questpieCrdtUpdateTable)
					.where(
						and(
							eq(questpieCrdtUpdateTable.resourceId, basis.resourceId),
							eq(
								questpieCrdtUpdateTable.resourceEpochId,
								basis.resourceEpochId,
							),
							eq(questpieCrdtUpdateTable.bindingId, field.bindingId),
							lte(questpieCrdtUpdateTable.commitSeq, after),
						),
					)
					.orderBy(desc(questpieCrdtUpdateTable.commitSeq))
					.limit(1);
				expectedCursors.set(
					field.fieldSlot,
					latest?.fieldCursor ?? field.fieldCursor,
				);
			}
			for (const update of updates) {
				if (!visibleSlots.has(update.fieldSlot)) continue;
				const field = visibleBySlot.get(update.fieldSlot);
				const expectedCursor = expectedCursors.get(update.fieldSlot);
				if (
					!field ||
					expectedCursor === undefined ||
					update.bindingId !== field.bindingId ||
					update.schemaId !== basis.schemaId ||
					update.fieldEpoch !== field.fieldEpoch ||
					update.formatVersion !== field.formatVersion ||
					update.baseFieldCursor !== expectedCursor ||
					update.fieldCursor !== expectedCursor + 1n ||
					update.sizeBytes !== update.bytes.byteLength ||
					!equalBytes(
						createHash("sha256").update(update.bytes).digest(),
						update.checksum,
					)
				) {
					throw rejected();
				}
				expectedCursors.set(update.fieldSlot, update.fieldCursor);
				const fields = updatesByCommit.get(update.commitSeq) ?? [];
				fields.push({
					fieldSlot: update.fieldSlot,
					fieldEpoch: update.fieldEpoch,
					formatVersion: update.formatVersion,
					fieldCursor: update.fieldCursor,
					bytes: new Uint8Array(update.bytes),
				});
				updatesByCommit.set(update.commitSeq, fields);
			}
			return Promise.all(
				commits.map(async (commit): Promise<CrdtSyncCommit> => {
					if (commit.kind === 1) {
						return Object.freeze({
							commitSeq: commit.commitSeq,
							kind: 1 as const,
							commitId: uuidBytes(commit.deliveryCommitId),
							fields: Object.freeze(
								updatesByCommit.get(commit.commitSeq) ?? [],
							),
						});
					}
					if (commit.kind !== 2) {
						throw new CrdtSyncRecoveryRequiredError();
					}
					const control = parseFieldResetControl(commit.controlPayload);
					const source = [
						...pendingFields.values(),
						...activeFields.values(),
					].find((field) => field.bindingId === control.sourceBindingId);
					if (!source) throw new CrdtSyncRecoveryRequiredError();
					const [target] = await db
						.select()
						.from(questpieCrdtBindingTable)
						.where(
							and(
								eq(questpieCrdtBindingTable.resourceId, basis.resourceId),
								eq(questpieCrdtBindingTable.id, control.targetBindingId),
								eq(questpieCrdtBindingTable.schemaId, basis.schemaId),
								eq(questpieCrdtBindingTable.status, 1),
								isNull(questpieCrdtBindingTable.retiredAt),
							),
						)
						.limit(1);
					if (
						!target ||
						target.stableFieldId !== control.stableFieldId ||
						target.fieldSlot !== source.fieldSlot ||
						target.fieldEpoch !== control.targetFieldEpoch ||
						target.headFieldCursor !== 0n
					) {
						throw new CrdtSyncRecoveryRequiredError();
					}
					const engine = input.resolveEngine(target);
					if (
						engine.formatVersion !== target.formatVersion ||
						(engine.format === "text" ? 1 : 2) !== target.format
					) {
						throw new CrdtSyncRecoveryRequiredError();
					}
					let authoritative;
					try {
						authoritative = await loadCrdtAuthoritativeReplica(db, {
							bindingId: target.id,
							engine,
						});
					} catch {
						throw new CrdtSyncRecoveryRequiredError();
					}
					const bytes = await engine.snapshot(authoritative.replica);
					const field = Object.freeze({
						bindingId: target.id,
						fieldSlot: target.fieldSlot,
						fieldEpoch: target.fieldEpoch,
						grant: source.grant,
						formatVersion: target.formatVersion,
						readFence: target.readFence,
						editFence: target.editFence,
						fieldCursor: target.headFieldCursor,
						bytes,
					});
					pendingFields.set(field.fieldSlot, field);
					materialized.set(field.fieldSlot, {
						engine,
						replica: authoritative.replica,
					});
					return Object.freeze({
						commitSeq: commit.commitSeq,
						kind: 2 as const,
						commitId: uuidBytes(commit.deliveryCommitId),
						field,
						transition: Object.freeze({
							fieldSlot: target.fieldSlot,
							grant: source.grant,
							fieldEpoch: target.fieldEpoch,
							headFieldCursor: target.headFieldCursor,
						}),
					});
				}),
			);
		},
	};
	return source;
}

export function createCrdtBasisProofVerifier(basis: CrdtSyncBasis) {
	const fields = materializedBases.get(basis);
	if (!fields) throw rejected();
	return async ({
		field,
		proof,
	}: {
		field: CrdtSyncField;
		proof: Uint8Array;
	}): Promise<Uint8Array | null> => {
		const materialized = fields.get(field.fieldSlot);
		if (!materialized) throw rejected();
		const diff = await materialized.engine.diff({
			replica: materialized.replica,
			proof,
		});
		return diff.kind === "current" ? new Uint8Array() : diff.snapshot;
	};
}

export async function materializeCrdtAggregateAtCut(
	db: CrdtDatabase,
	input: {
		resourceId: string;
		resourceEpochId: string;
		schemaId: string;
		targetCommitSeq: bigint;
		currentManifestId: string | null;
		previousManifestId: string | null;
		bindings: readonly (typeof questpieCrdtBindingTable.$inferSelect)[];
		engines: ReadonlyMap<number, AnyEngine>;
		targetFieldCursors: ReadonlyMap<string, bigint>;
	},
): Promise<Map<number, CrdtEngineReplica<CrdtEngineFormat, any>> | null> {
	for (const manifestId of [
		input.currentManifestId,
		input.previousManifestId,
	]) {
		if (!manifestId) continue;
		try {
			const [manifest] = await db
				.select()
				.from(questpieCrdtSnapshotManifestTable)
				.where(
					and(
						eq(questpieCrdtSnapshotManifestTable.id, manifestId),
						eq(questpieCrdtSnapshotManifestTable.resourceId, input.resourceId),
						eq(
							questpieCrdtSnapshotManifestTable.resourceEpochId,
							input.resourceEpochId,
						),
						eq(questpieCrdtSnapshotManifestTable.schemaId, input.schemaId),
						eq(questpieCrdtSnapshotManifestTable.status, 2),
						lte(
							questpieCrdtSnapshotManifestTable.coversCommitSeq,
							input.targetCommitSeq,
						),
					),
				)
				.limit(1);
			if (!manifest?.verifiedAt) continue;
			const snapshots =
				input.bindings.length === 0
					? []
					: await db
							.select()
							.from(questpieCrdtSnapshotTable)
							.where(
								and(
									eq(questpieCrdtSnapshotTable.manifestId, manifestId),
									inArray(
										questpieCrdtSnapshotTable.bindingId,
										input.bindings.map((binding) => binding.id),
									),
								),
							);
			if (snapshots.length !== input.bindings.length) continue;
			const snapshotsByBinding = new Map(
				snapshots.map((snapshot) => [snapshot.bindingId, snapshot]),
			);
			const result = new Map<
				number,
				CrdtEngineReplica<CrdtEngineFormat, any>
			>();
			for (const binding of input.bindings) {
				const engine = input.engines.get(binding.fieldSlot);
				const snapshot = snapshotsByBinding.get(binding.id);
				const targetFieldCursor = input.targetFieldCursors.get(binding.id);
				if (
					!engine ||
					!snapshot ||
					targetFieldCursor === undefined ||
					snapshot.fieldCursor > targetFieldCursor ||
					snapshot.schemaId !== input.schemaId ||
					snapshot.fieldEpoch !== binding.fieldEpoch ||
					snapshot.fieldSlot !== binding.fieldSlot ||
					snapshot.formatVersion !== binding.formatVersion ||
					snapshot.engineId !== engine.engineId ||
					snapshot.engineVersion !== engine.engineVersion ||
					snapshot.stateVersion !== engine.stateVersion ||
					snapshot.sizeBytes !== snapshot.bytes.byteLength ||
					!equalBytes(
						createHash("sha256").update(snapshot.bytes).digest(),
						snapshot.checksum,
					)
				) {
					throw rejected();
				}
				let replica = await engine.restore({
					snapshot: new Uint8Array(snapshot.bytes),
					basis: {
						fieldEpoch: snapshot.fieldEpoch,
						fieldCursor: snapshot.fieldCursor,
					},
				});
				if (
					replica.engineId !== engine.engineId ||
					replica.format !== engine.format ||
					replica.formatVersion !== engine.formatVersion ||
					replica.basis.fieldEpoch !== snapshot.fieldEpoch ||
					replica.basis.fieldCursor !== snapshot.fieldCursor ||
					!equalBytes(replica.state, snapshot.bytes)
				) {
					throw rejected();
				}
				const updates = await db
					.select()
					.from(questpieCrdtUpdateTable)
					.where(
						and(
							eq(questpieCrdtUpdateTable.resourceId, input.resourceId),
							eq(
								questpieCrdtUpdateTable.resourceEpochId,
								input.resourceEpochId,
							),
							eq(questpieCrdtUpdateTable.bindingId, binding.id),
							gt(questpieCrdtUpdateTable.fieldCursor, snapshot.fieldCursor),
							lte(questpieCrdtUpdateTable.fieldCursor, targetFieldCursor),
						),
					)
					.orderBy(asc(questpieCrdtUpdateTable.fieldCursor));
				for (const update of updates) {
					if (
						update.schemaId !== input.schemaId ||
						update.fieldEpoch !== binding.fieldEpoch ||
						update.fieldSlot !== binding.fieldSlot ||
						update.formatVersion !== binding.formatVersion ||
						update.baseFieldCursor !== replica.basis.fieldCursor ||
						update.fieldCursor !== replica.basis.fieldCursor + 1n ||
						update.sizeBytes !== update.bytes.byteLength ||
						!equalBytes(
							createHash("sha256").update(update.bytes).digest(),
							update.checksum,
						)
					) {
						throw rejected();
					}
					const candidate = await engine.stage({
						replica,
						update: new Uint8Array(update.bytes),
					});
					replica = await engine.commit({
						candidate,
						current: replica,
						assignedFieldCursor: update.fieldCursor,
					});
				}
				if (replica.basis.fieldCursor !== targetFieldCursor) {
					throw rejected();
				}
				result.set(binding.fieldSlot, replica);
			}
			return result;
		} catch {
			// One bad component rejects the whole candidate manifest.
		}
	}
	return null;
}

async function validateBasisAuthority(
	db: CrdtDatabase,
	basis: CrdtSyncBasis,
): Promise<void> {
	const resetBindings = await readResetSourceBindings(db, basis);
	const [session] = await db
		.select({ id: questpieCrdtSessionTable.id })
		.from(questpieCrdtSessionTable)
		.where(
			and(
				eq(questpieCrdtSessionTable.id, basis.sessionId),
				eq(questpieCrdtSessionTable.resourceId, basis.resourceId),
				eq(questpieCrdtSessionTable.resourceEpochId, basis.resourceEpochId),
				eq(questpieCrdtSessionTable.schemaId, basis.schemaId),
				isNull(questpieCrdtSessionTable.closedAt),
				gt(questpieCrdtSessionTable.authorityExpiresAt, sql`clock_timestamp()`),
				gt(questpieCrdtSessionTable.leaseExpiresAt, sql`clock_timestamp()`),
			),
		)
		.limit(1);
	if (!session) throw rejected();
	const grants = await db
		.select({
			bindingId: questpieCrdtSessionGrantTable.bindingId,
			fieldEpoch: questpieCrdtSessionGrantTable.fieldEpoch,
			fieldSlot: questpieCrdtSessionGrantTable.fieldSlot,
			grant: questpieCrdtSessionGrantTable.grant,
			fieldReadFence: questpieCrdtSessionGrantTable.fieldReadFence,
			fieldEditFence: questpieCrdtSessionGrantTable.fieldEditFence,
		})
		.from(questpieCrdtSessionGrantTable)
		.where(eq(questpieCrdtSessionGrantTable.sessionId, basis.sessionId))
		.orderBy(asc(questpieCrdtSessionGrantTable.fieldSlot));
	if (grants.length !== basis.fields.length) throw rejected();
	for (let index = 0; index < grants.length; index++) {
		const grant = grants[index]!;
		const expected = basis.fields[index]!;
		if (
			grant.bindingId !== expected.bindingId ||
			grant.fieldSlot !== expected.fieldSlot ||
			grant.fieldEpoch !== expected.fieldEpoch ||
			grant.grant !== expected.grant ||
			grant.fieldReadFence !== expected.readFence ||
			grant.fieldEditFence !== expected.editFence
		) {
			throw rejected();
		}
	}
	const bindings =
		grants.length === 0
			? []
			: await db
					.select()
					.from(questpieCrdtBindingTable)
					.where(
						and(
							eq(questpieCrdtBindingTable.resourceId, basis.resourceId),
							inArray(
								questpieCrdtBindingTable.id,
								grants.map((grant) => grant.bindingId),
							),
							eq(questpieCrdtBindingTable.status, 1),
							isNull(questpieCrdtBindingTable.retiredAt),
						),
					);
	const bindingsById = new Map(
		bindings.map((binding) => [binding.id, binding]),
	);
	for (const expected of basis.fields) {
		const binding = bindingsById.get(expected.bindingId);
		if (!binding && resetBindings.has(expected.bindingId)) continue;
		if (
			!binding ||
			binding.fieldEpoch !== expected.fieldEpoch ||
			binding.fieldSlot !== expected.fieldSlot ||
			binding.formatVersion !== expected.formatVersion ||
			binding.readFence !== expected.readFence ||
			binding.editFence !== expected.editFence
		) {
			throw rejected();
		}
	}
}

type FieldResetControl = Readonly<{
	stableFieldId: string;
	sourceBindingId: string;
	targetBindingId: string;
	targetFieldEpoch: bigint;
}>;

function parseFieldResetControl(value: unknown): FieldResetControl {
	if (!value || typeof value !== "object") {
		throw new CrdtSyncRecoveryRequiredError();
	}
	const control = value as Record<string, unknown>;
	if (
		control.version !== 1 ||
		control.kind !== "field_reset" ||
		typeof control.stableFieldId !== "string" ||
		typeof control.sourceBindingId !== "string" ||
		typeof control.targetBindingId !== "string" ||
		typeof control.targetFieldEpoch !== "string" ||
		!/^(0|[1-9][0-9]*)$/.test(control.targetFieldEpoch)
	) {
		throw new CrdtSyncRecoveryRequiredError();
	}
	return {
		stableFieldId: control.stableFieldId,
		sourceBindingId: control.sourceBindingId,
		targetBindingId: control.targetBindingId,
		targetFieldEpoch: BigInt(control.targetFieldEpoch),
	};
}

async function readResetSourceBindings(
	db: CrdtDatabase,
	basis: CrdtSyncBasis,
): Promise<Set<string>> {
	const controls = await db
		.select({ payload: questpieCrdtCommitTable.controlPayload })
		.from(questpieCrdtCommitTable)
		.where(
			and(
				eq(questpieCrdtCommitTable.resourceId, basis.resourceId),
				eq(questpieCrdtCommitTable.resourceEpochId, basis.resourceEpochId),
				eq(questpieCrdtCommitTable.schemaId, basis.schemaId),
				eq(questpieCrdtCommitTable.kind, 2),
				gt(questpieCrdtCommitTable.commitSeq, basis.commitHead),
			),
		);
	return new Set(
		controls.map(
			(control) => parseFieldResetControl(control.payload).sourceBindingId,
		),
	);
}

function rejected(): Error {
	return new Error("CRDT synchronization rejected");
}

function uuidBytes(value: string): Uint8Array {
	const hex = value.replaceAll("-", "");
	if (!/^[a-f0-9]{32}$/i.test(hex)) throw rejected();
	return Uint8Array.from(
		Array.from({ length: 16 }, (_, index) =>
			Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
		),
	);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	return (
		left.byteLength === right.byteLength &&
		left.every((byte, index) => byte === right[index])
	);
}
