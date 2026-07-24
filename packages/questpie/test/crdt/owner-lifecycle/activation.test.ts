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
import { count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";

import { createDeterministicTextEngine } from "../../../src/server/modules/core/integrated/crdt/deterministic-engine.js";
import {
	resolveCrdtDesiredManifest,
	updateCrdtManifestArtifact,
} from "../../../src/server/modules/core/integrated/crdt/manifest.js";
import {
	canonicalCrdtCollectionLocator,
	createCrdtManifestChangeControlHash,
	CrdtOwnerLifecycleTransaction,
	stageCrdtOwnerActivation,
} from "../../../src/server/modules/core/integrated/crdt/owner-lifecycle.js";
import {
	questpieCrdtBindingTable,
	questpieCrdtCommitTable,
	questpieCrdtResourceEpochTable,
	questpieCrdtResourceTable,
	questpieCrdtSchemaCompatibilityFieldTable,
	questpieCrdtSchemaCompatibilityTable,
	questpieCrdtSessionTable,
	questpieCrdtSnapshotManifestTable,
	questpieCrdtSnapshotTable,
	questpieCrdtSubjectTable,
	questpieCrdtTables,
	questpieCrdtTicketTable,
} from "../../../src/server/modules/core/integrated/crdt/schema.js";

const RESOURCE_ID = "00000000-0000-4000-8000-000000000101";
const ENSURE_RESOURCE_ID = "00000000-0000-4000-8000-000000000102";
const owner = { kind: 1 as const, key: "articles", identityVersion: 1 };
const textEngine = createDeterministicTextEngine();
const declarations = {
	owner,
	fields: {
		title: contract(textEngine),
		tags: {
			format: "set" as const,
			formatVersion: 1,
			engineId: "questpie.deterministic-add-wins-set/v1",
			engineVersion: 1,
			codecFingerprint:
				"86fcad187b9019ecd4399137c4a69116510142858a148b762f0f842a00e8c161",
		},
		content: contract(textEngine),
	},
};
const manifest = resolveCrdtDesiredManifest(
	updateCrdtManifestArtifact({
		namespace: "acme-cms",
		declarations: [declarations],
		createStableFieldId: uuidSequence().next,
	}),
	declarations,
);
const transitionIds = uuidSequence();
const v1Declarations = {
	owner,
	fields: {
		title: contract(textEngine),
		content: contract(textEngine),
	},
};
const v1Artifact = updateCrdtManifestArtifact({
	namespace: "acme-cms",
	declarations: [v1Declarations],
	createStableFieldId: transitionIds.next,
});
const v1Manifest = resolveCrdtDesiredManifest(v1Artifact, v1Declarations);
const v2Declarations = {
	owner,
	fields: declarations.fields,
};
const v2Artifact = updateCrdtManifestArtifact({
	namespace: "acme-cms",
	declarations: [v2Declarations],
	previous: v1Artifact,
	createStableFieldId: transitionIds.next,
});
const v2Manifest = resolveCrdtDesiredManifest(v2Artifact, v2Declarations);
const values = {
	title: "Shared title",
	tags: ["architecture", "design"],
	content: "Collaborative body",
};

describe("CRDT owner activation", () => {
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
		await db.execute(sql`
			CREATE TABLE articles (
				id text PRIMARY KEY,
				title text NOT NULL,
				tags jsonb NOT NULL,
				content text NOT NULL
			)
		`);
	});

	afterEach(async () => {
		await client?.close();
	});

	it("rolls owner and every CRDT row back in the caller transaction", async () => {
		const staged = await stage(RESOURCE_ID);

		await expect(
			db.transaction(async (tx) => {
				await insertOwner(tx);
				const locked = await lockOwner(tx);
				await new CrdtOwnerLifecycleTransaction(tx).activate({
					staged,
					owner: locked,
					mode: "create",
				});
				throw new Error("owner create failed");
			}),
		).rejects.toThrow("owner create failed");

		expect(await scalar(db, "SELECT count(*) FROM articles")).toBe(0);
		const [resourceCount] = await db
			.select({ value: count() })
			.from(questpieCrdtResourceTable);
		const [bindingCount] = await db
			.select({ value: count() })
			.from(questpieCrdtBindingTable);
		expect(resourceCount?.value).toBe(0);
		expect(bindingCount?.value).toBe(0);
	});

	it("activates title, tags, and content under one incarnation and epoch", async () => {
		const staged = await stage(RESOURCE_ID);
		const identity = await db.transaction(async (tx) => {
			await insertOwner(tx);
			const locked = await lockOwner(tx);
			return new CrdtOwnerLifecycleTransaction(tx).activate({
				staged,
				owner: locked,
				mode: "create",
			});
		});

		expect(identity.resourceId).toBe(RESOURCE_ID);
		const [resource] = await db
			.select()
			.from(questpieCrdtResourceTable)
			.where(eq(questpieCrdtResourceTable.id, RESOURCE_ID));
		const [epoch] = await db
			.select()
			.from(questpieCrdtResourceEpochTable)
			.where(eq(questpieCrdtResourceEpochTable.id, identity.resourceEpochId));
		const bindings = await db
			.select()
			.from(questpieCrdtBindingTable)
			.where(eq(questpieCrdtBindingTable.resourceId, RESOURCE_ID));
		const snapshots = await db
			.select()
			.from(questpieCrdtSnapshotTable)
			.where(eq(questpieCrdtSnapshotTable.resourceId, RESOURCE_ID));
		const [snapshotManifest] = await db
			.select()
			.from(questpieCrdtSnapshotManifestTable)
			.where(eq(questpieCrdtSnapshotManifestTable.resourceId, RESOURCE_ID));

		expect(resource).toMatchObject({
			status: 1,
			currentEpochId: identity.resourceEpochId,
			currentEpochStatus: 1,
		});
		expect(epoch).toMatchObject({
			aggregateEpoch: 1n,
			schemaId: identity.schemaId,
			headCommitSeq: 0n,
			projectedCommitSeq: 0n,
		});
		expect(bindings.map((binding) => binding.sourcePath).sort()).toEqual([
			"content",
			"tags",
			"title",
		]);
		expect(new Set(bindings.map((binding) => binding.resourceId))).toEqual(
			new Set([RESOURCE_ID]),
		);
		expect(new Set(bindings.map((binding) => binding.fieldEpoch))).toEqual(
			new Set([1n]),
		);
		expect(snapshots).toHaveLength(3);
		expect(snapshotManifest).toMatchObject({
			status: 2,
			fieldCount: 3,
			coversCommitSeq: 0n,
		});
		expect(epoch?.currentSnapshotManifestId).toBe(snapshotManifest?.id);
	});

	it("revalidates the locked database row against the staged hashes", async () => {
		const staged = await stage(RESOURCE_ID);
		await expect(
			db.transaction(async (tx) => {
				await insertOwner(tx, { title: "changed by a hook" });
				const locked = await lockOwner(tx);
				await new CrdtOwnerLifecycleTransaction(tx).activate({
					staged,
					owner: locked,
					mode: "create",
				});
			}),
		).rejects.toThrow("locked owner value changed");

		expect(await scalar(db, "SELECT count(*) FROM articles")).toBe(0);
	});

	it("makes lazy ensure idempotent without adopting a new resource UUID", async () => {
		const first = await stage(RESOURCE_ID);
		const created = await db.transaction(async (tx) => {
			await insertOwner(tx);
			return new CrdtOwnerLifecycleTransaction(tx).activate({
				staged: first,
				owner: await lockOwner(tx),
				mode: "create",
			});
		});
		const ensured = await db.transaction(async (tx) =>
			new CrdtOwnerLifecycleTransaction(tx).activate({
				staged: await stage(ENSURE_RESOURCE_ID),
				owner: await lockOwner(tx),
				mode: "ensure",
			}),
		);

		expect(ensured).toEqual(created);
		const [resourceCount] = await db
			.select({ value: count() })
			.from(questpieCrdtResourceTable);
		expect(resourceCount?.value).toBe(1);
	});

	it("compares lazy ensure with the projected SQL cut while CRDT head is ahead", async () => {
		await db.transaction(async (tx) => {
			await insertOwner(tx);
			await new CrdtOwnerLifecycleTransaction(tx).activate({
				staged: await stage(RESOURCE_ID),
				owner: await lockOwner(tx),
				mode: "create",
			});
		});
		await db
			.update(questpieCrdtBindingTable)
			.set({
				canonicalHash: Buffer.alloc(32, 0x7f),
				canonicalRevision: 1n,
			})
			.where(eq(questpieCrdtBindingTable.resourceId, RESOURCE_ID));

		const ensured = await db.transaction(async (tx) =>
			new CrdtOwnerLifecycleTransaction(tx).activate({
				staged: await stage(ENSURE_RESOURCE_ID),
				owner: await lockOwner(tx),
				mode: "ensure",
			}),
		);

		expect(ensured.resourceId).toBe(RESOURCE_ID);
		expect(await db.select().from(questpieCrdtCommitTable)).toHaveLength(0);
	});

	it("retires a soft-deleted owner and restores the same incarnation in a new epoch", async () => {
		const created = await db.transaction(async (tx) => {
			await insertOwner(tx);
			return new CrdtOwnerLifecycleTransaction(tx).activate({
				staged: await stage(RESOURCE_ID),
				owner: await lockOwner(tx),
				mode: "create",
			});
		});

		await db.transaction(async (tx) => {
			await lockOwner(tx);
			await new CrdtOwnerLifecycleTransaction(tx).retire({
				manifest,
				locator: canonicalCrdtCollectionLocator("article-1"),
			});
		});

		const [retired] = await db
			.select()
			.from(questpieCrdtResourceTable)
			.where(eq(questpieCrdtResourceTable.id, RESOURCE_ID));
		expect(retired).toMatchObject({
			status: 2,
			currentEpochId: null,
			currentEpochStatus: null,
			ownerPolicyRevision: 1n,
			sessionGeneration: 1n,
		});
		expect(retired?.retiredAt).not.toBeNull();

		const restored = await db.transaction(async (tx) =>
			new CrdtOwnerLifecycleTransaction(tx).restore({
				staged: await stage(ENSURE_RESOURCE_ID),
				owner: await lockOwner(tx),
			}),
		);

		expect(restored.resourceId).toBe(created.resourceId);
		expect(restored.resourceEpochId).not.toBe(created.resourceEpochId);
		const [restoredResource] = await db
			.select()
			.from(questpieCrdtResourceTable)
			.where(eq(questpieCrdtResourceTable.id, RESOURCE_ID));
		expect(restoredResource).toMatchObject({
			ownerPolicyRevision: 2n,
			sessionGeneration: 2n,
		});
		const epochs = await db
			.select()
			.from(questpieCrdtResourceEpochTable)
			.where(eq(questpieCrdtResourceEpochTable.resourceId, RESOURCE_ID));
		expect(epochs.map((epoch) => epoch.aggregateEpoch).sort()).toEqual([
			1n,
			2n,
		]);
		expect(epochs.find((epoch) => epoch.aggregateEpoch === 1n)?.status).toBe(2);
		expect(epochs.find((epoch) => epoch.aggregateEpoch === 2n)?.status).toBe(1);
		const bindings = await db
			.select()
			.from(questpieCrdtBindingTable)
			.where(eq(questpieCrdtBindingTable.resourceId, RESOURCE_ID));
		expect(bindings.filter((binding) => binding.status === 1)).toHaveLength(3);
		expect(
			new Set(
				bindings
					.filter((binding) => binding.status === 1)
					.map((binding) => binding.fieldEpoch),
			),
		).toEqual(new Set([2n]));
	});

	it("creates a new incarnation when a hard-deleted locator is recreated", async () => {
		await db.transaction(async (tx) => {
			await insertOwner(tx);
			await new CrdtOwnerLifecycleTransaction(tx).activate({
				staged: await stage(RESOURCE_ID),
				owner: await lockOwner(tx),
				mode: "create",
			});
		});
		await db.transaction(async (tx) => {
			await lockOwner(tx);
			await tx.execute(sql`DELETE FROM articles WHERE id = 'article-1'`);
			await new CrdtOwnerLifecycleTransaction(tx).retire({
				manifest,
				locator: canonicalCrdtCollectionLocator("article-1"),
			});
		});
		await db.transaction(async (tx) => {
			await insertOwner(tx);
			await new CrdtOwnerLifecycleTransaction(tx).activate({
				staged: await stage(ENSURE_RESOURCE_ID),
				owner: await lockOwner(tx),
				mode: "create",
			});
		});

		const resources = await db
			.select()
			.from(questpieCrdtResourceTable)
			.orderBy(questpieCrdtResourceTable.createdAt);
		expect(resources.map((resource) => resource.id)).toEqual([
			RESOURCE_ID,
			ENSURE_RESOURCE_ID,
		]);
		expect(resources[0]?.status).toBe(2);
		expect(resources[1]?.status).toBe(1);
	});

	it("transitions an active aggregate to an additive manifest in the same epoch", async () => {
		const created = await db.transaction(async (tx) => {
			await insertOwner(tx);
			return new CrdtOwnerLifecycleTransaction(tx).activate({
				staged: await stageManifest(v1Manifest, RESOURCE_ID),
				owner: await lockOwner(tx),
				mode: "create",
			});
		});
		const sourceBindings = await db
			.select()
			.from(questpieCrdtBindingTable)
			.where(eq(questpieCrdtBindingTable.resourceId, RESOURCE_ID));
		const sourceSnapshots = await db
			.select()
			.from(questpieCrdtSnapshotTable)
			.where(eq(questpieCrdtSnapshotTable.resourceId, RESOURCE_ID));
		const [sourceManifest] = await db
			.select()
			.from(questpieCrdtSnapshotManifestTable)
			.where(eq(questpieCrdtSnapshotManifestTable.resourceId, RESOURCE_ID));
		const [sourceResource] = await db
			.select()
			.from(questpieCrdtResourceTable)
			.where(eq(questpieCrdtResourceTable.id, RESOURCE_ID));
		await insertLiveSession(db, {
			resource: sourceResource!,
			resourceEpochId: created.resourceEpochId,
			schemaId: created.schemaId,
		});

		const transitioned = await db.transaction(async (tx) =>
			new CrdtOwnerLifecycleTransaction(tx).activate({
				staged: await stageManifest(v2Manifest, ENSURE_RESOURCE_ID),
				owner: await lockOwner(tx),
				mode: "ensure",
			}),
		);

		expect(transitioned.resourceId).toBe(created.resourceId);
		expect(transitioned.resourceEpochId).toBe(created.resourceEpochId);
		expect(transitioned.schemaId).not.toBe(created.schemaId);
		const [epoch] = await db
			.select()
			.from(questpieCrdtResourceEpochTable)
			.where(eq(questpieCrdtResourceEpochTable.id, created.resourceEpochId));
		expect(epoch).toMatchObject({
			aggregateEpoch: 1n,
			headCommitSeq: 1n,
			projectedCommitSeq: 1n,
			schemaId: transitioned.schemaId,
			previousSnapshotManifestId: sourceManifest?.id,
		});
		const [transitionedResource] = await db
			.select()
			.from(questpieCrdtResourceTable)
			.where(eq(questpieCrdtResourceTable.id, RESOURCE_ID));
		expect(transitionedResource).toMatchObject({
			readFence: 1n,
			editFence: 1n,
			ownerPolicyRevision: 1n,
			sessionGeneration: 1n,
		});
		const [closedSession] = await db.select().from(questpieCrdtSessionTable);
		expect(closedSession?.closedAt).not.toBeNull();
		expect(closedSession?.closeReason).toBe(2);
		const commits = await db
			.select()
			.from(questpieCrdtCommitTable)
			.where(eq(questpieCrdtCommitTable.resourceId, RESOURCE_ID));
		expect(commits).toHaveLength(1);
		expect(commits[0]).toMatchObject({ commitSeq: 1n, kind: 4 });
		expect(Buffer.from(commits[0]!.canonicalBundleHash)).toEqual(
			Buffer.from(
				createCrdtManifestChangeControlHash({
					resourceId: commits[0]!.resourceId,
					resourceEpochId: commits[0]!.resourceEpochId,
					commitSeq: commits[0]!.commitSeq,
					payload: commits[0]!.controlPayload,
				}),
			),
		);
		expect(
			await db.select().from(questpieCrdtSchemaCompatibilityTable),
		).toHaveLength(1);
		expect(
			await db.select().from(questpieCrdtSchemaCompatibilityFieldTable),
		).toHaveLength(2);

		const allBindings = await db
			.select()
			.from(questpieCrdtBindingTable)
			.where(eq(questpieCrdtBindingTable.resourceId, RESOURCE_ID));
		const targetBindings = allBindings.filter(
			(binding) => binding.status === 1,
		);
		expect(targetBindings).toHaveLength(3);
		expect(allBindings.filter((binding) => binding.status === 2)).toHaveLength(
			2,
		);
		const targetSnapshots = await db
			.select()
			.from(questpieCrdtSnapshotTable)
			.where(
				eq(
					questpieCrdtSnapshotTable.manifestId,
					epoch!.currentSnapshotManifestId!,
				),
			);
		expect(targetSnapshots).toHaveLength(3);
		for (const sourceBinding of sourceBindings) {
			const targetBinding = targetBindings.find(
				(binding) => binding.stableFieldId === sourceBinding.stableFieldId,
			)!;
			const sourceSnapshot = sourceSnapshots.find(
				(snapshot) => snapshot.bindingId === sourceBinding.id,
			)!;
			const targetSnapshot = targetSnapshots.find(
				(snapshot) => snapshot.bindingId === targetBinding.id,
			)!;
			expect(targetBinding.fieldEpoch).toBe(sourceBinding.fieldEpoch + 1n);
			expect(sourceBinding.readFence).toBe(0n);
			expect(targetBinding.readFence).toBe(1n);
			expect(Buffer.from(targetSnapshot.bytes)).toEqual(
				Buffer.from(sourceSnapshot.bytes),
			);
			expect(targetSnapshot.fieldCursor).toBe(sourceSnapshot.fieldCursor);
		}

		await db.transaction(async (tx) =>
			new CrdtOwnerLifecycleTransaction(tx).activate({
				staged: await stageManifest(v2Manifest, ENSURE_RESOURCE_ID),
				owner: await lockOwner(tx),
				mode: "ensure",
			}),
		);
		const [commitCount] = await db
			.select({ value: count() })
			.from(questpieCrdtCommitTable);
		expect(commitCount?.value).toBe(1);
	});

	it("rejects a corrupt source manifest without partially transitioning", async () => {
		await db.transaction(async (tx) => {
			await insertOwner(tx);
			await new CrdtOwnerLifecycleTransaction(tx).activate({
				staged: await stageManifest(v1Manifest, RESOURCE_ID),
				owner: await lockOwner(tx),
				mode: "create",
			});
		});
		await db
			.update(questpieCrdtSnapshotManifestTable)
			.set({ checksum: Buffer.alloc(32, 0x55) })
			.where(eq(questpieCrdtSnapshotManifestTable.resourceId, RESOURCE_ID));

		await expect(
			db.transaction(async (tx) =>
				new CrdtOwnerLifecycleTransaction(tx).activate({
					staged: await stageManifest(v2Manifest, ENSURE_RESOURCE_ID),
					owner: await lockOwner(tx),
					mode: "ensure",
				}),
			),
		).rejects.toThrow("source manifest checksum is invalid");

		const bindings = await db
			.select()
			.from(questpieCrdtBindingTable)
			.where(eq(questpieCrdtBindingTable.resourceId, RESOURCE_ID));
		expect(bindings).toHaveLength(2);
		expect(bindings.every((binding) => binding.status === 1)).toBe(true);
		expect(await db.select().from(questpieCrdtCommitTable)).toHaveLength(0);
	});

	it("rolls an applied manifest transition back with the caller transaction", async () => {
		const created = await db.transaction(async (tx) => {
			await insertOwner(tx);
			return new CrdtOwnerLifecycleTransaction(tx).activate({
				staged: await stageManifest(v1Manifest, RESOURCE_ID),
				owner: await lockOwner(tx),
				mode: "create",
			});
		});

		await expect(
			db.transaction(async (tx) => {
				await new CrdtOwnerLifecycleTransaction(tx).activate({
					staged: await stageManifest(v2Manifest, ENSURE_RESOURCE_ID),
					owner: await lockOwner(tx),
					mode: "ensure",
				});
				throw new Error("caller failed");
			}),
		).rejects.toThrow("caller failed");

		const [epoch] = await db
			.select()
			.from(questpieCrdtResourceEpochTable)
			.where(eq(questpieCrdtResourceEpochTable.id, created.resourceEpochId));
		expect(epoch).toMatchObject({
			schemaId: created.schemaId,
			headCommitSeq: 0n,
			projectedCommitSeq: 0n,
		});
		const bindings = await db
			.select()
			.from(questpieCrdtBindingTable)
			.where(eq(questpieCrdtBindingTable.resourceId, RESOURCE_ID));
		expect(bindings).toHaveLength(2);
		expect(bindings.every((binding) => binding.status === 1)).toBe(true);
	});

	it("serializes concurrent manifest ensures into one control commit", async () => {
		await db.transaction(async (tx) => {
			await insertOwner(tx);
			await new CrdtOwnerLifecycleTransaction(tx).activate({
				staged: await stageManifest(v1Manifest, RESOURCE_ID),
				owner: await lockOwner(tx),
				mode: "create",
			});
		});
		const staged = await Promise.all(
			Array.from({ length: 4 }, () =>
				stageManifest(v2Manifest, ENSURE_RESOURCE_ID),
			),
		);

		const identities = await Promise.all(
			staged.map((candidate) =>
				db.transaction(async (tx) =>
					new CrdtOwnerLifecycleTransaction(tx).activate({
						staged: candidate,
						owner: await lockOwner(tx),
						mode: "ensure",
					}),
				),
			),
		);

		expect(new Set(identities.map((identity) => identity.resourceId))).toEqual(
			new Set([RESOURCE_ID]),
		);
		expect(await db.select().from(questpieCrdtCommitTable)).toHaveLength(1);
		expect(
			await db.select().from(questpieCrdtSchemaCompatibilityTable),
		).toHaveLength(1);
	});

	it("fails closed when the source snapshot does not cover the projected head", async () => {
		const created = await db.transaction(async (tx) => {
			await insertOwner(tx);
			return new CrdtOwnerLifecycleTransaction(tx).activate({
				staged: await stageManifest(v1Manifest, RESOURCE_ID),
				owner: await lockOwner(tx),
				mode: "create",
			});
		});
		await db
			.update(questpieCrdtResourceEpochTable)
			.set({ headCommitSeq: 1n })
			.where(eq(questpieCrdtResourceEpochTable.id, created.resourceEpochId));

		await expect(
			db.transaction(async (tx) =>
				new CrdtOwnerLifecycleTransaction(tx).activate({
					staged: await stageManifest(v2Manifest, ENSURE_RESOURCE_ID),
					owner: await lockOwner(tx),
					mode: "ensure",
				}),
			),
		).rejects.toThrow("requires a fully projected verified cut");
		expect(await db.select().from(questpieCrdtCommitTable)).toHaveLength(0);
		const bindings = await db
			.select()
			.from(questpieCrdtBindingTable)
			.where(eq(questpieCrdtBindingTable.resourceId, RESOURCE_ID));
		expect(bindings).toHaveLength(2);
		expect(bindings.every((binding) => binding.status === 1)).toBe(true);
	});
});

async function stage(resourceId: string) {
	return stageManifest(manifest, resourceId);
}

async function stageManifest(
	targetManifest: typeof manifest,
	resourceId: string,
) {
	return stageCrdtOwnerActivation({
		manifest: targetManifest,
		resourceId,
		values,
		textEngine,
	});
}

async function insertOwner(
	tx: any,
	overrides: Partial<typeof values> = {},
): Promise<void> {
	const row = { ...values, ...overrides };
	await tx.execute(sql`
		INSERT INTO articles (id, title, tags, content)
		VALUES ('article-1', ${row.title}, ${JSON.stringify(row.tags)}::jsonb, ${row.content})
	`);
}

async function lockOwner(tx: any) {
	const result = await tx.execute(sql`
		SELECT id, title, tags, content
		FROM articles
		WHERE id = 'article-1'
		FOR UPDATE
	`);
	const row = result.rows[0] as typeof values & { id: string };
	return {
		locator: canonicalCrdtCollectionLocator(row.id),
		values: row,
	};
}

async function scalar(db: any, query: string): Promise<number> {
	const result = await db.execute(sql.raw(query));
	return Number(result.rows[0]?.count);
}

async function insertLiveSession(
	db: any,
	input: {
		resource: typeof questpieCrdtResourceTable.$inferSelect;
		resourceEpochId: string;
		schemaId: string;
	},
): Promise<void> {
	const subjectId = "00000000-0000-4000-8000-000000000201";
	const ticketId = "00000000-0000-4000-8000-000000000202";
	const sessionId = "00000000-0000-4000-8000-000000000203";
	const credentialFingerprint = Buffer.alloc(32, 0x21);
	const expiresAt = new Date(Date.now() + 60_000);
	await db.insert(questpieCrdtSubjectTable).values({
		id: subjectId,
		kind: 1,
		issuerKey: "",
		subjectKey: "user-1",
		subjectHash: Buffer.alloc(32, 0x20),
	});
	await db.insert(questpieCrdtTicketTable).values({
		id: ticketId,
		resourceId: input.resource.id,
		resourceEpochId: input.resourceEpochId,
		definitionId: input.resource.definitionId,
		schemaId: input.schemaId,
		subjectId,
		secretHash: Buffer.alloc(32, 0x22),
		credentialFingerprint,
		audience: "test",
		requestedMode: 2,
		effectiveMode: 2,
		protocolMajor: 1,
		protocolMinor: 0,
		resourceReadFence: input.resource.readFence,
		resourceEditFence: input.resource.editFence,
		ownerPolicyRevision: input.resource.ownerPolicyRevision,
		subjectReadFence: 0n,
		subjectEditFence: 0n,
		sessionGeneration: input.resource.sessionGeneration,
		authorityExpiresAt: expiresAt,
		expiresAt,
		redeemedAt: new Date(),
	});
	await db.insert(questpieCrdtSessionTable).values({
		id: sessionId,
		ticketId,
		resourceId: input.resource.id,
		resourceEpochId: input.resourceEpochId,
		schemaId: input.schemaId,
		subjectId,
		credentialFingerprint,
		requestedMode: 2,
		effectiveMode: 2,
		generation: input.resource.sessionGeneration,
		resourceReadFence: input.resource.readFence,
		resourceEditFence: input.resource.editFence,
		ownerPolicyRevision: input.resource.ownerPolicyRevision,
		subjectReadFence: 0n,
		subjectEditFence: 0n,
		authorityExpiresAt: expiresAt,
		lastSeenCommitSeq: 0n,
		leaseExpiresAt: expiresAt,
	});
}

function contract(engine: typeof textEngine) {
	return {
		format: "text" as const,
		formatVersion: engine.formatVersion,
		engineId: engine.engineId,
		engineVersion: engine.engineVersion,
		codecFingerprint: engine.codecFingerprint,
	};
}

function uuidSequence() {
	let value = 0;
	return {
		next: () =>
			`00000000-0000-4000-8000-${(++value).toString(16).padStart(12, "0")}`,
	};
}
