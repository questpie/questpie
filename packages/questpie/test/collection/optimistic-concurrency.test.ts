import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { sql } from "drizzle-orm";

import { collection } from "../../src/exports/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import { ApiError } from "../../src/server/errors/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createMockSession, createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

let observedOriginalRevision: number | undefined;
let onBeforeChange: (() => Promise<void>) | undefined;
let onBeforeDelete: (() => Promise<void>) | undefined;
let beforeTransitionFacts = 0;
let observedDeleteRevision: number | undefined;
let beforeOperationDeleteRuns = 0;
let beforeDeleteRuns = 0;
let guardedHookMode: "update" | "delete" | undefined;
let guardedHookTenantId: string | undefined;

const optimisticTags = collection("optimistic_tags")
	.fields(({ f }) => ({
		name: f.text().required(),
		localizedName: f.text().localized(),
		groups: f.relation("optimisticGroups").manyToMany({
			through: "optimisticTagGroups",
			sourceField: "tag",
			targetField: "group",
		}),
		tagGroups: f.relation("optimisticTagGroups").hasMany({
			foreignKey: "tag",
			onDelete: "cascade",
			relationName: "tag",
		}),
	}))
	.options({
		softDelete: true,
		timestamps: false,
		versioning: {
			maxVersions: 10,
			workflow: {
				stages: ["draft", "published"],
				initialStage: "draft",
			},
		},
		optimisticConcurrency: true,
	})
	.access({ introspect: true })
	.hooks({
		beforeOperation: ({ operation }) => {
			if (operation === "delete") beforeOperationDeleteRuns++;
		},
		beforeChange: async ({ original, operation }) => {
			if (operation === "update") {
				observedOriginalRevision = original?.revision;
				await onBeforeChange?.();
			}
		},
		beforeDelete: async () => {
			beforeDeleteRuns++;
			await onBeforeDelete?.();
		},
		afterDelete: ({ data }) => {
			observedDeleteRevision = data.revision;
		},
		beforeTransition: () => {
			beforeTransitionFacts++;
		},
	});
const optimisticGroups = collection("optimistic_groups").fields(({ f }) => ({
	name: f.text().required(),
}));
const optimisticTagGroups = collection("optimistic_tag_groups")
	.fields(({ f }) => ({
		tag: f.relation("optimisticTags").required().onDelete("cascade"),
		group: f.relation("optimisticGroups").required().onDelete("cascade"),
	}))
	.options({ optimisticConcurrency: true });
const legacyTags = collection("legacy_tags")
	.fields(({ f }) => ({
		name: f.text().required(),
		revision: f.number().required().default(1),
	}))
	.options({ softDelete: true });
const tenantDocuments = collection("tenant_documents")
	.fields(({ f }) => ({
		tenantId: f.text().required(),
		title: f.text().required(),
	}))
	.options({ versioning: true })
	.access({
		read: ({ session }) => ({ tenantId: session?.user.id ?? "__anonymous__" }),
	});
const retainedTags = collection("retained_tags")
	.fields(({ f }) => ({ name: f.text().required() }))
	.options({
		timestamps: false,
		versioning: { maxVersions: 2 },
		optimisticConcurrency: true,
	});
const guardedDocuments = collection("guarded_documents")
	.fields(({ f }) => ({
		tenantId: f.text().required(),
		title: f.text().required(),
	}))
	.options({ optimisticConcurrency: true })
	.access({
		update: ({ session }) => ({
			tenantId: session?.user.id ?? "__anonymous__",
		}),
		delete: ({ session }) => ({
			tenantId: session?.user.id ?? "__anonymous__",
		}),
	})
	.hooks({
		beforeChange: async ({ db, operation, original }) => {
			if (operation !== "update" || guardedHookMode !== "update") return;
			await db.execute(sql`
				UPDATE guarded_documents
				SET "tenantId" = ${guardedHookTenantId}
				WHERE id = ${original.id}
			`);
		},
		beforeDelete: async ({ db, original }) => {
			if (guardedHookMode !== "delete") return;
			await db.execute(sql`
				UPDATE guarded_documents
				SET "tenantId" = ${guardedHookTenantId}
				WHERE id = ${original.id}
			`);
		},
	});
const guardedLegacyDocuments = collection("guarded_legacy_documents")
	.fields(({ f }) => ({
		tenantId: f.text().required(),
		title: f.text().required(),
	}))
	.access({
		update: ({ session }) => ({
			tenantId: session?.user.id ?? "__anonymous__",
		}),
		delete: ({ session }) => ({
			tenantId: session?.user.id ?? "__anonymous__",
		}),
	})
	.hooks({
		beforeChange: async ({ db, operation, original }) => {
			if (operation !== "update" || guardedHookMode !== "update") return;
			await db.execute(sql`
				UPDATE guarded_legacy_documents
				SET "tenantId" = ${guardedHookTenantId}
				WHERE id = ${original.id}
			`);
		},
		beforeDelete: async ({ db, original }) => {
			if (guardedHookMode !== "delete") return;
			await db.execute(sql`
				UPDATE guarded_legacy_documents
				SET "tenantId" = ${guardedHookTenantId}
				WHERE id = ${original.id}
			`);
		},
	});

describe("generated CRUD optimistic concurrency", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	const context = createTestContext();

	beforeEach(async () => {
		observedOriginalRevision = undefined;
		onBeforeChange = undefined;
		onBeforeDelete = undefined;
		beforeTransitionFacts = 0;
		observedDeleteRevision = undefined;
		beforeOperationDeleteRuns = 0;
		beforeDeleteRuns = 0;
		guardedHookMode = undefined;
		guardedHookTenantId = undefined;
		setup = await buildMockApp({
			collections: {
				guardedLegacyDocuments,
				optimisticTags,
				optimisticGroups,
				optimisticTagGroups,
				legacyTags,
				tenantDocuments,
				retainedTags,
				guardedDocuments,
			},
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("rejects an application-declared canonical revision field", () => {
		const invalid = collection("declared_revision")
			.fields(({ f }) => ({ revision: f.number().required().default(1) }))
			.options({ optimisticConcurrency: true });

		expect(() => invalid.build()).toThrow(
			'cannot declare framework-owned field "revision"',
		);
	});

	it("hides guarded update and delete targets before revision checks", async () => {
		const ownerId = crypto.randomUUID();
		const strangerId = crypto.randomUUID();
		const guarded = await setup.app.collections.guardedDocuments.create(
			{ tenantId: ownerId, title: "Private" },
			context,
		);
		const stranger = createTestContext({
			accessMode: "user",
			session: createMockSession({ id: strangerId }),
		});

		const capture = (promise: Promise<unknown>) =>
			promise.catch((error: ApiError) => error) as Promise<ApiError>;
		const foreignUpdate = await capture(
			setup.app.collections.guardedDocuments.updateById(
				{ id: guarded.id, expectedRevision: 999, data: { title: "Probe" } },
				stranger,
			),
		);
		const absentUpdate = await capture(
			setup.app.collections.guardedDocuments.updateById(
				{
					id: crypto.randomUUID(),
					expectedRevision: 999,
					data: { title: "Probe" },
				},
				stranger,
			),
		);
		expect(foreignUpdate.toJSON(false)).toEqual(absentUpdate.toJSON(false));

		const foreignDelete = await capture(
			setup.app.collections.guardedDocuments.deleteById(
				{ id: guarded.id, expectedRevision: 999 },
				stranger,
			),
		);
		const absentDelete = await capture(
			setup.app.collections.guardedDocuments.deleteById(
				{ id: crypto.randomUUID(), expectedRevision: 999 },
				stranger,
			),
		);
		expect(foreignDelete.toJSON(false)).toEqual(absentDelete.toJSON(false));

		const foreignBulkUpdate = await capture(
			setup.app.collections.guardedDocuments.updateMany(
				{
					where: { tenantId: ownerId },
					data: { title: "Probe" },
					expectedRevisions: [{ id: guarded.id, expectedRevision: 999 }],
				},
				stranger,
			),
		);
		const absentBulkUpdate = await capture(
			setup.app.collections.guardedDocuments.updateMany(
				{
					where: { tenantId: crypto.randomUUID() },
					data: { title: "Probe" },
					expectedRevisions: [],
				},
				stranger,
			),
		);
		expect(foreignBulkUpdate.toJSON(false)).toEqual(
			absentBulkUpdate.toJSON(false),
		);

		const foreignBulkDelete = await capture(
			setup.app.collections.guardedDocuments.deleteMany(
				{
					where: { tenantId: ownerId },
					expectedRevisions: [{ id: guarded.id, expectedRevision: 999 }],
				},
				stranger,
			),
		);
		const absentBulkDelete = await capture(
			setup.app.collections.guardedDocuments.deleteMany(
				{ where: { tenantId: crypto.randomUUID() }, expectedRevisions: [] },
				stranger,
			),
		);
		expect(foreignBulkDelete.toJSON(false)).toEqual(
			absentBulkDelete.toJSON(false),
		);
	});

	it("rejects a stale delete before running delete hooks", async () => {
		const tag = await setup.app.collections.optimisticTags.create(
			{ name: "Stale delete" },
			context,
		);

		await expect(
			setup.app.collections.optimisticTags.deleteById(
				{ id: tag.id, expectedRevision: tag.revision + 1 },
				context,
			),
		).rejects.toThrow("Optimistic concurrency conflict");
		expect(beforeOperationDeleteRuns).toBe(0);
		expect(beforeDeleteRuns).toBe(0);
	});

	it("rechecks guarded updates after hooks mutate access fields", async () => {
		const ownerId = crypto.randomUUID();
		const foreignTenantId = crypto.randomUUID();
		const guarded = await setup.app.collections.guardedDocuments.create(
			{ tenantId: ownerId, title: "Original" },
			context,
		);
		const owner = createTestContext({
			accessMode: "user",
			session: createMockSession({ id: ownerId }),
		});
		guardedHookMode = "update";
		guardedHookTenantId = foreignTenantId;

		await expect(
			setup.app.collections.guardedDocuments.updateById(
				{
					id: guarded.id,
					expectedRevision: guarded.revision,
					data: { title: "Unauthorized" },
				},
				owner,
			),
		).rejects.toThrow("Access denied");

		const unchanged = await setup.app.collections.guardedDocuments.findOne(
			{ where: { id: guarded.id } },
			context,
		);
		expect(unchanged).toMatchObject({ tenantId: ownerId, title: "Original" });
	});

	it("rechecks guarded bulk deletes after hooks mutate access fields", async () => {
		const ownerId = crypto.randomUUID();
		const foreignTenantId = crypto.randomUUID();
		const guarded = await setup.app.collections.guardedDocuments.create(
			{ tenantId: ownerId, title: "Keep" },
			context,
		);
		const owner = createTestContext({
			accessMode: "user",
			session: createMockSession({ id: ownerId }),
		});
		guardedHookMode = "delete";
		guardedHookTenantId = foreignTenantId;

		await expect(
			setup.app.collections.guardedDocuments.deleteMany(
				{
					where: { id: guarded.id },
					expectedRevisions: [
						{ id: guarded.id, expectedRevision: guarded.revision },
					],
				},
				owner,
			),
		).rejects.toThrow("Access denied");

		const unchanged = await setup.app.collections.guardedDocuments.findOne(
			{ where: { id: guarded.id } },
			context,
		);
		expect(unchanged).toMatchObject({ tenantId: ownerId, title: "Keep" });
	});

	it("rolls back legacy update hook writes after final authority denial", async () => {
		const ownerId = crypto.randomUUID();
		const guarded = await setup.app.collections.guardedLegacyDocuments.create(
			{ tenantId: ownerId, title: "Original" },
			context,
		);
		const owner = createTestContext({
			accessMode: "user",
			session: createMockSession({ id: ownerId }),
		});
		guardedHookMode = "update";
		guardedHookTenantId = crypto.randomUUID();

		await expect(
			setup.app.collections.guardedLegacyDocuments.updateById(
				{ id: guarded.id, data: { title: "Unauthorized" } },
				owner,
			),
		).rejects.toThrow("Access denied");

		expect(
			await setup.app.collections.guardedLegacyDocuments.findOne(
				{ where: { id: guarded.id } },
				context,
			),
		).toMatchObject({ tenantId: ownerId, title: "Original" });
	});

	it("rolls back legacy deleteById hook writes after final authority denial", async () => {
		const ownerId = crypto.randomUUID();
		const guarded = await setup.app.collections.guardedLegacyDocuments.create(
			{ tenantId: ownerId, title: "Keep by id" },
			context,
		);
		const owner = createTestContext({
			accessMode: "user",
			session: createMockSession({ id: ownerId }),
		});
		guardedHookMode = "delete";
		guardedHookTenantId = crypto.randomUUID();

		await expect(
			setup.app.collections.guardedLegacyDocuments.deleteById(
				{ id: guarded.id },
				owner,
			),
		).rejects.toThrow("Access denied");

		expect(
			await setup.app.collections.guardedLegacyDocuments.findOne(
				{ where: { id: guarded.id } },
				context,
			),
		).toMatchObject({ tenantId: ownerId, title: "Keep by id" });
	});

	it("rolls back legacy deleteMany hook writes after final authority denial", async () => {
		const ownerId = crypto.randomUUID();
		const guarded = await setup.app.collections.guardedLegacyDocuments.create(
			{ tenantId: ownerId, title: "Keep in bulk" },
			context,
		);
		const owner = createTestContext({
			accessMode: "user",
			session: createMockSession({ id: ownerId }),
		});
		guardedHookMode = "delete";
		guardedHookTenantId = crypto.randomUUID();

		await expect(
			setup.app.collections.guardedLegacyDocuments.deleteMany(
				{ where: { id: guarded.id } },
				owner,
			),
		).rejects.toThrow("Access denied");

		expect(
			await setup.app.collections.guardedLegacyDocuments.findOne(
				{ where: { id: guarded.id } },
				context,
			),
		).toMatchObject({ tenantId: ownerId, title: "Keep in bulk" });
	});

	it("creates revision 1 and advances it once from the expected revision", async () => {
		await expect(
			setup.app.collections.optimisticTags.create(
				{ name: "Forged", revision: 41 } as never,
				context,
			),
		).rejects.toThrow('Framework-owned field "revision" cannot be supplied');
		const tag = await setup.app.collections.optimisticTags.create(
			{ name: "Platform" },
			context,
		);
		expect(tag.revision).toBe(1);

		const updated = await setup.app.collections.optimisticTags.updateById(
			{
				id: tag.id,
				expectedRevision: 1,
				data: { name: "Infrastructure" },
			},
			context,
		);

		expect(updated.name).toBe("Infrastructure");
		expect(updated.revision).toBe(2);
		expect(observedOriginalRevision).toBe(1);
	});

	it("increments when timestamps are disabled and only localized or relation data changes", async () => {
		const tag = await setup.app.collections.optimisticTags.create(
			{ name: "Platform" },
			context,
		);
		const localized = await setup.app.collections.optimisticTags.updateById(
			{
				id: tag.id,
				expectedRevision: 1,
				data: { localizedName: "Platforma" },
			},
			context,
		);
		expect(localized).toMatchObject({
			localizedName: "Platforma",
			revision: 2,
		});

		const group = await setup.app.collections.optimisticGroups.create(
			{ name: "Core" },
			context,
		);
		const related = await setup.app.collections.optimisticTags.updateById(
			{
				id: tag.id,
				expectedRevision: 2,
				data: { groups: { set: [group.id] } },
			},
			context,
		);
		expect(related.revision).toBe(3);
		const populated = await setup.app.collections.optimisticTags.findOne(
			{ where: { id: tag.id }, with: { groups: true } },
			context,
		);
		expect(populated?.groups).toHaveLength(1);
		await setup.app.collections.optimisticTags.deleteById(
			{ id: tag.id, expectedRevision: 3 },
			context,
		);
		expect(
			await setup.app.collections.optimisticTagGroups.count({}, context),
		).toBe(0);
	});

	it("requires a fresh expected revision when reverting and increments monotonically", async () => {
		const tag = await setup.app.collections.optimisticTags.create(
			{ name: "Original" },
			context,
		);
		await setup.app.collections.optimisticTags.updateById(
			{
				id: tag.id,
				expectedRevision: 1,
				data: { name: "Current" },
			},
			context,
		);
		let revertHookFacts = 0;
		onBeforeChange = async () => {
			revertHookFacts++;
		};

		await expect(
			setup.app.collections.optimisticTags.revertToVersion(
				{ id: tag.id, version: 1 },
				context,
			),
		).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(
			setup.app.collections.optimisticTags.revertToVersion(
				{ id: tag.id, version: 1, expectedRevision: 1 },
				context,
			),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(revertHookFacts).toBe(0);

		const reverted = await setup.app.collections.optimisticTags.revertToVersion(
			{ id: tag.id, version: 1, expectedRevision: 2 },
			context,
		);
		expect(reverted).toMatchObject({ name: "Original", revision: 3 });
		expect(revertHookFacts).toBe(1);
	});

	it("workflow transitions require the current revision and advance once", async () => {
		const tag = await setup.app.collections.optimisticTags.create(
			{ name: "Draft" },
			context,
		);
		beforeTransitionFacts = 0;
		await expect(
			setup.app.collections.optimisticTags.transitionStage(
				{ id: tag.id, stage: "published", expectedRevision: 0 },
				context,
			),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(beforeTransitionFacts).toBe(0);

		const transitioned =
			await setup.app.collections.optimisticTags.transitionStage(
				{ id: tag.id, stage: "published", expectedRevision: 1 },
				context,
			);
		expect(transitioned).toMatchObject({ revision: 2 });
		expect(beforeTransitionFacts).toBe(1);
	});

	it("retention removes snapshots without resetting the canonical revision", async () => {
		const tag = await setup.app.collections.retainedTags.create(
			{ name: "Revision 1" },
			context,
		);
		for (let revision = 1; revision < 5; revision++) {
			await setup.app.collections.retainedTags.updateById(
				{
					id: tag.id,
					expectedRevision: revision,
					data: { name: `Revision ${revision + 1}` },
				},
				context,
			);
		}

		const current = await setup.app.collections.retainedTags.findOne(
			{ where: { id: tag.id } },
			context,
		);
		const versions = await setup.app.collections.retainedTags.findVersions(
			{ id: tag.id },
			context,
		);
		expect(current).toMatchObject({ name: "Revision 5", revision: 5 });
		expect(versions).toHaveLength(2);
		expect(versions.map(({ sourceRevision }) => sourceRevision)).toEqual([
			4, 5,
		]);
		expect(versions.map(({ versionNumber }) => versionNumber)).toEqual([4, 5]);
	});

	it("derives history access from the authorized owner row", async () => {
		const created = await setup.app.collections.tenantDocuments.create(
			{ tenantId: "tenant-a", title: "Private" },
			context,
		);
		const ownerContext = createTestContext({
			accessMode: "user",
			session: createMockSession({ id: "tenant-a" }),
		});
		const otherContext = createTestContext({
			accessMode: "user",
			session: createMockSession({ id: "tenant-b" }),
		});

		await expect(
			setup.app.collections.tenantDocuments.findVersions(
				{ id: created.id },
				otherContext,
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			setup.app.collections.tenantDocuments.revertToVersion(
				{ id: created.id, version: 1 },
				otherContext,
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			setup.app.collections.tenantDocuments.findVersions(
				{ id: created.id },
				ownerContext,
			),
		).resolves.toHaveLength(1);
	});

	it("rejects omitted and stale revisions without mutating the row", async () => {
		const tag = await setup.app.collections.optimisticTags.create(
			{ name: "Platform" },
			context,
		);

		for (const params of [
			{ id: tag.id, data: { name: "Omitted" } },
			{ id: tag.id, expectedRevision: 0, data: { name: "Stale" } },
		]) {
			await expect(
				setup.app.collections.optimisticTags.updateById(params, context),
			).rejects.toMatchObject({ code: "CONFLICT" });
		}

		const unchanged = await setup.app.collections.optimisticTags.findOne(
			{ where: { id: tag.id } },
			context,
		);
		expect(unchanged?.name).toBe("Platform");
		expect(unchanged?.revision).toBe(1);
	});

	it("allows exactly one of two concurrent writers to commit", async () => {
		const tag = await setup.app.collections.optimisticTags.create(
			{ name: "Platform" },
			context,
		);

		const outcomes = await Promise.allSettled([
			setup.app.collections.optimisticTags.updateById(
				{
					id: tag.id,
					expectedRevision: 1,
					data: { name: "Writer A" },
				},
				context,
			),
			setup.app.collections.optimisticTags.updateById(
				{
					id: tag.id,
					expectedRevision: 1,
					data: { name: "Writer B" },
				},
				context,
			),
		]);

		expect(
			outcomes.filter((outcome) => outcome.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			outcomes.filter((outcome) => outcome.status === "rejected"),
		).toHaveLength(1);
		const rejected = outcomes.find((outcome) => outcome.status === "rejected");
		expect(rejected?.reason).toMatchObject({ code: "CONFLICT" });

		const winner = await setup.app.collections.optimisticTags.findOne(
			{ where: { id: tag.id } },
			context,
		);
		expect(["Writer A", "Writer B"]).toContain(winner?.name);
		expect(winner?.revision).toBe(2);
	});

	it("guards soft delete and restore and advances the version for both", async () => {
		const tag = await setup.app.collections.optimisticTags.create(
			{ name: "Platform" },
			context,
		);

		const deletion = await setup.app.collections.optimisticTags.deleteById(
			{ id: tag.id, expectedRevision: 1 },
			context,
		);
		expect(deletion.data.revision).toBe(2);
		expect(observedDeleteRevision).toBe(2);
		const deleted = await setup.app.collections.optimisticTags.findOne(
			{ where: { id: tag.id }, includeDeleted: true },
			context,
		);
		expect(deleted?.deletedAt).toBeInstanceOf(Date);
		expect(deleted?.revision).toBe(2);

		const restored = await setup.app.collections.optimisticTags.restoreById(
			{ id: tag.id, expectedRevision: 2 },
			context,
		);
		expect(restored.deletedAt).toBeNull();
		expect(restored.revision).toBe(3);

		await expect(
			setup.app.collections.optimisticTags.restoreById(
				{ id: tag.id, expectedRevision: 2 },
				context,
			),
		).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(
			setup.app.collections.optimisticTags.restoreById(
				{ id: tag.id, expectedRevision: 3 },
				context,
			),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("requires the current tombstone version before physical purge", async () => {
		const tag = await setup.app.collections.optimisticTags.create(
			{ name: "Expired" },
			context,
		);
		await setup.app.collections.optimisticTags.deleteById(
			{ id: tag.id, expectedRevision: 1 },
			context,
		);

		for (const params of [
			{ id: tag.id },
			{ id: tag.id, expectedRevision: 1 },
		]) {
			await expect(
				setup.app.collections.optimisticTags.purgeById(params, context),
			).rejects.toMatchObject({ code: "CONFLICT" });
		}
		const retained = await setup.app.collections.optimisticTags.findOne(
			{ where: { id: tag.id }, includeDeleted: true },
			context,
		);
		expect(retained).toMatchObject({ revision: 2 });
		expect(retained?.deletedAt).toBeInstanceOf(Date);

		await expect(
			setup.app.collections.optimisticTags.purgeById(
				{ id: tag.id, expectedRevision: 2 },
				context,
			),
		).resolves.toEqual({ success: true });
		expect(
			await setup.app.collections.optimisticTags.findOne(
				{ where: { id: tag.id }, includeDeleted: true },
				context,
			),
		).toBeNull();
	});

	it("updates heterogeneous bulk revisions atomically from an exact per-id list", async () => {
		const first = await setup.app.collections.optimisticTags.create(
			{ name: "First" },
			context,
		);
		const second = await setup.app.collections.optimisticTags.create(
			{ name: "Second" },
			context,
		);
		await setup.app.collections.optimisticTags.updateById(
			{
				id: second.id,
				expectedRevision: 1,
				data: { name: "Second v2" },
			},
			context,
		);

		const updated = await setup.app.collections.optimisticTags.updateMany(
			{
				where: { id: { in: [first.id, second.id] } },
				expectedRevisions: [
					{ id: first.id, expectedRevision: 1 },
					{ id: second.id, expectedRevision: 2 },
				],
				data: { name: "Bulk" },
			},
			context,
		);
		expect(updated.map(({ revision }) => revision).sort()).toEqual([2, 3]);

		await expect(
			setup.app.collections.optimisticTags.updateMany(
				{
					where: { id: { in: [first.id, second.id] } },
					expectedRevisions: [
						{ id: first.id, expectedRevision: 2 },
						{ id: second.id, expectedRevision: 2 },
					],
					data: { name: "Stale bulk" },
				},
				context,
			),
		).rejects.toMatchObject({ code: "CONFLICT" });

		const unchanged = await setup.app.collections.optimisticTags.find(
			{
				where: { id: { in: [first.id, second.id] } },
				sort: { revision: "asc" },
			},
			context,
		);
		expect(unchanged.docs.map(({ name }) => name)).toEqual(["Bulk", "Bulk"]);
		expect(unchanged.docs.map(({ revision }) => revision)).toEqual([2, 3]);
	});

	it("soft-deletes a bulk selection only with exact per-id revisions", async () => {
		const first = await setup.app.collections.optimisticTags.create(
			{ name: "First" },
			context,
		);
		const second = await setup.app.collections.optimisticTags.create(
			{ name: "Second" },
			context,
		);

		const result = await setup.app.collections.optimisticTags.deleteMany(
			{
				where: { id: { in: [first.id, second.id] } },
				expectedRevisions: [
					{ id: first.id, expectedRevision: 1 },
					{ id: second.id, expectedRevision: 1 },
				],
			},
			context,
		);
		expect(result.count).toBe(2);

		const deleted = await setup.app.collections.optimisticTags.find(
			{
				where: { id: { in: [first.id, second.id] } },
				includeDeleted: true,
				sort: { id: "asc" },
			},
			context,
		);
		expect(
			deleted.docs.every(({ deletedAt }) => deletedAt instanceof Date),
		).toBe(true);
		expect(deleted.docs.map(({ revision }) => revision)).toEqual([2, 2]);
	});

	it("rolls back delete hook writes when deleteMany loses its revision claim", async () => {
		const tag = await setup.app.collections.optimisticTags.create(
			{ name: "Raced" },
			context,
		);
		onBeforeDelete = async () => {
			onBeforeDelete = undefined;
			await setup.app.collections.optimisticTags.deleteById(
				{ id: tag.id, expectedRevision: 1 },
				context,
			);
		};

		await expect(
			setup.app.collections.optimisticTags.deleteMany(
				{
					where: { id: tag.id },
					expectedRevisions: [{ id: tag.id, expectedRevision: 1 }],
				},
				context,
			),
		).rejects.toMatchObject({ code: "CONFLICT" });

		const deleted = await setup.app.collections.optimisticTags.findOne(
			{ where: { id: tag.id }, includeDeleted: true },
			context,
		);
		expect(deleted).toMatchObject({ revision: 1, deletedAt: null });
	});

	it("applies updateBatch per-entry revisions atomically", async () => {
		const first = await setup.app.collections.optimisticTags.create(
			{ name: "First" },
			context,
		);
		const second = await setup.app.collections.optimisticTags.create(
			{ name: "Second" },
			context,
		);

		await expect(
			setup.app.collections.optimisticTags.updateBatch(
				{
					updates: [
						{
							id: first.id,
							expectedRevision: 1,
							data: { name: "First updated" },
						},
						{
							id: second.id,
							expectedRevision: 0,
							data: { name: "Second stale" },
						},
					],
				},
				context,
			),
		).rejects.toMatchObject({ code: "CONFLICT" });

		const unchanged = await setup.app.collections.optimisticTags.find(
			{ where: { id: { in: [first.id, second.id] } }, sort: { name: "asc" } },
			context,
		);
		expect(unchanged.docs.map(({ name }) => name)).toEqual(["First", "Second"]);
		expect(unchanged.docs.map(({ revision }) => revision)).toEqual([1, 1]);

		const updated = await setup.app.collections.optimisticTags.updateBatch(
			{
				updates: [
					{
						id: first.id,
						expectedRevision: 1,
						data: { name: "First updated" },
					},
					{
						id: second.id,
						expectedRevision: 1,
						data: { name: "Second updated" },
					},
				],
			},
			context,
		);
		expect(updated.map(({ revision }) => revision)).toEqual([2, 2]);
	});

	it("enforces the same contract through generated REST routes", async () => {
		const tag = await setup.app.collections.optimisticTags.create(
			{ name: "Platform" },
			context,
		);
		const handler = createFetchHandler(setup.app, { accessMode: "system" });
		const request = (
			path: string,
			method: string,
			body?: unknown,
			headers?: Record<string, string>,
		) =>
			handler(
				new Request(`http://localhost/${path}`, {
					method,
					headers: {
						...(body === undefined
							? {}
							: { "content-type": "application/json" }),
						...headers,
					},
					body: body === undefined ? undefined : JSON.stringify(body),
				}),
			);

		const schema = await request("optimisticTags/schema", "GET");
		expect(schema?.status).toBe(200);
		expect(await schema?.json()).toMatchObject({
			options: {
				optimisticConcurrency: true,
			},
		});
		const meta = await request("optimisticTags/meta", "GET");
		expect(meta?.status).toBe(200);
		expect(await meta?.json()).toMatchObject({
			optimisticConcurrency: true,
		});

		const omitted = await request(`optimisticTags/${tag.id}`, "PATCH", {
			data: { name: "Unsafe" },
		});
		expect(omitted?.status).toBe(409);
		expect(await omitted?.json()).toMatchObject({
			error: { code: "CONFLICT" },
		});

		const updated = await request(`optimisticTags/${tag.id}`, "PATCH", {
			data: { name: "REST" },
			expectedRevision: 1,
		});
		expect(updated?.status).toBe(200);
		expect(updated?.headers.get("etag")).toBe('"2"');
		expect(await updated?.json()).toMatchObject({ name: "REST", revision: 2 });
		const staleHeader = await request(
			`optimisticTags/${tag.id}`,
			"PATCH",
			{ data: { name: "Stale header" } },
			{ "if-match": '"1"' },
		);
		expect(staleHeader?.status).toBe(412);

		const deleted = await request(`optimisticTags/${tag.id}`, "DELETE", {
			expectedRevision: 2,
		});
		expect(deleted?.status).toBe(200);
		expect(deleted?.headers.get("etag")).toBe('"3"');
		const deletion = await deleted?.json();
		expect(deletion).toMatchObject({
			success: true,
			data: { id: tag.id, revision: 3 },
		});

		const restored = await request(`optimisticTags/${tag.id}/restore`, "POST", {
			expectedRevision: deletion.data.revision,
		});
		expect(restored?.status).toBe(200);
		expect(await restored?.json()).toMatchObject({
			deletedAt: null,
			revision: 4,
		});

		const omittedRevert = await request(
			`optimisticTags/${tag.id}/revert`,
			"POST",
			{ version: 1 },
		);
		expect(omittedRevert?.status).toBe(409);
		const reverted = await request(`optimisticTags/${tag.id}/revert`, "POST", {
			version: 1,
			expectedRevision: 4,
		});
		expect(reverted?.status).toBe(200);
		expect(await reverted?.json()).toMatchObject({
			name: "Platform",
			revision: 5,
		});

		const deletedAgain = await request(`optimisticTags/${tag.id}`, "DELETE", {
			expectedRevision: 5,
		});
		expect(deletedAgain?.status).toBe(200);
		const omittedPurge = await request(
			`optimisticTags/${tag.id}/purge`,
			"POST",
		);
		expect(omittedPurge?.status).toBe(409);
		const purged = await request(`optimisticTags/${tag.id}/purge`, "POST", {
			expectedRevision: 6,
		});
		expect(purged?.status).toBe(200);
		expect(await purged?.json()).toEqual({ success: true });
	});

	it("preserves last-write-wins CRUD for collections without the option", async () => {
		const tag = await setup.app.collections.legacyTags.create(
			{ name: "Legacy" },
			context,
		);
		const updated = await setup.app.collections.legacyTags.updateById(
			{ id: tag.id, data: { name: "Still supported", revision: 7 } },
			context,
		);
		expect(updated).toMatchObject({ name: "Still supported", revision: 7 });
		const handler = createFetchHandler(setup.app, { accessMode: "system" });
		const response = await handler(
			new Request(`http://localhost/legacyTags/${tag.id}`),
		);
		expect(response?.headers.get("etag")).toBeNull();
		const unsupportedIfMatch = await handler(
			new Request(`http://localhost/legacyTags/${tag.id}`, {
				method: "DELETE",
				headers: { "if-match": '"7"' },
			}),
		);
		expect(unsupportedIfMatch?.status).toBe(400);

		await setup.app.collections.legacyTags.deleteById({ id: tag.id }, context);
		const restored = await setup.app.collections.legacyTags.restoreById(
			{ id: tag.id },
			context,
		);
		expect(restored).toMatchObject({ name: "Still supported", revision: 7 });
		await setup.app.collections.legacyTags.deleteById({ id: tag.id }, context);
		await expect(
			setup.app.collections.legacyTags.purgeById({ id: tag.id }, context),
		).resolves.toEqual({ success: true });
	});
});
