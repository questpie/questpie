import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";

import type { AnyDrizzleClient } from "#questpie/server/config/types.js";

import { lockCrdtAuthorizationFences } from "./authorization-store.js";
import type { CrdtAuthorizationSnapshot } from "./authorization.js";
import {
	questpieCrdtSessionGrantTable,
	questpieCrdtSessionTable,
} from "./schema.js";

type CrdtDatabase = AnyDrizzleClient<any>;

export type CrdtExchangeSessionClaim = Readonly<{
	sessionId: string;
	bindingId: string;
	resourceId: string;
	requestedMode: "view" | "edit";
	effectiveMode: "view" | "edit";
	sessionGeneration: bigint;
	deliveryGeneration: bigint;
}>;

export class CrdtSessionAuthorityRejectedError extends Error {
	constructor() {
		super("CRDT unavailable");
		this.name = "CrdtSessionAuthorityRejectedError";
	}
}

export async function inspectCrdtExchangeSession(
	db: CrdtDatabase,
	input: Readonly<{
		bindingId: string;
		sessionGeneration: bigint;
		deliveryGeneration: bigint;
		allowClosed?: boolean;
	}>,
): Promise<CrdtExchangeSessionClaim> {
	try {
		const [session] = await db
			.select({
				sessionId: questpieCrdtSessionTable.id,
				bindingId: questpieCrdtSessionTable.bindingId,
				resourceId: questpieCrdtSessionTable.resourceId,
				requestedMode: questpieCrdtSessionTable.requestedMode,
				effectiveMode: questpieCrdtSessionTable.effectiveMode,
				sessionGeneration: questpieCrdtSessionTable.generation,
				deliveryGeneration: questpieCrdtSessionTable.deliveryGeneration,
			})
			.from(questpieCrdtSessionTable)
			.where(
				and(
					eq(questpieCrdtSessionTable.bindingId, input.bindingId),
					eq(questpieCrdtSessionTable.generation, input.sessionGeneration),
					eq(
						questpieCrdtSessionTable.deliveryGeneration,
						input.deliveryGeneration,
					),
					...(input.allowClosed
						? []
						: [
								isNull(questpieCrdtSessionTable.closedAt),
								gt(
									questpieCrdtSessionTable.leaseExpiresAt,
									sql`clock_timestamp()`,
								),
								gt(
									questpieCrdtSessionTable.authorityExpiresAt,
									sql`clock_timestamp()`,
								),
							]),
				),
			)
			.limit(1);
		if (!session) throw rejected();
		return Object.freeze({
			...session,
			requestedMode: modeName(session.requestedMode),
			effectiveMode: modeName(session.effectiveMode),
		});
	} catch {
		throw rejected();
	}
}

export async function validateCrdtExchangeAuthority(
	db: CrdtDatabase,
	claim: CrdtExchangeSessionClaim,
	authorization: CrdtAuthorizationSnapshot,
	options: Readonly<{ allowClosed?: boolean }> = {},
): Promise<void> {
	try {
		await db.transaction((transaction) =>
			lockCrdtExchangeAuthority(
				transaction as CrdtDatabase,
				claim,
				authorization,
				options,
			),
		);
	} catch {
		throw rejected();
	}
}

export async function lockCrdtExchangeAuthority(
	db: CrdtDatabase,
	claim: CrdtExchangeSessionClaim,
	authorization: CrdtAuthorizationSnapshot,
	options: Readonly<{ allowClosed?: boolean }> = {},
) {
	await lockCrdtAuthorizationFences(db, authorization);
	const [session] = await db
		.select()
		.from(questpieCrdtSessionTable)
		.where(
			and(
				eq(questpieCrdtSessionTable.id, claim.sessionId),
				eq(questpieCrdtSessionTable.bindingId, claim.bindingId),
				eq(questpieCrdtSessionTable.generation, claim.sessionGeneration),
				eq(
					questpieCrdtSessionTable.deliveryGeneration,
					claim.deliveryGeneration,
				),
				...(options.allowClosed
					? []
					: [
							isNull(questpieCrdtSessionTable.closedAt),
							gt(
								questpieCrdtSessionTable.leaseExpiresAt,
								sql`clock_timestamp()`,
							),
							gt(
								questpieCrdtSessionTable.authorityExpiresAt,
								sql`clock_timestamp()`,
							),
						]),
			),
		)
		.for("update");
	if (!session || !sessionMatches(session, claim, authorization)) {
		throw rejected();
	}
	const grants = await db
		.select()
		.from(questpieCrdtSessionGrantTable)
		.where(eq(questpieCrdtSessionGrantTable.sessionId, session.id))
		.orderBy(asc(questpieCrdtSessionGrantTable.fieldSlot));
	if (!grantsMatch(grants, authorization)) throw rejected();
	if (!options.allowClosed) {
		await db
			.update(questpieCrdtSessionTable)
			.set({
				authorityExpiresAt: authorization.authorityExpiresAt,
				leaseExpiresAt: sql`LEAST(${questpieCrdtSessionTable.leaseExpiresAt}, ${authorization.authorityExpiresAt})`,
				updatedAt: sql`clock_timestamp()`,
			})
			.where(
				and(
					eq(questpieCrdtSessionTable.id, session.id),
					eq(
						questpieCrdtSessionTable.deliveryGeneration,
						claim.deliveryGeneration,
					),
				),
			);
	}
	return session;
}

export function crdtGrantFingerprint(
	authorization: Pick<CrdtAuthorizationSnapshot, "grants">,
): Buffer {
	const canonical = authorization.grants
		.map((grant) => [
			grant.bindingId,
			grant.stableFieldId,
			grant.fieldSlot,
			grant.fieldEpoch.toString(),
			grant.formatVersion,
			grant.grant,
			grant.fieldReadFence.toString(),
			grant.fieldEditFence.toString(),
			grant.subjectFieldReadFence.toString(),
			grant.subjectFieldEditFence.toString(),
		])
		.sort((left, right) => Number(left[2]) - Number(right[2]));
	return createHash("sha256")
		.update("questpie-crdt-grants-v1\0")
		.update(JSON.stringify(canonical))
		.digest();
}

function sessionMatches(
	session: typeof questpieCrdtSessionTable.$inferSelect,
	claim: CrdtExchangeSessionClaim,
	authorization: CrdtAuthorizationSnapshot,
): boolean {
	return (
		session.id === claim.sessionId &&
		session.bindingId === claim.bindingId &&
		session.resourceId === authorization.resourceId &&
		session.resourceIncarnationKey === authorization.incarnationKey &&
		session.resourceEpochId === authorization.resourceEpochId &&
		session.schemaId === authorization.schemaId &&
		session.schemaVersion ===
			BigInt(authorization.clientManifest.schemaVersion) &&
		session.subjectId === authorization.subjectId &&
		Buffer.from(session.credentialFingerprint).equals(
			Buffer.from(authorization.credentialFingerprint),
		) &&
		session.requestedMode === modeValue(authorization.requestedMode) &&
		session.effectiveMode === modeValue(authorization.effectiveMode) &&
		session.generation === authorization.sessionGeneration &&
		session.generation === claim.sessionGeneration &&
		session.deliveryGeneration === claim.deliveryGeneration &&
		session.resourceReadFence === authorization.resourceReadFence &&
		session.resourceEditFence === authorization.resourceEditFence &&
		session.ownerPolicyRevision === authorization.ownerPolicyRevision &&
		session.subjectReadFence === authorization.subjectReadFence &&
		session.subjectEditFence === authorization.subjectEditFence
	);
}

function grantsMatch(
	grants: readonly (typeof questpieCrdtSessionGrantTable.$inferSelect)[],
	authorization: CrdtAuthorizationSnapshot,
): boolean {
	const expected = [...authorization.grants].sort(
		(left, right) => left.fieldSlot - right.fieldSlot,
	);
	return (
		grants.length === expected.length &&
		grants.every((grant, index) => {
			const candidate = expected[index];
			return (
				candidate !== undefined &&
				grant.resourceId === authorization.resourceId &&
				grant.schemaId === authorization.schemaId &&
				grant.bindingId === candidate.bindingId &&
				grant.stableFieldId === candidate.stableFieldId &&
				grant.fieldSlot === candidate.fieldSlot &&
				grant.fieldEpoch === candidate.fieldEpoch &&
				grant.formatVersion === candidate.formatVersion &&
				grant.grant === (candidate.grant === "edit" ? 1 : 0) &&
				grant.fieldReadFence === candidate.fieldReadFence &&
				grant.fieldEditFence === candidate.fieldEditFence &&
				grant.subjectFieldReadFence === candidate.subjectFieldReadFence &&
				grant.subjectFieldEditFence === candidate.subjectFieldEditFence
			);
		})
	);
}

function modeValue(mode: "view" | "edit"): 1 | 2 {
	return mode === "edit" ? 2 : 1;
}

function modeName(mode: number): "view" | "edit" {
	if (mode === 1) return "view";
	if (mode === 2) return "edit";
	throw rejected();
}

function rejected(): CrdtSessionAuthorityRejectedError {
	return new CrdtSessionAuthorityRejectedError();
}
