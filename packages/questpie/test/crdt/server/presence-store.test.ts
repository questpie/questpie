import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";

import type { CrdtAuthorizationSnapshot } from "../../../src/server/modules/core/integrated/crdt/authorization.js";
import { createCrdtOpenSessionStore } from "../../../src/server/modules/core/integrated/crdt/open-store.js";
import {
	createCrdtDatabasePresenceStore,
	CrdtPresenceRejectedError,
} from "../../../src/server/modules/core/integrated/crdt/presence-store.js";
import {
	questpieCrdtAwarenessTable,
	questpieCrdtBindingTable,
	questpieCrdtResourceEpochTable,
	questpieCrdtResourceTable,
	questpieCrdtSessionGrantTable,
	questpieCrdtSessionTable,
	questpieCrdtSubjectFenceTable,
	questpieCrdtSubjectTable,
	questpieCrdtTables,
} from "../../../src/server/modules/core/integrated/crdt/schema.js";
import {
	inspectCrdtExchangeSession,
	validateCrdtExchangeAuthority,
} from "../../../src/server/modules/core/integrated/crdt/session-authority.js";
import { encodeCrdtExchangeFrameV1 } from "../../../src/shared/crdt-exchange.js";

const ID = {
	definition: "00000000-0000-4000-8000-000000000001",
	schema: "00000000-0000-4000-8000-000000000002",
	schemaField: "00000000-0000-4000-8000-000000000003",
	stableField: "00000000-0000-4000-8000-000000000004",
	hiddenSchemaField: "00000000-0000-4000-8000-000000000011",
	hiddenStableField: "00000000-0000-4000-8000-000000000012",
	hiddenBinding: "00000000-0000-4000-8000-000000000013",
	resource: "00000000-0000-4000-8000-000000000005",
	incarnation: "00000000-0000-4000-8000-000000000006",
	epoch: "00000000-0000-4000-8000-000000000007",
	binding: "00000000-0000-4000-8000-000000000008",
	subject: "00000000-0000-4000-8000-000000000009",
} as const;

const CREDENTIAL_FINGERPRINT = bytes(0x71);

describe("CRDT durable presence store", () => {
	let ddl: string[];
	let client: PGlite;
	let db: ReturnType<typeof drizzle<typeof questpieCrdtTables>>;

	beforeAll(async () => {
		const { generateDrizzleJson, generateMigration } =
			await import("drizzle-kit/api-postgres");
		const empty = {
			id: "00000000-0000-0000-0000-000000000000",
			dialect: "postgres" as const,
			prevIds: [],
			version: "8" as const,
			ddl: [],
			renames: [],
		};
		const snapshot = await generateDrizzleJson(questpieCrdtTables, empty.id);
		ddl = await generateMigration(empty, snapshot);
	});

	beforeEach(async () => {
		client = await PGlite.create();
		db = drizzle(client, { schema: questpieCrdtTables });
		for (const statement of ddl) {
			if (statement.trim()) await db.execute(sql.raw(statement));
		}
		await seedResource(db);
	});

	afterEach(async () => {
		await client?.close();
	});

	it("projects schema-validated awareness from a live lease with a server-owned participant identity", async () => {
		const admission = createTestSessionAdmission(db);
		const issued = await admission.prepare(authorization());
		const redeemed = await admission.open({
			prepared: issued.authorization,
			authorization: authorization(),
		});
		const presence = createCrdtDatabasePresenceStore(db, {
			participantSecret: "p".repeat(32),
			isAwarenessEnabled: () => true,
			parseAwareness: ({ ownerKind, ownerKey, value }) => {
				expect(ownerKind).toBe("collection");
				expect(ownerKey).toBe("articles");
				if (
					typeof value !== "object" ||
					value === null ||
					(value as { name?: unknown }).name !== "Ada"
				) {
					throw new Error("invalid awareness");
				}
				return value;
			},
		});

		await presence.writeAwareness(redeemed.sessionId, {
			v: 1,
			kind: "awareness",
			value: { name: "Ada" },
			active: {
				fieldSlot: 1,
				cursor: "AQ",
				selectionEnd: "Ag",
			},
		});

		const roster = await presence.projectRoster(redeemed.sessionId);
		expect(roster).toEqual([
			{
				v: 1,
				kind: "roster-page",
				generation: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
				pageIndex: 0,
				pageCount: 1,
				participants: [
					{
						participantId: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
						sessions: [
							{
								sessionId: redeemed.sessionId,
								active: {
									fieldSlot: 1,
									cursor: "AQ",
									selectionEnd: "Ag",
								},
								value: { name: "Ada" },
								expiresAtMs: expect.any(Number),
							},
						],
					},
				],
			},
		]);
	});

	it("clears awareness with the exact versioned envelope while keeping the lease alive", async () => {
		const admission = createTestSessionAdmission(db);
		const issued = await admission.prepare(authorization());
		const redeemed = await admission.open({
			prepared: issued.authorization,
			authorization: authorization(),
		});
		const presence = createCrdtDatabasePresenceStore(db, {
			participantSecret: "p".repeat(32),
			isAwarenessEnabled: () => true,
			parseAwareness: ({ value }) => value,
		});
		await presence.writeAwareness(redeemed.sessionId, {
			v: 1,
			kind: "awareness",
			value: { name: "Ada" },
		});

		const pages = await presence.writeAwareness(redeemed.sessionId, {
			v: 1,
			kind: "awareness-clear",
		});

		expect(pages).toEqual([
			{
				v: 1,
				kind: "roster-page",
				generation: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
				pageIndex: 0,
				pageCount: 1,
				participants: [],
			},
		]);
	});

	it("rejects even an awareness clear when the owner has no awareness schema", async () => {
		const admission = createTestSessionAdmission(db);
		const issued = await admission.prepare(authorization());
		const redeemed = await admission.open({
			prepared: issued.authorization,
			authorization: authorization(),
		});
		const presence = createCrdtDatabasePresenceStore(db, {
			participantSecret: "p".repeat(32),
			isAwarenessEnabled: () => false,
			parseAwareness: () => {
				throw new Error("must not parse disabled awareness");
			},
		});

		await expect(
			presence.writeAwareness(redeemed.sessionId, {
				v: 1,
				kind: "awareness-clear",
			}),
		).rejects.toBeInstanceOf(CrdtPresenceRejectedError);
		const [session] = await db
			.select({ tokens: questpieCrdtSessionTable.awarenessTokens })
			.from(questpieCrdtSessionTable)
			.where(eq(questpieCrdtSessionTable.id, redeemed.sessionId));
		expect(session?.tokens).toBe(20n);
	});

	it("rejects malformed, schema-invalid, hidden-field and noncanonical-position awareness without spending budget", async () => {
		const admission = createTestSessionAdmission(db);
		const issued = await admission.prepare(authorization());
		const redeemed = await admission.open({
			prepared: issued.authorization,
			authorization: authorization(),
		});
		const presence = createCrdtDatabasePresenceStore(db, {
			participantSecret: "p".repeat(32),
			isAwarenessEnabled: () => true,
			parseAwareness: ({ value }) => {
				if ((value as { ok?: unknown })?.ok !== true) {
					throw new Error("schema rejected");
				}
				return value;
			},
		});
		const invalid = [
			{ v: 1, kind: "awareness", value: { ok: true }, extra: true },
			{ v: 1, kind: "awareness", value: { ok: false } },
			{
				v: 1,
				kind: "awareness",
				value: { ok: true, activeField: "title" },
			},
			{
				v: 1,
				kind: "awareness",
				value: { ok: true },
				active: { fieldSlot: 2 },
			},
			{
				v: 1,
				kind: "awareness",
				value: { ok: true },
				active: { fieldSlot: 1, cursor: "AQ==" },
			},
		] as const;

		for (const value of invalid) {
			await expect(
				presence.writeAwareness(redeemed.sessionId, value),
			).rejects.toBeInstanceOf(CrdtPresenceRejectedError);
		}

		const [session] = await db
			.select({ tokens: questpieCrdtSessionTable.awarenessTokens })
			.from(questpieCrdtSessionTable)
			.where(eq(questpieCrdtSessionTable.id, redeemed.sessionId));
		expect(session?.tokens).toBe(20n);
		expect(await db.select().from(questpieCrdtAwarenessTable)).toEqual([]);
	});

	it("enforces the 20-per-second awareness bucket from database time", async () => {
		const admission = createTestSessionAdmission(db);
		const issued = await admission.prepare(authorization());
		const redeemed = await admission.open({
			prepared: issued.authorization,
			authorization: authorization(),
		});
		const presence = createCrdtDatabasePresenceStore(db, {
			participantSecret: "p".repeat(32),
			isAwarenessEnabled: () => true,
			parseAwareness: ({ value }) => value,
		});
		await db
			.update(questpieCrdtSessionTable)
			.set({
				awarenessTokens: 0n,
				awarenessRefilledAt: sql`clock_timestamp()`,
			})
			.where(eq(questpieCrdtSessionTable.id, redeemed.sessionId));

		await expect(
			presence.writeAwareness(redeemed.sessionId, {
				v: 1,
				kind: "awareness",
				value: { name: "Ada" },
			}),
		).rejects.toBeInstanceOf(CrdtPresenceRejectedError);

		await db
			.update(questpieCrdtSessionTable)
			.set({
				awarenessTokens: 0n,
				awarenessRefilledAt: sql`clock_timestamp() - interval '1 second'`,
			})
			.where(eq(questpieCrdtSessionTable.id, redeemed.sessionId));
		await presence.writeAwareness(redeemed.sessionId, {
			v: 1,
			kind: "awareness",
			value: { name: "Ada" },
		});
		const [session] = await db
			.select({ tokens: questpieCrdtSessionTable.awarenessTokens })
			.from(questpieCrdtSessionTable)
			.where(eq(questpieCrdtSessionTable.id, redeemed.sessionId));
		expect(session?.tokens).toBe(19n);
	});

	it("enforces the 20-per-second roster-read bucket from database time", async () => {
		const admission = createTestSessionAdmission(db);
		const issued = await admission.prepare(authorization());
		const redeemed = await admission.open({
			prepared: issued.authorization,
			authorization: authorization(),
		});
		const presence = createCrdtDatabasePresenceStore(db, {
			participantSecret: "p".repeat(32),
			isAwarenessEnabled: () => true,
			parseAwareness: ({ value }) => value,
		});
		const [initialSession] = await db
			.select({ tokens: questpieCrdtSessionTable.rosterTokens })
			.from(questpieCrdtSessionTable)
			.where(eq(questpieCrdtSessionTable.id, redeemed.sessionId));
		expect(initialSession?.tokens).toBe(20n);
		await db
			.update(questpieCrdtSessionTable)
			.set({
				rosterTokens: 0n,
				rosterRefilledAt: sql`clock_timestamp()`,
			})
			.where(eq(questpieCrdtSessionTable.id, redeemed.sessionId));

		await expect(
			presence.projectRoster(redeemed.sessionId),
		).rejects.toBeInstanceOf(CrdtPresenceRejectedError);

		await db
			.update(questpieCrdtSessionTable)
			.set({
				rosterTokens: 0n,
				rosterRefilledAt: sql`clock_timestamp() - interval '1 second'`,
			})
			.where(eq(questpieCrdtSessionTable.id, redeemed.sessionId));
		await presence.projectRoster(redeemed.sessionId);
		const [session] = await db
			.select({ tokens: questpieCrdtSessionTable.rosterTokens })
			.from(questpieCrdtSessionTable)
			.where(eq(questpieCrdtSessionTable.id, redeemed.sessionId));
		expect(session?.tokens).toBe(19n);
	});

	it("returns the awareness roster captured before a failing best-effort broker hint", async () => {
		const admission = createTestSessionAdmission(db);
		const issued = await admission.prepare(authorization());
		const redeemed = await admission.open({
			prepared: issued.authorization,
			authorization: authorization(),
		});
		let publishAttempts = 0;
		const presence = createCrdtDatabasePresenceStore(db, {
			participantSecret: "p".repeat(32),
			isAwarenessEnabled: () => true,
			parseAwareness: ({ value }) => value,
			publishChange: async () => {
				publishAttempts++;
				await db
					.delete(questpieCrdtAwarenessTable)
					.where(eq(questpieCrdtAwarenessTable.sessionId, redeemed.sessionId));
				throw new Error("broker unavailable");
			},
		});

		const pages = await presence.writeAwareness(redeemed.sessionId, {
			v: 1,
			kind: "awareness",
			value: { name: "Ada" },
		});

		expect(publishAttempts).toBe(1);
		expect(pages[0]?.participants[0]?.sessions[0]).toMatchObject({
			sessionId: redeemed.sessionId,
			value: { name: "Ada" },
		});
		expect(await db.select().from(questpieCrdtAwarenessTable)).toEqual([]);
	});

	it("renews leases with a database-time heartbeat and removes awareness on close", async () => {
		const admission = createTestSessionAdmission(db);
		const issued = await admission.prepare(authorization());
		const redeemed = await admission.open({
			prepared: issued.authorization,
			authorization: authorization(),
		});
		const presence = createCrdtDatabasePresenceStore(db, {
			participantSecret: "p".repeat(32),
			isAwarenessEnabled: () => true,
			parseAwareness: ({ value }) => value,
		});
		await db
			.update(questpieCrdtSessionTable)
			.set({ leaseExpiresAt: sql`clock_timestamp() + interval '1 second'` })
			.where(eq(questpieCrdtSessionTable.id, redeemed.sessionId));

		const serverTime = await presence.heartbeat(redeemed.sessionId);
		expect(serverTime).toBeGreaterThan(0n);
		const [renewed] = await db
			.select({ leaseExpiresAt: questpieCrdtSessionTable.leaseExpiresAt })
			.from(questpieCrdtSessionTable)
			.where(eq(questpieCrdtSessionTable.id, redeemed.sessionId));
		expect(renewed!.leaseExpiresAt.getTime()).toBeGreaterThan(
			Number(serverTime) + 20_000,
		);

		await presence.writeAwareness(redeemed.sessionId, {
			v: 1,
			kind: "awareness",
			value: { name: "Ada" },
		});
		let publishAttempts = 0;
		const closingPresence = createCrdtDatabasePresenceStore(db, {
			participantSecret: "p".repeat(32),
			isAwarenessEnabled: () => true,
			parseAwareness: ({ value }) => value,
			publishChange: () => {
				publishAttempts++;
				throw new Error("broker unavailable");
			},
		});
		await closingPresence.close(redeemed.sessionId);
		const [firstClose] = await db
			.select({
				closedAt: questpieCrdtSessionTable.closedAt,
				leaseExpiresAt: questpieCrdtSessionTable.leaseExpiresAt,
				updatedAt: questpieCrdtSessionTable.updatedAt,
			})
			.from(questpieCrdtSessionTable)
			.where(eq(questpieCrdtSessionTable.id, redeemed.sessionId));
		await closingPresence.close(redeemed.sessionId);

		expect(await db.select().from(questpieCrdtAwarenessTable)).toEqual([]);
		const [closed] = await db
			.select({
				closedAt: questpieCrdtSessionTable.closedAt,
				closeReason: questpieCrdtSessionTable.closeReason,
				leaseExpiresAt: questpieCrdtSessionTable.leaseExpiresAt,
				updatedAt: questpieCrdtSessionTable.updatedAt,
			})
			.from(questpieCrdtSessionTable)
			.where(eq(questpieCrdtSessionTable.id, redeemed.sessionId));
		expect(closed?.closedAt).toBeInstanceOf(Date);
		expect(closed?.closeReason).toBe(1);
		expect(publishAttempts).toBe(1);
		expect(closed?.closedAt).toEqual(firstClose?.closedAt);
		expect(closed?.leaseExpiresAt).toEqual(firstClose?.leaseExpiresAt);
		expect(closed?.updatedAt).toEqual(firstClose?.updatedAt);
		await expect(presence.heartbeat(redeemed.sessionId)).rejects.toBeInstanceOf(
			CrdtPresenceRejectedError,
		);
	});

	it("keeps generic exchange authority valid across later content heads", async () => {
		const snapshot = authorization();
		const admission = createTestSessionAdmission(db);
		const issued = await admission.prepare(snapshot);
		const redeemed = await admission.open({
			prepared: issued.authorization,
			authorization: snapshot,
		});
		const [session] = await db
			.select({
				bindingId: questpieCrdtSessionTable.bindingId,
				generation: questpieCrdtSessionTable.generation,
				deliveryGeneration: questpieCrdtSessionTable.deliveryGeneration,
			})
			.from(questpieCrdtSessionTable)
			.where(eq(questpieCrdtSessionTable.id, redeemed.sessionId));
		const claim = await inspectCrdtExchangeSession(db, {
			bindingId: session!.bindingId,
			sessionGeneration: session!.generation,
			deliveryGeneration: session!.deliveryGeneration,
		});

		await db
			.update(questpieCrdtResourceEpochTable)
			.set({
				headCommitSeq: sql`${questpieCrdtResourceEpochTable.headCommitSeq} + 1`,
			})
			.where(eq(questpieCrdtResourceEpochTable.id, ID.epoch));
		await db
			.update(questpieCrdtBindingTable)
			.set({
				headFieldCursor: sql`${questpieCrdtBindingTable.headFieldCursor} + 1`,
			})
			.where(eq(questpieCrdtBindingTable.id, ID.binding));

		await expect(
			validateCrdtExchangeAuthority(db, claim, snapshot),
		).resolves.toBeUndefined();
	});

	it("drops a peer immediately when its resource fence is stale", async () => {
		const admission = createTestSessionAdmission(db);
		const peerAuthorization = authorization({
			credentialFingerprint: bytes(0x74),
		});
		const peerIssued = await admission.prepare(peerAuthorization);
		const peer = await admission.open({
			prepared: peerIssued.authorization,
			authorization: peerAuthorization,
		});
		const presence = createCrdtDatabasePresenceStore(db, {
			participantSecret: "p".repeat(32),
			isAwarenessEnabled: () => true,
			parseAwareness: ({ value }) => value,
		});
		await presence.writeAwareness(peer.sessionId, {
			v: 1,
			kind: "awareness",
			value: { name: "Grace" },
		});
		await db
			.update(questpieCrdtResourceTable)
			.set({ readFence: 1n })
			.where(eq(questpieCrdtResourceTable.id, ID.resource));
		const recipientAuthorization = authorization({
			credentialFingerprint: bytes(0x75),
			resourceReadFence: 1n,
		});
		const recipientIssued = await admission.prepare(recipientAuthorization);
		const recipient = await admission.open({
			prepared: recipientIssued.authorization,
			authorization: recipientAuthorization,
		});

		expect(await presence.projectRoster(recipient.sessionId)).toEqual([
			expect.objectContaining({ participants: [] }),
		]);
	});

	it("drops a peer immediately when its subject fence is stale", async () => {
		const otherSubject = "00000000-0000-4000-8000-000000000099";
		await db.execute(sql`
			INSERT INTO questpie_crdt_subject
				(id, kind, issuer_key, subject_key, subject_hash)
			VALUES (${otherSubject}, 1, '', 'user-2', decode(repeat('25', 32), 'hex'))
		`);
		const admission = createTestSessionAdmission(db);
		const peerAuthorization = authorization({
			subjectId: otherSubject,
			credentialFingerprint: bytes(0x76),
		});
		const peerIssued = await admission.prepare(peerAuthorization);
		const peer = await admission.open({
			prepared: peerIssued.authorization,
			authorization: peerAuthorization,
		});
		const presence = createCrdtDatabasePresenceStore(db, {
			participantSecret: "p".repeat(32),
			isAwarenessEnabled: () => true,
			parseAwareness: ({ value }) => value,
		});
		await presence.writeAwareness(peer.sessionId, {
			v: 1,
			kind: "awareness",
			value: { name: "Grace" },
		});
		await db
			.update(questpieCrdtSubjectFenceTable)
			.set({ readFence: 1n })
			.where(
				and(
					eq(questpieCrdtSubjectFenceTable.subjectId, otherSubject),
					eq(questpieCrdtSubjectFenceTable.scopeKind, 1),
				),
			);
		const recipientAuthorization = authorization({
			credentialFingerprint: bytes(0x77),
		});
		const recipientIssued = await admission.prepare(recipientAuthorization);
		const recipient = await admission.open({
			prepared: recipientIssued.authorization,
			authorization: recipientAuthorization,
		});

		expect(await presence.projectRoster(recipient.sessionId)).toEqual([
			expect.objectContaining({ participants: [] }),
		]);
	});

	it("drops a peer immediately when its field fence is stale", async () => {
		const admission = createTestSessionAdmission(db);
		const peerAuthorization = authorization({
			credentialFingerprint: bytes(0x78),
		});
		const peerIssued = await admission.prepare(peerAuthorization);
		const peer = await admission.open({
			prepared: peerIssued.authorization,
			authorization: peerAuthorization,
		});
		const presence = createCrdtDatabasePresenceStore(db, {
			participantSecret: "p".repeat(32),
			isAwarenessEnabled: () => true,
			parseAwareness: ({ value }) => value,
		});
		await presence.writeAwareness(peer.sessionId, {
			v: 1,
			kind: "awareness",
			value: { name: "Grace" },
		});
		await db
			.update(questpieCrdtBindingTable)
			.set({ readFence: 1n })
			.where(eq(questpieCrdtBindingTable.id, ID.binding));
		const recipientAuthorization = withBindingCut(
			authorization({ credentialFingerprint: bytes(0x79) }),
			{ fieldReadFence: 1n },
		);
		const recipientIssued = await admission.prepare(recipientAuthorization);
		const recipient = await admission.open({
			prepared: recipientIssued.authorization,
			authorization: recipientAuthorization,
		});

		expect(await presence.projectRoster(recipient.sessionId)).toEqual([
			expect.objectContaining({ participants: [] }),
		]);
	});

	it("groups same-subject tabs and drops a participant after its last shared readable grant is revoked", async () => {
		const otherSubject = "00000000-0000-4000-8000-000000000099";
		await db.execute(sql`
			INSERT INTO questpie_crdt_subject
				(id, kind, issuer_key, subject_key, subject_hash)
			VALUES (${otherSubject}, 1, '', 'user-2', decode(repeat('25', 32), 'hex'))
		`);
		const admission = createTestSessionAdmission(db);
		const open = async (snapshot: CrdtAuthorizationSnapshot) => {
			const issued = await admission.prepare(snapshot);
			return admission.open({
				prepared: issued.authorization,
				authorization: snapshot,
			});
		};
		const first = await open(authorization());
		const second = await open(
			authorization({ credentialFingerprint: bytes(0x72) }),
		);
		const otherAuthorization = authorization({
			subjectId: otherSubject,
			credentialFingerprint: bytes(0x73),
		});
		const other = await open(otherAuthorization);
		const presence = createCrdtDatabasePresenceStore(db, {
			participantSecret: "p".repeat(32),
			isAwarenessEnabled: () => true,
			parseAwareness: ({ value }) => value,
		});
		for (const [sessionId, name] of [
			[first.sessionId, "Ada"],
			[second.sessionId, "Ada mobile"],
			[other.sessionId, "Grace"],
		] as const) {
			await presence.writeAwareness(sessionId, {
				v: 1,
				kind: "awareness",
				value: { name },
			});
		}

		const before = await presence.projectRoster(first.sessionId);
		expect(
			before[0]?.participants.map((entry) => entry.sessions.length).sort(),
		).toEqual([1, 2]);

		await db
			.delete(questpieCrdtSessionGrantTable)
			.where(eq(questpieCrdtSessionGrantTable.sessionId, other.sessionId));
		const after = await presence.projectRoster(first.sessionId);
		expect(after[0]?.participants).toHaveLength(1);
		expect(
			after[0]?.participants[0]?.sessions
				.map(({ sessionId }) => sessionId)
				.sort(),
		).toEqual([first.sessionId, second.sessionId].sort());
	});

	it("reprojects an expired 30-second awareness lease without a final client message", async () => {
		const admission = createTestSessionAdmission(db);
		const open = async (fingerprint: Uint8Array) => {
			const snapshot = authorization({ credentialFingerprint: fingerprint });
			const issued = await admission.prepare(snapshot);
			return admission.open({
				prepared: issued.authorization,
				authorization: snapshot,
			});
		};
		const recipient = await open(bytes(0x74));
		const peer = await open(bytes(0x75));
		const presence = createCrdtDatabasePresenceStore(db, {
			participantSecret: "p".repeat(32),
			isAwarenessEnabled: () => true,
			parseAwareness: ({ value }) => value,
		});
		await presence.writeAwareness(peer.sessionId, {
			v: 1,
			kind: "awareness",
			value: { name: "Grace" },
		});
		expect(
			(await presence.projectRoster(recipient.sessionId))[0]?.participants,
		).toHaveLength(1);

		await db
			.update(questpieCrdtAwarenessTable)
			.set({ expiresAt: sql`clock_timestamp() - interval '1 millisecond'` })
			.where(eq(questpieCrdtAwarenessTable.sessionId, peer.sessionId));

		expect(await presence.projectRoster(recipient.sessionId)).toEqual([
			{
				v: 1,
				kind: "roster-page",
				generation: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
				pageIndex: 0,
				pageCount: 1,
				participants: [],
			},
		]);
	});

	it("paginates the complete authorized roster by encoded QPCX bytes", async () => {
		const subjectIds = Array.from(
			{ length: 8 },
			(_, index) =>
				`00000000-0000-4000-8000-${(100 + index).toString().padStart(12, "0")}`,
		);
		await db.insert(questpieCrdtSubjectTable).values(
			subjectIds.slice(1).map((id, index) => ({
				id,
				kind: 1,
				issuerKey: "",
				subjectKey: `paged-user-${index + 1}`,
				subjectHash: Buffer.alloc(32, 0x30 + index),
			})),
		);
		const admission = createTestSessionAdmission(db);
		const sessions: string[] = [];
		for (const [index, subjectId] of subjectIds.entries()) {
			const snapshot = authorization({
				subjectId: index === 0 ? ID.subject : subjectId,
				credentialFingerprint: bytes(0x40 + index),
			});
			const issued = await admission.prepare(snapshot);
			sessions.push(
				(
					await admission.open({
						prepared: issued.authorization,
						authorization: snapshot,
					})
				).sessionId,
			);
		}
		const presence = createCrdtDatabasePresenceStore(db, {
			participantSecret: "p".repeat(32),
			isAwarenessEnabled: () => true,
			parseAwareness: ({ value }) => value,
		});
		for (const [index, sessionId] of sessions.entries()) {
			await presence.writeAwareness(sessionId, {
				v: 1,
				kind: "awareness",
				value: { bio: `${index}:${"x".repeat(400)}` },
			});
		}

		const pages = await presence.projectRoster(sessions[0]!);
		expect(pages.length).toBeGreaterThan(1);
		expect(pages.length).toBeLessThanOrEqual(16);
		expect(new Set(pages.map(({ generation }) => generation)).size).toBe(1);
		expect(
			pages.flatMap(({ participants }) =>
				participants.flatMap(({ sessions }) => sessions),
			),
		).toHaveLength(8);
		for (const [pageIndex, page] of pages.entries()) {
			expect(page.pageIndex).toBe(pageIndex);
			expect(page.pageCount).toBe(pages.length);
			expect(
				encodeCrdtExchangeFrameV1({
					major: 1,
					minor: 0,
					opcode: 0x84,
					requestId: new Uint8Array(16).fill(pageIndex + 1),
					payload: { value: page },
				}).byteLength,
			).toBeLessThanOrEqual(32 + 4 + 1024);
		}
	});
});

function createTestSessionAdmission(
	db: ReturnType<typeof drizzle<typeof questpieCrdtTables>>,
) {
	const store = createCrdtOpenSessionStore(db);
	let ownerGeneration = 0n;
	return {
		async prepare(authorization: CrdtAuthorizationSnapshot) {
			return { authorization };
		},
		async open(input: {
			prepared: CrdtAuthorizationSnapshot;
			authorization: CrdtAuthorizationSnapshot;
		}) {
			ownerGeneration++;
			return store.open({
				openId: randomUUID(),
				authorization: input.authorization,
				actorKind: 1,
				edge: {
					sessionKey: new Uint8Array(32).fill(
						Number(ownerGeneration % 251n) + 1,
					),
					ownerGeneration,
				},
			});
		},
	};
}

function authorization(
	overrides: Partial<CrdtAuthorizationSnapshot> = {},
): CrdtAuthorizationSnapshot {
	return {
		resourceId: ID.resource,
		resourceEpochId: ID.epoch,
		definitionId: ID.definition,
		schemaId: ID.schema,
		incarnationKey: ID.incarnation,
		subjectId: ID.subject,
		credentialFingerprint: CREDENTIAL_FINGERPRINT,
		audience: "questpie-test",
		origin: "https://app.example",
		requestedMode: "edit",
		effectiveMode: "edit",
		resourceReadFence: 0n,
		resourceEditFence: 0n,
		subjectReadFence: 0n,
		subjectEditFence: 0n,
		ownerPolicyRevision: 0n,
		sessionGeneration: 0n,
		authorityExpiresAt: new Date(Date.now() + 60_000),
		headCommitSeq: 0n,
		offlineSubjectKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		clientManifest: {
			schemaVersion: 1,
			schemaFingerprint: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA",
			awarenessEnabled: true,
			fields: {
				title: {
					fieldSlot: 1,
					format: "text",
					formatVersion: 1,
					engineId: "test-text",
					grant: "edit",
				},
			},
		},
		bindings: [
			{
				bindingId: ID.binding,
				stableFieldId: ID.stableField,
				fieldEpoch: 0n,
				fieldSlot: 1,
				formatVersion: 1,
				headFieldCursor: 0n,
				fieldReadFence: 0n,
				fieldEditFence: 0n,
			},
		],
		grants: [
			{
				bindingId: ID.binding,
				stableFieldId: ID.stableField,
				fieldEpoch: 0n,
				fieldSlot: 1,
				formatVersion: 1,
				grant: "edit",
				headFieldCursor: 0n,
				fieldReadFence: 0n,
				fieldEditFence: 0n,
				subjectFieldReadFence: 0n,
				subjectFieldEditFence: 0n,
			},
		],
		...overrides,
	};
}

function withBindingCut(
	snapshot: CrdtAuthorizationSnapshot,
	overrides: Partial<CrdtAuthorizationSnapshot["bindings"][number]>,
): CrdtAuthorizationSnapshot {
	return {
		...snapshot,
		bindings: snapshot.bindings.map((binding) => ({
			...binding,
			...overrides,
		})),
		grants: snapshot.grants.map((grant) => ({
			...grant,
			...overrides,
		})),
	};
}

async function seedResource(
	db: ReturnType<typeof drizzle<any>>,
): Promise<void> {
	await db.execute(sql`
		INSERT INTO questpie_crdt_namespace (singleton, namespace)
		VALUES (1, 'questpie-test')
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_definition
			(id, namespace_singleton, owner_kind, owner_key, identity_version)
		VALUES (${ID.definition}, 1, 1, 'articles', 1)
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_schema
			(id, definition_id, schema_version, schema_fingerprint)
		VALUES (${ID.schema}, ${ID.definition}, 1, decode(repeat('11', 32), 'hex'))
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_schema_field
			(id, definition_id, schema_id, stable_field_id, field_slot, source_path, format, format_version, codec_fingerprint)
		VALUES (${ID.schemaField}, ${ID.definition}, ${ID.schema}, ${ID.stableField}, 1, 'title', 1, 1, decode(repeat('12', 32), 'hex'))
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_resource
			(id, incarnation_key, definition_id, locator, locator_hash, identity_version, status)
		VALUES (${ID.resource}, ${ID.incarnation}, ${ID.definition}, '{"id":"article-1"}', decode(repeat('13', 32), 'hex'), 1, 3)
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_resource_epoch
			(id, resource_id, definition_id, aggregate_epoch, schema_id, status)
		VALUES (${ID.epoch}, ${ID.resource}, ${ID.definition}, 1, ${ID.schema}, 1)
	`);
	await db.execute(sql`
		UPDATE questpie_crdt_resource
		SET status = 1, current_epoch_id = ${ID.epoch}, current_epoch_status = 1
		WHERE id = ${ID.resource}
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_binding
			(id, resource_id, definition_id, schema_id, schema_field_id, stable_field_id, field_slot, source_path, format, format_version, field_epoch, canonical_hash, projected_canonical_hash, status)
		VALUES (${ID.binding}, ${ID.resource}, ${ID.definition}, ${ID.schema}, ${ID.schemaField}, ${ID.stableField}, 1, 'title', 1, 1, 0, decode(repeat('14', 32), 'hex'), decode(repeat('14', 32), 'hex'), 1)
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_subject
			(id, kind, issuer_key, subject_key, subject_hash)
		VALUES (${ID.subject}, 1, '', 'user-1', decode(repeat('15', 32), 'hex'))
	`);
}

function bytes(value: number): Uint8Array {
	return new Uint8Array(32).fill(value);
}
