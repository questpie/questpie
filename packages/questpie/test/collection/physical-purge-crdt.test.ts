import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { eq } from "drizzle-orm";

import { collection } from "../../src/exports/index.js";
import { collectCrdtExpiredRecoveryRoots } from "../../src/server/modules/core/integrated/crdt/compaction-store.js";
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

const collabArticles = collection("purge_collaborative_articles")
	.fields(({ f }) => ({
		title: f.text().required(),
		content: f.textarea().default("").required().crdt({ format: "text" }),
	}))
	.collaborative()
	.options({ softDelete: true })
	.access({ purge: true });

const textEngine = createDeterministicTextEngine();
const crdtConfig = {
	namespace: "questpie-purge-crdt",
	engines: { text: textEngine },
};
const crdtRegistry = createCrdtRegistry({
	collections: { collabArticles: collabArticles.build() },
	globals: {},
});
const crdtManifest = updateCrdtManifestArtifact({
	namespace: crdtConfig.namespace,
	declarations: createCrdtManifestDeclarations({
		registry: crdtRegistry,
		config: crdtConfig,
	}),
	createStableFieldId: uuidSequence().next,
});

describe("physical purge CRDT retention boundary", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		setup = await buildMockApp(
			{
				collections: { collabArticles },
				crdtManifest,
			},
			{ crdt: crdtConfig, secret: "s".repeat(32) },
		);
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("keeps the owner fenced and bounds recoverable CRDT content independently", async () => {
		const ctx = createTestContext({ accessMode: "system" });
		const article = await setup.app.collections.collabArticles.create(
			{ title: "Shared", content: "Collaborative body" },
			ctx,
		);

		const deletedArticle =
			await setup.app.collections.collabArticles.deleteById(
				{ id: article.id, expectedRevision: article.revision },
				ctx,
			);
		await setup.app.collections.collabArticles.purgeById(
			{ id: article.id, expectedRevision: deletedArticle.data.revision },
			ctx,
		);

		await expect(
			setup.app.collections.collabArticles.restoreById(
				{ id: article.id, expectedRevision: deletedArticle.data.revision },
				ctx,
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });

		const [resource] = await setup.app.db
			.select()
			.from(questpieCrdtResourceTable);
		expect(resource).toMatchObject({
			status: 2,
			currentEpochId: null,
		});
		expect(resource?.retiredAt).toBeInstanceOf(Date);
		expect(
			(await setup.app.db.select().from(questpieCrdtBindingTable)).every(
				(binding) => binding.status === 2 && binding.retiredAt != null,
			),
		).toBe(true);

		const expiredAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
		await setup.app.db
			.update(questpieCrdtResourceEpochTable)
			.set({ closedAt: expiredAt })
			.where(eq(questpieCrdtResourceEpochTable.resourceId, resource!.id));
		await setup.app.db
			.update(questpieCrdtBindingTable)
			.set({ retiredAt: expiredAt })
			.where(eq(questpieCrdtBindingTable.resourceId, resource!.id));
		await setup.app.db
			.update(questpieCrdtResourceTable)
			.set({ retiredAt: expiredAt })
			.where(eq(questpieCrdtResourceTable.id, resource!.id));

		await collectCrdtExpiredRecoveryRoots(setup.app.db, { limit: 256 });

		expect(
			await setup.app.db.select().from(questpieCrdtResourceEpochTable),
		).toHaveLength(0);
		expect(
			await setup.app.db.select().from(questpieCrdtBindingTable),
		).toHaveLength(0);
		expect(
			await setup.app.db.select().from(questpieCrdtResourceTable),
		).toHaveLength(0);
	});
});

function uuidSequence() {
	let value = 0;
	return {
		next: () =>
			`00000000-0000-4000-8000-${(++value).toString(16).padStart(12, "0")}`,
	};
}
