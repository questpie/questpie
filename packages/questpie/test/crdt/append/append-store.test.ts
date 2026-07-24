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
import { createHash, randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/pglite";
import pg from "pg";

import type { AnyDrizzleClient } from "../../../src/server/config/types.js";
import {
	createCrdtAppendStore,
	isCrdtProjectionFieldDirty,
	loadCrdtAuthoritativeReplica,
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
	questpieCrdtProjectionFieldTable,
	questpieCrdtProjectionTable,
	questpieCrdtResourceAdmissionTable,
	questpieCrdtResourceEpochTable,
	questpieCrdtResourceTable,
	questpieCrdtSessionGrantTable,
	questpieCrdtSessionTable,
	questpieCrdtSnapshotManifestTable,
	questpieCrdtSnapshotTable,
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

it("marks an older unprojected field dirty in a later aggregate cut", () => {
	expect(isCrdtProjectionFieldDirty(3n, 2n)).toBe(1);
	expect(isCrdtProjectionFieldDirty(2n, 2n)).toBe(0);
});

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
		const [projection] = await db.select().from(questpieCrdtProjectionTable);
		const [commit] = await db.select().from(questpieCrdtCommitTable);
		expect(projection?.targetCommitSeq).toBe(1n);
		expect(projection?.status).toBe(1);
		expect(projection!.dueAt.getTime() - commit!.committedAt.getTime()).toBe(
			5_000,
		);
		const projectionFields = await db
			.select()
			.from(questpieCrdtProjectionFieldTable);
		expect(projectionFields).toHaveLength(2);
		expect(
			projectionFields
				.filter((field) => field.shouldWrite === 1)
				.map((field) => field.targetFieldCursor),
		).toEqual([1n]);
		expect(epoch?.updateBytes).toBe(BigInt(appendUpdateBytes().byteLength));
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

	it("rolls back the first field when PostgreSQL rejects the second field insert", async () => {
		const secondSlot = Math.max(
			...fixture.bindings.map((binding) => binding.fieldSlot),
		);
		await db.execute(sql`
			CREATE FUNCTION fail_second_crdt_part() RETURNS trigger AS $$
			BEGIN
				IF NEW.field_slot = ${sql.raw(String(secondSlot))} THEN
					RAISE EXCEPTION 'injected second part failure';
				END IF;
				RETURN NEW;
			END;
			$$ LANGUAGE plpgsql;
		`);
		await db.execute(sql`
			CREATE TRIGGER fail_second_crdt_part
			BEFORE INSERT ON questpie_crdt_update
			FOR EACH ROW EXECUTE FUNCTION fail_second_crdt_part()
		`);
		const store = createCrdtAppendStore(db, { lockOwnerRow });

		await expect(
			store.append(await multiFieldAppendInput(fixture)),
		).rejects.toBeDefined();
		expect(await db.select().from(questpieCrdtCommitTable)).toHaveLength(0);
		expect(await db.select().from(questpieCrdtUpdateTable)).toHaveLength(0);
		expect(await db.select().from(questpieCrdtUpdateReceiptTable)).toHaveLength(
			0,
		);
		const bindings = await db
			.select()
			.from(questpieCrdtBindingTable)
			.where(eq(questpieCrdtBindingTable.resourceId, RESOURCE_ID));
		expect(bindings.map((binding) => binding.headFieldCursor)).toEqual([
			0n,
			0n,
		]);
		const [epoch] = await db
			.select()
			.from(questpieCrdtResourceEpochTable)
			.where(eq(questpieCrdtResourceEpochTable.id, fixture.resourceEpochId));
		expect(epoch?.headCommitSeq).toBe(0n);
		expect(epoch?.updateBytes).toBe(0n);
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

	it("rejects a staged candidate built from a non-authoritative replica", async () => {
		const authoritative = await loadCrdtAuthoritativeReplica(db, {
			bindingId: fixture.binding.id,
			engine: textEngine,
		});
		const forgedReplica = await textEngine.create({
			value: "Forged",
			basis: authoritative.replica.basis,
		});
		const staged = await stageCrdtAggregateBundle({
			aggregateEpoch: 1n,
			submittedSchemaVersion: 1,
			canonicalSchemaVersion: 1,
			parts: [
				{
					fieldSlot: fixture.binding.fieldSlot,
					engine: textEngine,
					replica: forgedReplica,
					update: encodeDeterministicTextUpdate([
						{ type: "insert", index: 6, value: "!" },
					]),
				},
			],
		});

		await expect(
			prepareCrdtAppend({
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
					fieldEpoch: binding.fieldEpoch,
					fieldCursor: binding.headFieldCursor,
					readFence: binding.readFence,
					editFence: binding.editFence,
				})),
				staged,
				authoritative: [authoritative],
			}),
		).rejects.toMatchObject({ code: "CRDT_APPEND_REJECTED" });
	});

	it("ignores a higher-cursor snapshot from an unpublished orphan manifest", async () => {
		const orphanManifestId = "00000000-0000-4000-8000-000000000311";
		const orphanReplica = await textEngine.create({
			value: "Orphan",
			basis: { fieldEpoch: 1n, fieldCursor: 5n },
		});
		const bytes = await textEngine.snapshot(orphanReplica);
		await db.insert(questpieCrdtSnapshotManifestTable).values({
			id: orphanManifestId,
			resourceId: RESOURCE_ID,
			resourceEpochId: fixture.resourceEpochId,
			definitionId: fixture.definitionId,
			schemaId: fixture.schemaId,
			coversCommitSeq: 0n,
			status: 1,
			totalBytes: bytes.byteLength,
			fieldCount: 1,
			checksum: Buffer.alloc(32, 0x61),
			leaseGeneration: 0n,
		});
		await db.insert(questpieCrdtSnapshotTable).values({
			manifestId: orphanManifestId,
			resourceId: RESOURCE_ID,
			resourceEpochId: fixture.resourceEpochId,
			schemaId: fixture.schemaId,
			bindingId: fixture.binding.id,
			stableFieldId: fixture.binding.stableFieldId,
			fieldEpoch: 1n,
			fieldSlot: fixture.binding.fieldSlot,
			formatVersion: fixture.binding.formatVersion,
			fieldCursor: 5n,
			engineId: textEngine.engineId,
			engineVersion: textEngine.engineVersion,
			stateVersion: textEngine.stateVersion,
			bytes,
			sizeBytes: bytes.byteLength,
			checksum: createHash("sha256").update(bytes).digest(),
		});

		const authoritative = await loadCrdtAuthoritativeReplica(db, {
			bindingId: fixture.binding.id,
			engine: textEngine,
		});

		expect(authoritative.replica.basis.fieldCursor).toBe(0n);
		expect(textEngine.project(authoritative.replica)).toBe("Shared");
	});

	it("falls back from a corrupt current manifest to the verified previous one", async () => {
		const [epoch] = await db
			.select()
			.from(questpieCrdtResourceEpochTable)
			.where(eq(questpieCrdtResourceEpochTable.id, fixture.resourceEpochId));
		const corruptManifestId = "00000000-0000-4000-8000-000000000312";
		const corruptBytes = new Uint8Array([0xff]);
		await db.insert(questpieCrdtSnapshotManifestTable).values({
			id: corruptManifestId,
			resourceId: RESOURCE_ID,
			resourceEpochId: fixture.resourceEpochId,
			definitionId: fixture.definitionId,
			schemaId: fixture.schemaId,
			coversCommitSeq: 0n,
			status: 2,
			totalBytes: corruptBytes.byteLength,
			fieldCount: 1,
			checksum: Buffer.alloc(32, 0x62),
			leaseGeneration: 0n,
			verifiedAt: new Date(),
		});
		await db.insert(questpieCrdtSnapshotTable).values({
			manifestId: corruptManifestId,
			resourceId: RESOURCE_ID,
			resourceEpochId: fixture.resourceEpochId,
			schemaId: fixture.schemaId,
			bindingId: fixture.binding.id,
			stableFieldId: fixture.binding.stableFieldId,
			fieldEpoch: 1n,
			fieldSlot: fixture.binding.fieldSlot,
			formatVersion: fixture.binding.formatVersion,
			fieldCursor: 0n,
			engineId: textEngine.engineId,
			engineVersion: textEngine.engineVersion,
			stateVersion: textEngine.stateVersion,
			bytes: corruptBytes,
			sizeBytes: corruptBytes.byteLength,
			checksum: createHash("sha256").update(corruptBytes).digest(),
		});
		await db
			.update(questpieCrdtResourceEpochTable)
			.set({
				currentSnapshotManifestId: corruptManifestId,
				currentSnapshotStatus: 2,
				previousSnapshotManifestId: epoch!.currentSnapshotManifestId,
				previousSnapshotStatus: 2,
			})
			.where(eq(questpieCrdtResourceEpochTable.id, fixture.resourceEpochId));

		const authoritative = await loadCrdtAuthoritativeReplica(db, {
			bindingId: fixture.binding.id,
			engine: textEngine,
		});

		expect(authoritative.replica.basis.fieldCursor).toBe(0n);
		expect(textEngine.project(authoritative.replica)).toBe("Shared");
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
		const targetUpdate = encodeDeterministicTextUpdate([
			{ type: "insert", index: 6, value: "?" },
		]);
		const staleCandidate = await appendInput(fixture, UPDATE_ID, targetUpdate);
		await store.append(
			await appendInput(fixture, "00000000-0000-4000-8000-000000000310"),
		);
		const attempts: number[] = [];

		const receipt = await store.appendWithRestage(async (attempt) => {
			attempts.push(attempt);
			return attempt === 0
				? staleCandidate
				: appendInput(fixture, UPDATE_ID, targetUpdate);
		});

		expect(attempts).toEqual([0, 1]);
		expect(receipt.fieldCursors).toEqual([
			{ fieldSlot: fixture.binding.fieldSlot, fieldCursor: 2n },
		]);
		expect(await db.select().from(questpieCrdtCommitTable)).toHaveLength(2);
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

function postgresPoolConfig(url: string): pg.PoolConfig {
	const parsed = new URL(url);
	return {
		database: parsed.pathname.slice(1),
		host: parsed.hostname,
		password: decodeURIComponent(parsed.password),
		port: parsed.port ? Number(parsed.port) : 5432,
		ssl: parsed.searchParams.get("sslmode") === "require",
		user: decodeURIComponent(parsed.username),
	};
}

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
			const poolConfig = postgresPoolConfig(postgresUrl!);
			admin = new pg.Pool({ ...poolConfig, max: 1 });
			const version = await admin.query<{ server_version_num: string }>(
				"show server_version_num",
			);
			expect(
				Number(version.rows[0]?.server_version_num),
			).toBeGreaterThanOrEqual(150_000);
			await admin.query(`CREATE SCHEMA "${schemaName}"`);
			firstPool = new pg.Pool({
				...poolConfig,
				max: 4,
				options: `-c search_path=${schemaName}`,
			});
			secondPool = new pg.Pool({
				...poolConfig,
				max: 4,
				options: `-c search_path=${schemaName}`,
			});
			firstDb = drizzlePg({
				client: firstPool,
				schema: questpieCrdtTables,
			});
			secondDb = drizzlePg({
				client: secondPool,
				schema: questpieCrdtTables,
			});
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

		it("serializes 50-way contention, visibility, and both revoke orders", async () => {
			const wakes: unknown[] = [];
			const first = createCrdtAppendStore(firstDb, {
				lockOwnerRow,
				publishNotice: async (notice) => {
					wakes.push(notice);
				},
			});
			const second = createCrdtAppendStore(secondDb, {
				lockOwnerRow,
				publishNotice: async (notice) => {
					wakes.push(notice);
				},
			});
			const firstInput = await appendInput(pgFixture);
			const contenders = await Promise.all(
				Array.from({ length: 50 }, (_, index) =>
					appendInput(
						pgFixture,
						`00000000-0000-4000-8000-${String(index + 400).padStart(12, "0")}`,
					),
				),
			);

			const outcomes = await Promise.allSettled(
				[firstInput, ...contenders].map((input, index) =>
					(index % 2 === 0 ? first : second).append(input),
				),
			);

			expect(
				outcomes.filter((outcome) => outcome.status === "fulfilled"),
			).toHaveLength(1);
			expect(
				outcomes.filter((outcome) => outcome.status === "rejected"),
			).toHaveLength(50);
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
			const wakesBeforePausedAppend = wakes.length;

			await firstDb.execute(
				sql.raw(`
				CREATE FUNCTION pause_crdt_receipt() RETURNS trigger AS $$
				BEGIN
					PERFORM pg_advisory_xact_lock(424242);
					RETURN NEW;
				END;
				$$ LANGUAGE plpgsql
			`),
			);
			await firstDb.execute(
				sql.raw(`
				CREATE TRIGGER pause_crdt_receipt
				BEFORE INSERT ON questpie_crdt_update_receipt
				FOR EACH ROW EXECUTE FUNCTION pause_crdt_receipt()
			`),
			);
			await admin.query("SELECT pg_advisory_lock(424242)");
			const appendWinsCandidate = await appendInput(
				pgFixture,
				"00000000-0000-4000-8000-000000000998",
				encodeDeterministicTextUpdate([
					{ type: "insert", index: 7, value: "?" },
				]),
			);
			const appendWins = second.append(appendWinsCandidate);
			for (let attempt = 0; attempt < 200; attempt++) {
				const waiting = await firstPool.query<{ waiting: boolean }>(
					"SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted) AS waiting",
				);
				if (waiting.rows[0]?.waiting) break;
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
			expect(await firstDb.select().from(questpieCrdtCommitTable)).toHaveLength(
				1,
			);
			const [invisibleEpoch] = await firstDb
				.select()
				.from(questpieCrdtResourceEpochTable)
				.where(
					eq(questpieCrdtResourceEpochTable.id, pgFixture.resourceEpochId),
				);
			expect(invisibleEpoch?.headCommitSeq).toBe(1n);
			expect(wakes).toHaveLength(wakesBeforePausedAppend);
			const appendThenRevoke = firstDb.transaction(async (tx) => {
				await lockOwnerRow(tx, {
					resourceId: RESOURCE_ID,
					definitionId: pgFixture.definitionId,
				});
				await tx
					.select()
					.from(questpieCrdtResourceTable)
					.where(eq(questpieCrdtResourceTable.id, RESOURCE_ID))
					.for("update");
				await tx
					.update(questpieCrdtResourceTable)
					.set({ editFence: 1n })
					.where(eq(questpieCrdtResourceTable.id, RESOURCE_ID));
			});
			await admin.query("SELECT pg_advisory_unlock(424242)");
			expect((await appendWins).commitSeq).toBe(2n);
			expect(wakes).toHaveLength(wakesBeforePausedAppend + 1);
			await appendThenRevoke;
			expect(await firstDb.select().from(questpieCrdtCommitTable)).toHaveLength(
				2,
			);
			await firstDb.execute(
				sql`DROP TRIGGER pause_crdt_receipt ON questpie_crdt_update_receipt`,
			);
			await firstDb
				.update(questpieCrdtResourceTable)
				.set({ editFence: 0n })
				.where(eq(questpieCrdtResourceTable.id, RESOURCE_ID));

			let releaseRevoke!: () => void;
			const release = new Promise<void>((resolve) => {
				releaseRevoke = resolve;
			});
			let announceLocked!: () => void;
			const locked = new Promise<void>((resolve) => {
				announceLocked = resolve;
			});
			const revoke = firstDb.transaction(async (tx) => {
				await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
				await lockOwnerRow(tx, {
					resourceId: RESOURCE_ID,
					definitionId: pgFixture.definitionId,
				});
				await tx
					.select()
					.from(questpieCrdtResourceTable)
					.where(eq(questpieCrdtResourceTable.id, RESOURCE_ID))
					.for("update");
				announceLocked();
				await release;
				await tx
					.update(questpieCrdtResourceTable)
					.set({ editFence: 1n })
					.where(eq(questpieCrdtResourceTable.id, RESOURCE_ID));
			});
			await locked;
			const afterFirst = await appendInput(
				pgFixture,
				"00000000-0000-4000-8000-000000000999",
				encodeDeterministicTextUpdate([
					{ type: "insert", index: 8, value: "#" },
				]),
			);
			const racedAppend = second.append(afterFirst);
			releaseRevoke();
			await revoke;

			await expect(racedAppend).rejects.toMatchObject({
				code: "CRDT_APPEND_REJECTED",
			});
			expect(await firstDb.select().from(questpieCrdtCommitTable)).toHaveLength(
				2,
			);
		}, 60_000);
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
	const authoritative = await Promise.all(
		fixture.bindings.map((binding) =>
			loadCrdtAuthoritativeReplica(fixture.db, {
				bindingId: binding.id,
				engine: textEngine,
			}),
		),
	);
	const parts = await Promise.all(
		authoritative.map(async (binding) => {
			const stored = fixture.bindings.find(
				(candidate) => candidate.id === binding.bindingId,
			)!;
			const value = stored.sourcePath === "title" ? "Shared" : "Body";
			return {
				fieldSlot: binding.fieldSlot,
				engine: textEngine,
				replica: binding.replica,
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
		authoritative,
	});
}

async function appendInput(
	fixture: Awaited<ReturnType<typeof seedFixture>>,
	updateId = UPDATE_ID,
	update = appendUpdateBytes(),
) {
	const authoritative = await loadCrdtAuthoritativeReplica(fixture.db, {
		bindingId: fixture.binding.id,
		engine: textEngine,
	});
	const currentBindings = await fixture.db
		.select()
		.from(questpieCrdtBindingTable)
		.where(eq(questpieCrdtBindingTable.resourceId, RESOURCE_ID));
	const staged = await stageCrdtAggregateBundle({
		aggregateEpoch: 1n,
		submittedSchemaVersion: 1,
		canonicalSchemaVersion: 1,
		parts: [
			{
				fieldSlot: fixture.binding.fieldSlot,
				engine: textEngine,
				replica: authoritative.replica,
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
		overlay: currentBindings.map((binding) => ({
			bindingId: binding.id,
			stableFieldId: binding.stableFieldId,
			fieldEpoch: 1n,
			fieldCursor: binding.headFieldCursor,
			readFence: 0n,
			editFence: 0n,
		})),
		staged,
		authoritative: [authoritative],
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
		db,
	};
}
