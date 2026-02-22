import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { questpie } from "../../src/server/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const q = questpie({ name: "test-versioning-workflow" }).fields(defaultFields);

// Workflow shorthand: versioning: { workflow: true } → draft/published
const shorthand_posts = q
	.collection("shorthand_posts")
	.fields((f) => ({
		title: f.text({ required: true }),
	}))
	.options({
		versioning: {
			workflow: true,
		},
	});

// Full workflow config with stages
const workflow_posts = q
	.collection("workflow_posts")
	.fields((f) => ({
		title: f.text({ required: true }),
	}))
	.options({
		versioning: {
			workflow: {
				initialStage: "draft",
				stages: ["draft", "published"],
			},
		},
	});

// Plain versioning (no workflow) for comparison
const plain_versioned = q
	.collection("plain_versioned")
	.fields((f) => ({
		title: f.text({ required: true }),
	}))
	.options({
		versioning: true,
	});

const testModule = q.collections({
	shorthand_posts,
	workflow_posts,
	plain_versioned,
});

describe("collection versioning + workflow", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp<typeof testModule>>>;

	beforeEach(async () => {
		setup = await buildMockApp(testModule);
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	describe("workflow shorthand (versioning: { workflow: true })", () => {
		it("creates records in the initial stage (draft)", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			const created = await setup.app.api.collections.shorthand_posts.create(
				{ id: crypto.randomUUID(), title: "Shorthand Post" },
				ctx,
			);

			expect(created.title).toBe("Shorthand Post");

			// Should be readable without stage (= draft)
			const found = await setup.app.api.collections.shorthand_posts.findOne(
				{ where: { id: created.id } },
				ctx,
			);
			expect(found?.title).toBe("Shorthand Post");
		});

		it("transitions from draft to published using shorthand config", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			const created = await setup.app.api.collections.shorthand_posts.create(
				{ id: crypto.randomUUID(), title: "To Publish" },
				ctx,
			);

			const result =
				await setup.app.api.collections.shorthand_posts.transitionStage(
					{ id: created.id, stage: "published" },
					ctx,
				);

			expect(result.id).toBe(created.id);

			// Should be readable from published stage
			const published = await setup.app.api.collections.shorthand_posts.findOne(
				{ where: { id: created.id }, stage: "published" },
				ctx,
			);
			expect(published?.title).toBe("To Publish");
		});

		it("rejects transition to unknown stage with shorthand config", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			const created = await setup.app.api.collections.shorthand_posts.create(
				{ id: crypto.randomUUID(), title: "Bad Transition" },
				ctx,
			);

			await expect(
				setup.app.api.collections.shorthand_posts.transitionStage(
					{ id: created.id, stage: "review" },
					ctx,
				),
			).rejects.toThrow('Unknown workflow stage "review"');
		});
	});

	describe("versionStage in findVersions", () => {
		it("returns versionStage for workflow-enabled collections", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			const created = await setup.app.api.collections.workflow_posts.create(
				{ id: crypto.randomUUID(), title: "Version Stage Test" },
				ctx,
			);

			// Update to create another version
			await setup.app.api.collections.workflow_posts.updateById(
				{ id: created.id, data: { title: "Updated Title" } },
				ctx,
			);

			const versions =
				await setup.app.api.collections.workflow_posts.findVersions(
					{ id: created.id },
					ctx,
				);

			expect(versions.length).toBeGreaterThanOrEqual(2);

			// All versions should have versionStage field
			for (const version of versions) {
				expect((version as any).versionStage).toBeDefined();
			}

			// First version (create) should have draft stage
			expect((versions[0] as any).versionStage).toBe("draft");
		});

		it("records correct versionStage after transition", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			const created = await setup.app.api.collections.workflow_posts.create(
				{ id: crypto.randomUUID(), title: "Track Stage" },
				ctx,
			);

			// Transition to published
			await setup.app.api.collections.workflow_posts.transitionStage(
				{ id: created.id, stage: "published" },
				ctx,
			);

			const versions =
				await setup.app.api.collections.workflow_posts.findVersions(
					{ id: created.id },
					ctx,
				);

			// Should have at least 2 versions (create + transition)
			expect(versions.length).toBeGreaterThanOrEqual(2);

			// The latest version should have versionStage "published"
			const latestVersion = versions[versions.length - 1] as any;
			expect(latestVersion.versionStage).toBe("published");
		});

		it("does not return versionStage for non-workflow collections", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			const created = await setup.app.api.collections.plain_versioned.create(
				{ id: crypto.randomUUID(), title: "No Workflow" },
				ctx,
			);

			const versions =
				await setup.app.api.collections.plain_versioned.findVersions(
					{ id: created.id },
					ctx,
				);

			expect(versions.length).toBeGreaterThanOrEqual(1);
			// Non-workflow versions should have versionStage as null
			expect((versions[0] as any).versionStage).toBeNull();
		});
	});

	describe("stage-based query routing", () => {
		it("find() without stage reads from main table (draft)", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			const created = await setup.app.api.collections.workflow_posts.create(
				{ id: crypto.randomUUID(), title: "Draft Content" },
				ctx,
			);

			// Transition to published so there's a published snapshot
			await setup.app.api.collections.workflow_posts.transitionStage(
				{ id: created.id, stage: "published" },
				ctx,
			);

			// Update draft after transition
			await setup.app.api.collections.workflow_posts.updateById(
				{ id: created.id, data: { title: "Updated Draft" } },
				ctx,
			);

			// find() without stage should return the updated draft
			const drafts = await setup.app.api.collections.workflow_posts.find(
				{ where: { id: created.id } },
				ctx,
			);
			expect(drafts.docs.length).toBe(1);
			expect(drafts.docs[0].title).toBe("Updated Draft");
		});

		it("find({ stage: 'published' }) reads from versions table", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			const created = await setup.app.api.collections.workflow_posts.create(
				{ id: crypto.randomUUID(), title: "Original Content" },
				ctx,
			);

			// Transition to published
			await setup.app.api.collections.workflow_posts.transitionStage(
				{ id: created.id, stage: "published" },
				ctx,
			);

			// Update draft after publishing
			await setup.app.api.collections.workflow_posts.updateById(
				{ id: created.id, data: { title: "New Draft Version" } },
				ctx,
			);

			// Published stage should still show the original content
			const published = await setup.app.api.collections.workflow_posts.findOne(
				{ where: { id: created.id }, stage: "published" },
				ctx,
			);
			expect(published?.title).toBe("Original Content");

			// Draft should show the updated content
			const draft = await setup.app.api.collections.workflow_posts.findOne(
				{ where: { id: created.id } },
				ctx,
			);
			expect(draft?.title).toBe("New Draft Version");
		});

		it("returns empty results for unpublished records when querying published stage", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			await setup.app.api.collections.workflow_posts.create(
				{ id: crypto.randomUUID(), title: "Never Published" },
				ctx,
			);

			// Query published stage — should find nothing
			const published = await setup.app.api.collections.workflow_posts.find(
				{ stage: "published" },
				ctx,
			);
			expect(published.docs.length).toBe(0);
		});

		it("publishing updates the published snapshot", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			const created = await setup.app.api.collections.workflow_posts.create(
				{ id: crypto.randomUUID(), title: "V1" },
				ctx,
			);

			// First publish
			await setup.app.api.collections.workflow_posts.transitionStage(
				{ id: created.id, stage: "published" },
				ctx,
			);

			let published = await setup.app.api.collections.workflow_posts.findOne(
				{ where: { id: created.id }, stage: "published" },
				ctx,
			);
			expect(published?.title).toBe("V1");

			// Update draft
			await setup.app.api.collections.workflow_posts.updateById(
				{ id: created.id, data: { title: "V2" } },
				ctx,
			);

			// Published still shows V1
			published = await setup.app.api.collections.workflow_posts.findOne(
				{ where: { id: created.id }, stage: "published" },
				ctx,
			);
			expect(published?.title).toBe("V1");

			// Re-publish
			await setup.app.api.collections.workflow_posts.transitionStage(
				{ id: created.id, stage: "published" },
				ctx,
			);

			// Now published shows V2
			published = await setup.app.api.collections.workflow_posts.findOne(
				{ where: { id: created.id }, stage: "published" },
				ctx,
			);
			expect(published?.title).toBe("V2");
		});
	});
});
