import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { global } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const site_settings = global("site_settings")
	.fields(({ f }) => ({
		siteName: f.text().required(),
	}))
	.options({
		versioning: {
			workflow: {
				stages: ["draft", "published"],
				initialStage: "draft",
			},
		},
	});

const guarded_settings = global("guarded_settings")
	.fields(({ f }) => ({
		siteName: f.text().required(),
	}))
	.options({
		versioning: {
			workflow: {
				stages: {
					draft: { transitions: ["review"] },
					review: { transitions: ["published"] },
					published: { transitions: [] },
				},
				initialStage: "draft",
			},
		},
	});

const no_workflow_global = global("no_workflow_global")
	.fields(({ f }) => ({
		siteName: f.text().required(),
	}))
	.options({
		timestamps: true,
	});

describe("global transitionStage", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		setup = await buildMockApp({
			globals: { site_settings, guarded_settings, no_workflow_global },
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("transitions a global from draft to published", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		// Create the global record via update (globals are singletons)
		await setup.app.globals.site_settings.update(
			{ siteName: "My Site" },
			ctx,
		);

		const result = await setup.app.globals.site_settings.transitionStage(
			{ stage: "published" },
			ctx,
		);

		expect(result).not.toBeNull();
		expect(result.siteName).toBe("My Site");

		// Verify the global is now readable from the published stage
		const published = await setup.app.globals.site_settings.get(
			{ stage: "published" },
			ctx,
		);
		expect(published).not.toBeNull();
		expect(published?.siteName).toBe("My Site");
	});

	it("throws for unknown target stage", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		await setup.app.globals.site_settings.update(
			{ siteName: "My Site" },
			ctx,
		);

		await expect(
			setup.app.globals.site_settings.transitionStage(
				{ stage: "nonexistent" },
				ctx,
			),
		).rejects.toThrow('Unknown workflow stage "nonexistent"');
	});

	it("throws when workflow is not enabled on the global", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		await setup.app.globals.no_workflow_global.update(
			{ siteName: "No WF" },
			ctx,
		);

		await expect(
			setup.app.globals.no_workflow_global.transitionStage(
				{ stage: "published" },
				ctx,
			),
		).rejects.toThrow("Workflow is not enabled");
	});

	it("enforces transition guards", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		await setup.app.globals.guarded_settings.update(
			{ siteName: "My Site" },
			ctx,
		);

		// draft -> published should fail
		await expect(
			setup.app.globals.guarded_settings.transitionStage(
				{ stage: "published" },
				ctx,
			),
		).rejects.toThrow('Transition from "draft" to "published" is not allowed');

		// draft -> review should succeed
		await setup.app.globals.guarded_settings.transitionStage(
			{ stage: "review" },
			ctx,
		);

		// review -> published should succeed
		await setup.app.globals.guarded_settings.transitionStage(
			{ stage: "published" },
			ctx,
		);

		// published -> draft should fail
		await expect(
			setup.app.globals.guarded_settings.transitionStage(
				{ stage: "draft" },
				ctx,
			),
		).rejects.toThrow('Transition from "published" to "draft" is not allowed');
	});

	it("does not mutate record data during transition", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		await setup.app.globals.site_settings.update(
			{ siteName: "Original Name" },
			ctx,
		);

		await setup.app.globals.site_settings.transitionStage(
			{ stage: "published" },
			ctx,
		);

		// Draft stage should still have the original data
		const draftRow = await setup.app.globals.site_settings.get({}, ctx);
		expect(draftRow?.siteName).toBe("Original Name");
	});
});
