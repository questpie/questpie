import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";

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
	questpieCrdtUpdateTable,
} from "../../../src/server/modules/core/integrated/crdt/schema.js";
import { createCrdtDatabaseSyncSource } from "../../../src/server/modules/core/integrated/crdt/sync-store.js";

const RESOURCE_ID = "00000000-0000-4000-8000-000000000501";
const SUBJECT_ID = "00000000-0000-4000-8000-000000000502";
const TICKET_ID = "00000000-0000-4000-8000-000000000503";
const SESSION_ID = "00000000-0000-4000-8000-000000000504";
const CORRUPT_MANIFEST_ID = "00000000-0000-4000-8000-000000000505";
const RESET_BINDING_ID = "00000000-0000-4000-8000-000000000508";
const stableFieldIds = [
	"00000000-0000-4000-8000-000000000506",
	"00000000-0000-4000-8000-000000000507",
] as const;
const textEngine = createDeterministicTextEngine();
let stableFieldIndex = 0;
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
const manifest = resolveCrdtDesiredManifest(
	updateCrdtManifestArtifact({
		namespace: "sync-test",
		declarations: [declarations],
		createStableFieldId: () => stableFieldIds[stableFieldIndex++]!,
	}),
	declarations,
);

describe("CRDT repeatable aggregate sync store", () => {
	let client: PGlite;
	let db: ReturnType<typeof drizzle<typeof questpieCrdtTables>>;
	let fixture: Awaited<ReturnType<typeof seed>>;

	beforeAll(async () => {
		client = await PGlite.create();
		db = drizzle(client, { schema: questpieCrdtTables });
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
			if (statement.trim()) await db.execute(sql.raw(statement));
		}
		await db.execute(sql`
			CREATE TABLE articles (
				id text PRIMARY KEY,
				title text NOT NULL,
				content text NOT NULL
			)
		`);
		fixture = await seed(db);
	});

	afterAll(async () => {
		await client.close();
	});

	it("materializes one repeatable aggregate cut and no hidden field bytes", async () => {
		let resolved = 0;
		const source = createCrdtDatabaseSyncSource(db, {
			resolveEngine: () => {
				resolved++;
				return textEngine;
			},
		});

		const basis = await source.captureBasis(SESSION_ID);

		expect(basis.commitHead).toBe(0n);
		expect(basis.fields.map((field) => field.fieldSlot)).toEqual([
			fixture.title.fieldSlot,
		]);
		expect(resolved).toBe(1);
		const replica = await textEngine.restore({
			snapshot: basis.fields[0]!.bytes,
			basis: {
				fieldEpoch: basis.fields[0]!.fieldEpoch,
				fieldCursor: basis.fields[0]!.fieldCursor,
			},
		});
		expect(textEngine.project(replica)).toBe("Shared");
	});

	it("falls back the whole aggregate when one current snapshot is corrupt", async () => {
		const [epoch] = await db
			.select()
			.from(questpieCrdtResourceEpochTable)
			.where(eq(questpieCrdtResourceEpochTable.id, fixture.resourceEpochId));
		const snapshots = await db
			.select()
			.from(questpieCrdtSnapshotTable)
			.where(
				eq(
					questpieCrdtSnapshotTable.manifestId,
					epoch!.currentSnapshotManifestId!,
				),
			);
		const corruptBytes = new Uint8Array([0xff]);
		await db.insert(questpieCrdtSnapshotManifestTable).values({
			id: CORRUPT_MANIFEST_ID,
			resourceId: RESOURCE_ID,
			resourceEpochId: fixture.resourceEpochId,
			definitionId: fixture.definitionId,
			schemaId: fixture.schemaId,
			coversCommitSeq: 0n,
			status: 2,
			totalBytes: snapshots.reduce(
				(total, snapshot) => total + snapshot.sizeBytes,
				0,
			),
			fieldCount: snapshots.length,
			checksum: Buffer.alloc(32, 0x71),
			leaseGeneration: 0n,
			verifiedAt: new Date(),
		});
		await db.insert(questpieCrdtSnapshotTable).values(
			snapshots.map((snapshot, index) => {
				const bytes = index === 0 ? corruptBytes : snapshot.bytes;
				return {
					...snapshot,
					manifestId: CORRUPT_MANIFEST_ID,
					bytes,
					sizeBytes: bytes.byteLength,
					checksum: createHash("sha256").update(bytes).digest(),
				};
			}),
		);
		await db
			.update(questpieCrdtResourceEpochTable)
			.set({
				currentSnapshotManifestId: CORRUPT_MANIFEST_ID,
				currentSnapshotStatus: 2,
				previousSnapshotManifestId: epoch!.currentSnapshotManifestId,
				previousSnapshotStatus: 2,
			})
			.where(eq(questpieCrdtResourceEpochTable.id, fixture.resourceEpochId));

		const source = createCrdtDatabaseSyncSource(db, {
			resolveEngine: () => textEngine,
		});
		const basis = await source.captureBasis(SESSION_ID);
		const replica = await textEngine.restore({
			snapshot: basis.fields[0]!.bytes,
			basis: {
				fieldEpoch: basis.fields[0]!.fieldEpoch,
				fieldCursor: basis.fields[0]!.fieldCursor,
			},
		});
		expect(textEngine.project(replica)).toBe("Shared");
	});

	it("advances a hidden-only commit envelope without selecting its update payload", async () => {
		const content = fixture.bindings.find(
			(binding) => binding.sourcePath === "content",
		)!;
		const bytes = encodeDeterministicTextUpdate([
			{ type: "insert", index: 4, value: " hidden" },
		]);
		await db.insert(questpieCrdtCommitTable).values({
			resourceId: RESOURCE_ID,
			resourceEpochId: fixture.resourceEpochId,
			definitionId: fixture.definitionId,
			commitSeq: 1n,
			kind: 1,
			schemaId: fixture.schemaId,
			canonicalBundleHash: Buffer.alloc(32, 0x72),
			deliveryCommitId: "00000000-0000-4000-8000-000000000509",
			subjectId: SUBJECT_ID,
			sessionId: SESSION_ID,
		});
		await db.insert(questpieCrdtUpdateTable).values({
			resourceId: RESOURCE_ID,
			resourceEpochId: fixture.resourceEpochId,
			commitSeq: 1n,
			schemaId: fixture.schemaId,
			fieldSlot: content.fieldSlot,
			bindingId: content.id,
			stableFieldId: content.stableFieldId,
			fieldEpoch: content.fieldEpoch,
			formatVersion: content.formatVersion,
			baseFieldCursor: 0n,
			fieldCursor: 1n,
			bytes,
			sizeBytes: bytes.byteLength,
			checksum: createHash("sha256").update(bytes).digest(),
		});
		await db
			.update(questpieCrdtResourceEpochTable)
			.set({ headCommitSeq: 1n })
			.where(eq(questpieCrdtResourceEpochTable.id, fixture.resourceEpochId));
		await db
			.update(questpieCrdtBindingTable)
			.set({ headFieldCursor: 1n })
			.where(eq(questpieCrdtBindingTable.id, content.id));
		const source = createCrdtDatabaseSyncSource(db, {
			resolveEngine: () => textEngine,
		});
		const basis = await source.captureBasis(SESSION_ID);

		const commits = await source.readCommits(basis, 0n, 1n);

		expect(commits).toHaveLength(1);
		expect(commits[0]!.fields).toEqual([]);
	});

	it("turns a durable field-reset control into a live reset without invalidating the aggregate basis", async () => {
		const rollback = new Error("rollback field-reset fixture");
		await expect(
			db.transaction(async (transaction) => {
				const source = createCrdtDatabaseSyncSource(transaction, {
					resolveEngine: () => textEngine,
				});
				const basis = await source.captureBasis(SESSION_ID);
				const commitSeq = basis.commitHead + 1n;
				await transaction
					.update(questpieCrdtBindingTable)
					.set({ status: 2, retiredAt: new Date() })
					.where(eq(questpieCrdtBindingTable.id, fixture.title.id));
				await transaction.insert(questpieCrdtBindingTable).values({
					...fixture.title,
					id: RESET_BINDING_ID,
					fieldEpoch: fixture.title.fieldEpoch + 1n,
					headFieldCursor: 0n,
					projectedFieldCursor: 0n,
					status: 1,
					retiredAt: null,
				});
				const [epoch] = await transaction
					.select()
					.from(questpieCrdtResourceEpochTable)
					.where(
						eq(questpieCrdtResourceEpochTable.id, fixture.resourceEpochId),
					);
				const [sourceSnapshot] = await transaction
					.select()
					.from(questpieCrdtSnapshotTable)
					.where(eq(questpieCrdtSnapshotTable.bindingId, fixture.title.id))
					.limit(1);
				if (!epoch?.currentSnapshotManifestId || !sourceSnapshot) {
					throw new Error("expected reset source snapshot");
				}
				await transaction.insert(questpieCrdtSnapshotTable).values({
					...sourceSnapshot,
					manifestId: epoch.currentSnapshotManifestId,
					bindingId: RESET_BINDING_ID,
					fieldEpoch: fixture.title.fieldEpoch + 1n,
					fieldCursor: 0n,
				});
				await transaction.insert(questpieCrdtCommitTable).values({
					resourceId: RESOURCE_ID,
					resourceEpochId: fixture.resourceEpochId,
					definitionId: fixture.definitionId,
					commitSeq,
					kind: 2,
					schemaId: fixture.schemaId,
					canonicalBundleHash: Buffer.alloc(32, 0x73),
					deliveryCommitId: "00000000-0000-4000-8000-000000000510",
					controlPayload: {
						version: 1,
						kind: "field_reset",
						stableFieldId: fixture.title.stableFieldId,
						sourceBindingId: fixture.title.id,
						targetBindingId: RESET_BINDING_ID,
						sourceFieldEpoch: fixture.title.fieldEpoch.toString(),
						targetFieldEpoch: (fixture.title.fieldEpoch + 1n).toString(),
						reason: "restore",
					},
				});
				await transaction
					.update(questpieCrdtResourceEpochTable)
					.set({ headCommitSeq: commitSeq })
					.where(
						eq(questpieCrdtResourceEpochTable.id, fixture.resourceEpochId),
					);

				expect(await source.readHead(basis)).toBe(commitSeq);
				const [commit] = await source.readCommits(
					basis,
					basis.commitHead,
					commitSeq,
				);
				expect(commit?.kind).toBe(2);
				if (commit?.kind !== 2) throw new Error("expected field reset");
				expect(commit.transition).toEqual({
					fieldSlot: fixture.title.fieldSlot,
					grant: 1,
					fieldEpoch: fixture.title.fieldEpoch + 1n,
					headFieldCursor: 0n,
				});
				throw rollback;
			}),
		).rejects.toBe(rollback);
	});

	it("rejects an exact authority cut after its binding fence changes", async () => {
		const source = createCrdtDatabaseSyncSource(db, {
			resolveEngine: () => textEngine,
		});
		const basis = await source.captureBasis(SESSION_ID);
		await db
			.update(questpieCrdtBindingTable)
			.set({ readFence: 1n })
			.where(eq(questpieCrdtBindingTable.id, fixture.title.id));

		await expect(source.validateBasis!(basis)).rejects.toThrow(
			"CRDT synchronization rejected",
		);
	});
});

async function seed(db: ReturnType<typeof drizzle<typeof questpieCrdtTables>>) {
	await db.execute(
		sql`INSERT INTO articles (id, title, content) VALUES ('article-1', 'Shared', 'Body')`,
	);
	const staged = await stageCrdtOwnerActivation({
		manifest,
		resourceId: RESOURCE_ID,
		values: { title: "Shared", content: "Body" },
		textEngine,
	});
	const identity = await db.transaction(async (transaction) =>
		new CrdtOwnerLifecycleTransaction(transaction).activate({
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
	const title = bindings.find((binding) => binding.sourcePath === "title")!;
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
	await db.insert(questpieCrdtTicketGrantTable).values(
		bindings.map((binding) => ({
			ticketId: TICKET_ID,
			resourceId: RESOURCE_ID,
			schemaId: identity.schemaId,
			bindingId: binding.id,
			stableFieldId: binding.stableFieldId,
			fieldEpoch: binding.fieldEpoch,
			fieldSlot: binding.fieldSlot,
			formatVersion: binding.formatVersion,
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
	await db.insert(questpieCrdtSessionGrantTable).values({
		sessionId: SESSION_ID,
		ticketId: TICKET_ID,
		resourceId: RESOURCE_ID,
		schemaId: identity.schemaId,
		bindingId: title.id,
		stableFieldId: title.stableFieldId,
		fieldEpoch: title.fieldEpoch,
		fieldSlot: title.fieldSlot,
		formatVersion: title.formatVersion,
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
		title,
		bindings,
	};
}
