import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { eq } from "drizzle-orm";
import { memory } from "files-sdk/memory";

import {
	collection,
	questpieRealtimeLogTable,
	withTransaction,
} from "../../src/exports/index.js";
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

	it("retains upload bytes through soft delete and restore, then removes them after purge", async () => {
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
		expect(await setup.app.storage.exists(key)).toBe(false);
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
