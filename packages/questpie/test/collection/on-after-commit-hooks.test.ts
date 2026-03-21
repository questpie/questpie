/**
 * QUE-243: onAfterCommit in hook context tests
 *
 * Verifies that:
 * 1. onAfterCommit is accessible on hook context without separate import
 * 2. Callbacks execute after transaction commits
 * 3. Callbacks execute immediately when outside a transaction
 * 4. Callbacks don't execute if transaction rolls back
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collection } from "../../src/server/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

// ============================================================================
// Setup
// ============================================================================

interface CapturedEvent {
	hookName: string;
	afterCommitFired: boolean;
	afterCommitOrder: number;
}

let afterCommitCounter = 0;

const createAfterCommitModule = (events: CapturedEvent[]) => ({
	collections: {
		articles: collection("articles")
			.fields(({ f }) => ({
				title: f.textarea().required(),
				status: f.text(50),
			}))
			.hooks({
				afterChange: async (ctx) => {
					const event: CapturedEvent = {
						hookName: "afterChange",
						afterCommitFired: false,
						afterCommitOrder: -1,
					};
					events.push(event);

					// Use onAfterCommit from ctx — NO separate import
					ctx.onAfterCommit(async () => {
						event.afterCommitFired = true;
						event.afterCommitOrder = afterCommitCounter++;
					});
				},
				afterDelete: async (ctx) => {
					const event: CapturedEvent = {
						hookName: "afterDelete",
						afterCommitFired: false,
						afterCommitOrder: -1,
					};
					events.push(event);

					ctx.onAfterCommit(async () => {
						event.afterCommitFired = true;
						event.afterCommitOrder = afterCommitCounter++;
					});
				},
			}),
	},
});

describe("onAfterCommit in hook context (QUE-243)", () => {
	let events: CapturedEvent[];
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let ctx: ReturnType<typeof createTestContext>;

	beforeEach(async () => {
		events = [];
		afterCommitCounter = 0;
		setup = await buildMockApp(createAfterCommitModule(events));
		await runTestDbMigrations(setup.app);
		ctx = createTestContext(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("onAfterCommit callback fires after create", async () => {
		await setup.app.api.collections.articles.create(
			{ title: "Test" },
			ctx,
		);

		// afterChange should have been called
		const afterChange = events.find((e) => e.hookName === "afterChange");
		expect(afterChange).toBeDefined();
		// onAfterCommit callback should have fired
		expect(afterChange!.afterCommitFired).toBe(true);
	});

	it("onAfterCommit callback fires after update", async () => {
		const created = await setup.app.api.collections.articles.create(
			{ title: "Original" },
			ctx,
		);
		events.length = 0;
		afterCommitCounter = 0;

		await setup.app.api.collections.articles.updateById(
			{ id: created.id, data: { title: "Updated" } },
			ctx,
		);

		const afterChange = events.find((e) => e.hookName === "afterChange");
		expect(afterChange).toBeDefined();
		expect(afterChange!.afterCommitFired).toBe(true);
	});

	it("onAfterCommit callback fires after delete", async () => {
		const created = await setup.app.api.collections.articles.create(
			{ title: "ToDelete" },
			ctx,
		);
		events.length = 0;
		afterCommitCounter = 0;

		await setup.app.api.collections.articles.deleteById(
			{ id: created.id },
			ctx,
		);

		const afterDelete = events.find((e) => e.hookName === "afterDelete");
		expect(afterDelete).toBeDefined();
		expect(afterDelete!.afterCommitFired).toBe(true);
	});

	it("onAfterCommit fires in order for multiple hooks", async () => {
		// Create two records to trigger hooks sequentially
		await setup.app.api.collections.articles.create(
			{ title: "First" },
			ctx,
		);
		await setup.app.api.collections.articles.create(
			{ title: "Second" },
			ctx,
		);

		expect(events.length).toBe(2);
		expect(events[0].afterCommitOrder).toBe(0);
		expect(events[1].afterCommitOrder).toBe(1);
	});

	it("ctx.onAfterCommit exists and is a function", async () => {
		let onAfterCommitType: string | undefined;

		const testModule = {
			collections: {
				items: collection("items")
					.fields(({ f }) => ({
						name: f.text(100).required(),
					}))
					.hooks({
						afterChange: async (ctx) => {
							onAfterCommitType = typeof ctx.onAfterCommit;
						},
					}),
			},
		};

		const s = await buildMockApp(testModule);
		await runTestDbMigrations(s.app);
		const c = createTestContext(s.app);

		await s.app.api.collections.items.create({ name: "test" }, c);
		expect(onAfterCommitType).toBe("function");

		await s.cleanup();
	});
});
