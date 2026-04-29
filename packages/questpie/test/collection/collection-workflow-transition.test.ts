import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collection } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const workflow_posts = collection("workflow_posts")
	.fields(({ f }) => ({
		title: f.text().required(),
	}))
	.options({
		versioning: {
			workflow: {
				stages: ["draft", "published"],
				initialStage: "draft",
			},
		},
	});

const guarded_posts = collection("guarded_posts")
	.fields(({ f }) => ({
		title: f.text().required(),
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

const no_workflow = collection("no_workflow")
	.fields(({ f }) => ({
		title: f.text().required(),
	}))
	.options({
		timestamps: true,
	});

// Collection with transition-specific access: only admins can transition
const transition_access_posts = collection("transition_access_posts")
	.fields(({ f }) => ({
		title: f.text().required(),
	}))
	.options({
		versioning: {
			workflow: {
				stages: ["draft", "published"],
				initialStage: "draft",
			},
		},
	})
	.access({
		update: () => true, // anyone can update
		transition: ({ session }) => session?.user?.role === "admin",
	});

// Track hook calls for testing
const hookCalls: {
	before: Array<{ fromStage: string; toStage: string }>;
	after: Array<{ fromStage: string; toStage: string }>;
} = { before: [], after: [] };

const hooked_posts = collection("hooked_posts")
	.fields(({ f }) => ({
		title: f.text().required(),
	}))
	.options({
		versioning: {
			workflow: {
				stages: ["draft", "published"],
				initialStage: "draft",
			},
		},
	})
	.hooks({
		beforeTransition: (ctx) => {
			hookCalls.before.push({
				fromStage: ctx.fromStage,
				toStage: ctx.toStage,
			});
		},
		afterTransition: (ctx) => {
			hookCalls.after.push({
				fromStage: ctx.fromStage,
				toStage: ctx.toStage,
			});
		},
	});

const blocking_hooks_posts = collection("blocking_hooks_posts")
	.fields(({ f }) => ({
		title: f.text().required(),
	}))
	.options({
		versioning: {
			workflow: {
				stages: ["draft", "published"],
				initialStage: "draft",
			},
		},
	})
	.hooks({
		beforeTransition: () => {
			throw new Error("Transition blocked by hook");
		},
	});

describe("collection transitionStage", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		setup = await buildMockApp({
			collections: {
				workflow_posts,
				guarded_posts,
				no_workflow,
				transition_access_posts,
				hooked_posts,
				blocking_hooks_posts,
			},
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("transitions a record from draft to published", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		const created = await setup.app.collections.workflow_posts.create(
			{ id: crypto.randomUUID(), title: "My Post" },
			ctx,
		);

		const result =
			await setup.app.collections.workflow_posts.transitionStage(
				{ id: created.id, stage: "published" },
				ctx,
			);

		expect(result.id).toBe(created.id);

		// Verify the record is now readable from the published stage
		const published = await setup.app.collections.workflow_posts.findOne(
			{ where: { id: created.id }, stage: "published" },
			ctx,
		);
		expect(published).not.toBeNull();
		expect(published?.title).toBe("My Post");
	});

	it("throws for unknown target stage", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		const created = await setup.app.collections.workflow_posts.create(
			{ id: crypto.randomUUID(), title: "My Post" },
			ctx,
		);

		await expect(
			setup.app.collections.workflow_posts.transitionStage(
				{ id: created.id, stage: "nonexistent" },
				ctx,
			),
		).rejects.toThrow('Unknown workflow stage "nonexistent"');
	});

	it("throws for non-existent record", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		await expect(
			setup.app.collections.workflow_posts.transitionStage(
				{ id: crypto.randomUUID(), stage: "published" },
				ctx,
			),
		).rejects.toThrow("not found");
	});

	it("throws when workflow is not enabled on the collection", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		const created = await setup.app.collections.no_workflow.create(
			{ id: crypto.randomUUID(), title: "No WF" },
			ctx,
		);

		await expect(
			setup.app.collections.no_workflow.transitionStage(
				{ id: created.id, stage: "published" },
				ctx,
			),
		).rejects.toThrow("Workflow is not enabled");
	});

	it("enforces transition guards", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		const created = await setup.app.collections.guarded_posts.create(
			{ id: crypto.randomUUID(), title: "My Post" },
			ctx,
		);

		// draft -> published should fail (must go through review)
		await expect(
			setup.app.collections.guarded_posts.transitionStage(
				{ id: created.id, stage: "published" },
				ctx,
			),
		).rejects.toThrow('Transition from "draft" to "published" is not allowed');

		// draft -> review should succeed
		await setup.app.collections.guarded_posts.transitionStage(
			{ id: created.id, stage: "review" },
			ctx,
		);

		// review -> published should succeed
		await setup.app.collections.guarded_posts.transitionStage(
			{ id: created.id, stage: "published" },
			ctx,
		);

		// published -> draft should fail (published has transitions: [])
		await expect(
			setup.app.collections.guarded_posts.transitionStage(
				{ id: created.id, stage: "draft" },
				ctx,
			),
		).rejects.toThrow('Transition from "published" to "draft" is not allowed');
	});

	it("does not mutate record data during transition", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		const created = await setup.app.collections.workflow_posts.create(
			{ id: crypto.randomUUID(), title: "Original Title" },
			ctx,
		);

		await setup.app.collections.workflow_posts.transitionStage(
			{ id: created.id, stage: "published" },
			ctx,
		);

		// Draft stage should still have the original data
		const draftRow = await setup.app.collections.workflow_posts.findOne(
			{ where: { id: created.id } },
			ctx,
		);
		expect(draftRow?.title).toBe("Original Title");
	});

	it("uses access.transition rule (not access.update) when defined", async () => {
		const systemCtx = createTestContext({ accessMode: "system" });

		const created =
			await setup.app.collections.transition_access_posts.create(
				{ id: crypto.randomUUID(), title: "My Post" },
				systemCtx,
			);

		// Non-admin user should be denied transition (access.transition checks role)
		const nonAdminCtx = createTestContext({
			accessMode: "user",
			role: "editor",
		});
		await expect(
			setup.app.collections.transition_access_posts.transitionStage(
				{ id: created.id, stage: "published" },
				nonAdminCtx,
			),
		).rejects.toThrow("permission");

		// Admin user should succeed
		const adminCtx = createTestContext({
			accessMode: "user",
			role: "admin",
		});
		const result =
			await setup.app.collections.transition_access_posts.transitionStage(
				{ id: created.id, stage: "published" },
				adminCtx,
			);
		expect(result.id).toBe(created.id);
	});

	it("falls back to access.update when access.transition is not defined", async () => {
		// workflow_posts has no access rules at all, so it allows everything for user mode
		// This verifies the fallback chain works
		const ctx = createTestContext({ accessMode: "system" });

		const created = await setup.app.collections.workflow_posts.create(
			{ id: crypto.randomUUID(), title: "Fallback Test" },
			ctx,
		);

		const userCtx = createTestContext({ accessMode: "user", role: "user" });
		const result =
			await setup.app.collections.workflow_posts.transitionStage(
				{ id: created.id, stage: "published" },
				userCtx,
			);
		expect(result.id).toBe(created.id);
	});

	it("fires beforeTransition and afterTransition hooks with correct context", async () => {
		hookCalls.before = [];
		hookCalls.after = [];

		const ctx = createTestContext({ accessMode: "system" });
		const created = await setup.app.collections.hooked_posts.create(
			{ id: crypto.randomUUID(), title: "Hooked" },
			ctx,
		);

		await setup.app.collections.hooked_posts.transitionStage(
			{ id: created.id, stage: "published" },
			ctx,
		);

		expect(hookCalls.before).toHaveLength(1);
		expect(hookCalls.before[0]).toEqual({
			fromStage: "draft",
			toStage: "published",
		});

		expect(hookCalls.after).toHaveLength(1);
		expect(hookCalls.after[0]).toEqual({
			fromStage: "draft",
			toStage: "published",
		});
	});

	it("aborts transition when beforeTransition hook throws", async () => {
		const ctx = createTestContext({ accessMode: "system" });
		const created = await setup.app.collections.blocking_hooks_posts.create(
			{ id: crypto.randomUUID(), title: "Blocked" },
			ctx,
		);

		await expect(
			setup.app.collections.blocking_hooks_posts.transitionStage(
				{ id: created.id, stage: "published" },
				ctx,
			),
		).rejects.toThrow("Transition blocked by hook");
	});

	it("schedules future transitions through the core queue job", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		const created = await setup.app.collections.workflow_posts.create(
			{ id: crypto.randomUUID(), title: "Schedule Test" },
			ctx,
		);

		const futureDate = new Date(Date.now() + 60_000);

		const result = await setup.app.collections.workflow_posts.transitionStage(
			{ id: created.id, stage: "published", scheduledAt: futureDate },
			ctx,
		);

		expect(result.id).toBe(created.id);

		const jobs = setup.app.mocks.queue.getJobsByName("scheduled-transition");
		expect(jobs).toHaveLength(1);
		expect(jobs[0].payload).toEqual({
			type: "collection",
			collection: "workflow_posts",
			recordId: created.id,
			stage: "published",
		});
	});

	it("executes immediately when scheduledAt is in the past", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		const created = await setup.app.collections.workflow_posts.create(
			{ id: crypto.randomUUID(), title: "Past Schedule" },
			ctx,
		);

		const pastDate = new Date(Date.now() - 60_000);

		const result =
			await setup.app.collections.workflow_posts.transitionStage(
				{ id: created.id, stage: "published", scheduledAt: pastDate },
				ctx,
			);

		expect(result.id).toBe(created.id);

		const published = await setup.app.collections.workflow_posts.findOne(
			{ where: { id: created.id }, stage: "published" },
			ctx,
		);
		expect(published).not.toBeNull();
		expect(published?.title).toBe("Past Schedule");
	});
});
