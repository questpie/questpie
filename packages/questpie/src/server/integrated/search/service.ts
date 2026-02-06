/**
 * Search Service
 *
 * High-level search API wrapper that delegates to the configured SearchAdapter.
 * This is exposed via cms.search.* and provides a unified interface regardless
 * of the underlying search implementation.
 */

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  createPostgresSearchAdapter,
  PostgresSearchAdapter,
} from "./adapters/postgres.js";
import type {
  AdapterLogger,
  IndexParams,
  RemoveParams,
  SearchAdapter,
  SearchOptions,
  SearchResponse,
  SearchService,
} from "./types.js";

// ============================================================================
// Search Service Implementation
// ============================================================================

/**
 * Search service wrapper that delegates to adapter
 */
export class SearchServiceWrapper implements SearchService {
  private initialized = false;

  constructor(
    private adapter: SearchAdapter,
    private db: PostgresJsDatabase<any>,
    private logger: AdapterLogger,
  ) {}

  /**
   * Initialize the adapter (called by CMS on startup)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.adapter.initialize({
      db: this.db,
      logger: this.logger,
    });

    this.initialized = true;
  }

  /**
   * Get the underlying adapter
   */
  getAdapter(): SearchAdapter {
    return this.adapter;
  }

  /**
   * Search across collections
   * Returns results, total count, and optional facets
   */
  async search(options: SearchOptions): Promise<SearchResponse> {
    this.ensureInitialized();
    return this.adapter.search(options);
  }

  /**
   * Index a record
   */
  async index(params: IndexParams): Promise<void> {
    this.ensureInitialized();
    return this.adapter.index(params);
  }

  /**
   * Remove from index
   */
  async remove(params: RemoveParams): Promise<void> {
    this.ensureInitialized();
    return this.adapter.remove(params);
  }

  /**
   * Reindex entire collection
   */
  async reindex(collection: string): Promise<void> {
    this.ensureInitialized();
    return this.adapter.reindex(collection);
  }

  /**
   * Clear entire search index
   */
  async clear(): Promise<void> {
    this.ensureInitialized();
    return this.adapter.clear();
  }

  /**
   * Index multiple records in a batch (upsert).
   * More efficient than calling index() multiple times.
   * Falls back to sequential index() calls if adapter doesn't support batch.
   */
  async indexBatch(params: IndexParams[]): Promise<void> {
    this.ensureInitialized();

    if (params.length === 0) return;

    // Use batch method if adapter supports it, otherwise fall back to sequential
    if (this.adapter.indexBatch) {
      return this.adapter.indexBatch(params);
    }

    // Fallback: sequential indexing
    for (const param of params) {
      await this.adapter.index(param);
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        "SearchService not initialized. Call initialize() first or ensure CMS is properly started.",
      );
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create search service with adapter
 *
 * @param adapter - Search adapter (or undefined for default PostgresSearchAdapter)
 * @param db - Database connection
 * @param logger - Logger instance
 */
export function createSearchService(
  adapter: SearchAdapter | undefined,
  db: PostgresJsDatabase<any>,
  logger?: AdapterLogger,
): SearchServiceWrapper {
  // Use provided adapter or create default PostgresSearchAdapter
  const resolvedAdapter = adapter ?? createPostgresSearchAdapter();

  // Create default logger if not provided
  const resolvedLogger: AdapterLogger = logger ?? {
    debug: (...args) => console.debug("[Search]", ...args),
    info: (...args) => console.info("[Search]", ...args),
    warn: (...args) => console.warn("[Search]", ...args),
    error: (...args) => console.error("[Search]", ...args),
  };

  return new SearchServiceWrapper(resolvedAdapter, db, resolvedLogger);
}

// ============================================================================
// Legacy exports (backwards compatibility)
// ============================================================================

/**
 * @deprecated Use createSearchService with adapter instead
 */
export function createSearchServiceLegacy(
  db: PostgresJsDatabase<any>,
  _config: any = {},
): SearchService {
  // Create with default PostgresSearchAdapter for backwards compatibility
  const service = createSearchService(undefined, db);
  // Note: service needs to be initialized before use
  return service;
}
