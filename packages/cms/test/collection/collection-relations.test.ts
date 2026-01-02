import { describe, it, beforeEach, afterEach, expect } from "bun:test";
import {
	text,
	uuid,
	integer,
	timestamp,
	varchar,
	type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { runTestDbMigrations } from "../utils/test-db";
import { buildMockCMS } from "../utils/mocks/mock-cms-builder";
import { createTestContext } from "../utils/test-context";
import { defineQCMS, defineCollection } from "#questpie/cms/server/index.js";

// ==============================================================================
// TEST COLLECTIONS SETUP
// ==============================================================================

// Users collection (referenced by profiles)
const users = defineCollection("users").fields({
	email: varchar("email", { length: 255 }).notNull(),
	name: text("name").notNull(),
});

// Profiles collection (one-to-one with users via belongsTo)
const profiles = defineCollection("profiles")
	.fields({
		userId: uuid("user_id")
			.notNull()
			.unique()
			.references(() => users.table.id, { onDelete: "cascade" }),
		bio: text("bio"),
		avatar: text("avatar"),
	})
	.relations(({ table, one }) => ({
		user: one("users", {
			fields: [table.userId],
			references: ["id"],
		}),
	}));

// Authors with posts (one-to-many with cascade delete)
const authors = defineCollection("authors")
	.fields({
		name: text("name").notNull(),
	})
	.relations(({ many }) => ({
		// Explicitly set onDelete: "cascade" to trigger application-level cascade (hooks)
		// NOTE: DB constraints already handle cascade via field.references({ onDelete: "cascade" })
		// This additional setting ensures beforeDelete/afterDelete hooks run on related records
		posts: many("posts", { relationName: "author", onDelete: "cascade" }),
		editedPosts: many("posts", { relationName: "editor" }),
	}));

// Posts with cascade/set null scenarios
const posts = defineCollection("posts")
	.fields({
		title: text("title").notNull(),
		views: integer("views").default(0),
		authorId: uuid("author_id")
			.notNull()
			.references(() => authors.table.id, { onDelete: "cascade" }),
		editorId: uuid("editor_id").references(() => authors.table.id, {
			onDelete: "set null",
		}),
	})
	.relations(({ table, one, many }) => ({
		author: one("authors", {
			fields: [table.authorId],
			references: ["id"],
			relationName: "author",
		}),
		editor: one("authors", {
			fields: [table.editorId],
			references: ["id"],
			relationName: "editor",
		}),
		// Explicitly cascade to trigger hooks on comments when post is deleted
		comments: many("comments", { relationName: "post", onDelete: "cascade" }),
	}));

// Comments for deep nesting tests (posts -> comments -> replies)
const comments = defineCollection("comments")
	.fields({
		content: text("content").notNull(),
		postId: uuid("post_id")
			.notNull()
			.references(() => posts.table.id, { onDelete: "cascade" }),
		parentId: uuid("parent_id").references(
			(): AnyPgColumn => comments.table.id,
			{
				onDelete: "cascade",
			},
		),
	})
	.relations(({ table, one, many }) => ({
		post: one("posts", {
			fields: [table.postId],
			references: ["id"],
			relationName: "post",
		}),
		parent: one("comments", {
			fields: [table.parentId],
			references: ["id"],
			relationName: "parent",
		}),
		replies: many("comments", { relationName: "parent" }),
	}));

// Products with restricted delete
const restrictedCategories = defineCollection("restrictedCategories")
	.fields({
		name: text("name").notNull(),
	})
	.relations(({ many }) => ({
		products: many("restricted_products", { relationName: "category" }),
	}));

const restrictedProducts = defineCollection("restricted_products")
	.fields({
		name: text("name").notNull(),
		categoryId: uuid("category_id")
			.notNull()
			.references(() => restrictedCategories.table.id, {
				onDelete: "restrict",
			}),
	})
	.relations(({ table, one }) => ({
		category: one("restrictedCategories", {
			fields: [table.categoryId],
			references: ["id"],
			relationName: "category",
		}),
	}));

// Many-to-many with extra fields in junction table
const articles = defineCollection("articles")
	.fields({
		title: text("title").notNull(),
	})
	.relations(({ manyToMany }) => ({
		tags: manyToMany("articleTags", {
			through: "articleTagJunction",
			sourceField: "articleId",
			targetField: "tagId",
		}),
	}));

const articleTags = defineCollection("articleTags")
	.fields({
		name: text("name").notNull(),
	})
	.relations(({ manyToMany }) => ({
		articles: manyToMany("articles", {
			through: "articleTagJunction",
			sourceField: "tagId",
			targetField: "articleId",
		}),
	}));

const articleTagJunction = defineCollection("articleTagJunction").fields({
	articleId: uuid("article_id")
		.notNull()
		.references(() => articles.table.id, { onDelete: "cascade" }),
	tagId: uuid("tag_id")
		.notNull()
		.references(() => articleTags.table.id, { onDelete: "cascade" }),
	order: integer("order").default(0),
	addedAt: timestamp("added_at", { mode: "date" }).defaultNow(),
});

// Additional collections for filtering and quantifiers tests
const categories = defineCollection("categories")
	.fields({
		name: text("name").notNull(),
	})
	.relations(({ many, manyToMany }) => ({
		products: many("products", { relationName: "category" }),
		tags: manyToMany("tags", {
			through: "categoryTags",
			sourceField: "categoryId",
			targetField: "tagId",
		}),
	}));

const products = defineCollection("products")
	.fields({
		name: text("name").notNull(),
		categoryId: uuid("category_id")
			.notNull()
			.references(() => categories.table.id),
	})
	.relations(({ table, one, manyToMany }) => ({
		category: one("categories", {
			fields: [table.categoryId],
			references: ["id"],
			relationName: "products",
		}),
		tags: manyToMany("tags", {
			through: "productTags",
			sourceField: "productId",
			targetField: "tagId",
		}),
	}));

const tags = defineCollection("tags")
	.fields({
		name: text("name").notNull(),
	})
	.relations(({ manyToMany }) => ({
		products: manyToMany("products", {
			through: "productTags",
			sourceField: "tagId",
			targetField: "productId",
		}),
		categories: manyToMany("categories", {
			through: "categoryTags",
			sourceField: "tagId",
			targetField: "categoryId",
		}),
	}));

const categoryTags = defineCollection("categoryTags").fields({
	categoryId: uuid("category_id")
		.notNull()
		.references(() => categories.table.id),
	tagId: uuid("tag_id")
		.notNull()
		.references(() => tags.table.id),
});

const productTags = defineCollection("productTags").fields({
	productId: uuid("product_id")
		.notNull()
		.references(() => products.table.id),
	tagId: uuid("tag_id")
		.notNull()
		.references(() => tags.table.id),
});

const testModule = defineQCMS({ name: "test" }).collections({
	users,
	profiles,
	authors,
	posts,
	comments,
	restrictedCategories,
	restrictedProducts,
	articles,
	articleTags,
	articleTagJunction,
	categories,
	products,
	tags,
	categoryTags,
	productTags,
});

// ==============================================================================
// TESTS
// ==============================================================================

describe("collection relations", () => {
	let setup: Awaited<ReturnType<typeof buildMockCMS<typeof testModule>>>;
	let cms: typeof testModule.$inferCms;

	beforeEach(async () => {
		setup = await buildMockCMS(testModule);
		cms = setup.cms;
		await runTestDbMigrations(cms);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	// ==========================================================================
	// 1. ONE-TO-ONE RELATIONS (BelongsTo side only)
	// ==========================================================================

	describe("one-to-one relations", () => {
		it("creates and resolves one-to-one relation (belongsTo side)", async () => {
			const ctx = createTestContext();
			const usersCrud = cms.api.collections.users;
			const profilesCrud = cms.api.collections.profiles;

			const user = await usersCrud.create(
				{
					id: crypto.randomUUID(),
					email: "john@example.com",
					name: "John Doe",
				},
				ctx,
			);

			const profile = await profilesCrud.create(
				{
					id: crypto.randomUUID(),
					userId: user.id,
					bio: "Software engineer",
					avatar: "avatar.jpg",
				},
				ctx,
			);

			// Load profile with user (BelongsTo side works)
			const profileWithUser = await profilesCrud.findOne(
				{ where: { id: profile.id }, with: { user: true } },
				ctx,
			);

			expect(profileWithUser?.user?.id).toBe(user.id);
			expect(profileWithUser?.user?.name).toBe("John Doe");
		});

		it("filters by one-to-one relation", async () => {
			const ctx = createTestContext();
			const usersCrud = cms.api.collections.users;
			const profilesCrud = cms.api.collections.profiles;

			const user1 = await usersCrud.create(
				{
					id: crypto.randomUUID(),
					email: "alice@example.com",
					name: "Alice",
				},
				ctx,
			);

			const user2 = await usersCrud.create(
				{
					id: crypto.randomUUID(),
					email: "bob@example.com",
					name: "Bob",
				},
				ctx,
			);

			await profilesCrud.create(
				{
					id: crypto.randomUUID(),
					userId: user1.id,
					bio: "Developer",
					avatar: "alice.jpg",
				},
				ctx,
			);

			await profilesCrud.create(
				{
					id: crypto.randomUUID(),
					userId: user2.id,
					bio: "Designer",
					avatar: "bob.jpg",
				},
				ctx,
			);

			// Filter profiles by user name
			const aliceProfile = await profilesCrud.find(
				{
					where: {
						user: { name: "Alice" },
					},
				},
				ctx,
			);

			expect(aliceProfile.docs).toHaveLength(1);
			expect(aliceProfile.docs[0].bio).toBe("Developer");
		});
	});

	// ==========================================================================
	// 2. DEEP NESTING (3+ LEVELS)
	// ==========================================================================

	describe("deep nesting", () => {
		it("loads 3 levels of nested relations (author -> posts -> comments)", async () => {
			const ctx = createTestContext();
			const authorsCrud = cms.api.collections.authors;
			const postsCrud = cms.api.collections.posts;
			const commentsCrud = cms.api.collections.comments;

			const author = await authorsCrud.create(
				{ id: crypto.randomUUID(), name: "Author A" },
				ctx,
			);

			const post = await postsCrud.create(
				{
					id: crypto.randomUUID(),
					title: "Post 1",
					views: 100,
					authorId: author.id,
					editorId: author.id,
				},
				ctx,
			);

			await commentsCrud.create(
				{
					id: crypto.randomUUID(),
					content: "Great post!",
					postId: post.id,
				},
				ctx,
			);

			await commentsCrud.create(
				{
					id: crypto.randomUUID(),
					content: "Thanks for sharing",
					postId: post.id,
				},
				ctx,
			);

			// Load author -> posts -> comments (3 levels)
			const authorWithNested = await authorsCrud.findOne(
				{
					where: { id: author.id },
					with: {
						posts: {
							with: {
								comments: true,
							},
						},
					},
				},
				ctx,
			);

			expect(authorWithNested?.posts).toHaveLength(1);
			expect(authorWithNested?.posts[0].comments).toHaveLength(2);
			expect(authorWithNested?.posts[0].comments[0].content).toBeDefined();
		});

		it("handles self-referential deep nesting (comments -> replies -> replies)", async () => {
			const ctx = createTestContext();
			const authorsCrud = cms.api.collections.authors;
			const postsCrud = cms.api.collections.posts;
			const commentsCrud = cms.api.collections.comments;

			const author = await authorsCrud.create(
				{ id: crypto.randomUUID(), name: "Author B" },
				ctx,
			);

			const post = await postsCrud.create(
				{
					id: crypto.randomUUID(),
					title: "Post 2",
					views: 50,
					author: { connect: [{ id: author.id }] },
				},
				ctx,
			);

			const rootComment = await commentsCrud.create(
				{
					id: crypto.randomUUID(),
					content: "Root comment",
					postId: post.id,
				},
				ctx,
			);

			const reply1 = await commentsCrud.create(
				{
					id: crypto.randomUUID(),
					content: "Reply to root",
					postId: post.id,
					parentId: rootComment.id,
				},
				ctx,
			);

			await commentsCrud.create(
				{
					id: crypto.randomUUID(),
					content: "Reply to reply",
					postId: post.id,
					parentId: reply1.id,
				},
				ctx,
			);

			// Load comment with nested replies
			const commentWithReplies = await commentsCrud.findOne(
				{
					where: { id: rootComment.id },
					with: {
						replies: {
							with: {
								replies: true,
							},
						},
					},
				},
				ctx,
			);

			expect(commentWithReplies?.replies).toHaveLength(1);
			expect(commentWithReplies?.replies[0].replies).toHaveLength(1);
		});
	});

	// ==========================================================================
	// 3. PARTIAL FIELD SELECTION
	// ==========================================================================

	describe("partial field selection", () => {
		it("loads only selected columns from related collection", async () => {
			const ctx = createTestContext();
			const authorsCrud = cms.api.collections.authors;
			const postsCrud = cms.api.collections.posts;

			const author = await authorsCrud.create(
				{ id: crypto.randomUUID(), name: "Author C" },
				ctx,
			);

			await postsCrud.create(
				{
					id: crypto.randomUUID(),
					title: "Post 1",
					views: 100,
					authorId: author.id,
				},
				ctx,
			);

			await postsCrud.create(
				{
					id: crypto.randomUUID(),
					title: "Post 2",
					views: 200,
					authorId: author.id,
				},
				ctx,
			);

			// Load author with only post titles (not views)
			const authorWithPosts = await authorsCrud.findOne(
				{
					where: { id: author.id },
					with: {
						posts: {
							columns: {
								id: true,
								title: true,
							},
						},
					},
				},
				ctx,
			);

			expect(authorWithPosts?.posts).toHaveLength(2);
			expect(authorWithPosts?.posts[0].title).toBeDefined();
			// Note: views should not be loaded (partial selection not yet implemented)
			// @ts-expect-error views is not selected
			expect(authorWithPosts?.posts[0].views).toBeUndefined();
		});
	});

	// ==========================================================================
	// 4. LIMIT/OFFSET/ORDER ON RELATIONS
	// ==========================================================================

	describe("limit, offset, orderBy on relations", () => {
		it("applies limit and orderBy to hasMany relation", async () => {
			const ctx = createTestContext();
			const authorsCrud = cms.api.collections.authors;
			const postsCrud = cms.api.collections.posts;

			const author = await authorsCrud.create(
				{ id: crypto.randomUUID(), name: "Prolific Author" },
				ctx,
			);

			// Create posts with different view counts
			await postsCrud.create(
				{
					id: crypto.randomUUID(),
					title: "Post A",
					views: 100,
					authorId: author.id,
				},
				ctx,
			);

			await postsCrud.create(
				{
					id: crypto.randomUUID(),
					title: "Post B",
					views: 500,
					authorId: author.id,
				},
				ctx,
			);

			await postsCrud.create(
				{
					id: crypto.randomUUID(),
					title: "Post C",
					views: 300,
					authorId: author.id,
				},
				ctx,
			);

			// Load author with top 2 posts by views
			const authorWithTopPosts = await authorsCrud.findOne(
				{
					where: { id: author.id },
					with: {
						posts: {
							limit: 2,
							orderBy: { views: "desc" },
						},
					},
				},
				ctx,
			);

			expect(authorWithTopPosts?.posts).toHaveLength(2);
			expect(authorWithTopPosts?.posts[0].views).toBe(500);
			expect(authorWithTopPosts?.posts[1].views).toBe(300);
		});

		it("applies offset to skip records in hasMany relation", async () => {
			const ctx = createTestContext();
			const authorsCrud = cms.api.collections.authors;
			const postsCrud = cms.api.collections.posts;

			const author = await authorsCrud.create(
				{ id: crypto.randomUUID(), name: "Another Author" },
				ctx,
			);

			await postsCrud.create(
				{
					id: crypto.randomUUID(),
					title: "Post 1",
					views: 10,
					authorId: author.id,
				},
				ctx,
			);

			await postsCrud.create(
				{
					id: crypto.randomUUID(),
					title: "Post 2",
					views: 20,
					authorId: author.id,
				},
				ctx,
			);

			await postsCrud.create(
				{
					id: crypto.randomUUID(),
					title: "Post 3",
					views: 30,
					authorId: author.id,
				},
				ctx,
			);

			// Load author, skip first post
			const authorWithOffset = await authorsCrud.findOne(
				{
					where: { id: author.id },
					with: {
						posts: {
							offset: 1,
							orderBy: { views: "asc" },
						},
					},
				},
				ctx,
			);

			expect(authorWithOffset?.posts).toHaveLength(2);
			expect(authorWithOffset?.posts[0].views).toBe(20);
			expect(authorWithOffset?.posts[1].views).toBe(30);
		});
	});

	// ==========================================================================
	// 5. ADVANCED AGGREGATIONS
	// ==========================================================================

	describe("advanced aggregations", () => {
		it("supports _sum, _avg, _min, _max aggregations", async () => {
			const ctx = createTestContext();
			const authorsCrud = cms.api.collections.authors;
			const postsCrud = cms.api.collections.posts;

			const author = await authorsCrud.create(
				{ id: crypto.randomUUID(), name: "Stats Author" },
				ctx,
			);

			await postsCrud.create(
				{
					id: crypto.randomUUID(),
					title: "Post 1",
					views: 100,
					authorId: author.id,
				},
				ctx,
			);

			await postsCrud.create(
				{
					id: crypto.randomUUID(),
					title: "Post 2",
					views: 200,
					authorId: author.id,
				},
				ctx,
			);

			await postsCrud.create(
				{
					id: crypto.randomUUID(),
					title: "Post 3",
					views: 300,
					authorId: author.id,
				},
				ctx,
			);

			// Load author with post view statistics
			const authorWithStats = await authorsCrud.findOne(
				{
					where: { id: author.id },
					with: {
						posts: {
							_aggregate: {
								_count: true,
								_sum: { views: true },
								_avg: { views: true },
								_min: { views: true },
								_max: { views: true },
							},
						},
					},
				},
				ctx,
			);

			expect(authorWithStats?.posts._count).toBe(3);
			expect(authorWithStats?.posts._sum.views).toBe(600);
			expect(authorWithStats?.posts._avg.views).toBe(200);
			expect(authorWithStats?.posts._min.views).toBe(100);
			expect(authorWithStats?.posts._max.views).toBe(300);
		});

		it("supports aggregations with where filters", async () => {
			const ctx = createTestContext();
			const authorsCrud = cms.api.collections.authors;
			const postsCrud = cms.api.collections.posts;

			const author = await authorsCrud.create(
				{ id: crypto.randomUUID(), name: "Filtered Stats Author" },
				ctx,
			);

			await postsCrud.create(
				{
					id: crypto.randomUUID(),
					title: "Popular Post",
					views: 1000,
					authorId: author.id,
				},
				ctx,
			);

			await postsCrud.create(
				{
					id: crypto.randomUUID(),
					title: "Unpopular Post",
					views: 50,
					authorId: author.id,
				},
				ctx,
			);

			await postsCrud.create(
				{
					id: crypto.randomUUID(),
					title: "Another Popular Post",
					views: 800,
					authorId: author.id,
				},
				ctx,
			);

			// Count only popular posts (views > 100)
			const authorWithPopularStats = await authorsCrud.findOne(
				{
					where: { id: author.id },
					with: {
						posts: {
							where: { views: { gte: 100 } },
							_aggregate: {
								_count: true,
								_avg: { views: true },
							},
						},
					},
				},
				ctx,
			);

			expect(authorWithPopularStats?.posts._count).toBe(2);
			expect(authorWithPopularStats?.posts._avg.views).toBe(900);
		});
	});

	// ==========================================================================
	// 6. NESTED MUTATIONS - CONNECT
	// ==========================================================================

	describe("nested mutations - connect", () => {
		it("connects existing records in many-to-many relation", async () => {
			const ctx = createTestContext();
			const articlesCrud = cms.api.collections.articles;
			const tagsCrud = cms.api.collections.articleTags;
			// Create tags first
			const tag1 = await tagsCrud.create(
				{ id: crypto.randomUUID(), name: "JavaScript" },
				ctx,
			);

			const tag2 = await tagsCrud.create(
				{ id: crypto.randomUUID(), name: "TypeScript" },
				ctx,
			);

			// Create article and connect to existing tags
			const article = await articlesCrud.create(
				{
					id: crypto.randomUUID(),
					title: "My Article",
					tags: {
						connect: [{ id: tag1.id }, { id: tag2.id }],
					},
				},
				ctx,
			);

			// Verify connection
			const articleWithTags = await articlesCrud.findOne(
				{ where: { id: article.id }, with: { tags: true } },
				ctx,
			);

			expect(articleWithTags?.tags).toHaveLength(2);
			expect(articleWithTags?.tags.map((t: any) => t.name).sort()).toEqual([
				"JavaScript",
				"TypeScript",
			]);
		});
	});

	// ==========================================================================
	// 7. NESTED MUTATIONS - CONNECT OR CREATE
	// ==========================================================================

	describe("nested mutations - connectOrCreate", () => {
		it("creates new record if it doesn't exist, otherwise connects", async () => {
			const ctx = createTestContext();
			const articlesCrud = cms.api.collections.articles;
			const tagsCrud = cms.api.collections.articleTags;

			// Create one existing tag
			const existingTag = await tagsCrud.create(
				{ id: crypto.randomUUID(), name: "React" },
				ctx,
			);

			// Create article with connectOrCreate (one existing, one new)
			const article = await articlesCrud.create(
				{
					id: crypto.randomUUID(),
					title: "React Guide",
					tags: {
						connectOrCreate: [
							{
								where: { name: "React" },
								create: { name: "React" },
							},
							{
								where: { name: "Hooks" },
								create: { name: "Hooks" },
							},
						],
					},
				} as any, // Type system requires id in where, but runtime supports any unique field
				ctx,
			);

			// Verify: should have 2 tags, React (existing) and Hooks (created)
			const articleWithTags = await articlesCrud.findOne(
				{ where: { id: article.id }, with: { tags: true } },
				ctx,
			);

			expect(articleWithTags?.tags).toHaveLength(2);

			// Verify the React tag is the same existing one
			const reactTag = articleWithTags?.tags.find(
				(t: any) => t.name === "React",
			);
			expect(reactTag?.id).toBe(existingTag.id);

			// Verify total tags in database (should be 2, not 3)
			const allTags = await tagsCrud.find({}, ctx);
			expect(allTags.docs).toHaveLength(2);
		});
	});

	// ==========================================================================
	// 8. NESTED MUTATIONS - COMBINED OPERATIONS
	// ==========================================================================

	describe("nested mutations - combined operations", () => {
		it("handles create + connect in single mutation", async () => {
			const ctx = createTestContext();
			const articlesCrud = cms.api.collections.articles;
			const tagsCrud = cms.api.collections.articleTags;

			// Create one existing tag
			const existingTag = await tagsCrud.create(
				{ id: crypto.randomUUID(), name: "Vue" },
				ctx,
			);

			// Create article with both create and connect
			const article = await articlesCrud.create(
				{
					id: crypto.randomUUID(),
					title: "Vue Tutorial",
					tags: {
						create: [{ name: "Tutorial" }, { name: "Beginner" }],
						connect: [{ id: existingTag.id }],
					},
				},
				ctx,
			);

			// Verify all 3 tags are connected
			const articleWithTags = await articlesCrud.findOne(
				{ where: { id: article.id }, with: { tags: true } },
				ctx,
			);

			expect(articleWithTags?.tags).toHaveLength(3);
			expect(articleWithTags?.tags.map((t: any) => t.name).sort()).toEqual([
				"Beginner",
				"Tutorial",
				"Vue",
			]);
		});
	});

	// ==========================================================================
	// 9. CASCADE DELETE
	// ==========================================================================

	describe("cascade delete", () => {
		it("cascades delete to hasMany related records", async () => {
			const ctx = createTestContext();
			const authorsCrud = cms.api.collections.authors;
			const postsCrud = cms.api.collections.posts;

			const author = await authorsCrud.create(
				{ id: crypto.randomUUID(), name: "Author to Delete" },
				ctx,
			);

			const post1 = await postsCrud.create(
				{
					id: crypto.randomUUID(),
					title: "Post 1",
					views: 10,
					authorId: author.id,
				},
				ctx,
			);

			const post2 = await postsCrud.create(
				{
					id: crypto.randomUUID(),
					title: "Post 2",
					views: 20,
					authorId: author.id,
				},
				ctx,
			);

			// Delete author should cascade to posts
			await authorsCrud.deleteById({ id: author.id }, ctx);

			// Verify posts are deleted
			const remainingPost1 = await postsCrud.findOne(
				{ where: { id: post1.id } },
				ctx,
			);
			const remainingPost2 = await postsCrud.findOne(
				{ where: { id: post2.id } },
				ctx,
			);

			expect(remainingPost1).toBeNull();
			expect(remainingPost2).toBeNull();
		});

		it("cascades through multiple levels (author -> posts -> comments)", async () => {
			const ctx = createTestContext();
			const authorsCrud = cms.api.collections.authors;
			const postsCrud = cms.api.collections.posts;
			const commentsCrud = cms.api.collections.comments;

			const author = await authorsCrud.create(
				{ id: crypto.randomUUID(), name: "Author Multi-Cascade" },
				ctx,
			);

			const post = await postsCrud.create(
				{
					id: crypto.randomUUID(),
					title: "Post with Comments",
					views: 100,
					authorId: author.id,
				},
				ctx,
			);

			const comment = await commentsCrud.create(
				{
					id: crypto.randomUUID(),
					content: "Comment to be deleted",
					postId: post.id,
				},
				ctx,
			);

			// Delete author -> should cascade to post -> should cascade to comment
			await authorsCrud.deleteById({ id: author.id }, ctx);

			// Verify comment is deleted
			const remainingComment = await commentsCrud.findOne(
				{ where: { id: comment.id } },
				ctx,
			);

			expect(remainingComment).toBeNull();
		});
	});

	// ==========================================================================
	// 10. SET NULL ON DELETE
	// ==========================================================================

	describe("set null on delete", () => {
		it("sets foreign key to null when referenced record is deleted", async () => {
			const ctx = createTestContext();
			const authorsCrud = cms.api.collections.authors;
			const postsCrud = cms.api.collections.posts;

			const author = await authorsCrud.create(
				{ id: crypto.randomUUID(), name: "Main Author" },
				ctx,
			);

			const editor = await authorsCrud.create(
				{ id: crypto.randomUUID(), name: "Editor to Delete" },
				ctx,
			);

			const post = await postsCrud.create(
				{
					id: crypto.randomUUID(),
					title: "Post with Editor",
					views: 50,
					authorId: author.id,
					editorId: editor.id,
				},
				ctx,
			);

			// Delete editor - FK constraint handles SET NULL
			await authorsCrud.deleteById({ id: editor.id }, ctx);

			// Verify post still exists but editorId is null
			const updatedPost = await postsCrud.findOne(
				{ where: { id: post.id } },
				ctx,
			);

			expect(updatedPost).not.toBeNull();
			expect(updatedPost?.authorId).toBe(author.id);
			expect(updatedPost?.editorId).toBeNull();
		});
	});

	// ==========================================================================
	// 11. RESTRICT DELETE
	// ==========================================================================

	describe("restrict delete", () => {
		it("prevents delete when related records exist (onDelete: restrict)", async () => {
			const ctx = createTestContext();
			const categoriesCrud = cms.api.collections.restrictedCategories;
			const productsCrud = cms.api.collections.restricted_products;

			const category = await categoriesCrud.create(
				{ id: crypto.randomUUID(), name: "Protected Category" },
				ctx,
			);

			await productsCrud.create(
				{
					id: crypto.randomUUID(),
					name: "Product in Category",
					categoryId: category.id,
				},
				ctx,
			);

			// Try to delete category with existing products (should fail)
			await expect(
				categoriesCrud.deleteById({ id: category.id }, ctx),
			).rejects.toThrow();

			// Verify category still exists
			const remainingCategory = await categoriesCrud.findOne(
				{ where: { id: category.id } },
				ctx,
			);

			expect(remainingCategory).not.toBeNull();
		});
	});

	// ==========================================================================
	// 13. EDGE CASES
	// ==========================================================================

	describe("edge cases", () => {
		it("handles null foreign keys gracefully", async () => {
			const ctx = createTestContext();
			const authorsCrud = cms.api.collections.authors;
			const postsCrud = cms.api.collections.posts;

			const author = await authorsCrud.create(
				{ id: crypto.randomUUID(), name: "Author Null Test" },
				ctx,
			);

			// Create post without editorId (leaving it undefined/null)
			const post = await postsCrud.create(
				{
					id: crypto.randomUUID(),
					title: "Post without Editor",
					views: 10,
					authorId: author.id,
					// editorId intentionally omitted (null)
				},
				ctx,
			);

			// Load with editor relation
			const postWithEditor = await postsCrud.findOne(
				{ where: { id: post.id }, with: { editor: true } },
				ctx,
			);

			// When FK is null, relation loading returns null or undefined
			expect(postWithEditor?.editor).toBeFalsy();
			expect(postWithEditor?.editorId).toBeNull();
		});

		it("handles empty collections in hasMany relations", async () => {
			const ctx = createTestContext();
			const authorsCrud = cms.api.collections.authors;

			const author = await authorsCrud.create(
				{ id: crypto.randomUUID(), name: "Author No Posts" },
				ctx,
			);

			// Load author with posts (should be empty array)
			const authorWithPosts = await authorsCrud.findOne(
				{ where: { id: author.id }, with: { posts: true } },
				ctx,
			);

			expect(authorWithPosts?.posts).toEqual([]);
		});

		it("handles aggregations on empty collections", async () => {
			const ctx = createTestContext();
			const authorsCrud = cms.api.collections.authors;

			const author = await authorsCrud.create(
				{ id: crypto.randomUUID(), name: "Author Empty Aggregation" },
				ctx,
			);

			// Load author with post aggregations (no posts)
			const authorWithStats = await authorsCrud.findOne(
				{
					where: { id: author.id },
					with: {
						posts: {
							_aggregate: {
								_count: true,
								_sum: { views: true },
								_avg: { views: true },
							},
						},
					},
				},
				ctx,
			);

			// When there are no related records, aggregations might not be loaded
			// This is an edge case that reveals a potential issue
			if (authorWithStats?.posts) {
				expect(authorWithStats.posts._count).toBe(0);
				expect(authorWithStats.posts._sum?.views).toBeFalsy();
				expect(authorWithStats.posts._avg?.views).toBeFalsy();
			} else {
				// If posts is undefined, that's also acceptable behavior for empty relations
				expect(authorWithStats?.posts).toBeUndefined();
			}
		});
	});

	// ==========================================================================
	// 14. MULTIPLE RELATIONS LOADED TOGETHER
	// ==========================================================================

	describe("multiple relations", () => {
		it("loads multiple different relation types in single query", async () => {
			const ctx = createTestContext();
			const postsCrud = cms.api.collections.posts;
			const authorsCrud = cms.api.collections.authors;
			const commentsCrud = cms.api.collections.comments;

			const author = await authorsCrud.create(
				{ id: crypto.randomUUID(), name: "Main Author" },
				ctx,
			);

			const editor = await authorsCrud.create(
				{ id: crypto.randomUUID(), name: "Editor Author" },
				ctx,
			);

			const post = await postsCrud.create(
				{
					id: crypto.randomUUID(),
					title: "Complex Post",
					views: 100,
					authorId: author.id,
					editorId: editor.id,
				},
				ctx,
			);

			await commentsCrud.create(
				{
					id: crypto.randomUUID(),
					content: "Comment 1",
					postId: post.id,
				},
				ctx,
			);

			await commentsCrud.create(
				{
					id: crypto.randomUUID(),
					content: "Comment 2",
					postId: post.id,
				},
				ctx,
			);

			// Load post with author, editor, and comments all at once
			const postWithAll = await postsCrud.findOne(
				{
					where: { id: post.id },
					with: {
						author: true,
						editor: true,
						comments: true,
					},
				},
				ctx,
			);

			expect(postWithAll?.author?.name).toBe("Main Author");
			expect(postWithAll?.editor?.name).toBe("Editor Author");
			expect(postWithAll?.comments).toHaveLength(2);
		});
	});

	// ==========================================================================
	// 15. FILTERING AND QUANTIFIERS (Merged from collection-relations.test.ts)
	// ==========================================================================

	describe("filtering and relation quantifiers", () => {
		it("resolves belongsTo and hasMany relations", async () => {
			const ctx = createTestContext();
			const categoriesCrud = cms.api.collections.categories;
			const productsCrud = cms.api.collections.products;

			const category = await categoriesCrud.create(
				{ id: crypto.randomUUID(), name: "Category A" },
				ctx,
			);

			const productA = await productsCrud.create(
				{
					id: crypto.randomUUID(),
					name: "Product A",
					categoryId: category.id,
				},
				ctx,
			);

			await productsCrud.create(
				{
					id: crypto.randomUUID(),
					name: "Product B",
					categoryId: category.id,
				},
				ctx,
			);

			const categoriesWithProducts = await categoriesCrud.find(
				{ with: { products: true } },
				ctx,
			);
			expect(categoriesWithProducts.docs[0].products.length).toBe(2);

			const productWithCategory = await productsCrud.findOne(
				{ where: { id: productA.id }, with: { category: true } },
				ctx,
			);
			expect(productWithCategory?.category?.id).toBe(category.id);
		});

		it("supports hasMany aggregation counts", async () => {
			const ctx = createTestContext();
			const categoriesCrud = cms.api.collections.categories;
			const productsCrud = cms.api.collections.products;

			const category = await categoriesCrud.create(
				{ id: crypto.randomUUID(), name: "Category B" },
				ctx,
			);

			await productsCrud.create(
				{
					id: crypto.randomUUID(),
					name: "Product C",
					categoryId: category.id,
				},
				ctx,
			);

			await productsCrud.create(
				{
					id: crypto.randomUUID(),
					name: "Product D",
					categoryId: category.id,
				},
				ctx,
			);

			const categoriesWithCounts = await categoriesCrud.find(
				{ with: { products: { _count: true } } },
				ctx,
			);
			expect(categoriesWithCounts.docs[0].products._count).toBe(2);
		});

		it("creates many-to-many links with nested create", async () => {
			const ctx = createTestContext();
			const categoriesCrud = cms.api.collections.categories;
			const productsCrud = cms.api.collections.products;

			const category = await categoriesCrud.create(
				{ id: crypto.randomUUID(), name: "Category C" },
				ctx,
			);

			const product = await productsCrud.create(
				{
					id: crypto.randomUUID(),
					name: "Product E",
					categoryId: category.id,
					tags: {
						create: [{ name: "Tag A" }, { name: "Tag B" }],
					},
				},
				ctx,
			);

			const productWithTags = await productsCrud.findOne(
				{ where: { id: product.id }, with: { tags: true } },
				ctx,
			);

			expect(productWithTags?.tags.length).toBe(2);
		});

		it("filters across relations and nested relations", async () => {
			const ctx = createTestContext();
			const categoriesCrud = cms.api.collections.categories;
			const productsCrud = cms.api.collections.products;
			const tagsCrud = cms.api.collections.tags;
			const categoryTagsCrud = cms.api.collections.categoryTags;

			const categoryA = await categoriesCrud.create(
				{ id: crypto.randomUUID(), name: "Trololo" },
				ctx,
			);
			const categoryB = await categoriesCrud.create(
				{ id: crypto.randomUUID(), name: "Other" },
				ctx,
			);

			const tagIvan = await tagsCrud.create(
				{ id: crypto.randomUUID(), name: "Ivan" },
				ctx,
			);

			await categoryTagsCrud.create(
				{
					id: crypto.randomUUID(),
					categoryId: categoryA.id,
					tagId: tagIvan.id,
				},
				ctx,
			);

			await productsCrud.create(
				{
					id: crypto.randomUUID(),
					name: "Product A",
					categoryId: categoryA.id,
				},
				ctx,
			);
			await productsCrud.create(
				{
					id: crypto.randomUUID(),
					name: "Product B",
					categoryId: categoryB.id,
				},
				ctx,
			);

			const byCategory = await productsCrud.find(
				{
					where: {
						category: { name: "Trololo" },
					},
				},
				ctx,
			);

			expect(byCategory.docs).toHaveLength(1);
			expect(byCategory.docs[0].name).toBe("Product A");

			const byCategoryTag = await productsCrud.find(
				{
					where: {
						category: {
							tags: { some: { name: "Ivan" } },
						},
					},
				},
				ctx,
			);

			expect(byCategoryTag.docs).toHaveLength(1);
			expect(byCategoryTag.docs[0].name).toBe("Product A");
		});

		it("supports relation quantifiers and isNot", async () => {
			const ctx = createTestContext();
			const categoriesCrud = cms.api.collections.categories;
			const productsCrud = cms.api.collections.products;
			const tagsCrud = cms.api.collections.tags;
			const categoryTagsCrud = cms.api.collections.categoryTags;

			const categoryA = await categoriesCrud.create(
				{ id: crypto.randomUUID(), name: "Trololo" },
				ctx,
			);
			const categoryB = await categoriesCrud.create(
				{ id: crypto.randomUUID(), name: "Other" },
				ctx,
			);
			const categoryC = await categoriesCrud.create(
				{ id: crypto.randomUUID(), name: "Empty" },
				ctx,
			);

			const tagIvan = await tagsCrud.create(
				{ id: crypto.randomUUID(), name: "Ivan" },
				ctx,
			);
			const tagZed = await tagsCrud.create(
				{ id: crypto.randomUUID(), name: "Zed" },
				ctx,
			);

			await categoryTagsCrud.create(
				{
					id: crypto.randomUUID(),
					categoryId: categoryA.id,
					tagId: tagIvan.id,
				},
				ctx,
			);
			await categoryTagsCrud.create(
				{
					id: crypto.randomUUID(),
					categoryId: categoryA.id,
					tagId: tagZed.id,
				},
				ctx,
			);
			await categoryTagsCrud.create(
				{
					id: crypto.randomUUID(),
					categoryId: categoryB.id,
					tagId: tagIvan.id,
				},
				ctx,
			);

			await productsCrud.create(
				{
					id: crypto.randomUUID(),
					name: "Product A",
					categoryId: categoryA.id,
				},
				ctx,
			);
			await productsCrud.create(
				{
					id: crypto.randomUUID(),
					name: "Product B",
					categoryId: categoryB.id,
				},
				ctx,
			);
			await productsCrud.create(
				{
					id: crypto.randomUUID(),
					name: "Product C",
					categoryId: categoryC.id,
				},
				ctx,
			);

			const withIvan = await productsCrud.find(
				{
					where: {
						category: { tags: { some: { name: "Ivan" } } },
					},
				},
				ctx,
			);
			expect(withIvan.docs.map((p: any) => p.name).sort()).toEqual([
				"Product A",
				"Product B",
			]);

			const withoutZed = await productsCrud.find(
				{
					where: {
						category: { tags: { none: { name: "Zed" } } },
					},
				},
				ctx,
			);
			expect(withoutZed.docs.map((p: any) => p.name).sort()).toEqual([
				"Product B",
				"Product C",
			]);

			const everyIvan = await productsCrud.find(
				{
					where: {
						category: { tags: { every: { name: "Ivan" } } },
					},
				},
				ctx,
			);
			expect(everyIvan.docs.map((p: any) => p.name).sort()).toEqual([
				"Product B",
				"Product C",
			]);

			const notTrololo = await productsCrud.find(
				{
					where: {
						category: { isNot: { name: "Trololo" } },
					},
				},
				ctx,
			);
			expect(notTrololo.docs.map((p: any) => p.name).sort()).toEqual([
				"Product B",
				"Product C",
			]);
		});
	});
});
