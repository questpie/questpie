/**
 * QUE-250: Behavioral equivalence gate test
 *
 * Verifies that core module global hooks (search + realtime + workflow)
 * produce the same observable results as the direct CRUD integration calls.
 *
 * This is the Phase 2 → Phase 3 gate. Until this passes, CRUD direct
 * calls must NOT be removed.
 *
 * Observable outcomes tested:
 * 1. Realtime: log entries with correct operation/payload
 * 2. Search: queue dispatches via index-records job
 * 3. Bulk operations: correct isBatch/count semantics
 * 4. Workflow: scheduled transitions dispatched via beforeTransition hook
 */
// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";

import {
	collection,
	questpieRealtimeLogTable,
	type RealtimeAdapter,
	type RealtimeChangeEvent,
} from "../../src/exports/index.js";
import { scheduledTransitionJob } from "../../src/server/modules/core/workflow/scheduled-transition.job.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

// ============================================================================
// Mock Realtime Adapter — captures notify calls
// ============================================================================

class MockRealtimeAdapter implements RealtimeAdapter {
	public notices: Array<{
		seq: number;
		resource: string;
		operation: string;
		recordId?: string | null;
	}> = [];

	async start(): Promise<void> {}
	async stop(): Promise<void> {}

	subscribe(handler: (notice: any) => void): () => void {
		return () => {};
	}

	async notify(event: RealtimeChangeEvent): Promise<void> {
		this.notices.push({
			seq: event.seq,
			resource: event.resource,
			operation: event.operation,
			recordId: event.recordId,
		});
	}
}

// ============================================================================
// Test Module
// ============================================================================

const createTestModule = () => ({
	collections: {
		posts: collection("posts").fields(({ f }) => ({
			title: f.textarea().required(),
			status: f.text(50),
		})),
	},
});

// ============================================================================
// Tests
// ============================================================================

describe("Core hooks behavioral equivalence (QUE-250)", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let ctx: ReturnType<typeof createTestContext>;
	let realtimeAdapter: MockRealtimeAdapter;

	beforeEach(async () => {
		realtimeAdapter = new MockRealtimeAdapter();
		setup = await buildMockApp(createTestModule(), {
			realtime: { adapter: realtimeAdapter },
		});
		await runTestDbMigrations(setup.app);
		ctx = createTestContext(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	// ========================================================================
	// Realtime equivalence
	// ========================================================================

	describe("Realtime events", () => {
		it("create emits 'create' event with recordId", async () => {
			const post = await setup.app.collections.posts.create(
				{ title: "Hello", status: "draft" },
				ctx,
			);

			// Check realtime log has create event
			const logs = await setup.app.db
				.select()
				.from(questpieRealtimeLogTable)
				.where(eq(questpieRealtimeLogTable.resource, "posts"));

			const createEvents = logs.filter(
				(l: any) => l.operation === "create",
			);
			expect(createEvents.length).toBeGreaterThanOrEqual(1);

			const event = createEvents[createEvents.length - 1];
			expect(event.resourceType).toBe("collection");
			expect(event.resource).toBe("posts");
			expect(event.operation).toBe("create");
			expect(event.recordId).toBe(post.id);
		});

		it("single update emits 'update' event with recordId", async () => {
			const post = await setup.app.collections.posts.create(
				{ title: "Original" },
				ctx,
			);

			await setup.app.collections.posts.updateById(
				{ id: post.id, data: { title: "Updated" } },
				ctx,
			);

			const logs = await setup.app.db
				.select()
				.from(questpieRealtimeLogTable)
				.where(eq(questpieRealtimeLogTable.resource, "posts"));

			const updateEvents = logs.filter(
				(l: any) => l.operation === "update",
			);
			expect(updateEvents.length).toBeGreaterThanOrEqual(1);

			const event = updateEvents[updateEvents.length - 1];
			expect(event.operation).toBe("update");
			expect(event.recordId).toBe(post.id);
		});

		it("bulk update emits 'bulk_update' with count payload", async () => {
			const a = await setup.app.collections.posts.create(
				{ title: "A" },
				ctx,
			);
			const b = await setup.app.collections.posts.create(
				{ title: "B" },
				ctx,
			);

			await setup.app.collections.posts.update(
				{
					where: { id: { in: [a.id, b.id] } },
					data: { title: "Bulk Updated" },
				},
				ctx,
			);

			const logs = await setup.app.db
				.select()
				.from(questpieRealtimeLogTable)
				.where(eq(questpieRealtimeLogTable.resource, "posts"));

			const bulkEvents = logs.filter(
				(l: any) => l.operation === "bulk_update",
			);
			expect(bulkEvents.length).toBeGreaterThanOrEqual(1);

			const event = bulkEvents[bulkEvents.length - 1];
			expect(event.operation).toBe("bulk_update");
			expect((event.payload as any)?.count).toBe(2);
		});

		it("single delete emits 'delete' event", async () => {
			const post = await setup.app.collections.posts.create(
				{ title: "To Delete" },
				ctx,
			);

			await setup.app.collections.posts.deleteById(
				{ id: post.id },
				ctx,
			);

			const logs = await setup.app.db
				.select()
				.from(questpieRealtimeLogTable)
				.where(eq(questpieRealtimeLogTable.resource, "posts"));

			const deleteEvents = logs.filter(
				(l: any) => l.operation === "delete",
			);
			expect(deleteEvents.length).toBeGreaterThanOrEqual(1);
		});

		it("bulk delete emits 'bulk_delete' with count payload", async () => {
			const a = await setup.app.collections.posts.create(
				{ title: "X" },
				ctx,
			);
			const b = await setup.app.collections.posts.create(
				{ title: "Y" },
				ctx,
			);

			await setup.app.collections.posts.delete(
				{ where: { id: { in: [a.id, b.id] } } },
				ctx,
			);

			const logs = await setup.app.db
				.select()
				.from(questpieRealtimeLogTable)
				.where(eq(questpieRealtimeLogTable.resource, "posts"));

			const bulkDeleteEvents = logs.filter(
				(l: any) => l.operation === "bulk_delete",
			);
			expect(bulkDeleteEvents.length).toBeGreaterThanOrEqual(1);

			const event = bulkDeleteEvents[bulkDeleteEvents.length - 1];
			expect((event.payload as any)?.count).toBe(2);
		});

		it("notify fires after commit (adapter receives notices)", async () => {
			await setup.app.collections.posts.create(
				{ title: "Notify Test" },
				ctx,
			);

			// Adapter should have received at least one notice
			const postNotices = realtimeAdapter.notices.filter(
				(n) => n.resource === "posts",
			);
			expect(postNotices.length).toBeGreaterThanOrEqual(1);
			expect(postNotices[0].operation).toBe("create");
		});
	});

	// ========================================================================
	// Search equivalence
	// ========================================================================

	describe("Search integration", () => {
		it("search service exists and is initialized on app", () => {
			// Search service should be available on the app
			expect(setup.app.search).toBeDefined();
			expect(typeof setup.app.search.index).toBe("function");
			expect(typeof setup.app.search.remove).toBe("function");
			expect(typeof setup.app.search.scheduleIndex).toBe("function");
		});

		it("scheduleIndex returns false when queue has no index-records job (sync fallback)", () => {
			// Without core module's jobs in queue, scheduleIndex should return false
			// (callers fall back to sync indexing)
			const result = setup.app.search.scheduleIndex("posts", "test-id");
			expect(result).toBe(false);
		});

		it("create triggers search indexing (sync fallback path)", async () => {
			// Spy on the search service to track index calls
			const indexCalls: any[] = [];
			const originalIndex = setup.app.search.index.bind(setup.app.search);
			setup.app.search.index = async (params: any) => {
				indexCalls.push(params);
				return originalIndex(params);
			};

			await setup.app.collections.posts.create(
				{ title: "Indexed Post" },
				ctx,
			);

			// Allow onAfterCommit callbacks to run
			await new Promise((r) => setTimeout(r, 100));

			// Search index should have been called at least once for posts
			const postsIndexCalls = indexCalls.filter(
				(c) => c.collection === "posts",
			);
			expect(postsIndexCalls.length).toBeGreaterThanOrEqual(1);
		});

		it("delete triggers search removal", async () => {
			const removeCalls: any[] = [];
			const originalRemove = setup.app.search.remove.bind(setup.app.search);
			setup.app.search.remove = async (params: any) => {
				removeCalls.push(params);
				return originalRemove(params);
			};

			const post = await setup.app.collections.posts.create(
				{ title: "To Remove" },
				ctx,
			);

			await setup.app.collections.posts.deleteById(
				{ id: post.id },
				ctx,
			);

			await new Promise((r) => setTimeout(r, 100));

			const postsRemoveCalls = removeCalls.filter(
				(c) => c.collection === "posts",
			);
			expect(postsRemoveCalls.length).toBeGreaterThanOrEqual(1);
		});
	});

	// ========================================================================
	// Combined flow
	// ========================================================================

	describe("End-to-end CRUD flow", () => {
		it("full lifecycle: create → update → delete produces correct event sequence", async () => {
			// Create
			const post = await setup.app.collections.posts.create(
				{ title: "Lifecycle Test", status: "draft" },
				ctx,
			);

			// Update
			await setup.app.collections.posts.updateById(
				{ id: post.id, data: { status: "published" } },
				ctx,
			);

			// Delete
			await setup.app.collections.posts.deleteById(
				{ id: post.id },
				ctx,
			);

			// Verify realtime log has correct sequence
			const logs = await setup.app.db
				.select()
				.from(questpieRealtimeLogTable)
				.where(eq(questpieRealtimeLogTable.resource, "posts"));

			const operations = logs.map((l: any) => l.operation);
			// Should have at least create → update → delete in order
			expect(operations).toContain("create");
			expect(operations).toContain("update");
			expect(operations).toContain("delete");

			// Create should come before update, update before delete
			const createIdx = operations.indexOf("create");
			const updateIdx = operations.indexOf("update");
			const deleteIdx = operations.indexOf("delete");
			expect(createIdx).toBeLessThan(updateIdx);
			expect(updateIdx).toBeLessThan(deleteIdx);
		});
	});
});

// ============================================================================
// Workflow / Scheduled Transition Equivalence (QUE-250)
// ============================================================================

describe("Workflow scheduled-transition equivalence (QUE-250)", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let ctx: ReturnType<typeof createTestContext>;

	const createWorkflowModule = () => ({
		collections: {
			articles: collection("articles")
				.fields(({ f }) => ({
					title: f.textarea().required(),
				}))
				.options({
					versioning: {
						workflow: {
							stages: ["draft", "published"],
							initialStage: "draft",
						},
					},
				}),
			// Collection without workflow — should never schedule
			notes: collection("notes").fields(({ f }) => ({
				body: f.textarea().required(),
			})),
		},
		jobs: {
			"scheduled-transition": scheduledTransitionJob,
		},
	});

	beforeEach(async () => {
		setup = await buildMockApp(createWorkflowModule());
		await runTestDbMigrations(setup.app);
		ctx = createTestContext(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("beforeTransition hook dispatches to queue when scheduledAt is future", async () => {
		const article = await setup.app.collections.articles.create(
			{ title: "Schedule Test" },
			ctx,
		);

		const futureDate = new Date(Date.now() + 60_000);

		const result = await setup.app.collections.articles.transitionStage(
			{ id: article.id, stage: "published", scheduledAt: futureDate },
			ctx,
		);

		// Should return the existing record unchanged
		expect(result.id).toBe(article.id);
		expect(result.title).toBe("Schedule Test");

		// Verify job was published to the queue
		const jobs = setup.app.mocks.queue.getJobsByName("scheduled-transition");
		expect(jobs.length).toBe(1);
		expect(jobs[0].payload).toEqual({
			type: "collection",
			collection: "articles",
			recordId: article.id,
			stage: "published",
		});
		expect(jobs[0].options?.startAfter).toEqual(futureDate);
	});

	it("no scheduling happens for collections without workflow config", async () => {
		// The notes collection has no workflow — transitionStage should throw
		const note = await setup.app.collections.notes.create(
			{ body: "No workflow here" },
			ctx,
		);

		await expect(
			setup.app.collections.notes.transitionStage(
				{ id: note.id, stage: "published" },
				ctx,
			),
		).rejects.toThrow(/[Ww]orkflow is not enabled/);

		// No queue jobs
		const jobs = setup.app.mocks.queue.getJobsByName("scheduled-transition");
		expect(jobs.length).toBe(0);
	});

	it("immediate transition does not dispatch to queue", async () => {
		const article = await setup.app.collections.articles.create(
			{ title: "Immediate" },
			ctx,
		);

		await setup.app.collections.articles.transitionStage(
			{ id: article.id, stage: "published" },
			ctx,
		);

		// No queue jobs — transition happened immediately
		const jobs = setup.app.mocks.queue.getJobsByName("scheduled-transition");
		expect(jobs.length).toBe(0);

		// Verify the transition actually happened
		const published = await setup.app.collections.articles.findOne(
			{ where: { id: article.id }, stage: "published" },
			ctx,
		);
		expect(published).not.toBeNull();
		expect(published?.title).toBe("Immediate");
	});

	it("past scheduledAt executes transition immediately (no queue)", async () => {
		const article = await setup.app.collections.articles.create(
			{ title: "Past Schedule" },
			ctx,
		);

		const pastDate = new Date(Date.now() - 60_000);

		await setup.app.collections.articles.transitionStage(
			{ id: article.id, stage: "published", scheduledAt: pastDate },
			ctx,
		);

		// No queue jobs — past date should execute immediately
		const jobs = setup.app.mocks.queue.getJobsByName("scheduled-transition");
		expect(jobs.length).toBe(0);

		// Verify the transition actually happened
		const published = await setup.app.collections.articles.findOne(
			{ where: { id: article.id }, stage: "published" },
			ctx,
		);
		expect(published).not.toBeNull();
	});

	it("scheduled job executes the transition when processed", async () => {
		const article = await setup.app.collections.articles.create(
			{ title: "Deferred Publish" },
			ctx,
		);

		const futureDate = new Date(Date.now() + 60_000);

		await setup.app.collections.articles.transitionStage(
			{ id: article.id, stage: "published", scheduledAt: futureDate },
			ctx,
		);

		// Not yet published
		const beforeJob = await setup.app.collections.articles.findOne(
			{ where: { id: article.id }, stage: "published" },
			ctx,
		);
		expect(beforeJob).toBeNull();

		// Process the queued job
		await (setup.app as any).queue.runOnce();

		// Now published
		const afterJob = await setup.app.collections.articles.findOne(
			{ where: { id: article.id }, stage: "published" },
			ctx,
		);
		expect(afterJob).not.toBeNull();
		expect(afterJob?.title).toBe("Deferred Publish");
	});
});
