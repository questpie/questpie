import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { questpie } from "../../src/server/index.js";
import {
  createPostgresSearchAdapter,
  type PostgresSearchAdapter,
} from "../../src/server/integrated/search/adapters/postgres.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

// ============================================================================
// Create questpie builder with default fields
// ============================================================================

const q = questpie({ name: "search-test" }).fields(defaultFields);

// ============================================================================
// Test Collections
// ============================================================================

const posts = q
  .collection("posts")
  .fields((f) => ({
    title: f.text({ required: true, maxLength: 255 }),
    content: f.textarea(),
    status: f.text({ maxLength: 50, default: "draft" }),
  }))
  .title(({ f }) => f.title)
  .searchable({
    content: (record) => record.content || "",
    metadata: (record) => ({ status: record.status }),
  })
  .options({ timestamps: true });

const products = q
  .collection("products")
  .fields((f) => ({
    name: f.text({ required: true, maxLength: 255 }),
    description: f.textarea(),
    sku: f.text({ required: true, maxLength: 50 }),
  }))
  .title(({ f }) => f.name)
  .searchable({
    content: (record) => record.description || "",
    metadata: (record) => ({ sku: record.sku }),
  })
  .options({ timestamps: true });

const testModule = q.collections({
  posts,
  products,
});

// ============================================================================
// Tests
// ============================================================================

describe("PostgresSearchAdapter", () => {
  let setup: Awaited<ReturnType<typeof buildMockApp<typeof testModule>>>;
  let adapter: PostgresSearchAdapter;

  beforeEach(async () => {
    adapter = createPostgresSearchAdapter({
      trigramThreshold: 0.3,
      ftsWeight: 0.7,
    });

    setup = await buildMockApp(testModule, {
      search: adapter,
    });

    await runTestDbMigrations(setup.cms);

    // Run search adapter migrations manually for test DB
    await runSearchMigrations(setup.cms.db);
  });

  afterEach(async () => {
    await setup.cleanup();
  });

  describe("initialization", () => {
    it("should initialize adapter with correct name", () => {
      expect(adapter.name).toBe("postgres");
    });

    it("should report lexical capability as true", () => {
      expect(adapter.capabilities.lexical).toBe(true);
    });

    it("should report semantic capability as false", () => {
      expect(adapter.capabilities.semantic).toBe(false);
    });
  });

  describe("getMigrations", () => {
    it("should return migration definitions", () => {
      const migrations = adapter.getMigrations();

      expect(migrations.length).toBeGreaterThan(0);
      expect(migrations[0].name).toBe("search_001_create_table");
      expect(migrations[0].up).toContain("CREATE TABLE");
      expect(migrations[0].down).toContain("DROP TABLE");
    });

    it("should include FTS index migration", () => {
      const migrations = adapter.getMigrations();
      const ftsIndex = migrations.find(
        (m) => m.name === "search_002_fts_index",
      );

      expect(ftsIndex).toBeDefined();
      expect(ftsIndex!.up).toContain("idx_search_fts");
    });

    it("should include trigram migrations", () => {
      const migrations = adapter.getMigrations();
      const trigramExt = migrations.find(
        (m) => m.name === "search_005_trigram_extension",
      );
      const trigramIndex = migrations.find(
        (m) => m.name === "search_006_trigram_index",
      );

      expect(trigramExt).toBeDefined();
      expect(trigramIndex).toBeDefined();
    });
  });

  describe("getTableSchemas", () => {
    it("should return search table schemas", () => {
      const schemas = adapter.getTableSchemas();

      expect(schemas).toBeDefined();
      expect(schemas.questpie_search).toBeDefined();
      expect(schemas.questpie_search_facets).toBeDefined();
    });

    it("should return Drizzle table objects", () => {
      const schemas = adapter.getTableSchemas();

      // Check that these are Drizzle table objects (have Symbol for name)
      const searchTable = schemas.questpie_search;
      const facetsTable = schemas.questpie_search_facets;

      // Drizzle tables have a Symbol.for("drizzle:Name") property
      expect(searchTable[Symbol.for("drizzle:Name")]).toBe("questpie_search");
      expect(facetsTable[Symbol.for("drizzle:Name")]).toBe(
        "questpie_search_facets",
      );
    });
  });

  describe("getExtensions", () => {
    it("should return pg_trgm extension", () => {
      const extensions = adapter.getExtensions();

      expect(extensions).toBeDefined();
      expect(extensions.length).toBeGreaterThan(0);
      expect(extensions).toContain("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
    });
  });

  describe("cms.getSchema() integration", () => {
    it("should include search tables in cms.getSchema()", () => {
      const schema = setup.cms.getSchema();

      // Should include search tables from adapter
      expect(schema.questpie_search).toBeDefined();
      expect(schema.questpie_search_facets).toBeDefined();
    });

    it("should include collection tables alongside search tables", () => {
      const schema = setup.cms.getSchema();

      // Collection tables
      expect(schema.posts).toBeDefined();
      expect(schema.products).toBeDefined();

      // Search tables
      expect(schema.questpie_search).toBeDefined();
      expect(schema.questpie_search_facets).toBeDefined();

      // Realtime table (always included)
      expect(schema.questpie_realtime_log).toBeDefined();
    });
  });

  describe("cms.migrations.ensureExtensions()", () => {
    it("should run extensions without error", async () => {
      // ensureExtensions is idempotent - can be called multiple times
      const result = await setup.cms.migrations.ensureExtensions();

      // Should have either applied or skipped the extension
      expect(result.applied.length + result.skipped.length).toBeGreaterThan(0);
    });

    it("should handle already existing extensions gracefully", async () => {
      // Run twice - second time should skip
      await setup.cms.migrations.ensureExtensions();
      const result = await setup.cms.migrations.ensureExtensions();

      // Should be skipped (already exists) or applied (no error)
      expect(result.applied.length + result.skipped.length).toBeGreaterThan(0);
    });
  });

  describe("index and search", () => {
    it("should index a record", async () => {
      await setup.cms.search.index({
        collection: "posts",
        recordId: "post-1",
        locale: "en",
        title: "Hello World",
        content: "This is my first blog post about programming",
        metadata: { status: "published" },
      });

      // Search should find it
      const response = await setup.cms.search.search({
        query: "Hello",
        locale: "en",
      });

      expect(response.results.length).toBe(1);
      expect(response.results[0].title).toBe("Hello World");
      expect(response.results[0].collection).toBe("posts");
      expect(response.results[0].recordId).toBe("post-1");
    });

    it("should search with FTS", async () => {
      // Index multiple records
      await setup.cms.search.index({
        collection: "posts",
        recordId: "post-1",
        locale: "en",
        title: "Introduction to TypeScript",
        content: "TypeScript is a typed superset of JavaScript",
      });

      await setup.cms.search.index({
        collection: "posts",
        recordId: "post-2",
        locale: "en",
        title: "Learning JavaScript",
        content: "JavaScript is the language of the web",
      });

      await setup.cms.search.index({
        collection: "posts",
        recordId: "post-3",
        locale: "en",
        title: "Python for Beginners",
        content: "Python is great for data science",
      });

      // Search for TypeScript
      const response = await setup.cms.search.search({
        query: "TypeScript",
        locale: "en",
      });

      expect(response.results.length).toBe(1);
      expect(response.results[0].recordId).toBe("post-1");
    });

    it("should search across content field", async () => {
      await setup.cms.search.index({
        collection: "posts",
        recordId: "post-1",
        locale: "en",
        title: "My Blog Post",
        content: "This post is about database optimization techniques",
      });

      const response = await setup.cms.search.search({
        query: "database optimization",
        locale: "en",
      });

      expect(response.results.length).toBe(1);
      expect(response.results[0].recordId).toBe("post-1");
    });

    it("should filter by collection", async () => {
      await setup.cms.search.index({
        collection: "posts",
        recordId: "post-1",
        locale: "en",
        title: "Blog about Widgets",
        content: "Widgets are great",
      });

      await setup.cms.search.index({
        collection: "products",
        recordId: "product-1",
        locale: "en",
        title: "Super Widget",
        content: "The best widget ever",
      });

      // Search only in posts
      const postsResponse = await setup.cms.search.search({
        query: "Widget",
        collections: ["posts"],
        locale: "en",
      });

      expect(postsResponse.results.length).toBe(1);
      expect(postsResponse.results[0].collection).toBe("posts");

      // Search only in products
      const productsResponse = await setup.cms.search.search({
        query: "Widget",
        collections: ["products"],
        locale: "en",
      });

      expect(productsResponse.results.length).toBe(1);
      expect(productsResponse.results[0].collection).toBe("products");
    });

    it("should filter by locale", async () => {
      await setup.cms.search.index({
        collection: "posts",
        recordId: "post-1",
        locale: "en",
        title: "Hello World",
      });

      await setup.cms.search.index({
        collection: "posts",
        recordId: "post-1",
        locale: "sk",
        title: "Ahoj Svet",
      });

      const enResponse = await setup.cms.search.search({
        query: "Hello",
        locale: "en",
      });
      expect(enResponse.results.length).toBe(1);

      const skResponse = await setup.cms.search.search({
        query: "Ahoj",
        locale: "sk",
      });
      expect(skResponse.results.length).toBe(1);

      // Should not find Slovak content in English locale
      const noResponse = await setup.cms.search.search({
        query: "Ahoj",
        locale: "en",
      });
      expect(noResponse.results.length).toBe(0);
    });

    it("should filter by metadata", async () => {
      await setup.cms.search.index({
        collection: "posts",
        recordId: "post-1",
        locale: "en",
        title: "Published Post",
        metadata: { status: "published" },
      });

      await setup.cms.search.index({
        collection: "posts",
        recordId: "post-2",
        locale: "en",
        title: "Draft Post",
        metadata: { status: "draft" },
      });

      const response = await setup.cms.search.search({
        query: "Post",
        locale: "en",
        filters: { status: "published" },
      });

      expect(response.results.length).toBe(1);
      expect(response.results[0].recordId).toBe("post-1");
    });

    it("should return highlights", async () => {
      await setup.cms.search.index({
        collection: "posts",
        recordId: "post-1",
        locale: "en",
        title: "TypeScript Tutorial",
        content: "Learn TypeScript step by step with examples",
      });

      const response = await setup.cms.search.search({
        query: "TypeScript",
        locale: "en",
        highlights: true,
      });

      expect(response.results.length).toBe(1);
      expect(response.results[0].highlights?.title).toContain("<mark>");
      expect(response.results[0].highlights?.content).toContain("<mark>");
    });

    it("should respect limit and offset", async () => {
      // Index 5 posts
      for (let i = 1; i <= 5; i++) {
        await setup.cms.search.index({
          collection: "posts",
          recordId: `post-${i}`,
          locale: "en",
          title: `Post number ${i}`,
        });
      }

      const page1 = await setup.cms.search.search({
        query: "Post",
        locale: "en",
        limit: 2,
        offset: 0,
      });
      expect(page1.results.length).toBe(2);

      const page2 = await setup.cms.search.search({
        query: "Post",
        locale: "en",
        limit: 2,
        offset: 2,
      });
      expect(page2.results.length).toBe(2);

      const page3 = await setup.cms.search.search({
        query: "Post",
        locale: "en",
        limit: 2,
        offset: 4,
      });
      expect(page3.results.length).toBe(1);
    });

    it("should return total count", async () => {
      // Index 5 posts
      for (let i = 1; i <= 5; i++) {
        await setup.cms.search.index({
          collection: "posts",
          recordId: `post-${i}`,
          locale: "en",
          title: `Post number ${i}`,
        });
      }

      const response = await setup.cms.search.search({
        query: "Post",
        locale: "en",
        limit: 2,
      });

      expect(response.results.length).toBe(2);
      expect(response.total).toBe(5);
    });
  });

  describe("remove", () => {
    it("should remove a record from index", async () => {
      await setup.cms.search.index({
        collection: "posts",
        recordId: "post-1",
        locale: "en",
        title: "Hello World",
      });

      // Verify it exists
      let response = await setup.cms.search.search({
        query: "Hello",
        locale: "en",
      });
      expect(response.results.length).toBe(1);

      // Remove it
      await setup.cms.search.remove({
        collection: "posts",
        recordId: "post-1",
        locale: "en",
      });

      // Verify it's gone
      response = await setup.cms.search.search({
        query: "Hello",
        locale: "en",
      });
      expect(response.results.length).toBe(0);
    });

    it("should remove all locales when locale not specified", async () => {
      await setup.cms.search.index({
        collection: "posts",
        recordId: "post-1",
        locale: "en",
        title: "Hello World",
      });

      await setup.cms.search.index({
        collection: "posts",
        recordId: "post-1",
        locale: "sk",
        title: "Ahoj Svet",
      });

      // Remove without locale
      await setup.cms.search.remove({
        collection: "posts",
        recordId: "post-1",
      });

      // Both should be gone
      const enResponse = await setup.cms.search.search({
        query: "Hello",
        locale: "en",
      });
      expect(enResponse.results.length).toBe(0);

      const skResponse = await setup.cms.search.search({
        query: "Ahoj",
        locale: "sk",
      });
      expect(skResponse.results.length).toBe(0);
    });
  });

  describe("clear", () => {
    it("should clear all indexed data", async () => {
      await setup.cms.search.index({
        collection: "posts",
        recordId: "post-1",
        locale: "en",
        title: "Post 1",
      });

      await setup.cms.search.index({
        collection: "products",
        recordId: "product-1",
        locale: "en",
        title: "Product 1",
      });

      await setup.cms.search.clear();

      const postsResponse = await setup.cms.search.search({
        query: "Post",
        locale: "en",
      });
      expect(postsResponse.results.length).toBe(0);

      const productsResponse = await setup.cms.search.search({
        query: "Product",
        locale: "en",
      });
      expect(productsResponse.results.length).toBe(0);
    });
  });

  describe("upsert behavior", () => {
    it("should update existing index entry on re-index", async () => {
      // Index original
      await setup.cms.search.index({
        collection: "posts",
        recordId: "post-1",
        locale: "en",
        title: "Original Title",
        content: "Original content",
      });

      // Re-index with new data
      await setup.cms.search.index({
        collection: "posts",
        recordId: "post-1",
        locale: "en",
        title: "Updated Title",
        content: "Updated content",
      });

      // Search for original should not find
      const originalResponse = await setup.cms.search.search({
        query: "Original",
        locale: "en",
      });
      expect(originalResponse.results.length).toBe(0);

      // Search for updated should find
      const updatedResponse = await setup.cms.search.search({
        query: "Updated",
        locale: "en",
      });
      expect(updatedResponse.results.length).toBe(1);
      expect(updatedResponse.results[0].title).toBe("Updated Title");
    });
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Run search adapter migrations on test database
 */
async function runSearchMigrations(db: any): Promise<void> {
  const adapter = createPostgresSearchAdapter();
  const migrations = adapter.getMigrations();

  for (const migration of migrations) {
    try {
      await db.execute(sql.raw(migration.up));
    } catch (error: any) {
      // Ignore "already exists" errors for idempotency
      if (
        !error.message?.includes("already exists") &&
        !error.message?.includes("does not exist")
      ) {
        console.warn(`Migration ${migration.name} warning:`, error.message);
      }
    }
  }
}
