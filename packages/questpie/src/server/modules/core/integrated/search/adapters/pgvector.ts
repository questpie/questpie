/**
 * PgVectorSearchAdapter
 *
 * Extends PostgresSearchAdapter capabilities with semantic/embedding search.
 * Combines FTS + trigram + pgvector for hybrid lexical + semantic search.
 *
 * This adapter internally uses PostgresSearchAdapter for lexical search
 * and adds vector similarity search using pgvector extension.
 *
 * @example
 * ```ts
 * import { createOpenAIEmbeddingProvider } from "questpie";
 * import { createPgVectorSearchAdapter } from "questpie/adapters/pgvector-search";
 *
 * config({
 *   search: createPgVectorSearchAdapter({
 *     embeddingProvider: createOpenAIEmbeddingProvider({
 *       apiKey: process.env.OPENAI_API_KEY,
 *       model: "text-embedding-3-small",
 *     }),
 *     // Optional: customize hybrid scoring
 *     lexicalWeight: 0.4,
 *     semanticWeight: 0.6,
 *   }),
 *   db: { url: process.env.DATABASE_URL! },
 *   app: { url: process.env.APP_URL! },
 * })
 * ```
 *
 * ## Implementation Plan
 *
 * ### Requirements
 * - pgvector extension (`CREATE EXTENSION "vector";`)
 * - EmbeddingProvider for generating embeddings
 *
 * ### Architecture
 * - Uses composition: wraps PostgresSearchAdapter for FTS + trigram
 * - Adds `embedding` column (vector type) to questpie_search table
 * - Adds ivfflat or hnsw index for vector similarity
 *
 * ### Migrations
 * - search_007_pgvector_extension: `CREATE EXTENSION IF NOT EXISTS "vector";`
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

import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { DEFAULT_LOCALE } from "#questpie/shared/constants.js";

import { questpieSearchTable } from "../collection.js";
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
	SearchResult,
} from "../types.js";
import {
	PostgresSearchAdapter,
	type PostgresSearchAdapterOptions,
} from "./postgres.js";

/**
 * Format a JS number[] as a pgvector text literal: `[0.1,0.2,...]`.
 *
 * pgvector accepts a bracketed, comma-separated list as input to a `vector`
 * column / cast. We build it explicitly (and pass it as a single bound param,
 * `::vector`-cast in SQL) so the vector is never string-interpolated into the
 * query — the values stay parameterized.
 */
export function toVectorLiteral(embedding: number[]): string {
	// NaN/Infinity would make pgvector reject the row; guard fail-closed so a bad
	// provider response surfaces as an error rather than a silently-corrupt index.
	for (const value of embedding) {
		if (!Number.isFinite(value)) {
			throw new Error("embedding contains a non-finite value");
		}
	}
	return `[${embedding.join(",")}]`;
}

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
 * Composition over `PostgresSearchAdapter`: lexical (FTS + trigram) is delegated
 * to the base adapter; this adapter ADDS the `embedding` column + a cosine-distance
 * vector search path, generating embeddings on `index()` via the configured
 * {@link EmbeddingProvider}.
 *
 * Modes:
 *  - `lexical`  → base adapter (unchanged).
 *  - `semantic` → embed the query, ORDER BY cosine distance (`<=>`) over `embedding`.
 *  - `hybrid`   → base lexical (FTS + trigram) for now; a fused lexical+semantic
 *                 re-rank is a follow-up. Semantic is the path memory recall needs.
 */
export class PgVectorSearchAdapter implements SearchAdapter {
	readonly name = "pgvector";

	private postgresAdapter: PostgresSearchAdapter;
	private embeddingProvider: EmbeddingProvider;
	private lexicalWeight: number;
	private semanticWeight: number;
	private indexType: "ivfflat" | "hnsw";
	private initialized = false;
	private db: PostgresJsDatabase<any> | null = null;

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
		// Initialize underlying Postgres adapter (lexical path).
		await this.postgresAdapter.initialize(ctx);

		// Store the db reference for the vector-search + embedding-store paths.
		this.db = ctx.db;

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
				up: `CREATE EXTENSION IF NOT EXISTS "vector";`,
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

		// Semantic: embed the query and rank by cosine distance over `embedding`.
		if (mode === "semantic") {
			return this.searchSemantic(options);
		}

		// Lexical + hybrid: delegate to the base adapter (FTS + trigram). A fused
		// lexical+semantic re-rank for `hybrid` is a follow-up; semantic is the path
		// memory recall depends on and is fully implemented here.
		return this.postgresAdapter.search(options);
	}

	/**
	 * Pure semantic search: embed the query, then ORDER BY cosine distance
	 * (`embedding <=> queryVector`) ascending (nearest first). The relevance score
	 * is `1 - cosine_distance` so it is comparable to the lexical scores (higher =
	 * better). Rows whose `embedding` is NULL (not yet embedded) are excluded.
	 *
	 * Filters (`collections`, `locale`, metadata `filters`) are applied as a WHERE
	 * so semantic search is scope-able exactly like lexical search. `accessFilters`
	 * are NOT yet wired through the semantic path (memory recall scopes via metadata
	 * `filters`, not collection-access JOINs) — a follow-up if external semantic
	 * search needs row-level access JOINs.
	 */
	private async searchSemantic(
		options: SearchOptions,
	): Promise<SearchResponse> {
		if (!this.db) {
			throw new Error("PgVectorSearchAdapter not initialized");
		}

		const {
			query,
			collections,
			locale = DEFAULT_LOCALE,
			limit = 10,
			offset = 0,
			filters,
		} = options;

		const queryEmbedding = await this.embeddingProvider.generate(query);
		const vectorLiteral = toVectorLiteral(queryEmbedding);

		const conditions: ReturnType<typeof sql>[] = [];
		if (collections && collections.length > 0) {
			conditions.push(
				sql`${inArray(questpieSearchTable.collectionName, collections)}`,
			);
		}
		conditions.push(sql`${eq(questpieSearchTable.locale, locale)}`);
		// Only rows that actually carry an embedding can be semantically ranked.
		// `embedding` lives on the questpie_search table but is NOT in the shared
		// Drizzle schema (it is pgvector-only — adding it there would force the
		// plain-Postgres adapter to create a `vector` column without the extension).
		// So it is referenced as a raw identifier and managed by search_008.
		const embeddingCol = sql`${questpieSearchTable}.${sql.identifier("embedding")}`;
		conditions.push(sql`${embeddingCol} IS NOT NULL`);
		if (filters) {
			for (const [key, value] of Object.entries(filters)) {
				if (Array.isArray(value)) {
					conditions.push(
						sql`${or(
							...value.map(
								(v) => sql`${questpieSearchTable.metadata}->>${key} = ${v}`,
							),
						)}`,
					);
				} else {
					conditions.push(
						sql`${questpieSearchTable.metadata}->>${key} = ${value}`,
					);
				}
			}
		}

		// `<=>` = cosine distance (0 = identical, 2 = opposite). Score = 1 - distance.
		const distanceExpr = sql`${embeddingCol} <=> ${vectorLiteral}::vector`;
		const rows = await this.db
			.select({
				id: questpieSearchTable.id,
				collection_name: questpieSearchTable.collectionName,
				record_id: questpieSearchTable.recordId,
				title: questpieSearchTable.title,
				content: questpieSearchTable.content,
				metadata: questpieSearchTable.metadata,
				locale: questpieSearchTable.locale,
				updated_at: questpieSearchTable.updatedAt,
				score: sql<number>`1 - (${distanceExpr})`,
			})
			.from(questpieSearchTable)
			.where(and(...conditions))
			.orderBy(distanceExpr)
			.limit(limit)
			.offset(offset);

		const results: SearchResult[] = (rows as any[]).map((row) => ({
			id: row.id,
			collection: row.collection_name,
			recordId: row.record_id,
			score: Number(row.score) || 0,
			title: row.title,
			content: row.content ?? undefined,
			metadata: row.metadata || {},
			locale: row.locale,
			updatedAt: row.updated_at,
		}));

		return { results, total: results.length };
	}

	async index(params: IndexParams): Promise<void> {
		if (!this.db) {
			throw new Error("PgVectorSearchAdapter not initialized");
		}

		// 1. Lexical index (upsert title/content/metadata/facets into questpie_search).
		await this.postgresAdapter.index(params);

		// 2. Generate the embedding from title + content. A caller MAY pass a
		//    precomputed `embedding` (e.g. a collection's `searchable.embeddings`
		//    hook); otherwise we generate it here from the indexed text. If the text
		//    is empty there is nothing to embed — leave the column NULL (the row is
		//    still lexically searchable; it is simply excluded from semantic ranking).
		const text = [params.title, params.content].filter(Boolean).join(" ").trim();
		const embedding =
			params.embedding ?? (text.length > 0 ? await this.embeddingProvider.generate(text) : null);
		if (!embedding) return;

		// 3. Store the vector on the just-upserted row (scoped by its natural key).
		//    `embedding` is a raw identifier (see searchSemantic) — pgvector-only.
		const vectorLiteral = toVectorLiteral(embedding);
		await this.db.execute(sql`
			UPDATE ${questpieSearchTable}
			SET ${sql.identifier("embedding")} = ${vectorLiteral}::vector
			WHERE ${questpieSearchTable.collectionName} = ${params.collection}
				AND ${questpieSearchTable.recordId} = ${params.recordId}
				AND ${questpieSearchTable.locale} = ${params.locale}
		`);
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
}

// ============================================================================
// Factory function
// ============================================================================

/**
 * Create PgVector search adapter
 *
 * @example
 * ```ts
 * config({
 *   search: createPgVectorSearchAdapter({
 *     embeddingProvider: createOpenAIEmbeddingProvider({
 *       apiKey: process.env.OPENAI_API_KEY,
 *     }),
 *   }),
 *   db: { url: process.env.DATABASE_URL! },
 *   app: { url: process.env.APP_URL! },
 * })
 * ```
 */
export function createPgVectorSearchAdapter(
	options: PgVectorSearchAdapterOptions,
): PgVectorSearchAdapter {
	return new PgVectorSearchAdapter(options);
}
