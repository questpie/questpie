import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import pg from "pg";

import { collection, withTransaction } from "../../src/exports/index.js";
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
	"transaction-scoped locks on PostgreSQL 17",
	() => {
		let setup: Awaited<ReturnType<typeof buildMockApp>>;
		const systemContext = createTestContext();

		beforeAll(async () => {
			const pool = new pg.Pool({ connectionString: databaseUrl });
			try {
				const result = await pool.query<{ server_version: string }>(
					"show server_version",
				);
				expect(result.rows[0]?.server_version.startsWith("17.")).toBe(true);
				await pool.query("create extension if not exists pg_trgm");
			} finally {
				await pool.end();
			}

			setup = await buildMockApp(
				{ collections: { postgresLockTargets } },
				{ db: { url: databaseUrl!, pool: { max: 10 } } },
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
	},
);
