import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

// ============================================================================
// Collection-level searchable config
// ============================================================================

/**
 * Facet field configuration options
 *
 * @example
 * ```ts
 * facets: {
 *   // Simple string facet
 *   status: true,
 *
 *   // Multi-value facet (e.g., tags array)
 *   tags: { type: "array" },
 *
 *   // Numeric range buckets
 *   price: {
 *     type: "range",
 *     buckets: [
 *       { label: "Under $50", max: 50 },
 *       { label: "$50-$100", min: 50, max: 100 },
 *       { label: "$100+", min: 100 },
 *     ],
 *   },
 *
 *   // Hierarchical facet (e.g., "Electronics > Phones > iPhone")
 *   category: { type: "hierarchy", separator: " > " },
 * }
 * ```
 */
export type FacetFieldConfig =
  | true // Simple string facet
  | { type: "array" } // Multi-value facet (e.g., tags)
  | {
      type: "range";
      buckets: Array<{
        label: string;
        min?: number;
        max?: number;
      }>;
    }
  | {
      type: "hierarchy";
      separator?: string; // Default: " > "
    };

/**
 * Facets configuration object
 * Keys should match metadata field names
 */
export type FacetsConfig = Record<string, FacetFieldConfig>;

/**
 * Search configuration for a collection
 * Defines what data from records gets indexed
 *
 * By default, all collections are indexed using `_title` (or `id` fallback)
 * and auto-generated content from field values.
 *
 * @example
 * ```ts
 * // Opt-out of auto-indexing
 * collection("internalLogs").searchable(false)
 *
 * // Custom search config
 * collection("posts")
 *   .searchable({
 *     content: (record) => record.content,
 *     metadata: (record) => ({
 *       status: record.status,
 *       category: record.category,
 *       tags: record.tags,
 *       viewCount: record.viewCount,
 *     }),
 *     facets: {
 *       status: true,
 *       category: true,
 *       tags: { type: "array" },
 *       viewCount: {
 *         type: "range",
 *         buckets: [
 *           { label: "Low", max: 100 },
 *           { label: "Medium", min: 100, max: 1000 },
 *           { label: "High", min: 1000 },
 *         ],
 *       },
 *     },
 *   })
 * ```
 */
export type SearchableConfig = {
  /**
   * Explicitly disable search indexing for this collection
   * Use `.searchable(false)` as shorthand
   * @default false
   */
  disabled?: boolean;

  /**
   * Title is always indexed (from .title() method)
   */
  title?: boolean;

  /**
   * Extract searchable content from record
   * If not provided, auto-generates content as "fieldName: value" pairs
   * @example content: (record) => extractTextFromJson(record.content)
   */
  content?: (record: any) => string | null;

  /**
   * Generate embeddings for semantic search (optional)
   * Only used if adapter supports embeddings
   * @example embeddings: async (record, ctx) => await ctx.cms.embeddings.generate(text)
   */
  embeddings?: (record: any, context: SearchableContext) => Promise<number[]>;

  /**
   * Custom metadata to store in search index
   * Useful for filtering and faceting search results
   * @example metadata: (record) => ({ status: record.status, authorId: record.authorId })
   */
  metadata?: (record: any) => Record<string, any>;

  /**
   * Facet field configurations
   *
   * Facets allow aggregating counts by field values, useful for building
   * filter UIs (e.g., "Published (42)", "Draft (15)").
   *
   * Supports:
   * - Simple string facets: `status: true`
   * - Multi-value facets: `tags: { type: "array" }`
   * - Numeric range buckets: `price: { type: "range", buckets: [...] }`
   * - Hierarchical facets: `category: { type: "hierarchy" }`
   */
  facets?: FacetsConfig;

  /**
   * Disable automatic indexing (manual control via hooks)
   * @default false
   */
  manual?: boolean;
};

export type SearchableContext = {
  cms: any;
  locale: string;
  defaultLocale: string;
};

// ============================================================================
// Search mode
// ============================================================================

/**
 * Search mode hint for adapters that support multiple modes
 * Adapter decides how to handle if mode is not supported
 */
export type SearchMode = "lexical" | "semantic" | "hybrid";

// ============================================================================
// Facet types
// ============================================================================

/**
 * Facet definition for aggregating metadata field values
 *
 * @example
 * ```ts
 * // Get top 10 status values by count
 * { field: "status", limit: 10, sortBy: "count" }
 *
 * // Get all categories alphabetically
 * { field: "category", sortBy: "alpha" }
 * ```
 */
export type FacetDefinition = {
  /**
   * Metadata field to aggregate
   * Must match a key in the indexed metadata
   */
  field: string;

  /**
   * Maximum number of facet values to return
   * @default 10
   */
  limit?: number;

  /**
   * Sort facet values by count (descending) or alphabetically
   * @default "count"
   */
  sortBy?: "count" | "alpha";
};

/**
 * A single facet value with its count
 */
export type FacetValue = {
  /**
   * The metadata value
   */
  value: string;

  /**
   * Number of matching records with this value
   */
  count: number;
};

/**
 * Numeric statistics for range facets
 */
export type FacetStats = {
  /**
   * Minimum numeric value in matching results
   */
  min: number;

  /**
   * Maximum numeric value in matching results
   */
  max: number;
};

/**
 * Facet result for a single field
 */
export type FacetResult = {
  /**
   * The metadata field name
   */
  field: string;

  /**
   * Aggregated values with counts
   */
  values: FacetValue[];

  /**
   * Numeric statistics (only for range facets)
   */
  stats?: FacetStats;
};

// ============================================================================
// Search options and results
// ============================================================================

/**
 * Access filter for a collection
 * Used to filter search results based on collection access rules
 */
export type CollectionAccessFilter = {
  /**
   * Collection name
   */
  collection: string;

  /**
   * Table reference for JOIN
   */
  table: any;

  /**
   * Access WHERE condition (from executeAccessRule)
   * - true: full access
   * - false: no access
   * - object: WHERE condition to apply
   */
  accessWhere: boolean | Record<string, any>;

  /**
   * Whether collection uses soft delete
   */
  softDelete?: boolean;
};

/**
 * Search query options (high-level API)
 */
export type SearchOptions = {
  /**
   * Search query string
   */
  query: string;

  /**
   * Filter by collections (default: all indexed collections)
   */
  collections?: string[];

  /**
   * Search locale (default: default locale)
   */
  locale?: string;

  /**
   * Result limit (default: 10)
   */
  limit?: number;

  /**
   * Result offset (default: 0)
   */
  offset?: number;

  /**
   * Search mode hint (default: adapter decides)
   * - "lexical": text-based search (FTS, trigram)
   * - "semantic": vector/embedding-based search
   * - "hybrid": combine lexical + semantic
   */
  mode?: SearchMode;

  /**
   * Metadata filters
   * Supports single values or arrays for multi-select
   * @example { status: "published" }
   * @example { status: ["published", "draft"] } // OR within field
   * @example { status: "published", category: "tech" } // AND across fields
   */
  filters?: Record<string, string | string[]>;

  /**
   * Include highlights in results (default: true)
   */
  highlights?: boolean;

  /**
   * Facet definitions for aggregating metadata values
   * Returns counts for each unique value in specified metadata fields
   *
   * @example
   * ```ts
   * facets: [
   *   { field: "status" },
   *   { field: "category", limit: 20 },
   *   { field: "author", sortBy: "alpha" }
   * ]
   * ```
   */
  facets?: FacetDefinition[];

  /**
   * Access filters per collection (for filtering by collection access rules)
   * When provided, search will JOIN with collection tables and apply access WHERE
   */
  accessFilters?: CollectionAccessFilter[];
};

/**
 * Search result
 */
export type SearchResult = {
  /**
   * Search index ID (internal)
   */
  id: string;

  /**
   * Collection name
   */
  collection: string;

  /**
   * Record ID in the source collection
   */
  recordId: string;

  /**
   * Relevance score (0-1 normalized, higher = better)
   */
  score: number;

  /**
   * Title from index
   */
  title: string;

  /**
   * Content preview from index
   */
  content?: string;

  /**
   * Highlighted snippets with <mark> tags
   */
  highlights?: {
    title?: string;
    content?: string;
  };

  /**
   * Custom metadata stored in index
   */
  metadata: Record<string, any>;

  /**
   * Locale of this index entry
   */
  locale: string;

  /**
   * Last updated timestamp
   */
  updatedAt: Date;
};

/**
 * Full search response with results, total count, and facets
 *
 * @example
 * ```ts
 * const response = await cms.search.search({
 *   query: "typescript",
 *   facets: [{ field: "status" }, { field: "category" }]
 * });
 *
 * console.log(response.total); // 42
 * console.log(response.results); // SearchResult[]
 * console.log(response.facets);
 * // [
 * //   { field: "status", values: [{ value: "published", count: 30 }, { value: "draft", count: 12 }] },
 * //   { field: "category", values: [{ value: "tutorials", count: 25 }, { value: "guides", count: 17 }] }
 * // ]
 *
 * // Browse mode (facets only, no query):
 * const browse = await cms.search.search({
 *   query: "",
 *   limit: 0,
 *   facets: [{ field: "status" }]
 * });
 * console.log(browse.facets); // All facet counts
 * ```
 */
export type SearchResponse = {
  /**
   * Matching search results (paginated)
   */
  results: SearchResult[];

  /**
   * Total count of matching records (before pagination)
   */
  total: number;

  /**
   * Facet results (if facets were requested)
   */
  facets?: FacetResult[];
};

/**
 * Search metadata attached to populated records
 */
export type SearchMeta = {
  /**
   * Relevance score from search
   */
  score: number;

  /**
   * Highlighted snippets with <mark> tags
   */
  highlights?: {
    title?: string;
    content?: string;
  };

  /**
   * Title as stored in search index
   */
  indexedTitle: string;

  /**
   * Content preview from search index
   */
  indexedContent?: string;
};

/**
 * Populated search result - full record with search metadata
 */
export type PopulatedSearchResult<T = any> = T & {
  /**
   * Search-specific metadata (score, highlights, indexed title)
   */
  _search: SearchMeta;
};

/**
 * Populated search response - full records with search metadata
 * Returned when search is populated via CRUD
 */
export type PopulatedSearchResponse<T = any> = {
  /**
   * Full records with search metadata
   */
  docs: PopulatedSearchResult<T>[];

  /**
   * Total count of matching records (accurate after access filtering)
   */
  total: number;

  /**
   * Facet results (if facets were requested)
   */
  facets?: FacetResult[];
};

// ============================================================================
// Index params
// ============================================================================

/**
 * Extracted facet value for indexing
 */
export type FacetIndexValue = {
  /**
   * Facet field name
   */
  name: string;

  /**
   * Facet value (string label)
   */
  value: string;

  /**
   * Original numeric value (for range facets, used for stats)
   */
  numericValue?: number;
};

/**
 * Parameters for indexing a record
 */
export type IndexParams = {
  collection: string;
  recordId: string;
  locale: string;
  title: string;
  content?: string;
  metadata?: Record<string, any>;
  embedding?: number[];

  /**
   * Extracted facet values for this record
   * Generated by facet-utils based on collection's facets config
   */
  facets?: FacetIndexValue[];
};

/**
 * Parameters for removing from index
 */
export type RemoveParams = {
  collection: string;
  recordId: string;
  locale?: string; // If not provided, remove all locales
};

// ============================================================================
// Search Adapter interface
// ============================================================================

/**
 * Logger interface for adapters
 */
export type AdapterLogger = {
  debug: (message: string, ...args: any[]) => void;
  info: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
};

/**
 * Context passed to adapter on initialization
 */
export type AdapterInitContext = {
  db: PostgresJsDatabase<any>;
  logger: AdapterLogger;
};

/**
 * Migration definition returned by adapter
 */
export type AdapterMigration = {
  /**
   * Unique migration name (e.g., "search_001_create_table")
   */
  name: string;

  /**
   * SQL to apply migration
   */
  up: string;

  /**
   * SQL to rollback migration
   */
  down: string;
};

/**
 * Adapter capabilities for introspection
 */
export type AdapterCapabilities = {
  /**
   * Supports lexical/text search (FTS, trigram, etc.)
   */
  lexical: boolean;

  /**
   * Supports trigram fuzzy matching
   */
  trigram: boolean;

  /**
   * Supports semantic/embedding search
   */
  semantic: boolean;

  /**
   * Supports hybrid (lexical + semantic) search
   */
  hybrid: boolean;

  /**
   * Supports faceted search
   */
  facets: boolean;
};

/**
 * Search Adapter interface
 *
 * Adapters fully own their indexing strategy, storage, and queries.
 * CMS uses this interface via cms.search.* high-level API.
 *
 * @example
 * ```ts
 * // Basic Postgres adapter (FTS + trigram)
 * questpie({
 *   search: createPostgresSearchAdapter(),
 * })
 *
 * // Postgres with embeddings
 * questpie({
 *   search: createPgVectorSearchAdapter({
 *     embeddingProvider: createOpenAIEmbeddingProvider({ apiKey }),
 *   }),
 * })
 *
 * // External search service
 * questpie({
 *   search: createElasticSearchAdapter({ node: "http://localhost:9200" }),
 * })
 * ```
 */
export interface SearchAdapter {
  /**
   * Adapter name for logging/debugging
   */
  readonly name: string;

  /**
   * Adapter capabilities
   */
  readonly capabilities: AdapterCapabilities;

  /**
   * Initialize adapter (check extensions, setup runtime state)
   * Called once when CMS initializes.
   * Should NOT create tables/indexes - use getMigrations() for that.
   */
  initialize(ctx: AdapterInitContext): Promise<void>;

  /**
   * Get migrations for this adapter
   * Returns SQL statements for tables, indexes, extensions.
   * Migration system applies these.
   */
  getMigrations(): AdapterMigration[];

  /**
   * Search across collections
   * Returns results, total count, and optional facets
   */
  search(options: SearchOptions): Promise<SearchResponse>;

  /**
   * Index a record (upsert)
   */
  index(params: IndexParams): Promise<void>;

  /**
   * Remove record from index
   */
  remove(params: RemoveParams): Promise<void>;

  /**
   * Reindex entire collection
   * Adapter may need CMS reference to fetch records - handled via initialize()
   */
  reindex(collection: string): Promise<void>;

  /**
   * Clear all indexed data
   */
  clear(): Promise<void>;

  /**
   * Index multiple records in a batch (upsert).
   * More efficient than calling index() multiple times.
   * Default implementation falls back to sequential index() calls.
   */
  indexBatch?(params: IndexParams[]): Promise<void>;

  /**
   * Get Drizzle table schemas for migration generation.
   * If this returns tables, they will be included in cms.getSchema()
   * for Drizzle migration generation.
   *
   * Local adapters (Postgres, PgVector) return their tables.
   * External adapters (Meilisearch, Elasticsearch) return undefined.
   */
  getTableSchemas?(): Record<string, any>;

  /**
   * Get required PostgreSQL extensions.
   * Returns CREATE EXTENSION statements that will be run before migrations.
   *
   * @example
   * ```ts
   * getExtensions() {
   *   return ['CREATE EXTENSION IF NOT EXISTS pg_trgm;'];
   * }
   * ```
   */
  getExtensions?(): string[];
}

// ============================================================================
// Embedding Provider interface
// ============================================================================

/**
 * Embedding Provider interface
 *
 * Utility for generating embeddings, used by adapters that support semantic search.
 * Not an adapter itself - passed to adapters that need it.
 *
 * @example
 * ```ts
 * createPgVectorSearchAdapter({
 *   embeddingProvider: createOpenAIEmbeddingProvider({
 *     apiKey: process.env.OPENAI_API_KEY,
 *     model: "text-embedding-3-small",
 *   }),
 * })
 * ```
 */
export interface EmbeddingProvider {
  /**
   * Provider name for logging
   */
  readonly name: string;

  /**
   * Embedding dimensions
   */
  readonly dimensions: number;

  /**
   * Model identifier
   */
  readonly model: string;

  /**
   * Generate embedding for text
   */
  generate(text: string): Promise<number[]>;

  /**
   * Generate embeddings for multiple texts (batch)
   * Default implementation calls generate() for each text.
   */
  generateBatch?(texts: string[]): Promise<number[][]>;
}

// ============================================================================
// Search Service interface (high-level CMS API)
// ============================================================================

/**
 * Search Service interface
 *
 * High-level API exposed via cms.search.*
 * Delegates to underlying SearchAdapter.
 */
export interface SearchService {
  /**
   * Initialize the search service (called by CMS on startup)
   */
  initialize(): Promise<void>;

  /**
   * Get underlying adapter
   */
  getAdapter(): SearchAdapter;

  /**
   * Search across collections
   * Returns results, total count, and optional facets
   */
  search(options: SearchOptions): Promise<SearchResponse>;

  /**
   * Index a record
   */
  index(params: IndexParams): Promise<void>;

  /**
   * Remove from index
   */
  remove(params: RemoveParams): Promise<void>;

  /**
   * Reindex entire collection
   */
  reindex(collection: string): Promise<void>;

  /**
   * Clear entire search index
   */
  clear(): Promise<void>;

  /**
   * Index multiple records in a batch (upsert).
   * More efficient than calling index() multiple times.
   */
  indexBatch(params: IndexParams[]): Promise<void>;
}

// ============================================================================
// Legacy types (kept for backwards compatibility, will be removed)
// ============================================================================

/**
 * @deprecated Use SearchMode instead
 */
export type SearchStrategy = "bm25" | "trigram" | "semantic" | "hybrid";

/**
 * @deprecated BM25 is no longer a core feature
 */
export type BM25Config = {
  k1?: number;
  b?: number;
};

/**
 * @deprecated Use EmbeddingProvider interface instead
 */
export type EmbeddingsConfig = {
  provider: "openai" | "custom";
  model?: string;
  dimensions?: number;
  apiKey?: string;
  generate?: (text: string) => Promise<number[]>;
};

/**
 * @deprecated Use SearchAdapter in QuestpieConfig.search instead
 */
export type SearchConfig = {
  enabled?: boolean;
  bm25?: BM25Config;
  similarity?: number;
  embeddings?: EmbeddingsConfig;
  defaultStrategy?: SearchStrategy;
};
