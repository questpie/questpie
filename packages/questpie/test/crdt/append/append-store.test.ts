import {
	afterEach,
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/pglite";
import pg from "pg";

import type { AnyDrizzleClient } from "../../../src/server/config/types.js";
import {
	createCrdtAppendStore,
	prepareCrdtAppend,
} from "../../../src/server/modules/core/integrated/crdt/append-store.js";
import {
	createDeterministicTextEngine,
	encodeDeterministicTextUpdate,
} from "../../../src/server/modules/core/integrated/crdt/deterministic-engine.js";
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
	questpieCrdtResourceAdmissionTable,
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
import { stageCrdtAggregateBundle } from "../../../src/shared/crdt-engine.js";

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
		content: {
			format: "text" as const,
			formatVersion: textEngine.formatVersion,
			engineId: textEngine.engineId,
			engineVersion: textEngine.engineVersion,
			codecFingerprint: textEngine.codecFingerprint,
		},
	},
};
let stableFieldIndex = 0;
const stableFieldIds = [
	"00000000-0000-4000-8000-000000000306",
	"00000000-0000-4000-8000-000000000308",
] as const;
const manifest = resolveCrdtDesiredManifest(
	updateCrdtManifestArtifact({
		namespace: "acme-cms",
		declarations: [declarations],
		createStableFieldId: () => stableFieldIds[stableFieldIndex++]!,
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
				title text NOT NULL,
				content text NOT NULL
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
		const receipt = await store.append(await appendInput(fixture));

		expect(receipt).toMatchObject({
			updateId: UPDATE_ID,
			commitSeq: 1n,
			fieldCursors: [{ fieldSlot: fixture.binding.fieldSlot, fieldCursor: 1n }],
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
		const [session] = await db
			.select()
			.from(questpieCrdtSessionTable)
			.where(eq(questpieCrdtSessionTable.id, SESSION_ID));
		const [admission] = await db
			.select()
			.from(questpieCrdtResourceAdmissionTable)
			.where(eq(questpieCrdtResourceAdmissionTable.resourceId, RESOURCE_ID));
		expect(session?.updateTokens).toBe(119n);
		expect(session?.updateByteTokens).toBe(
			2n * 1024n * 1024n - BigInt(appendUpdateBytes().length),
		);
		expect(admission?.partTokens).toBe(1_999n);
		expect(notices).toEqual([
			{
				kind: "crdt",
				resourceId: RESOURCE_ID,
				resourceEpochId: fixture.resourceEpochId,
				commitSeq: 1n,
			},
		]);
	});

	it("commits two fields under one aggregate sequence and receipt", async () => {
		const store = createCrdtAppendStore(db, { lockOwnerRow });
		const staged = await multiFieldAppendInput(fixture);

		const receipt = await store.append(staged);

		expect(receipt.commitSeq).toBe(1n);
		expect(receipt.fieldCursors).toHaveLength(2);
		const updates = await db
			.select()
			.from(questpieCrdtUpdateTable)
			.orderBy(questpieCrdtUpdateTable.fieldSlot);
		expect(updates).toHaveLength(2);
		expect(updates.map((update) => update.commitSeq)).toEqual([1n, 1n]);
		const bindings = await db
			.select()
			.from(questpieCrdtBindingTable)
			.where(eq(questpieCrdtBindingTable.resourceId, RESOURCE_ID));
		expect(bindings.map((binding) => binding.headFieldCursor)).toEqual([
			1n,
			1n,
		]);
		expect(await db.select().from(questpieCrdtUpdateReceiptTable)).toHaveLength(
			1,
		);
	});

	it("returns the durable receipt for an exact retry without another commit or notice", async () => {
		const notices: unknown[] = [];
		const store = createCrdtAppendStore(db, {
			lockOwnerRow,
			publishNotice: async (notice) => {
				notices.push(notice);
			},
		});
		const input = await appendInput(fixture);

		const first = await store.append(input);
		const retry = await store.append(input);

		expect(retry).toEqual(first);
		expect(await db.select().from(questpieCrdtCommitTable)).toHaveLength(1);
		expect(await db.select().from(questpieCrdtUpdateTable)).toHaveLength(1);
		expect(notices).toHaveLength(1);
	});

	it("rejects a forged copy of a staged append capability before locking", async () => {
		let ownerLocks = 0;
		const store = createCrdtAppendStore(db, {
			lockOwnerRow: async (_transaction, owner) => {
				ownerLocks++;
				return owner;
			},
		});
		const staged = await appendInput(fixture);

		await expect(store.append({ ...staged })).rejects.toMatchObject({
			code: "CRDT_APPEND_REJECTED",
		});
		expect(ownerLocks).toBe(0);
		expect(await db.select().from(questpieCrdtCommitTable)).toHaveLength(0);
	});

	it("requires current read authority before returning an exact retry receipt", async () => {
		const store = createCrdtAppendStore(db, { lockOwnerRow });
		const staged = await appendInput(fixture);
		await store.append(staged);
		await db
			.update(questpieCrdtResourceTable)
			.set({ readFence: 1n, editFence: 1n })
			.where(eq(questpieCrdtResourceTable.id, RESOURCE_ID));

		await expect(store.append(staged)).rejects.toMatchObject({
			code: "CRDT_APPEND_REJECTED",
		});
	});

	it("returns an exact readable retry after edit-only revocation", async () => {
		const store = createCrdtAppendStore(db, { lockOwnerRow });
		const staged = await appendInput(fixture);
		const first = await store.append(staged);
		await db
			.update(questpieCrdtResourceTable)
			.set({ editFence: 1n })
			.where(eq(questpieCrdtResourceTable.id, RESOURCE_ID));

		expect(await store.append(staged)).toEqual(first);
		expect(await db.select().from(questpieCrdtCommitTable)).toHaveLength(1);
	});

	it("rejects update-id reuse with different immutable input", async () => {
		const store = createCrdtAppendStore(db, { lockOwnerRow });
		const input = await appendInput(fixture);
		await store.append(input);
		const conflicting = await appendInput(
			fixture,
			UPDATE_ID,
			encodeDeterministicTextUpdate([{ type: "insert", index: 6, value: "?" }]),
		);

		await expect(store.append(conflicting)).rejects.toMatchObject({
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
		const input = await appendInput(fixture);
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

	it("restages a stale basis with a bounded retry", async () => {
		const store = createCrdtAppendStore(db, { lockOwnerRow });
		await db
			.update(questpieCrdtBindingTable)
			.set({ headFieldCursor: 1n })
			.where(eq(questpieCrdtBindingTable.id, fixture.binding.id));
		const attempts: number[] = [];

		const receipt = await store.appendWithRestage(async (attempt) => {
			attempts.push(attempt);
			return appendInput(
				fixture,
				UPDATE_ID,
				appendUpdateBytes(),
				BigInt(attempt),
			);
		});

		expect(attempts).toEqual([0, 1]);
		expect(receipt.fieldCursors).toEqual([
			{ fieldSlot: fixture.binding.fieldSlot, fieldCursor: 2n },
		]);
		expect(await db.select().from(questpieCrdtCommitTable)).toHaveLength(1);
	});

	it("rolls back the whole append when a durable rate budget is exhausted", async () => {
		const store = createCrdtAppendStore(db, { lockOwnerRow });
		await db
			.update(questpieCrdtSessionTable)
			.set({
				updateTokens: 0n,
				updateRefilledAt: new Date(Date.now() + 60_000),
			})
			.where(eq(questpieCrdtSessionTable.id, SESSION_ID));

		await expect(
			store.append(await appendInput(fixture)),
		).rejects.toMatchObject({
			code: "CRDT_APPEND_REJECTED",
		});
		expect(await db.select().from(questpieCrdtCommitTable)).toHaveLength(0);
		expect(await db.select().from(questpieCrdtUpdateReceiptTable)).toHaveLength(
			0,
		);
		const [binding] = await db
			.select()
			.from(questpieCrdtBindingTable)
			.where(eq(questpieCrdtBindingTable.id, fixture.binding.id));
		expect(binding?.headFieldCursor).toBe(0n);
	});

	it("rejects a combined bundle crossing 1 MiB before opening a transaction", async () => {
		const replica = await textEngine.create({
			value: "Shared",
			basis: { fieldEpoch: 1n, fieldCursor: 0n },
		});

		await expect(
			stageCrdtAggregateBundle({
				aggregateEpoch: 1n,
				submittedSchemaVersion: 1,
				canonicalSchemaVersion: 1,
				parts: Array.from({ length: 5 }, (_, index) => ({
					fieldSlot: index + 1,
					engine: textEngine,
					replica,
					update: new Uint8Array(220 * 1024),
				})),
			}),
		).rejects.toThrow("aggregate update bundle exceeds limit");
		expect(await db.select().from(questpieCrdtCommitTable)).toHaveLength(0);
	});

	it("reconciles a lost ACK with read authority after edit revocation", async () => {
		const store = createCrdtAppendStore(db, { lockOwnerRow });
		const input = await appendInput(fixture);
		const committed = await store.append(input);
		await db
			.update(questpieCrdtResourceTable)
			.set({ editFence: 1n })
			.where(eq(questpieCrdtResourceTable.id, RESOURCE_ID));

		const receipts = await store.reconcileReceipts({
			resourceId: RESOURCE_ID,
			resourceEpochId: fixture.resourceEpochId,
			sessionId: SESSION_ID,
			subjectId: SUBJECT_ID,
			authority: { ...input.authority, resourceEditFence: 1n },
			entries: [
				{
					updateId: UPDATE_ID,
					submittedBundleHash: input.submittedBundleHash,
					submittedSchemaVersion: input.submittedSchemaVersion,
				},
			],
		});

		expect(receipts).toEqual([committed]);
	});

	it("makes a wrong receipt hash indistinguishable from absent", async () => {
		const store = createCrdtAppendStore(db, { lockOwnerRow });
		const input = await appendInput(fixture);
		await store.append(input);

		const receipts = await store.reconcileReceipts({
			resourceId: RESOURCE_ID,
			resourceEpochId: fixture.resourceEpochId,
			sessionId: SESSION_ID,
			subjectId: SUBJECT_ID,
			authority: input.authority,
			entries: [
				{
					updateId: UPDATE_ID,
					submittedBundleHash: Buffer.alloc(32, 0x7f),
					submittedSchemaVersion: input.submittedSchemaVersion,
				},
			],
		});

		expect(receipts).toEqual([]);
	});
});

const postgresUrl =
	process.env.QUESTPIE_CRDT_DATABASE_URL ??
	process.env.QUESTPIE_TRANSACTION_LOCK_DATABASE_URL;

describe.skipIf(!postgresUrl)(
	"CRDT atomic append store on PostgreSQL 15+",
	() => {
		const schemaName = `questpie_crdt_append_${randomUUID().replaceAll("-", "")}`;
		let admin: pg.Pool;
		let firstPool: pg.Pool;
		let secondPool: pg.Pool;
		let firstDb: ReturnType<typeof drizzlePg<typeof questpieCrdtTables>>;
		let secondDb: ReturnType<typeof drizzlePg<typeof questpieCrdtTables>>;
		let pgFixture: Awaited<ReturnType<typeof seedFixture>>;

		beforeAll(async () => {
			admin = new pg.Pool({ connectionString: postgresUrl, max: 1 });
			const version = await admin.query<{ server_version_num: string }>(
				"show server_version_num",
			);
			expect(
				Number(version.rows[0]?.server_version_num),
			).toBeGreaterThanOrEqual(150_000);
			await admin.query(`CREATE SCHEMA "${schemaName}"`);
			firstPool = new pg.Pool({
				connectionString: postgresUrl,
				max: 4,
				options: `-c search_path=${schemaName}`,
			});
			secondPool = new pg.Pool({
				connectionString: postgresUrl,
				max: 4,
				options: `-c search_path=${schemaName}`,
			});
			firstDb = drizzlePg(firstPool, { schema: questpieCrdtTables });
			secondDb = drizzlePg(secondPool, { schema: questpieCrdtTables });
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
			for (const statement of await generateMigration(
				empty,
				await generateDrizzleJson(questpieCrdtTables, empty.id),
			)) {
				if (statement.trim()) await firstDb.execute(sql.raw(statement));
			}
			await firstDb.execute(sql`
				CREATE TABLE articles (
					id text PRIMARY KEY,
					title text NOT NULL,
					content text NOT NULL
				)
			`);
			pgFixture = await seedFixture(firstDb);
		});

		afterAll(async () => {
			await firstPool?.end();
			await secondPool?.end();
			if (admin) {
				await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
				await admin.end();
			}
		});

		it("serializes same-basis appends across independent pools", async () => {
			const first = createCrdtAppendStore(firstDb, { lockOwnerRow });
			const second = createCrdtAppendStore(secondDb, { lockOwnerRow });
			const firstInput = await appendInput(pgFixture);
			const secondInput = await appendInput(
				pgFixture,
				"00000000-0000-4000-8000-000000000307",
			);

			const outcomes = await Promise.allSettled([
				first.append(firstInput),
				second.append(secondInput),
			]);

			expect(
				outcomes.filter((outcome) => outcome.status === "fulfilled"),
			).toHaveLength(1);
			expect(
				outcomes.filter((outcome) => outcome.status === "rejected"),
			).toHaveLength(1);
			expect(await firstDb.select().from(questpieCrdtCommitTable)).toHaveLength(
				1,
			);
			const [epoch] = await firstDb
				.select()
				.from(questpieCrdtResourceEpochTable)
				.where(
					eq(questpieCrdtResourceEpochTable.id, pgFixture.resourceEpochId),
				);
			expect(epoch?.headCommitSeq).toBe(1n);
		}, 30_000);
	},
);

async function lockOwnerRow(
	db: AnyDrizzleClient<any>,
	owner: { resourceId: string; definitionId: string },
) {
	const result = await db.execute(sql`
		SELECT id
		FROM articles
		WHERE id = 'article-1'
		FOR UPDATE
	`);
	const rows = Array.isArray(result)
		? result
		: ((result as { rows?: unknown[] }).rows ?? []);
	if (rows.length !== 1) throw new Error("CRDT owner row was not locked");
	return owner;
}

function appendUpdateBytes() {
	return encodeDeterministicTextUpdate([
		{ type: "insert", index: 6, value: "!" },
	]);
}

async function multiFieldAppendInput(
	fixture: Awaited<ReturnType<typeof seedFixture>>,
) {
	const parts = await Promise.all(
		fixture.bindings.map(async (binding) => {
			const value = binding.sourcePath === "title" ? "Shared" : "Body";
			return {
				fieldSlot: binding.fieldSlot,
				engine: textEngine,
				replica: await textEngine.create({
					value,
					basis: { fieldEpoch: 1n, fieldCursor: 0n },
				}),
				update: encodeDeterministicTextUpdate([
					{ type: "insert" as const, index: value.length, value: "!" },
				]),
			};
		}),
	);
	parts.sort((left, right) => left.fieldSlot - right.fieldSlot);
	const staged = await stageCrdtAggregateBundle({
		aggregateEpoch: 1n,
		submittedSchemaVersion: 1,
		canonicalSchemaVersion: 1,
		parts,
	});
	return prepareCrdtAppend({
		resourceId: RESOURCE_ID,
		resourceEpochId: fixture.resourceEpochId,
		definitionId: fixture.definitionId,
		schemaId: fixture.schemaId,
		sessionId: SESSION_ID,
		subjectId: SUBJECT_ID,
		updateId: UPDATE_ID,
		submittedSchemaId: fixture.schemaId,
		decisionExpiresAt: new Date(Date.now() + 30_000),
		authority: {
			resourceReadFence: 0n,
			resourceEditFence: 0n,
			ownerPolicyRevision: 0n,
			subjectReadFence: 0n,
			subjectEditFence: 0n,
			sessionGeneration: 0n,
		},
		overlay: fixture.bindings.map((binding) => ({
			bindingId: binding.id,
			stableFieldId: binding.stableFieldId,
			fieldEpoch: 1n,
			fieldCursor: 0n,
			readFence: 0n,
			editFence: 0n,
		})),
		staged,
		bindings: fixture.bindings.map((binding) => ({
			fieldSlot: binding.fieldSlot,
			bindingId: binding.id,
			stableFieldId: binding.stableFieldId,
		})),
	});
}

async function appendInput(
	fixture: Awaited<ReturnType<typeof seedFixture>>,
	updateId = UPDATE_ID,
	update = appendUpdateBytes(),
	baseFieldCursor = 0n,
) {
	const replica = await textEngine.create({
		value: "Shared",
		basis: { fieldEpoch: 1n, fieldCursor: baseFieldCursor },
	});
	const staged = await stageCrdtAggregateBundle({
		aggregateEpoch: 1n,
		submittedSchemaVersion: 1,
		canonicalSchemaVersion: 1,
		parts: [
			{
				fieldSlot: fixture.binding.fieldSlot,
				engine: textEngine,
				replica,
				update,
			},
		],
	});
	return prepareCrdtAppend({
		resourceId: RESOURCE_ID,
		resourceEpochId: fixture.resourceEpochId,
		definitionId: fixture.definitionId,
		schemaId: fixture.schemaId,
		sessionId: SESSION_ID,
		subjectId: SUBJECT_ID,
		updateId,
		submittedSchemaId: fixture.schemaId,
		decisionExpiresAt: new Date(Date.now() + 30_000),
		authority: {
			resourceReadFence: 0n,
			resourceEditFence: 0n,
			ownerPolicyRevision: 0n,
			subjectReadFence: 0n,
			subjectEditFence: 0n,
			sessionGeneration: 0n,
		},
		overlay: fixture.bindings.map((binding) => ({
			bindingId: binding.id,
			stableFieldId: binding.stableFieldId,
			fieldEpoch: 1n,
			fieldCursor: binding.id === fixture.binding.id ? baseFieldCursor : 0n,
			readFence: 0n,
			editFence: 0n,
		})),
		staged,
		bindings: [
			{
				bindingId: fixture.binding.id,
				stableFieldId: fixture.binding.stableFieldId,
				fieldSlot: fixture.binding.fieldSlot,
			},
		],
	});
}

async function seedFixture(db: AnyDrizzleClient<any>) {
	await db.execute(
		sql`INSERT INTO articles (id, title, content) VALUES ('article-1', 'Shared', 'Body')`,
	);
	const staged = await stageCrdtOwnerActivation({
		manifest,
		resourceId: RESOURCE_ID,
		values: { title: "Shared", content: "Body" },
		textEngine,
	});
	const identity = await db.transaction(async (tx) =>
		new CrdtOwnerLifecycleTransaction(tx).activate({
			staged,
			owner: {
				locator: canonicalCrdtCollectionLocator("article-1"),
				values: { title: "Shared", content: "Body" },
			},
			mode: "create",
		}),
	);
	const [resource] = await db
		.select()
		.from(questpieCrdtResourceTable)
		.where(eq(questpieCrdtResourceTable.id, RESOURCE_ID));
	const bindings = await db
		.select()
		.from(questpieCrdtBindingTable)
		.where(eq(questpieCrdtBindingTable.resourceId, RESOURCE_ID));
	const binding = bindings.find(
		(candidate) => candidate.sourcePath === "title",
	)!;
	const expiresAt = new Date(Date.now() + 60_000);
	const credentialFingerprint = Buffer.alloc(32, 0x41);
	await db.insert(questpieCrdtSubjectTable).values({
		id: SUBJECT_ID,
		kind: 1,
		issuerKey: "",
		subjectKey: "user-1",
		subjectHash: Buffer.alloc(32, 0x42),
	});
	await db.insert(questpieCrdtResourceAdmissionTable).values({
		resourceId: RESOURCE_ID,
		partTokens: 2_000n,
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
	await db.insert(questpieCrdtTicketGrantTable).values(
		bindings.map((candidate) => ({
			ticketId: TICKET_ID,
			resourceId: RESOURCE_ID,
			schemaId: identity.schemaId,
			bindingId: candidate.id,
			stableFieldId: candidate.stableFieldId,
			fieldEpoch: 1n,
			fieldSlot: candidate.fieldSlot,
			formatVersion: candidate.formatVersion,
			grant: 1,
			headFieldCursor: 0n,
			fieldReadFence: 0n,
			fieldEditFence: 0n,
			subjectFieldReadFence: 0n,
			subjectFieldEditFence: 0n,
		})),
	);
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
		updateTokens: 120n,
		updateByteTokens: 2n * 1024n * 1024n,
		awarenessTokens: 20n,
		leaseExpiresAt: expiresAt,
	});
	await db.insert(questpieCrdtSessionGrantTable).values(
		bindings.map((candidate) => ({
			sessionId: SESSION_ID,
			ticketId: TICKET_ID,
			resourceId: RESOURCE_ID,
			schemaId: identity.schemaId,
			bindingId: candidate.id,
			stableFieldId: candidate.stableFieldId,
			fieldEpoch: 1n,
			fieldSlot: candidate.fieldSlot,
			formatVersion: candidate.formatVersion,
			grant: 1,
			headFieldCursor: 0n,
			fieldReadFence: 0n,
			fieldEditFence: 0n,
			subjectFieldReadFence: 0n,
			subjectFieldEditFence: 0n,
		})),
	);
	return {
		...identity,
		definitionId: resource!.definitionId,
		resource: resource!,
		binding: binding!,
		bindings,
	};
}
