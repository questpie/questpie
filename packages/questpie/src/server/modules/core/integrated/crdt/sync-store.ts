import { and, asc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";

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
	questpieCrdtUpdateTable,
} from "./schema.js";
import type {
	CrdtSyncBasis,
	CrdtSyncCommit,
	CrdtSyncField,
	CrdtSyncSource,
} from "./sync.js";

type CrdtDatabase = AnyDrizzleClient<any>;
type AnyEngine = CrdtFieldEngine<CrdtEngineFormat, any>;

type MaterializedField = {
	engine: AnyEngine;
	replica: CrdtEngineReplica<CrdtEngineFormat, any>;
};

const materializedBases = new WeakMap<object, Map<number, MaterializedField>>();

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
					let totalBytes = 0;
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
						const authoritative = await loadCrdtAuthoritativeReplica(tx, {
							bindingId: binding.id,
							engine,
						});
						const bytes = await engine.snapshot(authoritative.replica);
						totalBytes += bytes.byteLength;
						if (totalBytes > 64 * 1024 * 1024) throw rejected();
						fields.push(
							Object.freeze({
								bindingId: binding.id,
								fieldSlot: binding.fieldSlot,
								fieldEpoch: binding.fieldEpoch,
								fieldCursor: authoritative.replica.basis.fieldCursor,
								bytes,
							}),
						);
						materialized.set(binding.fieldSlot, {
							engine,
							replica: authoritative.replica,
						});
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
		async readHead(basis) {
			if (!basis.sessionId) throw rejected();
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
						gt(
							questpieCrdtSessionTable.authorityExpiresAt,
							sql`clock_timestamp()`,
						),
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
					fieldReadFence: questpieCrdtSessionGrantTable.fieldReadFence,
					fieldEditFence: questpieCrdtSessionGrantTable.fieldEditFence,
				})
				.from(questpieCrdtSessionGrantTable)
				.where(eq(questpieCrdtSessionGrantTable.sessionId, basis.sessionId));
			if (grants.length !== basis.fields.length) throw rejected();
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
			for (const grant of grants) {
				const binding = bindingsById.get(grant.bindingId);
				if (
					!binding ||
					binding.fieldEpoch !== grant.fieldEpoch ||
					binding.fieldSlot !== grant.fieldSlot ||
					binding.readFence !== grant.fieldReadFence ||
					binding.editFence !== grant.fieldEditFence
				) {
					throw rejected();
				}
			}
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
			const commits = await db
				.select({
					commitSeq: questpieCrdtCommitTable.commitSeq,
					kind: questpieCrdtCommitTable.kind,
					schemaId: questpieCrdtCommitTable.schemaId,
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
				commits.length === 0
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
								),
							)
							.orderBy(
								asc(questpieCrdtUpdateTable.commitSeq),
								asc(questpieCrdtUpdateTable.fieldSlot),
							);
			const visibleSlots = new Set(
				basis.fields.map((field) => field.fieldSlot),
			);
			if (
				commits.some(
					(commit) => commit.kind !== 1 || commit.schemaId !== basis.schemaId,
				)
			) {
				throw rejected();
			}
			const updatesByCommit = new Map<
				bigint,
				CrdtSyncCommit["fields"][number][]
			>();
			for (const update of updates) {
				if (!visibleSlots.has(update.fieldSlot)) continue;
				const fields = updatesByCommit.get(update.commitSeq) ?? [];
				fields.push({
					fieldSlot: update.fieldSlot,
					fieldEpoch: update.fieldEpoch,
					fieldCursor: update.fieldCursor,
					bytes: new Uint8Array(update.bytes),
				});
				updatesByCommit.set(update.commitSeq, fields);
			}
			return commits.map((commit) =>
				Object.freeze({
					commitSeq: commit.commitSeq,
					kind: 1 as const,
					fields: Object.freeze(updatesByCommit.get(commit.commitSeq) ?? []),
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

function rejected(): Error {
	return new Error("CRDT synchronization rejected");
}
