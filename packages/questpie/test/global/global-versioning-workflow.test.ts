import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { questpie } from "../../src/server/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const q = questpie({ name: "test-global-versioning-wf" }).fields(defaultFields);

// Workflow shorthand
const shorthand_config = q
	.global("shorthand_config")
	.fields((f) => ({
		siteName: f.text({ required: true }),
	}))
	.options({
		versioning: {
			workflow: true,
		},
	});

// Full workflow config
const workflow_config = q
	.global("workflow_config")
	.fields((f) => ({
		siteName: f.text({ required: true }),
	}))
	.options({
		versioning: {
			workflow: {
				initialStage: "draft",
				stages: ["draft", "published"],
			},
		},
	});

// Plain versioning
const plain_versioned = q
	.global("plain_versioned")
	.fields((f) => ({
		siteName: f.text({ required: true }),
	}))
	.options({
		versioning: true,
	});

const testModule = q.globals({
	shorthand_config,
	workflow_config,
	plain_versioned,
});

describe("global versioning + workflow", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp<typeof testModule>>>;

	beforeEach(async () => {
		setup = await buildMockApp(testModule);
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	describe("workflow shorthand (versioning: { workflow: true })", () => {
		it("creates and reads global in draft stage", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			await setup.app.api.globals.shorthand_config.update(
				{ siteName: "Shorthand Site" },
				ctx,
			);

			const result = await setup.app.api.globals.shorthand_config.get({}, ctx);
			expect(result?.siteName).toBe("Shorthand Site");
		});

		it("transitions from draft to published using shorthand config", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			await setup.app.api.globals.shorthand_config.update(
				{ siteName: "To Publish" },
				ctx,
			);

			const result =
				await setup.app.api.globals.shorthand_config.transitionStage(
					{ stage: "published" },
					ctx,
				);

			expect(result.siteName).toBe("To Publish");

			// Should be readable from published stage
			const published = await setup.app.api.globals.shorthand_config.get(
				{ stage: "published" },
				ctx,
			);
			expect(published?.siteName).toBe("To Publish");
		});

		it("rejects transition to unknown stage with shorthand config", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			await setup.app.api.globals.shorthand_config.update(
				{ siteName: "Bad Transition" },
				ctx,
			);

			await expect(
				setup.app.api.globals.shorthand_config.transitionStage(
					{ stage: "review" },
					ctx,
				),
			).rejects.toThrow('Unknown workflow stage "review"');
		});
	});

	describe("versionStage in findVersions", () => {
		it("returns versionStage for workflow-enabled globals", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			await setup.app.api.globals.workflow_config.update(
				{ siteName: "Version Stage Test" },
				ctx,
			);

			await setup.app.api.globals.workflow_config.update(
				{ siteName: "Updated" },
				ctx,
			);

			const versions = await setup.app.api.globals.workflow_config.findVersions(
				{},
				ctx,
			);

			expect(versions.length).toBeGreaterThanOrEqual(1);

			// Versions should have versionStage field
			for (const version of versions) {
				expect((version as any).versionStage).toBeDefined();
			}
		});

		it("records correct versionStage after transition", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			await setup.app.api.globals.workflow_config.update(
				{ siteName: "Track Stage" },
				ctx,
			);

			await setup.app.api.globals.workflow_config.transitionStage(
				{ stage: "published" },
				ctx,
			);

			const versions = await setup.app.api.globals.workflow_config.findVersions(
				{},
				ctx,
			);

			// The latest version should have versionStage "published"
			const latestVersion = versions[versions.length - 1] as any;
			expect(latestVersion.versionStage).toBe("published");
		});

		it("does not return versionStage for non-workflow globals", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			await setup.app.api.globals.plain_versioned.update(
				{ siteName: "No Workflow" },
				ctx,
			);

			const versions = await setup.app.api.globals.plain_versioned.findVersions(
				{},
				ctx,
			);

			expect(versions.length).toBeGreaterThanOrEqual(1);
			expect((versions[0] as any).versionStage).toBeNull();
		});
	});

	describe("stage-based query routing", () => {
		it("get() without stage reads draft, get({ stage }) reads published", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			await setup.app.api.globals.workflow_config.update(
				{ siteName: "Draft v1" },
				ctx,
			);

			// Transition to published
			await setup.app.api.globals.workflow_config.transitionStage(
				{ stage: "published" },
				ctx,
			);

			// Update draft after transition
			await setup.app.api.globals.workflow_config.update(
				{ siteName: "Draft v2" },
				ctx,
			);

			// Draft should show v2
			const draft = await setup.app.api.globals.workflow_config.get({}, ctx);
			expect(draft?.siteName).toBe("Draft v2");

			// Published should still show v1
			const published = await setup.app.api.globals.workflow_config.get(
				{ stage: "published" },
				ctx,
			);
			expect(published?.siteName).toBe("Draft v1");
		});

		it("returns null for unpublished globals when querying published stage", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			await setup.app.api.globals.workflow_config.update(
				{ siteName: "Never Published" },
				ctx,
			);

			// Query published stage — should return null
			const published = await setup.app.api.globals.workflow_config.get(
				{ stage: "published" },
				ctx,
			);
			expect(published).toBeNull();
		});

		it("re-publishing updates the published snapshot", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			await setup.app.api.globals.workflow_config.update(
				{ siteName: "V1" },
				ctx,
			);

			// First publish
			await setup.app.api.globals.workflow_config.transitionStage(
				{ stage: "published" },
				ctx,
			);

			let published = await setup.app.api.globals.workflow_config.get(
				{ stage: "published" },
				ctx,
			);
			expect(published?.siteName).toBe("V1");

			// Update draft
			await setup.app.api.globals.workflow_config.update(
				{ siteName: "V2" },
				ctx,
			);

			// Published still V1
			published = await setup.app.api.globals.workflow_config.get(
				{ stage: "published" },
				ctx,
			);
			expect(published?.siteName).toBe("V1");

			// Re-publish
			await setup.app.api.globals.workflow_config.transitionStage(
				{ stage: "published" },
				ctx,
			);

			// Now published shows V2
			published = await setup.app.api.globals.workflow_config.get(
				{ stage: "published" },
				ctx,
			);
			expect(published?.siteName).toBe("V2");
		});
	});
});
