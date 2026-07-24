import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { getTableConfig } from "drizzle-orm/pg-core";

import { collection } from "../../src/exports/index.js";
import { withTransaction } from "../../src/server/collection/crud/shared/transaction.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createMockSession, createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

let failAfterPurge = false;
const purgeHookCalls: string[] = [];

const deniedDocuments = collection("purge_denied_documents")
	.fields(({ f }) => ({
		tenantId: f.text().required(),
		title: f.text().required().localized(),
	}))
	.options({ softDelete: true, versioning: true })
	.access({
		create: true,
		read: true,
		update: true,
		delete: true,
	});

const documents = collection("purge_documents")
	.fields(({ f }) => ({
		tenantId: f.text().required(),
		title: f.text().required().localized(),
	}))
	.options({ softDelete: true, versioning: true })
	.access({
		create: true,
		read: true,
		update: true,
		delete: true,
		purge: ({ session }) => ({
			tenantId: session?.user.id ?? "__anonymous__",
		}),
	})
	.hooks({
		beforeOperation: ({ operation }) => {
			if (operation === "purge") purgeHookCalls.push("attempt");
		},
		beforePurge: () => {
			purgeHookCalls.push("before");
		},
		afterPurge: () => {
			purgeHookCalls.push("after");
			if (failAfterPurge) throw new Error("fatal purge hook");
		},
	});

const hardDeleteDocuments = collection("purge_hard_documents")
	.fields(({ f }) => ({ title: f.text().required() }))
	.access({ purge: true });

describe("physical purge core contract", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		failAfterPurge = false;
		purgeHookCalls.length = 0;
		setup = await buildMockApp({
			collections: {
				deniedDocuments,
				documents,
				hardDeleteDocuments,
			},
			hooks: {
				collections: [
					{
						beforePurge: () => purgeHookCalls.push("global-before"),
						afterPurge: () => purgeHookCalls.push("global-after"),
					},
				],
				globals: [],
			},
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("never derives purge authority from delete authority", async () => {
		const user = createMockSession({ id: "tenant-a" });
		const ctx = createTestContext({ accessMode: "user", session: user });
		const created = await setup.app.collections.deniedDocuments.create(
			{ tenantId: "tenant-a", title: "Denied" },
			ctx,
		);
		await setup.app.collections.deniedDocuments.deleteById(
			{ id: created.id },
			ctx,
		);

		const purge = setup.app.collections.deniedDocuments.purgeById as (
			params: { id: string },
			context: typeof ctx,
		) => Promise<{ success: true }>;
		await expect(purge({ id: created.id }, ctx)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});

		const retained = await setup.app.db
			.select()
			.from(setup.app.collections.deniedDocuments["~internalRelatedTable"]);
		expect(retained).toHaveLength(1);
		expect(retained[0]?.deletedAt).toBeInstanceOf(Date);
	});

	it("purges only a deleted row allowed by the separate row rule", async () => {
		const user = createMockSession({ id: "tenant-a" });
		const ctx = createTestContext({ accessMode: "user", session: user });
		const created = await setup.app.collections.documents.create(
			{ tenantId: "tenant-a", title: "Owned" },
			ctx,
		);
		await setup.app.collections.documents.deleteById({ id: created.id }, ctx);

		const result = await setup.app.collections.documents.purgeById(
			{ id: created.id },
			ctx,
		);
		expect(result).toEqual({ success: true });
		expect(purgeHookCalls).toEqual([
			"attempt",
			"global-before",
			"before",
			"after",
			"global-after",
		]);

		const rows = await setup.app.db
			.select()
			.from(setup.app.collections.documents["~internalRelatedTable"]);
		expect(rows).toHaveLength(0);
		expect(
			await setup.app.db.select().from(documents.i18nTable as any),
		).toHaveLength(0);
		expect(
			await setup.app.db.select().from(documents.versionsTable as any),
		).toHaveLength(0);
		expect(
			await setup.app.db.select().from(documents.i18nVersionsTable as any),
		).toHaveLength(0);
		expect(
			await setup.app.collections.documents.findVersions(
				{ id: created.id },
				createTestContext(),
			),
		).toEqual([]);
	});

	it("uses one disclosure-safe 404 for denied, missing, and repeated purge", async () => {
		const owner = createMockSession({ id: "tenant-a" });
		const other = createMockSession({ id: "tenant-b" });
		const ownerCtx = createTestContext({ accessMode: "user", session: owner });
		const otherCtx = createTestContext({ accessMode: "user", session: other });
		const created = await setup.app.collections.documents.create(
			{ tenantId: "tenant-a", title: "Private" },
			ownerCtx,
		);
		await setup.app.collections.documents.deleteById(
			{ id: created.id },
			ownerCtx,
		);

		for (const id of [created.id, crypto.randomUUID()]) {
			await expect(
				setup.app.collections.documents.purgeById({ id }, otherCtx),
			).rejects.toMatchObject({
				code: "NOT_FOUND",
				messageKey: "error.notFound.withId",
			});
		}

		await setup.app.collections.documents.purgeById(
			{ id: created.id },
			ownerCtx,
		);
		await expect(
			setup.app.collections.documents.purgeById({ id: created.id }, ownerCtx),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			messageKey: "error.notFound.withId",
		});
	});

	it("rejects an authorized active row without running purge hooks", async () => {
		const user = createMockSession({ id: "tenant-a" });
		const ctx = createTestContext({ accessMode: "user", session: user });
		const created = await setup.app.collections.documents.create(
			{ tenantId: "tenant-a", title: "Active" },
			ctx,
		);

		await expect(
			setup.app.collections.documents.purgeById({ id: created.id }, ctx),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(purgeHookCalls).toEqual(["attempt"]);

		const retained = await setup.app.collections.documents.findOne(
			{ where: { id: created.id } },
			ctx,
		);
		expect(retained?.id).toBe(created.id);
	});

	it("rolls back owner and version cleanup when afterPurge fails", async () => {
		const user = createMockSession({ id: "tenant-a" });
		const ctx = createTestContext({ accessMode: "user", session: user });
		const created = await setup.app.collections.documents.create(
			{ tenantId: "tenant-a", title: "Rollback" },
			ctx,
		);
		await setup.app.collections.documents.deleteById({ id: created.id }, ctx);
		const versionsBefore = await setup.app.collections.documents.findVersions(
			{ id: created.id },
			createTestContext(),
		);
		failAfterPurge = true;

		await expect(
			setup.app.collections.documents.purgeById({ id: created.id }, ctx),
		).rejects.toThrow("fatal purge hook");

		const retained = await setup.app.db
			.select()
			.from(setup.app.collections.documents["~internalRelatedTable"]);
		expect(retained).toHaveLength(1);
		expect(
			await setup.app.collections.documents.findVersions(
				{ id: created.id },
				createTestContext(),
			),
		).toHaveLength(versionsBefore.length);
	});

	it("participates in an outer transaction and rolls back with it", async () => {
		const user = createMockSession({ id: "tenant-a" });
		const ctx = createTestContext({ accessMode: "user", session: user });
		const created = await setup.app.collections.documents.create(
			{ tenantId: "tenant-a", title: "Outer rollback" },
			ctx,
		);
		await setup.app.collections.documents.deleteById({ id: created.id }, ctx);

		await expect(
			withTransaction(setup.app.db, async (tx) => {
				await setup.app.collections.documents.purgeById(
					{ id: created.id },
					{ ...ctx, db: tx },
				);
				throw new Error("rollback outer transaction");
			}),
		).rejects.toThrow("rollback outer transaction");

		const retained = await setup.app.db
			.select()
			.from(setup.app.collections.documents["~internalRelatedTable"]);
		expect(retained).toHaveLength(1);
		expect(retained[0]?.deletedAt).toBeInstanceOf(Date);
	});

	it("fails closed on collections without soft delete", async () => {
		const created = await setup.app.collections.hardDeleteDocuments.create({
			title: "Hard",
		});

		await expect(
			setup.app.collections.hardDeleteDocuments.purgeById({
				id: created.id,
			}),
		).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
	});

	it("builds the bounded retention keyset index for soft-delete collections", () => {
		const index = getTableConfig(documents.table as any).indexes.find(
			(candidate) => candidate.config.name === "purge_documents_deleted_at_idx",
		);
		expect(index?.config.columns.map((column: any) => column.name)).toEqual([
			"deleted_at",
			"id",
		]);
		expect(index?.config.where).toBeDefined();
	});
});
