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
import { count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";

import {
	questpieCrdtSessionGrantTable,
	questpieCrdtSessionTable,
	questpieCrdtSubjectAdmissionTable,
	questpieCrdtSubjectFenceTable,
	questpieCrdtSubjectTable,
	questpieCrdtTables,
	questpieCrdtTicketGrantTable,
	questpieCrdtTicketTable,
} from "../../../src/server/modules/core/integrated/crdt/schema.js";
import {
	createCrdtTicketAdmissionStore,
	type CrdtAuthorizedTicketSnapshot,
} from "../../../src/server/modules/core/integrated/crdt/ticket-store.js";
import { CrdtTicketRejectedError } from "../../../src/server/modules/core/integrated/crdt/ticket.js";

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

const SECRET_KEY = "s".repeat(32);
const CREDENTIAL_FINGERPRINT = bytes(0x71);

describe("CRDT durable ticket admission", () => {
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

	it("redeems one opaque reservation exactly once under a 100-way race", async () => {
		const store = createCrdtTicketAdmissionStore(db, {
			secretKey: SECRET_KEY,
		});
		const issued = await store.issue(authorization());

		expect(issued.ticket).not.toContain(ID.resource);
		expect(issued.incarnationKey).toBe(ID.incarnation);
		expect(issued.effectiveMode).toBe("edit");
		expect(issued.expiresAt.getTime() - Date.now()).toBeWithin(25_000, 31_000);

		const outcomes = await Promise.allSettled(
			Array.from({ length: 100 }, () =>
				store.redeem({
					ticket: issued.ticket,
					authorization: authorization(),
				}),
			),
		);
		const fulfilled = outcomes.filter(
			(outcome) => outcome.status === "fulfilled",
		);
		const rejected = outcomes.filter(
			(outcome) => outcome.status === "rejected",
		);
		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(99);
		for (const outcome of rejected) {
			expect(outcome.reason).toBeInstanceOf(CrdtTicketRejectedError);
			expect(outcome.reason.message).toBe("CRDT ticket rejected");
		}

		const [ticket] = await db
			.select({
				secretHash: questpieCrdtTicketTable.secretHash,
				redeemedAt: questpieCrdtTicketTable.redeemedAt,
			})
			.from(questpieCrdtTicketTable);
		expect(ticket?.secretHash).toHaveLength(32);
		expect(
			Buffer.from(ticket?.secretHash ?? []).toString("base64url"),
		).not.toBe(issued.ticket);
		expect(ticket?.redeemedAt).toBeInstanceOf(Date);

		const [sessionCount] = await db
			.select({ value: count() })
			.from(questpieCrdtSessionTable);
		const [grantCount] = await db
			.select({ value: count() })
			.from(questpieCrdtSessionGrantTable);
		expect(sessionCount?.value).toBe(1);
		expect(grantCount?.value).toBe(1);
	});

	it("inspects only a live valid credential and idempotently releases its session", async () => {
		const store = createCrdtTicketAdmissionStore(db, {
			secretKey: SECRET_KEY,
		});
		const issued = await Promise.all(
			Array.from({ length: 5 }, () => store.issue(authorization())),
		);
		expect(await store.inspect(issued[0]!.ticket)).toEqual({
			resourceId: ID.resource,
			requestedMode: "edit",
			audience: "questpie-test",
			origin: "https://app.example",
		});
		const badSecret = `${issued[0]!.ticket.slice(0, issued[0]!.ticket.indexOf("."))}.${"A".repeat(43)}`;
		await expect(store.inspect(badSecret)).rejects.toBeInstanceOf(
			CrdtTicketRejectedError,
		);

		const redeemed = await store.redeem({
			ticket: issued[0]!.ticket,
			authorization: authorization(),
		});
		await expect(store.inspect(issued[0]!.ticket)).rejects.toBeInstanceOf(
			CrdtTicketRejectedError,
		);
		await store.release(redeemed.sessionId);
		await store.release(redeemed.sessionId);

		const [session] = await db
			.select({
				closedAt: questpieCrdtSessionTable.closedAt,
				closeReason: questpieCrdtSessionTable.closeReason,
				leaseExpiresAt: questpieCrdtSessionTable.leaseExpiresAt,
			})
			.from(questpieCrdtSessionTable)
			.where(eq(questpieCrdtSessionTable.id, redeemed.sessionId));
		const ticketId = issued[0]!.ticket.slice(0, issued[0]!.ticket.indexOf("."));
		const [ticket] = await db
			.select({ releasedAt: questpieCrdtTicketTable.releasedAt })
			.from(questpieCrdtTicketTable)
			.where(eq(questpieCrdtTicketTable.id, ticketId));
		expect(session?.closedAt).toBeInstanceOf(Date);
		expect(session?.closeReason).toBe(1);
		expect(session?.leaseExpiresAt.getTime()).toBeLessThanOrEqual(Date.now());
		expect(ticket?.releasedAt).toBeInstanceOf(Date);

		const replacement = await store.issue(authorization());
		expect(replacement.ticket).toBeString();
	});

	it("counts reservations and sessions once and frees expired capacity without cleanup", async () => {
		const store = createCrdtTicketAdmissionStore(db, {
			secretKey: SECRET_KEY,
		});
		const issued = await Promise.all(
			Array.from({ length: 5 }, () => store.issue(authorization())),
		);
		await store.redeem({
			ticket: issued[0]!.ticket,
			authorization: authorization(),
		});

		const [admissionBeforeRejection] = await db
			.select()
			.from(questpieCrdtSubjectAdmissionTable)
			.where(eq(questpieCrdtSubjectAdmissionTable.subjectId, ID.subject));
		await expect(store.issue(authorization())).rejects.toBeInstanceOf(
			CrdtTicketRejectedError,
		);
		const [admissionAfterRejection] = await db
			.select()
			.from(questpieCrdtSubjectAdmissionTable)
			.where(eq(questpieCrdtSubjectAdmissionTable.subjectId, ID.subject));
		expect(admissionAfterRejection?.ticketTokens).toBe(
			admissionBeforeRejection?.ticketTokens,
		);
		expect(admissionAfterRejection?.ticketRefilledAt).toEqual(
			admissionBeforeRejection?.ticketRefilledAt,
		);
		const secondTicketId = issued[1]!.ticket.slice(
			0,
			issued[1]!.ticket.indexOf("."),
		);
		await db
			.update(questpieCrdtTicketTable)
			.set({ expiresAt: new Date(Date.now() - 1_000) })
			.where(eq(questpieCrdtTicketTable.id, secondTicketId));

		const replacement = await store.issue(authorization());
		expect(replacement.ticket).toBeString();
		const [ticketCount] = await db
			.select({ value: count() })
			.from(questpieCrdtTicketTable);
		expect(ticketCount?.value).toBe(6);
	});

	it("enforces the aggregate cap across other subjects' reservations", async () => {
		const otherSubject = "00000000-0000-4000-8000-000000000010";
		await db.insert(questpieCrdtSubjectTable).values({
			id: otherSubject,
			kind: 1,
			issuerKey: "",
			subjectKey: "other-user",
			subjectHash: Buffer.alloc(32, 0x51),
		});
		await db.insert(questpieCrdtTicketTable).values(
			Array.from({ length: 100 }, () => ({
				id: randomUUID(),
				resourceId: ID.resource,
				resourceEpochId: ID.epoch,
				definitionId: ID.definition,
				schemaId: ID.schema,
				subjectId: otherSubject,
				secretHash: Buffer.alloc(32, 0x61),
				credentialFingerprint: Buffer.alloc(32, 0x71),
				audience: "questpie-test",
				origin: "https://app.example",
				requestedMode: 1,
				effectiveMode: 1,
				protocolMajor: 1,
				protocolMinor: 0,
				resourceReadFence: 0n,
				resourceEditFence: 0n,
				ownerPolicyRevision: 0n,
				subjectReadFence: 0n,
				subjectEditFence: 0n,
				sessionGeneration: 0n,
				authorityExpiresAt: new Date(Date.now() + 60_000),
				expiresAt: new Date(Date.now() + 60_000),
			})),
		);

		const store = createCrdtTicketAdmissionStore(db, {
			secretKey: SECRET_KEY,
		});
		await expect(store.issue(authorization())).rejects.toBeInstanceOf(
			CrdtTicketRejectedError,
		);
	});

	it("uses DB-time credential and subject ticket buckets", async () => {
		const store = createCrdtTicketAdmissionStore(db, {
			secretKey: SECRET_KEY,
		});
		for (let index = 0; index < 10; index++) {
			await expireTicket(db, await store.issue(authorization()));
		}
		await expect(store.issue(authorization())).rejects.toBeInstanceOf(
			CrdtTicketRejectedError,
		);

		await db
			.update(questpieCrdtSubjectAdmissionTable)
			.set({ ticketTokens: 30n, ticketRefilledAt: sql`clock_timestamp()` })
			.where(eq(questpieCrdtSubjectAdmissionTable.subjectId, ID.subject));
		for (let index = 0; index < 30; index++) {
			await expireTicket(
				db,
				await store.issue(
					authorization({
						credentialFingerprint: Buffer.alloc(32, index + 1),
					}),
				),
			);
		}
		await expect(
			store.issue(
				authorization({ credentialFingerprint: Buffer.alloc(32, 31) }),
			),
		).rejects.toBeInstanceOf(CrdtTicketRejectedError);
	});

	it("rejects an authorization snapshot when an ordinary owner write won the race", async () => {
		const store = createCrdtTicketAdmissionStore(db, {
			secretKey: SECRET_KEY,
		});
		await db.execute(sql`
			UPDATE questpie_crdt_resource
			SET owner_policy_revision = owner_policy_revision + 1
			WHERE id = ${ID.resource}
		`);

		await expect(store.issue(authorization())).rejects.toBeInstanceOf(
			CrdtTicketRejectedError,
		);
		const issued = await store.issue(
			authorization({ ownerPolicyRevision: 1n }),
		);
		expect(issued.ticket).toBeString();
	});

	it("caps ticket and session lifetimes at the DB-checked authority expiry", async () => {
		const authorityExpiresAt = new Date(Date.now() + 10_000);
		const store = createCrdtTicketAdmissionStore(db, {
			secretKey: SECRET_KEY,
		});
		const candidate = authorization({ authorityExpiresAt });
		const issued = await store.issue(candidate);
		expect(issued.expiresAt.getTime()).toBeLessThanOrEqual(
			authorityExpiresAt.getTime(),
		);
		const session = await store.redeem({
			ticket: issued.ticket,
			authorization: candidate,
		});
		expect(session.leaseExpiresAt.getTime()).toBeLessThanOrEqual(
			authorityExpiresAt.getTime(),
		);

		await expect(
			store.issue(
				authorization({
					credentialFingerprint: Buffer.alloc(32, 0x72),
					authorityExpiresAt: new Date(Date.now() - 1_000),
				}),
			),
		).rejects.toBeInstanceOf(CrdtTicketRejectedError);
	});

	it("rolls redemption back when session creation fails after ticket consumption", async () => {
		const store = createCrdtTicketAdmissionStore(db, {
			secretKey: SECRET_KEY,
		});
		const issued = await store.issue(authorization());
		const ticketId = issued.ticket.slice(0, issued.ticket.indexOf("."));
		await db.execute(
			sql.raw(`
			CREATE FUNCTION reject_crdt_session_insert() RETURNS trigger
			LANGUAGE plpgsql AS $$
			BEGIN
				RAISE EXCEPTION 'injected session failure';
			END;
			$$
		`),
		);
		await db.execute(
			sql.raw(`
			CREATE TRIGGER reject_crdt_session_insert
			BEFORE INSERT ON questpie_crdt_session
			FOR EACH ROW EXECUTE FUNCTION reject_crdt_session_insert()
		`),
		);

		await expect(
			store.redeem({
				ticket: issued.ticket,
				authorization: authorization(),
			}),
		).rejects.toBeInstanceOf(CrdtTicketRejectedError);
		const [rolledBackTicket] = await db
			.select()
			.from(questpieCrdtTicketTable)
			.where(eq(questpieCrdtTicketTable.id, ticketId));
		expect(rolledBackTicket?.redeemedAt).toBeNull();
		expect(await db.select().from(questpieCrdtSessionTable)).toHaveLength(0);

		await db.execute(
			sql.raw(
				"DROP TRIGGER reject_crdt_session_insert ON questpie_crdt_session",
			),
		);
		await db.execute(sql.raw("DROP FUNCTION reject_crdt_session_insert()"));
		const redeemed = await store.redeem({
			ticket: issued.ticket,
			authorization: authorization(),
		});
		expect(redeemed.sessionId).toBeString();
	});

	it("requires effective mode to agree with the persisted field grants", async () => {
		const base = authorization();
		await expect(
			createCrdtTicketAdmissionStore(db, { secretKey: SECRET_KEY }).issue({
				...base,
				effectiveMode: "view",
			}),
		).rejects.toBeInstanceOf(TypeError);
		await expect(
			createCrdtTicketAdmissionStore(db, { secretKey: SECRET_KEY }).issue({
				...base,
				grants: base.grants.map((grant) => ({ ...grant, grant: "view" })),
			}),
		).rejects.toBeInstanceOf(TypeError);
	});

	it("revalidates hidden policy inputs without leaking them into ticket grants", async () => {
		await db.execute(sql`
			INSERT INTO questpie_crdt_schema_field
				(id, definition_id, schema_id, stable_field_id, field_slot, source_path, format, format_version, codec_fingerprint)
			VALUES (${ID.hiddenSchemaField}, ${ID.definition}, ${ID.schema}, ${ID.hiddenStableField}, 2, 'privateNotes', 1, 1, decode(repeat('22', 32), 'hex'))
		`);
		await db.execute(sql`
			INSERT INTO questpie_crdt_binding
				(id, resource_id, definition_id, schema_id, schema_field_id, stable_field_id, field_slot, source_path, format, format_version, field_epoch, canonical_hash, projected_canonical_hash, status)
			VALUES (${ID.hiddenBinding}, ${ID.resource}, ${ID.definition}, ${ID.schema}, ${ID.hiddenSchemaField}, ${ID.hiddenStableField}, 2, 'privateNotes', 1, 1, 0, decode(repeat('23', 32), 'hex'), decode(repeat('23', 32), 'hex'), 1)
		`);
		const base = authorization();
		const issued = await createCrdtTicketAdmissionStore(db, {
			secretKey: SECRET_KEY,
		}).issue({
			...base,
			bindings: [
				...base.bindings,
				{
					bindingId: ID.hiddenBinding,
					stableFieldId: ID.hiddenStableField,
					fieldEpoch: 0n,
					fieldSlot: 2,
					formatVersion: 1,
					headFieldCursor: 0n,
					fieldReadFence: 0n,
					fieldEditFence: 0n,
				},
			],
		});

		const ticketId = issued.ticket.slice(0, issued.ticket.indexOf("."));
		const [grantCount] = await db
			.select({ value: count() })
			.from(questpieCrdtTicketGrantTable)
			.where(eq(questpieCrdtTicketGrantTable.ticketId, ticketId));
		expect(grantCount?.value).toBe(1);
	});

	it("rejects every stale authority-cut dimension independently", async () => {
		const store = createCrdtTicketAdmissionStore(db, {
			secretKey: SECRET_KEY,
		});
		const staleCandidates: ReadonlyArray<
			[
				string,
				(
					snapshot: CrdtAuthorizedTicketSnapshot,
				) => CrdtAuthorizedTicketSnapshot,
			]
		> = [
			[
				"resource read fence",
				(snapshot) => ({ ...snapshot, resourceReadFence: 1n }),
			],
			[
				"resource edit fence",
				(snapshot) => ({ ...snapshot, resourceEditFence: 1n }),
			],
			[
				"owner policy",
				(snapshot) => ({ ...snapshot, ownerPolicyRevision: 1n }),
			],
			[
				"subject read fence",
				(snapshot) => ({ ...snapshot, subjectReadFence: 1n }),
			],
			[
				"subject edit fence",
				(snapshot) => ({ ...snapshot, subjectEditFence: 1n }),
			],
			[
				"session generation",
				(snapshot) => ({ ...snapshot, sessionGeneration: 1n }),
			],
			["aggregate head", (snapshot) => ({ ...snapshot, headCommitSeq: 1n })],
			[
				"field epoch",
				(snapshot) => withBindingCut(snapshot, { fieldEpoch: 1n }),
			],
			[
				"field cursor",
				(snapshot) => withBindingCut(snapshot, { headFieldCursor: 1n }),
			],
			[
				"field read fence",
				(snapshot) => withBindingCut(snapshot, { fieldReadFence: 1n }),
			],
			[
				"field edit fence",
				(snapshot) => withBindingCut(snapshot, { fieldEditFence: 1n }),
			],
			[
				"subject field read fence",
				(snapshot) => withGrant(snapshot, { subjectFieldReadFence: 1n }),
			],
			[
				"subject field edit fence",
				(snapshot) => withGrant(snapshot, { subjectFieldEditFence: 1n }),
			],
		];

		for (const [index, [label, makeStale]] of staleCandidates.entries()) {
			const current = authorization({
				credentialFingerprint: Buffer.alloc(32, index + 1),
			});
			const issued = await store.issue(current);
			await expect(
				store.redeem({
					ticket: issued.ticket,
					authorization: makeStale(current),
				}),
				label,
			).rejects.toBeInstanceOf(CrdtTicketRejectedError);
			await expireTicket(db, issued);
		}
	});

	it("makes stale fences, used tickets, bad secrets, principals, and origins indistinguishable", async () => {
		const store = createCrdtTicketAdmissionStore(db, {
			secretKey: SECRET_KEY,
		});
		const stale = await store.issue(authorization());
		const used = await store.issue(authorization());
		const badOrigin = await store.issue(authorization());
		const badPrincipal = await store.issue(authorization());
		await store.redeem({
			ticket: used.ticket,
			authorization: authorization(),
		});
		await db
			.update(questpieCrdtSubjectFenceTable)
			.set({ editFence: 1n })
			.where(eq(questpieCrdtSubjectFenceTable.stableFieldId, ZERO_UUID));

		const failures = await Promise.allSettled([
			store.redeem({
				ticket: stale.ticket,
				authorization: authorization({ subjectEditFence: 1n }),
			}),
			store.redeem({
				ticket: used.ticket,
				authorization: authorization({ subjectEditFence: 1n }),
			}),
			store.redeem({
				ticket: `${badOrigin.ticket.slice(0, -1)}!`,
				authorization: authorization({ subjectEditFence: 1n }),
			}),
			store.redeem({
				ticket: badOrigin.ticket,
				authorization: authorization({
					origin: "https://evil.example",
					subjectEditFence: 1n,
				}),
			}),
			store.redeem({
				ticket: badPrincipal.ticket,
				authorization: authorization({
					subjectId: "00000000-0000-4000-8000-000000000099",
					subjectEditFence: 1n,
				}),
			}),
		]);
		for (const failure of failures) {
			expect(failure.status).toBe("rejected");
			if (failure.status === "rejected") {
				expect(failure.reason).toBeInstanceOf(CrdtTicketRejectedError);
				expect(failure.reason.message).toBe("CRDT ticket rejected");
			}
		}
	});
});

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

function authorization(
	overrides: Partial<CrdtAuthorizedTicketSnapshot> = {},
): CrdtAuthorizedTicketSnapshot {
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
	snapshot: CrdtAuthorizedTicketSnapshot,
	overrides: Partial<CrdtAuthorizedTicketSnapshot["bindings"][number]>,
): CrdtAuthorizedTicketSnapshot {
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

function withGrant(
	snapshot: CrdtAuthorizedTicketSnapshot,
	overrides: Partial<CrdtAuthorizedTicketSnapshot["grants"][number]>,
): CrdtAuthorizedTicketSnapshot {
	return {
		...snapshot,
		grants: snapshot.grants.map((grant) => ({ ...grant, ...overrides })),
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

async function expireTicket(
	db: ReturnType<typeof drizzle<any>>,
	issued: { ticket: string },
): Promise<void> {
	await db
		.update(questpieCrdtTicketTable)
		.set({ expiresAt: new Date(Date.now() - 1_000) })
		.where(
			eq(
				questpieCrdtTicketTable.id,
				issued.ticket.slice(0, issued.ticket.indexOf(".")),
			),
		);
}
