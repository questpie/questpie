import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { questpie } from "../../src/exports/index.js";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const q = questpie({ name: "test-module" }).fields(defaultFields);

const testModule = q.collections({
	posts: q
		.collection("posts")
		.fields((f) => ({
			title: f.textarea({ required: true }),
			slug: f.text({ required: true, maxLength: 255 }),
			status: f.text({ maxLength: 50 }),
			viewCount: f.number(),
			isFeatured: f.boolean(),
			publishedAt: f.datetime(),
		}))
		.options({
			timestamps: true,
			softDelete: true,
		}),
});

describe("collection query operations", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp<typeof testModule>>>;
	let testPosts: any[];

	beforeEach(async () => {
		setup = await buildMockApp(testModule);
		await runTestDbMigrations(setup.cms);

		// Seed test data
		const ctx = createTestContext();

		testPosts = await Promise.all([
			setup.cms.api.collections.posts.create(
				{
					id: crypto.randomUUID(),
					title: "First Post",
					slug: "first-post",
					status: "published",
					viewCount: 100,
					isFeatured: true,
					publishedAt: new Date("2024-01-01"),
				},
				ctx,
			),
			setup.cms.api.collections.posts.create(
				{
					id: crypto.randomUUID(),
					title: "Second Post",
					slug: "second-post",
					status: "published",
					viewCount: 50,
					isFeatured: false,
					publishedAt: new Date("2024-01-02"),
				},
				ctx,
			),
			setup.cms.api.collections.posts.create(
				{
					id: crypto.randomUUID(),
					title: "Draft Post",
					slug: "draft-post",
					status: "draft",
					viewCount: 0,
					isFeatured: false,
					publishedAt: null,
				},
				ctx,
			),
			setup.cms.api.collections.posts.create(
				{
					id: crypto.randomUUID(),
					title: "Popular Post",
					slug: "popular-post",
					status: "published",
					viewCount: 500,
					isFeatured: true,
					publishedAt: new Date("2024-01-03"),
				},
				ctx,
			),
			setup.cms.api.collections.posts.create(
				{
					id: crypto.randomUUID(),
					title: "Old Post",
					slug: "old-post",
					status: "archived",
					viewCount: 10,
					isFeatured: false,
					publishedAt: new Date("2023-01-01"),
				},
				ctx,
			),
			setup.cms.api.collections.posts.create(
				{
					id: crypto.randomUUID(),
					title: "Archived Post",
					slug: "archived-post",
					status: "archived",
					viewCount: 25,
					isFeatured: false,
					publishedAt: new Date("2023-12-15"),
				},
				ctx,
			),
		]);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	describe("basic queries", () => {
		it("finds all posts", async () => {
			const ctx = createTestContext();

			const result = await setup.cms.api.collections.posts.find({}, ctx);
			expect(result.docs.length).toBe(6); // 6 posts seeded
			expect(result.totalDocs).toBe(6);
			expect(result.limit).toBeGreaterThanOrEqual(result.docs.length);
			expect(result.totalPages).toBe(1);
		});

		it("finds post by ID", async () => {
			const _ctx = createTestContext();

			const post = await setup.cms.api.collections.posts.findOne(
				{ where: { id: testPosts[0].id } },
				_ctx,
			);
			expect(post?.title).toBe("First Post");
		});

		it("returns null when post not found", async () => {
			const _ctx = createTestContext();

			const post = await setup.cms.api.collections.posts.findOne(
				{ where: { id: crypto.randomUUID() } },
				_ctx,
			);
			expect(post).toBeNull();
		});
	});

	describe("filtering", () => {
		it("filters by string equality", async () => {
			const ctx = createTestContext();

			const result = await setup.cms.api.collections.posts.find(
				{ where: { status: "published" } },
				ctx,
			);
			expect(result.docs.length).toBe(3);
			expect(result.totalDocs).toBe(3);
			expect(result.docs.every((p: any) => p.status === "published")).toBe(
				true,
			);
		});

		it("filters by boolean value", async () => {
			const ctx = createTestContext();

			const result = await setup.cms.api.collections.posts.find(
				{ where: { isFeatured: true } },
				ctx,
			);
			expect(result.docs.length).toBe(2);
			expect(result.docs.every((p: any) => p.isFeatured === true)).toBe(true);
		});

		it("filters by number equality", async () => {
			const ctx = createTestContext();

			const result = await setup.cms.api.collections.posts.find(
				{ where: { viewCount: 100 } },
				ctx,
			);
			expect(result.docs.length).toBe(1);
			expect(result.docs[0].title).toBe("First Post");
		});

		it("filters by null value", async () => {
			const ctx = createTestContext();

			const result = await setup.cms.api.collections.posts.find(
				{ where: { publishedAt: { isNull: true } } },
				ctx,
			);
			expect(result.docs.length).toBe(1);
			expect(result.docs[0].status).toBe("draft");
		});

		it("combines multiple filters (AND)", async () => {
			const ctx = createTestContext();

			const result = await setup.cms.api.collections.posts.find(
				{
					where: {
						status: "published",
						isFeatured: true,
					},
				},
				ctx,
			);
			expect(result.docs.length).toBe(2);
			expect(
				result.docs.every((p: any) => p.status === "published" && p.isFeatured),
			).toBe(true);
		});
	});

	describe("pagination", () => {
		it("limits results", async () => {
			const ctx = createTestContext();

			const result = await setup.cms.api.collections.posts.find(
				{ limit: 2 },
				ctx,
			);
			expect(result.docs.length).toBe(2);
			expect(result.limit).toBe(2);
			expect(result.totalDocs).toBe(6);
			expect(result.totalPages).toBe(3);
		});

		it("offsets results", async () => {
			const ctx = createTestContext();

			const page1 = await setup.cms.api.collections.posts.find(
				{ limit: 2, offset: 0 },
				ctx,
			);
			const page2 = await setup.cms.api.collections.posts.find(
				{ limit: 2, offset: 2 },
				ctx,
			);

			expect(page1.docs.length).toBe(2);
			expect(page2.docs.length).toBe(2);
			expect(page1.docs[0].id).not.toBe(page2.docs[0].id);

			expect(page1.page).toBe(1);
			expect(page2.page).toBe(2);
			expect(page1.hasNextPage).toBe(true);
			expect(page1.nextPage).toBe(2);
		});

		it("handles offset beyond dataset", async () => {
			const ctx = createTestContext();

			const result = await setup.cms.api.collections.posts.find(
				{ limit: 10, offset: 100 },
				ctx,
			);
			expect(result.docs.length).toBe(0);
			expect(result.page).toBe(11); // offset 100, limit 10 -> page 11
		});

		it("paginates with filter", async () => {
			const ctx = createTestContext();

			const result = await setup.cms.api.collections.posts.find(
				{
					where: { status: "published" },
					limit: 2,
					offset: 0,
				},
				ctx,
			);

			expect(result.docs.length).toBe(2);
			expect(result.totalDocs).toBe(3);
			expect(result.totalPages).toBe(2);
			expect(result.docs.every((p: any) => p.status === "published")).toBe(
				true,
			);
		});
	});

	describe("sorting", () => {
		it("sorts by single field ascending", async () => {
			const ctx = createTestContext();

			const result = await setup.cms.api.collections.posts.find(
				{ orderBy: { viewCount: "asc" } },
				ctx,
			);
			const posts = result.docs;

			expect(posts[0].viewCount).toBeLessThanOrEqual(posts[1].viewCount!);
			expect(posts[1].viewCount).toBeLessThanOrEqual(posts[2].viewCount!);
		});

		it("sorts by single field descending", async () => {
			const ctx = createTestContext();

			const result = await setup.cms.api.collections.posts.find(
				{ orderBy: { viewCount: "desc" } },
				ctx,
			);
			const posts = result.docs;

			expect(posts[0].viewCount).toBeGreaterThanOrEqual(posts[1].viewCount!);
			expect(posts[0].title).toBe("Popular Post"); // highest view count
		});

		it("sorts by date field", async () => {
			const ctx = createTestContext();

			const result = await setup.cms.api.collections.posts.find(
				{
					where: { publishedAt: { isNotNull: true } },
					orderBy: { publishedAt: "desc" },
				},
				ctx,
			);
			const posts = result.docs;

			expect(posts[0].title).toBe("Popular Post"); // 2024-01-03
			expect(posts[posts.length - 1].title).toBe("Old Post"); // 2023-01-01
		});

		it("sorts by text field alphabetically", async () => {
			const ctx = createTestContext();

			const result = await setup.cms.api.collections.posts.find(
				{ orderBy: { title: "asc" } },
				ctx,
			);
			const posts = result.docs;

			const titles = posts.map((p: any) => p.title);
			const sortedTitles = [...titles].sort();
			expect(titles).toEqual(sortedTitles);
		});

		it("combines sorting with filtering and pagination", async () => {
			const ctx = createTestContext();

			const result = await setup.cms.api.collections.posts.find(
				{
					where: { status: "published" },
					orderBy: { viewCount: "desc" },
					limit: 2,
				},
				ctx,
			);
			const posts = result.docs;

			expect(posts.length).toBe(2);
			expect(posts[0].title).toBe("Popular Post"); // 500 views
			expect(posts[1].title).toBe("First Post"); // 100 views
		});
	});

	describe("counting", () => {
		it("counts all records", async () => {
			const ctx = createTestContext();

			const count = await setup.cms.api.collections.posts.count({}, ctx);
			expect(count).toBe(6);
		});

		it("counts with filter", async () => {
			const ctx = createTestContext();

			const count = await setup.cms.api.collections.posts.count(
				{ where: { status: "published" } },
				ctx,
			);
			expect(count).toBe(3);
		});

		it("counts featured posts", async () => {
			const ctx = createTestContext();

			const count = await setup.cms.api.collections.posts.count(
				{ where: { isFeatured: true } },
				ctx,
			);
			expect(count).toBe(2);
		});

		it("returns zero for no matches", async () => {
			const ctx = createTestContext();

			const count = await setup.cms.api.collections.posts.count(
				{ where: { status: "nonexistent" } },
				ctx,
			);
			expect(count).toBe(0);
		});
	});

	describe("soft delete filtering", () => {
		it("excludes soft-deleted posts by default", async () => {
			const ctx = createTestContext();

			// Soft delete a post
			await setup.cms.api.collections.posts.deleteById(
				{ id: testPosts[0].id },
				ctx,
			);

			const result = await setup.cms.api.collections.posts.find({}, ctx);
			const posts = result.docs;
			expect(posts.length).toBe(5);
			expect(posts.find((p: any) => p.id === testPosts[0].id)).toBeUndefined();
		});

		it("counts exclude soft-deleted posts", async () => {
			const ctx = createTestContext();

			// Soft delete a post
			await setup.cms.api.collections.posts.deleteById(
				{ id: testPosts[0].id },
				ctx,
			);

			const count = await setup.cms.api.collections.posts.count({}, ctx);
			expect(count).toBe(5);
		});

		it("finds soft-deleted post by ID returns null", async () => {
			const ctx = createTestContext();

			await setup.cms.api.collections.posts.deleteById(
				{ id: testPosts[0].id },
				ctx,
			);

			const post = await setup.cms.api.collections.posts.findOne(
				{ where: { id: testPosts[0].id } },
				ctx,
			);
			expect(post).toBeNull();
		});

		it("includeDeleted returns soft-deleted posts", async () => {
			const ctx = createTestContext();

			await setup.cms.api.collections.posts.deleteById(
				{ id: testPosts[0].id },
				ctx,
			);

			const result = await setup.cms.api.collections.posts.find(
				{ includeDeleted: true },
				ctx,
			);
			const posts = result.docs;
			expect(posts.length).toBe(6);
			expect(posts.find((p: any) => p.id === testPosts[0].id)).toBeDefined();

			const count = await setup.cms.api.collections.posts.count(
				{ includeDeleted: true },
				ctx,
			);
			expect(count).toBe(6);
		});

		it("restores soft-deleted post", async () => {
			const ctx = createTestContext();

			await setup.cms.api.collections.posts.deleteById(
				{ id: testPosts[0].id },
				ctx,
			);

			const restored = await setup.cms.api.collections.posts.restoreById(
				{ id: testPosts[0].id },
				ctx,
			);
			expect(restored.id).toBe(testPosts[0].id);

			const post = await setup.cms.api.collections.posts.findOne(
				{ where: { id: testPosts[0].id } },
				ctx,
			);
			expect(post).not.toBeNull();
		});
	});

	describe("field selection", () => {
		it("selects specific fields only (inclusion mode)", async () => {
			const ctx = createTestContext();

			const result = await setup.cms.api.collections.posts.find(
				{
					columns: { id: true, title: true },
				},
				ctx,
			);
			const posts = result.docs;

			expect(posts[0]).toHaveProperty("id");
			expect(posts[0]).toHaveProperty("title");
			expect(posts[0]).not.toHaveProperty("viewCount");
		});

		it("omits specific fields (omission mode)", async () => {
			const ctx = createTestContext();

			const result = await setup.cms.api.collections.posts.find(
				{
					columns: { viewCount: false, isFeatured: false },
				},
				ctx,
			);
			const posts = result.docs;

			expect(posts[0]).toHaveProperty("id");
			expect(posts[0]).toHaveProperty("title");
			expect(posts[0]).toHaveProperty("slug");
			expect(posts[0]).toHaveProperty("status");
			expect(posts[0]).not.toHaveProperty("viewCount");
			expect(posts[0]).not.toHaveProperty("isFeatured");
		});

		it("selects all fields when columns is not specified", async () => {
			const ctx = createTestContext();

			const result = await setup.cms.api.collections.posts.find({}, ctx);
			const posts = result.docs;

			expect(posts[0]).toHaveProperty("id");
			expect(posts[0]).toHaveProperty("title");
			expect(posts[0]).toHaveProperty("viewCount");
			expect(posts[0]).toHaveProperty("status");
		});
	});

	describe("complex queries", () => {
		it("finds posts with multiple conditions, sorting, and pagination", async () => {
			const ctx = createTestContext();

			const result = await setup.cms.api.collections.posts.find(
				{
					where: {
						status: "published",
						viewCount: { gte: 50 },
					},
					orderBy: { publishedAt: "desc" },
					limit: 2,
					offset: 0,
				},
				ctx,
			);
			const posts = result.docs;

			expect(posts.length).toBe(2);
			expect(posts.every((p: any) => p.status === "published")).toBe(true);
			expect(posts.every((p: any) => p.viewCount >= 50)).toBe(true);
		});

		it("finds featured posts sorted by popularity", async () => {
			const ctx = createTestContext();

			const result = await setup.cms.api.collections.posts.find(
				{
					where: { isFeatured: true },
					orderBy: { viewCount: "desc" },
				},
				ctx,
			);
			const posts = result.docs;

			expect(posts.length).toBe(2);
			expect(posts[0].title).toBe("Popular Post");
			expect(posts[1].title).toBe("First Post");
		});

		it("handles empty result set gracefully", async () => {
			const ctx = createTestContext();

			const result = await setup.cms.api.collections.posts.find(
				{
					where: {
						status: "published",
						viewCount: 999999,
					},
				},
				ctx,
			);

			expect(result.docs).toEqual([]);
		});
	});

	describe("comparison operators", () => {
		it("filters with greater than", async () => {
			const ctx = createTestContext();

			const result = await setup.cms.api.collections.posts.find(
				{ where: { viewCount: { gt: 50 } } },
				ctx,
			);
			const posts = result.docs;

			expect(posts.length).toBe(2); // 100 and 500
			expect(posts.every((p: any) => p.viewCount > 50)).toBe(true);
		});

		it("filters with greater than or equal", async () => {
			const ctx = createTestContext();

			const result = await setup.cms.api.collections.posts.find(
				{ where: { viewCount: { gte: 50 } } },
				ctx,
			);
			const posts = result.docs;

			expect(posts.length).toBe(3); // 50, 100, 500
			expect(posts.every((p: any) => p.viewCount >= 50)).toBe(true);
		});

		it("filters with less than", async () => {
			const ctx = createTestContext();

			const result = await setup.cms.api.collections.posts.find(
				{ where: { viewCount: { lt: 50 } } },
				ctx,
			);
			const posts = result.docs;

			expect(posts.length).toBe(3); // 0, 10, 25
			expect(posts.every((p: any) => p.viewCount < 50)).toBe(true);
		});

		it("filters with less than or equal", async () => {
			const ctx = createTestContext();

			const result = await setup.cms.api.collections.posts.find(
				{ where: { viewCount: { lte: 50 } } },
				ctx,
			);
			const posts = result.docs;

			expect(posts.length).toBe(4); // 0, 10, 25, 50
			expect(posts.every((p: any) => p.viewCount <= 50)).toBe(true);
		});

		it("filters with not equal", async () => {
			const ctx = createTestContext();

			const result = await setup.cms.api.collections.posts.find(
				{ where: { status: { ne: "draft" } } },
				ctx,
			);
			const posts = result.docs;

			expect(posts.length).toBe(5);
			expect(posts.every((p: any) => p.status !== "draft")).toBe(true);
		});
	});

	describe("batch operations", () => {
		it("updates multiple records matching filter", async () => {
			const ctx = createTestContext();

			await setup.cms.api.collections.posts.update(
				{
					where: { status: "published" },
					data: { isFeatured: true },
				},
				ctx,
			);

			const result = await setup.cms.api.collections.posts.find(
				{ where: { status: "published" } },
				ctx,
			);
			const posts = result.docs;
			expect(posts.every((p: any) => p.isFeatured === true)).toBe(true);
		});

		it("deletes multiple records matching filter", async () => {
			const ctx = createTestContext();

			await setup.cms.api.collections.posts.delete(
				{ where: { status: "draft" } },
				ctx,
			);

			const result = await setup.cms.api.collections.posts.find({}, ctx);
			const remaining = result.docs;
			expect(remaining.every((p: any) => p.status !== "draft")).toBe(true);
		});
	});
});
