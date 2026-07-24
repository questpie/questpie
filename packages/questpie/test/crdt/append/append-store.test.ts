import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { Buffer } from "node:buffer";

import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";

import { createCrdtAppendStore } from "../../../src/server/modules/core/integrated/crdt/append-store.js";
import { createDeterministicTextEngine } from "../../../src/server/modules/core/integrated/crdt/deterministic-engine.js";
import {
	resolveCrdtDesiredManifest,
	updateCrdtManifestArtifact,
} from "../../../src/server/modules/core/integrated/crdt/manifest.js";
import {
	canonicalCrdtCollectionLocator,
	CrdtOwnerLifecycleTransaction,
	stageCrdtOwnerActivation,
} from "../../../src/server/modules/core/integrated/crdt/owner-lifecycle.js";
import {
	questpieCrdtBindingTable,
	questpieCrdtCommitTable,
	questpieCrdtResourceEpochTable,
	questpieCrdtResourceTable,
	questpieCrdtSessionGrantTable,
	questpieCrdtSessionTable,
	questpieCrdtSubjectTable,
	questpieCrdtTables,
	questpieCrdtTicketGrantTable,
	questpieCrdtTicketTable,
	questpieCrdtUpdateReceiptTable,
	questpieCrdtUpdateTable,
} from "../../../src/server/modules/core/integrated/crdt/schema.js";

const RESOURCE_ID = "00000000-0000-4000-8000-000000000301";
const SUBJECT_ID = "00000000-0000-4000-8000-000000000302";
const TICKET_ID = "00000000-0000-4000-8000-000000000303";
const SESSION_ID = "00000000-0000-4000-8000-000000000304";
const UPDATE_ID = "00000000-0000-4000-8000-000000000305";
const textEngine = createDeterministicTextEngine();
const declarations = {
	owner: { kind: 1 as const, key: "articles", identityVersion: 1 },
	fields: {
		title: {
			format: "text" as const,
			formatVersion: textEngine.formatVersion,
			engineId: textEngine.engineId,
			engineVersion: textEngine.engineVersion,
			codecFingerprint: textEngine.codecFingerprint,
		},
	},
};
const manifest = resolveCrdtDesiredManifest(
	updateCrdtManifestArtifact({
		namespace: "acme-cms",
		declarations: [declarations],
		createStableFieldId: () => "00000000-0000-4000-8000-000000000306",
	}),
	declarations,
);

describe("CRDT atomic append store", () => {
	let ddl: string[];
	let client: PGlite;
	let db: ReturnType<typeof drizzle<typeof questpieCrdtTables>>;
	let fixture: Awaited<ReturnType<typeof seedFixture>>;

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
		ddl = await generateMigration(
			empty,
			await generateDrizzleJson(questpieCrdtTables, empty.id),
		);
	});

	beforeEach(async () => {
		client = await PGlite.create();
		db = drizzle(client, { schema: questpieCrdtTables });
		for (const statement of ddl) {
			if (statement.trim()) await db.execute(sql.raw(statement));
		}
		await db.execute(sql`
			CREATE TABLE articles (
				id text PRIMARY KEY,
				title text NOT NULL
			)
		`);
		fixture = await seedFixture(db);
	});

	afterEach(async () => {
		await client?.close();
	});

	it("commits one part, receipt, heads, then publishes a metadata-only notice", async () => {
		const notices: unknown[] = [];
		const store = createCrdtAppendStore(db, {
			lockOwnerRow,
			publishNotice: async (notice) => {
				const commits = await db.select().from(questpieCrdtCommitTable);
				expect(commits).toHaveLength(1);
				notices.push(notice);
			},
		});
		const receipt = await store.append(appendInput(fixture));

		expect(receipt).toMatchObject({
			updateId: UPDATE_ID,
			commitSeq: 1n,
			fieldCursors: [{ fieldSlot: 1, fieldCursor: 1n }],
		});
		expect(await db.select().from(questpieCrdtCommitTable)).toHaveLength(1);
		expect(await db.select().from(questpieCrdtUpdateTable)).toHaveLength(1);
		expect(await db.select().from(questpieCrdtUpdateReceiptTable)).toHaveLength(
			1,
		);
		const [epoch] = await db
			.select()
			.from(questpieCrdtResourceEpochTable)
			.where(eq(questpieCrdtResourceEpochTable.id, fixture.resourceEpochId));
		const [binding] = await db
			.select()
			.from(questpieCrdtBindingTable)
			.where(eq(questpieCrdtBindingTable.id, fixture.binding.id));
		expect(epoch?.headCommitSeq).toBe(1n);
		expect(binding?.headFieldCursor).toBe(1n);
		expect(notices).toEqual([
			{
				kind: "crdt",
				resourceId: RESOURCE_ID,
				resourceEpochId: fixture.resourceEpochId,
				commitSeq: 1n,
			},
		]);
	});

	it("returns the durable receipt for an exact retry without another commit or notice", async () => {
		const notices: unknown[] = [];
		const store = createCrdtAppendStore(db, {
			lockOwnerRow,
			publishNotice: async (notice) => {
				notices.push(notice);
			},
		});
		const input = appendInput(fixture);

		const first = await store.append(input);
		const retry = await store.append(input);

		expect(retry).toEqual(first);
		expect(await db.select().from(questpieCrdtCommitTable)).toHaveLength(1);
		expect(await db.select().from(questpieCrdtUpdateTable)).toHaveLength(1);
		expect(notices).toHaveLength(1);
	});

	it("rejects update-id reuse with different immutable input", async () => {
		const store = createCrdtAppendStore(db, { lockOwnerRow });
		const input = appendInput(fixture);
		await store.append(input);

		await expect(
			store.append({
				...input,
				submittedBundleHash: Buffer.alloc(32, 0x7f),
			}),
		).rejects.toMatchObject({
			code: "CRDT_APPEND_REJECTED",
			message: "CRDT update id was reused",
		});
		expect(await db.select().from(questpieCrdtCommitTable)).toHaveLength(1);
		expect(await db.select().from(questpieCrdtUpdateReceiptTable)).toHaveLength(
			1,
		);
	});

	it("rolls back stale staged bases without allocating a sequence or notice", async () => {
		const notices: unknown[] = [];
		const store = createCrdtAppendStore(db, {
			lockOwnerRow,
			publishNotice: async (notice) => {
				notices.push(notice);
			},
		});
		const input = appendInput(fixture);
		await db
			.update(questpieCrdtBindingTable)
			.set({ headFieldCursor: 1n })
			.where(eq(questpieCrdtBindingTable.id, fixture.binding.id));

		await expect(store.append(input)).rejects.toMatchObject({
			code: "CRDT_APPEND_REJECTED",
		});
		expect(await db.select().from(questpieCrdtCommitTable)).toHaveLength(0);
		expect(await db.select().from(questpieCrdtUpdateTable)).toHaveLength(0);
		expect(await db.select().from(questpieCrdtUpdateReceiptTable)).toHaveLength(
			0,
		);
		expect(notices).toHaveLength(0);
		const [epoch] = await db
			.select()
			.from(questpieCrdtResourceEpochTable)
			.where(eq(questpieCrdtResourceEpochTable.id, fixture.resourceEpochId));
		expect(epoch?.headCommitSeq).toBe(0n);
	});
});

async function lockOwnerRow(db: ReturnType<typeof drizzle<any>>) {
	await db.execute(sql`
		SELECT id
		FROM articles
		WHERE id = 'article-1'
		FOR UPDATE
	`);
}

function appendInput(fixture: Awaited<ReturnType<typeof seedFixture>>) {
	const bytes = new TextEncoder().encode(
		'[{"type":"insert","index":6,"text":"!"}]',
	);
	return {
		resourceId: RESOURCE_ID,
		resourceEpochId: fixture.resourceEpochId,
		definitionId: fixture.definitionId,
		schemaId: fixture.schemaId,
		sessionId: SESSION_ID,
		subjectId: SUBJECT_ID,
		updateId: UPDATE_ID,
		submittedSchemaId: fixture.schemaId,
		submittedSchemaVersion: 1n,
		submittedBundleHash: Buffer.alloc(32, 0x31),
		canonicalBundleHash: Buffer.alloc(32, 0x32),
		decisionExpiresAt: new Date(Date.now() + 30_000),
		authority: {
			resourceReadFence: 0n,
			resourceEditFence: 0n,
			ownerPolicyRevision: 0n,
			subjectReadFence: 0n,
			subjectEditFence: 0n,
			sessionGeneration: 0n,
		},
		overlay: [
			{
				bindingId: fixture.binding.id,
				stableFieldId: fixture.binding.stableFieldId,
				fieldEpoch: 1n,
				fieldCursor: 0n,
				readFence: 0n,
				editFence: 0n,
			},
		],
		parts: [
			{
				bindingId: fixture.binding.id,
				stableFieldId: fixture.binding.stableFieldId,
				fieldEpoch: 1n,
				fieldSlot: 1,
				formatVersion: 1,
				baseFieldCursor: 0n,
				bytes,
				checksum: Buffer.alloc(32, 0x33),
				nextCanonicalHash: Buffer.alloc(32, 0x34),
				nextStateBytes: 7n,
				nextElementCount: 0n,
			},
		],
	};
}

async function seedFixture(db: ReturnType<typeof drizzle<any>>) {
	await db.execute(
		sql`INSERT INTO articles (id, title) VALUES ('article-1', 'Shared')`,
	);
	const staged = await stageCrdtOwnerActivation({
		manifest,
		resourceId: RESOURCE_ID,
		values: { title: "Shared" },
		textEngine,
	});
	const identity = await db.transaction(async (tx) =>
		new CrdtOwnerLifecycleTransaction(tx).activate({
			staged,
			owner: {
				locator: canonicalCrdtCollectionLocator("article-1"),
				values: { title: "Shared" },
			},
			mode: "create",
		}),
	);
	const [resource] = await db
		.select()
		.from(questpieCrdtResourceTable)
		.where(eq(questpieCrdtResourceTable.id, RESOURCE_ID));
	const [binding] = await db
		.select()
		.from(questpieCrdtBindingTable)
		.where(eq(questpieCrdtBindingTable.resourceId, RESOURCE_ID));
	const expiresAt = new Date(Date.now() + 60_000);
	const credentialFingerprint = Buffer.alloc(32, 0x41);
	await db.insert(questpieCrdtSubjectTable).values({
		id: SUBJECT_ID,
		kind: 1,
		issuerKey: "",
		subjectKey: "user-1",
		subjectHash: Buffer.alloc(32, 0x42),
	});
	await db.insert(questpieCrdtTicketTable).values({
		id: TICKET_ID,
		resourceId: RESOURCE_ID,
		resourceEpochId: identity.resourceEpochId,
		definitionId: resource!.definitionId,
		schemaId: identity.schemaId,
		subjectId: SUBJECT_ID,
		secretHash: Buffer.alloc(32, 0x43),
		credentialFingerprint,
		audience: "test",
		requestedMode: 2,
		effectiveMode: 2,
		protocolMajor: 1,
		protocolMinor: 0,
		resourceReadFence: 0n,
		resourceEditFence: 0n,
		ownerPolicyRevision: 0n,
		subjectReadFence: 0n,
		subjectEditFence: 0n,
		sessionGeneration: 0n,
		authorityExpiresAt: expiresAt,
		expiresAt,
		redeemedAt: new Date(),
	});
	await db.insert(questpieCrdtTicketGrantTable).values({
		ticketId: TICKET_ID,
		resourceId: RESOURCE_ID,
		schemaId: identity.schemaId,
		bindingId: binding!.id,
		stableFieldId: binding!.stableFieldId,
		fieldEpoch: 1n,
		fieldSlot: 1,
		formatVersion: 1,
		grant: 1,
		headFieldCursor: 0n,
		fieldReadFence: 0n,
		fieldEditFence: 0n,
		subjectFieldReadFence: 0n,
		subjectFieldEditFence: 0n,
	});
	await db.insert(questpieCrdtSessionTable).values({
		id: SESSION_ID,
		ticketId: TICKET_ID,
		resourceId: RESOURCE_ID,
		resourceEpochId: identity.resourceEpochId,
		schemaId: identity.schemaId,
		subjectId: SUBJECT_ID,
		credentialFingerprint,
		requestedMode: 2,
		effectiveMode: 2,
		generation: 0n,
		resourceReadFence: 0n,
		resourceEditFence: 0n,
		ownerPolicyRevision: 0n,
		subjectReadFence: 0n,
		subjectEditFence: 0n,
		authorityExpiresAt: expiresAt,
		lastSeenCommitSeq: 0n,
		leaseExpiresAt: expiresAt,
	});
	await db.insert(questpieCrdtSessionGrantTable).values({
		sessionId: SESSION_ID,
		ticketId: TICKET_ID,
		resourceId: RESOURCE_ID,
		schemaId: identity.schemaId,
		bindingId: binding!.id,
		stableFieldId: binding!.stableFieldId,
		fieldEpoch: 1n,
		fieldSlot: 1,
		formatVersion: 1,
		grant: 1,
		headFieldCursor: 0n,
		fieldReadFence: 0n,
		fieldEditFence: 0n,
		subjectFieldReadFence: 0n,
		subjectFieldEditFence: 0n,
	});
	return {
		...identity,
		definitionId: resource!.definitionId,
		resource: resource!,
		binding: binding!,
	};
}
