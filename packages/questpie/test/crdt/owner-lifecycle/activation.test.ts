import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";

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
	CrdtOwnerLifecycleTransaction,
	stageCrdtOwnerActivation,
} from "../../../src/server/modules/core/integrated/crdt/owner-lifecycle.js";
import {
	questpieCrdtBindingTable,
	questpieCrdtResourceEpochTable,
	questpieCrdtResourceTable,
	questpieCrdtSnapshotManifestTable,
	questpieCrdtSnapshotTable,
	questpieCrdtTables,
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
});

async function stage(resourceId: string) {
	return stageCrdtOwnerActivation({
		manifest,
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
