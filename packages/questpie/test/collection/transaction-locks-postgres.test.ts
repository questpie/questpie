import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { memory } from "files-sdk/memory";
import pg from "pg";

import { collection, withTransaction } from "../../src/exports/index.js";
import {
	claimStorageCleanup,
	enqueueStorageCleanup,
} from "../../src/server/modules/core/integrated/storage/cleanup-store.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const databaseUrl = process.env.QUESTPIE_TRANSACTION_LOCK_DATABASE_URL;
const runPostgresContract = Boolean(databaseUrl);

const postgresLockTargets = collection("postgres_lock_targets")
	.fields(({ f }) => ({
		name: f.text().required(),
		visibility: f.text().required(),
	}))
	.access({
		read: ({ session }) =>
			(session?.user as { role?: string } | undefined)?.role === "admin"
				? true
				: { visibility: "public" },
	});

let pausePurge: ((data: Record<string, unknown>) => Promise<void>) | undefined;
let pauseRelationWrite:
	| ((data: Record<string, unknown>) => Promise<void>)
	| undefined;
let pauseJunctionWrite:
	| ((data: Record<string, unknown>) => Promise<void>)
	| undefined;

const postgresPurgeParents = collection("postgres_purge_parents")
	.fields(({ f }) => ({ name: f.text().required() }))
	.options({ softDelete: true })
	.access({ purge: true })
	.hooks({
		beforePurge: ({ data }) => pausePurge?.(data),
	});

const postgresPurgeChildren = collection("postgres_purge_children")
	.fields(({ f }) => ({
		name: f.text().required(),
		parent: f.relation("postgres_purge_parents").required(),
	}))
	.hooks({
		afterChange: ({ data, operation }) =>
			operation === "create" ? pauseRelationWrite?.(data) : undefined,
	});

const postgresUploadAssets = collection("postgres_upload_assets")
	.fields(({ f }) => ({ alt: f.text() }))
	.options({ softDelete: true })
	.upload()
	.access({ purge: true });

const postgresJunctionParents = collection("postgres_junction_parents")
	.fields(({ f }) => ({
		name: f.text().required(),
		tags: f.relation("postgres_junction_tags").manyToMany({
			through: "postgres_junction_rows",
			sourceField: "parentId",
			targetField: "tagId",
		}),
	}))
	.options({ softDelete: true })
	.access({ purge: true });

const postgresJunctionTags = collection("postgres_junction_tags").fields(
	({ f }) => ({ name: f.text().required() }),
);

const postgresJunctionRows = collection("postgres_junction_rows")
	.fields(({ f }) => ({
		parentId: f.text(36).required(),
		tagId: f.text(36).required(),
	}))
	.hooks({
		afterChange: ({ data, operation }) =>
			operation === "create" ? pauseJunctionWrite?.(data) : undefined,
	});

let pauseParentDelete:
	| ((data: Record<string, unknown>) => Promise<void>)
	| undefined;

let pauseParentChange:
	| ((data: Record<string, unknown>) => Promise<void>)
	| undefined;
let pauseSoftChildWrite:
	| ((data: Record<string, unknown>) => Promise<void>)
	| undefined;

const postgresFkParents = collection("postgres_fk_parents")
	.fields(({ f }) => ({
		name: f.text().required(),
		code: f.text(64).drizzle((col) => col.unique()),
	}))
	.options({ optimisticConcurrency: true })
	.hooks({
		beforeChange: ({ data, operation }) =>
			operation === "update" ? pauseParentChange?.(data) : undefined,
		beforeDelete: ({ data }) => pauseParentDelete?.(data),
	});

const postgresFkChildren = collection("postgres_fk_children").fields(
	({ f }) => ({
		name: f.text().required(),
		parent: f.relation("postgres_fk_parents"),
	}),
);

const postgresFkSoftParents = collection("postgres_fk_soft_parents")
	.fields(({ f }) => ({
		name: f.text().required(),
		children: f.relation("postgres_fk_soft_children").hasMany({
			foreignKey: "parent",
			onDelete: "restrict",
			relationName: "parent",
		}),
	}))
	.options({ softDelete: true });

const postgresFkSoftChildren = collection("postgres_fk_soft_children")
	.fields(({ f }) => ({
		name: f.text().required(),
		parent: f
			.relation("postgres_fk_soft_parents")
			.required()
			.onDelete("restrict")
			.relationName("parent"),
	}))
	.hooks({
		afterChange: ({ data, operation }) =>
			operation === "create" ? pauseSoftChildWrite?.(data) : undefined,
	});

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function waitForAttempt() {
	await new Promise((resolve) => setTimeout(resolve, 100));
}

describe.skipIf(!runPostgresContract)(
	"transaction-scoped locks on supported PostgreSQL",
	() => {
		let setup: Awaited<ReturnType<typeof buildMockApp>>;
		let rawFkPool: pg.Pool | undefined;
		const systemContext = createTestContext();

		beforeAll(async () => {
			const pool = new pg.Pool({ connectionString: databaseUrl });
			try {
				const result = await pool.query<{ server_version_num: string }>(
					"show server_version_num",
				);
				expect(
					Number(result.rows[0]?.server_version_num),
				).toBeGreaterThanOrEqual(150_000);
				await pool.query("create extension if not exists pg_trgm");
			} finally {
				await pool.end();
			}

			setup = await buildMockApp(
				{
					collections: {
						postgresLockTargets,
						postgres_purge_parents: postgresPurgeParents,
						postgres_purge_children: postgresPurgeChildren,
						postgres_upload_assets: postgresUploadAssets,
						postgres_junction_parents: postgresJunctionParents,
						postgres_junction_tags: postgresJunctionTags,
						postgres_junction_rows: postgresJunctionRows,
						postgres_fk_parents: postgresFkParents,
						postgres_fk_children: postgresFkChildren,
						postgres_fk_soft_parents: postgresFkSoftParents,
						postgres_fk_soft_children: postgresFkSoftChildren,
					},
				},
				{
					db: { url: databaseUrl!, pool: { max: 10 } },
					storage: { adapter: memory() },
				},
			);
			await runTestDbMigrations(setup.app);

			// Collection relations are application-level; this table carries a real
			// database foreign key to the same parent.
			rawFkPool = new pg.Pool({ connectionString: databaseUrl });
			const idType = await rawFkPool.query<{ type: string }>(
				`select format_type(atttypid, atttypmod) as type
				from pg_attribute
				where attname = 'id' and attrelid = 'postgres_fk_parents'::regclass`,
			);
			await rawFkPool.query(
				`create table postgres_fk_raw_children (
					parent_id ${idType.rows[0]!.type} references postgres_fk_parents (id)
				)`,
			);
		});

		afterAll(async () => {
			if (!setup) return;
			if (rawFkPool) {
				await rawFkPool.query("drop table if exists postgres_fk_raw_children");
				await rawFkPool.end();
			}
			await setup.app.migrations.down();
			await setup.cleanup();
		});

		it("blocks a second physical transaction until the first commits", async () => {
			const target = await setup.app.collections.postgresLockTargets.create(
				{ name: "Company", visibility: "public" },
				systemContext,
			);
			const firstLocked = deferred();
			const releaseFirst = deferred();
			let secondAcquired = false;

			const first = withTransaction(setup.app.db, async (tx) => {
				await setup.app.collections.postgresLockTargets.lockMany(
					{ ids: [target.id] },
					{ ...systemContext, db: tx },
				);
				firstLocked.resolve();
				await releaseFirst.promise;
			});
			await firstLocked.promise;

			const second = withTransaction(setup.app.db, async (tx) => {
				await setup.app.collections.postgresLockTargets.lockMany(
					{ ids: [target.id] },
					{ ...systemContext, db: tx },
				);
				secondAcquired = true;
			});
			await waitForAttempt();
			expect(secondAcquired).toBe(false);
			releaseFirst.resolve();

			await Promise.all([first, second]);
			expect(secondAcquired).toBe(true);
		});

		it("releases the lock when the owning transaction rolls back", async () => {
			const target = await setup.app.collections.postgresLockTargets.create(
				{ name: "Rollback", visibility: "public" },
				systemContext,
			);
			const firstLocked = deferred();
			const rollbackFirst = deferred();
			let secondAcquired = false;

			const first = withTransaction(setup.app.db, async (tx) => {
				await setup.app.collections.postgresLockTargets.lockMany(
					{ ids: [target.id] },
					{ ...systemContext, db: tx },
				);
				firstLocked.resolve();
				await rollbackFirst.promise;
				throw new Error("rollback lock owner");
			});
			await firstLocked.promise;

			const second = withTransaction(setup.app.db, async (tx) => {
				await setup.app.collections.postgresLockTargets.lockMany(
					{ ids: [target.id] },
					{ ...systemContext, db: tx },
				);
				secondAcquired = true;
			});
			await waitForAttempt();
			expect(secondAcquired).toBe(false);
			rollbackFirst.resolve();

			await expect(first).rejects.toThrow("rollback lock owner");
			await second;
			expect(secondAcquired).toBe(true);
		});

		it("orders reversed id inputs consistently without deadlocking", async () => {
			const firstTarget =
				await setup.app.collections.postgresLockTargets.create(
					{ name: "First", visibility: "public" },
					systemContext,
				);
			const secondTarget =
				await setup.app.collections.postgresLockTargets.create(
					{ name: "Second", visibility: "public" },
					systemContext,
				);

			const outcomes = await Promise.race([
				Promise.all([
					withTransaction(setup.app.db, (tx) =>
						setup.app.collections.postgresLockTargets.lockMany(
							{ ids: [firstTarget.id, secondTarget.id] },
							{ ...systemContext, db: tx },
						),
					),
					withTransaction(setup.app.db, (tx) =>
						setup.app.collections.postgresLockTargets.lockMany(
							{ ids: [secondTarget.id, firstTarget.id] },
							{ ...systemContext, db: tx },
						),
					),
				]),
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new Error("row lock deadlock timeout")),
						3_000,
					),
				),
			]);

			expect(outcomes).toEqual([
				[firstTarget.id, secondTarget.id].sort(),
				[firstTarget.id, secondTarget.id].sort(),
			]);
		});

		it("rechecks row access after waiting for a concurrent lock", async () => {
			const target = await setup.app.collections.postgresLockTargets.create(
				{ name: "Access", visibility: "public" },
				systemContext,
			);
			const firstLocked = deferred();
			const updateAccess = deferred();
			const memberContext = createTestContext({ role: "member" });

			const first = withTransaction(setup.app.db, async (tx) => {
				await setup.app.collections.postgresLockTargets.lockMany(
					{ ids: [target.id] },
					{ ...systemContext, db: tx },
				);
				firstLocked.resolve();
				await updateAccess.promise;
				await setup.app.collections.postgresLockTargets.updateById(
					{ id: target.id, data: { visibility: "private" } },
					{ ...systemContext, db: tx },
				);
			});
			await firstLocked.promise;

			const waitingLock = withTransaction(setup.app.db, (tx) =>
				setup.app.collections.postgresLockTargets.lockMany(
					{ ids: [target.id] },
					{ ...memberContext, db: tx },
				),
			);
			await waitForAttempt();
			updateAccess.resolve();

			await first;
			expect(await waitingLock).toEqual([]);
		});

		it("rejects an active purge before taking relation table locks", async () => {
			const parent = await setup.app.collections.postgres_purge_parents.create(
				{ name: "Still active" },
				systemContext,
			);
			const writerInserted = deferred();
			const releaseWriter = deferred();
			pauseRelationWrite = async (data) => {
				if (data.parent !== parent.id) return;
				writerInserted.resolve();
				await releaseWriter.promise;
			};
			const writer = setup.app.collections.postgres_purge_children.create(
				{ name: "Concurrent child", parent: parent.id },
				systemContext,
			);
			await writerInserted.promise;

			const activePurgeOutcome = await Promise.race([
				setup.app.collections.postgres_purge_parents
					.purgeById({ id: parent.id }, systemContext)
					.then(
						() => ({ error: undefined }),
						(error: unknown) => ({ error }),
					),
				new Promise<{ error: Error }>((resolve) =>
					setTimeout(
						() =>
							resolve({
								error: new Error(
									"active purge waited for relation table locks",
								),
							}),
						500,
					),
				),
			]);
			expect(activePurgeOutcome.error).toMatchObject({ code: "CONFLICT" });
			expect(activePurgeOutcome.error).not.toMatchObject({
				message: "active purge waited for relation table locks",
			});

			releaseWriter.resolve();
			await writer;
			pauseRelationWrite = undefined;
		});

		it("bounds relation table lock waits with a retryable conflict", async () => {
			const parent = await setup.app.collections.postgres_purge_parents.create(
				{ name: "Bounded wait" },
				systemContext,
			);
			await setup.app.collections.postgres_purge_parents.deleteById(
				{ id: parent.id },
				systemContext,
			);
			const writerInserted = deferred();
			const releaseWriter = deferred();
			pauseRelationWrite = async (data) => {
				if (data.parent !== parent.id) return;
				writerInserted.resolve();
				await releaseWriter.promise;
			};
			const writer = setup.app.collections.postgres_purge_children.create(
				{ name: "Lock holder", parent: parent.id },
				systemContext,
			);
			await writerInserted.promise;

			const startedAt = Date.now();
			await expect(
				setup.app.collections.postgres_purge_parents.purgeById(
					{ id: parent.id },
					systemContext,
				),
			).rejects.toMatchObject({
				code: "CONFLICT",
				message: "Physical purge could not acquire relation locks; retry later",
			});
			expect(Date.now() - startedAt).toBeLessThan(5_000);

			releaseWriter.resolve();
			await writer;
			pauseRelationWrite = undefined;
		});

		it("serializes application-only relation writes with physical purge", async () => {
			const purgeFirstParent =
				await setup.app.collections.postgres_purge_parents.create(
					{ name: "Purge wins" },
					systemContext,
				);
			await setup.app.collections.postgres_purge_parents.deleteById(
				{ id: purgeFirstParent.id },
				systemContext,
			);
			const purgeLocked = deferred();
			const releasePurge = deferred();
			pausePurge = async (data) => {
				if (data.id !== purgeFirstParent.id) return;
				purgeLocked.resolve();
				await releasePurge.promise;
			};

			const purge = setup.app.collections.postgres_purge_parents.purgeById(
				{ id: purgeFirstParent.id },
				systemContext,
			);
			await purgeLocked.promise;
			let lateWriterFinished = false;
			const lateWriter = setup.app.collections.postgres_purge_children
				.create(
					{
						name: "Must not dangle",
						parent: purgeFirstParent.id,
					},
					systemContext,
				)
				.finally(() => {
					lateWriterFinished = true;
				});
			const lateWriterOutcome = lateWriter.then(
				() => ({ error: undefined }),
				(error: unknown) => ({ error }),
			);
			await waitForAttempt();
			expect(lateWriterFinished).toBe(false);
			releasePurge.resolve();
			await purge;
			expect((await lateWriterOutcome).error).toMatchObject({
				code: "BAD_REQUEST",
			});
			pausePurge = undefined;

			const writerFirstParent =
				await setup.app.collections.postgres_purge_parents.create(
					{ name: "Writer wins" },
					systemContext,
				);
			await setup.app.collections.postgres_purge_parents.deleteById(
				{ id: writerFirstParent.id },
				systemContext,
			);
			const writerInserted = deferred();
			const releaseWriter = deferred();
			pauseRelationWrite = async (data) => {
				if (data.parent !== writerFirstParent.id) return;
				writerInserted.resolve();
				await releaseWriter.promise;
			};
			const writer = setup.app.collections.postgres_purge_children.create(
				{
					name: "Retained child",
					parent: writerFirstParent.id,
				},
				systemContext,
			);
			await writerInserted.promise;
			let waitingPurgeFinished = false;
			const waitingPurge = setup.app.collections.postgres_purge_parents
				.purgeById({ id: writerFirstParent.id }, systemContext)
				.finally(() => {
					waitingPurgeFinished = true;
				});
			const waitingPurgeOutcome = waitingPurge.then(
				() => ({ error: undefined }),
				(error: unknown) => ({ error }),
			);
			await waitForAttempt();
			expect(waitingPurgeFinished).toBe(false);
			releaseWriter.resolve();
			await writer;
			expect((await waitingPurgeOutcome).error).toMatchObject({
				code: "CONFLICT",
				message: "Cannot purge record while retained references exist",
			});
			pauseRelationWrite = undefined;
		});

		it("serializes raw junction writes inferred from many-to-many metadata", async () => {
			const parent =
				await setup.app.collections.postgres_junction_parents.create(
					{ name: "Writer wins" },
					systemContext,
				);
			const tag = await setup.app.collections.postgres_junction_tags.create(
				{ name: "Tag" },
				systemContext,
			);
			await setup.app.collections.postgres_junction_parents.deleteById(
				{ id: parent.id },
				systemContext,
			);
			const writerInserted = deferred();
			const releaseWriter = deferred();
			pauseJunctionWrite = async (data) => {
				if (data.parentId !== parent.id) return;
				writerInserted.resolve();
				await releaseWriter.promise;
			};
			const writer = setup.app.collections.postgres_junction_rows.create(
				{ parentId: parent.id, tagId: tag.id },
				systemContext,
			);
			await writerInserted.promise;

			let waitingPurgeFinished = false;
			const waitingPurge = setup.app.collections.postgres_junction_parents
				.purgeById({ id: parent.id }, systemContext)
				.finally(() => {
					waitingPurgeFinished = true;
				});
			const waitingPurgeOutcome = waitingPurge.then(
				() => ({ error: undefined }),
				(error: unknown) => ({ error }),
			);
			await waitForAttempt();
			expect(waitingPurgeFinished).toBe(false);
			releaseWriter.resolve();
			await writer;
			expect((await waitingPurgeOutcome).error).toMatchObject({
				code: "CONFLICT",
				message: "Cannot purge record while retained references exist",
			});
			pauseJunctionWrite = undefined;
		});

		/**
		 * Holds `hold` open in its own transaction and reports whether
		 * `insertChild` completed within the window or was still waiting.
		 */
		async function insertWhileParentHeld(
			hold: (tx: any) => Promise<unknown>,
			insertChild: () => Promise<unknown>,
		) {
			const held = deferred();
			const release = deferred();
			const holder = withTransaction(setup.app.db, async (tx) => {
				await hold(tx);
				held.resolve();
				await release.promise;
			});
			await held.promise;
			const insert = insertChild();
			const outcome = await Promise.race([
				insert.then(() => "inserted" as const),
				new Promise<"waiting">((resolve) =>
					setTimeout(() => resolve("waiting"), 1_000),
				),
			]);
			release.resolve();
			await holder;
			await insert;
			return outcome;
		}

		const insertChild = (name: string, data: { parent: string }) => () =>
			Promise.all([
				setup.app.collections.postgres_fk_children.create(
					{ name, ...data },
					systemContext,
				),
				rawFkPool!.query(
					"insert into postgres_fk_raw_children (parent_id) values ($1)",
					[data.parent],
				),
			]);

		it("does not block foreign-key child inserts while a parent row is written", async () => {
			const parent = await setup.app.collections.postgres_fk_parents.create(
				{ name: "Counter" },
				systemContext,
			);

			expect(
				await insertWhileParentHeld(
					(tx) =>
						setup.app.collections.postgres_fk_parents.lockMany(
							{ ids: [parent.id] },
							{ ...systemContext, db: tx },
						),
					insertChild("During lockMany", { parent: parent.id }),
				),
			).toBe("inserted");

			expect(
				await insertWhileParentHeld(
					(tx) =>
						setup.app.collections.postgres_fk_parents.updateById(
							{
								id: parent.id,
								expectedRevision: parent.revision,
								data: { name: "Counter 2" },
							},
							{ ...systemContext, db: tx },
						),
					insertChild("During update", { parent: parent.id }),
				),
			).toBe("inserted");
		});

		it("locks FOR UPDATE when an update changes a unique column", async () => {
			const parent = await setup.app.collections.postgres_fk_parents.create(
				{ name: "Keyed", code: "keyed-1" },
				systemContext,
			);
			// Pause after the pre-lock and before the UPDATE statement, which
			// would take FOR UPDATE on its own.
			const updateLocked = deferred();
			const releaseUpdate = deferred();
			pauseParentChange = async (data) => {
				if (data.code !== "keyed-2") return;
				updateLocked.resolve();
				await releaseUpdate.promise;
			};
			const update = setup.app.collections.postgres_fk_parents.updateById(
				{
					id: parent.id,
					expectedRevision: parent.revision,
					data: { code: "keyed-2" },
				},
				systemContext,
			);
			await updateLocked.promise;

			const insert = insertChild("During key update", {
				parent: parent.id,
			})();
			const outcome = await Promise.race([
				insert.then(() => "inserted" as const),
				new Promise<"waiting">((resolve) =>
					setTimeout(() => resolve("waiting"), 1_000),
				),
			]);
			releaseUpdate.resolve();
			await update;
			await insert;
			pauseParentChange = undefined;
			expect(outcome).toBe("waiting");
		});

		it("makes a soft delete wait for an in-flight restricted child and refuse", async () => {
			const parent =
				await setup.app.collections.postgres_fk_soft_parents.create(
					{ name: "Restricted" },
					systemContext,
				);
			const childInserted = deferred();
			const releaseChild = deferred();
			pauseSoftChildWrite = async (data) => {
				if (data.parent !== parent.id) return;
				childInserted.resolve();
				await releaseChild.promise;
			};
			const child = setup.app.collections.postgres_fk_soft_children.create(
				{ name: "In flight", parent: parent.id },
				systemContext,
			);
			await childInserted.promise;

			let deleteSettled = false;
			const deleteOutcome = setup.app.collections.postgres_fk_soft_parents
				.deleteById({ id: parent.id }, systemContext)
				.finally(() => {
					deleteSettled = true;
				})
				.then(
					() => ({ error: undefined }),
					(error: unknown) => ({ error }),
				);
			await waitForAttempt();
			expect(deleteSettled).toBe(false);
			releaseChild.resolve();
			await child;
			pauseSoftChildWrite = undefined;

			expect((await deleteOutcome).error).toBeDefined();
			const stored =
				await setup.app.collections.postgres_fk_soft_parents.findOne(
					{ where: { id: parent.id } },
					systemContext,
				);
			expect(stored?.deletedAt ?? null).toBeNull();
		});

		it("still serializes concurrent revision-checked updates of one row", async () => {
			const parent = await setup.app.collections.postgres_fk_parents.create(
				{ name: "Contended" },
				systemContext,
			);
			const firstWritten = deferred();
			const releaseFirst = deferred();
			const first = withTransaction(setup.app.db, async (tx) => {
				await setup.app.collections.postgres_fk_parents.updateById(
					{
						id: parent.id,
						expectedRevision: parent.revision,
						data: { name: "First" },
					},
					{ ...systemContext, db: tx },
				);
				firstWritten.resolve();
				await releaseFirst.promise;
			});
			await firstWritten.promise;

			let secondSettled = false;
			const second = setup.app.collections.postgres_fk_parents
				.updateById(
					{
						id: parent.id,
						expectedRevision: parent.revision,
						data: { name: "Second" },
					},
					systemContext,
				)
				.finally(() => {
					secondSettled = true;
				});
			const secondOutcome = second.then(
				() => ({ error: undefined }),
				(error: unknown) => ({ error }),
			);
			await waitForAttempt();
			expect(secondSettled).toBe(false);
			releaseFirst.resolve();
			await first;

			expect((await secondOutcome).error).toMatchObject({ code: "CONFLICT" });
			const current = await setup.app.collections.postgres_fk_parents.findOne(
				{ where: { id: parent.id } },
				systemContext,
			);
			expect(current).toMatchObject({
				name: "First",
				revision: parent.revision + 1,
			});
		});

		it("makes a child insert wait for a hard delete of its parent", async () => {
			const parent = await setup.app.collections.postgres_fk_parents.create(
				{ name: "Doomed" },
				systemContext,
			);
			const deleteLocked = deferred();
			const releaseDelete = deferred();
			pauseParentDelete = async (data) => {
				if (data.id !== parent.id) return;
				deleteLocked.resolve();
				await releaseDelete.promise;
			};
			const hardDelete = setup.app.collections.postgres_fk_parents.deleteById(
				{ id: parent.id, expectedRevision: parent.revision },
				systemContext,
			);
			await deleteLocked.promise;

			let childSettled = false;
			const child = setup.app.collections.postgres_fk_children
				.create({ name: "Orphan?", parent: parent.id }, systemContext)
				.finally(() => {
					childSettled = true;
				});
			const childOutcome = child.then(
				() => ({ error: undefined }),
				(error: unknown) => ({ error }),
			);
			let rawChildSettled = false;
			const rawChildOutcome = rawFkPool!
				.query("insert into postgres_fk_raw_children (parent_id) values ($1)", [
					parent.id,
				])
				.finally(() => {
					rawChildSettled = true;
				})
				.then(
					() => ({ error: undefined }),
					(error: unknown) => ({ error }),
				);
			await waitForAttempt();
			expect(childSettled).toBe(false);
			expect(rawChildSettled).toBe(false);
			releaseDelete.resolve();
			await hardDelete;
			pauseParentDelete = undefined;

			expect((await childOutcome).error).toBeDefined();
			expect((await rawChildOutcome).error).toMatchObject({ code: "23503" });
			expect(
				await setup.app.collections.postgres_fk_children.count(
					{ where: { parent: parent.id } },
					systemContext,
				),
			).toBe(0);
		});

		it("lets only one concurrent storage-cleanup drainer claim an intent", async () => {
			await enqueueStorageCleanup(
				setup.app.db,
				"postgres-contract/concurrent-cleanup.txt",
			);

			const claims = await Promise.all([
				claimStorageCleanup(setup.app.db, { batchSize: 1 }),
				claimStorageCleanup(setup.app.db, { batchSize: 1 }),
			]);

			expect(claims.flat()).toHaveLength(1);
			expect(claims.flat()[0]?.leaseToken).toBeString();
		});

		it("serializes delayed cleanup against a writer reusing the same key", async () => {
			const key = "postgres-contract/reused-key.txt";
			await setup.app.storage.upload(key, new TextEncoder().encode("old"));
			const original =
				await setup.app.collections.postgres_upload_assets.create(
					{
						key,
						filename: "old.txt",
						mimeType: "text/plain",
						size: 3,
					},
					systemContext,
				);
			await setup.app.collections.postgres_upload_assets.deleteById(
				{ id: original.id },
				systemContext,
			);
			await setup.app.collections.postgres_upload_assets.purgeById(
				{ id: original.id },
				systemContext,
			);

			const deleteStarted = deferred();
			const releaseDelete = deferred();
			const originalDelete = setup.app.storage.delete.bind(setup.app.storage);
			setup.app.storage.delete = (async (...args: unknown[]) => {
				if (args[0] === key) {
					deleteStarted.resolve();
					await releaseDelete.promise;
				}
				return originalDelete(...(args as [string]));
			}) as typeof setup.app.storage.delete;

			const cleanup = setup.app.queue.runOnce({ jobs: ["storageCleanup"] });
			await deleteStarted.promise;
			let writerSettled = false;
			const writer = setup.app.collections.postgres_upload_assets
				.create(
					{
						key,
						filename: "replacement.txt",
						mimeType: "text/plain",
						size: 11,
					},
					systemContext,
				)
				.finally(() => {
					writerSettled = true;
				});
			const writerOutcome = writer.then(
				(value) => ({ value, error: undefined }),
				(error: unknown) => ({ value: undefined, error }),
			);
			await waitForAttempt();
			expect(writerSettled).toBe(false);
			releaseDelete.resolve();
			await cleanup;
			expect((await writerOutcome).error).toMatchObject({
				code: "BAD_REQUEST",
			});
			expect(await setup.app.storage.exists(key)).toBe(false);
			setup.app.storage.delete = originalDelete;
		});
	},
);
