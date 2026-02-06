import { sql } from "drizzle-orm";
import {
  customType,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

/**
 * Custom tsvector type for PostgreSQL full-text search
 * This allows Drizzle to properly generate GIN indexes
 */
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/**
 * Search index collection
 * Stores searchable content from all collections with BM25, FTS, and optional embeddings
 *
 * Extensions required:
 * - pg_trgm (trigram fuzzy matching)
 * - pgvector (optional, for embeddings)
 */
export const questpieSearchTable = pgTable(
  "questpie_search",
  {
    /**
     * Primary key with auto-generated UUID
     */
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /**
     * Collection name
     */
    collectionName: text("collection_name").notNull(),

    /**
     * Record ID in the source collection (text to support any ID type)
     */
    recordId: text("record_id").notNull(),

    /**
     * Locale for this search entry
     */
    locale: text("locale").notNull(),

    /**
     * Title (always indexed, from .title() method)
     */
    title: text("title").notNull(),

    /**
     * Content (optional, from .searchable({ content: ... }))
     */
    content: text("content"),

    /**
     * Custom metadata for filtering
     * @example { status: "published", authorId: "123" }
     */
    metadata: jsonb("metadata").default({}),

    /**
     * Full-text search vector (generated column)
     * Title gets higher weight (A) than content (B)
     *
     * Uses 'simple' configuration to avoid language-specific stemming
     * (better for multi-language support)
     *
     * Uses custom tsvector type so Drizzle generates correct DDL and indexes.
     */
    ftsVector: tsvector("fts_vector")
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('simple', coalesce(title, '')), 'A') || setweight(to_tsvector('simple', coalesce(content, '')), 'B')`,
      )
      .notNull(),

    /**
     * Created timestamp
     */
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),

    /**
     * Updated timestamp
     */
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    // GIN index for full-text search on tsvector column
    index("idx_search_fts").using("gin", t.ftsVector),

    // Trigram index for fuzzy/typo-tolerant search (requires pg_trgm extension)
    index("idx_search_trigram").using("gin", sql`${t.title} gin_trgm_ops`),

    // Collection + locale filter index
    index("idx_search_collection_locale").on(t.collectionName, t.locale),

    // Record ID lookup index
    index("idx_search_record_id").on(t.recordId),

    // Unique constraint: one entry per collection + record + locale
    unique("uq_search_entry").on(t.collectionName, t.recordId, t.locale),
  ],
);

/**
 * Search facets table
 * Stores facet values for efficient aggregation
 *
 * Each record in questpie_search can have multiple facet values:
 * - Multi-value facets (tags): one row per value
 * - Hierarchical facets: one row per level (e.g., "A", "A > B", "A > B > C")
 * - Range facets: one row with bucket label + numeric_value for stats
 */
export const questpieSearchFacetsTable = pgTable(
  "questpie_search_facets",
  {
    /**
     * Primary key with auto-generated UUID
     */
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /**
     * Reference to parent search record
     * CASCADE delete ensures facets are removed when search record is deleted
     */
    searchId: text("search_id").notNull(),

    /**
     * Collection name (denormalized for efficient aggregation)
     */
    collectionName: text("collection_name").notNull(),

    /**
     * Locale (denormalized for efficient aggregation)
     */
    locale: text("locale").notNull(),

    /**
     * Facet field name (e.g., "status", "category", "tags")
     */
    facetName: text("facet_name").notNull(),

    /**
     * Facet value (string label)
     * For range facets, this is the bucket label (e.g., "Under $50")
     * For hierarchical facets, this is the path (e.g., "Electronics > Phones")
     */
    facetValue: text("facet_value").notNull(),

    /**
     * Original numeric value (for range facets)
     * Used to compute min/max stats
     */
    numericValue: numeric("numeric_value"),

    /**
     * Created timestamp
     */
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    /**
     * Primary aggregation index
     * Optimized for: GROUP BY facet_value WHERE collection + locale + facet_name
     */
    index("idx_facets_agg").on(
      t.collectionName,
      t.locale,
      t.facetName,
      t.facetValue,
    ),

    /**
     * Search ID index
     * For joining with search results and cleanup on record deletion
     */
    index("idx_facets_search_id").on(t.searchId),

    /**
     * Collection index
     * For clearing all facets for a collection
     */
    index("idx_facets_collection").on(t.collectionName),
  ],
);
