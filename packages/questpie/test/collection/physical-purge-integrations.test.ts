import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { eq } from "drizzle-orm";
import { FilesError } from "files-sdk";
import { memory } from "files-sdk/memory";

import {
	collection,
	questpieRealtimeLogTable,
	withTransaction,
} from "../../src/exports/index.js";
import {
	claimStorageCleanup,
	enqueueStorageCleanup,
} from "../../src/server/modules/core/integrated/storage/cleanup-store.js";
import {
	questpieStorageCleanupTable,
	questpieStorageObjectKeyTable,
} from "../../src/server/modules/core/integrated/storage/cleanup-table.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { createTestContext } from "../utils/test-context.js";
import { runTestDbMigrations } from "../utils/test-db.js";

const uploadAssets = collection("purge_upload_assets")
	.options({ softDelete: true })
	.fields(({ f }) => ({ alt: f.text() }))
	.upload({ visibility: "private" })
	.access({
		create: true,
		read: true,
		update: true,
		delete: true,
		purge: true,
	});
const uploadMirrors = collection("purge_upload_mirrors")
	.options({ softDelete: true })
	.fields(({ f }) => ({ alt: f.text() }))
	.upload({ visibility: "private" })
	.access({
		create: true,
		read: true,
		update: true,
		delete: true,
		purge: true,
	});

const projectedRecords = collection("purge_projected_records")
	.options({ softDelete: true })
	.fields(({ f }) => ({ title: f.text().required() }))
	.access({
		create: true,
		read: true,
		update: true,
		delete: true,
		purge: true,
	});

describe("physical purge module integrations", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let ctx: ReturnType<typeof createTestContext>;

	beforeEach(async () => {
		setup = await buildMockApp(
			{
				collections: {
					uploadAssets,
					uploadMirrors,
					projectedRecords,
				},
			},
			{
				realtime: { pollIntervalMs: 10 },
				storage: { adapter: memory() },
				secret: "s".repeat(32),
			},
		);
		await runTestDbMigrations(setup.app);
		ctx = createTestContext({ accessMode: "system" });
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("retains upload bytes through restore and durably queues committed purge cleanup", async () => {
		const key = "retention/restorable.txt";
		await setup.app.storage.upload(key, new TextEncoder().encode("restorable"));
		const asset = await setup.app.collections.uploadAssets.create(
			{
				key,
				filename: "restorable.txt",
				mimeType: "text/plain",
				size: 10,
				visibility: "private",
			},
			ctx,
		);

		await setup.app.collections.uploadAssets.deleteById({ id: asset.id }, ctx);
		expect(await setup.app.storage.exists(key)).toBe(true);

		await setup.app.collections.uploadAssets.restoreById({ id: asset.id }, ctx);
		expect(await setup.app.storage.exists(key)).toBe(true);

		await setup.app.collections.uploadAssets.deleteById({ id: asset.id }, ctx);
		await setup.app.collections.uploadAssets.purgeById({ id: asset.id }, ctx);
		expect(await setup.app.storage.exists(key)).toBe(true);
		expect(
			await setup.app.db.select().from(questpieStorageCleanupTable),
		).toEqual([expect.objectContaining({ key })]);
		expect(setup.app.mocks.queue.getJobsByName("storage-cleanup")).toHaveLength(
			1,
		);

		await setup.app.queue.runOnce({ jobs: ["storageCleanup"] });
		expect(await setup.app.storage.exists(key)).toBe(false);
		expect(
			await setup.app.db.select().from(questpieStorageCleanupTable),
		).toEqual([]);
		expect(
			await setup.app.db
				.select()
				.from(questpieStorageObjectKeyTable)
				.where(eq(questpieStorageObjectKeyTable.key, key)),
		).toEqual([]);
	});

	it("does not run upload cleanup when an outer purge transaction rolls back", async () => {
		const key = "retention/rolled-back.txt";
		await setup.app.storage.upload(key, new TextEncoder().encode("retained"));
		const asset = await setup.app.collections.uploadAssets.create(
			{
				key,
				filename: "rolled-back.txt",
				mimeType: "text/plain",
				size: 8,
				visibility: "private",
			},
			ctx,
		);
		await setup.app.collections.uploadAssets.deleteById({ id: asset.id }, ctx);

		await expect(
			withTransaction(setup.app.db, async (tx) => {
				await setup.app.collections.uploadAssets.purgeById(
					{ id: asset.id },
					{ ...ctx, db: tx },
				);
				throw new Error("rollback purge");
			}),
		).rejects.toThrow("rollback purge");

		expect(await setup.app.storage.exists(key)).toBe(true);
		expect(
			await setup.app.db.select().from(questpieStorageCleanupTable),
		).toEqual([]);
		expect(setup.app.mocks.queue.getJobsByName("storage-cleanup")).toHaveLength(
			0,
		);
		const retained = await setup.app.db
			.select()
			.from(setup.app.collections.uploadAssets["~internalRelatedTable"])
			.where(
				eq(
					setup.app.collections.uploadAssets["~internalRelatedTable"].id,
					asset.id,
				),
			);
		expect(retained).toHaveLength(1);
	});

	it("coalesces fast-path queue wakes across a purge batch", async () => {
		for (const key of ["retention/batch-a.txt", "retention/batch-b.txt"]) {
			await setup.app.storage.upload(key, new TextEncoder().encode(key));
			const asset = await setup.app.collections.uploadAssets.create(
				{
					key,
					filename: key.split("/").at(-1)!,
					mimeType: "text/plain",
					size: key.length,
					visibility: "private",
				},
				ctx,
			);
			await setup.app.collections.uploadAssets.deleteById(
				{ id: asset.id },
				ctx,
			);
			await setup.app.collections.uploadAssets.purgeById({ id: asset.id }, ctx);
		}

		expect(
			await setup.app.db.select().from(questpieStorageCleanupTable),
		).toHaveLength(2);
		expect(setup.app.mocks.queue.getJobsByName("storage-cleanup")).toHaveLength(
			1,
		);
	});

	it("never deletes a storage key retained by another upload row", async () => {
		const key = "retention/shared.txt";
		await setup.app.storage.upload(key, new TextEncoder().encode("shared"));
		const first = await setup.app.collections.uploadAssets.create(
			{
				key,
				filename: "first.txt",
				mimeType: "text/plain",
				size: 6,
				visibility: "private",
			},
			ctx,
		);
		const second = await setup.app.collections.uploadMirrors.create(
			{
				key,
				filename: "second.txt",
				mimeType: "text/plain",
				size: 6,
				visibility: "private",
			},
			ctx,
		);

		await setup.app.collections.uploadAssets.deleteById({ id: first.id }, ctx);
		await setup.app.collections.uploadAssets.purgeById({ id: first.id }, ctx);
		await setup.app.queue.runOnce({ jobs: ["storageCleanup"] });

		expect(await setup.app.storage.exists(key)).toBe(true);
		expect(
			await setup.app.collections.uploadMirrors.findOne({
				where: { id: second.id },
			}),
		).not.toBeNull();
		expect(
			await setup.app.db.select().from(questpieStorageCleanupTable),
		).toEqual([]);

		await setup.app.collections.uploadMirrors.deleteById(
			{ id: second.id },
			ctx,
		);
		await setup.app.collections.uploadMirrors.purgeById({ id: second.id }, ctx);
		await setup.app.queue.runOnce({ jobs: ["storageCleanup"] });
		expect(await setup.app.storage.exists(key)).toBe(false);
	});

	it("retains transient storage failures for durable retry", async () => {
		const key = "retention/retry.txt";
		await setup.app.storage.upload(key, new TextEncoder().encode("retry"));
		const asset = await setup.app.collections.uploadAssets.create(
			{
				key,
				filename: "retry.txt",
				mimeType: "text/plain",
				size: 5,
				visibility: "private",
			},
			ctx,
		);
		await setup.app.collections.uploadAssets.deleteById({ id: asset.id }, ctx);
		await setup.app.collections.uploadAssets.purgeById({ id: asset.id }, ctx);

		const originalDelete = setup.app.storage.delete.bind(setup.app.storage);
		let failOnce = true;
		setup.app.storage.delete = (async (...args: unknown[]) => {
			if (failOnce) {
				failOnce = false;
				throw new FilesError("Provider", "transient provider failure");
			}
			return originalDelete(...(args as [string]));
		}) as typeof setup.app.storage.delete;

		await setup.app.queue.runOnce({ jobs: ["storageCleanup"] });
		const [pending] = await setup.app.db
			.select()
			.from(questpieStorageCleanupTable);
		expect(pending).toMatchObject({
			attempts: 1,
			key,
			lastError: "transient provider failure",
		});
		expect(await setup.app.storage.exists(key)).toBe(true);

		await setup.app.db
			.update(questpieStorageCleanupTable)
			.set({ availableAt: new Date(0) });
		await setup.app.queue.runOnce({ jobs: ["storageCleanup"] });

		expect(await setup.app.storage.exists(key)).toBe(false);
		expect(
			await setup.app.db.select().from(questpieStorageCleanupTable),
		).toEqual([]);
	});

	it("acknowledges replay when the provider object was already removed", async () => {
		const key = "retention/already-removed.txt";
		await setup.app.storage.upload(key, new TextEncoder().encode("gone"));
		const asset = await setup.app.collections.uploadAssets.create(
			{
				key,
				filename: "already-removed.txt",
				mimeType: "text/plain",
				size: 4,
				visibility: "private",
			},
			ctx,
		);
		await setup.app.collections.uploadAssets.deleteById({ id: asset.id }, ctx);
		await setup.app.collections.uploadAssets.purgeById({ id: asset.id }, ctx);

		await setup.app.storage.delete(key);
		setup.app.storage.delete = (async () => {
			throw new FilesError("NotFound", "Object was already removed");
		}) as typeof setup.app.storage.delete;
		await setup.app.queue.runOnce({ jobs: ["storageCleanup"] });

		expect(
			await setup.app.db.select().from(questpieStorageCleanupTable),
		).toEqual([]);
		expect(
			await setup.app.db
				.select()
				.from(questpieStorageObjectKeyTable)
				.where(eq(questpieStorageObjectKeyTable.key, key)),
		).toEqual([]);
	});

	it("leases durable cleanup work so a second drainer cannot claim it", async () => {
		await enqueueStorageCleanup(setup.app.db, "retention/leased.txt");

		const first = await claimStorageCleanup(setup.app.db);
		const second = await claimStorageCleanup(setup.app.db);

		expect(first).toHaveLength(1);
		expect(first[0]?.leaseToken).toBeString();
		expect(second).toEqual([]);
	});

	it("emits idempotent realtime and Search eviction for committed purge", async () => {
		const removeCalls: Array<{ collection: string; recordId: string }> = [];
		const originalRemove = setup.app.search.remove.bind(setup.app.search);
		setup.app.search.remove = async (params: {
			collection: string;
			recordId: string;
		}) => {
			removeCalls.push(params);
			return originalRemove(params);
		};

		const record = await setup.app.collections.projectedRecords.create(
			{ title: "Expired" },
			ctx,
		);
		await setup.app.collections.projectedRecords.deleteById(
			{ id: record.id },
			ctx,
		);
		await setup.app.collections.projectedRecords.purgeById(
			{ id: record.id },
			ctx,
		);

		const deleteEvents = (
			await setup.app.db
				.select()
				.from(questpieRealtimeLogTable)
				.where(eq(questpieRealtimeLogTable.resource, "projectedRecords"))
		).filter((event) => event.operation === "delete");
		expect(deleteEvents).toHaveLength(2);
		expect(deleteEvents.map((event) => event.recordId)).toEqual([
			record.id,
			record.id,
		]);
		expect(deleteEvents.at(-1)?.payload).toEqual({
			before: null,
			after: null,
		});
		expect(
			removeCalls.filter(
				(call) =>
					call.collection === "projectedRecords" && call.recordId === record.id,
			),
		).toHaveLength(2);
	});
});
