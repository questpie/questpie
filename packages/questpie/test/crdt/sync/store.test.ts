import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/pglite";
import pg from "pg";

import { collectCrdtGarbage } from "../../../src/server/modules/core/integrated/crdt/compaction-store.js";
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
	CrdtPullBusyError,
	CrdtPullRecoveryRequiredError,
	createCrdtPullStore,
} from "../../../src/server/modules/core/integrated/crdt/pull-store.js";
import {
	questpieCrdtBindingTable,
	questpieCrdtCommitTable,
	questpieCrdtPullPageTable,
	questpieCrdtPullTable,
	questpieCrdtResourceAdmissionTable,
	questpieCrdtResourceEpochTable,
	questpieCrdtResourceTable,
	questpieCrdtSessionGrantTable,
	questpieCrdtSessionTable,
	questpieCrdtSnapshotManifestTable,
	questpieCrdtSubjectAdmissionTable,
	questpieCrdtSubjectTable,
	questpieCrdtTables,
} from "../../../src/server/modules/core/integrated/crdt/schema.js";
import {
	createCrdtDatabaseSyncSource,
	materializeCrdtAggregateAtCut,
} from "../../../src/server/modules/core/integrated/crdt/sync-store.js";
import { hashCrdtSubmittedAggregateBundle } from "../../../src/shared/crdt-engine.js";
import { decodeCrdtExchangeFrameV1 } from "../../../src/shared/crdt-exchange.js";

const RESOURCE_ID = "00000000-0000-4000-8000-000000000501";
const SUBJECT_ID = "00000000-0000-4000-8000-000000000502";
const SESSION_ID = "00000000-0000-4000-8000-000000000504";
const UPDATE_ID = "00112233-4455-6677-8899-aabbccddeeff";
const SECOND_UPDATE_ID = "10213243-5465-7687-98a9-bacbdcedfe0f";
const READ_SESSION_ID = "00000000-0000-4000-8000-000000000512";
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
const testAppendDependencies: Pick<
	Parameters<typeof createCrdtDatabaseSyncSource>[1],
	"lockOwnerRow" | "publishNotice"
> = {
	async lockOwnerRow(transaction, identity) {
		await transaction.execute(
			sql`SELECT id FROM articles WHERE id = 'article-1' FOR UPDATE`,
		);
		return identity;
	},
	async publishNotice() {},
};

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

	it("captures exact session authority without resolving or materializing field engines", async () => {
		let resolved = 0;
		const source = createCrdtDatabaseSyncSource(db, {
			resolveEngine: () => {
				resolved++;
				throw new Error("authority capture must not resolve an engine");
			},
			...testAppendDependencies,
		});

		const basis = await source.captureAuthorityBasis(SESSION_ID);
		const [session] = await db
			.select()
			.from(questpieCrdtSessionTable)
			.where(eq(questpieCrdtSessionTable.id, SESSION_ID));

		expect(resolved).toBe(0);
		expect(basis.bindingId).toBe(session!.bindingId);
		expect(basis.sessionGeneration).toBe(session!.generation);
		expect(basis.deliveryGeneration).toBe(session!.deliveryGeneration);
		expect(basis.aggregateEpoch).toBe(1n);
		expect(basis.schemaVersion).toBe(1);
		expect(basis.fields).toEqual([
			{
				bindingId: fixture.title.id,
				fieldSlot: fixture.title.fieldSlot,
				fieldEpoch: fixture.title.fieldEpoch,
				grant: 1,
				formatVersion: fixture.title.formatVersion,
				readFence: fixture.title.readFence,
				editFence: fixture.title.editFence,
				fieldCursor: fixture.title.headFieldCursor,
			},
		]);
	});

	it("round-trips opaque pull ids without RFC version or variant bits", async () => {
		const authorization = await currentAuthorization(db, fixture);
		const pullId = "00000000-0000-0000-0000-000000000560";
		const store = createCrdtPullStore(db, {
			namespace: "sync-test",
			deploymentFingerprint: "deployment-a",
			secret: "test-secret-that-is-long-enough",
			resolveEngine: () => textEngine,
		});

		const page = await store.pull({
			claim: {
				sessionId: SESSION_ID,
				bindingId: authorization.bindingId,
				resourceId: RESOURCE_ID,
				requestedMode: "edit",
				effectiveMode: "edit",
				sessionGeneration: 0n,
				deliveryGeneration: 0n,
			},
			authorization: authorization.snapshot,
			pullId,
			schemaVersion: manifest.version,
			continuation: null,
			proofs: [
				{
					fieldSlot: fixture.title.fieldSlot,
					fieldEpoch: fixture.title.fieldEpoch,
					proof: Uint8Array.of(1),
				},
			],
		});

		const frame = decodeStoredPull(page.payload);
		expect(frame.opcode).toBe(0x81);
		if (frame.opcode !== 0x81) throw new Error("expected pull page");
		expect(Buffer.from(frame.payload.pullId)).toEqual(
			Buffer.from(pullId.replaceAll("-", ""), "hex"),
		);
		await expireAndCollectPulls(db, store, [pullId]);
	});

	it("stops awaiting pull materialization when the request is aborted", async () => {
		const authorization = await currentAuthorization(db, fixture);
		let startDiff!: () => void;
		const diffStarted = new Promise<void>((resolve) => {
			startDiff = resolve;
		});
		const blockedEngine = {
			...textEngine,
			async diff(): Promise<never> {
				startDiff();
				return new Promise(() => {});
			},
		};
		const store = createCrdtPullStore(db, {
			namespace: "sync-test",
			deploymentFingerprint: "deployment-a",
			secret: "test-secret-that-is-long-enough",
			resolveEngine: () => blockedEngine,
		});
		const pullId = "00000000-0000-4000-8000-000000000559";
		const controller = new AbortController();
		const operation = store.pull({
			claim: {
				sessionId: SESSION_ID,
				bindingId: authorization.bindingId,
				resourceId: RESOURCE_ID,
				requestedMode: "edit",
				effectiveMode: "edit",
				sessionGeneration: 0n,
				deliveryGeneration: 0n,
			},
			authorization: authorization.snapshot,
			pullId,
			schemaVersion: manifest.version,
			continuation: null,
			proofs: [
				{
					fieldSlot: fixture.title.fieldSlot,
					fieldEpoch: fixture.title.fieldEpoch,
					proof: Uint8Array.of(1),
				},
			],
			signal: controller.signal,
		});
		await diffStarted;

		controller.abort(new DOMException("client left", "AbortError"));

		await expect(
			Promise.race([
				operation,
				new Promise<never>((_resolve, reject) =>
					setTimeout(() => reject(new Error("pull did not abort")), 100),
				),
			]),
		).rejects.toBeInstanceOf(CrdtPullRecoveryRequiredError);
		await expireAndCollectPulls(db, store, [pullId]);
	});

	it("returns the durable duplicate receipt before staging the update again", async () => {
		let stageCount = 0;
		const countingEngine = {
			...textEngine,
			async stage(
				input: Parameters<typeof textEngine.stage>[0],
			): ReturnType<typeof textEngine.stage> {
				stageCount++;
				return textEngine.stage(input);
			},
		};
		const notices: unknown[] = [];
		const source = createCrdtDatabaseSyncSource(db, {
			resolveEngine: () => countingEngine,
			lockOwnerRow: async (transaction, identity) => {
				await transaction.execute(
					sql`SELECT id FROM articles WHERE id = 'article-1' FOR UPDATE`,
				);
				return identity;
			},
			publishNotice: async (notice) => {
				notices.push(notice);
			},
		});
		const basis = await source.captureAuthorityBasis(SESSION_ID);
		const field = basis.fields[0]!;
		const update = {
			updateId: uuidBytes(UPDATE_ID),
			aggregateEpoch: basis.aggregateEpoch,
			schemaVersion: basis.schemaVersion,
			parts: [
				{
					fieldSlot: field.fieldSlot,
					fieldEpoch: field.fieldEpoch,
					formatVersion: field.formatVersion,
					baseFieldCursor: field.fieldCursor,
					bytes: encodeDeterministicTextUpdate([
						{ type: "insert" as const, index: 6, value: "!" },
					]),
				},
			],
		};

		const first = await source.submitUpdate!(basis, update);
		const duplicate = await source.submitUpdate!(basis, update);
		let duplicateAfterEditRevoke;
		let readOnlyReceipts;
		try {
			await db
				.update(questpieCrdtResourceTable)
				.set({ editFence: 1n })
				.where(eq(questpieCrdtResourceTable.id, RESOURCE_ID));
			duplicateAfterEditRevoke = await source.submitUpdate!(basis, update);
			await seedReadOnlySession(db, fixture);
			const readSource = createCrdtDatabaseSyncSource(db, {
				resolveEngine: () => textEngine,
				...testAppendDependencies,
			});
			const readBasis = await readSource.captureAuthorityBasis(READ_SESSION_ID);
			readOnlyReceipts = await readSource.reconcileReceipts!(readBasis, [
				{
					updateId: update.updateId,
					submittedHash: await hashCrdtSubmittedAggregateBundle({
						aggregateEpoch: update.aggregateEpoch,
						schemaVersion: update.schemaVersion,
						parts: update.parts,
					}),
					aggregateEpoch: update.aggregateEpoch,
					schemaVersion: update.schemaVersion,
				},
			]);
		} finally {
			await db
				.update(questpieCrdtResourceTable)
				.set({ editFence: 0n })
				.where(eq(questpieCrdtResourceTable.id, RESOURCE_ID));
		}

		expect(first).toEqual(duplicate);
		expect(first).toEqual(duplicateAfterEditRevoke);
		expect(readOnlyReceipts).toEqual([first]);
		expect(first.cursors).toEqual([
			{ fieldSlot: field.fieldSlot, fieldCursor: 1n },
		]);
		expect(stageCount).toBe(1);
		expect(notices).toHaveLength(1);
	});

	it("returns only an exact durable receipt hash", async () => {
		const source = createCrdtDatabaseSyncSource(db, {
			resolveEngine: () => textEngine,
			lockOwnerRow: async (transaction, identity) => {
				await transaction.execute(
					sql`SELECT id FROM articles WHERE id = 'article-1' FOR UPDATE`,
				);
				return identity;
			},
			publishNotice: async () => {},
		});
		const basis = await source.captureAuthorityBasis(SESSION_ID);
		const field = basis.fields[0]!;
		const update = {
			updateId: uuidBytes(SECOND_UPDATE_ID),
			aggregateEpoch: basis.aggregateEpoch,
			schemaVersion: basis.schemaVersion,
			parts: [
				{
					fieldSlot: field.fieldSlot,
					fieldEpoch: field.fieldEpoch,
					formatVersion: field.formatVersion,
					baseFieldCursor: field.fieldCursor,
					bytes: encodeDeterministicTextUpdate([
						{
							type: "insert" as const,
							index: 7,
							value: "?",
						},
					]),
				},
			],
		};
		const committed = await source.submitUpdate!(basis, update);
		const submittedHash = await hashCrdtSubmittedAggregateBundle({
			aggregateEpoch: update.aggregateEpoch,
			schemaVersion: update.schemaVersion,
			parts: update.parts,
		});
		const exact = await source.reconcileReceipts!(basis, [
			{
				updateId: update.updateId,
				submittedHash,
				aggregateEpoch: update.aggregateEpoch,
				schemaVersion: update.schemaVersion,
			},
		]);
		const wrongHash = new Uint8Array(submittedHash);
		wrongHash[0] ^= 0xff;

		const mismatched = await source.reconcileReceipts!(basis, [
			{
				updateId: update.updateId,
				submittedHash: wrongHash,
				aggregateEpoch: update.aggregateEpoch,
				schemaVersion: update.schemaVersion,
			},
		]);
		const oldSchemaMiss = await source.reconcileReceipts!(basis, [
			{
				updateId: update.updateId,
				submittedHash,
				aggregateEpoch: update.aggregateEpoch,
				schemaVersion: Math.max(0, update.schemaVersion - 1),
			},
		]);

		expect(exact).toEqual([committed]);
		expect(mismatched).toEqual([]);
		expect(oldSchemaMiss).toEqual([]);
	});

	it("rejects an exact authority cut after its binding fence changes", async () => {
		const source = createCrdtDatabaseSyncSource(db, {
			resolveEngine: () => textEngine,
			...testAppendDependencies,
		});
		const basis = await source.captureAuthorityBasis(SESSION_ID);
		const field = basis.fields[0]!;
		try {
			await db
				.update(questpieCrdtBindingTable)
				.set({ readFence: 1n })
				.where(eq(questpieCrdtBindingTable.id, fixture.title.id));

			await expect(
				source.submitUpdate!(basis, {
					updateId: uuidBytes("20314253-6475-4687-98a9-bacbdcedfe10"),
					aggregateEpoch: basis.aggregateEpoch,
					schemaVersion: basis.schemaVersion,
					parts: [
						{
							fieldSlot: field.fieldSlot,
							fieldEpoch: field.fieldEpoch,
							formatVersion: field.formatVersion,
							baseFieldCursor: field.fieldCursor,
							bytes: encodeDeterministicTextUpdate([
								{ type: "insert", index: 0, value: "x" },
							]),
						},
					],
				}),
			).rejects.toThrow("CRDT synchronization rejected");
		} finally {
			await db
				.update(questpieCrdtBindingTable)
				.set({ readFence: 0n })
				.where(eq(questpieCrdtBindingTable.id, fixture.title.id));
		}
	});

	it("persists frozen pages for cross-node retry and fences delivery reattach", async () => {
		const authorization = await currentAuthorization(db, fixture);
		const claim = {
			sessionId: SESSION_ID,
			bindingId: authorization.bindingId,
			resourceId: RESOURCE_ID,
			requestedMode: "edit" as const,
			effectiveMode: "edit" as const,
			sessionGeneration: 0n,
			deliveryGeneration: 0n,
		};
		const largeEngine = {
			...textEngine,
			async diff() {
				return {
					kind: "snapshot" as const,
					snapshot: new Uint8Array(2 * 1024 * 1024).fill(0x5a),
				};
			},
		};
		const config = {
			namespace: "sync-test",
			deploymentFingerprint: "deployment-a",
			secret: "test-secret-that-is-long-enough",
			resolveEngine: () => largeEngine,
		};
		const firstNode = createCrdtPullStore(db, config);
		const secondNode = createCrdtPullStore(db, config);
		const pullId = "00000000-0000-4000-8000-000000000521";
		const request = {
			claim,
			authorization: authorization.snapshot,
			pullId,
			schemaVersion: manifest.version,
			continuation: null,
			proofs: [
				{
					fieldSlot: fixture.title.fieldSlot,
					fieldEpoch: fixture.title.fieldEpoch,
					proof: Uint8Array.of(1),
				},
			],
		};

		const first = await firstNode.pull(request);
		const retried = await secondNode.pull(request);
		expect(retried.payload).toEqual(first.payload);
		const firstFrame = decodeStoredPull(first.payload);
		expect(firstFrame.opcode).toBe(0x81);
		if (firstFrame.opcode !== 0x81) throw new Error("expected pull page");
		expect(firstFrame.payload.complete).toBeFalse();
		expect(firstFrame.payload.continuation).toBeString();
		expect(firstFrame.payload.fields[0]?.byteLength).toBe(2 * 1024 * 1024);

		await expect(
			firstNode.pull({
				...request,
				pullId: "00000000-0000-4000-8000-000000000522",
			}),
		).rejects.toBeInstanceOf(CrdtPullBusyError);

		const continuation = firstFrame.payload.continuation!;
		const continued = await secondNode.pull({
			...request,
			continuation,
			proofs: [],
		});
		const repeated = await firstNode.pull({
			...request,
			continuation,
			proofs: [],
		});
		expect(repeated.payload).toEqual(continued.payload);
		await expect(
			firstNode.pull({
				...request,
				continuation: `${continuation[0] === "A" ? "B" : "A"}${continuation.slice(1)}`,
				proofs: [],
			}),
		).rejects.toThrow("CRDT recovery required");
		const [persistedPull] = await db
			.select()
			.from(questpieCrdtPullTable)
			.where(eq(questpieCrdtPullTable.id, pullId));
		await db
			.update(questpieCrdtPullTable)
			.set({ continuationClaimFingerprint: Buffer.alloc(32, 0x6a) })
			.where(eq(questpieCrdtPullTable.id, pullId));
		await expect(
			secondNode.pull({
				...request,
				continuation,
				proofs: [],
			}),
		).rejects.toThrow("CRDT recovery required");
		await db
			.update(questpieCrdtPullTable)
			.set({
				continuationClaimFingerprint:
					persistedPull!.continuationClaimFingerprint,
			})
			.where(eq(questpieCrdtPullTable.id, pullId));

		await db
			.update(questpieCrdtSessionTable)
			.set({ deliveryGeneration: 1n })
			.where(eq(questpieCrdtSessionTable.id, SESSION_ID));
		await expect(
			secondNode.pull({
				...request,
				continuation,
				proofs: [],
			}),
		).rejects.toThrow("CRDT recovery required");
		await db
			.update(questpieCrdtPullTable)
			.set({ activeExpiresAt: new Date(0), expiresAt: new Date(0) })
			.where(eq(questpieCrdtPullTable.id, pullId));
		await firstNode.collectExpired();
		await db
			.update(questpieCrdtSessionTable)
			.set({ deliveryGeneration: 0n })
			.where(eq(questpieCrdtSessionTable.id, SESSION_ID));
	});

	it("publishes the reserved visible cut when a hidden commit lands during materialization", async () => {
		const source = createCrdtDatabaseSyncSource(db, {
			resolveEngine: () => textEngine,
			...testAppendDependencies,
		});
		const basis = await source.captureAuthorityBasis(SESSION_ID);
		const field = basis.fields[0]!;
		const proof = await currentFieldProof(db, fixture, field.fieldSlot);
		const authorization = await currentAuthorization(db, fixture);
		const [epoch] = await db
			.select()
			.from(questpieCrdtResourceEpochTable)
			.where(eq(questpieCrdtResourceEpochTable.id, fixture.resourceEpochId));
		const hiddenCommitSeq = epoch!.headCommitSeq + 1n;
		let advanced = false;
		const concurrentEngine = {
			...textEngine,
			async diff(input: Parameters<typeof textEngine.diff>[0]) {
				if (!advanced) {
					advanced = true;
					await db.insert(questpieCrdtCommitTable).values({
						resourceId: RESOURCE_ID,
						resourceEpochId: fixture.resourceEpochId,
						definitionId: fixture.definitionId,
						commitSeq: hiddenCommitSeq,
						kind: 1,
						schemaId: fixture.schemaId,
						canonicalBundleHash: Buffer.alloc(32, 0x79),
						deliveryCommitId: "00000000-0000-4000-8000-000000000526",
						subjectId: SUBJECT_ID,
						sessionId: SESSION_ID,
					});
					await db
						.update(questpieCrdtResourceEpochTable)
						.set({ headCommitSeq: hiddenCommitSeq })
						.where(
							eq(questpieCrdtResourceEpochTable.id, fixture.resourceEpochId),
						);
				}
				return textEngine.diff(input);
			},
		};
		const store = createCrdtPullStore(db, {
			namespace: "sync-test",
			deploymentFingerprint: "deployment-a",
			secret: "test-secret-that-is-long-enough",
			resolveEngine: () => concurrentEngine,
		});
		const pullId = "00000000-0000-4000-8000-000000000527";
		try {
			const page = await store.pull({
				claim: {
					sessionId: SESSION_ID,
					bindingId: authorization.bindingId,
					resourceId: RESOURCE_ID,
					requestedMode: "edit",
					effectiveMode: "edit",
					sessionGeneration: 0n,
					deliveryGeneration: 0n,
				},
				authorization: authorization.snapshot,
				pullId,
				schemaVersion: manifest.version,
				continuation: null,
				proofs: [
					{
						fieldSlot: field.fieldSlot,
						fieldEpoch: field.fieldEpoch,
						proof,
					},
				],
			});
			const decoded = decodeStoredPull(page.payload);
			expect(advanced).toBeTrue();
			expect(decoded.opcode).toBe(0x81);
			if (decoded.opcode !== 0x81) throw new Error("expected pull page");
			expect(decoded.payload.fields[0]?.fieldCursor).toBe(field.fieldCursor);
		} finally {
			await db
				.update(questpieCrdtPullTable)
				.set({ activeExpiresAt: new Date(0), expiresAt: new Date(0) })
				.where(eq(questpieCrdtPullTable.id, pullId));
			await store.collectExpired();
		}
	});

	it("refuses to publish staged pages whose persisted checksum changed", async () => {
		const authorization = await currentAuthorization(db, fixture);
		const pullId = "00000000-0000-4000-8000-000000000540";
		const store = createCrdtPullStore(db, {
			namespace: "sync-test",
			deploymentFingerprint: "deployment-a",
			secret: "test-secret-that-is-long-enough",
			resolveEngine: () => textEngine,
		});
		await db.execute(sql`
			CREATE FUNCTION corrupt_crdt_pull_checksum() RETURNS trigger
			LANGUAGE plpgsql AS $$
			BEGIN
				NEW.checksum := decode(repeat('00', 32), 'hex');
				RETURN NEW;
			END
			$$
		`);
		await db.execute(sql`
			CREATE TRIGGER corrupt_crdt_pull_checksum
			BEFORE INSERT ON questpie_crdt_pull_page
			FOR EACH ROW EXECUTE FUNCTION corrupt_crdt_pull_checksum()
		`);
		try {
			await expect(
				store.pull({
					claim: {
						sessionId: SESSION_ID,
						bindingId: authorization.bindingId,
						resourceId: RESOURCE_ID,
						requestedMode: "edit",
						effectiveMode: "edit",
						sessionGeneration: 0n,
						deliveryGeneration: 0n,
					},
					authorization: authorization.snapshot,
					pullId,
					schemaVersion: manifest.version,
					continuation: null,
					proofs: [],
				}),
			).rejects.toThrow("CRDT recovery required");
			const [failed] = await db
				.select({ state: questpieCrdtPullTable.state })
				.from(questpieCrdtPullTable)
				.where(eq(questpieCrdtPullTable.id, pullId));
			expect(failed?.state).toBe(4);
			expect(
				await db
					.select()
					.from(questpieCrdtPullPageTable)
					.where(eq(questpieCrdtPullPageTable.pullId, pullId)),
			).toHaveLength(0);
		} finally {
			await db.execute(
				sql`DROP TRIGGER IF EXISTS corrupt_crdt_pull_checksum ON questpie_crdt_pull_page`,
			);
			await db.execute(
				sql`DROP FUNCTION IF EXISTS corrupt_crdt_pull_checksum()`,
			);
			await expireAndCollectPulls(db, store, [pullId]);
		}
	});

	it("releases an expired ready lease without waiting for physical cleanup", async () => {
		const authorization = await currentAuthorization(db, fixture);
		const claim = {
			sessionId: SESSION_ID,
			bindingId: authorization.bindingId,
			resourceId: RESOURCE_ID,
			requestedMode: "edit" as const,
			effectiveMode: "edit" as const,
			sessionGeneration: 0n,
			deliveryGeneration: 0n,
		};
		const store = createCrdtPullStore(db, {
			namespace: "sync-test",
			deploymentFingerprint: "deployment-a",
			secret: "test-secret-that-is-long-enough",
			resolveEngine: () => ({
				...textEngine,
				async diff() {
					return {
						kind: "snapshot" as const,
						snapshot: new Uint8Array(2 * 1024 * 1024).fill(0x6b),
					};
				},
			}),
		});
		const firstPullId = "00000000-0000-4000-8000-000000000528";
		const secondPullId = "00000000-0000-4000-8000-000000000529";
		const request = {
			claim,
			authorization: authorization.snapshot,
			schemaVersion: manifest.version,
			continuation: null,
			proofs: [
				{
					fieldSlot: fixture.title.fieldSlot,
					fieldEpoch: fixture.title.fieldEpoch,
					proof: Uint8Array.of(1),
				},
			],
		};
		try {
			const first = await store.pull({ ...request, pullId: firstPullId });
			expect(decodeStoredPull(first.payload).opcode).toBe(0x81);
			await db
				.update(questpieCrdtPullTable)
				.set({ activeExpiresAt: new Date(0) })
				.where(eq(questpieCrdtPullTable.id, firstPullId));

			const second = await store.pull({ ...request, pullId: secondPullId });
			expect(decodeStoredPull(second.payload).opcode).toBe(0x81);
			const [expired] = await db
				.select({ state: questpieCrdtPullTable.state })
				.from(questpieCrdtPullTable)
				.where(eq(questpieCrdtPullTable.id, firstPullId));
			expect(expired?.state).toBe(4);
		} finally {
			await db
				.update(questpieCrdtPullTable)
				.set({ activeExpiresAt: new Date(0), expiresAt: new Date(0) })
				.where(
					sql`${questpieCrdtPullTable.id} IN (${firstPullId}, ${secondPullId})`,
				);
			await store.collectExpired();
		}
	});

	it("bounds completed artifacts, retained bytes, and pull bytes per time across nodes", async () => {
		const authorization = await currentAuthorization(db, fixture);
		const config = {
			namespace: "sync-test",
			deploymentFingerprint: "deployment-a",
			secret: "test-secret-that-is-long-enough",
			resolveEngine: () => textEngine,
		};
		const firstNode = createCrdtPullStore(db, config);
		const secondNode = createCrdtPullStore(db, config);
		const request = {
			claim: {
				sessionId: SESSION_ID,
				bindingId: authorization.bindingId,
				resourceId: RESOURCE_ID,
				requestedMode: "edit" as const,
				effectiveMode: "edit" as const,
				sessionGeneration: 0n,
				deliveryGeneration: 0n,
			},
			authorization: authorization.snapshot,
			schemaVersion: manifest.version,
			continuation: null,
			proofs: [],
		};
		const countIds = [
			"00000000-0000-4000-8000-000000000530",
			"00000000-0000-4000-8000-000000000531",
		];
		const byteIds = [
			"00000000-0000-4000-8000-000000000535",
			"00000000-0000-4000-8000-000000000536",
		];
		try {
			for (const pullId of countIds) {
				await firstNode.pull({ ...request, pullId });
			}
			const [completed] = await db
				.select({
					state: questpieCrdtPullTable.state,
					completedAt: questpieCrdtPullTable.completedAt,
					expiresAt: questpieCrdtPullTable.expiresAt,
				})
				.from(questpieCrdtPullTable)
				.where(eq(questpieCrdtPullTable.id, countIds[0]!));
			expect(completed?.state).toBe(3);
			expect(
				completed!.expiresAt.getTime() - completed!.completedAt!.getTime(),
			).toBeGreaterThanOrEqual(29_000);
			await expect(
				secondNode.pull({
					...request,
					pullId: "00000000-0000-4000-8000-000000000532",
				}),
			).rejects.toBeInstanceOf(CrdtPullBusyError);
			await expireAndCollectPulls(db, firstNode, countIds);

			for (const pullId of byteIds) {
				await firstNode.pull({ ...request, pullId });
			}
			await db
				.update(questpieCrdtPullTable)
				.set({ retainedBytes: 65 * 1024 * 1024 })
				.where(inArray(questpieCrdtPullTable.id, byteIds));
			await db
				.update(questpieCrdtSubjectAdmissionTable)
				.set({
					pullByteTokens: 130n * 1024n * 1024n,
					pullBytesRefilledAt: sql`clock_timestamp()`,
				})
				.where(eq(questpieCrdtSubjectAdmissionTable.subjectId, SUBJECT_ID));
			await expect(
				secondNode.pull({
					...request,
					pullId: "00000000-0000-4000-8000-000000000537",
				}),
			).rejects.toBeInstanceOf(CrdtPullBusyError);
			await expireAndCollectPulls(db, firstNode, byteIds);

			await db
				.update(questpieCrdtSubjectAdmissionTable)
				.set({
					pullByteTokens: 0n,
					pullBytesRefilledAt: sql`clock_timestamp()`,
				})
				.where(eq(questpieCrdtSubjectAdmissionTable.subjectId, SUBJECT_ID));
			await expect(
				secondNode.pull({
					...request,
					pullId: "00000000-0000-4000-8000-000000000538",
				}),
			).rejects.toBeInstanceOf(CrdtPullBusyError);
		} finally {
			await db
				.update(questpieCrdtSubjectAdmissionTable)
				.set({ pullByteTokens: 130n * 1024n * 1024n })
				.where(eq(questpieCrdtSubjectAdmissionTable.subjectId, SUBJECT_ID));
			await expireAndCollectPulls(db, firstNode, [...countIds, ...byteIds]);
		}
	});

	it("refunds a crashed building reservation during expired-pull cleanup", async () => {
		const pullId = "00000000-0000-4000-8000-000000000541";
		let enterDiff!: () => void;
		let releaseDiff!: () => void;
		const diffEntered = new Promise<void>((resolve) => {
			enterDiff = resolve;
		});
		const diffReleased = new Promise<void>((resolve) => {
			releaseDiff = resolve;
		});
		const blockedEngine = {
			...textEngine,
			async snapshot(replica: Parameters<typeof textEngine.snapshot>[0]) {
				enterDiff();
				await diffReleased;
				return textEngine.snapshot(replica);
			},
		};
		const store = createCrdtPullStore(db, {
			namespace: "sync-test",
			deploymentFingerprint: "deployment-a",
			secret: "test-secret-that-is-long-enough",
			resolveEngine: () => blockedEngine,
		});
		await db
			.update(questpieCrdtSubjectAdmissionTable)
			.set({
				pullByteTokens: 130n * 1024n * 1024n,
				pullBytesRefilledAt: sql`clock_timestamp()`,
			})
			.where(eq(questpieCrdtSubjectAdmissionTable.subjectId, SUBJECT_ID));
		const authorization = await currentAuthorization(db, fixture);
		const pull = store.pull({
			claim: {
				sessionId: SESSION_ID,
				bindingId: authorization.bindingId,
				resourceId: RESOURCE_ID,
				requestedMode: "edit",
				effectiveMode: "edit",
				sessionGeneration: 0n,
				deliveryGeneration: 0n,
			},
			authorization: authorization.snapshot,
			pullId,
			schemaVersion: manifest.version,
			continuation: null,
			proofs: [],
		});
		try {
			await diffEntered;
			const [charged] = await db
				.select({
					tokens: questpieCrdtSubjectAdmissionTable.pullByteTokens,
				})
				.from(questpieCrdtSubjectAdmissionTable)
				.where(eq(questpieCrdtSubjectAdmissionTable.subjectId, SUBJECT_ID));
			expect(charged?.tokens).toBe(65n * 1024n * 1024n);
			await db
				.update(questpieCrdtPullTable)
				.set({ activeExpiresAt: new Date(0), expiresAt: new Date(0) })
				.where(eq(questpieCrdtPullTable.id, pullId));

			expect(await store.collectExpired()).toBe(1);
			const [refunded] = await db
				.select({
					tokens: questpieCrdtSubjectAdmissionTable.pullByteTokens,
				})
				.from(questpieCrdtSubjectAdmissionTable)
				.where(eq(questpieCrdtSubjectAdmissionTable.subjectId, SUBJECT_ID));
			expect(refunded?.tokens).toBe(130n * 1024n * 1024n);
		} finally {
			releaseDiff();
			await expect(pull).rejects.toThrow("CRDT recovery required");
			await db
				.update(questpieCrdtSubjectAdmissionTable)
				.set({ pullByteTokens: 130n * 1024n * 1024n })
				.where(eq(questpieCrdtSubjectAdmissionTable.subjectId, SUBJECT_ID));
			await expireAndCollectPulls(db, store, [pullId]);
		}
	});

	it("keeps a fixed artifact retry deadline across session heartbeats", async () => {
		const [original] = await db
			.select({
				authorityExpiresAt: questpieCrdtSessionTable.authorityExpiresAt,
				leaseExpiresAt: questpieCrdtSessionTable.leaseExpiresAt,
			})
			.from(questpieCrdtSessionTable)
			.where(eq(questpieCrdtSessionTable.id, SESSION_ID));
		const authorityExpiresAt = new Date(Date.now() + 90_000);
		const initialLeaseExpiresAt = new Date(Date.now() + 5_000);
		const pullId = "00000000-0000-4000-8000-000000000539";
		const store = createCrdtPullStore(db, {
			namespace: "sync-test",
			deploymentFingerprint: "deployment-a",
			secret: "test-secret-that-is-long-enough",
			resolveEngine: () => textEngine,
		});
		try {
			await db
				.update(questpieCrdtSessionTable)
				.set({ authorityExpiresAt, leaseExpiresAt: initialLeaseExpiresAt })
				.where(eq(questpieCrdtSessionTable.id, SESSION_ID));
			const authorization = await currentAuthorization(db, fixture);
			const request = {
				claim: {
					sessionId: SESSION_ID,
					bindingId: authorization.bindingId,
					resourceId: RESOURCE_ID,
					requestedMode: "edit" as const,
					effectiveMode: "edit" as const,
					sessionGeneration: 0n,
					deliveryGeneration: 0n,
				},
				authorization: authorization.snapshot,
				pullId,
				schemaVersion: manifest.version,
				continuation: null,
				proofs: [],
			};
			const first = await store.pull(request);
			const [artifact] = await db
				.select({
					activeExpiresAt: questpieCrdtPullTable.activeExpiresAt,
					expiresAt: questpieCrdtPullTable.expiresAt,
				})
				.from(questpieCrdtPullTable)
				.where(eq(questpieCrdtPullTable.id, pullId));
			expect(artifact!.expiresAt.getTime()).toBeGreaterThan(
				initialLeaseExpiresAt.getTime() + 30_000,
			);
			expect(
				artifact!.expiresAt.getTime() - artifact!.activeExpiresAt.getTime(),
			).toBeGreaterThanOrEqual(29_900);

			await db
				.update(questpieCrdtSessionTable)
				.set({ leaseExpiresAt: new Date(Date.now() + 30_000) })
				.where(eq(questpieCrdtSessionTable.id, SESSION_ID));
			const repeated = await store.pull(request);
			expect(repeated.payload).toEqual(first.payload);
		} finally {
			await expireAndCollectPulls(db, store, [pullId]);
			await db
				.update(questpieCrdtSessionTable)
				.set({
					authorityExpiresAt: original!.authorityExpiresAt,
					leaseExpiresAt: original!.leaseExpiresAt,
				})
				.where(eq(questpieCrdtSessionTable.id, SESSION_ID));
		}
	});

	it("retains snapshot manifests until every frozen pull reference is released", async () => {
		const authorization = await currentAuthorization(db, fixture);
		const pullId = "00000000-0000-4000-8000-00000000053a";
		const oldManifestId = "00000000-0000-4000-8000-00000000053b";
		const store = createCrdtPullStore(db, {
			namespace: "sync-test",
			deploymentFingerprint: "deployment-a",
			secret: "test-secret-that-is-long-enough",
			resolveEngine: () => textEngine,
		});
		try {
			await store.pull({
				claim: {
					sessionId: SESSION_ID,
					bindingId: authorization.bindingId,
					resourceId: RESOURCE_ID,
					requestedMode: "edit",
					effectiveMode: "edit",
					sessionGeneration: 0n,
					deliveryGeneration: 0n,
				},
				authorization: authorization.snapshot,
				pullId,
				schemaVersion: manifest.version,
				continuation: null,
				proofs: [],
			});
			const [current] = await db
				.select()
				.from(questpieCrdtSnapshotManifestTable)
				.where(
					eq(
						questpieCrdtSnapshotManifestTable.id,
						(
							await db
								.select({
									id: questpieCrdtResourceEpochTable.currentSnapshotManifestId,
								})
								.from(questpieCrdtResourceEpochTable)
								.where(
									eq(
										questpieCrdtResourceEpochTable.id,
										fixture.resourceEpochId,
									),
								)
						)[0]!.id!,
					),
				);
			await db.insert(questpieCrdtSnapshotManifestTable).values({
				...current!,
				id: oldManifestId,
				createdAt: new Date(Date.now() - 60_000),
			});
			await db
				.update(questpieCrdtPullTable)
				.set({ previousSnapshotManifestId: oldManifestId })
				.where(eq(questpieCrdtPullTable.id, pullId));

			await collectCrdtGarbage(db, {
				resourceId: RESOURCE_ID,
				resourceEpochId: fixture.resourceEpochId,
			});
			expect(
				await db
					.select()
					.from(questpieCrdtSnapshotManifestTable)
					.where(eq(questpieCrdtSnapshotManifestTable.id, oldManifestId)),
			).toHaveLength(1);

			await expireAndCollectPulls(db, store, [pullId]);
			await collectCrdtGarbage(db, {
				resourceId: RESOURCE_ID,
				resourceEpochId: fixture.resourceEpochId,
			});
			expect(
				await db
					.select()
					.from(questpieCrdtSnapshotManifestTable)
					.where(eq(questpieCrdtSnapshotManifestTable.id, oldManifestId)),
			).toHaveLength(0);
		} finally {
			await expireAndCollectPulls(db, store, [pullId]);
			await db
				.delete(questpieCrdtSnapshotManifestTable)
				.where(eq(questpieCrdtSnapshotManifestTable.id, oldManifestId));
		}
	});

	it("keeps hidden-only aggregate advancement out of the public pull shape", async () => {
		const source = createCrdtDatabaseSyncSource(db, {
			resolveEngine: () => textEngine,
			...testAppendDependencies,
		});
		const basis = await source.captureAuthorityBasis(SESSION_ID);
		const field = basis.fields[0]!;
		const proof = await currentFieldProof(db, fixture, field.fieldSlot);
		const beforeAuthorization = await currentAuthorization(db, fixture);
		const claim = {
			sessionId: SESSION_ID,
			bindingId: beforeAuthorization.bindingId,
			resourceId: RESOURCE_ID,
			requestedMode: "edit" as const,
			effectiveMode: "edit" as const,
			sessionGeneration: 0n,
			deliveryGeneration: 0n,
		};
		const store = createCrdtPullStore(db, {
			namespace: "sync-test",
			deploymentFingerprint: "deployment-a",
			secret: "test-secret-that-is-long-enough",
			resolveEngine: () => textEngine,
		});
		const pull = async (
			pullId: string,
			authorization: Awaited<ReturnType<typeof currentAuthorization>>,
		) =>
			decodeStoredPull(
				(
					await store.pull({
						claim,
						authorization: authorization.snapshot,
						pullId,
						schemaVersion: manifest.version,
						continuation: null,
						proofs: [
							{
								fieldSlot: field.fieldSlot,
								fieldEpoch: field.fieldEpoch,
								proof,
							},
						],
					})
				).payload,
			);
		const before = await pull(
			"00000000-0000-4000-8000-000000000523",
			beforeAuthorization,
		);
		const [epoch] = await db
			.select()
			.from(questpieCrdtResourceEpochTable)
			.where(eq(questpieCrdtResourceEpochTable.id, fixture.resourceEpochId));
		const hiddenCommitSeq = epoch!.headCommitSeq + 1n;
		await db.insert(questpieCrdtCommitTable).values({
			resourceId: RESOURCE_ID,
			resourceEpochId: fixture.resourceEpochId,
			definitionId: fixture.definitionId,
			commitSeq: hiddenCommitSeq,
			kind: 1,
			schemaId: fixture.schemaId,
			canonicalBundleHash: Buffer.alloc(32, 0x7a),
			deliveryCommitId: "00000000-0000-4000-8000-000000000524",
			subjectId: SUBJECT_ID,
			sessionId: SESSION_ID,
		});
		await db
			.update(questpieCrdtResourceEpochTable)
			.set({ headCommitSeq: hiddenCommitSeq })
			.where(eq(questpieCrdtResourceEpochTable.id, fixture.resourceEpochId));
		const after = await pull(
			"00000000-0000-4000-8000-000000000525",
			await currentAuthorization(db, fixture),
		);
		if (before.opcode !== 0x81 || after.opcode !== 0x81) {
			throw new Error("expected pull pages");
		}
		expect({
			artifactDigest: before.payload.artifactDigest,
			aggregateEpoch: before.payload.aggregateEpoch,
			schemaVersion: before.payload.schemaVersion,
			complete: before.payload.complete,
			continuation: before.payload.continuation,
			fields: before.payload.fields,
			chunks: before.payload.chunks,
		}).toEqual({
			artifactDigest: after.payload.artifactDigest,
			aggregateEpoch: after.payload.aggregateEpoch,
			schemaVersion: after.payload.schemaVersion,
			complete: after.payload.complete,
			continuation: after.payload.continuation,
			fields: after.payload.fields,
			chunks: after.payload.chunks,
		});
	});
});

const postgresUrl =
	process.env.QUESTPIE_CRDT_DATABASE_URL ??
	process.env.QUESTPIE_TRANSACTION_LOCK_DATABASE_URL;

describe.skipIf(!postgresUrl)("CRDT pull store on bounded PostgreSQL", () => {
	const schemaName = `questpie_crdt_pull_${randomUUID().replaceAll("-", "")}`;
	let admin: pg.Pool;
	let pool: pg.Pool;
	let postgresDb: ReturnType<typeof drizzlePg<typeof questpieCrdtTables>>;
	let compatibleDb: ReturnType<typeof drizzle<typeof questpieCrdtTables>>;
	let postgresFixture: Awaited<ReturnType<typeof seed>>;

	beforeAll(async () => {
		admin = new pg.Pool({ connectionString: postgresUrl, max: 1 });
		await admin.query(`CREATE SCHEMA "${schemaName}"`);
		pool = new pg.Pool({
			connectionString: postgresUrl,
			max: 5,
			options: `-c search_path=${schemaName}`,
		});
		postgresDb = drizzlePg({ client: pool, schema: questpieCrdtTables });
		compatibleDb = postgresDb as unknown as typeof compatibleDb;
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
			if (statement.trim()) await postgresDb.execute(sql.raw(statement));
		}
		await postgresDb.execute(sql`
			CREATE TABLE articles (
				id text PRIMARY KEY,
				title text NOT NULL,
				content text NOT NULL
			)
		`);
		postgresFixture = await seed(compatibleDb);
	});

	afterAll(async () => {
		await pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
		await admin?.end();
	});

	it("does not exhaust the pool while reserving a pull", async () => {
		const authorization = await currentAuthorization(
			compatibleDb,
			postgresFixture,
		);
		const store = createCrdtPullStore(postgresDb, {
			namespace: "sync-test",
			deploymentFingerprint: "deployment-a",
			secret: "test-secret-that-is-long-enough",
			resolveEngine: () => textEngine,
		});
		const page = await store.pull({
			claim: {
				sessionId: SESSION_ID,
				bindingId: authorization.bindingId,
				resourceId: RESOURCE_ID,
				requestedMode: "edit",
				effectiveMode: "edit",
				sessionGeneration: 0n,
				deliveryGeneration: 0n,
			},
			authorization: authorization.snapshot,
			pullId: "00000000-0000-0000-0000-000000000561",
			schemaVersion: manifest.version,
			continuation: null,
			proofs: [
				{
					fieldSlot: postgresFixture.title.fieldSlot,
					fieldEpoch: postgresFixture.title.fieldEpoch,
					proof: Uint8Array.of(1),
				},
			],
		});
		expect(page.opcode).toBe(0x81);
	}, 3_000);
});

async function currentFieldProof(
	db: ReturnType<typeof drizzle<typeof questpieCrdtTables>>,
	fixture: Awaited<ReturnType<typeof seed>>,
	fieldSlot: number,
): Promise<Uint8Array> {
	const [epoch] = await db
		.select()
		.from(questpieCrdtResourceEpochTable)
		.where(eq(questpieCrdtResourceEpochTable.id, fixture.resourceEpochId));
	const bindings = (
		await db
			.select()
			.from(questpieCrdtBindingTable)
			.where(eq(questpieCrdtBindingTable.resourceId, RESOURCE_ID))
	).filter((binding) => binding.status === 1);
	if (!epoch) throw new Error("expected current CRDT epoch");
	const replicas = await materializeCrdtAggregateAtCut(db, {
		resourceId: RESOURCE_ID,
		resourceEpochId: fixture.resourceEpochId,
		schemaId: fixture.schemaId,
		targetCommitSeq: epoch.headCommitSeq,
		currentManifestId: epoch.currentSnapshotManifestId,
		previousManifestId: epoch.previousSnapshotManifestId,
		bindings,
		engines: new Map(
			bindings.map((binding) => [binding.fieldSlot, textEngine]),
		),
		targetFieldCursors: new Map(
			bindings.map((binding) => [binding.id, binding.headFieldCursor]),
		),
	});
	const replica = replicas?.get(fieldSlot);
	if (!replica) throw new Error("expected current CRDT field replica");
	return textEngine.proof(replica as never);
}

async function expireAndCollectPulls(
	db: ReturnType<typeof drizzle<typeof questpieCrdtTables>>,
	store: ReturnType<typeof createCrdtPullStore>,
	pullIds: readonly string[],
) {
	if (pullIds.length === 0) return;
	await db
		.update(questpieCrdtPullTable)
		.set({ activeExpiresAt: new Date(0), expiresAt: new Date(0) })
		.where(inArray(questpieCrdtPullTable.id, [...pullIds]));
	for (;;) {
		if ((await store.collectExpired()) === 0) return;
	}
}

function decodeStoredPull(payload: Uint8Array) {
	const requestId = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
	const header = new Uint8Array(32);
	header.set(Uint8Array.of(0x51, 0x50, 0x43, 0x58, 1, 0, 0x81, 0));
	header.set(requestId, 8);
	new DataView(header.buffer).setUint32(24, payload.byteLength);
	return decodeCrdtExchangeFrameV1(Uint8Array.from([...header, ...payload]));
}

async function currentAuthorization(
	db: ReturnType<typeof drizzle<typeof questpieCrdtTables>>,
	fixture: Awaited<ReturnType<typeof seed>>,
) {
	const [session] = await db
		.select()
		.from(questpieCrdtSessionTable)
		.where(eq(questpieCrdtSessionTable.id, SESSION_ID));
	const [resource] = await db
		.select()
		.from(questpieCrdtResourceTable)
		.where(eq(questpieCrdtResourceTable.id, RESOURCE_ID));
	const [epoch] = await db
		.select()
		.from(questpieCrdtResourceEpochTable)
		.where(eq(questpieCrdtResourceEpochTable.id, fixture.resourceEpochId));
	const bindings = await db
		.select()
		.from(questpieCrdtBindingTable)
		.where(eq(questpieCrdtBindingTable.resourceId, RESOURCE_ID));
	if (!session || !resource || !epoch) {
		throw new Error("expected live CRDT authorization fixture");
	}
	const title = bindings.find((binding) => binding.id === fixture.title.id)!;
	return {
		bindingId: session.bindingId,
		snapshot: {
			resourceId: RESOURCE_ID,
			resourceEpochId: epoch.id,
			definitionId: resource.definitionId,
			schemaId: epoch.schemaId,
			incarnationKey: resource.incarnationKey,
			subjectId: SUBJECT_ID,
			credentialFingerprint: new Uint8Array(session.credentialFingerprint),
			audience: "test",
			origin: null,
			requestedMode: "edit" as const,
			effectiveMode: "edit" as const,
			resourceReadFence: resource.readFence,
			resourceEditFence: resource.editFence,
			ownerPolicyRevision: resource.ownerPolicyRevision,
			subjectReadFence: session.subjectReadFence,
			subjectEditFence: session.subjectEditFence,
			sessionGeneration: resource.sessionGeneration,
			authorityExpiresAt: new Date(session.authorityExpiresAt),
			headCommitSeq: epoch.headCommitSeq,
			offlineSubjectKey: "offline-user-1",
			clientManifest: {
				schemaVersion: manifest.version,
				schemaFingerprint: Buffer.from(manifest.fingerprint).toString(
					"base64url",
				),
				awarenessEnabled: false,
				fields: {
					title: {
						fieldSlot: title.fieldSlot,
						format: "text" as const,
						formatVersion: title.formatVersion,
						engineId: textEngine.engineId,
						grant: "edit" as const,
					},
				},
			},
			bindings: bindings
				.sort((left, right) => left.fieldSlot - right.fieldSlot)
				.map((binding) => ({
					bindingId: binding.id,
					stableFieldId: binding.stableFieldId,
					fieldEpoch: binding.fieldEpoch,
					fieldSlot: binding.fieldSlot,
					formatVersion: binding.formatVersion,
					headFieldCursor: binding.headFieldCursor,
					fieldReadFence: binding.readFence,
					fieldEditFence: binding.editFence,
				})),
			grants: [
				{
					bindingId: title.id,
					stableFieldId: title.stableFieldId,
					fieldEpoch: title.fieldEpoch,
					fieldSlot: title.fieldSlot,
					formatVersion: title.formatVersion,
					grant: "edit" as const,
					headFieldCursor: title.headFieldCursor,
					fieldReadFence: title.readFence,
					fieldEditFence: title.editFence,
					subjectFieldReadFence: 0n,
					subjectFieldEditFence: 0n,
				},
			],
		},
	};
}

function uuidBytes(value: string): Uint8Array {
	const hex = value.replaceAll("-", "");
	return Uint8Array.from(
		Array.from({ length: 16 }, (_, index) =>
			Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
		),
	);
}

async function seedReadOnlySession(
	db: ReturnType<typeof drizzle<typeof questpieCrdtTables>>,
	fixture: Awaited<ReturnType<typeof seed>>,
) {
	const [binding] = await db
		.select()
		.from(questpieCrdtBindingTable)
		.where(eq(questpieCrdtBindingTable.id, fixture.title.id));
	const [epoch] = await db
		.select()
		.from(questpieCrdtResourceEpochTable)
		.where(eq(questpieCrdtResourceEpochTable.id, fixture.resourceEpochId));
	const [resource] = await db
		.select()
		.from(questpieCrdtResourceTable)
		.where(eq(questpieCrdtResourceTable.id, RESOURCE_ID));
	if (!binding || !epoch || !resource)
		throw new Error("expected read-only session basis");
	const expiresAt = new Date(Date.now() + 120_000);
	const credentialFingerprint = Buffer.alloc(32, 0x51);
	await db.insert(questpieCrdtSessionTable).values({
		id: READ_SESSION_ID,
		resourceId: RESOURCE_ID,
		resourceIncarnationKey: resource.incarnationKey,
		resourceEpochId: fixture.resourceEpochId,
		aggregateEpoch: epoch.aggregateEpoch,
		schemaId: fixture.schemaId,
		schemaVersion: BigInt(manifest.version),
		subjectId: SUBJECT_ID,
		credentialFingerprint,
		requestedMode: 1,
		effectiveMode: 1,
		generation: 0n,
		resourceReadFence: 0n,
		resourceEditFence: 1n,
		ownerPolicyRevision: 0n,
		subjectReadFence: 0n,
		subjectEditFence: 0n,
		authorityExpiresAt: expiresAt,
		lastSeenCommitSeq: epoch.headCommitSeq,
		updateTokens: 120n,
		updateByteTokens: 2n * 1024n * 1024n,
		awarenessTokens: 20n,
		edgeOwnerGeneration: 0n,
		deliveryGeneration: 0n,
		leaseExpiresAt: expiresAt,
	});
	await db.insert(questpieCrdtSessionGrantTable).values({
		sessionId: READ_SESSION_ID,
		resourceId: RESOURCE_ID,
		schemaId: fixture.schemaId,
		bindingId: binding.id,
		stableFieldId: binding.stableFieldId,
		fieldEpoch: binding.fieldEpoch,
		fieldSlot: binding.fieldSlot,
		formatVersion: binding.formatVersion,
		grant: 0,
		headFieldCursor: binding.headFieldCursor,
		fieldReadFence: binding.readFence,
		fieldEditFence: binding.editFence,
		subjectFieldReadFence: 0n,
		subjectFieldEditFence: 0n,
	});
}

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
	const expiresAt = new Date(Date.now() + 120_000);
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
	await db.insert(questpieCrdtSessionTable).values({
		id: SESSION_ID,
		resourceId: RESOURCE_ID,
		resourceIncarnationKey: resource!.incarnationKey,
		resourceEpochId: identity.resourceEpochId,
		aggregateEpoch: 1n,
		schemaId: identity.schemaId,
		schemaVersion: BigInt(manifest.version),
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
		edgeOwnerGeneration: 0n,
		deliveryGeneration: 0n,
		leaseExpiresAt: expiresAt,
	});
	await db.insert(questpieCrdtSessionGrantTable).values({
		sessionId: SESSION_ID,
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
