import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { FilesError } from "files-sdk";
import { memory } from "files-sdk/memory";

import { collection, sql, withTransaction } from "../../src/exports/index.js";
import { questpieStorageCleanupTable } from "../../src/server/modules/core/integrated/storage/cleanup-table.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { createTestContext } from "../utils/test-context.js";
import { runTestDbMigrations } from "../utils/test-db.js";

const databaseUrl = process.env.QUESTPIE_STORAGE_RECOVERY_DATABASE_URL;
if (databaseUrl) {
	const target = new URL(databaseUrl);
	if (
		!["localhost", "127.0.0.1"].includes(target.hostname) ||
		!/^\/qp_storage_recovery_[a-z0-9]{12}$/.test(target.pathname)
	) {
		throw new Error(
			"Storage recovery proof requires an owned disposable local database",
		);
	}
}

const hardAssets = collection("hard_cleanup_assets")
	.fields(({ f }) => ({ tenant: f.text().required() }))
	.upload({ visibility: "private" })
	.access({ create: true, read: true, delete: true });
const retainedAssets = collection("retained_cleanup_assets")
	.fields(({ f }) => ({ tenant: f.text().required() }))
	.upload({ visibility: "private" })
	.options({ softDelete: true })
	.access({ create: true, read: true, delete: true, purge: true });
const ctx = createTestContext({ accessMode: "system" });

describe("hard-delete upload storage recovery", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	beforeEach(async () => {
		setup = await buildMockApp(
			{ collections: { hardAssets, retainedAssets } },
			{
				storage: { adapter: memory() },
				secret: "s".repeat(32),
				...(databaseUrl ? { db: { url: databaseUrl } } : {}),
			},
		);
		await runTestDbMigrations(setup.app);
	});
	afterEach(async () => {
		try {
			if (databaseUrl) await setup.app.migrations.down();
		} finally {
			await setup.cleanup();
		}
	});
	async function asset(key: string) {
		await setup.app.storage.upload(
			key,
			new TextEncoder().encode("retained bytes"),
		);
		return setup.app.collections.hardAssets.create(
			{
				tenant: "closing-company",
				key,
				filename: "fixture.txt",
				mimeType: "text/plain",
				size: 14,
				visibility: "private",
			},
			ctx,
		);
	}

	it("recovers a committed hard delete after repeated provider failures", async () => {
		const key = "hard-delete/recovery.txt";
		const row = await asset(key);
		const remove = setup.app.storage.delete.bind(setup.app.storage);
		let unavailable = true;
		setup.app.storage.delete = async (objectKey, options) => {
			if (unavailable)
				throw new FilesError("Provider", "temporary storage outage");
			return remove(objectKey, options);
		};
		await setup.app.collections.hardAssets.deleteById({ id: row.id }, ctx);
		expect(
			await setup.app.collections.hardAssets.findOne(
				{ where: { id: row.id } },
				ctx,
			),
		).toBeNull();
		expect(await setup.app.storage.exists(key)).toBe(true);
		expect(
			await setup.app.db.select().from(questpieStorageCleanupTable),
		).toEqual([expect.objectContaining({ key, attempts: 0 })]);
		await setup.app.queue.runOnce({ jobs: ["storageCleanup"] });
		expect(
			await setup.app.db.select().from(questpieStorageCleanupTable),
		).toEqual([
			expect.objectContaining({
				key,
				attempts: 1,
				lastError: "temporary storage outage",
				leaseToken: null,
			}),
		]);
		unavailable = false;
		await setup.app.db
			.update(questpieStorageCleanupTable)
			.set({ availableAt: new Date(0) });
		await setup.app.queue.runOnce({ jobs: ["storageCleanup"] });
		expect(await setup.app.storage.exists(key)).toBe(false);
		expect(
			await setup.app.db.select().from(questpieStorageCleanupTable),
		).toEqual([]);
		await setup.app.queue.runOnce({ jobs: ["storageCleanup"] });
		expect(await setup.app.storage.exists(key)).toBe(false);
	});

	it("rolls back the row, cleanup intent and provider effect with an outer transaction", async () => {
		const key = "hard-delete/rollback.txt";
		const row = await asset(key);
		await expect(
			withTransaction(setup.app.db, async (db) => {
				await setup.app.collections.hardAssets.deleteById(
					{ id: row.id },
					{ ...ctx, db },
				);
				expect(await db.select().from(questpieStorageCleanupTable)).toEqual([
					expect.objectContaining({ key }),
				]);
				expect(await setup.app.storage.exists(key)).toBe(true);
				throw new Error("outer rollback");
			}),
		).rejects.toThrow("outer rollback");
		expect(
			await setup.app.collections.hardAssets.findOne(
				{ where: { id: row.id } },
				ctx,
			),
		).not.toBeNull();
		expect(
			await setup.app.db.select().from(questpieStorageCleanupTable),
		).toEqual([]);
		await setup.app.queue.runOnce({ jobs: ["storageCleanup"] });
		expect(await setup.app.storage.exists(key)).toBe(true);
	});

	it("retains another tenant's shared key through both immediate and durable cleanup", async () => {
		const key = "hard-delete/shared.txt";
		const row = await asset(key);
		const other = await setup.app.collections.retainedAssets.create(
			{
				tenant: "surviving-company",
				key,
				filename: "shared.txt",
				mimeType: "text/plain",
				size: 14,
				visibility: "private",
			},
			ctx,
		);
		await setup.app.collections.retainedAssets.deleteById(
			{ id: other.id },
			ctx,
		);
		await setup.app.collections.hardAssets.deleteById({ id: row.id }, ctx);
		expect(await setup.app.storage.exists(key)).toBe(true);
		expect(
			await setup.app.db.select().from(questpieStorageCleanupTable),
		).toEqual([expect.objectContaining({ key })]);
		await setup.app.queue.runOnce({ jobs: ["storageCleanup"] });
		expect(await setup.app.storage.exists(key)).toBe(true);
		expect(
			await setup.app.collections.retainedAssets.findOne(
				{ where: { id: other.id }, includeDeleted: true },
				ctx,
			),
		).not.toBeNull();
		expect(
			await setup.app.db.select().from(questpieStorageCleanupTable),
		).toEqual([]);
		await setup.app.collections.retainedAssets.purgeById({ id: other.id }, ctx);
		await setup.app.queue.runOnce({ jobs: ["storageCleanup"] });
		expect(await setup.app.storage.exists(key)).toBe(false);
	});

	it("refuses the row delete when its durable cleanup cannot be committed", async () => {
		const key = "hard-delete/outbox-rejected.txt";
		const row = await asset(key);
		await setup.app.db.execute(sql`
   CREATE FUNCTION reject_cleanup_for_proof() RETURNS trigger AS $$
   BEGIN RAISE EXCEPTION 'cleanup persistence rejected'; END;
   $$ LANGUAGE plpgsql;
  `);
		await setup.app.db.execute(sql`
   CREATE TRIGGER reject_cleanup_for_proof BEFORE INSERT ON questpie_storage_cleanup
   FOR EACH ROW EXECUTE FUNCTION reject_cleanup_for_proof();
  `);
		await expect(
			setup.app.collections.hardAssets.deleteById({ id: row.id }, ctx),
		).rejects.toMatchObject({
			cause: { message: "cleanup persistence rejected" },
		});
		expect(
			await setup.app.collections.hardAssets.findOne(
				{ where: { id: row.id } },
				ctx,
			),
		).not.toBeNull();
		expect(await setup.app.storage.exists(key)).toBe(true);
		expect(
			await setup.app.db.select().from(questpieStorageCleanupTable),
		).toEqual([]);
	});
});
