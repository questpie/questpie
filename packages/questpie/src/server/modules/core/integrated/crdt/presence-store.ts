import { Buffer } from "node:buffer";
import { createHash, createHmac } from "node:crypto";

import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { AnyDrizzleClient } from "#questpie/server/config/types.js";

import type { CrdtAuthorizationSnapshot } from "./authorization.js";
import {
	questpieCrdtAwarenessTable,
	questpieCrdtBindingTable,
	questpieCrdtDefinitionTable,
	questpieCrdtResourceTable,
	questpieCrdtSessionGrantTable,
	questpieCrdtSessionTable,
	questpieCrdtSubjectFenceTable,
} from "./schema.js";
import {
	lockCrdtExchangeAuthority,
	type CrdtExchangeSessionClaim,
} from "./session-authority.js";

type CrdtDatabase = AnyDrizzleClient<any>;

const AWARENESS_RATE = 20;
const AWARENESS_BURST = 20n;
const ROSTER_RATE = 20;
const ROSTER_BURST = 20n;
const MAX_AWARENESS_PROFILE_BYTES = 512;
const MAX_AWARENESS_DEPTH = 8;
const MAX_AWARENESS_VALUES = 128;
const MAX_POSITION_BYTES = 64;
const MAX_ROSTER_BYTES = 1024;
const MAX_ROSTER_PAGES = 16;
const MAX_RESOURCE_SESSIONS = 100;
const MAX_PARTICIPANT_SESSIONS = 5;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const aggregateSubjectFence = alias(
	questpieCrdtSubjectFenceTable,
	"crdt_roster_aggregate_subject_fence",
);
const fieldSubjectFence = alias(
	questpieCrdtSubjectFenceTable,
	"crdt_roster_field_subject_fence",
);

export type CrdtClientAwarenessEnvelopeV1 = Readonly<{
	v: 1;
	kind: "awareness";
	value: unknown;
	active?: Readonly<{
		fieldSlot: number;
		cursor?: string;
		selectionEnd?: string;
	}>;
}>;

export type CrdtClientAwarenessClearEnvelopeV1 = Readonly<{
	v: 1;
	kind: "awareness-clear";
}>;

export type CrdtRosterSessionV1 = Readonly<{
	sessionId: string;
	active?: Readonly<{
		fieldSlot: number;
		cursor?: string;
		selectionEnd?: string;
	}>;
	value: unknown;
	expiresAtMs: number;
}>;

export type CrdtRosterParticipantV1 = Readonly<{
	participantId: string;
	sessions: readonly CrdtRosterSessionV1[];
}>;

export type CrdtRosterPageV1 = Readonly<{
	v: 1;
	kind: "roster-page";
	generation: string;
	pageIndex: number;
	pageCount: number;
	participants: readonly CrdtRosterParticipantV1[];
}>;

export type CrdtPresenceAuthorityGuard = Readonly<{
	claim: CrdtExchangeSessionClaim;
	authorization: CrdtAuthorizationSnapshot;
}>;

export interface CrdtPresenceSourceV1 {
	writeAwareness(
		sessionId: string,
		value: unknown,
		authority?: CrdtPresenceAuthorityGuard,
	): Promise<readonly CrdtRosterPageV1[]>;
	heartbeat(
		sessionId: string,
		authority?: CrdtPresenceAuthorityGuard,
	): Promise<bigint>;
	close(
		sessionId: string,
		authority?: CrdtPresenceAuthorityGuard,
	): Promise<void>;
	projectRoster(
		sessionId: string,
		authority?: CrdtPresenceAuthorityGuard,
	): Promise<readonly CrdtRosterPageV1[]>;
}

export class CrdtPresenceRejectedError extends Error {
	readonly code = "CRDT_PRESENCE_REJECTED";

	constructor() {
		super("CRDT presence rejected");
		this.name = "CrdtPresenceRejectedError";
	}
}

export function assertCrdtRosterPagesV1(
	value: readonly CrdtRosterPageV1[],
): void {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.length > MAX_ROSTER_PAGES
	) {
		throw rejected();
	}
	const generation = value[0]!.generation;
	if (!/^[A-Za-z0-9_-]{43}$/.test(generation)) throw rejected();
	const sessionsByParticipant = new Map<string, CrdtRosterSessionV1[]>();
	const sessionIds = new Set<string>();
	let previousParticipant = "";
	let previousSession = "";
	for (const [pageIndex, page] of value.entries()) {
		if (
			!isExactObject(
				page,
				["v", "kind", "generation", "pageIndex", "pageCount", "participants"],
				[],
			) ||
			page.v !== 1 ||
			page.kind !== "roster-page" ||
			page.generation !== generation ||
			page.pageIndex !== pageIndex ||
			page.pageCount !== value.length ||
			!Array.isArray(page.participants) ||
			jsonBytes(page) > MAX_ROSTER_BYTES
		) {
			throw rejected();
		}
		for (const participant of page.participants) {
			if (
				!isExactObject(participant, ["participantId", "sessions"], []) ||
				typeof participant.participantId !== "string" ||
				!/^[A-Za-z0-9_-]{22}$/.test(participant.participantId) ||
				!Array.isArray(participant.sessions) ||
				participant.sessions.length === 0 ||
				participant.participantId < previousParticipant
			) {
				throw rejected();
			}
			if (participant.participantId !== previousParticipant) {
				previousSession = "";
			}
			previousParticipant = participant.participantId;
			const sessions =
				sessionsByParticipant.get(participant.participantId) ?? [];
			for (const session of participant.sessions) {
				if (
					!isExactObject(
						session,
						["sessionId", "value", "expiresAtMs"],
						["active"],
					) ||
					typeof session.sessionId !== "string" ||
					!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
						session.sessionId,
					) ||
					session.sessionId <= previousSession ||
					sessionIds.has(session.sessionId) ||
					typeof session.expiresAtMs !== "number" ||
					!Number.isSafeInteger(session.expiresAtMs) ||
					session.expiresAtMs < 0
				) {
					throw rejected();
				}
				assertJsonValue(session.value);
				if (jsonBytes(session.value) > MAX_AWARENESS_PROFILE_BYTES) {
					throw rejected();
				}
				if (session.active !== undefined) {
					if (
						!isExactObject(
							session.active,
							["fieldSlot"],
							["cursor", "selectionEnd"],
						) ||
						typeof session.active.fieldSlot !== "number" ||
						!Number.isInteger(session.active.fieldSlot) ||
						session.active.fieldSlot < 1 ||
						session.active.fieldSlot > 0xffff
					) {
						throw rejected();
					}
					parsePosition(session.active.cursor);
					parsePosition(session.active.selectionEnd);
				}
				previousSession = session.sessionId;
				sessionIds.add(session.sessionId);
				sessions.push({
					sessionId: session.sessionId,
					value: session.value,
					expiresAtMs: session.expiresAtMs,
					...(session.active
						? {
								active: {
									fieldSlot: session.active.fieldSlot as number,
									...(session.active.cursor
										? { cursor: session.active.cursor as string }
										: {}),
									...(session.active.selectionEnd
										? {
												selectionEnd: session.active.selectionEnd as string,
											}
										: {}),
								},
							}
						: {}),
				});
				if (
					sessionIds.size > MAX_RESOURCE_SESSIONS ||
					sessions.length > MAX_PARTICIPANT_SESSIONS
				) {
					throw rejected();
				}
			}
			sessionsByParticipant.set(participant.participantId, sessions);
		}
	}
	const participants = [...sessionsByParticipant.entries()].map(
		([participantId, sessions]) => ({ participantId, sessions }),
	);
	const expectedGeneration = createHash("sha256")
		.update(canonicalJson(participants))
		.digest("base64url");
	if (generation !== expectedGeneration) throw rejected();
}

export function createCrdtDatabasePresenceStore(
	db: CrdtDatabase,
	input: Readonly<{
		participantSecret: string | Uint8Array;
		parseAwareness(input: {
			ownerKind: "collection" | "global";
			ownerKey: string;
			value: unknown;
		}): unknown;
		isAwarenessEnabled(input: {
			ownerKind: "collection" | "global";
			ownerKey: string;
		}): boolean;
		publishChange?(input: {
			resourceId: string;
			resourceEpochId: string;
		}): void | Promise<void>;
	}>,
): CrdtPresenceSourceV1 {
	const participantSecret =
		typeof input.participantSecret === "string"
			? new TextEncoder().encode(input.participantSecret)
			: new Uint8Array(input.participantSecret);
	if (participantSecret.byteLength < 32) {
		throw new TypeError("CRDT participant secret must be at least 256 bits");
	}

	const store: CrdtPresenceSourceV1 = {
		async writeAwareness(
			sessionId: string,
			value: unknown,
			authority?: CrdtPresenceAuthorityGuard,
		) {
			const envelope = parseClientAwarenessEnvelope(value);
			try {
				const result = await db.transaction(async (transaction) => {
					const tx = transaction as CrdtDatabase;
					if (authority) {
						await lockCrdtExchangeAuthority(
							tx,
							authority.claim,
							authority.authorization,
						);
					}
					const session = await lockLiveSession(tx, sessionId);
					const change = {
						resourceId: session.resourceId,
						resourceEpochId: session.resourceEpochId,
					};
					const definition = await readDefinition(tx, session.resourceId);
					const owner = {
						ownerKind:
							definition.ownerKind === 1
								? ("collection" as const)
								: ("global" as const),
						ownerKey: definition.ownerKey,
					};
					if (!input.isAwarenessEnabled(owner)) throw rejected();
					if (envelope.kind === "awareness-clear") {
						await consumeAwarenessToken(tx, sessionId);
						await tx
							.delete(questpieCrdtAwarenessTable)
							.where(eq(questpieCrdtAwarenessTable.sessionId, sessionId));
						return {
							change,
							pages: await projectRosterPages(tx, sessionId, participantSecret),
						};
					}
					const parsedValue = input.parseAwareness({
						...owner,
						value: envelope.value,
					});
					assertJsonValue(parsedValue);
					assertNoReservedAwarenessKeys(parsedValue);
					if (jsonBytes(parsedValue) > MAX_AWARENESS_PROFILE_BYTES) {
						throw rejected();
					}
					const active = envelope.active
						? await resolveActiveTextField(tx, sessionId, envelope.active)
						: undefined;
					const stored = {
						v: 1,
						kind: "awareness",
						value: parsedValue,
						...(active
							? {
									active: {
										...(active.cursor ? { cursor: active.cursor } : {}),
										...(active.selectionEnd
											? { selectionEnd: active.selectionEnd }
											: {}),
									},
								}
							: {}),
					} as const;
					const sizeBytes = jsonBytes(stored);
					if (sizeBytes > MAX_ROSTER_BYTES) throw rejected();
					await consumeAwarenessToken(tx, sessionId);
					await tx
						.insert(questpieCrdtAwarenessTable)
						.values({
							sessionId,
							resourceId: session.resourceId,
							activeStableFieldId: active?.stableFieldId,
							value: stored,
							sizeBytes,
							expiresAt: sql`LEAST(clock_timestamp() + interval '30 seconds', ${session.leaseExpiresAt}::timestamptz, ${session.authorityExpiresAt}::timestamptz)`,
							updatedAt: sql`clock_timestamp()`,
						})
						.onConflictDoUpdate({
							target: questpieCrdtAwarenessTable.sessionId,
							set: {
								resourceId: session.resourceId,
								activeStableFieldId: active?.stableFieldId ?? null,
								value: stored,
								sizeBytes,
								expiresAt: sql`LEAST(clock_timestamp() + interval '30 seconds', ${session.leaseExpiresAt}::timestamptz, ${session.authorityExpiresAt}::timestamptz)`,
								updatedAt: sql`clock_timestamp()`,
							},
						});
					return {
						change,
						pages: await projectRosterPages(tx, sessionId, participantSecret),
					};
				});
				await publishChangeBestEffort(input.publishChange, result.change);
				return result.pages;
			} catch (error) {
				if (error instanceof TypeError) throw error;
				throw rejected();
			}
		},

		async heartbeat(sessionId: string, authority?: CrdtPresenceAuthorityGuard) {
			try {
				const [renewed] = await db.transaction(async (transaction) => {
					const tx = transaction as CrdtDatabase;
					if (authority) {
						await lockCrdtExchangeAuthority(
							tx,
							authority.claim,
							authority.authorization,
						);
					}
					return tx
						.update(questpieCrdtSessionTable)
						.set({
							leaseExpiresAt: sql`LEAST(clock_timestamp() + interval '30 seconds', ${questpieCrdtSessionTable.authorityExpiresAt})`,
							updatedAt: sql`clock_timestamp()`,
						})
						.where(
							and(
								eq(questpieCrdtSessionTable.id, sessionId),
								isNull(questpieCrdtSessionTable.closedAt),
								gt(
									questpieCrdtSessionTable.authorityExpiresAt,
									sql`clock_timestamp()`,
								),
								gt(
									questpieCrdtSessionTable.leaseExpiresAt,
									sql`clock_timestamp()`,
								),
							),
						)
						.returning({ serverTime: sql<Date>`clock_timestamp()` });
				});
				if (!renewed) throw rejected();
				const serverTime =
					renewed.serverTime instanceof Date
						? renewed.serverTime
						: new Date(renewed.serverTime);
				if (!Number.isFinite(serverTime.getTime())) throw rejected();
				return BigInt(serverTime.getTime());
			} catch {
				throw rejected();
			}
		},

		async close(sessionId: string, authority?: CrdtPresenceAuthorityGuard) {
			try {
				const change = await db.transaction(async (transaction) => {
					const tx = transaction as CrdtDatabase;
					const [existing] = await tx
						.select({ closedAt: questpieCrdtSessionTable.closedAt })
						.from(questpieCrdtSessionTable)
						.where(eq(questpieCrdtSessionTable.id, sessionId))
						.limit(1);
					if (!existing || existing.closedAt) return;
					if (authority) {
						await lockCrdtExchangeAuthority(
							tx,
							authority.claim,
							authority.authorization,
							{ allowClosed: true },
						);
					}
					const [closed] = await tx
						.update(questpieCrdtSessionTable)
						.set({
							leaseExpiresAt: sql`LEAST(clock_timestamp(), ${questpieCrdtSessionTable.authorityExpiresAt})`,
							closedAt: sql`clock_timestamp()`,
							closeReason: 1,
							updatedAt: sql`clock_timestamp()`,
						})
						.where(
							and(
								eq(questpieCrdtSessionTable.id, sessionId),
								isNull(questpieCrdtSessionTable.closedAt),
							),
						)
						.returning({
							resourceId: questpieCrdtSessionTable.resourceId,
							resourceEpochId: questpieCrdtSessionTable.resourceEpochId,
						});
					if (!closed) return;
					await tx
						.delete(questpieCrdtAwarenessTable)
						.where(eq(questpieCrdtAwarenessTable.sessionId, sessionId));
					return closed;
				});
				if (change) {
					await publishChangeBestEffort(input.publishChange, change);
				}
			} catch {
				throw rejected();
			}
		},

		async projectRoster(
			sessionId: string,
			authority?: CrdtPresenceAuthorityGuard,
		) {
			try {
				return await db.transaction(async (transaction) => {
					const tx = transaction as CrdtDatabase;
					if (authority) {
						await lockCrdtExchangeAuthority(
							tx,
							authority.claim,
							authority.authorization,
						);
					}
					await consumeRosterToken(tx, sessionId);
					return projectRosterPages(tx, sessionId, participantSecret);
				});
			} catch {
				throw rejected();
			}
		},
	};
	return Object.freeze(store);
}

async function lockLiveSession(db: CrdtDatabase, sessionId: string) {
	const [session] = await db
		.select({
			resourceId: questpieCrdtSessionTable.resourceId,
			resourceEpochId: questpieCrdtSessionTable.resourceEpochId,
			leaseExpiresAt: questpieCrdtSessionTable.leaseExpiresAt,
			authorityExpiresAt: questpieCrdtSessionTable.authorityExpiresAt,
		})
		.from(questpieCrdtSessionTable)
		.where(
			and(
				eq(questpieCrdtSessionTable.id, sessionId),
				isNull(questpieCrdtSessionTable.closedAt),
				gt(questpieCrdtSessionTable.leaseExpiresAt, sql`clock_timestamp()`),
				gt(questpieCrdtSessionTable.authorityExpiresAt, sql`clock_timestamp()`),
			),
		)
		.for("update");
	if (!session) throw rejected();
	return session;
}

async function readDefinition(db: CrdtDatabase, resourceId: string) {
	const [definition] = await db
		.select({
			ownerKind: questpieCrdtDefinitionTable.ownerKind,
			ownerKey: questpieCrdtDefinitionTable.ownerKey,
		})
		.from(questpieCrdtResourceTable)
		.innerJoin(
			questpieCrdtDefinitionTable,
			eq(
				questpieCrdtDefinitionTable.id,
				questpieCrdtResourceTable.definitionId,
			),
		)
		.where(eq(questpieCrdtResourceTable.id, resourceId));
	if (
		!definition ||
		(definition.ownerKind !== 1 && definition.ownerKind !== 2)
	) {
		throw rejected();
	}
	return definition;
}

async function resolveActiveTextField(
	db: CrdtDatabase,
	sessionId: string,
	active: NonNullable<CrdtClientAwarenessEnvelopeV1["active"]>,
) {
	const [field] = await db
		.select({
			stableFieldId: questpieCrdtSessionGrantTable.stableFieldId,
			format: questpieCrdtBindingTable.format,
		})
		.from(questpieCrdtSessionGrantTable)
		.innerJoin(
			questpieCrdtBindingTable,
			and(
				eq(
					questpieCrdtBindingTable.id,
					questpieCrdtSessionGrantTable.bindingId,
				),
				eq(
					questpieCrdtBindingTable.fieldEpoch,
					questpieCrdtSessionGrantTable.fieldEpoch,
				),
			),
		)
		.where(
			and(
				eq(questpieCrdtSessionGrantTable.sessionId, sessionId),
				eq(questpieCrdtSessionGrantTable.fieldSlot, active.fieldSlot),
			),
		);
	if (!field || field.format !== 1) throw rejected();
	return {
		stableFieldId: field.stableFieldId,
		cursor: active.cursor,
		selectionEnd: active.selectionEnd,
	};
}

async function consumeAwarenessToken(
	db: CrdtDatabase,
	sessionId: string,
): Promise<void> {
	const available = sql<bigint>`LEAST(${AWARENESS_BURST}, ${questpieCrdtSessionTable.awarenessTokens} + FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - ${questpieCrdtSessionTable.awarenessRefilledAt})) * ${AWARENESS_RATE})::bigint)`;
	const [budget] = await db
		.update(questpieCrdtSessionTable)
		.set({
			awarenessTokens: sql`${available} - 1`,
			awarenessRefilledAt: sql`${questpieCrdtSessionTable.awarenessRefilledAt} + (FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - ${questpieCrdtSessionTable.awarenessRefilledAt})) * ${AWARENESS_RATE}) / ${AWARENESS_RATE}) * interval '1 second'`,
		})
		.where(
			and(eq(questpieCrdtSessionTable.id, sessionId), sql`${available} >= 1`),
		)
		.returning({ id: questpieCrdtSessionTable.id });
	if (!budget) throw rejected();
}

async function consumeRosterToken(
	db: CrdtDatabase,
	sessionId: string,
): Promise<void> {
	const available = sql<bigint>`LEAST(${ROSTER_BURST}, ${questpieCrdtSessionTable.rosterTokens} + FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - ${questpieCrdtSessionTable.rosterRefilledAt})) * ${ROSTER_RATE})::bigint)`;
	const [budget] = await db
		.update(questpieCrdtSessionTable)
		.set({
			rosterTokens: sql`${available} - 1`,
			rosterRefilledAt: sql`${questpieCrdtSessionTable.rosterRefilledAt} + (FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - ${questpieCrdtSessionTable.rosterRefilledAt})) * ${ROSTER_RATE}) / ${ROSTER_RATE}) * interval '1 second'`,
		})
		.where(
			and(eq(questpieCrdtSessionTable.id, sessionId), sql`${available} >= 1`),
		)
		.returning({ id: questpieCrdtSessionTable.id });
	if (!budget) throw rejected();
}

async function publishChangeBestEffort(
	publishChange:
		| ((input: {
				resourceId: string;
				resourceEpochId: string;
		  }) => void | Promise<void>)
		| undefined,
	change: { resourceId: string; resourceEpochId: string },
): Promise<void> {
	try {
		await publishChange?.(change);
	} catch {
		// Realtime is only a lossy wake-up hint; durable presence already committed.
	}
}

async function readFreshRosterGrants(
	db: CrdtDatabase,
	sessionIds: readonly string[],
) {
	if (sessionIds.length === 0) return [];
	return db
		.select({
			sessionId: questpieCrdtSessionGrantTable.sessionId,
			resourceId: questpieCrdtSessionTable.resourceId,
			stableFieldId: questpieCrdtSessionGrantTable.stableFieldId,
			fieldSlot: questpieCrdtSessionGrantTable.fieldSlot,
		})
		.from(questpieCrdtSessionGrantTable)
		.innerJoin(
			questpieCrdtSessionTable,
			eq(questpieCrdtSessionTable.id, questpieCrdtSessionGrantTable.sessionId),
		)
		.innerJoin(questpieCrdtResourceTable, freshRosterResourceCondition())
		.innerJoin(aggregateSubjectFence, freshRosterAggregateSubjectCondition())
		.innerJoin(questpieCrdtBindingTable, freshRosterBindingCondition())
		.innerJoin(fieldSubjectFence, freshRosterFieldSubjectCondition())
		.where(
			and(
				inArray(questpieCrdtSessionTable.id, sessionIds),
				isNull(questpieCrdtSessionTable.closedAt),
				gt(questpieCrdtSessionTable.leaseExpiresAt, sql`clock_timestamp()`),
				gt(questpieCrdtSessionTable.authorityExpiresAt, sql`clock_timestamp()`),
			),
		)
		.orderBy(
			asc(questpieCrdtSessionTable.id),
			asc(questpieCrdtSessionGrantTable.fieldSlot),
		);
}

function freshRosterResourceCondition() {
	return and(
		eq(questpieCrdtResourceTable.id, questpieCrdtSessionTable.resourceId),
		eq(
			questpieCrdtResourceTable.incarnationKey,
			questpieCrdtSessionTable.resourceIncarnationKey,
		),
		eq(
			questpieCrdtResourceTable.currentEpochId,
			questpieCrdtSessionTable.resourceEpochId,
		),
		eq(
			questpieCrdtResourceTable.readFence,
			questpieCrdtSessionTable.resourceReadFence,
		),
		eq(
			questpieCrdtResourceTable.editFence,
			questpieCrdtSessionTable.resourceEditFence,
		),
		eq(
			questpieCrdtResourceTable.ownerPolicyRevision,
			questpieCrdtSessionTable.ownerPolicyRevision,
		),
		eq(
			questpieCrdtResourceTable.sessionGeneration,
			questpieCrdtSessionTable.generation,
		),
		eq(questpieCrdtResourceTable.status, 1),
		isNull(questpieCrdtResourceTable.retiredAt),
	);
}

function freshRosterAggregateSubjectCondition() {
	return and(
		eq(aggregateSubjectFence.resourceId, questpieCrdtSessionTable.resourceId),
		eq(aggregateSubjectFence.subjectId, questpieCrdtSessionTable.subjectId),
		eq(aggregateSubjectFence.scopeKind, 1),
		eq(aggregateSubjectFence.stableFieldId, ZERO_UUID),
		eq(
			aggregateSubjectFence.readFence,
			questpieCrdtSessionTable.subjectReadFence,
		),
		eq(
			aggregateSubjectFence.editFence,
			questpieCrdtSessionTable.subjectEditFence,
		),
	);
}

function freshRosterBindingCondition() {
	return and(
		eq(questpieCrdtBindingTable.id, questpieCrdtSessionGrantTable.bindingId),
		eq(
			questpieCrdtBindingTable.resourceId,
			questpieCrdtSessionGrantTable.resourceId,
		),
		eq(
			questpieCrdtBindingTable.schemaId,
			questpieCrdtSessionGrantTable.schemaId,
		),
		eq(
			questpieCrdtBindingTable.stableFieldId,
			questpieCrdtSessionGrantTable.stableFieldId,
		),
		eq(
			questpieCrdtBindingTable.fieldEpoch,
			questpieCrdtSessionGrantTable.fieldEpoch,
		),
		eq(
			questpieCrdtBindingTable.fieldSlot,
			questpieCrdtSessionGrantTable.fieldSlot,
		),
		eq(
			questpieCrdtBindingTable.formatVersion,
			questpieCrdtSessionGrantTable.formatVersion,
		),
		eq(
			questpieCrdtBindingTable.readFence,
			questpieCrdtSessionGrantTable.fieldReadFence,
		),
		eq(
			questpieCrdtBindingTable.editFence,
			questpieCrdtSessionGrantTable.fieldEditFence,
		),
		inArray(questpieCrdtBindingTable.status, [1, 3]),
		isNull(questpieCrdtBindingTable.retiredAt),
	);
}

function freshRosterFieldSubjectCondition() {
	return and(
		eq(fieldSubjectFence.resourceId, questpieCrdtSessionTable.resourceId),
		eq(fieldSubjectFence.subjectId, questpieCrdtSessionTable.subjectId),
		eq(fieldSubjectFence.scopeKind, 2),
		eq(
			fieldSubjectFence.stableFieldId,
			questpieCrdtSessionGrantTable.stableFieldId,
		),
		eq(
			fieldSubjectFence.readFence,
			questpieCrdtSessionGrantTable.subjectFieldReadFence,
		),
		eq(
			fieldSubjectFence.editFence,
			questpieCrdtSessionGrantTable.subjectFieldEditFence,
		),
	);
}

async function projectRosterPages(
	db: CrdtDatabase,
	recipientSessionId: string,
	participantSecret: Uint8Array,
): Promise<readonly CrdtRosterPageV1[]> {
	const recipientGrants = await readFreshRosterGrants(db, [recipientSessionId]);
	const recipient = recipientGrants[0];
	if (!recipient) throw rejected();
	const recipientSlots = new Map(
		recipientGrants.map((grant) => [grant.stableFieldId, grant.fieldSlot]),
	);
	if (recipientSlots.size === 0) return createCrdtRosterPagesV1([]);

	const awareness = await db
		.selectDistinct({
			sessionId: questpieCrdtAwarenessTable.sessionId,
			subjectId: questpieCrdtSessionTable.subjectId,
			activeStableFieldId: questpieCrdtAwarenessTable.activeStableFieldId,
			value: questpieCrdtAwarenessTable.value,
			expiresAt: questpieCrdtAwarenessTable.expiresAt,
		})
		.from(questpieCrdtAwarenessTable)
		.innerJoin(
			questpieCrdtSessionTable,
			eq(questpieCrdtSessionTable.id, questpieCrdtAwarenessTable.sessionId),
		)
		.innerJoin(questpieCrdtResourceTable, freshRosterResourceCondition())
		.innerJoin(aggregateSubjectFence, freshRosterAggregateSubjectCondition())
		.innerJoin(
			questpieCrdtSessionGrantTable,
			eq(questpieCrdtSessionGrantTable.sessionId, questpieCrdtSessionTable.id),
		)
		.innerJoin(questpieCrdtBindingTable, freshRosterBindingCondition())
		.innerJoin(fieldSubjectFence, freshRosterFieldSubjectCondition())
		.where(
			and(
				eq(questpieCrdtSessionTable.resourceId, recipient.resourceId),
				isNull(questpieCrdtSessionTable.closedAt),
				gt(questpieCrdtSessionTable.leaseExpiresAt, sql`clock_timestamp()`),
				gt(questpieCrdtSessionTable.authorityExpiresAt, sql`clock_timestamp()`),
				gt(questpieCrdtAwarenessTable.expiresAt, sql`clock_timestamp()`),
			),
		)
		.orderBy(asc(questpieCrdtAwarenessTable.sessionId))
		.limit(MAX_RESOURCE_SESSIONS + 1);
	if (awareness.length > MAX_RESOURCE_SESSIONS) throw rejected();
	if (awareness.length === 0) return createCrdtRosterPagesV1([]);

	const grants = await readFreshRosterGrants(
		db,
		awareness.map((entry) => entry.sessionId),
	);
	const sharedBySession = new Map<string, Set<string>>();
	for (const grant of grants) {
		if (!recipientSlots.has(grant.stableFieldId)) continue;
		const shared = sharedBySession.get(grant.sessionId) ?? new Set<string>();
		shared.add(grant.stableFieldId);
		sharedBySession.set(grant.sessionId, shared);
	}

	const participants = new Map<string, CrdtRosterSessionV1[]>();
	for (const entry of awareness) {
		const shared = sharedBySession.get(entry.sessionId);
		if (!shared || shared.size === 0) continue;
		const stored = parseStoredAwareness(entry.value);
		const activeSlot =
			entry.activeStableFieldId &&
			shared.has(entry.activeStableFieldId) &&
			recipientSlots.get(entry.activeStableFieldId);
		const participantId = participantPseudonym(
			participantSecret,
			recipient.resourceId,
			entry.subjectId,
		);
		const sessions = participants.get(participantId) ?? [];
		if (sessions.length >= MAX_PARTICIPANT_SESSIONS) throw rejected();
		sessions.push({
			sessionId: entry.sessionId,
			...(activeSlot
				? {
						active: {
							fieldSlot: activeSlot,
							...(stored.active?.cursor
								? { cursor: stored.active.cursor }
								: {}),
							...(stored.active?.selectionEnd
								? { selectionEnd: stored.active.selectionEnd }
								: {}),
						},
					}
				: {}),
			value: stored.value,
			expiresAtMs: entry.expiresAt.getTime(),
		});
		participants.set(participantId, sessions);
	}
	return createCrdtRosterPagesV1(
		[...participants.entries()]
			.sort(([left], [right]) => compareAscii(left, right))
			.map(([participantId, sessions]) => ({
				participantId,
				sessions: sessions.sort((left, right) =>
					compareAscii(left.sessionId, right.sessionId),
				),
			})),
	);
}

export function createCrdtRosterPagesV1(
	participants: readonly CrdtRosterParticipantV1[],
): readonly CrdtRosterPageV1[] {
	const generation = createHash("sha256")
		.update(canonicalJson(participants))
		.digest("base64url");
	for (
		let expectedPageCount = 1;
		expectedPageCount <= MAX_ROSTER_PAGES;
		expectedPageCount++
	) {
		const pages: CrdtRosterParticipantV1[][] = [[]];
		for (const participant of participants) {
			for (const session of participant.sessions) {
				const current = pages.at(-1)!;
				const existing = current.find(
					(candidate) => candidate.participantId === participant.participantId,
				);
				const candidateParticipants = existing
					? current.map((candidate) =>
							candidate === existing
								? {
										...candidate,
										sessions: [...candidate.sessions, session],
									}
								: candidate,
						)
					: [
							...current,
							{ participantId: participant.participantId, sessions: [session] },
						];
				const candidate = {
					v: 1,
					kind: "roster-page",
					generation,
					pageIndex: pages.length - 1,
					pageCount: expectedPageCount,
					participants: candidateParticipants,
				} as const;
				if (jsonBytes(candidate) <= MAX_ROSTER_BYTES) {
					pages[pages.length - 1] = candidateParticipants;
					continue;
				}
				const single = {
					v: 1,
					kind: "roster-page",
					generation,
					pageIndex: pages.length,
					pageCount: expectedPageCount,
					participants: [
						{ participantId: participant.participantId, sessions: [session] },
					],
				} as const;
				if (jsonBytes(single) > MAX_ROSTER_BYTES) throw rejected();
				pages.push([
					{ participantId: participant.participantId, sessions: [session] },
				]);
			}
		}
		if (pages.length !== expectedPageCount) continue;
		const result = Object.freeze(
			pages.map((pageParticipants, pageIndex) =>
				Object.freeze({
					v: 1,
					kind: "roster-page",
					generation,
					pageIndex,
					pageCount: pages.length,
					participants: Object.freeze(pageParticipants),
				}),
			),
		);
		assertCrdtRosterPagesV1(result);
		return result;
	}
	throw rejected();
}

function parseClientAwarenessEnvelope(
	value: unknown,
): CrdtClientAwarenessEnvelopeV1 | CrdtClientAwarenessClearEnvelopeV1 {
	if (
		isExactObject(value, ["v", "kind"], []) &&
		value.v === 1 &&
		value.kind === "awareness-clear"
	) {
		return { v: 1, kind: "awareness-clear" };
	}
	if (!isExactObject(value, ["v", "kind", "value"], ["active"])) {
		throw rejected();
	}
	if (value.v !== 1 || value.kind !== "awareness") throw rejected();
	assertNoReservedAwarenessKeys(value.value);
	assertJsonValue(value.value);
	if (jsonBytes(value.value) > MAX_AWARENESS_PROFILE_BYTES) throw rejected();
	let active: CrdtClientAwarenessEnvelopeV1["active"];
	if (value.active !== undefined) {
		const rawActive = value.active;
		if (
			!isExactObject(rawActive, ["fieldSlot"], ["cursor", "selectionEnd"]) ||
			typeof rawActive.fieldSlot !== "number" ||
			!Number.isInteger(rawActive.fieldSlot) ||
			rawActive.fieldSlot < 1 ||
			rawActive.fieldSlot > 0xffff
		) {
			throw rejected();
		}
		const cursor = parsePosition(rawActive.cursor);
		const selectionEnd = parsePosition(rawActive.selectionEnd);
		active = {
			fieldSlot: rawActive.fieldSlot,
			...(cursor ? { cursor } : {}),
			...(selectionEnd ? { selectionEnd } : {}),
		};
	}
	return {
		v: 1,
		kind: "awareness",
		value: value.value,
		...(active ? { active } : {}),
	};
}

function assertNoReservedAwarenessKeys(value: unknown): void {
	if (
		value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		["activeField", "cursor", "selectionEnd"].some((key) =>
			Object.hasOwn(value as object, key),
		)
	) {
		throw rejected();
	}
}

function parseStoredAwareness(value: unknown): {
	value: unknown;
	active?: { cursor?: string; selectionEnd?: string };
} {
	if (!isExactObject(value, ["v", "kind", "value"], ["active"])) {
		throw rejected();
	}
	if (value.v !== 1 || value.kind !== "awareness") throw rejected();
	assertJsonValue(value.value);
	if (value.active === undefined) return { value: value.value };
	if (!isExactObject(value.active, [], ["cursor", "selectionEnd"])) {
		throw rejected();
	}
	return {
		value: value.value,
		active: {
			...(parsePosition(value.active.cursor)
				? { cursor: value.active.cursor as string }
				: {}),
			...(parsePosition(value.active.selectionEnd)
				? { selectionEnd: value.active.selectionEnd as string }
				: {}),
		},
	};
}

function parsePosition(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		!/^[A-Za-z0-9_-]+$/.test(value)
	) {
		throw rejected();
	}
	const bytes = Buffer.from(value, "base64url");
	if (
		bytes.byteLength === 0 ||
		bytes.byteLength > MAX_POSITION_BYTES ||
		bytes.toString("base64url") !== value
	) {
		throw rejected();
	}
	return value;
}

function participantPseudonym(
	secret: Uint8Array,
	resourceId: string,
	subjectId: string,
): string {
	return createHmac("sha256", secret)
		.update("questpie-crdt-participant-v1\0")
		.update(resourceId)
		.update("\0")
		.update(subjectId)
		.digest()
		.subarray(0, 16)
		.toString("base64url");
}

function assertJsonValue(value: unknown): void {
	let count = 0;
	const visit = (candidate: unknown, depth: number): void => {
		count++;
		if (count > MAX_AWARENESS_VALUES || depth > MAX_AWARENESS_DEPTH) {
			throw rejected();
		}
		if (
			candidate === null ||
			typeof candidate === "boolean" ||
			typeof candidate === "string"
		) {
			return;
		}
		if (typeof candidate === "number") {
			if (!Number.isFinite(candidate)) throw rejected();
			return;
		}
		if (Array.isArray(candidate)) {
			for (let index = 0; index < candidate.length; index++) {
				if (!Object.hasOwn(candidate, index)) throw rejected();
				visit(candidate[index], depth + 1);
			}
			return;
		}
		if (
			typeof candidate !== "object" ||
			Object.getPrototypeOf(candidate) !== Object.prototype
		) {
			throw rejected();
		}
		for (const [key, child] of Object.entries(candidate)) {
			if (hasUnpairedSurrogate(key) || child === undefined) throw rejected();
			visit(child, depth + 1);
		}
	};
	visit(value, 0);
	canonicalJson(value);
}

function isExactObject(
	value: unknown,
	required: readonly string[],
	optional: readonly string[],
): value is Record<string, unknown> {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Object.prototype
	) {
		return false;
	}
	const keys = Object.keys(value);
	return (
		required.every((key) => keys.includes(key)) &&
		keys.every((key) => required.includes(key) || optional.includes(key))
	);
}

function jsonBytes(value: unknown): number {
	return new TextEncoder().encode(canonicalJson(value)).byteLength;
}

function canonicalJson(value: unknown): string {
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "number" ||
		typeof value === "string"
	) {
		if (typeof value === "string" && hasUnpairedSurrogate(value)) {
			throw rejected();
		}
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map(canonicalJson).join(",")}]`;
	}
	if (typeof value !== "object" || value === null) throw rejected();
	const object = value as Record<string, unknown>;
	return `{${Object.keys(object)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
		.join(",")}}`;
}

function hasUnpairedSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(++index);
			if (next < 0xdc00 || next > 0xdfff) return true;
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			return true;
		}
	}
	return false;
}

function compareAscii(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function rejected(): CrdtPresenceRejectedError {
	return new CrdtPresenceRejectedError();
}
