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
					},
				},
				{
					db: { url: databaseUrl!, pool: { max: 10 } },
					storage: { adapter: memory() },
				},
			);
			await runTestDbMigrations(setup.app);
		});

		afterAll(async () => {
			if (!setup) return;
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
