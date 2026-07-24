import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { AnyDrizzleClient } from "#questpie/server/config/types.js";

import {
	questpieCrdtBindingTable,
	questpieCrdtCommitTable,
	questpieCrdtReceiptFieldTable,
	questpieCrdtResourceAdmissionTable,
	questpieCrdtResourceEpochTable,
	questpieCrdtResourceTable,
	questpieCrdtSessionGrantTable,
	questpieCrdtSessionTable,
	questpieCrdtSubjectFenceTable,
	questpieCrdtUpdateReceiptTable,
	questpieCrdtUpdateTable,
} from "./schema.js";

type CrdtDatabase = AnyDrizzleClient<any>;
const UPDATE_BURST = 120n;
const UPDATE_RATE = 60n;
const UPDATE_BYTE_BURST = 2n * 1024n * 1024n;
const UPDATE_BYTE_RATE = 1024n * 1024n;
const PART_BURST = 2_000n;
const PART_RATE = 1_000n;

export type CrdtAppendInput = Readonly<{
	resourceId: string;
	resourceEpochId: string;
	definitionId: string;
	schemaId: string;
	sessionId: string;
	subjectId: string;
	updateId: string;
	submittedSchemaId: string;
	submittedSchemaVersion: bigint;
	submittedBundleHash: Uint8Array;
	canonicalBundleHash: Uint8Array;
	decisionExpiresAt: Date;
	authority: Readonly<{
		resourceReadFence: bigint;
		resourceEditFence: bigint;
		ownerPolicyRevision: bigint;
		subjectReadFence: bigint;
		subjectEditFence: bigint;
		sessionGeneration: bigint;
	}>;
	overlay: readonly CrdtAppendOverlayPart[];
	parts: readonly CrdtAppendPart[];
}>;

export type CrdtAppendOverlayPart = Readonly<{
	bindingId: string;
	stableFieldId: string;
	fieldEpoch: bigint;
	fieldCursor: bigint;
	readFence: bigint;
	editFence: bigint;
}>;

export type CrdtAppendPart = Readonly<{
	bindingId: string;
	stableFieldId: string;
	fieldEpoch: bigint;
	fieldSlot: number;
	formatVersion: number;
	baseFieldCursor: bigint;
	bytes: Uint8Array;
	checksum: Uint8Array;
	nextCanonicalHash: Uint8Array;
	nextStateBytes: bigint;
	nextElementCount: bigint;
}>;

export type CrdtAppendReceipt = Readonly<{
	updateId: string;
	commitSeq: bigint;
	fieldCursors: readonly Readonly<{
		fieldSlot: number;
		fieldCursor: bigint;
	}>[];
}>;

export type CrdtReceiptQuery = Readonly<{
	resourceId: string;
	resourceEpochId: string;
	sessionId: string;
	subjectId: string;
	authority: CrdtAppendInput["authority"];
	entries: readonly Readonly<{
		updateId: string;
		submittedBundleHash: Uint8Array;
		submittedSchemaVersion: bigint;
	}>[];
}>;

export class CrdtAppendRejectedError extends Error {
	readonly code = "CRDT_APPEND_REJECTED";

	constructor(message = "CRDT append rejected") {
		super(message);
		this.name = "CrdtAppendRejectedError";
	}
}

export function createCrdtAppendStore(
	db: CrdtDatabase,
	options: Readonly<{
		/**
		 * Locks the host collection/global row with `FOR UPDATE`. This is always
		 * invoked before any CRDT row is locked; it must not run application hooks.
		 */
		lockOwnerRow: (
			transaction: CrdtDatabase,
			owner: {
				resourceId: string;
				definitionId: string;
			},
		) => Promise<void>;
		publishNotice?: (notice: {
			kind: "crdt";
			resourceId: string;
			resourceEpochId: string;
			commitSeq: bigint;
		}) => Promise<void>;
	}>,
) {
	return Object.freeze({
		async append(input: CrdtAppendInput): Promise<CrdtAppendReceipt> {
			const candidate = snapshotInput(input);
			const result = await db.transaction((tx) =>
				appendTransaction(tx as CrdtDatabase, candidate, options.lockOwnerRow),
			);
			if (result.committed) {
				try {
					await options.publishNotice?.({
						kind: "crdt",
						resourceId: candidate.resourceId,
						resourceEpochId: candidate.resourceEpochId,
						commitSeq: result.receipt.commitSeq,
					});
				} catch {
					// Durable polling/reconnect drains make notices latency hints only.
				}
			}
			return result.receipt;
		},
		async reconcileReceipts(
			input: CrdtReceiptQuery,
		): Promise<readonly CrdtAppendReceipt[]> {
			const query = snapshotReceiptQuery(input);
			if (query.entries.length === 0) return [];
			return db.transaction((tx) =>
				reconcileReceiptsTransaction(
					tx as CrdtDatabase,
					query,
					options.lockOwnerRow,
				),
			);
		},
	});
}

async function appendTransaction(
	db: CrdtDatabase,
	input: CrdtAppendInput,
	lockOwnerRow: (
		transaction: CrdtDatabase,
		owner: { resourceId: string; definitionId: string },
	) => Promise<void>,
): Promise<{ receipt: CrdtAppendReceipt; committed: boolean }> {
	await lockOwnerRow(db, {
		resourceId: input.resourceId,
		definitionId: input.definitionId,
	});
	const [resource] = await db
		.select()
		.from(questpieCrdtResourceTable)
		.where(eq(questpieCrdtResourceTable.id, input.resourceId))
		.for("update");
	const [epoch] = await db
		.select()
		.from(questpieCrdtResourceEpochTable)
		.where(
			and(
				eq(questpieCrdtResourceEpochTable.resourceId, input.resourceId),
				eq(questpieCrdtResourceEpochTable.id, input.resourceEpochId),
			),
		)
		.for("update");
	if (
		!resource ||
		!epoch ||
		resource.status !== 1 ||
		resource.currentEpochId !== input.resourceEpochId ||
		epoch.status !== 1 ||
		epoch.schemaId !== input.schemaId ||
		resource.definitionId !== input.definitionId
	) {
		throw rejected();
	}
	const existing = await findReceipt(db, input);
	if (existing) return { receipt: existing, committed: false };

	const bindingIds = input.overlay.map((part) => part.bindingId).sort();
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
		.orderBy(asc(questpieCrdtBindingTable.id))
		.for("update");
	if (
		bindings.length !== input.overlay.length ||
		bindings.some((binding, index) => binding.id !== bindingIds[index])
	) {
		throw rejected();
	}

	const [session] = await db
		.select()
		.from(questpieCrdtSessionTable)
		.where(
			and(
				eq(questpieCrdtSessionTable.id, input.sessionId),
				eq(questpieCrdtSessionTable.resourceId, input.resourceId),
				eq(questpieCrdtSessionTable.resourceEpochId, input.resourceEpochId),
				eq(questpieCrdtSessionTable.subjectId, input.subjectId),
				isNull(questpieCrdtSessionTable.closedAt),
			),
		)
		.for("update");
	if (
		!session ||
		session.schemaId !== input.schemaId ||
		session.effectiveMode !== 2 ||
		session.generation !== input.authority.sessionGeneration ||
		session.resourceReadFence !== input.authority.resourceReadFence ||
		session.resourceEditFence !== input.authority.resourceEditFence ||
		session.ownerPolicyRevision !== input.authority.ownerPolicyRevision ||
		session.subjectReadFence !== input.authority.subjectReadFence ||
		session.subjectEditFence !== input.authority.subjectEditFence ||
		resource.sessionGeneration !== input.authority.sessionGeneration ||
		resource.readFence !== input.authority.resourceReadFence ||
		resource.editFence !== input.authority.resourceEditFence ||
		resource.ownerPolicyRevision !== input.authority.ownerPolicyRevision
	) {
		throw rejected();
	}
	const clockResult = await db.execute(sql`
		SELECT clock_timestamp() < LEAST(
			${input.decisionExpiresAt}::timestamptz,
			${session.authorityExpiresAt}::timestamptz,
			${session.leaseExpiresAt}::timestamptz
		) AS current
	`);
	const [clock] = resultRows<{ current: boolean }>(clockResult);
	if (!clock?.current) throw rejected();

	const overlays = new Map(input.overlay.map((part) => [part.bindingId, part]));
	for (const binding of bindings) {
		const overlay = overlays.get(binding.id);
		if (
			!overlay ||
			binding.status !== 1 ||
			binding.retiredAt !== null ||
			binding.stableFieldId !== overlay.stableFieldId ||
			binding.fieldEpoch !== overlay.fieldEpoch ||
			binding.headFieldCursor !== overlay.fieldCursor ||
			binding.readFence !== overlay.readFence ||
			binding.editFence !== overlay.editFence
		) {
			throw rejected();
		}
	}
	const grants = await db
		.select()
		.from(questpieCrdtSessionGrantTable)
		.where(
			and(
				eq(questpieCrdtSessionGrantTable.sessionId, input.sessionId),
				inArray(
					questpieCrdtSessionGrantTable.bindingId,
					input.parts.map((part) => part.bindingId),
				),
			),
		);
	const grantsByBinding = new Map(
		grants.map((grant) => [grant.bindingId, grant]),
	);
	for (const part of input.parts) {
		const binding = bindings.find(
			(candidate) => candidate.id === part.bindingId,
		);
		const grant = grantsByBinding.get(part.bindingId);
		if (
			!binding ||
			!grant ||
			grant.grant !== 1 ||
			grant.headFieldCursor !== part.baseFieldCursor ||
			grant.fieldReadFence !== binding.readFence ||
			grant.fieldEditFence !== binding.editFence ||
			binding.fieldEpoch !== part.fieldEpoch ||
			binding.fieldSlot !== part.fieldSlot ||
			binding.formatVersion !== part.formatVersion ||
			binding.headFieldCursor !== part.baseFieldCursor
		) {
			throw rejected();
		}
	}
	const subjectFences = await db
		.select()
		.from(questpieCrdtSubjectFenceTable)
		.where(
			and(
				eq(questpieCrdtSubjectFenceTable.resourceId, input.resourceId),
				eq(questpieCrdtSubjectFenceTable.subjectId, input.subjectId),
			),
		)
		.for("update");
	const resourceSubjectFence = subjectFences.find(
		(fence) => fence.scopeKind === 1,
	);
	if (
		(resourceSubjectFence?.readFence ?? 0n) !==
			input.authority.subjectReadFence ||
		(resourceSubjectFence?.editFence ?? 0n) !== input.authority.subjectEditFence
	) {
		throw rejected();
	}
	for (const part of input.parts) {
		const grant = grantsByBinding.get(part.bindingId)!;
		const fieldFence = subjectFences.find(
			(fence) =>
				fence.scopeKind === 2 && fence.stableFieldId === part.stableFieldId,
		);
		if (
			(fieldFence?.readFence ?? 0n) !== grant.subjectFieldReadFence ||
			(fieldFence?.editFence ?? 0n) !== grant.subjectFieldEditFence
		) {
			throw rejected();
		}
	}
	await consumeAppendBudgets(
		db,
		input.sessionId,
		input.resourceId,
		input.parts.length,
		input.parts.reduce((size, part) => size + part.bytes.byteLength, 0),
	);

	const commitSeq = epoch.headCommitSeq + 1n;
	await db.insert(questpieCrdtCommitTable).values({
		resourceId: input.resourceId,
		resourceEpochId: input.resourceEpochId,
		definitionId: input.definitionId,
		commitSeq,
		kind: 1,
		schemaId: input.schemaId,
		canonicalBundleHash: Buffer.from(input.canonicalBundleHash),
		deliveryCommitId: randomUUID(),
		subjectId: input.subjectId,
		sessionId: input.sessionId,
	});
	for (const part of input.parts) {
		const fieldCursor = part.baseFieldCursor + 1n;
		await db.insert(questpieCrdtUpdateTable).values({
			resourceId: input.resourceId,
			resourceEpochId: input.resourceEpochId,
			commitSeq,
			commitKind: 1,
			schemaId: input.schemaId,
			fieldSlot: part.fieldSlot,
			bindingId: part.bindingId,
			stableFieldId: part.stableFieldId,
			fieldEpoch: part.fieldEpoch,
			formatVersion: part.formatVersion,
			baseFieldCursor: part.baseFieldCursor,
			fieldCursor,
			bytes: Buffer.from(part.bytes),
			sizeBytes: part.bytes.byteLength,
			checksum: Buffer.from(part.checksum),
		});
		await db
			.update(questpieCrdtBindingTable)
			.set({
				headFieldCursor: fieldCursor,
				canonicalHash: Buffer.from(part.nextCanonicalHash),
				canonicalRevision: sql`${questpieCrdtBindingTable.canonicalRevision} + 1`,
				stateBytes: part.nextStateBytes,
				elementCount: part.nextElementCount,
			})
			.where(eq(questpieCrdtBindingTable.id, part.bindingId));
	}
	await db
		.update(questpieCrdtResourceEpochTable)
		.set({ headCommitSeq: commitSeq })
		.where(eq(questpieCrdtResourceEpochTable.id, input.resourceEpochId));
	const [receipt] = await db
		.insert(questpieCrdtUpdateReceiptTable)
		.values({
			resourceId: input.resourceId,
			resourceEpochId: input.resourceEpochId,
			definitionId: input.definitionId,
			updateId: input.updateId,
			commitSeq,
			commitKind: 1,
			submittedSchemaId: input.submittedSchemaId,
			submittedSchemaVersion: input.submittedSchemaVersion,
			submittedBundleHash: Buffer.from(input.submittedBundleHash),
			normalizedSchemaId: input.schemaId,
			normalizedCommitHash: Buffer.from(input.canonicalBundleHash),
			subjectId: input.subjectId,
			expiresAt: sql`clock_timestamp() + interval '30 days'`,
		})
		.returning({ id: questpieCrdtUpdateReceiptTable.id });
	if (!receipt) throw rejected();
	await db.insert(questpieCrdtReceiptFieldTable).values(
		input.parts.map((part) => ({
			receiptId: receipt.id,
			resourceId: input.resourceId,
			schemaId: input.schemaId,
			bindingId: part.bindingId,
			stableFieldId: part.stableFieldId,
			fieldEpoch: part.fieldEpoch,
			fieldSlot: part.fieldSlot,
			formatVersion: part.formatVersion,
			fieldCursor: part.baseFieldCursor + 1n,
		})),
	);
	return {
		committed: true,
		receipt: Object.freeze({
			updateId: input.updateId,
			commitSeq,
			fieldCursors: Object.freeze(
				input.parts.map((part) =>
					Object.freeze({
						fieldSlot: part.fieldSlot,
						fieldCursor: part.baseFieldCursor + 1n,
					}),
				),
			),
		}),
	};
}

async function findReceipt(
	db: CrdtDatabase,
	input: CrdtAppendInput,
): Promise<CrdtAppendReceipt | null> {
	const [receipt] = await db
		.select()
		.from(questpieCrdtUpdateReceiptTable)
		.where(
			and(
				eq(questpieCrdtUpdateReceiptTable.resourceId, input.resourceId),
				eq(
					questpieCrdtUpdateReceiptTable.resourceEpochId,
					input.resourceEpochId,
				),
				eq(questpieCrdtUpdateReceiptTable.updateId, input.updateId),
			),
		);
	if (!receipt) return null;
	if (
		receipt.subjectId !== input.subjectId ||
		receipt.submittedSchemaId !== input.submittedSchemaId ||
		receipt.submittedSchemaVersion !== input.submittedSchemaVersion ||
		!equalBytes(receipt.submittedBundleHash, input.submittedBundleHash)
	) {
		throw new CrdtAppendRejectedError("CRDT update id was reused");
	}
	const fields = await db
		.select()
		.from(questpieCrdtReceiptFieldTable)
		.where(eq(questpieCrdtReceiptFieldTable.receiptId, receipt.id))
		.orderBy(asc(questpieCrdtReceiptFieldTable.fieldSlot));
	return Object.freeze({
		updateId: receipt.updateId,
		commitSeq: receipt.commitSeq,
		fieldCursors: Object.freeze(
			fields.map((field) =>
				Object.freeze({
					fieldSlot: field.fieldSlot,
					fieldCursor: field.fieldCursor,
				}),
			),
		),
	});
}

async function reconcileReceiptsTransaction(
	db: CrdtDatabase,
	input: CrdtReceiptQuery,
	lockOwnerRow: (
		transaction: CrdtDatabase,
		owner: { resourceId: string; definitionId: string },
	) => Promise<void>,
): Promise<readonly CrdtAppendReceipt[]> {
	const [resourceIdentity] = await db
		.select({ definitionId: questpieCrdtResourceTable.definitionId })
		.from(questpieCrdtResourceTable)
		.where(eq(questpieCrdtResourceTable.id, input.resourceId));
	if (!resourceIdentity) return [];
	await lockOwnerRow(db, {
		resourceId: input.resourceId,
		definitionId: resourceIdentity.definitionId,
	});
	const [resource] = await db
		.select()
		.from(questpieCrdtResourceTable)
		.where(eq(questpieCrdtResourceTable.id, input.resourceId))
		.for("update");
	const [epoch] = await db
		.select()
		.from(questpieCrdtResourceEpochTable)
		.where(
			and(
				eq(questpieCrdtResourceEpochTable.id, input.resourceEpochId),
				eq(questpieCrdtResourceEpochTable.resourceId, input.resourceId),
			),
		)
		.for("update");
	if (
		!resource ||
		!epoch ||
		resource.status !== 1 ||
		resource.currentEpochId !== input.resourceEpochId ||
		epoch.status !== 1
	) {
		return [];
	}

	const receipts = await db
		.select()
		.from(questpieCrdtUpdateReceiptTable)
		.where(
			and(
				eq(questpieCrdtUpdateReceiptTable.resourceId, input.resourceId),
				eq(
					questpieCrdtUpdateReceiptTable.resourceEpochId,
					input.resourceEpochId,
				),
				inArray(
					questpieCrdtUpdateReceiptTable.updateId,
					input.entries.map((entry) => entry.updateId),
				),
				sql`${questpieCrdtUpdateReceiptTable.expiresAt} > clock_timestamp()`,
			),
		);
	const candidateReceipts = receipts.filter((receipt) => {
		const entry = input.entries.find(
			(candidate) => candidate.updateId === receipt.updateId,
		);
		return (
			entry !== undefined &&
			receipt.subjectId === input.subjectId &&
			receipt.submittedSchemaVersion === entry.submittedSchemaVersion &&
			equalBytes(receipt.submittedBundleHash, entry.submittedBundleHash)
		);
	});
	if (candidateReceipts.length === 0) return [];
	const receiptFields = await db
		.select()
		.from(questpieCrdtReceiptFieldTable)
		.where(
			inArray(
				questpieCrdtReceiptFieldTable.receiptId,
				candidateReceipts.map((receipt) => receipt.id),
			),
		)
		.orderBy(
			asc(questpieCrdtReceiptFieldTable.receiptId),
			asc(questpieCrdtReceiptFieldTable.fieldSlot),
		);
	const bindingIds = [
		...new Set(receiptFields.map((field) => field.bindingId)),
	].sort();
	const bindings = await db
		.select()
		.from(questpieCrdtBindingTable)
		.where(inArray(questpieCrdtBindingTable.id, bindingIds))
		.orderBy(asc(questpieCrdtBindingTable.id))
		.for("update");
	const [session] = await db
		.select()
		.from(questpieCrdtSessionTable)
		.where(
			and(
				eq(questpieCrdtSessionTable.id, input.sessionId),
				eq(questpieCrdtSessionTable.resourceId, input.resourceId),
				eq(questpieCrdtSessionTable.resourceEpochId, input.resourceEpochId),
				eq(questpieCrdtSessionTable.subjectId, input.subjectId),
				isNull(questpieCrdtSessionTable.closedAt),
			),
		)
		.for("update");
	if (
		!session ||
		session.generation !== input.authority.sessionGeneration ||
		session.resourceReadFence !== input.authority.resourceReadFence ||
		session.ownerPolicyRevision !== input.authority.ownerPolicyRevision ||
		session.subjectReadFence !== input.authority.subjectReadFence ||
		resource.sessionGeneration !== input.authority.sessionGeneration ||
		resource.readFence !== input.authority.resourceReadFence ||
		resource.ownerPolicyRevision !== input.authority.ownerPolicyRevision
	) {
		return [];
	}
	const [clock] = resultRows<{ current: boolean }>(
		await db.execute(sql`
			SELECT clock_timestamp() < LEAST(
				${session.authorityExpiresAt}::timestamptz,
				${session.leaseExpiresAt}::timestamptz
			) AS current
		`),
	);
	if (!clock?.current) return [];
	const grants = await db
		.select()
		.from(questpieCrdtSessionGrantTable)
		.where(
			and(
				eq(questpieCrdtSessionGrantTable.sessionId, input.sessionId),
				inArray(questpieCrdtSessionGrantTable.bindingId, bindingIds),
			),
		);
	const grantsByBinding = new Map(
		grants.map((grant) => [grant.bindingId, grant]),
	);
	const bindingsById = new Map(
		bindings.map((binding) => [binding.id, binding]),
	);
	const subjectFences = await db
		.select()
		.from(questpieCrdtSubjectFenceTable)
		.where(
			and(
				eq(questpieCrdtSubjectFenceTable.resourceId, input.resourceId),
				eq(questpieCrdtSubjectFenceTable.subjectId, input.subjectId),
			),
		)
		.for("update");
	const resourceSubjectFence = subjectFences.find(
		(fence) => fence.scopeKind === 1,
	);
	if (
		(resourceSubjectFence?.readFence ?? 0n) !== input.authority.subjectReadFence
	) {
		return [];
	}

	return Object.freeze(
		candidateReceipts.flatMap((receipt) => {
			const fields = receiptFields.filter(
				(field) => field.receiptId === receipt.id,
			);
			const readable = fields.every((field) => {
				const binding = bindingsById.get(field.bindingId);
				const grant = grantsByBinding.get(field.bindingId);
				const subjectFence = subjectFences.find(
					(fence) =>
						fence.scopeKind === 2 &&
						fence.stableFieldId === field.stableFieldId,
				);
				return (
					binding?.status === 1 &&
					binding.retiredAt === null &&
					binding.stableFieldId === field.stableFieldId &&
					binding.readFence === grant?.fieldReadFence &&
					grant?.fieldEpoch === field.fieldEpoch &&
					(subjectFence?.readFence ?? 0n) === grant?.subjectFieldReadFence
				);
			});
			return readable
				? [
						Object.freeze({
							updateId: receipt.updateId,
							commitSeq: receipt.commitSeq,
							fieldCursors: Object.freeze(
								fields.map((field) =>
									Object.freeze({
										fieldSlot: field.fieldSlot,
										fieldCursor: field.fieldCursor,
									}),
								),
							),
						}),
					]
				: [];
		}),
	);
}

async function consumeAppendBudgets(
	db: CrdtDatabase,
	sessionId: string,
	resourceId: string,
	partCount: number,
	byteCount: number,
): Promise<void> {
	const availableUpdates = sql<bigint>`LEAST(${UPDATE_BURST}, ${questpieCrdtSessionTable.updateTokens} + FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - ${questpieCrdtSessionTable.updateRefilledAt})) * ${UPDATE_RATE})::bigint)`;
	const availableBytes = sql<bigint>`LEAST(${UPDATE_BYTE_BURST}, ${questpieCrdtSessionTable.updateByteTokens} + FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - ${questpieCrdtSessionTable.updateBytesRefilledAt})) * ${UPDATE_BYTE_RATE})::bigint)`;
	const [sessionBudget] = await db
		.update(questpieCrdtSessionTable)
		.set({
			updateTokens: sql`${availableUpdates} - 1`,
			updateRefilledAt: sql`${questpieCrdtSessionTable.updateRefilledAt} + (FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - ${questpieCrdtSessionTable.updateRefilledAt})) * ${UPDATE_RATE}) / ${UPDATE_RATE}) * interval '1 second'`,
			updateByteTokens: sql`${availableBytes} - ${byteCount}`,
			updateBytesRefilledAt: sql`${questpieCrdtSessionTable.updateBytesRefilledAt} + (FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - ${questpieCrdtSessionTable.updateBytesRefilledAt})) * ${UPDATE_BYTE_RATE}) / ${UPDATE_BYTE_RATE}) * interval '1 second'`,
		})
		.where(
			and(
				eq(questpieCrdtSessionTable.id, sessionId),
				sql`${availableUpdates} >= 1`,
				sql`${availableBytes} >= ${byteCount}`,
			),
		)
		.returning({ id: questpieCrdtSessionTable.id });
	if (!sessionBudget) throw rejected();

	const availableParts = sql<bigint>`LEAST(${PART_BURST}, ${questpieCrdtResourceAdmissionTable.partTokens} + FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - ${questpieCrdtResourceAdmissionTable.partRefilledAt})) * ${PART_RATE})::bigint)`;
	const [resourceBudget] = await db
		.update(questpieCrdtResourceAdmissionTable)
		.set({
			partTokens: sql`${availableParts} - ${partCount}`,
			partRefilledAt: sql`${questpieCrdtResourceAdmissionTable.partRefilledAt} + (FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - ${questpieCrdtResourceAdmissionTable.partRefilledAt})) * ${PART_RATE}) / ${PART_RATE}) * interval '1 second'`,
			updatedAt: sql`clock_timestamp()`,
		})
		.where(
			and(
				eq(questpieCrdtResourceAdmissionTable.resourceId, resourceId),
				sql`${availableParts} >= ${partCount}`,
			),
		)
		.returning({ resourceId: questpieCrdtResourceAdmissionTable.resourceId });
	if (!resourceBudget) throw rejected();
}

function snapshotInput(input: CrdtAppendInput): CrdtAppendInput {
	const partBindingIds = input.parts.map((part) => part.bindingId);
	const overlayBindingIds = input.overlay.map((part) => part.bindingId);
	if (
		input.parts.length === 0 ||
		input.parts.length > 32 ||
		input.overlay.length === 0 ||
		!strictlyIncreasing(input.parts.map((part) => part.fieldSlot)) ||
		new Set(partBindingIds).size !== partBindingIds.length ||
		new Set(overlayBindingIds).size !== overlayBindingIds.length ||
		partBindingIds.some((id) => !overlayBindingIds.includes(id)) ||
		input.parts.some((part) => part.bytes.byteLength > 256 * 1024) ||
		input.parts.reduce((size, part) => size + part.bytes.byteLength, 0) >
			1024 * 1024 ||
		input.parts.some(
			(part) =>
				part.baseFieldCursor < 0n ||
				part.fieldEpoch < 0n ||
				part.nextStateBytes < 0n ||
				part.nextElementCount < 0n,
		)
	) {
		throw rejected();
	}
	return Object.freeze({
		...input,
		decisionExpiresAt: new Date(input.decisionExpiresAt),
		authority: Object.freeze({ ...input.authority }),
		submittedBundleHash: checkedHash(input.submittedBundleHash),
		canonicalBundleHash: checkedHash(input.canonicalBundleHash),
		overlay: Object.freeze(
			input.overlay.map((part) => Object.freeze({ ...part })),
		),
		parts: Object.freeze(
			input.parts.map((part) =>
				Object.freeze({
					...part,
					bytes: new Uint8Array(part.bytes),
					checksum: checkedHash(part.checksum),
					nextCanonicalHash: checkedHash(part.nextCanonicalHash),
				}),
			),
		),
	});
}

function snapshotReceiptQuery(input: CrdtReceiptQuery): CrdtReceiptQuery {
	if (
		input.entries.length > 64 ||
		new Set(input.entries.map((entry) => entry.updateId)).size !==
			input.entries.length
	) {
		throw rejected();
	}
	return Object.freeze({
		...input,
		authority: Object.freeze({ ...input.authority }),
		entries: Object.freeze(
			input.entries.map((entry) =>
				Object.freeze({
					...entry,
					submittedBundleHash: checkedHash(entry.submittedBundleHash),
				}),
			),
		),
	});
}

function checkedHash(value: Uint8Array): Uint8Array {
	if (!(value instanceof Uint8Array) || value.byteLength !== 32)
		throw rejected();
	return new Uint8Array(value);
}

function strictlyIncreasing(values: readonly number[]): boolean {
	return values.every(
		(value, index) =>
			Number.isSafeInteger(value) &&
			value > 0 &&
			value <= 0xffff &&
			(index === 0 || value > values[index - 1]!),
	);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	return Buffer.from(left).equals(Buffer.from(right));
}

function resultRows<TRow>(result: unknown): readonly TRow[] {
	if (Array.isArray(result)) return result as TRow[];
	if (
		typeof result === "object" &&
		result !== null &&
		"rows" in result &&
		Array.isArray(result.rows)
	) {
		return result.rows as TRow[];
	}
	return [];
}

function rejected(): CrdtAppendRejectedError {
	return new CrdtAppendRejectedError();
}
