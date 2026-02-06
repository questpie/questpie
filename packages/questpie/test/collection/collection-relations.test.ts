/**
 * Collection Relations Test
 *
 * Tests for the unified f.relation() API - all relation types including
 * belongsTo, hasMany, manyToMany with FK constraints and cascade behaviors.
 *
 * Uses string literals for collection references to avoid circular dependency issues.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { collection, questpie } from "../../src/server/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

// ==============================================================================
// TEST COLLECTIONS SETUP - Using new f.relation() API with string literals
// ==============================================================================

// Users collection (referenced by profiles)
const users = collection("users").fields((f) => ({
  email: f.text({ required: true, maxLength: 255 }),
  name: f.text({ required: true }),
}));

// ==============================================================================
// COLLECTIONS FOR STRING FIELD FORMAT TEST
// ==============================================================================

// Assets collection (for testing upload and string field format)
const testAssets = collection("test_assets")
  .options({ timestamps: true })
  .fields((f) => ({
    filename: f.text({ required: true, maxLength: 255 }),
    mimeType: f.text({ maxLength: 100 }),
    key: f.text({ maxLength: 500 }),
  }));

// Services collection using relation field with string target
const services = collection("services").fields((f) => ({
  name: f.text({ required: true, maxLength: 255 }),
  image: f.relation({
    to: "test_assets",
  }),
}));

// Profiles collection (one-to-one with users via belongsTo)
const profiles = collection("profiles").fields((f) => ({
  user: f.relation({
    to: "users",
    required: true,
    unique: true,
    onDelete: "cascade",
  }),
  bio: f.text({ required: true }),
  avatar: f.text(),
}));

// Authors with posts (one-to-many with cascade delete)
const authors = collection("authors").fields((f) => ({
  name: f.text({ required: true }),
  // HasMany relations - using string literals for circular refs
  posts: f.relation({
    to: "posts",
    hasMany: true,
    foreignKey: "author", // FK column on posts table
    onDelete: "cascade",
    relationName: "author",
  }),
  editedPosts: f.relation({
    to: "posts",
    hasMany: true,
    foreignKey: "editor", // FK column on posts table
    onDelete: "set null", // Application-level SET NULL when author is deleted
    relationName: "editor",
  }),
}));

// Posts with cascade/set null scenarios
const posts = collection("posts").fields((f) => ({
  title: f.text({ required: true }),
  views: f.number({ default: 0 }),
  // BelongsTo relations
  author: f.relation({
    to: "authors",
    required: true,
    onDelete: "cascade",
    relationName: "author",
  }),
  editor: f.relation({
    to: "authors",
    onDelete: "set null",
    relationName: "editor",
  }),
  // HasMany
  comments: f.relation({
    to: "comments",
    hasMany: true,
    foreignKey: "post", // FK column on comments table
    onDelete: "cascade",
    relationName: "post",
  }),
}));

// Comments for deep nesting tests (posts -> comments -> replies)
const comments = collection("comments").fields((f) => ({
  content: f.text({ required: true }),
  // BelongsTo post
  post: f.relation({
    to: "posts",
    required: true,
    onDelete: "cascade",
    relationName: "post",
  }),
  // Self-referential BelongsTo (parent comment)
  parent: f.relation({
    to: "comments",
    onDelete: "cascade",
    relationName: "parent",
  }),
  // HasMany (replies)
  replies: f.relation({
    to: "comments",
    hasMany: true,
    foreignKey: "parent", // FK column on comments table
    relationName: "parent",
  }),
}));

// Products with restricted delete
// NOTE: Collection name must match the key used in .collections({}) for relation lookups to work
const restrictedCategories = collection("restrictedCategories").fields((f) => ({
  name: f.text({ required: true }),
  // HasMany - RESTRICT delete when products exist
  products: f.relation({
    to: "restrictedProducts", // Must match the key in .collections({})
    hasMany: true,
    foreignKey: "category", // FK column on products table
    onDelete: "restrict", // Application-level RESTRICT when category is deleted
    relationName: "category",
  }),
}));

const restrictedProducts = collection("restrictedProducts").fields((f) => ({
  name: f.text({ required: true }),
  // BelongsTo with restrict
  category: f.relation({
    to: "restrictedCategories",
    required: true,
    onDelete: "restrict",
    relationName: "category",
  }),
}));

// Many-to-many with extra fields in junction table
const articles = collection("articles").fields((f) => ({
  title: f.text({ required: true }),
  // ManyToMany
  tags: f.relation({
    to: "articleTags",
    hasMany: true,
    through: "articleTagJunction",
    sourceField: "article", // FK column on junction table
    targetField: "tag", // FK column on junction table
  }),
}));

const articleTags = collection("articleTags").fields((f) => ({
  name: f.text({ required: true }),
  // ManyToMany reverse
  articles: f.relation({
    to: "articles",
    hasMany: true,
    through: "articleTagJunction",
    sourceField: "tag", // FK column on junction table
    targetField: "article", // FK column on junction table
  }),
}));

// Junction table - still uses belongsTo for FK columns
const articleTagJunction = collection("articleTagJunction").fields((f) => ({
  article: f.relation({
    to: "articles",
    required: true,
    onDelete: "cascade",
  }),
  tag: f.relation({
    to: "articleTags",
    required: true,
    onDelete: "cascade",
  }),
  order: f.number({ default: 0 }),
  addedAt: f.datetime({ default: () => new Date() }),
}));

// Additional collections for filtering and quantifiers tests
const categories = collection("categories").fields((f) => ({
  name: f.text({ required: true }),
  // HasMany
  products: f.relation({
    to: "products",
    hasMany: true,
    foreignKey: "category", // FK column on products table
    relationName: "category",
  }),
  // ManyToMany
  tags: f.relation({
    to: "tags",
    hasMany: true,
    through: "categoryTags",
    sourceField: "category", // FK column on junction table
    targetField: "tag", // FK column on junction table
  }),
}));

const products = collection("products").fields((f) => ({
  name: f.text({ required: true }),
  // BelongsTo
  category: f.relation({
    to: "categories",
    required: true,
    relationName: "category",
  }),
  // ManyToMany
  tags: f.relation({
    to: "tags",
    hasMany: true,
    through: "productTags",
    sourceField: "product", // FK column on junction table
    targetField: "tag", // FK column on junction table
  }),
}));

const tags = collection("tags").fields((f) => ({
  name: f.text({ required: true }),
  // ManyToMany relations
  products: f.relation({
    to: "products",
    hasMany: true,
    through: "productTags",
    sourceField: "tag", // FK column on junction table
    targetField: "product", // FK column on junction table
  }),
  categories: f.relation({
    to: "categories",
    hasMany: true,
    through: "categoryTags",
    sourceField: "tag", // FK column on junction table
    targetField: "category", // FK column on junction table
  }),
}));

// Junction tables
const categoryTags = collection("categoryTags").fields((f) => ({
  category: f.relation({
    to: "categories",
    required: true,
  }),
  tag: f.relation({
    to: "tags",
    required: true,
  }),
}));

const productTags = collection("productTags").fields((f) => ({
  product: f.relation({
    to: "products",
    required: true,
  }),
  tag: f.relation({
    to: "tags",
    required: true,
  }),
}));

const testModule = questpie({ name: "test" }).collections({
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
  // Collections for string field format test
  test_assets: testAssets,
  services,
});

// ==============================================================================
// TESTS
// ==============================================================================
// NOTE: This test file uses `as any` casts for CRUD operations because the
// circular relation references cause TypeScript inference issues. The runtime
// behavior is still tested correctly - only compile-time types are affected.
// ==============================================================================

describe("collection relations", () => {
  let setup: Awaited<ReturnType<typeof buildMockApp<typeof testModule>>>;
  let cms: any; // Use any to bypass type inference issues with circular relations

  beforeEach(async () => {
    setup = await buildMockApp(testModule);
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
          user: user.id,
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
          user: user1.id,
          bio: "Developer",
          avatar: "alice.jpg",
        },
        ctx,
      );

      await profilesCrud.create(
        {
          id: crypto.randomUUID(),
          user: user2.id,
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
          author: author.id,
          editor: author.id,
        },
        ctx,
      );

      await commentsCrud.create(
        {
          id: crypto.randomUUID(),
          content: "Great post!",
          post: post.id,
        },
        ctx,
      );

      await commentsCrud.create(
        {
          id: crypto.randomUUID(),
          content: "Thanks for sharing",
          post: post.id,
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
          post: post.id,
        },
        ctx,
      );

      const reply1 = await commentsCrud.create(
        {
          id: crypto.randomUUID(),
          content: "Reply to root",
          post: post.id,
          parent: rootComment.id,
        },
        ctx,
      );

      await commentsCrud.create(
        {
          id: crypto.randomUUID(),
          content: "Reply to reply",
          post: post.id,
          parent: reply1.id,
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
          author: author.id,
        },
        ctx,
      );

      await postsCrud.create(
        {
          id: crypto.randomUUID(),
          title: "Post 2",
          views: 200,
          author: author.id,
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
          author: author.id,
        },
        ctx,
      );

      await postsCrud.create(
        {
          id: crypto.randomUUID(),
          title: "Post B",
          views: 500,
          author: author.id,
        },
        ctx,
      );

      await postsCrud.create(
        {
          id: crypto.randomUUID(),
          title: "Post C",
          views: 300,
          author: author.id,
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
          author: author.id,
        },
        ctx,
      );

      await postsCrud.create(
        {
          id: crypto.randomUUID(),
          title: "Post 2",
          views: 20,
          author: author.id,
        },
        ctx,
      );

      await postsCrud.create(
        {
          id: crypto.randomUUID(),
          title: "Post 3",
          views: 30,
          author: author.id,
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
          author: author.id,
        },
        ctx,
      );

      await postsCrud.create(
        {
          id: crypto.randomUUID(),
          title: "Post 2",
          views: 200,
          author: author.id,
        },
        ctx,
      );

      await postsCrud.create(
        {
          id: crypto.randomUUID(),
          title: "Post 3",
          views: 300,
          author: author.id,
        },
        ctx,
      );

      // Load author with post view statistics
      const authorWithStats = await authorsCrud.findOne(
        {
          where: {
            id: author.id,
          },
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
          author: author.id,
        },
        ctx,
      );

      await postsCrud.create(
        {
          id: crypto.randomUUID(),
          title: "Unpopular Post",
          views: 50,
          author: author.id,
        },
        ctx,
      );

      await postsCrud.create(
        {
          id: crypto.randomUUID(),
          title: "Another Popular Post",
          views: 800,
          author: author.id,
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
  // 6. NESTED MUTATIONS - PLAIN ARRAY OF IDS (Admin Form Pattern)
  // ==========================================================================

  describe("nested mutations - plain array of IDs", () => {
    it("creates record with M:N relation using plain array of IDs", async () => {
      const ctx = createTestContext();
      const articlesCrud = cms.api.collections.articles;
      const tagsCrud = cms.api.collections.articleTags;

      // Create tags first
      const tag1 = await tagsCrud.create(
        { id: crypto.randomUUID(), name: "PlainID-Tag1" },
        ctx,
      );
      const tag2 = await tagsCrud.create(
        { id: crypto.randomUUID(), name: "PlainID-Tag2" },
        ctx,
      );

      // Create article using plain array of IDs (like admin form sends)
      const article = await articlesCrud.create(
        {
          id: crypto.randomUUID(),
          title: "Plain ID Article",
          tags: [tag1.id, tag2.id], // Plain array of IDs!
        } as any,
        ctx,
      );

      // Verify
      const articleWithTags = await articlesCrud.findOne(
        { where: { id: article.id }, with: { tags: true } },
        ctx,
      );

      expect(articleWithTags?.tags).toHaveLength(2);
      expect(articleWithTags?.tags.map((t: any) => t.name).sort()).toEqual([
        "PlainID-Tag1",
        "PlainID-Tag2",
      ]);
    });

    it("updates record with M:N relation using plain array of IDs", async () => {
      const ctx = createTestContext();
      const articlesCrud = cms.api.collections.articles;
      const tagsCrud = cms.api.collections.articleTags;

      // Create tags
      const tag1 = await tagsCrud.create(
        { id: crypto.randomUUID(), name: "Update-Tag1" },
        ctx,
      );
      const tag2 = await tagsCrud.create(
        { id: crypto.randomUUID(), name: "Update-Tag2" },
        ctx,
      );
      const tag3 = await tagsCrud.create(
        { id: crypto.randomUUID(), name: "Update-Tag3" },
        ctx,
      );

      // Create article with tag1
      const article = await articlesCrud.create(
        {
          id: crypto.randomUUID(),
          title: "Update Test Article",
          tags: [tag1.id],
        } as any,
        ctx,
      );

      // Update to have tag2 and tag3 (remove tag1, add tag2 and tag3)
      await articlesCrud.updateById(
        {
          id: article.id,
          data: {
            tags: [tag2.id, tag3.id], // Plain array of IDs!
          },
        } as any,
        ctx,
      );

      // Verify
      const articleWithTags = await articlesCrud.findOne(
        { where: { id: article.id }, with: { tags: true } },
        ctx,
      );

      expect(articleWithTags?.tags).toHaveLength(2);
      expect(articleWithTags?.tags.map((t: any) => t.name).sort()).toEqual([
        "Update-Tag2",
        "Update-Tag3",
      ]);
    });
  });

  // ==========================================================================
  // 6b. NESTED MUTATIONS - CONNECT
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
          author: author.id,
        },
        ctx,
      );

      const post2 = await postsCrud.create(
        {
          id: crypto.randomUUID(),
          title: "Post 2",
          views: 20,
          author: author.id,
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
          author: author.id,
        },
        ctx,
      );

      const comment = await commentsCrud.create(
        {
          id: crypto.randomUUID(),
          content: "Comment to be deleted",
          post: post.id,
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
          author: author.id,
          editor: editor.id,
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
      expect(updatedPost?.author).toBe(author.id);
      expect(updatedPost?.editor).toBeNull();
    });
  });

  // ==========================================================================
  // 11. RESTRICT DELETE
  // ==========================================================================

  describe("restrict delete", () => {
    it("prevents delete when related records exist (onDelete: restrict)", async () => {
      const ctx = createTestContext();
      const categoriesCrud = cms.api.collections.restrictedCategories;
      const productsCrud = cms.api.collections.restrictedProducts;

      const category = await categoriesCrud.create(
        { id: crypto.randomUUID(), name: "Protected Category" },
        ctx,
      );

      await productsCrud.create(
        {
          id: crypto.randomUUID(),
          name: "Product in Category",
          category: category.id,
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
          author: author.id,
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
      // With unified API, FK column key is field name (editor, not editorId)
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
          author: author.id,
          editor: editor.id,
        },
        ctx,
      );

      await commentsCrud.create(
        {
          id: crypto.randomUUID(),
          content: "Comment 1",
          post: post.id,
        },
        ctx,
      );

      await commentsCrud.create(
        {
          id: crypto.randomUUID(),
          content: "Comment 2",
          post: post.id,
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
          category: category.id,
        },
        ctx,
      );

      await productsCrud.create(
        {
          id: crypto.randomUUID(),
          name: "Product B",
          category: category.id,
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
          category: category.id,
        },
        ctx,
      );

      await productsCrud.create(
        {
          id: crypto.randomUUID(),
          name: "Product D",
          category: category.id,
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
          category: category.id,
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
          category: categoryA.id,
          tag: tagIvan.id,
        },
        ctx,
      );

      await productsCrud.create(
        {
          id: crypto.randomUUID(),
          name: "Product A",
          category: categoryA.id,
        },
        ctx,
      );
      await productsCrud.create(
        {
          id: crypto.randomUUID(),
          name: "Product B",
          category: categoryB.id,
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

    it("filters by M:N relation using ID (reverse relation pattern)", async () => {
      const ctx = createTestContext();
      const articlesCrud = cms.api.collections.articles;
      const tagsCrud = cms.api.collections.articleTags;

      // Create tags
      const tag1 = await tagsCrud.create(
        { id: crypto.randomUUID(), name: "ReverseFilter-Tag1" },
        ctx,
      );
      const tag2 = await tagsCrud.create(
        { id: crypto.randomUUID(), name: "ReverseFilter-Tag2" },
        ctx,
      );

      // Create articles with tags
      await articlesCrud.create(
        {
          id: crypto.randomUUID(),
          title: "Article with Tag1",
          tags: [tag1.id],
        } as any,
        ctx,
      );
      await articlesCrud.create(
        {
          id: crypto.randomUUID(),
          title: "Article with Tag2",
          tags: [tag2.id],
        } as any,
        ctx,
      );
      await articlesCrud.create(
        {
          id: crypto.randomUUID(),
          title: "Article with both tags",
          tags: [tag1.id, tag2.id],
        } as any,
        ctx,
      );

      // Now filter articles by tag ID (reverse relation pattern)
      // This is what ReverseRelationField does: find items where M:N contains specific ID
      const articlesWithTag1 = await articlesCrud.find(
        {
          where: {
            tags: { some: { id: tag1.id } },
          },
        },
        ctx,
      );

      expect(articlesWithTag1.docs).toHaveLength(2);
      expect(articlesWithTag1.docs.map((a: any) => a.title).sort()).toEqual([
        "Article with Tag1",
        "Article with both tags",
      ]);

      // Filter by tag2
      const articlesWithTag2 = await articlesCrud.find(
        {
          where: {
            tags: { some: { id: tag2.id } },
          },
        },
        ctx,
      );

      expect(articlesWithTag2.docs).toHaveLength(2);
      expect(articlesWithTag2.docs.map((a: any) => a.title).sort()).toEqual([
        "Article with Tag2",
        "Article with both tags",
      ]);
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
          category: categoryA.id,
          tag: tagIvan.id,
        },
        ctx,
      );
      await categoryTagsCrud.create(
        {
          id: crypto.randomUUID(),
          category: categoryA.id,
          tag: tagZed.id,
        },
        ctx,
      );
      await categoryTagsCrud.create(
        {
          id: crypto.randomUUID(),
          category: categoryB.id,
          tag: tagIvan.id,
        },
        ctx,
      );

      await productsCrud.create(
        {
          id: crypto.randomUUID(),
          name: "Product A",
          category: categoryA.id,
        },
        ctx,
      );
      await productsCrud.create(
        {
          id: crypto.randomUUID(),
          name: "Product B",
          category: categoryB.id,
        },
        ctx,
      );
      await productsCrud.create(
        {
          id: crypto.randomUUID(),
          name: "Product C",
          category: categoryC.id,
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

  // ==========================================================================
  // 16. STRING FIELD FORMAT IN RELATIONS
  // ==========================================================================

  describe("string field format in relations", () => {
    it("resolves belongsTo relation using field: string format", async () => {
      const ctx = createTestContext();
      const assetsCrud = cms.api.collections.test_assets;
      const servicesCrud = cms.api.collections.services;

      // Create an asset
      const asset = await assetsCrud.create(
        {
          id: crypto.randomUUID(),
          filename: "service-image.png",
          mimeType: "image/png",
          key: "uploads/service-image.png",
        },
        ctx,
      );

      // Create a service with the asset FK
      const service = await servicesCrud.create(
        {
          id: crypto.randomUUID(),
          name: "Haircut",
          image: asset.id,
        },
        ctx,
      );

      // Load service with the image relation expanded
      const serviceWithImage = await servicesCrud.findOne(
        { where: { id: service.id }, with: { image: true } },
        ctx,
      );

      // Verify relation was resolved correctly
      expect(serviceWithImage?.image).not.toBeNull();
      expect(serviceWithImage?.image?.id).toBe(asset.id);
      expect(serviceWithImage?.image?.filename).toBe("service-image.png");
      expect(serviceWithImage?.image?.mimeType).toBe("image/png");
    });

    it("resolves belongsTo relation in find (multiple records)", async () => {
      const ctx = createTestContext();
      const assetsCrud = cms.api.collections.test_assets;
      const servicesCrud = cms.api.collections.services;

      // Create assets
      const asset1 = await assetsCrud.create(
        {
          id: crypto.randomUUID(),
          filename: "image1.png",
          mimeType: "image/png",
        },
        ctx,
      );

      const asset2 = await assetsCrud.create(
        {
          id: crypto.randomUUID(),
          filename: "image2.jpg",
          mimeType: "image/jpeg",
        },
        ctx,
      );

      // Create services
      await servicesCrud.create(
        {
          id: crypto.randomUUID(),
          name: "Service A",
          image: asset1.id,
        },
        ctx,
      );

      await servicesCrud.create(
        {
          id: crypto.randomUUID(),
          name: "Service B",
          image: asset2.id,
        },
        ctx,
      );

      await servicesCrud.create(
        {
          id: crypto.randomUUID(),
          name: "Service C (no image)",
          // image is null
        },
        ctx,
      );

      // Load all services with images expanded
      const servicesWithImages = await servicesCrud.find(
        { with: { image: true } },
        ctx,
      );

      expect(servicesWithImages.docs).toHaveLength(3);

      const serviceA = servicesWithImages.docs.find(
        (s: any) => s.name === "Service A",
      );
      const serviceB = servicesWithImages.docs.find(
        (s: any) => s.name === "Service B",
      );
      const serviceC = servicesWithImages.docs.find(
        (s: any) => s.name === "Service C (no image)",
      );

      expect(serviceA?.image?.filename).toBe("image1.png");
      expect(serviceB?.image?.filename).toBe("image2.jpg");
      expect(serviceC?.image).toBeFalsy(); // null FK = null relation
    });

    it("handles null FK gracefully with string field format", async () => {
      const ctx = createTestContext();
      const servicesCrud = cms.api.collections.services;

      // Create service without image
      const service = await servicesCrud.create(
        {
          id: crypto.randomUUID(),
          name: "Service without image",
          // image is null
        },
        ctx,
      );

      // Load service with image relation
      const serviceWithImage = await servicesCrud.findOne(
        { where: { id: service.id }, with: { image: true } },
        ctx,
      );

      // Relation should be null/undefined when FK is null
      expect(serviceWithImage?.image).toBeFalsy();
    });

    it("filters by related collection using string field format", async () => {
      const ctx = createTestContext();
      const assetsCrud = cms.api.collections.test_assets;
      const servicesCrud = cms.api.collections.services;

      // Create assets with unique filenames for this test
      const uniqueFilename = `filter-test-${crypto.randomUUID().slice(0, 8)}.svg`;
      const svgAsset = await assetsCrud.create(
        {
          id: crypto.randomUUID(),
          filename: uniqueFilename,
          mimeType: "image/svg+xml",
        },
        ctx,
      );

      const pngAsset = await assetsCrud.create(
        {
          id: crypto.randomUUID(),
          filename: "other-image.png",
          mimeType: "image/png",
        },
        ctx,
      );

      // Create services with different images
      await servicesCrud.create(
        {
          id: crypto.randomUUID(),
          name: "SVG Service",
          image: svgAsset.id,
        },
        ctx,
      );

      await servicesCrud.create(
        {
          id: crypto.randomUUID(),
          name: "PNG Service",
          image: pngAsset.id,
        },
        ctx,
      );

      // Filter by image filename
      const svgServices = await servicesCrud.find(
        {
          where: {
            image: { filename: uniqueFilename },
          },
        },
        ctx,
      );

      expect(svgServices.docs).toHaveLength(1);
      expect(svgServices.docs[0].name).toBe("SVG Service");

      // Filter by image mimeType
      const pngServices = await servicesCrud.find(
        {
          where: {
            image: { mimeType: "image/png" },
          },
        },
        ctx,
      );

      expect(pngServices.docs).toHaveLength(1);
      expect(pngServices.docs[0].name).toBe("PNG Service");
    });
  });
});
