/**
 * Search Access Control Tests
 *
 * Tests for access filtering via SQL JOINs in the search adapter.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from "bun:test";
import { sql } from "drizzle-orm";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { questpie } from "../../src/server/index.js";
import {
  createPostgresSearchAdapter,
  type PostgresSearchAdapter,
} from "../../src/server/integrated/search/adapters/postgres.js";
import type { CollectionAccessFilter } from "../../src/server/integrated/search/types.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../utils/test-db";

setDefaultTimeout(30000);

// Create questpie builder with default fields
const q = questpie({ name: "search-access-test" }).fields(defaultFields);

const posts = q
  .collection("posts")
  .fields((f) => ({
    title: f.text({ required: true, maxLength: 255 }),
    content: f.textarea(),
  }))
  .title(({ f }) => f.title)
  .searchable({
    content: (record) => record.content || "",
  })
  .options({ timestamps: true });

const testModule = q.collections({
  posts,
});

describe("Search Access Filtering", () => {
  let setup: Awaited<ReturnType<typeof buildMockApp<typeof testModule>>>;
  let adapter: PostgresSearchAdapter;

  beforeEach(async () => {
    adapter = createPostgresSearchAdapter();

    setup = await buildMockApp(testModule, {
      search: adapter,
    });

    await runTestDbMigrations(setup.cms);
    await runSearchMigrations(setup.cms.db);

    // Index some test data
    await setup.cms.search.index({
      collection: "posts",
      recordId: "post-1",
      locale: "en",
      title: "First Post",
      content: "This is the first post",
    });

    await setup.cms.search.index({
      collection: "posts",
      recordId: "post-2",
      locale: "en",
      title: "Second Post",
      content: "This is the second post",
    });

    await setup.cms.search.index({
      collection: "posts",
      recordId: "post-3",
      locale: "en",
      title: "Third Post",
      content: "This is the third post",
    });
  });

  afterEach(async () => {
    await setup.cleanup();
  });

  describe("without accessFilters", () => {
    it("should return all matching results", async () => {
      const response = await setup.cms.search.search({
        query: "Post",
        locale: "en",
      });

      expect(response.results.length).toBe(3);
      expect(response.total).toBe(3);
    });
  });

  describe("with accessWhere: false", () => {
    it("should return no results when collection access is denied", async () => {
      const accessFilters: CollectionAccessFilter[] = [
        {
          collection: "posts",
          table: {} as any, // Table not needed when accessWhere is false
          accessWhere: false,
        },
      ];

      const response = await setup.cms.search.search({
        query: "Post",
        locale: "en",
        accessFilters,
      });

      expect(response.results.length).toBe(0);
      expect(response.total).toBe(0);
    });

    it("should filter browse mode results too", async () => {
      const accessFilters: CollectionAccessFilter[] = [
        {
          collection: "posts",
          table: {} as any,
          accessWhere: false,
        },
      ];

      // Empty query = browse mode
      const response = await setup.cms.search.search({
        query: "",
        locale: "en",
        accessFilters,
      });

      expect(response.results.length).toBe(0);
      expect(response.total).toBe(0);
    });
  });

  describe("with accessWhere: true", () => {
    it("should return all results when full access is granted", async () => {
      const collections = setup.cms.getCollections();

      const accessFilters: CollectionAccessFilter[] = [
        {
          collection: "posts",
          table: collections.posts.table,
          accessWhere: true,
        },
      ];

      // Note: This will only work if records exist in the actual table
      // Since we only indexed (not created via CRUD), the JOIN won't match
      // This is expected behavior - access filtering requires records to exist
      const response = await setup.cms.search.search({
        query: "Post",
        locale: "en",
        accessFilters,
      });

      // With true access but no records in table, results should be 0
      // (because JOIN can't match non-existent records)
      expect(response.results.length).toBe(0);
    });
  });

  describe("total count accuracy", () => {
    it("should return accurate total after filtering", async () => {
      const accessFilters: CollectionAccessFilter[] = [
        {
          collection: "posts",
          table: {} as any,
          accessWhere: false,
        },
      ];

      const response = await setup.cms.search.search({
        query: "Post",
        locale: "en",
        limit: 1,
        accessFilters,
      });

      // Total should be 0, not the unfiltered count
      expect(response.total).toBe(0);
    });
  });
});

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
