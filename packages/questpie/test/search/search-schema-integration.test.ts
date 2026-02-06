import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { questpie } from "../../src/server/index.js";
import {
  createPgVectorSearchAdapter,
  type PgVectorSearchAdapter,
} from "../../src/server/integrated/search/adapters/pgvector.js";
import { createPostgresSearchAdapter } from "../../src/server/integrated/search/adapters/postgres.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";

/**
 * Tests for Search Adapter Schema Integration
 *
 * These tests verify that adapters correctly implement getTableSchemas() and getExtensions()
 * for migration integration.
 */

describe("Search Schema Integration", () => {
  describe("PostgresSearchAdapter", () => {
    const adapter = createPostgresSearchAdapter();

    describe("getTableSchemas()", () => {
      it("should return search tables", () => {
        const schemas = adapter.getTableSchemas();

        expect(schemas).toBeDefined();
        expect(Object.keys(schemas)).toHaveLength(2);
        expect(schemas.questpie_search).toBeDefined();
        expect(schemas.questpie_search_facets).toBeDefined();
      });

      it("should return valid Drizzle table objects", () => {
        const schemas = adapter.getTableSchemas();

        // Verify tables have Drizzle internal symbols
        const searchTable = schemas.questpie_search;
        expect(searchTable[Symbol.for("drizzle:Name")]).toBe("questpie_search");

        const facetsTable = schemas.questpie_search_facets;
        expect(facetsTable[Symbol.for("drizzle:Name")]).toBe(
          "questpie_search_facets",
        );
      });
    });

    describe("getExtensions()", () => {
      it("should return pg_trgm extension", () => {
        const extensions = adapter.getExtensions();

        expect(extensions).toHaveLength(1);
        expect(extensions[0]).toBe("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
      });
    });
  });

  describe("PgVectorSearchAdapter", () => {
    // Create a mock embedding provider for the adapter
    const mockEmbeddingProvider = {
      name: "mock",
      dimensions: 1536,
      model: "mock-model",
      generate: async (_text: string) => new Array(1536).fill(0),
    };

    const adapter = createPgVectorSearchAdapter({
      embeddingProvider: mockEmbeddingProvider,
    });

    describe("getTableSchemas()", () => {
      it("should return same tables as PostgresSearchAdapter", () => {
        const schemas = adapter.getTableSchemas();

        expect(schemas).toBeDefined();
        expect(Object.keys(schemas)).toHaveLength(2);
        expect(schemas.questpie_search).toBeDefined();
        expect(schemas.questpie_search_facets).toBeDefined();
      });
    });

    describe("getExtensions()", () => {
      it("should return pg_trgm and vector extensions", () => {
        const extensions = adapter.getExtensions();

        expect(extensions).toHaveLength(2);
        expect(extensions).toContain("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
        expect(extensions).toContain("CREATE EXTENSION IF NOT EXISTS vector;");
      });
    });
  });

  describe("External Adapter Pattern (no local storage)", () => {
    it("should document that external adapters return undefined for getTableSchemas", () => {
      // This test documents the expected behavior for external adapters
      // External adapters (Meilisearch, Elasticsearch) don't implement getTableSchemas()
      // which means cms.getSchema() won't include any search tables

      // Example of how an external adapter would be defined:
      const externalAdapterPattern = {
        name: "meilisearch",
        // No getTableSchemas method - external storage
        // No getExtensions method - no PostgreSQL extensions needed
      };

      expect(externalAdapterPattern.name).toBe("meilisearch");
      expect((externalAdapterPattern as any).getTableSchemas).toBeUndefined();
      expect((externalAdapterPattern as any).getExtensions).toBeUndefined();
    });
  });
});

// ============================================================================
// Create questpie builder with default fields
// ============================================================================

const q = questpie({ name: "schema-test" }).fields(defaultFields);

// ============================================================================
// CMS Integration Tests
// ============================================================================

describe("CMS getSchema() Integration", () => {
  // Test collection
  const posts = q
    .collection("posts")
    .fields((f) => ({
      title: f.text({ required: true, maxLength: 255 }),
      content: f.textarea(),
    }))
    .title(({ f }) => f.title)
    .options({ timestamps: true });

  const testModule = q.collections({
    posts,
  });

  describe("with PostgresSearchAdapter", () => {
    let setup: Awaited<ReturnType<typeof buildMockApp<typeof testModule>>>;

    beforeEach(async () => {
      const adapter = createPostgresSearchAdapter();
      setup = await buildMockApp(testModule, {
        search: adapter,
      });
    });

    afterEach(async () => {
      await setup.cleanup();
    });

    it("should include search tables in getSchema()", () => {
      const schema = setup.cms.getSchema();

      // Collection tables should be present
      expect(schema.posts).toBeDefined();

      // Search tables should be present (from adapter.getTableSchemas())
      expect(schema.questpie_search).toBeDefined();
      expect(schema.questpie_search_facets).toBeDefined();

      // Realtime table should always be present
      expect(schema.questpie_realtime_log).toBeDefined();
    });

    it("should return proper Drizzle table objects for search tables", () => {
      const schema = setup.cms.getSchema();

      // Verify search tables are proper Drizzle objects
      const searchTable = schema.questpie_search as any;
      const facetsTable = schema.questpie_search_facets as any;

      expect(searchTable[Symbol.for("drizzle:Name")]).toBe("questpie_search");
      expect(facetsTable[Symbol.for("drizzle:Name")]).toBe(
        "questpie_search_facets",
      );
    });
  });

  describe("without explicit search adapter (uses default)", () => {
    let setup: Awaited<ReturnType<typeof buildMockApp<typeof testModule>>>;

    beforeEach(async () => {
      // No search adapter explicitly configured - uses default PostgresSearchAdapter
      setup = await buildMockApp(testModule, {});
    });

    afterEach(async () => {
      await setup.cleanup();
    });

    it("should STILL include search tables (default PostgresSearchAdapter)", () => {
      const schema = setup.cms.getSchema();

      // Collection tables should be present
      expect(schema.posts).toBeDefined();

      // Search tables SHOULD be present (default adapter is PostgresSearchAdapter)
      // This is intentional - users get search out of the box
      expect(schema.questpie_search).toBeDefined();
      expect(schema.questpie_search_facets).toBeDefined();

      // Realtime table should always be present
      expect(schema.questpie_realtime_log).toBeDefined();
    });
  });
});
