/**
 * PgVectorSearchAdapter (TODO)
 *
 * Extends PostgresSearchAdapter capabilities with semantic/embedding search.
 * Combines FTS + trigram + pgvector for hybrid lexical + semantic search.
 *
 * This adapter internally uses PostgresSearchAdapter for lexical search
 * and adds vector similarity search using pgvector extension.
 *
 * @example
 * ```ts
 * import { createPgVectorSearchAdapter, createOpenAIEmbeddingProvider } from "questpie/server";
 *
 * questpie({
 *   search: createPgVectorSearchAdapter({
 *     embeddingProvider: createOpenAIEmbeddingProvider({
 *       apiKey: process.env.OPENAI_API_KEY,
 *       model: "text-embedding-3-small",
 *     }),
 *     // Optional: customize hybrid scoring
 *     lexicalWeight: 0.4,
 *     semanticWeight: 0.6,
 *   }),
 * })
 * ```
 *
 * ## Implementation Plan
 *
 * ### Requirements
 * - pgvector extension (`CREATE EXTENSION vector;`)
 * - EmbeddingProvider for generating embeddings
 *
 * ### Architecture
 * - Uses composition: wraps PostgresSearchAdapter for FTS + trigram
 * - Adds `embedding` column (vector type) to questpie_search table
 * - Adds ivfflat or hnsw index for vector similarity
 *
 * ### Migrations
 * - search_007_pgvector_extension: `CREATE EXTENSION IF NOT EXISTS vector;`
 * - search_008_embedding_column: `ALTER TABLE questpie_search ADD COLUMN embedding vector(dimensions);`
 * - search_009_embedding_index: `CREATE INDEX ... USING ivfflat (embedding vector_cosine_ops);`
 *
 * ### Search Modes
 * - `lexical`: delegates to PostgresSearchAdapter (FTS + trigram)
 * - `semantic`: pure vector similarity using cosine distance
 * - `hybrid`: combines lexical + semantic scores
 *   - Formula: `score = lexical_score * lexicalWeight + semantic_score * semanticWeight`
 *
 * ### Indexing
 * - On `index()`: call embeddingProvider.generate(title + content), store in `embedding` column
 * - Fallback: if embedding generation fails, still index for lexical search
 *
 * ### Capabilities
 * - lexical: true (from PostgresSearchAdapter)
 * - trigram: true (from PostgresSearchAdapter, if pg_trgm available)
 * - semantic: true
 * - hybrid: true
 */

import type {
  AdapterCapabilities,
  AdapterInitContext,
  AdapterMigration,
  EmbeddingProvider,
  IndexParams,
  RemoveParams,
  SearchAdapter,
  SearchOptions,
  SearchResponse,
} from "../types.js";
import {
  PostgresSearchAdapter,
  type PostgresSearchAdapterOptions,
} from "./postgres.js";

// ============================================================================
// Types
// ============================================================================

export interface PgVectorSearchAdapterOptions extends PostgresSearchAdapterOptions {
  /**
   * Embedding provider for generating vectors
   * Required for semantic search
   */
  embeddingProvider: EmbeddingProvider;

  /**
   * Weight for lexical score in hybrid mode (0-1)
   * @default 0.4
   */
  lexicalWeight?: number;

  /**
   * Weight for semantic score in hybrid mode (0-1)
   * @default 0.6
   */
  semanticWeight?: number;

  /**
   * Vector index type
   * @default "ivfflat"
   */
  indexType?: "ivfflat" | "hnsw";
}

// ============================================================================
// Adapter Implementation (Scaffold)
// ============================================================================

/**
 * PgVector Search Adapter
 *
 * TODO: Implement this adapter
 *
 * This is a scaffold/placeholder. The actual implementation will:
 * 1. Extend PostgresSearchAdapter via composition
 * 2. Add embedding column and vector index
 * 3. Implement hybrid search combining lexical + semantic
 */
export class PgVectorSearchAdapter implements SearchAdapter {
  readonly name = "pgvector";

  private postgresAdapter: PostgresSearchAdapter;
  private embeddingProvider: EmbeddingProvider;
  private lexicalWeight: number;
  private semanticWeight: number;
  private indexType: "ivfflat" | "hnsw";
  private initialized = false;

  constructor(options: PgVectorSearchAdapterOptions) {
    this.embeddingProvider = options.embeddingProvider;
    this.lexicalWeight = options.lexicalWeight ?? 0.4;
    this.semanticWeight = options.semanticWeight ?? 0.6;
    this.indexType = options.indexType ?? "ivfflat";

    // Create internal PostgresSearchAdapter for lexical search
    this.postgresAdapter = new PostgresSearchAdapter({
      trigramThreshold: options.trigramThreshold,
      ftsWeight: options.ftsWeight,
    });
  }

  get capabilities(): AdapterCapabilities {
    return {
      lexical: true,
      trigram: this.postgresAdapter.capabilities.trigram,
      semantic: true,
      hybrid: true,
      facets: true,
    };
  }

  async initialize(ctx: AdapterInitContext): Promise<void> {
    // Initialize underlying Postgres adapter
    await this.postgresAdapter.initialize(ctx);

    // TODO: Check for pgvector extension
    // TODO: Store db reference for vector queries

    ctx.logger.info(
      `[PgVectorSearchAdapter] Initialized with ${this.embeddingProvider.name} (${this.embeddingProvider.dimensions}d)`,
    );
    this.initialized = true;
  }

  getMigrations(): AdapterMigration[] {
    // Get base migrations from PostgresSearchAdapter
    const baseMigrations = this.postgresAdapter.getMigrations();

    // Add pgvector-specific migrations
    const vectorMigrations: AdapterMigration[] = [
      {
        name: "search_007_pgvector_extension",
        up: `CREATE EXTENSION IF NOT EXISTS vector;`,
        down: `-- pgvector extension kept for other uses`,
      },
      {
        name: "search_008_embedding_column",
        up: `ALTER TABLE questpie_search ADD COLUMN IF NOT EXISTS embedding vector(${this.embeddingProvider.dimensions});`,
        down: `ALTER TABLE questpie_search DROP COLUMN IF EXISTS embedding;`,
      },
      {
        name: "search_009_embedding_index",
        up:
          this.indexType === "hnsw"
            ? `CREATE INDEX IF NOT EXISTS idx_search_embedding ON questpie_search USING hnsw (embedding vector_cosine_ops);`
            : `CREATE INDEX IF NOT EXISTS idx_search_embedding ON questpie_search USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);`,
        down: `DROP INDEX IF EXISTS idx_search_embedding;`,
      },
    ];

    return [...baseMigrations, ...vectorMigrations];
  }

  async search(options: SearchOptions): Promise<SearchResponse> {
    const mode = options.mode ?? "hybrid";

    // TODO: Implement actual semantic/hybrid search
    // For now, delegate to PostgresSearchAdapter for all modes
    if (mode === "lexical") {
      return this.postgresAdapter.search(options);
    }

    if (mode === "semantic") {
      // TODO: Implement pure semantic search
      // 1. Generate embedding for query
      // 2. Query using vector similarity
      throw new Error(
        "Semantic search not yet implemented in PgVectorSearchAdapter",
      );
    }

    if (mode === "hybrid") {
      // TODO: Implement hybrid search
      // 1. Get lexical results with scores
      // 2. Get semantic results with scores
      // 3. Combine and re-rank
      // For now, fallback to lexical
      return this.postgresAdapter.search(options);
    }

    return this.postgresAdapter.search(options);
  }

  async index(params: IndexParams): Promise<void> {
    // TODO: Generate embedding and store
    // 1. Generate embedding: embedding = await this.embeddingProvider.generate(params.title + " " + (params.content || ""))
    // 2. Store with embedding column

    // For now, delegate to PostgresSearchAdapter (lexical-only indexing)
    await this.postgresAdapter.index(params);
  }

  async remove(params: RemoveParams): Promise<void> {
    await this.postgresAdapter.remove(params);
  }

  async reindex(collection: string): Promise<void> {
    await this.postgresAdapter.reindex(collection);
  }

  async clear(): Promise<void> {
    await this.postgresAdapter.clear();
  }

  // --------------------------------------------------------------------------
  // Schema & Extensions (for migration generation)
  // --------------------------------------------------------------------------

  /**
   * Get Drizzle table schemas for migration generation.
   * Delegates to PostgresSearchAdapter since we use the same tables.
   */
  getTableSchemas(): Record<string, any> {
    return this.postgresAdapter.getTableSchemas();
  }

  /**
   * Get required PostgreSQL extensions.
   * Returns pg_trgm (from base) plus vector extension for embeddings.
   */
  getExtensions(): string[] {
    return [
      "CREATE EXTENSION IF NOT EXISTS pg_trgm;",
      "CREATE EXTENSION IF NOT EXISTS vector;",
    ];
  }
}

// ============================================================================
// Factory function
// ============================================================================

/**
 * Create PgVector search adapter
 *
 * @example
 * ```ts
 * questpie({
 *   search: createPgVectorSearchAdapter({
 *     embeddingProvider: createOpenAIEmbeddingProvider({
 *       apiKey: process.env.OPENAI_API_KEY,
 *     }),
 *   }),
 * })
 * ```
 */
export function createPgVectorSearchAdapter(
  options: PgVectorSearchAdapterOptions,
): PgVectorSearchAdapter {
  return new PgVectorSearchAdapter(options);
}
