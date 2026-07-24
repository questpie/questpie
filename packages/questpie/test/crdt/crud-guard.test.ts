import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collection, global } from "../../src/exports/index.js";
import { createDeterministicTextEngine } from "../../src/server/modules/core/integrated/crdt/deterministic-engine.js";
import { createCrdtManifestDeclarations } from "../../src/server/modules/core/integrated/crdt/manifest-runtime.js";
import { updateCrdtManifestArtifact } from "../../src/server/modules/core/integrated/crdt/manifest.js";
import { createCrdtRegistry } from "../../src/server/modules/core/integrated/crdt/registry.js";
import {
	questpieCrdtBindingTable,
	questpieCrdtResourceTable,
} from "../../src/server/modules/core/integrated/crdt/schema.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { createTestContext } from "../utils/test-context.js";
import { runTestDbMigrations } from "../utils/test-db.js";

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
	.options({ versioning: true });

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
});

function uuidSequence() {
	let value = 0;
	return {
		next: () =>
			`00000000-0000-4000-8000-${(++value).toString(16).padStart(12, "0")}`,
	};
}
