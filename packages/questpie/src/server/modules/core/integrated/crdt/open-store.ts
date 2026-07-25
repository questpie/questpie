import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";

import { and, count, eq, gt, isNull, sql } from "drizzle-orm";

import type { AnyDrizzleClient } from "#questpie/server/config/types.js";

import {
	consumeCrdtOpenAdmission,
	lockCrdtAdmissionHeads,
	lockCrdtAuthorizationCut,
} from "./authorization-store.js";
import {
	type CrdtAuthorizationSnapshot,
	type CrdtClientManifestViewV1,
	snapshotCrdtAuthorization,
} from "./authorization.js";
import {
	questpieCrdtAwarenessTable,
	questpieCrdtNamespaceTable,
	questpieCrdtResourceEpochTable,
	questpieCrdtSessionGrantTable,
	questpieCrdtSessionTable,
} from "./schema.js";

type CrdtDatabase = AnyDrizzleClient<any>;
type CrdtActorKind = 1 | 2 | 3;

export type CrdtOpenLimits = Readonly<{
	maximumSessions: number;
	maximumSessionsPerSubject: number;
	maximumSessionsPerCredential: number;
	maximumSessionsPerResource: number;
	maximumDocumentsPerEdgeSession: number;
}>;

export type CrdtOpenSessionInput = Readonly<{
	openId: string;
	replacesBindingId?: string;
	authorization: CrdtAuthorizationSnapshot;
	actorKind: CrdtActorKind;
	edge: Readonly<{
		sessionKey: Uint8Array;
		ownerGeneration: bigint;
	}>;
}>;

export type CrdtOpenedSession = Readonly<{
	sessionId: string;
	bindingId: string;
	deliveryGeneration: bigint;
	edgeOwnerGeneration: bigint;
	leaseExpiresAt: Date;
	incarnationKey: string;
	effectiveMode: "view" | "edit";
	offlineSubjectKey: string;
	manifest: CrdtClientManifestViewV1;
	sessionGeneration: bigint;
}>;

const DEFAULT_LIMITS: CrdtOpenLimits = Object.freeze({
	maximumSessions: 10_000,
	maximumSessionsPerSubject: 5,
	maximumSessionsPerCredential: 5,
	maximumSessionsPerResource: 100,
	maximumDocumentsPerEdgeSession: 256,
});

export class CrdtOpenRejectedError extends Error {
	constructor(cause?: unknown) {
		super("CRDT unavailable", cause === undefined ? undefined : { cause });
		this.name = "CrdtOpenRejectedError";
	}
}

export function createCrdtOpenSessionStore(
	db: CrdtDatabase,
	options: Readonly<{
		limits?: Partial<CrdtOpenLimits>;
		publishChange?(input: {
			resourceId: string;
			resourceEpochId: string;
		}): void | Promise<void>;
	}> = {},
) {
	const limits = resolveLimits(options.limits);
	return Object.freeze({
		async open(input: CrdtOpenSessionInput): Promise<CrdtOpenedSession> {
			try {
				const candidate = snapshotOpenInput(input);
				const result = await db.transaction((tx) =>
					openSession(tx as CrdtDatabase, candidate, limits),
				);
				if (result.replaced) {
					try {
						await options.publishChange?.(result.replaced);
					} catch {
						// Realtime is a lossy wake; the replacement already committed.
					}
				}
				return result.opened;
			} catch (error) {
				throw new CrdtOpenRejectedError(error);
			}
		},
	});
}

async function openSession(
	db: CrdtDatabase,
	input: CrdtOpenSessionInput,
	limits: CrdtOpenLimits,
): Promise<{
	opened: CrdtOpenedSession;
	replaced?: { resourceId: string; resourceEpochId: string };
}> {
	const authorization = input.authorization;
	await lockCrdtAuthorizationCut(db, authorization);
	await lockCrdtAdmissionHeads(db, authorization);

	// The namespace row is the global admission head. It makes the global and
	// edge caps exact even when opens for unrelated subjects race.
	const [namespace] = await db
		.select({ singleton: questpieCrdtNamespaceTable.singleton })
		.from(questpieCrdtNamespaceTable)
		.where(eq(questpieCrdtNamespaceTable.singleton, 1))
		.for("update");
	if (!namespace) throw new CrdtOpenRejectedError();

	const [existing] = await db
		.select()
		.from(questpieCrdtSessionTable)
		.where(
			and(
				eq(questpieCrdtSessionTable.subjectId, authorization.subjectId),
				eq(questpieCrdtSessionTable.openId, input.openId),
				isNull(questpieCrdtSessionTable.closedAt),
			),
		)
		.for("update");
	if (existing) {
		assertSameLogicalOpen(existing, input);
		const existingIsActive =
			(await activeSessionCount(
				db,
				eq(questpieCrdtSessionTable.id, existing.id),
			)) === 1;
		if (!existingIsActive) {
			await enforceCaps(db, input, limits);
		}
		const sameEdgeKey =
			existing.edgeSessionKey !== null &&
			Buffer.from(existing.edgeSessionKey).equals(
				Buffer.from(input.edge.sessionKey),
			);
		const sameEdge =
			sameEdgeKey &&
			existing.edgeOwnerGeneration === input.edge.ownerGeneration;
		if (sameEdge) {
			const [renewed] = await db
				.update(questpieCrdtSessionTable)
				.set({
					authorityExpiresAt: authorization.authorityExpiresAt,
					leaseExpiresAt: sql`LEAST(clock_timestamp() + interval '30 seconds', ${authorization.authorityExpiresAt})`,
					updatedAt: sql`clock_timestamp()`,
				})
				.where(
					and(
						eq(questpieCrdtSessionTable.id, existing.id),
						isNull(questpieCrdtSessionTable.closedAt),
					),
				)
				.returning();
			if (!renewed) throw new CrdtOpenRejectedError();
			return { opened: openedResult(renewed, authorization) };
		}
		if (
			input.edge.ownerGeneration <= existing.edgeOwnerGeneration ||
			(!sameEdgeKey &&
				(await activeSessionCount(
					db,
					eq(
						questpieCrdtSessionTable.edgeSessionKey,
						Buffer.from(input.edge.sessionKey),
					),
				)) >= limits.maximumDocumentsPerEdgeSession)
		) {
			throw new CrdtOpenRejectedError();
		}

		const [reattached] = await db
			.update(questpieCrdtSessionTable)
			.set({
				edgeSessionKey: Buffer.from(input.edge.sessionKey),
				edgeOwnerGeneration: input.edge.ownerGeneration,
				deliveryGeneration: sql`${questpieCrdtSessionTable.deliveryGeneration} + 1`,
				authorityExpiresAt: authorization.authorityExpiresAt,
				leaseExpiresAt: sql`LEAST(clock_timestamp() + interval '30 seconds', ${authorization.authorityExpiresAt})`,
				updatedAt: sql`clock_timestamp()`,
			})
			.where(
				and(
					eq(questpieCrdtSessionTable.id, existing.id),
					isNull(questpieCrdtSessionTable.closedAt),
				),
			)
			.returning();
		if (!reattached) throw new CrdtOpenRejectedError();
		return { opened: openedResult(reattached, authorization) };
	}

	const replaced = await retireReplacedSession(db, input);
	await consumeCrdtOpenAdmission(db, authorization);
	await enforceCaps(db, input, limits);
	const [epoch] = await db
		.select({
			aggregateEpoch: questpieCrdtResourceEpochTable.aggregateEpoch,
		})
		.from(questpieCrdtResourceEpochTable)
		.where(
			and(
				eq(questpieCrdtResourceEpochTable.id, authorization.resourceEpochId),
				eq(questpieCrdtResourceEpochTable.resourceId, authorization.resourceId),
			),
		);
	if (!epoch) throw new CrdtOpenRejectedError();

	const sessionId = randomUUID();
	const bindingId = randomUUID();
	const [session] = await db
		.insert(questpieCrdtSessionTable)
		.values({
			id: sessionId,
			openId: input.openId,
			bindingId,
			actorKind: input.actorKind,
			resourceId: authorization.resourceId,
			resourceIncarnationKey: authorization.incarnationKey,
			resourceEpochId: authorization.resourceEpochId,
			aggregateEpoch: epoch.aggregateEpoch,
			schemaId: authorization.schemaId,
			schemaVersion: BigInt(authorization.clientManifest.schemaVersion),
			openResultFingerprint: clientOpenResultFingerprint(authorization),
			subjectId: authorization.subjectId,
			credentialFingerprint: Buffer.from(authorization.credentialFingerprint),
			edgeSessionKey: Buffer.from(input.edge.sessionKey),
			edgeOwnerGeneration: input.edge.ownerGeneration,
			deliveryGeneration: 1n,
			requestedMode: modeValue(authorization.requestedMode),
			effectiveMode: modeValue(authorization.effectiveMode),
			generation: authorization.sessionGeneration,
			resourceReadFence: authorization.resourceReadFence,
			resourceEditFence: authorization.resourceEditFence,
			ownerPolicyRevision: authorization.ownerPolicyRevision,
			subjectReadFence: authorization.subjectReadFence,
			subjectEditFence: authorization.subjectEditFence,
			authorityExpiresAt: authorization.authorityExpiresAt,
			lastSeenCommitSeq: authorization.headCommitSeq,
			updateTokens: 120n,
			updateByteTokens: 2n * 1024n * 1024n,
			awarenessTokens: 20n,
			rosterTokens: 20n,
			leaseExpiresAt: sql`LEAST(clock_timestamp() + interval '30 seconds', ${authorization.authorityExpiresAt})`,
		})
		.returning();
	if (!session) throw new CrdtOpenRejectedError();

	await db.insert(questpieCrdtSessionGrantTable).values(
		authorization.grants.map((grant) => ({
			sessionId,
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
	return {
		opened: openedResult(session, authorization),
		...(replaced ? { replaced } : {}),
	};
}

async function retireReplacedSession(
	db: CrdtDatabase,
	input: CrdtOpenSessionInput,
): Promise<{ resourceId: string; resourceEpochId: string } | undefined> {
	if (!input.replacesBindingId) return undefined;
	const [previous] = await db
		.select()
		.from(questpieCrdtSessionTable)
		.where(
			and(
				eq(questpieCrdtSessionTable.bindingId, input.replacesBindingId),
				isNull(questpieCrdtSessionTable.closedAt),
			),
		)
		.for("update");
	if (!previous) return undefined;
	const authorization = input.authorization;
	if (
		previous.actorKind !== input.actorKind ||
		previous.resourceId !== authorization.resourceId ||
		previous.subjectId !== authorization.subjectId ||
		!Buffer.from(previous.credentialFingerprint).equals(
			Buffer.from(authorization.credentialFingerprint),
		)
	) {
		return undefined;
	}
	const [closed] = await db
		.update(questpieCrdtSessionTable)
		.set({
			leaseExpiresAt: sql`LEAST(clock_timestamp(), ${questpieCrdtSessionTable.authorityExpiresAt})`,
			closedAt: sql`clock_timestamp()`,
			closeReason: 1,
			updatedAt: sql`clock_timestamp()`,
		})
		.where(
			and(
				eq(questpieCrdtSessionTable.id, previous.id),
				isNull(questpieCrdtSessionTable.closedAt),
			),
		)
		.returning({
			resourceId: questpieCrdtSessionTable.resourceId,
			resourceEpochId: questpieCrdtSessionTable.resourceEpochId,
		});
	if (!closed) throw new CrdtOpenRejectedError();
	await db
		.delete(questpieCrdtAwarenessTable)
		.where(eq(questpieCrdtAwarenessTable.sessionId, previous.id));
	return closed;
}

async function enforceCaps(
	db: CrdtDatabase,
	input: CrdtOpenSessionInput,
	limits: CrdtOpenLimits,
): Promise<void> {
	const authorization = input.authorization;
	const edgeSessionKey = Buffer.from(input.edge.sessionKey);
	const [global, subject, credential, resource, edge] = await Promise.all([
		activeSessionCount(db),
		activeSessionCount(
			db,
			eq(questpieCrdtSessionTable.subjectId, authorization.subjectId),
		),
		activeSessionCount(
			db,
			eq(
				questpieCrdtSessionTable.credentialFingerprint,
				Buffer.from(authorization.credentialFingerprint),
			),
		),
		activeSessionCount(
			db,
			eq(questpieCrdtSessionTable.resourceId, authorization.resourceId),
		),
		activeSessionCount(
			db,
			eq(questpieCrdtSessionTable.edgeSessionKey, edgeSessionKey),
		),
	]);
	if (
		global >= limits.maximumSessions ||
		subject >= limits.maximumSessionsPerSubject ||
		credential >= limits.maximumSessionsPerCredential ||
		resource >= limits.maximumSessionsPerResource ||
		edge >= limits.maximumDocumentsPerEdgeSession
	) {
		throw new CrdtOpenRejectedError();
	}
}

async function activeSessionCount(
	db: CrdtDatabase,
	predicate?: ReturnType<typeof eq>,
): Promise<number> {
	const conditions = [
		isNull(questpieCrdtSessionTable.closedAt),
		gt(questpieCrdtSessionTable.leaseExpiresAt, sql`clock_timestamp()`),
	];
	if (predicate) conditions.push(predicate);
	const [result] = await db
		.select({ value: count() })
		.from(questpieCrdtSessionTable)
		.where(and(...conditions));
	return result?.value ?? 0;
}

function assertSameLogicalOpen(
	session: typeof questpieCrdtSessionTable.$inferSelect,
	input: CrdtOpenSessionInput,
): void {
	const authorization = input.authorization;
	if (
		session.actorKind !== input.actorKind ||
		session.resourceId !== authorization.resourceId ||
		session.resourceIncarnationKey !== authorization.incarnationKey ||
		session.resourceEpochId !== authorization.resourceEpochId ||
		session.schemaId !== authorization.schemaId ||
		session.schemaVersion !==
			BigInt(authorization.clientManifest.schemaVersion) ||
		session.openResultFingerprint === null ||
		!Buffer.from(session.openResultFingerprint).equals(
			clientOpenResultFingerprint(authorization),
		) ||
		session.subjectId !== authorization.subjectId ||
		!Buffer.from(session.credentialFingerprint).equals(
			Buffer.from(authorization.credentialFingerprint),
		) ||
		session.requestedMode !== modeValue(authorization.requestedMode) ||
		session.effectiveMode !== modeValue(authorization.effectiveMode) ||
		session.generation !== authorization.sessionGeneration ||
		session.resourceReadFence !== authorization.resourceReadFence ||
		session.resourceEditFence !== authorization.resourceEditFence ||
		session.ownerPolicyRevision !== authorization.ownerPolicyRevision ||
		session.subjectReadFence !== authorization.subjectReadFence ||
		session.subjectEditFence !== authorization.subjectEditFence
	) {
		throw new CrdtOpenRejectedError();
	}
}

function openedResult(
	session: typeof questpieCrdtSessionTable.$inferSelect,
	authorization: CrdtAuthorizationSnapshot,
): CrdtOpenedSession {
	return Object.freeze({
		sessionId: session.id,
		bindingId: session.bindingId,
		deliveryGeneration: session.deliveryGeneration,
		edgeOwnerGeneration: session.edgeOwnerGeneration,
		leaseExpiresAt: new Date(session.leaseExpiresAt),
		incarnationKey: session.resourceIncarnationKey,
		effectiveMode: modeName(session.effectiveMode),
		offlineSubjectKey: authorization.offlineSubjectKey,
		manifest: authorization.clientManifest,
		sessionGeneration: session.generation,
	});
}

function snapshotOpenInput(input: CrdtOpenSessionInput): CrdtOpenSessionInput {
	if (
		!validUuid(input.openId) ||
		(input.replacesBindingId !== undefined &&
			!validUuid(input.replacesBindingId)) ||
		(input.actorKind !== 1 && input.actorKind !== 2 && input.actorKind !== 3) ||
		input.edge.sessionKey.byteLength !== 32 ||
		input.edge.ownerGeneration < 0n
	) {
		throw new CrdtOpenRejectedError();
	}
	return Object.freeze({
		openId: input.openId,
		...(input.replacesBindingId
			? { replacesBindingId: input.replacesBindingId }
			: {}),
		authorization: snapshotCrdtAuthorization(input.authorization),
		actorKind: input.actorKind,
		edge: Object.freeze({
			sessionKey: Buffer.from(input.edge.sessionKey),
			ownerGeneration: input.edge.ownerGeneration,
		}),
	});
}

function resolveLimits(input?: Partial<CrdtOpenLimits>): CrdtOpenLimits {
	const limits = { ...DEFAULT_LIMITS, ...input };
	for (const value of Object.values(limits)) {
		if (!Number.isSafeInteger(value) || value < 1)
			throw new TypeError("CRDT open limits must be positive safe integers");
	}
	return Object.freeze(limits);
}

function modeValue(mode: "view" | "edit"): 1 | 2 {
	return mode === "edit" ? 2 : 1;
}

function modeName(mode: number): "view" | "edit" {
	if (mode === 1) return "view";
	if (mode === 2) return "edit";
	throw new CrdtOpenRejectedError();
}

function validUuid(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
		value,
	);
}

function clientOpenResultFingerprint(
	authorization: CrdtAuthorizationSnapshot,
): Buffer {
	const manifest = authorization.clientManifest;
	const canonical = JSON.stringify([
		authorization.offlineSubjectKey,
		manifest.schemaVersion,
		manifest.schemaFingerprint,
		manifest.awarenessEnabled,
		Object.entries(manifest.fields)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([path, field]) => [
				path,
				field.fieldSlot,
				field.format,
				field.formatVersion,
				field.engineId,
				field.grant,
			]),
	]);
	return createHash("sha256")
		.update("questpie-crdt-open-result-v1\0")
		.update(canonical)
		.digest();
}
