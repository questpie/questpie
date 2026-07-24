import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { eq } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

import { collection } from "../../src/exports/index.js";
import { withTransaction } from "../../src/server/collection/crud/shared/transaction.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createMockSession, createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

let failAfterPurge = false;
let failAfterPurgeWithForeignKeyCode = false;
let reactivateBeforePurge = false;
let recreateAfterPurge = false;
let recreateVersionAfterPurge = false;
let lifecycleTable: any;
let lifecycleVersionsTable: any;
const purgeHookCalls: string[] = [];
const purgeHookTitles: unknown[] = [];

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
		beforePurge: ({ data }) => {
			purgeHookCalls.push("before");
			purgeHookTitles.push(data.title);
		},
		afterPurge: () => {
			purgeHookCalls.push("after");
			if (failAfterPurge) throw new Error("fatal purge hook");
			if (failAfterPurgeWithForeignKeyCode) {
				throw Object.assign(new Error("hook-owned foreign key failure"), {
					code: "23503",
					constraint: "audit_owner_id_fkey",
				});
			}
		},
	});

const localizedAccessDocuments = collection("purge_localized_access_documents")
	.fields(({ f }) => ({
		title: f.text().required().localized(),
	}))
	.options({ softDelete: true })
	.access({
		create: true,
		read: true,
		update: true,
		delete: true,
		purge: () => ({ title: "Allowed localized title" }),
	});

const unknownAccessDocuments = collection("purge_unknown_access_documents")
	.fields(({ f }) => ({ title: f.text().required() }))
	.options({ softDelete: true })
	.access({
		create: true,
		read: true,
		update: true,
		delete: true,
		purge: () => ({ misspelledTenantField: "tenant-a" }) as any,
	});

const hardDeleteDocuments = collection("purge_hard_documents")
	.fields(({ f }) => ({ title: f.text().required() }))
	.access({ purge: true });

const lifecycleDocuments = collection("purge_lifecycle_documents")
	.fields(({ f }) => ({ title: f.text().required() }))
	.options({ softDelete: true, versioning: true })
	.access({ purge: true })
	.hooks({
		beforePurge: async ({ data, db }) => {
			if (!reactivateBeforePurge) return;
			await db
				.update(lifecycleTable)
				.set({ deletedAt: null })
				.where(eq(lifecycleTable.id, data.id));
		},
		afterPurge: async ({ data, db }) => {
			if (recreateAfterPurge) {
				await db.insert(lifecycleTable).values({
					id: data.id,
					title: data.title,
					deletedAt: data.deletedAt,
				});
			}
			if (recreateVersionAfterPurge) {
				await db.insert(lifecycleVersionsTable).values({
					id: data.id,
					title: data.title,
					versionNumber: 999,
					versionOperation: "update",
				});
			}
		},
	});

describe("physical purge core contract", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		failAfterPurge = false;
		failAfterPurgeWithForeignKeyCode = false;
		reactivateBeforePurge = false;
		recreateAfterPurge = false;
		recreateVersionAfterPurge = false;
		purgeHookCalls.length = 0;
		purgeHookTitles.length = 0;
		setup = await buildMockApp({
			collections: {
				deniedDocuments,
				documents,
				hardDeleteDocuments,
				lifecycleDocuments,
				localizedAccessDocuments,
				unknownAccessDocuments,
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
		lifecycleTable =
			setup.app.collections.lifecycleDocuments["~internalRelatedTable"];
		lifecycleVersionsTable =
			setup.app.getCollectionConfig("lifecycleDocuments").versionsTable;
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
		expect(purgeHookTitles).toEqual(["Owned"]);

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

	it("evaluates purge access against the full localized preimage", async () => {
		const ctx = createTestContext({ accessMode: "user", locale: "en" });
		const created = await setup.app.collections.localizedAccessDocuments.create(
			{ title: "Allowed localized title" },
			ctx,
		);
		await setup.app.collections.localizedAccessDocuments.deleteById(
			{ id: created.id },
			ctx,
		);

		await expect(
			setup.app.collections.localizedAccessDocuments.purgeById(
				{ id: created.id },
				ctx,
			),
		).resolves.toEqual({ success: true });
	});

	it("fails closed when a purge access filter names an unknown field", async () => {
		const ctx = createTestContext({ accessMode: "user" });
		const created = await setup.app.collections.unknownAccessDocuments.create(
			{ title: "Retain me" },
			ctx,
		);
		await setup.app.collections.unknownAccessDocuments.deleteById(
			{ id: created.id },
			ctx,
		);

		await expect(
			setup.app.collections.unknownAccessDocuments.purgeById(
				{ id: created.id },
				ctx,
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(
			await setup.app.db
				.select()
				.from(
					setup.app.collections.unknownAccessDocuments["~internalRelatedTable"],
				),
		).toHaveLength(1);
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

	it("rolls back when beforePurge reactivates the tombstone", async () => {
		const ctx = createTestContext();
		const created = await setup.app.collections.lifecycleDocuments.create(
			{ title: "Reactivate" },
			ctx,
		);
		await setup.app.collections.lifecycleDocuments.deleteById(
			{ id: created.id },
			ctx,
		);
		reactivateBeforePurge = true;

		await expect(
			setup.app.collections.lifecycleDocuments.purgeById(
				{ id: created.id },
				ctx,
			),
		).rejects.toMatchObject({ code: "CONFLICT" });

		const [retained] = await setup.app.db
			.select()
			.from(lifecycleTable)
			.where(eq(lifecycleTable.id, created.id));
		expect(retained?.deletedAt).toBeInstanceOf(Date);
	});

	it("rolls back when afterPurge recreates the owner id", async () => {
		const ctx = createTestContext();
		const created = await setup.app.collections.lifecycleDocuments.create(
			{ title: "Recreate" },
			ctx,
		);
		await setup.app.collections.lifecycleDocuments.deleteById(
			{ id: created.id },
			ctx,
		);
		recreateAfterPurge = true;

		await expect(
			setup.app.collections.lifecycleDocuments.purgeById(
				{ id: created.id },
				ctx,
			),
		).rejects.toMatchObject({ code: "CONFLICT" });

		const retained = await setup.app.db
			.select()
			.from(lifecycleTable)
			.where(eq(lifecycleTable.id, created.id));
		expect(retained).toHaveLength(1);
		expect(retained[0]?.deletedAt).toBeInstanceOf(Date);
	});

	it("rolls back when afterPurge recreates a version satellite", async () => {
		const ctx = createTestContext();
		const created = await setup.app.collections.lifecycleDocuments.create(
			{ title: "Recreate version" },
			ctx,
		);
		await setup.app.collections.lifecycleDocuments.deleteById(
			{ id: created.id },
			ctx,
		);
		recreateVersionAfterPurge = true;

		await expect(
			setup.app.collections.lifecycleDocuments.purgeById(
				{ id: created.id },
				ctx,
			),
		).rejects.toMatchObject({ code: "CONFLICT" });

		expect(
			await setup.app.db
				.select()
				.from(lifecycleTable)
				.where(eq(lifecycleTable.id, created.id)),
		).toHaveLength(1);
	});

	it("does not relabel a foreign-key-shaped hook failure as a retained reference", async () => {
		const user = createMockSession({ id: "tenant-a" });
		const ctx = createTestContext({ accessMode: "user", session: user });
		const created = await setup.app.collections.documents.create(
			{ tenantId: "tenant-a", title: "Hook failure" },
			ctx,
		);
		await setup.app.collections.documents.deleteById({ id: created.id }, ctx);
		failAfterPurgeWithForeignKeyCode = true;

		await expect(
			setup.app.collections.documents.purgeById({ id: created.id }, ctx),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: expect.not.stringContaining("retained references"),
		});

		expect(
			await setup.app.db
				.select()
				.from(setup.app.collections.documents["~internalRelatedTable"]),
		).toHaveLength(1);
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

		const runtimePurge = (
			setup.app.collections.hardDeleteDocuments as unknown as {
				purgeById(params: { id: string }): Promise<{ success: true }>;
			}
		).purgeById;
		await expect(runtimePurge({ id: created.id })).rejects.toMatchObject({
			code: "NOT_IMPLEMENTED",
		});
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
