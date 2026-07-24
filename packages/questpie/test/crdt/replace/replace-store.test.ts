import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";

import {
	getCurrentTransaction,
	onAfterCommit,
} from "../../../src/server/collection/crud/shared/transaction.js";
import type { AnyDrizzleClient } from "../../../src/server/config/types.js";
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
	createCrdtReplaceStore,
	type CrdtReplaceOwnerPort,
} from "../../../src/server/modules/core/integrated/crdt/replace-store.js";
import {
	questpieCrdtBindingTable,
	questpieCrdtCommitTable,
	questpieCrdtProjectionTable,
	questpieCrdtResourceEpochTable,
	questpieCrdtResourceTable,
	questpieCrdtSnapshotManifestTable,
	questpieCrdtTables,
} from "../../../src/server/modules/core/integrated/crdt/schema.js";

const RESOURCE_ID = "00000000-0000-4000-8000-000000000401";
const textEngine = createDeterministicTextEngine();
const stableIds = [
	"00000000-0000-4000-8000-000000000402",
	"00000000-0000-4000-8000-000000000403",
] as const;
let stableIndex = 0;
const declaration = {
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
		namespace: "replace-test",
		declarations: [declaration],
		createStableFieldId: () => stableIds[stableIndex++]!,
	}),
	declaration,
);

describe("CRDT durable replace store", () => {
	let ddl: string[];
	let client: PGlite;
	let db: ReturnType<typeof drizzle<typeof questpieCrdtTables>>;
	let fixture: Awaited<ReturnType<typeof seedFixture>>;
	let notifications: number;

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
		await db.execute(sql`
			CREATE TABLE replace_outbox (
				id uuid PRIMARY KEY,
				origin text NOT NULL,
				resource_epoch_id uuid NOT NULL,
				commit_seq bigint NOT NULL
			)
		`);
		fixture = await seedFixture(db);
		notifications = 0;
	});

	afterEach(async () => {
		await client.close();
	});

	afterAll(() => {
		stableIndex = 0;
	});

	it("replaces one field, preserves the aggregate epoch, and commits one barrier/outbox", async () => {
		const store = createCrdtReplaceStore(db, {
			owner: ownerPort(db, () => notifications++),
			engines: { text: textEngine },
		});
		const result = await store.replaceField({
			resourceId: RESOURCE_ID,
			stableFieldId: fixture.title.stableFieldId,
			value: "Reset title",
			expected: {
				fieldEpoch: fixture.title.fieldEpoch,
				canonicalRevision: fixture.title.canonicalRevision,
			},
			reason: "resolve",
		});

		expect(result).toMatchObject({
			resourceId: RESOURCE_ID,
			aggregateEpoch: fixture.aggregateEpoch,
			commitSeq: 1n,
			outboxChanges: 1,
			origin: "crdt_replace",
		});
		const [article] = rowsOf<{
			title: string;
			content: string;
		}>(
			await db.execute(
				sql`SELECT title, content FROM articles WHERE id = 'article-1'`,
			),
		);
		expect(article).toEqual({ title: "Reset title", content: "Body" });
		const [epoch] = await db
			.select()
			.from(questpieCrdtResourceEpochTable)
			.where(eq(questpieCrdtResourceEpochTable.id, fixture.resourceEpochId));
		expect(epoch).toMatchObject({
			aggregateEpoch: fixture.aggregateEpoch,
			headCommitSeq: 1n,
			projectedCommitSeq: 0n,
		});
		const bindings = await activeBindings(db);
		expect(
			bindings.find((field) => field.sourcePath === "title"),
		).toMatchObject({
			fieldEpoch: fixture.title.fieldEpoch + 1n,
			headFieldCursor: 0n,
			projectedFieldCursor: 0n,
		});
		expect(
			bindings.find((field) => field.sourcePath === "content"),
		).toMatchObject({
			id: fixture.content.id,
			fieldEpoch: fixture.content.fieldEpoch,
		});
		expect(await db.select().from(questpieCrdtCommitTable)).toHaveLength(1);
		expect(await db.select().from(questpieCrdtProjectionTable)).toHaveLength(1);
		expect(
			await db.select().from(questpieCrdtSnapshotManifestTable),
		).toHaveLength(2);
		expect(await outboxRows(db)).toHaveLength(1);
		expect(notifications).toBe(1);
	});

	it("advances the aggregate epoch atomically and fences the old epoch", async () => {
		const store = createCrdtReplaceStore(db, {
			owner: ownerPort(db, () => notifications++),
			engines: { text: textEngine },
		});
		const result = await store.replaceAggregate({
			resourceId: RESOURCE_ID,
			values: { title: "Imported", content: "Imported body" },
			expected: {
				aggregateEpoch: fixture.aggregateEpoch,
				canonicalRevisions: {
					title: fixture.title.canonicalRevision,
					content: fixture.content.canonicalRevision,
				},
			},
			reason: "import",
		});

		expect(result.aggregateEpoch).toBe(fixture.aggregateEpoch + 1n);
		expect(result.commitSeq).toBe(1n);
		const epochs = await db
			.select()
			.from(questpieCrdtResourceEpochTable)
			.orderBy(asc(questpieCrdtResourceEpochTable.aggregateEpoch));
		expect(epochs).toHaveLength(2);
		expect(epochs[0]).toMatchObject({
			aggregateEpoch: fixture.aggregateEpoch,
			status: 2,
		});
		expect(epochs[1]).toMatchObject({
			aggregateEpoch: fixture.aggregateEpoch + 1n,
			status: 1,
			headCommitSeq: 1n,
			projectedCommitSeq: 1n,
		});
		const [resource] = await db
			.select()
			.from(questpieCrdtResourceTable)
			.where(eq(questpieCrdtResourceTable.id, RESOURCE_ID));
		expect(resource?.currentEpochId).toBe(epochs[1]!.id);
		expect(resource?.status).toBe(1);
		expect(
			(await activeBindings(db)).every((field) => field.fieldEpoch === 2n),
		).toBeTrue();
		expect(await outboxRows(db)).toHaveLength(1);
		expect(notifications).toBe(1);
	});

	it("rolls back canonical state, control rows, manifest, and outbox on a late failure", async () => {
		const failing = ownerPort(db, () => notifications++, true);
		const store = createCrdtReplaceStore(db, {
			owner: failing,
			engines: { text: textEngine },
		});
		await expect(
			store.replaceField({
				resourceId: RESOURCE_ID,
				stableFieldId: fixture.title.stableFieldId,
				value: "Must rollback",
				expected: {
					fieldEpoch: fixture.title.fieldEpoch,
					canonicalRevision: fixture.title.canonicalRevision,
				},
				reason: "agent",
			}),
		).rejects.toThrow("injected outbox failure");

		const [article] = rowsOf<{ title: string }>(
			await db.execute(sql`SELECT title FROM articles WHERE id = 'article-1'`),
		);
		expect(article?.title).toBe("Shared");
		expect(await db.select().from(questpieCrdtCommitTable)).toHaveLength(0);
		expect(await db.select().from(questpieCrdtProjectionTable)).toHaveLength(0);
		expect(
			await db.select().from(questpieCrdtSnapshotManifestTable),
		).toHaveLength(1);
		expect(await outboxRows(db)).toHaveLength(0);
		expect(await activeBindings(db)).toHaveLength(2);
		expect(notifications).toBe(0);
	});

	it("turns a lost-response retry into a CAS conflict without duplicating outbox", async () => {
		const store = createCrdtReplaceStore(db, {
			owner: ownerPort(db, () => notifications++),
			engines: { text: textEngine },
		});
		const input = {
			resourceId: RESOURCE_ID,
			stableFieldId: fixture.title.stableFieldId,
			value: "Only once",
			expected: {
				fieldEpoch: fixture.title.fieldEpoch,
				canonicalRevision: fixture.title.canonicalRevision,
			},
			reason: "resolve" as const,
		};
		await store.replaceField(input);
		await expect(store.replaceField(input)).rejects.toThrow(
			"CRDT replace basis is stale",
		);
		expect(await outboxRows(db)).toHaveLength(1);
		expect(await db.select().from(questpieCrdtCommitTable)).toHaveLength(1);
		expect(notifications).toBe(1);
	});
});

function ownerPort(
	db: AnyDrizzleClient<any>,
	onNotify: () => void,
	failOutbox = false,
): CrdtReplaceOwnerPort<{ row: Record<string, unknown> }> {
	return {
		async lock(transaction) {
			const [row] = rowsOf<Record<string, unknown>>(
				await transaction.execute(
					sql`SELECT * FROM articles WHERE id = 'article-1' FOR UPDATE`,
				),
			);
			if (!row) throw new Error("owner missing");
			return { row };
		},
		async writeCanonical(transaction, owner, values) {
			expect(getCurrentTransaction()).toBe(transaction);
			for (const [path, value] of values) {
				if (path === "title") {
					await transaction.execute(
						sql`UPDATE articles SET title = ${value} WHERE id = 'article-1'`,
					);
				} else if (path === "content") {
					await transaction.execute(
						sql`UPDATE articles SET content = ${value} WHERE id = 'article-1'`,
					);
				}
				owner.row[path] = value;
			}
		},
		async appendRealtimeChange(transaction, _owner, input) {
			expect(getCurrentTransaction()).toBe(transaction);
			if (failOutbox) throw new Error("injected outbox failure");
			await transaction.execute(sql`
				INSERT INTO replace_outbox (id, origin, resource_epoch_id, commit_seq)
				VALUES (${randomUUID()}, ${input.origin}, ${input.resourceEpochId}, ${input.commitSeq})
			`);
			onAfterCommit(async () => onNotify());
			return 1;
		},
	};
}

async function activeBindings(db: AnyDrizzleClient<any>) {
	return db
		.select()
		.from(questpieCrdtBindingTable)
		.where(
			and(
				eq(questpieCrdtBindingTable.resourceId, RESOURCE_ID),
				isNull(questpieCrdtBindingTable.retiredAt),
			),
		)
		.orderBy(asc(questpieCrdtBindingTable.sourcePath));
}

async function outboxRows(db: AnyDrizzleClient<any>) {
	return rowsOf(
		await db.execute(sql`SELECT * FROM replace_outbox ORDER BY commit_seq`),
	);
}

function rowsOf<T>(result: unknown): T[] {
	if (Array.isArray(result)) return result as T[];
	if (
		result &&
		typeof result === "object" &&
		Array.isArray((result as { rows?: unknown }).rows)
	) {
		return (result as { rows: T[] }).rows;
	}
	return [];
}

async function seedFixture(db: AnyDrizzleClient<any>) {
	await db.execute(sql`
		INSERT INTO articles (id, title, content)
		VALUES ('article-1', 'Shared', 'Body')
	`);
	const staged = await stageCrdtOwnerActivation({
		manifest,
		resourceId: RESOURCE_ID,
		values: { title: "Shared", content: "Body" },
		textEngine,
	});
	const identity = await db.transaction((tx: AnyDrizzleClient<any>) =>
		new CrdtOwnerLifecycleTransaction(tx).activate({
			staged,
			owner: {
				locator: canonicalCrdtCollectionLocator("article-1"),
				values: { title: "Shared", content: "Body" },
			},
			mode: "create",
		}),
	);
	const bindings = await activeBindings(db);
	const [epoch] = await db
		.select()
		.from(questpieCrdtResourceEpochTable)
		.where(eq(questpieCrdtResourceEpochTable.id, identity.resourceEpochId));
	return {
		...identity,
		aggregateEpoch: epoch!.aggregateEpoch,
		title: bindings.find((field: any) => field.sourcePath === "title")!,
		content: bindings.find((field: any) => field.sourcePath === "content")!,
	};
}
