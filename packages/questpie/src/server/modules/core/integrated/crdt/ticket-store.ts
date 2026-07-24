import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import { and, asc, count, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import type { AnyDrizzleClient } from "#questpie/server/config/types.js";

import {
	questpieCrdtBindingTable,
	questpieCrdtCredentialAdmissionTable,
	questpieCrdtResourceAdmissionTable,
	questpieCrdtResourceEpochTable,
	questpieCrdtResourceTable,
	questpieCrdtSessionGrantTable,
	questpieCrdtSessionTable,
	questpieCrdtSubjectAdmissionTable,
	questpieCrdtSubjectFenceTable,
	questpieCrdtTicketGrantTable,
	questpieCrdtTicketTable,
} from "./schema.js";
import {
	createCrdtTicketCredential,
	CrdtTicketRejectedError,
	parseCrdtTicketCredential,
} from "./ticket.js";

type CrdtDatabase = AnyDrizzleClient<any>;
type CrdtMode = "view" | "edit";

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const SUBJECT_SESSION_CAP = 5;
const RESOURCE_SESSION_CAP = 100;
const SUBJECT_TICKET_BURST = 30n;
const CREDENTIAL_TICKET_BURST = 10n;

export type CrdtAuthorizedTicketGrant = Readonly<{
	bindingId: string;
	stableFieldId: string;
	fieldEpoch: bigint;
	fieldSlot: number;
	formatVersion: number;
	grant: CrdtMode;
	headFieldCursor: bigint;
	fieldReadFence: bigint;
	fieldEditFence: bigint;
	subjectFieldReadFence: bigint;
	subjectFieldEditFence: bigint;
}>;

export type CrdtAuthorizedBindingCut = Readonly<{
	bindingId: string;
	stableFieldId: string;
	fieldEpoch: bigint;
	fieldSlot: number;
	formatVersion: number;
	headFieldCursor: bigint;
	fieldReadFence: bigint;
	fieldEditFence: bigint;
}>;

export type CrdtAuthorizedTicketSnapshot = Readonly<{
	resourceId: string;
	resourceEpochId: string;
	definitionId: string;
	schemaId: string;
	incarnationKey: string;
	subjectId: string;
	credentialFingerprint: Uint8Array;
	audience: string;
	origin: string | null;
	requestedMode: CrdtMode;
	effectiveMode: CrdtMode;
	resourceReadFence: bigint;
	resourceEditFence: bigint;
	subjectReadFence: bigint;
	subjectEditFence: bigint;
	sessionGeneration: bigint;
	headCommitSeq: bigint;
	/** Complete active aggregate cut, including fields hidden from this subject. */
	bindings: readonly CrdtAuthorizedBindingCut[];
	/** Readable fields only; hidden fields never enter the durable ticket. */
	grants: readonly CrdtAuthorizedTicketGrant[];
}>;

export type CrdtIssuedTicket = Readonly<{
	ticket: string;
	expiresAt: Date;
	incarnationKey: string;
	effectiveMode: CrdtMode;
}>;

export type CrdtRedeemedTicket = Readonly<{
	sessionId: string;
	leaseExpiresAt: Date;
	incarnationKey: string;
	effectiveMode: CrdtMode;
}>;

export function createCrdtTicketAdmissionStore(
	db: CrdtDatabase,
	options: Readonly<{ secretKey: string }>,
) {
	return Object.freeze({
		async issue(
			authorization: CrdtAuthorizedTicketSnapshot,
		): Promise<CrdtIssuedTicket> {
			const candidate = snapshotAuthorization(authorization);
			try {
				return await db.transaction((tx) =>
					issueTicket(tx as CrdtDatabase, options.secretKey, candidate),
				);
			} catch (error) {
				if (error instanceof TypeError) throw error;
				throw rejected();
			}
		},
		async redeem(input: {
			ticket: string;
			authorization: CrdtAuthorizedTicketSnapshot;
		}): Promise<CrdtRedeemedTicket> {
			const candidate = snapshotAuthorization(input.authorization);
			let credential: ReturnType<typeof parseCrdtTicketCredential>;
			try {
				credential = parseCrdtTicketCredential({
					token: input.ticket,
					secretKey: options.secretKey,
				});
				return await db.transaction((tx) =>
					redeemTicket(tx as CrdtDatabase, credential, candidate),
				);
			} catch (error) {
				if (
					error instanceof TypeError &&
					error.message === "CRDT ticket secret key must be at least 256 bits"
				) {
					throw error;
				}
				throw rejected();
			}
		},
	});
}

async function issueTicket(
	db: CrdtDatabase,
	secretKey: string,
	authorization: CrdtAuthorizedTicketSnapshot,
): Promise<CrdtIssuedTicket> {
	await lockAuthorization(db, authorization);
	await lockAdmissionHeads(db, authorization);
	await consumeTicketToken(
		db,
		questpieCrdtSubjectAdmissionTable,
		eq(questpieCrdtSubjectAdmissionTable.subjectId, authorization.subjectId),
		SUBJECT_TICKET_BURST,
		2,
	);
	await consumeTicketToken(
		db,
		questpieCrdtCredentialAdmissionTable,
		eq(
			questpieCrdtCredentialAdmissionTable.credentialFingerprint,
			Buffer.from(authorization.credentialFingerprint),
		),
		CREDENTIAL_TICKET_BURST,
		6,
	);

	const [
		subjectReservations,
		subjectSessions,
		resourceReservations,
		resourceSessions,
	] = await Promise.all([
		activeTicketCount(db, "subject", authorization.subjectId),
		activeSessionCount(db, "subject", authorization.subjectId),
		activeTicketCount(db, "resource", authorization.resourceId),
		activeSessionCount(db, "resource", authorization.resourceId),
	]);
	if (
		subjectReservations + subjectSessions >= SUBJECT_SESSION_CAP ||
		resourceReservations + resourceSessions >= RESOURCE_SESSION_CAP
	) {
		throw rejected();
	}

	const ticketId = randomUUID();
	const credential = createCrdtTicketCredential({ ticketId, secretKey });
	const [ticket] = await db
		.insert(questpieCrdtTicketTable)
		.values({
			id: ticketId,
			resourceId: authorization.resourceId,
			resourceEpochId: authorization.resourceEpochId,
			definitionId: authorization.definitionId,
			schemaId: authorization.schemaId,
			subjectId: authorization.subjectId,
			secretHash: Buffer.from(credential.secretHash),
			credentialFingerprint: Buffer.from(authorization.credentialFingerprint),
			audience: authorization.audience,
			origin: authorization.origin,
			requestedMode: modeValue(authorization.requestedMode),
			effectiveMode: modeValue(authorization.effectiveMode),
			protocolMajor: 1,
			protocolMinor: 0,
			resourceReadFence: authorization.resourceReadFence,
			resourceEditFence: authorization.resourceEditFence,
			subjectReadFence: authorization.subjectReadFence,
			subjectEditFence: authorization.subjectEditFence,
			sessionGeneration: authorization.sessionGeneration,
			expiresAt: sql`clock_timestamp() + interval '30 seconds'`,
		})
		.returning({ expiresAt: questpieCrdtTicketTable.expiresAt });
	if (!ticket) throw rejected();

	await db.insert(questpieCrdtTicketGrantTable).values(
		authorization.grants.map((grant) => ({
			ticketId,
			resourceId: authorization.resourceId,
			schemaId: authorization.schemaId,
			bindingId: grant.bindingId,
			stableFieldId: grant.stableFieldId,
			fieldEpoch: grant.fieldEpoch,
			fieldSlot: grant.fieldSlot,
			formatVersion: grant.formatVersion,
			grant: modeValue(grant.grant) - 1,
			headFieldCursor: grant.headFieldCursor,
			fieldReadFence: grant.fieldReadFence,
			fieldEditFence: grant.fieldEditFence,
			subjectFieldReadFence: grant.subjectFieldReadFence,
			subjectFieldEditFence: grant.subjectFieldEditFence,
		})),
	);
	return Object.freeze({
		ticket: credential.token,
		expiresAt: ticket.expiresAt,
		incarnationKey: authorization.incarnationKey,
		effectiveMode: authorization.effectiveMode,
	});
}

async function redeemTicket(
	db: CrdtDatabase,
	credential: Readonly<{ ticketId: string; secretHash: Uint8Array }>,
	authorization: CrdtAuthorizedTicketSnapshot,
): Promise<CrdtRedeemedTicket> {
	const [peeked] = await db
		.select({ resourceId: questpieCrdtTicketTable.resourceId })
		.from(questpieCrdtTicketTable)
		.where(eq(questpieCrdtTicketTable.id, credential.ticketId));
	if (!peeked || peeked.resourceId !== authorization.resourceId)
		throw rejected();

	await lockAuthorization(db, authorization);
	await lockAdmissionHeads(db, authorization);
	const ticketGrants = await db
		.select()
		.from(questpieCrdtTicketGrantTable)
		.where(eq(questpieCrdtTicketGrantTable.ticketId, credential.ticketId))
		.orderBy(asc(questpieCrdtTicketGrantTable.stableFieldId));
	if (!equalStoredGrants(ticketGrants, authorization.grants)) throw rejected();

	const originPredicate =
		authorization.origin === null
			? isNull(questpieCrdtTicketTable.origin)
			: eq(questpieCrdtTicketTable.origin, authorization.origin);
	const [redeemed] = await db
		.update(questpieCrdtTicketTable)
		.set({ redeemedAt: sql`clock_timestamp()` })
		.where(
			and(
				eq(questpieCrdtTicketTable.id, credential.ticketId),
				eq(
					questpieCrdtTicketTable.secretHash,
					Buffer.from(credential.secretHash),
				),
				eq(questpieCrdtTicketTable.resourceId, authorization.resourceId),
				eq(
					questpieCrdtTicketTable.resourceEpochId,
					authorization.resourceEpochId,
				),
				eq(questpieCrdtTicketTable.definitionId, authorization.definitionId),
				eq(questpieCrdtTicketTable.schemaId, authorization.schemaId),
				eq(questpieCrdtTicketTable.subjectId, authorization.subjectId),
				eq(
					questpieCrdtTicketTable.credentialFingerprint,
					Buffer.from(authorization.credentialFingerprint),
				),
				eq(questpieCrdtTicketTable.audience, authorization.audience),
				originPredicate,
				eq(
					questpieCrdtTicketTable.requestedMode,
					modeValue(authorization.requestedMode),
				),
				eq(
					questpieCrdtTicketTable.effectiveMode,
					modeValue(authorization.effectiveMode),
				),
				eq(
					questpieCrdtTicketTable.resourceReadFence,
					authorization.resourceReadFence,
				),
				eq(
					questpieCrdtTicketTable.resourceEditFence,
					authorization.resourceEditFence,
				),
				eq(
					questpieCrdtTicketTable.subjectReadFence,
					authorization.subjectReadFence,
				),
				eq(
					questpieCrdtTicketTable.subjectEditFence,
					authorization.subjectEditFence,
				),
				eq(
					questpieCrdtTicketTable.sessionGeneration,
					authorization.sessionGeneration,
				),
				isNull(questpieCrdtTicketTable.redeemedAt),
				isNull(questpieCrdtTicketTable.releasedAt),
				gt(questpieCrdtTicketTable.expiresAt, sql`clock_timestamp()`),
			),
		)
		.returning({ id: questpieCrdtTicketTable.id });
	if (!redeemed) throw rejected();

	const sessionId = randomUUID();
	const [session] = await db
		.insert(questpieCrdtSessionTable)
		.values({
			id: sessionId,
			ticketId: credential.ticketId,
			resourceId: authorization.resourceId,
			resourceEpochId: authorization.resourceEpochId,
			schemaId: authorization.schemaId,
			subjectId: authorization.subjectId,
			credentialFingerprint: Buffer.from(authorization.credentialFingerprint),
			requestedMode: modeValue(authorization.requestedMode),
			effectiveMode: modeValue(authorization.effectiveMode),
			generation: authorization.sessionGeneration,
			resourceReadFence: authorization.resourceReadFence,
			resourceEditFence: authorization.resourceEditFence,
			subjectReadFence: authorization.subjectReadFence,
			subjectEditFence: authorization.subjectEditFence,
			lastSeenCommitSeq: authorization.headCommitSeq,
			updateTokens: 120n,
			updateByteTokens: 2n * 1024n * 1024n,
			awarenessTokens: 40n,
			leaseExpiresAt: sql`clock_timestamp() + interval '30 seconds'`,
		})
		.returning({ leaseExpiresAt: questpieCrdtSessionTable.leaseExpiresAt });
	if (!session) throw rejected();

	await db.insert(questpieCrdtSessionGrantTable).values(
		ticketGrants.map((grant) => ({
			sessionId,
			ticketId: credential.ticketId,
			resourceId: grant.resourceId,
			schemaId: grant.schemaId,
			bindingId: grant.bindingId,
			stableFieldId: grant.stableFieldId,
			fieldEpoch: grant.fieldEpoch,
			fieldSlot: grant.fieldSlot,
			formatVersion: grant.formatVersion,
			grant: grant.grant,
			headFieldCursor: grant.headFieldCursor,
			fieldReadFence: grant.fieldReadFence,
			fieldEditFence: grant.fieldEditFence,
			subjectFieldReadFence: grant.subjectFieldReadFence,
			subjectFieldEditFence: grant.subjectFieldEditFence,
		})),
	);
	return Object.freeze({
		sessionId,
		leaseExpiresAt: session.leaseExpiresAt,
		incarnationKey: authorization.incarnationKey,
		effectiveMode: authorization.effectiveMode,
	});
}

async function lockAuthorization(
	db: CrdtDatabase,
	authorization: CrdtAuthorizedTicketSnapshot,
): Promise<void> {
	const [resource] = await db
		.select({
			definitionId: questpieCrdtResourceTable.definitionId,
			incarnationKey: questpieCrdtResourceTable.incarnationKey,
			currentEpochId: questpieCrdtResourceTable.currentEpochId,
			readFence: questpieCrdtResourceTable.readFence,
			editFence: questpieCrdtResourceTable.editFence,
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
	if (!epoch || epoch.headCommitSeq !== authorization.headCommitSeq) {
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
	if (!equalBindings(bindings, authorization.bindings)) throw rejected();

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
		.orderBy(asc(questpieCrdtSubjectFenceTable.scopeKind))
		.for("update");
	if (!equalSubjectFences(subjectFences, authorization)) throw rejected();
}

async function lockAdmissionHeads(
	db: CrdtDatabase,
	authorization: CrdtAuthorizedTicketSnapshot,
): Promise<void> {
	await db
		.insert(questpieCrdtSubjectAdmissionTable)
		.values({
			subjectId: authorization.subjectId,
			ticketTokens: SUBJECT_TICKET_BURST,
		})
		.onConflictDoNothing();
	await db
		.insert(questpieCrdtCredentialAdmissionTable)
		.values({
			credentialFingerprint: Buffer.from(authorization.credentialFingerprint),
			ticketTokens: CREDENTIAL_TICKET_BURST,
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

async function consumeTicketToken(
	db: CrdtDatabase,
	table:
		| typeof questpieCrdtSubjectAdmissionTable
		| typeof questpieCrdtCredentialAdmissionTable,
	predicate: ReturnType<typeof eq>,
	burst: bigint,
	refillSeconds: number,
): Promise<void> {
	const available = sql<bigint>`LEAST(${burst}, ${table.ticketTokens} + FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - ${table.ticketRefilledAt})) / ${refillSeconds})::bigint)`;
	const [consumed] = await db
		.update(table)
		.set({
			ticketTokens: sql`${available} - 1`,
			ticketRefilledAt: sql`${table.ticketRefilledAt} + FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - ${table.ticketRefilledAt})) / ${refillSeconds}) * (${refillSeconds} * interval '1 second')`,
			updatedAt: sql`clock_timestamp()`,
		})
		.where(and(predicate, sql`${available} >= 1`))
		.returning({ tokens: table.ticketTokens });
	if (!consumed) throw rejected();
}

async function activeTicketCount(
	db: CrdtDatabase,
	kind: "subject" | "resource",
	id: string,
): Promise<number> {
	const column =
		kind === "subject"
			? questpieCrdtTicketTable.subjectId
			: questpieCrdtTicketTable.resourceId;
	const [result] = await db
		.select({ value: count() })
		.from(questpieCrdtTicketTable)
		.where(
			and(
				eq(column, id),
				isNull(questpieCrdtTicketTable.redeemedAt),
				isNull(questpieCrdtTicketTable.releasedAt),
				gt(questpieCrdtTicketTable.expiresAt, sql`clock_timestamp()`),
			),
		);
	return result?.value ?? 0;
}

async function activeSessionCount(
	db: CrdtDatabase,
	kind: "subject" | "resource",
	id: string,
): Promise<number> {
	const column =
		kind === "subject"
			? questpieCrdtSessionTable.subjectId
			: questpieCrdtSessionTable.resourceId;
	const [result] = await db
		.select({ value: count() })
		.from(questpieCrdtSessionTable)
		.where(
			and(
				eq(column, id),
				isNull(questpieCrdtSessionTable.closedAt),
				gt(questpieCrdtSessionTable.leaseExpiresAt, sql`clock_timestamp()`),
			),
		);
	return result?.value ?? 0;
}

function snapshotAuthorization(
	input: CrdtAuthorizedTicketSnapshot,
): CrdtAuthorizedTicketSnapshot {
	if (
		input.credentialFingerprint.byteLength !== 32 ||
		input.bindings.length === 0 ||
		input.bindings.length > 32 ||
		input.grants.length === 0 ||
		input.grants.length > 32 ||
		byteLength(input.audience) < 1 ||
		byteLength(input.audience) > 255 ||
		(input.origin !== null &&
			(byteLength(input.origin) < 1 || byteLength(input.origin) > 2048)) ||
		(input.requestedMode === "view" && input.effectiveMode !== "view")
	) {
		throw new TypeError("Invalid CRDT ticket authorization snapshot");
	}
	let previousBinding = "";
	const bindings = input.bindings.map((binding) => {
		if (
			binding.stableFieldId <= previousBinding ||
			binding.fieldSlot < 1 ||
			binding.fieldSlot > 65_535
		) {
			throw new TypeError("Invalid CRDT ticket authorization binding cut");
		}
		previousBinding = binding.stableFieldId;
		return Object.freeze({ ...binding });
	});
	let previous = "";
	const grants = input.grants.map((grant) => {
		const binding = bindings.find(
			(candidate) => candidate.stableFieldId === grant.stableFieldId,
		);
		if (
			grant.stableFieldId <= previous ||
			grant.fieldSlot < 1 ||
			grant.fieldSlot > 65_535 ||
			(grant.grant !== "view" && grant.grant !== "edit") ||
			!binding ||
			!equalGrantBinding(grant, binding)
		) {
			throw new TypeError("Invalid CRDT ticket authorization grants");
		}
		previous = grant.stableFieldId;
		return Object.freeze({ ...grant });
	});
	return Object.freeze({
		...input,
		credentialFingerprint: Buffer.from(input.credentialFingerprint),
		bindings: Object.freeze(bindings),
		grants: Object.freeze(grants),
	});
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
				binding.headFieldCursor === expected.headFieldCursor &&
				binding.fieldReadFence === expected.fieldReadFence &&
				binding.fieldEditFence === expected.fieldEditFence
			);
		})
	);
}

function equalGrantBinding(
	grant: CrdtAuthorizedTicketGrant,
	binding: CrdtAuthorizedBindingCut,
): boolean {
	return (
		grant.bindingId === binding.bindingId &&
		grant.fieldEpoch === binding.fieldEpoch &&
		grant.fieldSlot === binding.fieldSlot &&
		grant.formatVersion === binding.formatVersion &&
		grant.headFieldCursor === binding.headFieldCursor &&
		grant.fieldReadFence === binding.fieldReadFence &&
		grant.fieldEditFence === binding.fieldEditFence
	);
}

function equalSubjectFences(
	stored: ReadonlyArray<{
		scopeKind: number;
		stableFieldId: string;
		readFence: bigint;
		editFence: bigint;
	}>,
	authorization: CrdtAuthorizedTicketSnapshot,
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

function equalStoredGrants(
	stored: ReadonlyArray<typeof questpieCrdtTicketGrantTable.$inferSelect>,
	grants: readonly CrdtAuthorizedTicketGrant[],
): boolean {
	return (
		stored.length === grants.length &&
		stored.every((row, index) => {
			const grant = grants[index];
			return (
				grant !== undefined &&
				row.bindingId === grant.bindingId &&
				row.stableFieldId === grant.stableFieldId &&
				row.fieldEpoch === grant.fieldEpoch &&
				row.fieldSlot === grant.fieldSlot &&
				row.formatVersion === grant.formatVersion &&
				row.grant === modeValue(grant.grant) - 1 &&
				row.headFieldCursor === grant.headFieldCursor &&
				row.fieldReadFence === grant.fieldReadFence &&
				row.fieldEditFence === grant.fieldEditFence &&
				row.subjectFieldReadFence === grant.subjectFieldReadFence &&
				row.subjectFieldEditFence === grant.subjectFieldEditFence
			);
		})
	);
}

function modeValue(mode: CrdtMode): 1 | 2 {
	return mode === "view" ? 1 : 2;
}

function byteLength(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

function rejected(): CrdtTicketRejectedError {
	return new CrdtTicketRejectedError();
}
