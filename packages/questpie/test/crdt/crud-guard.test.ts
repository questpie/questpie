import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { eq } from "drizzle-orm";

import { collection, global } from "../../src/exports/index.js";
import { createDeterministicTextEngine } from "../../src/server/modules/core/integrated/crdt/deterministic-engine.js";
import { createCrdtManifestDeclarations } from "../../src/server/modules/core/integrated/crdt/manifest-runtime.js";
import { updateCrdtManifestArtifact } from "../../src/server/modules/core/integrated/crdt/manifest.js";
import { createCrdtRegistry } from "../../src/server/modules/core/integrated/crdt/registry.js";
import {
	questpieCrdtBindingTable,
	questpieCrdtResourceEpochTable,
	questpieCrdtResourceTable,
} from "../../src/server/modules/core/integrated/crdt/schema.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { createTestContext } from "../utils/test-context.js";
import { runTestDbMigrations } from "../utils/test-db.js";

let afterChangeSabotage: ((context: any) => Promise<void>) | undefined;
let afterDeleteSabotage: ((context: any) => Promise<void>) | undefined;

const articles = collection("articles")
	.fields(({ f }) => ({
		title: f.text().required(),
		tags: f
			.text({ mode: "text" })
			.array()
			.default([])
			.required()
			.crdt({ format: "set", conflict: "add-wins" }),
		content: f.textarea().default("").required().crdt({ format: "text" }),
	}))
	.collaborative()
	.options({ softDelete: true, versioning: true })
	.hooks({
		afterChange: async (context) => {
			await afterChangeSabotage?.(context);
		},
		afterDelete: async (context) => {
			await afterDeleteSabotage?.(context);
		},
	});

const siteSettings = global("site-settings")
	.fields(({ f }) => ({
		title: f.text().default("Site"),
		content: f.textarea().default("").required().crdt({ format: "text" }),
	}))
	.collaborative()
	.options({ versioning: true });
const textEngine = createDeterministicTextEngine();
const crdtConfig = {
	namespace: "questpie-crud-guard",
	engines: { text: textEngine },
};
const crdtRegistry = createCrdtRegistry({
	collections: { articles: articles.build() },
	globals: { siteSettings: siteSettings.build() },
});
const crdtManifest = updateCrdtManifestArtifact({
	namespace: crdtConfig.namespace,
	declarations: createCrdtManifestDeclarations({
		registry: crdtRegistry,
		config: crdtConfig,
	}),
	createStableFieldId: uuidSequence().next,
});

describe("CRDT ordinary CRUD guard", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		afterChangeSabotage = undefined;
		afterDeleteSabotage = undefined;
		setup = await buildMockApp(
			{
				collections: { articles },
				globals: { siteSettings },
				crdtManifest,
			},
			{ crdt: crdtConfig },
		);
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		afterChangeSabotage = undefined;
		afterDeleteSabotage = undefined;
		await setup.cleanup();
	});

	it("allows collection create seeding and unrelated updates", async () => {
		const ctx = createTestContext({ accessMode: "system" });
		const created = await setup.app.collections.articles.create(
			{ title: "Draft", content: "Initial" },
			ctx,
		);

		await setup.app.collections.articles.updateById(
			{ id: created.id, data: { title: "Published" } },
			ctx,
		);

		const stored = await setup.app.collections.articles.findOne(
			{ where: { id: created.id } },
			ctx,
		);
		expect(stored?.title).toBe("Published");
		expect(stored?.content).toBe("Initial");
		const resources = await setup.app.db
			.select()
			.from(questpieCrdtResourceTable);
		expect(resources).toHaveLength(1);
	});

	it("owns one started HA drain registration in the app lifecycle", () => {
		const registration = setup.app.crdtOperations.syncCoordinator;
		expect(registration).toBeDefined();
		const release = registration.register({
			id: "runtime-session",
			aggregateHash: "a".repeat(64),
			async reconcile() {
				return { behind: false };
			},
		});
		expect(release).toBeFunction();
		release();
	});

	it("rejects collection by-id, bulk, batch, and system writes", async () => {
		const ctx = createTestContext({ accessMode: "system" });
		const created = await setup.app.collections.articles.create(
			{ title: "Draft" },
			ctx,
		);
		const expected =
			'CRDT-managed field "articles.content" cannot be changed through ordinary CRUD';

		await expect(
			setup.app.collections.articles.updateById(
				{ id: created.id, data: { content: "replace" } as never },
				ctx,
			),
		).rejects.toThrow(expected);
		await expect(
			setup.app.collections.articles.updateMany(
				{ where: { id: created.id }, data: { tags: ["bulk"] } as never },
				ctx,
			),
		).rejects.toThrow(
			'CRDT-managed field "articles.tags" cannot be changed through ordinary CRUD',
		);
		await expect(
			setup.app.collections.articles.updateBatch(
				{
					updates: [{ id: created.id, data: { content: "batch" } as never }],
				},
				ctx,
			),
		).rejects.toThrow(expected);
	});

	it("rejects global CRDT writes but permits unrelated fields", async () => {
		const ctx = createTestContext({ accessMode: "system" });
		await setup.app.globals.siteSettings.update({ title: "New title" }, ctx);

		await expect(
			setup.app.globals.siteSettings.update(
				{ content: "replace" } as never,
				ctx,
			),
		).rejects.toThrow(
			'CRDT-managed field "site-settings.content" cannot be changed through ordinary CRUD',
		);
		expect((await setup.app.globals.siteSettings.get({}, ctx))?.title).toBe(
			"New title",
		);
		expect(
			await setup.app.db.select().from(questpieCrdtResourceTable),
		).toHaveLength(1);
	});

	it("lazy-activates one global incarnation under concurrent reads", async () => {
		const ctx = createTestContext({ accessMode: "system" });
		const rows = await Promise.all(
			Array.from({ length: 4 }, () =>
				setup.app.globals.siteSettings.get({}, ctx),
			),
		);

		expect(rows.every((row) => row?.content === "")).toBe(true);
		expect(
			await setup.app.db.select().from(questpieCrdtResourceTable),
		).toHaveLength(1);
		expect(
			await setup.app.db.select().from(questpieCrdtBindingTable),
		).toHaveLength(1);
	});

	it("rejects version restore for owners with CRDT fields", async () => {
		const ctx = createTestContext({ accessMode: "system" });
		const created = await setup.app.collections.articles.create(
			{ title: "v1" },
			ctx,
		);
		await setup.app.collections.articles.updateById(
			{ id: created.id, data: { title: "v2" } },
			ctx,
		);
		const [version] = await setup.app.collections.articles.findVersions(
			{ id: created.id },
			ctx,
		);

		await expect(
			setup.app.collections.articles.revertToVersion(
				{ id: created.id, versionId: version.versionId },
				ctx,
			),
		).rejects.toThrow(
			'Version restore for "articles" contains CRDT-managed fields',
		);
	});

	it("retires on soft delete, rejects ordinary undelete, and restores in a new epoch", async () => {
		const ctx = createTestContext({ accessMode: "system" });
		const created = await setup.app.collections.articles.create(
			{ title: "Draft", content: "Shared" },
			ctx,
		);
		const [before] = await setup.app.db
			.select()
			.from(questpieCrdtResourceTable);

		await setup.app.collections.articles.deleteById({ id: created.id }, ctx);
		const [retired] = await setup.app.db
			.select()
			.from(questpieCrdtResourceTable);
		expect(retired).toMatchObject({
			id: before?.id,
			status: 2,
			currentEpochId: null,
		});
		await expect(
			setup.app.collections.articles.updateById(
				{ id: created.id, data: { deletedAt: null } as never },
				ctx,
			),
		).rejects.toThrow(
			'Collaborative owner "articles" can only be undeleted through restoreById',
		);

		await setup.app.collections.articles.restoreById({ id: created.id }, ctx);
		const [restored] = await setup.app.db
			.select()
			.from(questpieCrdtResourceTable);
		expect(restored).toMatchObject({
			id: before?.id,
			status: 1,
		});
		const epochs = await setup.app.db
			.select()
			.from(questpieCrdtResourceEpochTable);
		expect(epochs.map((epoch) => epoch.aggregateEpoch).sort()).toEqual([
			1n,
			2n,
		]);
	});

	it("retires every collaborative owner in a bulk delete", async () => {
		const ctx = createTestContext({ accessMode: "system" });
		await setup.app.collections.articles.create(
			{ title: "First", content: "One" },
			ctx,
		);
		await setup.app.collections.articles.create(
			{ title: "Second", content: "Two" },
			ctx,
		);

		const result = await setup.app.collections.articles.deleteMany(
			{ where: {} },
			ctx,
		);

		expect(result.count).toBe(2);
		const resources = await setup.app.db
			.select()
			.from(questpieCrdtResourceTable);
		expect(resources).toHaveLength(2);
		expect(resources.every((resource) => resource.status === 2)).toBe(true);
	});

	it("rolls back when an afterDelete hook resurrects the SQL owner", async () => {
		const ctx = createTestContext({ accessMode: "system" });
		const created = await setup.app.collections.articles.create(
			{ title: "Draft", content: "Shared" },
			ctx,
		);
		const table = setup.app.collections.articles[
			"~internalRelatedTable"
		] as any;
		afterDeleteSabotage = async ({ db, data }) => {
			await db
				.update(table)
				.set({ deletedAt: null })
				.where(eq(table.id, data.id));
		};

		await expect(
			setup.app.collections.articles.deleteById({ id: created.id }, ctx),
		).rejects.toThrow(
			"Collaborative owner is not terminally deleted after delete hooks",
		);

		expect(
			await setup.app.collections.articles.findOne(
				{ where: { id: created.id } },
				ctx,
			),
		).not.toBeNull();
		const [resource] = await setup.app.db
			.select()
			.from(questpieCrdtResourceTable);
		expect(resource?.status).toBe(1);
	});

	it("rolls back when an afterChange hook re-deletes a restored SQL owner", async () => {
		const ctx = createTestContext({ accessMode: "system" });
		const created = await setup.app.collections.articles.create(
			{ title: "Draft", content: "Shared" },
			ctx,
		);
		await setup.app.collections.articles.deleteById({ id: created.id }, ctx);
		const table = setup.app.collections.articles[
			"~internalRelatedTable"
		] as any;
		afterChangeSabotage = async ({ db, data }) => {
			if (data.deletedAt == null) {
				await db
					.update(table)
					.set({ deletedAt: new Date() })
					.where(eq(table.id, data.id));
			}
		};

		await expect(
			setup.app.collections.articles.restoreById({ id: created.id }, ctx),
		).rejects.toThrow(
			"Collaborative owner remained deleted after restore hooks",
		);
		const [resource] = await setup.app.db
			.select()
			.from(questpieCrdtResourceTable);
		expect(resource?.status).toBe(2);
	});

	it("allows only one winner when soft delete races itself", async () => {
		const ctx = createTestContext({ accessMode: "system" });
		const created = await setup.app.collections.articles.create(
			{ title: "Draft", content: "Shared" },
			ctx,
		);

		const outcomes = await Promise.allSettled([
			setup.app.collections.articles.deleteById({ id: created.id }, ctx),
			setup.app.collections.articles.deleteById({ id: created.id }, ctx),
		]);

		expect(
			outcomes.filter((outcome) => outcome.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			outcomes.filter((outcome) => outcome.status === "rejected"),
		).toHaveLength(1);
		const resources = await setup.app.db
			.select()
			.from(questpieCrdtResourceTable);
		expect(resources).toHaveLength(1);
		expect(resources[0]?.status).toBe(2);
	});
});

function uuidSequence() {
	let value = 0;
	return {
		next: () =>
			`00000000-0000-4000-8000-${(++value).toString(16).padStart(12, "0")}`,
	};
}
