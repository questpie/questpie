/**
 * Search Adapters
 *
 * Export all available search adapters.
 */

// PostgreSQL + pgvector (semantic search)
export {
	createPgVectorSearchAdapter,
	PgVectorSearchAdapter,
	type PgVectorSearchAdapterOptions,
} from "./pgvector.js";
// PostgreSQL FTS + Trigram (default, minimal extensions)
export {
	createPostgresSearchAdapter,
	PostgresSearchAdapter,
	type PostgresSearchAdapterOptions,
} from "./postgres.js";

// ============================================================================
// Future Adapters (TODO)
// ============================================================================

/**
 * TODO: ElasticSearchAdapter
 *
 * External Elasticsearch/OpenSearch adapter for large-scale deployments.
 *
 * Usage:
 * ```ts
 * questpie({
 *   search: createElasticSearchAdapter({
 *     node: "http://localhost:9200",
 *     index: "questpie_search",
 *   }),
 * })
 * ```
 *
 * Implementation notes:
 * - Uses @elastic/elasticsearch client
 * - getMigrations() returns empty (external system)
 * - initialize() creates index mapping if not exists
 * - Supports hybrid search with kNN if vectors provided
 */

/**
 * TODO: MeilisearchAdapter
 *
 * Meilisearch adapter for typo-tolerant, fast search.
 *
 * Usage:
 * ```ts
 * questpie({
 *   search: createMeilisearchAdapter({
 *     host: "http://localhost:7700",
 *     apiKey: "masterKey",
 *   }),
 * })
 * ```
 */

/**
 * TODO: TypesenseAdapter
 *
 * Typesense adapter for instant search.
 */
