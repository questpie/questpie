import { Buffer } from "node:buffer";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { AnyDrizzleClient } from "#questpie/server/config/types.js";

import {
	CrdtAuthorizationRejectedError,
	type CrdtAuthorizationSnapshot,
	type CrdtAuthorizedBindingCut,
} from "./authorization.js";
import {
	questpieCrdtBindingTable,
	questpieCrdtCredentialAdmissionTable,
	questpieCrdtResourceAdmissionTable,
	questpieCrdtResourceEpochTable,
	questpieCrdtResourceTable,
	questpieCrdtSubjectAdmissionTable,
	questpieCrdtSubjectFenceTable,
} from "./schema.js";

type CrdtDatabase = AnyDrizzleClient<any>;

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const SUBJECT_OPEN_BURST = 30n;
const CREDENTIAL_OPEN_BURST = 10n;

export const CRDT_SUBJECT_PULL_BYTE_BURST = 130n * 1024n * 1024n;

export async function lockCrdtAuthorizationCut(
	db: CrdtDatabase,
	authorization: CrdtAuthorizationSnapshot,
): Promise<void> {
	await lockCrdtAuthorizationState(db, authorization, true);
}

/**
 * Locks the durable authority and schema/fence identity without requiring the
 * mutable aggregate and field heads to remain at an earlier frozen cut.
 */
export async function lockCrdtAuthorizationFences(
	db: CrdtDatabase,
	authorization: CrdtAuthorizationSnapshot,
): Promise<void> {
	await lockCrdtAuthorizationState(db, authorization, false);
}

export async function lockCrdtAdmissionHeads(
	db: CrdtDatabase,
	authorization: CrdtAuthorizationSnapshot,
): Promise<void> {
	await db
		.insert(questpieCrdtSubjectAdmissionTable)
		.values({
			subjectId: authorization.subjectId,
			openTokens: SUBJECT_OPEN_BURST,
			pullByteTokens: CRDT_SUBJECT_PULL_BYTE_BURST,
		})
		.onConflictDoNothing();
	await db
		.insert(questpieCrdtCredentialAdmissionTable)
		.values({
			credentialFingerprint: Buffer.from(authorization.credentialFingerprint),
			openTokens: CREDENTIAL_OPEN_BURST,
		})
		.onConflictDoNothing();
	await db
		.insert(questpieCrdtResourceAdmissionTable)
		.values({ resourceId: authorization.resourceId, partTokens: 2_000n })
		.onConflictDoNothing();
	await db
		.select()
		.from(questpieCrdtSubjectAdmissionTable)
		.where(
			eq(questpieCrdtSubjectAdmissionTable.subjectId, authorization.subjectId),
		)
		.for("update");
	await db
		.select()
		.from(questpieCrdtCredentialAdmissionTable)
		.where(
			eq(
				questpieCrdtCredentialAdmissionTable.credentialFingerprint,
				Buffer.from(authorization.credentialFingerprint),
			),
		)
		.for("update");
	await db
		.select()
		.from(questpieCrdtResourceAdmissionTable)
		.where(
			eq(
				questpieCrdtResourceAdmissionTable.resourceId,
				authorization.resourceId,
			),
		)
		.for("update");
}

/**
 * Consumes rate-limit capacity only for a newly-created logical open. The
 * caller must perform the idempotent openId lookup first in the same
 * transaction.
 */
export async function consumeCrdtOpenAdmission(
	db: CrdtDatabase,
	authorization: CrdtAuthorizationSnapshot,
): Promise<void> {
	await consumeOpenToken(
		db,
		questpieCrdtSubjectAdmissionTable,
		eq(questpieCrdtSubjectAdmissionTable.subjectId, authorization.subjectId),
		SUBJECT_OPEN_BURST,
		2,
	);
	await consumeOpenToken(
		db,
		questpieCrdtCredentialAdmissionTable,
		eq(
			questpieCrdtCredentialAdmissionTable.credentialFingerprint,
			Buffer.from(authorization.credentialFingerprint),
		),
		CREDENTIAL_OPEN_BURST,
		6,
	);
}

async function lockCrdtAuthorizationState(
	db: CrdtDatabase,
	authorization: CrdtAuthorizationSnapshot,
	requireExactHeads: boolean,
): Promise<void> {
	const [resource] = await db
		.select({
			definitionId: questpieCrdtResourceTable.definitionId,
			incarnationKey: questpieCrdtResourceTable.incarnationKey,
			currentEpochId: questpieCrdtResourceTable.currentEpochId,
			readFence: questpieCrdtResourceTable.readFence,
			editFence: questpieCrdtResourceTable.editFence,
			ownerPolicyRevision: questpieCrdtResourceTable.ownerPolicyRevision,
			sessionGeneration: questpieCrdtResourceTable.sessionGeneration,
		})
		.from(questpieCrdtResourceTable)
		.where(
			and(
				eq(questpieCrdtResourceTable.id, authorization.resourceId),
				eq(questpieCrdtResourceTable.status, 1),
				isNull(questpieCrdtResourceTable.retiredAt),
			),
		)
		.for("update");
	if (
		!resource ||
		resource.definitionId !== authorization.definitionId ||
		resource.incarnationKey !== authorization.incarnationKey ||
		resource.currentEpochId !== authorization.resourceEpochId ||
		resource.readFence !== authorization.resourceReadFence ||
		resource.editFence !== authorization.resourceEditFence ||
		resource.ownerPolicyRevision !== authorization.ownerPolicyRevision ||
		resource.sessionGeneration !== authorization.sessionGeneration
	) {
		throw rejected();
	}

	const [epoch] = await db
		.select({ headCommitSeq: questpieCrdtResourceEpochTable.headCommitSeq })
		.from(questpieCrdtResourceEpochTable)
		.where(
			and(
				eq(questpieCrdtResourceEpochTable.id, authorization.resourceEpochId),
				eq(questpieCrdtResourceEpochTable.resourceId, authorization.resourceId),
				eq(questpieCrdtResourceEpochTable.schemaId, authorization.schemaId),
				eq(questpieCrdtResourceEpochTable.status, 1),
			),
		)
		.for("update");
	if (
		!epoch ||
		(requireExactHeads && epoch.headCommitSeq !== authorization.headCommitSeq)
	) {
		throw rejected();
	}

	const bindings = await db
		.select({
			bindingId: questpieCrdtBindingTable.id,
			stableFieldId: questpieCrdtBindingTable.stableFieldId,
			fieldEpoch: questpieCrdtBindingTable.fieldEpoch,
			fieldSlot: questpieCrdtBindingTable.fieldSlot,
			formatVersion: questpieCrdtBindingTable.formatVersion,
			headFieldCursor: questpieCrdtBindingTable.headFieldCursor,
			fieldReadFence: questpieCrdtBindingTable.readFence,
			fieldEditFence: questpieCrdtBindingTable.editFence,
		})
		.from(questpieCrdtBindingTable)
		.where(
			and(
				eq(questpieCrdtBindingTable.resourceId, authorization.resourceId),
				eq(questpieCrdtBindingTable.schemaId, authorization.schemaId),
				inArray(questpieCrdtBindingTable.status, [1, 3]),
				isNull(questpieCrdtBindingTable.retiredAt),
			),
		)
		.orderBy(asc(questpieCrdtBindingTable.stableFieldId))
		.for("update");
	if (!equalBindings(bindings, authorization.bindings, requireExactHeads)) {
		throw rejected();
	}

	await db
		.insert(questpieCrdtSubjectFenceTable)
		.values([
			{
				resourceId: authorization.resourceId,
				subjectId: authorization.subjectId,
				scopeKind: 1,
				stableFieldId: ZERO_UUID,
			},
			...authorization.grants.map((grant) => ({
				resourceId: authorization.resourceId,
				subjectId: authorization.subjectId,
				scopeKind: 2,
				stableFieldId: grant.stableFieldId,
			})),
		])
		.onConflictDoNothing();
	const subjectFences = await db
		.select()
		.from(questpieCrdtSubjectFenceTable)
		.where(
			and(
				eq(questpieCrdtSubjectFenceTable.resourceId, authorization.resourceId),
				eq(questpieCrdtSubjectFenceTable.subjectId, authorization.subjectId),
			),
		)
		.orderBy(
			asc(questpieCrdtSubjectFenceTable.scopeKind),
			asc(questpieCrdtSubjectFenceTable.stableFieldId),
		)
		.for("update");
	if (!equalSubjectFences(subjectFences, authorization)) throw rejected();
	const [authorityClock] = await db
		.select({
			current: sql<boolean>`${authorization.authorityExpiresAt} > clock_timestamp()`,
		})
		.from(questpieCrdtResourceTable)
		.where(eq(questpieCrdtResourceTable.id, authorization.resourceId));
	if (!authorityClock?.current) throw rejected();
}

async function consumeOpenToken(
	db: CrdtDatabase,
	table:
		| typeof questpieCrdtSubjectAdmissionTable
		| typeof questpieCrdtCredentialAdmissionTable,
	predicate: ReturnType<typeof eq>,
	burst: bigint,
	refillSeconds: number,
): Promise<void> {
	const available = sql<bigint>`LEAST(${burst}, ${table.openTokens} + FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - ${table.openRefilledAt})) / ${refillSeconds})::bigint)`;
	const [consumed] = await db
		.update(table)
		.set({
			openTokens: sql`${available} - 1`,
			openRefilledAt: sql`${table.openRefilledAt} + FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - ${table.openRefilledAt})) / ${refillSeconds}) * (${refillSeconds} * interval '1 second')`,
			updatedAt: sql`clock_timestamp()`,
		})
		.where(and(predicate, sql`${available} >= 1`))
		.returning({ tokens: table.openTokens });
	if (!consumed) throw rejected();
}

function equalBindings(
	stored: ReadonlyArray<{
		bindingId: string;
		stableFieldId: string;
		fieldEpoch: bigint;
		fieldSlot: number;
		formatVersion: number;
		headFieldCursor: bigint;
		fieldReadFence: bigint;
		fieldEditFence: bigint;
	}>,
	cut: readonly CrdtAuthorizedBindingCut[],
	requireExactHeads: boolean,
): boolean {
	return (
		stored.length === cut.length &&
		stored.every((binding, index) => {
			const expected = cut[index];
			return (
				expected !== undefined &&
				binding.bindingId === expected.bindingId &&
				binding.stableFieldId === expected.stableFieldId &&
				binding.fieldEpoch === expected.fieldEpoch &&
				binding.fieldSlot === expected.fieldSlot &&
				binding.formatVersion === expected.formatVersion &&
				(!requireExactHeads ||
					binding.headFieldCursor === expected.headFieldCursor) &&
				binding.fieldReadFence === expected.fieldReadFence &&
				binding.fieldEditFence === expected.fieldEditFence
			);
		})
	);
}

function equalSubjectFences(
	stored: ReadonlyArray<{
		scopeKind: number;
		stableFieldId: string;
		readFence: bigint;
		editFence: bigint;
	}>,
	authorization: CrdtAuthorizationSnapshot,
): boolean {
	const global = stored.find((fence) => fence.scopeKind === 1);
	if (
		!global ||
		global.stableFieldId !== ZERO_UUID ||
		global.readFence !== authorization.subjectReadFence ||
		global.editFence !== authorization.subjectEditFence
	) {
		return false;
	}
	return authorization.grants.every((grant) => {
		const field = stored.find(
			(fence) =>
				fence.scopeKind === 2 && fence.stableFieldId === grant.stableFieldId,
		);
		return (
			field?.readFence === grant.subjectFieldReadFence &&
			field.editFence === grant.subjectFieldEditFence
		);
	});
}

function rejected(): CrdtAuthorizationRejectedError {
	return new CrdtAuthorizationRejectedError();
}
