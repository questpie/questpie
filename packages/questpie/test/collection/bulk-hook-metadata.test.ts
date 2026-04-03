/**
 * QUE-238: Bulk hook metadata tests
 *
 * Verifies that isBatch, recordIds, records, count are correctly
 * passed to hooks during bulk update and delete operations.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collection } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

// ============================================================================
// Setup
// ============================================================================

interface CapturedBulkMeta {
	hookName: string;
	data: any;
	isBatch?: boolean;
	recordIds?: (string | number)[];
	records?: any[];
	count?: number;
}

const createBulkMetaModule = (captured: CapturedBulkMeta[]) => ({
	collections: {
		articles: collection("articles")
			.fields(({ f }) => ({
				title: f.textarea().required(),
				category: f.text(100),
			}))
			.hooks({
				beforeChange: async (ctx) => {
					captured.push({
						hookName: "beforeChange",
						data: ctx.data,
						isBatch: ctx.isBatch,
						recordIds: ctx.recordIds ? [...ctx.recordIds] : undefined,
						records: ctx.records ? [...ctx.records] : undefined,
						count: ctx.count,
					});
				},
				afterChange: async (ctx) => {
					captured.push({
						hookName: "afterChange",
						data: ctx.data,
						isBatch: ctx.isBatch,
						recordIds: ctx.recordIds ? [...ctx.recordIds] : undefined,
						records: ctx.records ? [...ctx.records] : undefined,
						count: ctx.count,
					});
				},
				beforeDelete: async (ctx) => {
					captured.push({
						hookName: "beforeDelete",
						data: ctx.data,
						isBatch: ctx.isBatch,
						recordIds: ctx.recordIds ? [...ctx.recordIds] : undefined,
						records: ctx.records ? [...ctx.records] : undefined,
						count: ctx.count,
					});
				},
				afterDelete: async (ctx) => {
					captured.push({
						hookName: "afterDelete",
						data: ctx.data,
						isBatch: ctx.isBatch,
						recordIds: ctx.recordIds ? [...ctx.recordIds] : undefined,
						records: ctx.records ? [...ctx.records] : undefined,
						count: ctx.count,
					});
				},
			}),
	},
});

describe("Bulk Hook Metadata (QUE-238)", () => {
	let captured: CapturedBulkMeta[];
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let ctx: ReturnType<typeof createTestContext>;

	beforeEach(async () => {
		captured = [];
		setup = await buildMockApp(createBulkMetaModule(captured));
		await runTestDbMigrations(setup.app);
		ctx = createTestContext(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	// ========================================================================
	// Single-record operations: isBatch should be undefined (not breaking)
	// ========================================================================

	it("single create: isBatch is undefined", async () => {
		await setup.app.collections.articles.create(
			{ title: "Single" },
			ctx,
		);

		const beforeChange = captured.find((c) => c.hookName === "beforeChange");
		expect(beforeChange).toBeDefined();
		expect(beforeChange!.isBatch).toBeUndefined();
		expect(beforeChange!.recordIds).toBeUndefined();
		expect(beforeChange!.records).toBeUndefined();
		expect(beforeChange!.count).toBeUndefined();
	});

	it("single update by id: isBatch is undefined", async () => {
		const created = await setup.app.collections.articles.create(
			{ title: "Original" },
			ctx,
		);
		captured.length = 0;

		// updateById — single record, not batch
		await setup.app.collections.articles.updateById(
			{ id: created.id, data: { title: "Updated" } },
			ctx,
		);

		const beforeChange = captured.find((c) => c.hookName === "beforeChange");
		expect(beforeChange).toBeDefined();
		expect(beforeChange!.isBatch).toBeUndefined();
	});

	it("single delete by id: isBatch is undefined", async () => {
		const created = await setup.app.collections.articles.create(
			{ title: "ToDelete" },
			ctx,
		);
		captured.length = 0;

		// deleteById — single record, not batch
		await setup.app.collections.articles.deleteById(
			{ id: created.id },
			ctx,
		);

		const beforeDelete = captured.find((c) => c.hookName === "beforeDelete");
		expect(beforeDelete).toBeDefined();
		expect(beforeDelete!.isBatch).toBeUndefined();
	});

	// ========================================================================
	// Bulk update: hooks get isBatch + metadata
	// ========================================================================

	it("bulk update: beforeChange has isBatch=true, recordIds, records, count", async () => {
		const a = await setup.app.collections.articles.create(
			{ title: "A", category: "tech" },
			ctx,
		);
		const b = await setup.app.collections.articles.create(
			{ title: "B", category: "tech" },
			ctx,
		);
		captured.length = 0;

		// Bulk update via where clause with explicit IDs
		await setup.app.collections.articles.update(
			{
				where: { id: { in: [a.id, b.id] } },
				data: { title: "Updated" },
			},
			ctx,
		);

		const beforeChanges = captured.filter(
			(c) => c.hookName === "beforeChange",
		);
		expect(beforeChanges.length).toBe(2);

		for (const hook of beforeChanges) {
			expect(hook.isBatch).toBe(true);
			expect(hook.count).toBe(2);
			expect(hook.recordIds).toBeArrayOfSize(2);
			expect(hook.recordIds).toContain(a.id);
			expect(hook.recordIds).toContain(b.id);
			expect(hook.records).toBeArrayOfSize(2);
		}
	});

	it("bulk update: afterChange has post-image records", async () => {
		const a = await setup.app.collections.articles.create(
			{ title: "A", category: "tech" },
			ctx,
		);
		const b = await setup.app.collections.articles.create(
			{ title: "B", category: "tech" },
			ctx,
		);
		captured.length = 0;

		await setup.app.collections.articles.update(
			{
				where: { id: { in: [a.id, b.id] } },
				data: { title: "Updated" },
			},
			ctx,
		);

		const afterChanges = captured.filter(
			(c) => c.hookName === "afterChange",
		);
		expect(afterChanges.length).toBe(2);

		for (const hook of afterChanges) {
			expect(hook.isBatch).toBe(true);
			expect(hook.count).toBe(2);
			expect(hook.records).toBeArrayOfSize(2);
			// afterChange records are post-image (refetched)
			for (const rec of hook.records!) {
				expect(rec.title).toBe("Updated");
			}
		}
	});

	// ========================================================================
	// Bulk delete: hooks get isBatch + pre-image records
	// ========================================================================

	it("bulk delete: beforeDelete has isBatch=true, recordIds, pre-image records", async () => {
		const a = await setup.app.collections.articles.create(
			{ title: "Del-A", category: "old" },
			ctx,
		);
		const b = await setup.app.collections.articles.create(
			{ title: "Del-B", category: "old" },
			ctx,
		);
		captured.length = 0;

		await setup.app.collections.articles.delete(
			{ where: { id: { in: [a.id, b.id] } } },
			ctx,
		);

		const beforeDeletes = captured.filter(
			(c) => c.hookName === "beforeDelete",
		);
		expect(beforeDeletes.length).toBe(2);

		for (const hook of beforeDeletes) {
			expect(hook.isBatch).toBe(true);
			expect(hook.count).toBe(2);
			expect(hook.recordIds).toBeArrayOfSize(2);
			expect(hook.recordIds).toContain(a.id);
			expect(hook.recordIds).toContain(b.id);
			// records are pre-image (before deletion)
			expect(hook.records).toBeArrayOfSize(2);
		}
	});

	it("bulk delete: afterDelete has same bulk metadata", async () => {
		const a = await setup.app.collections.articles.create(
			{ title: "X", category: "gone" },
			ctx,
		);
		const b = await setup.app.collections.articles.create(
			{ title: "Y", category: "gone" },
			ctx,
		);
		captured.length = 0;

		await setup.app.collections.articles.delete(
			{ where: { id: { in: [a.id, b.id] } } },
			ctx,
		);

		const afterDeletes = captured.filter(
			(c) => c.hookName === "afterDelete",
		);
		expect(afterDeletes.length).toBe(2);

		for (const hook of afterDeletes) {
			expect(hook.isBatch).toBe(true);
			expect(hook.count).toBe(2);
			expect(hook.records).toBeArrayOfSize(2);
		}
	});
});
