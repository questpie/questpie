import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { questpie } from "../../src/server/index.js";
import { createPostgresSearchAdapter } from "../../src/server/integrated/search/adapters/postgres.js";
import { extractFacetValues } from "../../src/server/integrated/search/facet-utils.js";
import type { FacetsConfig } from "../../src/server/integrated/search/types.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../utils/test-db";

// ============================================================================
// Create questpie builder with default fields
// ============================================================================

const q = questpie({ name: "facets-test" }).fields(defaultFields);

// ============================================================================
// Test Collections
// ============================================================================

const products = q
  .collection("products")
  .fields((f) => ({
    name: f.text({ required: true, maxLength: 255 }),
    description: f.textarea(),
    status: f.text({ maxLength: 50, default: "draft" }),
    category: f.text({ maxLength: 100 }),
    price: f.number(),
    tags: f.json({ default: [] }),
  }))
  .title(({ f }) => f.name)
  .searchable({
    content: (record) => record.description || "",
    metadata: (record) => ({
      status: record.status,
      category: record.category,
      price: record.price,
      tags: record.tags,
    }),
    facets: {
      status: true,
      category: true,
      tags: { type: "array" },
      price: {
        type: "range",
        buckets: [
          { label: "Under $50", max: 50 },
          { label: "$50-$100", min: 50, max: 100 },
          { label: "$100-$500", min: 100, max: 500 },
          { label: "$500+", min: 500 },
        ],
      },
    },
  })
  .options({ timestamps: true });

const articles = q
  .collection("articles")
  .fields((f) => ({
    title: f.text({ required: true, maxLength: 255 }),
    content: f.textarea(),
    categoryPath: f.text({ maxLength: 255 }),
  }))
  .title(({ f }) => f.title)
  .searchable({
    content: (record) => record.content || "",
    metadata: (record) => ({
      categoryPath: record.categoryPath,
    }),
    facets: {
      categoryPath: { type: "hierarchy", separator: " > " },
    },
  })
  .options({ timestamps: true });

const testModule = q.collections({
  products,
  articles,
});

// ============================================================================
// Unit Tests for extractFacetValues
// ============================================================================

describe("extractFacetValues", () => {
  it("should extract simple string facets", () => {
    const metadata = { status: "published", category: "electronics" };
    const config: FacetsConfig = { status: true, category: true };

    const facets = extractFacetValues(metadata, config);

    expect(facets).toEqual([
      { name: "status", value: "published" },
      { name: "category", value: "electronics" },
    ]);
  });

  it("should extract array facets (multi-value)", () => {
    const metadata = { tags: ["react", "typescript", "frontend"] };
    const config: FacetsConfig = { tags: { type: "array" } };

    const facets = extractFacetValues(metadata, config);

    expect(facets).toEqual([
      { name: "tags", value: "react" },
      { name: "tags", value: "typescript" },
      { name: "tags", value: "frontend" },
    ]);
  });

  it("should extract range facets with buckets", () => {
    const config: FacetsConfig = {
      price: {
        type: "range",
        buckets: [
          { label: "Under $50", max: 50 },
          { label: "$50-$100", min: 50, max: 100 },
          { label: "$100+", min: 100 },
        ],
      },
    };

    expect(extractFacetValues({ price: 25 }, config)).toEqual([
      { name: "price", value: "Under $50", numericValue: 25 },
    ]);

    expect(extractFacetValues({ price: 75 }, config)).toEqual([
      { name: "price", value: "$50-$100", numericValue: 75 },
    ]);

    expect(extractFacetValues({ price: 150 }, config)).toEqual([
      { name: "price", value: "$100+", numericValue: 150 },
    ]);
  });

  it("should extract hierarchical facets", () => {
    const metadata = { category: "Electronics > Phones > iPhone" };
    const config: FacetsConfig = {
      category: { type: "hierarchy", separator: " > " },
    };

    const facets = extractFacetValues(metadata, config);

    expect(facets).toEqual([
      { name: "category", value: "Electronics" },
      { name: "category", value: "Electronics > Phones" },
      { name: "category", value: "Electronics > Phones > iPhone" },
    ]);
  });

  it("should skip null/undefined values", () => {
    const metadata = { status: null, category: undefined, name: "test" };
    const config: FacetsConfig = { status: true, category: true };

    const facets = extractFacetValues(metadata, config);

    expect(facets).toEqual([]);
  });

  it("should handle empty arrays", () => {
    const metadata = { tags: [] };
    const config: FacetsConfig = { tags: { type: "array" } };

    const facets = extractFacetValues(metadata, config);

    expect(facets).toEqual([]);
  });
});

// ============================================================================
// Integration Tests for Faceted Search
// ============================================================================

describe("PostgresSearchAdapter Facets", () => {
  let setup: Awaited<ReturnType<typeof buildMockApp<typeof testModule>>>;

  beforeEach(async () => {
    const adapter = createPostgresSearchAdapter();

    setup = await buildMockApp(testModule, {
      search: adapter,
    });

    await runTestDbMigrations(setup.cms);
    await runSearchMigrations(setup.cms.db);
  });

  afterEach(async () => {
    await setup.cleanup();
  });

  describe("string facets", () => {
    it("should return facet counts for string fields", async () => {
      // Index products with different statuses
      await indexProduct(setup, "1", "Product A", { status: "published" });
      await indexProduct(setup, "2", "Product B", { status: "published" });
      await indexProduct(setup, "3", "Product C", { status: "draft" });

      const response = await setup.cms.search.search({
        query: "Product",
        locale: "en",
        facets: [{ field: "status" }],
      });

      expect(response.facets).toBeDefined();
      expect(response.facets!.length).toBe(1);

      const statusFacet = response.facets![0];
      expect(statusFacet.field).toBe("status");
      expect(statusFacet.values).toContainEqual({
        value: "published",
        count: 2,
      });
      expect(statusFacet.values).toContainEqual({ value: "draft", count: 1 });
    });

    it("should respect facet limit", async () => {
      // Index products with many categories
      await indexProduct(setup, "1", "Product A", { category: "cat-a" });
      await indexProduct(setup, "2", "Product B", { category: "cat-b" });
      await indexProduct(setup, "3", "Product C", { category: "cat-c" });
      await indexProduct(setup, "4", "Product D", { category: "cat-d" });
      await indexProduct(setup, "5", "Product E", { category: "cat-e" });

      const response = await setup.cms.search.search({
        query: "Product",
        locale: "en",
        facets: [{ field: "category", limit: 3 }],
      });

      expect(response.facets![0].values.length).toBe(3);
    });

    it("should sort by count by default", async () => {
      await indexProduct(setup, "1", "Product A", { status: "published" });
      await indexProduct(setup, "2", "Product B", { status: "published" });
      await indexProduct(setup, "3", "Product C", { status: "published" });
      await indexProduct(setup, "4", "Product D", { status: "draft" });

      const response = await setup.cms.search.search({
        query: "Product",
        locale: "en",
        facets: [{ field: "status", sortBy: "count" }],
      });

      const values = response.facets![0].values;
      expect(values[0].value).toBe("published");
      expect(values[0].count).toBe(3);
    });

    it("should sort alphabetically when requested", async () => {
      await indexProduct(setup, "1", "Product A", { category: "zebra" });
      await indexProduct(setup, "2", "Product B", { category: "apple" });
      await indexProduct(setup, "3", "Product C", { category: "banana" });

      const response = await setup.cms.search.search({
        query: "Product",
        locale: "en",
        facets: [{ field: "category", sortBy: "alpha" }],
      });

      const values = response.facets![0].values;
      expect(values[0].value).toBe("apple");
      expect(values[1].value).toBe("banana");
      expect(values[2].value).toBe("zebra");
    });
  });

  describe("multi-value facets (array)", () => {
    it("should count record in multiple facet values", async () => {
      // Product with multiple tags
      await indexProduct(setup, "1", "React App", {
        tags: ["react", "typescript"],
      });
      await indexProduct(setup, "2", "Vue App", {
        tags: ["vue", "typescript"],
      });
      await indexProduct(setup, "3", "Angular App", { tags: ["angular"] });

      const response = await setup.cms.search.search({
        query: "App",
        locale: "en",
        facets: [{ field: "tags" }],
      });

      const tagsFacet = response.facets![0];
      expect(tagsFacet.values).toContainEqual({
        value: "typescript",
        count: 2,
      });
      expect(tagsFacet.values).toContainEqual({ value: "react", count: 1 });
      expect(tagsFacet.values).toContainEqual({ value: "vue", count: 1 });
      expect(tagsFacet.values).toContainEqual({ value: "angular", count: 1 });
    });
  });

  describe("range facets", () => {
    it("should bucket values into ranges", async () => {
      await indexProduct(setup, "1", "Cheap Product", { price: 25 });
      await indexProduct(setup, "2", "Mid Product", { price: 75 });
      await indexProduct(setup, "3", "Expensive Product", { price: 150 });
      await indexProduct(setup, "4", "Premium Product", { price: 600 });

      const response = await setup.cms.search.search({
        query: "Product",
        locale: "en",
        facets: [{ field: "price" }],
      });

      const priceFacet = response.facets![0];
      expect(priceFacet.values).toContainEqual({
        value: "Under $50",
        count: 1,
      });
      expect(priceFacet.values).toContainEqual({
        value: "$50-$100",
        count: 1,
      });
      expect(priceFacet.values).toContainEqual({
        value: "$100-$500",
        count: 1,
      });
      expect(priceFacet.values).toContainEqual({ value: "$500+", count: 1 });
    });

    it("should return min/max stats", async () => {
      await indexProduct(setup, "1", "Product A", { price: 25 });
      await indexProduct(setup, "2", "Product B", { price: 150 });
      await indexProduct(setup, "3", "Product C", { price: 600 });

      const response = await setup.cms.search.search({
        query: "Product",
        locale: "en",
        facets: [{ field: "price" }],
      });

      const priceFacet = response.facets![0];
      expect(priceFacet.stats).toBeDefined();
      expect(priceFacet.stats!.min).toBe(25);
      expect(priceFacet.stats!.max).toBe(600);
    });
  });

  describe("hierarchical facets", () => {
    it("should expand hierarchy into multiple facet values", async () => {
      await setup.cms.search.index({
        collection: "articles",
        recordId: "1",
        locale: "en",
        title: "iPhone Review",
        facets: extractFacetValues(
          { categoryPath: "Electronics > Phones > iPhone" },
          { categoryPath: { type: "hierarchy", separator: " > " } },
        ),
      });

      await setup.cms.search.index({
        collection: "articles",
        recordId: "2",
        locale: "en",
        title: "Samsung Review",
        facets: extractFacetValues(
          { categoryPath: "Electronics > Phones > Samsung" },
          { categoryPath: { type: "hierarchy", separator: " > " } },
        ),
      });

      await setup.cms.search.index({
        collection: "articles",
        recordId: "3",
        locale: "en",
        title: "Laptop Review",
        facets: extractFacetValues(
          { categoryPath: "Electronics > Computers" },
          { categoryPath: { type: "hierarchy", separator: " > " } },
        ),
      });

      const response = await setup.cms.search.search({
        query: "Review",
        locale: "en",
        collections: ["articles"],
        facets: [{ field: "categoryPath" }],
      });

      const categoryFacet = response.facets![0];

      // "Electronics" should have count 3 (all articles)
      expect(categoryFacet.values).toContainEqual({
        value: "Electronics",
        count: 3,
      });

      // "Electronics > Phones" should have count 2
      expect(categoryFacet.values).toContainEqual({
        value: "Electronics > Phones",
        count: 2,
      });

      // Individual leaf categories should have count 1
      expect(categoryFacet.values).toContainEqual({
        value: "Electronics > Phones > iPhone",
        count: 1,
      });
    });
  });

  describe("dynamic facet counts", () => {
    it("should reflect current query in facet counts", async () => {
      await indexProduct(setup, "1", "TypeScript Guide", {
        status: "published",
      });
      await indexProduct(setup, "2", "JavaScript Guide", {
        status: "published",
      });
      await indexProduct(setup, "3", "TypeScript Advanced", {
        status: "draft",
      });

      // Search for "TypeScript" - should only count TypeScript products
      const response = await setup.cms.search.search({
        query: "TypeScript",
        locale: "en",
        facets: [{ field: "status" }],
      });

      expect(response.total).toBe(2);
      const statusFacet = response.facets![0];
      expect(statusFacet.values).toContainEqual({
        value: "published",
        count: 1,
      });
      expect(statusFacet.values).toContainEqual({ value: "draft", count: 1 });
    });

    it("should reflect filters in facet counts", async () => {
      await indexProduct(setup, "1", "Product A", {
        status: "published",
        category: "tech",
      });
      await indexProduct(setup, "2", "Product B", {
        status: "published",
        category: "lifestyle",
      });
      await indexProduct(setup, "3", "Product C", {
        status: "draft",
        category: "tech",
      });

      // Filter by status=published, count categories
      const response = await setup.cms.search.search({
        query: "Product",
        locale: "en",
        filters: { status: "published" },
        facets: [{ field: "category" }],
      });

      expect(response.total).toBe(2);
      const categoryFacet = response.facets![0];
      expect(categoryFacet.values).toContainEqual({ value: "tech", count: 1 });
      expect(categoryFacet.values).toContainEqual({
        value: "lifestyle",
        count: 1,
      });
    });
  });

  describe("browse mode (no query)", () => {
    it("should return facets without a search query", async () => {
      await indexProduct(setup, "1", "Product A", { status: "published" });
      await indexProduct(setup, "2", "Product B", { status: "draft" });

      const response = await setup.cms.search.search({
        query: "",
        locale: "en",
        facets: [{ field: "status" }],
      });

      expect(response.facets).toBeDefined();
      const statusFacet = response.facets![0];
      expect(statusFacet.values.length).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

async function runSearchMigrations(db: any): Promise<void> {
  const adapter = createPostgresSearchAdapter();
  const migrations = adapter.getMigrations();

  for (const migration of migrations) {
    try {
      await db.execute(sql.raw(migration.up));
    } catch (error: any) {
      if (
        !error.message?.includes("already exists") &&
        !error.message?.includes("does not exist")
      ) {
        console.warn(`Migration ${migration.name} warning:`, error.message);
      }
    }
  }
}

async function indexProduct(
  setup: any,
  id: string,
  name: string,
  metadata: {
    status?: string;
    category?: string;
    price?: number;
    tags?: string[];
  },
): Promise<void> {
  const facetsConfig: FacetsConfig = {
    status: true,
    category: true,
    tags: { type: "array" },
    price: {
      type: "range",
      buckets: [
        { label: "Under $50", max: 50 },
        { label: "$50-$100", min: 50, max: 100 },
        { label: "$100-$500", min: 100, max: 500 },
        { label: "$500+", min: 500 },
      ],
    },
  };

  await setup.cms.search.index({
    collection: "products",
    recordId: id,
    locale: "en",
    title: name,
    metadata,
    facets: extractFacetValues(metadata, facetsConfig),
  });
}
