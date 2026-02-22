import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { questpie } from "../../src/server/index.js";
import { scheduledTransitionJob } from "../../src/server/workflow/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const q = questpie({ name: "test-scheduled-transition" }).fields(defaultFields);

const workflow_posts = q
	.collection("workflow_posts")
	.fields((f) => ({
		title: f.text({ required: true }),
	}))
	.options({
		versioning: {
			workflow: {
				stages: ["draft", "published"],
				initialStage: "draft",
			},
		},
	});

const workflow_settings = q
	.global("workflow_settings")
	.fields((f) => ({
		siteName: f.text({ required: true }),
	}))
	.options({
		versioning: {
			workflow: {
				stages: ["draft", "published"],
				initialStage: "draft",
			},
		},
	});

const testModule = q
	.collections({ workflow_posts })
	.globals({ workflow_settings })
	.jobs({ "scheduled-transition": scheduledTransitionJob });

describe("scheduled transitions", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp<typeof testModule>>>;

	beforeEach(async () => {
		setup = await buildMockApp(testModule);
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	describe("collection scheduled transitions", () => {
		it("publishes to queue when scheduledAt is in the future", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			const created = await setup.app.api.collections.workflow_posts.create(
				{ id: crypto.randomUUID(), title: "Schedule Me" },
				ctx,
			);

			const futureDate = new Date(Date.now() + 60_000);

			const result =
				await setup.app.api.collections.workflow_posts.transitionStage(
					{ id: created.id, stage: "published", scheduledAt: futureDate },
					ctx,
				);

			// Should return the existing record unchanged
			expect(result.id).toBe(created.id);
			expect(result.title).toBe("Schedule Me");

			// Verify job was published to the queue
			const jobs = setup.app.mocks.queue.getJobsByName("scheduled-transition");
			expect(jobs.length).toBe(1);
			expect(jobs[0].payload).toEqual({
				type: "collection",
				collection: "workflow_posts",
				recordId: created.id,
				stage: "published",
			});
			expect(jobs[0].options?.startAfter).toEqual(futureDate);
		});

		it("executes immediately when scheduledAt is in the past", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			const created = await setup.app.api.collections.workflow_posts.create(
				{ id: crypto.randomUUID(), title: "Past Schedule" },
				ctx,
			);

			const pastDate = new Date(Date.now() - 60_000);

			await setup.app.api.collections.workflow_posts.transitionStage(
				{ id: created.id, stage: "published", scheduledAt: pastDate },
				ctx,
			);

			// Should have transitioned immediately (no queue job)
			const jobs = setup.app.mocks.queue.getJobsByName("scheduled-transition");
			expect(jobs.length).toBe(0);

			// Verify the record is readable at the published stage
			const published = await setup.app.api.collections.workflow_posts.findOne(
				{ where: { id: created.id }, stage: "published" },
				ctx,
			);
			expect(published).not.toBeNull();
			expect(published?.title).toBe("Past Schedule");
		});

		it("processes scheduled job and executes the transition", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			const created = await setup.app.api.collections.workflow_posts.create(
				{ id: crypto.randomUUID(), title: "Job Execution" },
				ctx,
			);

			const futureDate = new Date(Date.now() + 60_000);

			await setup.app.api.collections.workflow_posts.transitionStage(
				{ id: created.id, stage: "published", scheduledAt: futureDate },
				ctx,
			);

			// Verify record is NOT yet published
			const beforeJob = await setup.app.api.collections.workflow_posts.findOne(
				{ where: { id: created.id }, stage: "published" },
				ctx,
			);
			expect(beforeJob).toBeNull();

			// Process the queued job via the queue client's runOnce
			await (setup.app as any).queue.runOnce();

			// Now the record should be published
			const afterJob = await setup.app.api.collections.workflow_posts.findOne(
				{ where: { id: created.id }, stage: "published" },
				ctx,
			);
			expect(afterJob).not.toBeNull();
			expect(afterJob?.title).toBe("Job Execution");
		});
	});

	describe("global scheduled transitions", () => {
		it("publishes to queue when scheduledAt is in the future", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			// Initialize the global
			await setup.app.api.globals.workflow_settings.update(
				{ siteName: "My Site" },
				ctx,
			);

			const futureDate = new Date(Date.now() + 60_000);

			await setup.app.api.globals.workflow_settings.transitionStage(
				{ stage: "published", scheduledAt: futureDate },
				ctx,
			);

			// Verify job was published to the queue
			const jobs = setup.app.mocks.queue.getJobsByName("scheduled-transition");
			expect(jobs.length).toBe(1);
			expect(jobs[0].payload).toEqual({
				type: "global",
				global: "workflow_settings",
				stage: "published",
			});
			expect(jobs[0].options?.startAfter).toEqual(futureDate);
		});

		it("processes scheduled job for global transitions", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			await setup.app.api.globals.workflow_settings.update(
				{ siteName: "Scheduled Site" },
				ctx,
			);

			const futureDate = new Date(Date.now() + 60_000);

			await setup.app.api.globals.workflow_settings.transitionStage(
				{ stage: "published", scheduledAt: futureDate },
				ctx,
			);

			// Verify not yet published
			const beforeJob = await setup.app.api.globals.workflow_settings.get(
				{ stage: "published" },
				ctx,
			);
			expect(beforeJob?.siteName).not.toBe("Scheduled Site");

			// Process the queued job via the queue client's runOnce
			await (setup.app as any).queue.runOnce();

			// Now should be published
			const afterJob = await setup.app.api.globals.workflow_settings.get(
				{ stage: "published" },
				ctx,
			);
			expect(afterJob?.siteName).toBe("Scheduled Site");
		});
	});

	describe("error handling", () => {
		it("validates stage exists before scheduling", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			const created = await setup.app.api.collections.workflow_posts.create(
				{ id: crypto.randomUUID(), title: "Invalid Stage" },
				ctx,
			);

			// Immediate transition to invalid stage should throw
			await expect(
				setup.app.api.collections.workflow_posts.transitionStage(
					{ id: created.id, stage: "nonexistent" },
					ctx,
				),
			).rejects.toThrow();
		});

		it("does not schedule when transition is immediate (no scheduledAt)", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			const created = await setup.app.api.collections.workflow_posts.create(
				{ id: crypto.randomUUID(), title: "Immediate" },
				ctx,
			);

			await setup.app.api.collections.workflow_posts.transitionStage(
				{ id: created.id, stage: "published" },
				ctx,
			);

			// No queue jobs should exist
			const jobs = setup.app.mocks.queue.getJobsByName("scheduled-transition");
			expect(jobs.length).toBe(0);

			// But transition should have happened immediately
			const published = await setup.app.api.collections.workflow_posts.findOne(
				{ where: { id: created.id }, stage: "published" },
				ctx,
			);
			expect(published).not.toBeNull();
		});
	});
});
