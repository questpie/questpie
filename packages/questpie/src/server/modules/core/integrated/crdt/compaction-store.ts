import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";

import {
	and,
	asc,
	eq,
	inArray,
	isNull,
	lte,
	notInArray,
	sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { withTransaction } from "#questpie/server/collection/crud/shared/transaction.js";
import type { AnyDrizzleClient } from "#questpie/server/config/types.js";
import type {
	CrdtEngineFormat,
	CrdtEngineReplica,
	CrdtFieldEngine,
} from "#questpie/shared/crdt-engine.js";

import {
	createCrdtSnapshotManifestChecksum,
	CrdtDurableTransactionStore,
	type CrdtSnapshotCutField,
} from "./durable-store.js";
import {
	questpieCrdtBindingTable,
	questpieCrdtCommitTable,
	questpieCrdtLeaseTable,
	questpieCrdtProjectionFieldTable,
	questpieCrdtProjectionTable,
	questpieCrdtReceiptFieldTable,
	questpieCrdtRecoveryHoldTable,
	questpieCrdtResourceEpochTable,
	questpieCrdtResourceTable,
	questpieCrdtSnapshotManifestTable,
	questpieCrdtSnapshotTable,
	questpieCrdtUpdateReceiptTable,
	questpieCrdtUpdateTable,
} from "./schema.js";
import { materializeCrdtAggregateAtCut } from "./sync-store.js";

type CrdtDatabase = AnyDrizzleClient<any>;
type AnyEngine = CrdtFieldEngine<CrdtEngineFormat, any>;

const COMPACTION_LEASE_KIND = 1;
const DEFAULT_LEASE_MILLISECONDS = 30_000;
const DEFAULT_GC_LIMIT = 256;
const COMPACTION_COMMIT_TRIGGER = 512n;
const COMPACTION_BYTE_TRIGGER = 4n * 1024n * 1024n;

type CapturedCut = Readonly<{
	resourceId: string;
	resourceEpochId: string;
	definitionId: string;
	schemaId: string;
	coversCommitSeq: bigint;
	currentManifestId: string | null;
	previousManifestId: string | null;
	leaseOwnerId: string;
	leaseGeneration: bigint;
	bindings: readonly (typeof questpieCrdtBindingTable.$inferSelect)[];
	engines: ReadonlyMap<number, AnyEngine>;
}>;

type MaterializedSnapshot = Readonly<{
	cut: CapturedCut;
	manifestId: string;
	manifestChecksum: Uint8Array;
	fields: readonly CrdtSnapshotCutField[];
	rows: readonly (CrdtSnapshotCutField & { bytes: Uint8Array })[];
}>;

export function createCrdtCompactionStore(
	db: CrdtDatabase,
	options: Readonly<{
		ownerId: string;
		resolveEngine(binding: {
			format: number;
			formatVersion: number;
		}): AnyEngine;
		leaseMilliseconds?: number;
	}>,
) {
	if (
		!options.ownerId ||
		Buffer.byteLength(options.ownerId) > 256 ||
		!Number.isSafeInteger(
			options.leaseMilliseconds ?? DEFAULT_LEASE_MILLISECONDS,
		) ||
		(options.leaseMilliseconds ?? DEFAULT_LEASE_MILLISECONDS) < 1
	) {
		throw new TypeError("CRDT compaction lease configuration is invalid");
	}
	return Object.freeze({
		async runOnce(): Promise<
			Readonly<{ status: "idle" | "stale" | "published"; deleted: number }>
		> {
			const cut = await captureCut(db, {
				...options,
				leaseMilliseconds:
					options.leaseMilliseconds ?? DEFAULT_LEASE_MILLISECONDS,
			});
			if (!cut) return Object.freeze({ status: "idle", deleted: 0 });
			const candidate = await materializeCut(db, cut);
			await persistCandidate(db, candidate);
			try {
				await withTransaction(db, (tx) =>
					new CrdtDurableTransactionStore(
						tx as CrdtDatabase,
					).publishVerifiedSnapshot({
						resourceId: cut.resourceId,
						resourceEpochId: cut.resourceEpochId,
						schemaId: cut.schemaId,
						manifestId: candidate.manifestId,
						manifestChecksum: candidate.manifestChecksum,
						coversCommitSeq: cut.coversCommitSeq,
						expectedHeadCommitSeq: cut.coversCommitSeq,
						leaseOwnerId: cut.leaseOwnerId,
						leaseGeneration: cut.leaseGeneration,
						fields: candidate.fields,
					}),
				);
			} catch {
				return Object.freeze({ status: "stale", deleted: 0 });
			}
			const deleted = await collectCrdtGarbage(db, {
				resourceId: cut.resourceId,
				resourceEpochId: cut.resourceEpochId,
			});
			return Object.freeze({ status: "published", deleted });
		},
		collectExpired(limit = DEFAULT_GC_LIMIT): Promise<number> {
			if (
				!Number.isSafeInteger(limit) ||
				limit < 1 ||
				limit > DEFAULT_GC_LIMIT
			) {
				throw new TypeError("CRDT GC limit must be between 1 and 256");
			}
			return withTransaction(db, (tx) =>
				collectCrdtExpiredRecoveryRoots(tx as CrdtDatabase, { limit }),
			);
		},
	});
}

export async function collectCrdtGarbage(
	db: CrdtDatabase,
	input: Readonly<{
		resourceId: string;
		resourceEpochId: string;
		limit?: number;
	}>,
): Promise<number> {
	const limit = input.limit ?? DEFAULT_GC_LIMIT;
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > DEFAULT_GC_LIMIT) {
		throw new TypeError("CRDT GC limit must be between 1 and 256");
	}
	return withTransaction(db, async (transaction) => {
		const tx = transaction as CrdtDatabase;
		const [epoch] = await tx
			.select({
				currentManifestId:
					questpieCrdtResourceEpochTable.currentSnapshotManifestId,
				previousManifestId:
					questpieCrdtResourceEpochTable.previousSnapshotManifestId,
			})
			.from(questpieCrdtResourceEpochTable)
			.where(
				and(
					eq(questpieCrdtResourceEpochTable.resourceId, input.resourceId),
					eq(questpieCrdtResourceEpochTable.id, input.resourceEpochId),
				),
			)
			.for("update");
		if (!epoch?.currentManifestId) return 0;
		let remaining = limit;
		let deleted = 0;

		const expiredReceipts = await tx
			.select({ id: questpieCrdtUpdateReceiptTable.id })
			.from(questpieCrdtUpdateReceiptTable)
			.where(
				and(
					eq(questpieCrdtUpdateReceiptTable.resourceId, input.resourceId),
					eq(
						questpieCrdtUpdateReceiptTable.resourceEpochId,
						input.resourceEpochId,
					),
					sql`${questpieCrdtUpdateReceiptTable.expiresAt} <= clock_timestamp()`,
				),
			)
			.orderBy(asc(questpieCrdtUpdateReceiptTable.expiresAt))
			.limit(Math.min(remaining, 7))
			.for("update", { skipLocked: true });
		const receiptIds = expiredReceipts.map((receipt) => receipt.id);
		if (receiptIds.length > 0) {
			await tx
				.delete(questpieCrdtReceiptFieldTable)
				.where(inArray(questpieCrdtReceiptFieldTable.receiptId, receiptIds));
			const removed = await tx
				.delete(questpieCrdtUpdateReceiptTable)
				.where(inArray(questpieCrdtUpdateReceiptTable.id, receiptIds))
				.returning({ id: questpieCrdtUpdateReceiptTable.id });
			deleted += removed.length;
			remaining -= removed.length;
			return deleted;
		}

		if (remaining > 0) {
			const activeHolds = await tx
				.select({ id: questpieCrdtRecoveryHoldTable.id })
				.from(questpieCrdtRecoveryHoldTable)
				.where(
					and(
						eq(questpieCrdtRecoveryHoldTable.resourceId, input.resourceId),
						eq(
							questpieCrdtRecoveryHoldTable.resourceEpochId,
							input.resourceEpochId,
						),
						sql`${questpieCrdtRecoveryHoldTable.expiresAt} > clock_timestamp()`,
					),
				)
				.limit(1);
			if (activeHolds.length === 0) {
				const protectedIds = [
					epoch.currentManifestId,
					epoch.previousManifestId,
				].filter((id): id is string => id !== null);
				const oldManifests = await tx
					.select({ id: questpieCrdtSnapshotManifestTable.id })
					.from(questpieCrdtSnapshotManifestTable)
					.where(
						and(
							eq(
								questpieCrdtSnapshotManifestTable.resourceId,
								input.resourceId,
							),
							eq(
								questpieCrdtSnapshotManifestTable.resourceEpochId,
								input.resourceEpochId,
							),
							notInArray(questpieCrdtSnapshotManifestTable.id, protectedIds),
						),
					)
					.orderBy(asc(questpieCrdtSnapshotManifestTable.createdAt))
					.limit(Math.min(remaining, 7))
					.for("update", { skipLocked: true });
				const manifestIds = oldManifests.map((manifest) => manifest.id);
				if (manifestIds.length > 0) {
					await tx
						.delete(questpieCrdtSnapshotTable)
						.where(inArray(questpieCrdtSnapshotTable.manifestId, manifestIds));
					const removed = await tx
						.delete(questpieCrdtSnapshotManifestTable)
						.where(inArray(questpieCrdtSnapshotManifestTable.id, manifestIds))
						.returning({ id: questpieCrdtSnapshotManifestTable.id });
					deleted += removed.length;
					remaining -= removed.length;
					return deleted;
				}
			}
		}

		if (remaining > 0 && epoch.previousManifestId) {
			const [previous] = await tx
				.select({
					cut: questpieCrdtSnapshotManifestTable.coversCommitSeq,
				})
				.from(questpieCrdtSnapshotManifestTable)
				.where(
					eq(questpieCrdtSnapshotManifestTable.id, epoch.previousManifestId),
				);
			if (previous) {
				const commits = await tx
					.select({ commitSeq: questpieCrdtCommitTable.commitSeq })
					.from(questpieCrdtCommitTable)
					.where(
						and(
							eq(questpieCrdtCommitTable.resourceId, input.resourceId),
							eq(
								questpieCrdtCommitTable.resourceEpochId,
								input.resourceEpochId,
							),
							eq(questpieCrdtCommitTable.kind, 1),
							lte(questpieCrdtCommitTable.commitSeq, previous.cut),
							sql`NOT EXISTS (
								SELECT 1 FROM questpie_crdt_update_receipt r
								WHERE r.resource_id = ${questpieCrdtCommitTable.resourceId}
								  AND r.resource_epoch_id = ${questpieCrdtCommitTable.resourceEpochId}
								  AND r.commit_seq = ${questpieCrdtCommitTable.commitSeq}
							)`,
							sql`NOT EXISTS (
								SELECT 1 FROM questpie_crdt_projection p
								WHERE p.resource_id = ${questpieCrdtCommitTable.resourceId}
								  AND p.resource_epoch_id = ${questpieCrdtCommitTable.resourceEpochId}
								  AND p.target_commit_seq = ${questpieCrdtCommitTable.commitSeq}
								  AND p.status <> 3
							)`,
						),
					)
					.orderBy(asc(questpieCrdtCommitTable.commitSeq))
					.limit(Math.min(remaining, 3))
					.for("update", { skipLocked: true });
				const sequences = commits.map((commit) => commit.commitSeq);
				if (sequences.length > 0) {
					const projections = await tx
						.select({ id: questpieCrdtProjectionTable.id })
						.from(questpieCrdtProjectionTable)
						.where(
							and(
								eq(questpieCrdtProjectionTable.resourceId, input.resourceId),
								eq(
									questpieCrdtProjectionTable.resourceEpochId,
									input.resourceEpochId,
								),
								inArray(questpieCrdtProjectionTable.targetCommitSeq, sequences),
								eq(questpieCrdtProjectionTable.status, 3),
							),
						);
					const projectionIds = projections.map((projection) => projection.id);
					if (projectionIds.length > 0) {
						await tx
							.delete(questpieCrdtProjectionFieldTable)
							.where(
								inArray(
									questpieCrdtProjectionFieldTable.projectionId,
									projectionIds,
								),
							);
						await tx
							.delete(questpieCrdtProjectionTable)
							.where(inArray(questpieCrdtProjectionTable.id, projectionIds));
					}
					await tx
						.delete(questpieCrdtUpdateTable)
						.where(
							and(
								eq(questpieCrdtUpdateTable.resourceId, input.resourceId),
								eq(
									questpieCrdtUpdateTable.resourceEpochId,
									input.resourceEpochId,
								),
								inArray(questpieCrdtUpdateTable.commitSeq, sequences),
							),
						);
					const removed = await tx
						.delete(questpieCrdtCommitTable)
						.where(
							and(
								eq(questpieCrdtCommitTable.resourceId, input.resourceId),
								eq(
									questpieCrdtCommitTable.resourceEpochId,
									input.resourceEpochId,
								),
								inArray(questpieCrdtCommitTable.commitSeq, sequences),
								eq(questpieCrdtCommitTable.kind, 1),
							),
						)
						.returning({ commitSeq: questpieCrdtCommitTable.commitSeq });
					deleted += removed.length;
					remaining -= removed.length;
					return deleted;
				}
			}
		}
		if (remaining > 0) {
			const removedRoots = await collectCrdtExpiredRecoveryRoots(tx, {
				limit: remaining,
			});
			deleted += removedRoots;
		}
		return deleted;
	});
}

export async function collectCrdtExpiredRecoveryRoots(
	db: CrdtDatabase,
	input: Readonly<{ limit: number }>,
): Promise<number> {
	let remaining = input.limit;
	let deleted = 0;
	const expiredHolds = await limitedDelete(
		db,
		sql`WITH doomed AS (
			SELECT ctid FROM questpie_crdt_recovery_hold
			WHERE expires_at <= clock_timestamp()
			ORDER BY expires_at, id
			LIMIT ${remaining} FOR UPDATE SKIP LOCKED
		)
		DELETE FROM questpie_crdt_recovery_hold
		WHERE ctid IN (SELECT ctid FROM doomed)
		RETURNING id`,
	);
	deleted += expiredHolds;
	remaining -= expiredHolds;
	if (remaining < 1) return deleted;
	const closedEpochs = await db
		.select({
			id: questpieCrdtResourceEpochTable.id,
			resourceId: questpieCrdtResourceEpochTable.resourceId,
		})
		.from(questpieCrdtResourceEpochTable)
		.innerJoin(
			questpieCrdtResourceTable,
			eq(
				questpieCrdtResourceTable.id,
				questpieCrdtResourceEpochTable.resourceId,
			),
		)
		.where(
			and(
				eq(questpieCrdtResourceEpochTable.status, 2),
				sql`${questpieCrdtResourceEpochTable.closedAt} <= clock_timestamp() - interval '30 days'`,
				sql`${questpieCrdtResourceTable.currentEpochId} IS DISTINCT FROM ${questpieCrdtResourceEpochTable.id}`,
				sql`NOT EXISTS (
					SELECT 1 FROM questpie_crdt_recovery_hold h
					WHERE h.resource_id = ${questpieCrdtResourceEpochTable.resourceId}
					  AND h.resource_epoch_id = ${questpieCrdtResourceEpochTable.id}
					  AND h.expires_at > clock_timestamp()
				)`,
			),
		)
		.orderBy(asc(questpieCrdtResourceEpochTable.closedAt))
		.limit(remaining)
		.for("update", { skipLocked: true });
	for (const epoch of closedEpochs) {
		const removed = await drainClosedEpoch(db, epoch, remaining);
		deleted += removed;
		remaining -= removed;
		if (remaining < 1) return deleted;
	}
	const removedBindings = await db.execute(sql`
		WITH candidates AS (
			SELECT b.id
			FROM questpie_crdt_binding b
			WHERE b.status = 2
			  AND b.retired_at <= clock_timestamp() - interval '30 days'
			  AND NOT EXISTS (
					SELECT 1 FROM questpie_crdt_recovery_hold h
					WHERE h.binding_id = b.id AND h.expires_at > clock_timestamp()
				)
			  AND NOT EXISTS (SELECT 1 FROM questpie_crdt_update u WHERE u.binding_id = b.id)
			  AND NOT EXISTS (SELECT 1 FROM questpie_crdt_snapshot s WHERE s.binding_id = b.id)
			  AND NOT EXISTS (SELECT 1 FROM questpie_crdt_receipt_field rf WHERE rf.binding_id = b.id)
			  AND NOT EXISTS (SELECT 1 FROM questpie_crdt_projection_field pf WHERE pf.binding_id = b.id)
			  AND NOT EXISTS (SELECT 1 FROM questpie_crdt_ticket_grant tg WHERE tg.binding_id = b.id)
			  AND NOT EXISTS (SELECT 1 FROM questpie_crdt_session_grant sg WHERE sg.binding_id = b.id)
			  AND NOT EXISTS (
					SELECT 1 FROM questpie_crdt_schema_compatibility_field cf
					WHERE cf.source_binding_id = b.id OR cf.target_binding_id = b.id
				)
			ORDER BY b.retired_at, b.id
			LIMIT ${remaining}
			FOR UPDATE SKIP LOCKED
		)
		DELETE FROM questpie_crdt_binding b
		USING candidates c
		WHERE b.id = c.id
		RETURNING b.id
	`);
	deleted += resultRowCount(removedBindings);
	return deleted;
}

async function drainClosedEpoch(
	db: CrdtDatabase,
	epoch: Readonly<{ id: string; resourceId: string }>,
	limit: number,
): Promise<number> {
	let remaining = limit;
	let deleted = 0;
	const stages = [
		() => sql`WITH doomed AS (
			SELECT a.ctid FROM questpie_crdt_awareness a
			JOIN questpie_crdt_session s ON s.id = a.session_id
			WHERE s.resource_id = ${epoch.resourceId}
			  AND s.resource_epoch_id = ${epoch.id}
			LIMIT ${remaining} FOR UPDATE OF a SKIP LOCKED
		) DELETE FROM questpie_crdt_awareness
		  WHERE ctid IN (SELECT ctid FROM doomed) RETURNING session_id`,
		() => sql`WITH doomed AS (
			SELECT sg.ctid FROM questpie_crdt_session_grant sg
			JOIN questpie_crdt_session s ON s.id = sg.session_id
			WHERE s.resource_id = ${epoch.resourceId}
			  AND s.resource_epoch_id = ${epoch.id}
			LIMIT ${remaining} FOR UPDATE OF sg SKIP LOCKED
		) DELETE FROM questpie_crdt_session_grant
		  WHERE ctid IN (SELECT ctid FROM doomed) RETURNING session_id`,
		() => sql`WITH doomed AS (
			SELECT tg.ctid FROM questpie_crdt_ticket_grant tg
			JOIN questpie_crdt_ticket t ON t.id = tg.ticket_id
			WHERE t.resource_id = ${epoch.resourceId}
			  AND t.resource_epoch_id = ${epoch.id}
			LIMIT ${remaining} FOR UPDATE OF tg SKIP LOCKED
		) DELETE FROM questpie_crdt_ticket_grant
		  WHERE ctid IN (SELECT ctid FROM doomed) RETURNING ticket_id`,
		() => sql`WITH doomed AS (
			SELECT rf.ctid FROM questpie_crdt_receipt_field rf
			JOIN questpie_crdt_update_receipt r ON r.id = rf.receipt_id
			WHERE r.resource_id = ${epoch.resourceId}
			  AND r.resource_epoch_id = ${epoch.id}
			LIMIT ${remaining} FOR UPDATE OF rf SKIP LOCKED
		) DELETE FROM questpie_crdt_receipt_field
		  WHERE ctid IN (SELECT ctid FROM doomed) RETURNING receipt_id`,
		() => sql`WITH doomed AS (
			SELECT ctid FROM questpie_crdt_update_receipt
			WHERE resource_id = ${epoch.resourceId}
			  AND resource_epoch_id = ${epoch.id}
			LIMIT ${remaining} FOR UPDATE SKIP LOCKED
		) DELETE FROM questpie_crdt_update_receipt
		  WHERE ctid IN (SELECT ctid FROM doomed) RETURNING id`,
		() => sql`WITH doomed AS (
			SELECT pf.ctid FROM questpie_crdt_projection_field pf
			JOIN questpie_crdt_projection p ON p.id = pf.projection_id
			WHERE p.resource_id = ${epoch.resourceId}
			  AND p.resource_epoch_id = ${epoch.id}
			LIMIT ${remaining} FOR UPDATE OF pf SKIP LOCKED
		) DELETE FROM questpie_crdt_projection_field
		  WHERE ctid IN (SELECT ctid FROM doomed) RETURNING projection_id`,
		() => sql`WITH doomed AS (
			SELECT ctid FROM questpie_crdt_projection
			WHERE resource_id = ${epoch.resourceId}
			  AND resource_epoch_id = ${epoch.id}
			LIMIT ${remaining} FOR UPDATE SKIP LOCKED
		) DELETE FROM questpie_crdt_projection
		  WHERE ctid IN (SELECT ctid FROM doomed) RETURNING id`,
		() => sql`WITH doomed AS (
			SELECT cf.ctid FROM questpie_crdt_schema_compatibility_field cf
			JOIN questpie_crdt_schema_compatibility c
			  ON c.id = cf.compatibility_id
			WHERE c.resource_id = ${epoch.resourceId}
			  AND c.resource_epoch_id = ${epoch.id}
			LIMIT ${remaining} FOR UPDATE OF cf SKIP LOCKED
		) DELETE FROM questpie_crdt_schema_compatibility_field
		  WHERE ctid IN (SELECT ctid FROM doomed) RETURNING compatibility_id`,
		() => sql`WITH doomed AS (
			SELECT ctid FROM questpie_crdt_schema_compatibility
			WHERE resource_id = ${epoch.resourceId}
			  AND resource_epoch_id = ${epoch.id}
			LIMIT ${remaining} FOR UPDATE SKIP LOCKED
		) DELETE FROM questpie_crdt_schema_compatibility
		  WHERE ctid IN (SELECT ctid FROM doomed) RETURNING id`,
	] as const;
	for (const stage of stages) {
		const removed = await limitedDelete(db, stage());
		deleted += removed;
		remaining -= removed;
		if (remaining < 1) return deleted;
	}
	await db.execute(sql`
		UPDATE questpie_crdt_resource_epoch
		SET current_snapshot_manifest_id = NULL,
			current_snapshot_status = NULL,
			previous_snapshot_manifest_id = NULL,
			previous_snapshot_status = NULL
		WHERE resource_id = ${epoch.resourceId} AND id = ${epoch.id}
	`);
	const directStages = [
		["questpie_crdt_snapshot", "manifest_id"],
		["questpie_crdt_snapshot_manifest", "id"],
		["questpie_crdt_update", "binding_id"],
		["questpie_crdt_commit", "delivery_commit_id"],
		["questpie_crdt_recovery_hold", "id"],
		["questpie_crdt_session", "id"],
		["questpie_crdt_ticket", "id"],
	] as const;
	for (const [table, returning] of directStages) {
		const removed = await limitedDelete(
			db,
			sql.raw(`WITH doomed AS (
				SELECT ctid FROM ${table}
				WHERE resource_id = '${epoch.resourceId}'::uuid
				  AND resource_epoch_id = '${epoch.id}'::uuid
				LIMIT ${remaining} FOR UPDATE SKIP LOCKED
			) DELETE FROM ${table}
			  WHERE ctid IN (SELECT ctid FROM doomed) RETURNING ${returning}`),
		);
		deleted += removed;
		remaining -= removed;
		if (remaining < 1) return deleted;
	}
	const removed = await db
		.delete(questpieCrdtResourceEpochTable)
		.where(
			and(
				eq(questpieCrdtResourceEpochTable.resourceId, epoch.resourceId),
				eq(questpieCrdtResourceEpochTable.id, epoch.id),
				eq(questpieCrdtResourceEpochTable.status, 2),
			),
		)
		.returning({ id: questpieCrdtResourceEpochTable.id });
	if (removed.length !== 1) {
		throw new Error("CRDT closed epoch GC lost its fenced root");
	}
	return deleted + 1;
}

async function limitedDelete(db: CrdtDatabase, query: SQL): Promise<number> {
	return resultRowCount(await db.execute(query));
}

function resultRowCount(result: unknown): number {
	if (
		result &&
		typeof result === "object" &&
		"rows" in result &&
		Array.isArray(result.rows)
	) {
		return result.rows.length;
	}
	if (Array.isArray(result)) return result.length;
	return 0;
}

async function captureCut(
	db: CrdtDatabase,
	options: Readonly<{
		ownerId: string;
		resolveEngine(binding: {
			format: number;
			formatVersion: number;
		}): AnyEngine;
		leaseMilliseconds: number;
	}>,
): Promise<CapturedCut | null> {
	return withTransaction(db, async (transaction) => {
		const tx = transaction as CrdtDatabase;
		const epochs = await tx
			.select()
			.from(questpieCrdtResourceEpochTable)
			.where(
				and(
					eq(questpieCrdtResourceEpochTable.status, 1),
					sql`(
						${questpieCrdtResourceEpochTable.headCommitSeq} -
						COALESCE((
							SELECT m.covers_commit_seq
							FROM questpie_crdt_snapshot_manifest m
							WHERE m.id = ${questpieCrdtResourceEpochTable.currentSnapshotManifestId}
						), 0)
					) >= ${COMPACTION_COMMIT_TRIGGER} OR COALESCE((
						SELECT SUM(u.size_bytes)
						FROM questpie_crdt_update u
						WHERE u.resource_id = ${questpieCrdtResourceEpochTable.resourceId}
						  AND u.resource_epoch_id = ${questpieCrdtResourceEpochTable.id}
						  AND u.commit_seq > COALESCE((
								SELECT m2.covers_commit_seq
								FROM questpie_crdt_snapshot_manifest m2
								WHERE m2.id = ${questpieCrdtResourceEpochTable.currentSnapshotManifestId}
							), 0)
					), 0) >= ${COMPACTION_BYTE_TRIGGER}`,
					sql`NOT EXISTS (
						SELECT 1
						FROM questpie_crdt_lease l
						WHERE l.resource_id = ${questpieCrdtResourceEpochTable.resourceId}
						  AND l.kind = ${COMPACTION_LEASE_KIND}
						  AND l.owner_id <> ${options.ownerId}
						  AND l.expires_at > clock_timestamp()
					)`,
				),
			)
			.orderBy(asc(questpieCrdtResourceEpochTable.updatedAt))
			.limit(1)
			.for("update", { skipLocked: true });
		for (const candidate of epochs) {
			let snapshotCut = 0n;
			if (candidate.currentSnapshotManifestId) {
				const [manifest] = await tx
					.select({
						cut: questpieCrdtSnapshotManifestTable.coversCommitSeq,
					})
					.from(questpieCrdtSnapshotManifestTable)
					.where(
						eq(
							questpieCrdtSnapshotManifestTable.id,
							candidate.currentSnapshotManifestId,
						),
					);
				if (!manifest) continue;
				snapshotCut = manifest.cut;
			}
			const [bytes] = await tx
				.select({
					total: sql<bigint>`COALESCE(SUM(${questpieCrdtUpdateTable.sizeBytes}), 0)::bigint`,
				})
				.from(questpieCrdtUpdateTable)
				.where(
					and(
						eq(questpieCrdtUpdateTable.resourceId, candidate.resourceId),
						eq(questpieCrdtUpdateTable.resourceEpochId, candidate.id),
						sql`${questpieCrdtUpdateTable.commitSeq} > ${snapshotCut}`,
					),
				);
			if (
				candidate.headCommitSeq - snapshotCut < COMPACTION_COMMIT_TRIGGER &&
				(bytes?.total ?? 0n) < COMPACTION_BYTE_TRIGGER
			) {
				continue;
			}
			await tx
				.insert(questpieCrdtLeaseTable)
				.values({
					resourceId: candidate.resourceId,
					kind: COMPACTION_LEASE_KIND,
					ownerId: options.ownerId,
					generation: 0n,
					expiresAt: new Date(0),
				})
				.onConflictDoNothing();
			const [lease] = await tx
				.select({
					ownerId: questpieCrdtLeaseTable.ownerId,
					generation: questpieCrdtLeaseTable.generation,
					available: sql<boolean>`${questpieCrdtLeaseTable.expiresAt} <= clock_timestamp() OR ${questpieCrdtLeaseTable.ownerId} = ${options.ownerId}`,
				})
				.from(questpieCrdtLeaseTable)
				.where(
					and(
						eq(questpieCrdtLeaseTable.resourceId, candidate.resourceId),
						eq(questpieCrdtLeaseTable.kind, COMPACTION_LEASE_KIND),
					),
				)
				.for("update");
			if (!lease?.available) {
				continue;
			}
			const generation = lease.generation + 1n;
			await tx
				.update(questpieCrdtLeaseTable)
				.set({
					ownerId: options.ownerId,
					generation,
					expiresAt: sql`clock_timestamp() + (${options.leaseMilliseconds} * interval '1 millisecond')`,
					updatedAt: sql`now()`,
				})
				.where(
					and(
						eq(questpieCrdtLeaseTable.resourceId, candidate.resourceId),
						eq(questpieCrdtLeaseTable.kind, COMPACTION_LEASE_KIND),
					),
				);
			const bindings = await tx
				.select()
				.from(questpieCrdtBindingTable)
				.where(
					and(
						eq(questpieCrdtBindingTable.resourceId, candidate.resourceId),
						inArray(questpieCrdtBindingTable.status, [1, 3]),
						isNull(questpieCrdtBindingTable.retiredAt),
					),
				)
				.orderBy(asc(questpieCrdtBindingTable.id));
			const engines = new Map<number, AnyEngine>();
			for (const binding of bindings) {
				const engine = options.resolveEngine(binding);
				if (
					engine.formatVersion !== binding.formatVersion ||
					(engine.format === "text" ? 1 : 2) !== binding.format
				) {
					throw new Error("CRDT compaction engine is incompatible");
				}
				engines.set(binding.fieldSlot, engine);
			}
			return Object.freeze({
				resourceId: candidate.resourceId,
				resourceEpochId: candidate.id,
				definitionId: candidate.definitionId,
				schemaId: candidate.schemaId,
				coversCommitSeq: candidate.headCommitSeq,
				currentManifestId: candidate.currentSnapshotManifestId,
				previousManifestId: candidate.previousSnapshotManifestId,
				leaseOwnerId: options.ownerId,
				leaseGeneration: generation,
				bindings: Object.freeze(bindings),
				engines,
			});
		}
		return null;
	});
}

async function materializeCut(
	db: CrdtDatabase,
	cut: CapturedCut,
): Promise<MaterializedSnapshot> {
	const replicas = await materializeCrdtAggregateAtCut(db, {
		resourceId: cut.resourceId,
		resourceEpochId: cut.resourceEpochId,
		schemaId: cut.schemaId,
		targetCommitSeq: cut.coversCommitSeq,
		currentManifestId: cut.currentManifestId,
		previousManifestId: cut.previousManifestId,
		bindings: cut.bindings,
		engines: cut.engines,
		targetFieldCursors: new Map(
			cut.bindings.map((binding) => [binding.id, binding.headFieldCursor]),
		),
	});
	if (!replicas) throw new Error("CRDT compaction recovery basis is corrupt");
	const rows = await Promise.all(
		cut.bindings.map(async (binding) => {
			const engine = cut.engines.get(binding.fieldSlot)!;
			const replica = replicas.get(binding.fieldSlot);
			if (!replica) throw new Error("CRDT compaction field is incomplete");
			const bytes = await engine.snapshot(
				replica as CrdtEngineReplica<CrdtEngineFormat, any>,
			);
			const checksum = createHash("sha256").update(bytes).digest();
			return Object.freeze({
				bindingId: binding.id,
				stableFieldId: binding.stableFieldId,
				fieldEpoch: binding.fieldEpoch,
				fieldSlot: binding.fieldSlot,
				formatVersion: binding.formatVersion,
				fieldCursor: binding.headFieldCursor,
				engineId: engine.engineId,
				engineVersion: engine.engineVersion,
				stateVersion: engine.stateVersion,
				sizeBytes: bytes.byteLength,
				checksum: new Uint8Array(checksum),
				bytes: new Uint8Array(bytes),
			});
		}),
	);
	const fields: readonly CrdtSnapshotCutField[] = rows;
	return Object.freeze({
		cut,
		manifestId: randomUUID(),
		manifestChecksum: createCrdtSnapshotManifestChecksum({
			resourceId: cut.resourceId,
			resourceEpochId: cut.resourceEpochId,
			schemaId: cut.schemaId,
			coversCommitSeq: cut.coversCommitSeq,
			fields,
		}),
		fields,
		rows,
	});
}

async function persistCandidate(
	db: CrdtDatabase,
	candidate: MaterializedSnapshot,
): Promise<void> {
	await withTransaction(db, async (transaction) => {
		const tx = transaction as CrdtDatabase;
		await tx.insert(questpieCrdtSnapshotManifestTable).values({
			id: candidate.manifestId,
			resourceId: candidate.cut.resourceId,
			resourceEpochId: candidate.cut.resourceEpochId,
			definitionId: candidate.cut.definitionId,
			schemaId: candidate.cut.schemaId,
			coversCommitSeq: candidate.cut.coversCommitSeq,
			status: 2,
			totalBytes: candidate.rows.reduce(
				(total, row) => total + row.sizeBytes,
				0,
			),
			fieldCount: candidate.rows.length,
			checksum: Buffer.from(candidate.manifestChecksum),
			leaseGeneration: candidate.cut.leaseGeneration,
			verifiedAt: new Date(),
		});
		await tx.insert(questpieCrdtSnapshotTable).values(
			candidate.rows.map((row) => ({
				manifestId: candidate.manifestId,
				resourceId: candidate.cut.resourceId,
				resourceEpochId: candidate.cut.resourceEpochId,
				schemaId: candidate.cut.schemaId,
				bindingId: row.bindingId,
				stableFieldId: row.stableFieldId,
				fieldEpoch: row.fieldEpoch,
				fieldSlot: row.fieldSlot,
				formatVersion: row.formatVersion,
				fieldCursor: row.fieldCursor,
				engineId: row.engineId,
				engineVersion: row.engineVersion,
				stateVersion: row.stateVersion,
				bytes: Buffer.from(row.bytes),
				sizeBytes: row.sizeBytes,
				checksum: Buffer.from(row.checksum),
			})),
		);
	});
}
