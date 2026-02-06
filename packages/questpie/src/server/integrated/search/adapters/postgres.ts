/**
 * PostgresSearchAdapter
 *
 * Default search adapter using PostgreSQL built-in features:
 * - Full-text search (FTS) with ts_rank_cd (no extensions required)
 * - Trigram fuzzy matching (requires pg_trgm extension)
 *
 * The adapter automatically detects if pg_trgm is available and uses
 * hybrid scoring (FTS + trigram) when possible, falling back to pure FTS otherwise.
 */

import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { DEFAULT_LOCALE } from "#questpie/shared/constants.js";
import {
  questpieSearchFacetsTable,
  questpieSearchTable,
} from "../collection.js";
import type {
  AdapterCapabilities,
  AdapterInitContext,
  AdapterMigration,
  FacetResult,
  FacetStats,
  IndexParams,
  RemoveParams,
  SearchAdapter,
  SearchOptions,
  SearchResponse,
  SearchResult,
} from "../types.js";

// ============================================================================
// Types
// ============================================================================

export interface PostgresSearchAdapterOptions {
  /**
   * Similarity threshold for trigram matching (0-1)
   * @default 0.3
   */
  trigramThreshold?: number;

  /**
   * Weight for FTS score in hybrid mode (0-1)
   * Trigram weight = 1 - ftsWeight
   * @default 0.7
   */
  ftsWeight?: number;
}

// ============================================================================
// Adapter Implementation
// ============================================================================

export class PostgresSearchAdapter implements SearchAdapter {
  readonly name = "postgres";

  private db: PostgresJsDatabase<any> | null = null;
  private trigramThreshold: number;
  private ftsWeight: number;

  constructor(options: PostgresSearchAdapterOptions = {}) {
    this.trigramThreshold = options.trigramThreshold ?? 0.3;
    this.ftsWeight = options.ftsWeight ?? 0.7;
  }

  get capabilities(): AdapterCapabilities {
    return {
      lexical: true,
      trigram: true, // pg_trgm required, created by ensureExtensions()
      semantic: false,
      hybrid: true, // FTS + trigram
      facets: true,
    };
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async initialize(ctx: AdapterInitContext): Promise<void> {
    this.db = ctx.db;
    ctx.logger.info("[PostgresSearchAdapter] Initialized");
  }

  /**
   * Get migrations for backwards compatibility.
   *
   * NOTE: Drizzle now handles table and index creation via getTableSchemas().
   * These migrations are kept for existing projects that have already run them.
   * All statements use IF NOT EXISTS so they're safe to run on new or existing DBs.
   */
  getMigrations(): AdapterMigration[] {
    return [
      {
        name: "search_001_create_table",
        up: `
					CREATE TABLE IF NOT EXISTS questpie_search (
						id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
						collection_name TEXT NOT NULL,
						record_id TEXT NOT NULL,
						locale TEXT NOT NULL,
						title TEXT NOT NULL,
						content TEXT,
						metadata JSONB DEFAULT '{}',
						fts_vector TSVECTOR GENERATED ALWAYS AS (
							setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
							setweight(to_tsvector('simple', coalesce(content, '')), 'B')
						) STORED,
						created_at TIMESTAMP DEFAULT NOW() NOT NULL,
						updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
						UNIQUE(collection_name, record_id, locale)
					);
				`,
        down: `DROP TABLE IF EXISTS questpie_search;`,
      },
      {
        name: "search_002_fts_index",
        up: `CREATE INDEX IF NOT EXISTS idx_search_fts ON questpie_search USING GIN (fts_vector);`,
        down: `DROP INDEX IF EXISTS idx_search_fts;`,
      },
      {
        name: "search_003_collection_locale_index",
        up: `CREATE INDEX IF NOT EXISTS idx_search_collection_locale ON questpie_search (collection_name, locale);`,
        down: `DROP INDEX IF EXISTS idx_search_collection_locale;`,
      },
      {
        name: "search_004_record_id_index",
        up: `CREATE INDEX IF NOT EXISTS idx_search_record_id ON questpie_search (record_id);`,
        down: `DROP INDEX IF EXISTS idx_search_record_id;`,
      },
      {
        name: "search_005_trigram_extension",
        up: `CREATE EXTENSION IF NOT EXISTS pg_trgm;`,
        down: `-- pg_trgm extension kept for other uses`,
      },
      {
        name: "search_006_trigram_index",
        up: `CREATE INDEX IF NOT EXISTS idx_search_trigram ON questpie_search USING GIN (title gin_trgm_ops);`,
        down: `DROP INDEX IF EXISTS idx_search_trigram;`,
      },
      {
        name: "search_007_facets_table",
        up: `
					CREATE TABLE IF NOT EXISTS questpie_search_facets (
						id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
						search_id TEXT NOT NULL REFERENCES questpie_search(id) ON DELETE CASCADE,
						collection_name TEXT NOT NULL,
						locale TEXT NOT NULL,
						facet_name TEXT NOT NULL,
						facet_value TEXT NOT NULL,
						numeric_value NUMERIC,
						created_at TIMESTAMP DEFAULT NOW() NOT NULL
					);
				`,
        down: `DROP TABLE IF EXISTS questpie_search_facets;`,
      },
      {
        name: "search_008_facets_indexes",
        up: `
					CREATE INDEX IF NOT EXISTS idx_facets_agg ON questpie_search_facets (collection_name, locale, facet_name, facet_value);
					CREATE INDEX IF NOT EXISTS idx_facets_search_id ON questpie_search_facets (search_id);
					CREATE INDEX IF NOT EXISTS idx_facets_collection ON questpie_search_facets (collection_name);
				`,
        down: `
					DROP INDEX IF EXISTS idx_facets_agg;
					DROP INDEX IF EXISTS idx_facets_search_id;
					DROP INDEX IF EXISTS idx_facets_collection;
				`,
      },
    ];
  }

  // --------------------------------------------------------------------------
  // Search
  // --------------------------------------------------------------------------

  async search(options: SearchOptions): Promise<SearchResponse> {
    if (!this.db) {
      throw new Error("PostgresSearchAdapter not initialized");
    }

    const {
      query,
      collections,
      locale = DEFAULT_LOCALE,
      limit = 10,
      offset = 0,
      mode = "hybrid",
      filters,
      highlights = true,
      facets: facetRequests,
      accessFilters,
    } = options;

    // Build WHERE conditions
    const conditions: any[] = [];

    // Filter by collections
    if (collections && collections.length > 0) {
      conditions.push(inArray(questpieSearchTable.collectionName, collections));
    }

    // Filter by locale
    conditions.push(eq(questpieSearchTable.locale, locale));

    // Filter by metadata
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        if (Array.isArray(value)) {
          // OR within field: status IN ("published", "draft")
          conditions.push(
            or(
              ...value.map(
                (v) => sql`${questpieSearchTable.metadata}->>${key} = ${v}`,
              ),
            ),
          );
        } else {
          conditions.push(
            sql`${questpieSearchTable.metadata}->>${key} = ${value}`,
          );
        }
      }
    }

    // Build query condition (for non-empty queries)
    const hasQuery = query.trim().length > 0;
    const prefixQuery = hasQuery
      ? query
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map((word) => `${word}:*`)
          .join(" & ")
      : null;
    const tsQuery = prefixQuery
      ? sql`to_tsquery('simple', ${prefixQuery})`
      : null;

    // Build access filter condition if provided
    const accessCondition = this.buildAccessCondition(accessFilters);

    // Get results
    let rows: any[];
    if (!hasQuery) {
      // Browse mode - no query, just filters
      rows = await this.browseRecordsWithAccess(
        conditions,
        accessFilters,
        accessCondition,
        limit,
        offset,
      );
    } else if (mode === "hybrid") {
      rows = await this.searchHybridWithAccess(
        query,
        tsQuery!,
        conditions,
        accessFilters,
        accessCondition,
        limit,
        offset,
      );
    } else {
      rows = await this.searchFTSWithAccess(
        tsQuery!,
        conditions,
        accessFilters,
        accessCondition,
        limit,
        offset,
      );
    }

    // Map to SearchResult
    const results: SearchResult[] = rows.map((row: any) => ({
      id: row.id,
      collection: row.collection_name,
      recordId: row.record_id,
      score: Number(row.score) || 0,
      title: row.title,
      content: row.content,
      highlights:
        highlights && hasQuery
          ? this.generateHighlights(query, row.title, row.content)
          : undefined,
      metadata: row.metadata || {},
      locale: row.locale,
      updatedAt: row.updated_at,
    }));

    // Get total count
    const total = await this.getTotalWithAccess(
      conditions,
      tsQuery,
      accessFilters,
      accessCondition,
    );

    // Get facets if requested
    let facets: FacetResult[] | undefined;
    if (facetRequests && facetRequests.length > 0) {
      facets = await this.getFacets(facetRequests, conditions, tsQuery, locale);
    }

    return { results, total, facets };
  }

  /**
   * Build CASE-based access condition for filtering by collection access rules
   */
  private buildAccessCondition(
    accessFilters?: SearchOptions["accessFilters"],
  ): ReturnType<typeof sql> | null {
    if (!accessFilters || accessFilters.length === 0) {
      return null;
    }

    // Build individual CASE conditions
    const caseConditions: ReturnType<typeof sql>[] = [];

    for (const filter of accessFilters) {
      const { collection, table, accessWhere, softDelete } = filter;
      const tableName =
        (table as any)[Symbol.for("drizzle:Name")] || collection;

      if (accessWhere === false) {
        // No access - always false for this collection
        caseConditions.push(
          sql`WHEN ${questpieSearchTable.collectionName} = ${collection} THEN FALSE`,
        );
      } else if (accessWhere === true) {
        // Full access - just check existence and soft delete
        if (softDelete) {
          caseConditions.push(
            sql`WHEN ${questpieSearchTable.collectionName} = ${collection} THEN (${sql.raw(`"${tableName}".id IS NOT NULL AND "${tableName}".deleted_at IS NULL`)})`,
          );
        } else {
          caseConditions.push(
            sql`WHEN ${questpieSearchTable.collectionName} = ${collection} THEN (${sql.raw(`"${tableName}".id IS NOT NULL`)})`,
          );
        }
      } else {
        // Conditional access - apply WHERE conditions
        let condition = `"${tableName}".id IS NOT NULL`;
        if (softDelete) {
          condition += ` AND "${tableName}".deleted_at IS NULL`;
        }
        const accessConditions = this.accessWhereToSql(accessWhere, tableName);
        if (accessConditions) {
          condition += ` AND (${accessConditions})`;
        }
        caseConditions.push(
          sql`WHEN ${questpieSearchTable.collectionName} = ${collection} THEN (${sql.raw(condition)})`,
        );
      }
    }

    if (caseConditions.length === 0) {
      return null;
    }

    // Combine all CASE conditions
    return sql`CASE ${sql.join(caseConditions, sql` `)} ELSE FALSE END`;
  }

  /**
   * Convert AccessWhere object to SQL string
   */
  private accessWhereToSql(
    accessWhere: Record<string, any>,
    tableName: string,
  ): string | null {
    const conditions: string[] = [];

    for (const [key, value] of Object.entries(accessWhere)) {
      if (key === "AND" && Array.isArray(value)) {
        const andConditions = value
          .map((v) => this.accessWhereToSql(v, tableName))
          .filter(Boolean);
        if (andConditions.length > 0) {
          conditions.push(`(${andConditions.join(" AND ")})`);
        }
      } else if (key === "OR" && Array.isArray(value)) {
        const orConditions = value
          .map((v) => this.accessWhereToSql(v, tableName))
          .filter(Boolean);
        if (orConditions.length > 0) {
          conditions.push(`(${orConditions.join(" OR ")})`);
        }
      } else if (key === "NOT" && typeof value === "object") {
        const notCondition = this.accessWhereToSql(value, tableName);
        if (notCondition) {
          conditions.push(`NOT (${notCondition})`);
        }
      } else {
        // Simple field = value condition
        const escapedValue =
          typeof value === "string"
            ? `'${value.replace(/'/g, "''")}'`
            : value === null
              ? "NULL"
              : value;
        conditions.push(`"${tableName}"."${key}" = ${escapedValue}`);
      }
    }

    return conditions.length > 0 ? conditions.join(" AND ") : null;
  }

  /**
   * Build LEFT JOINs for access filtering
   */
  private buildAccessJoins(
    accessFilters?: SearchOptions["accessFilters"],
  ): ReturnType<typeof sql> | null {
    if (!accessFilters || accessFilters.length === 0) {
      return null;
    }

    const joinParts: ReturnType<typeof sql>[] = [];

    for (const filter of accessFilters) {
      const { collection, table } = filter;
      const tableName =
        (table as any)[Symbol.for("drizzle:Name")] || collection;
      joinParts.push(
        sql`LEFT JOIN ${sql.raw(`"${tableName}"`)} ON ${questpieSearchTable.collectionName} = ${collection} AND ${questpieSearchTable.recordId} = ${sql.raw(`"${tableName}".id::text`)}`,
      );
    }

    return joinParts.length > 0 ? sql.join(joinParts, sql` `) : null;
  }

  /**
   * Browse records without a search query (for facet-only or browsing)
   */
  private async browseRecords(
    conditions: any[],
    limit: number,
    offset: number,
  ): Promise<any[]> {
    return this.db!.select({
      id: questpieSearchTable.id,
      collection_name: questpieSearchTable.collectionName,
      record_id: questpieSearchTable.recordId,
      title: questpieSearchTable.title,
      content: questpieSearchTable.content,
      metadata: questpieSearchTable.metadata,
      locale: questpieSearchTable.locale,
      updated_at: questpieSearchTable.updatedAt,
      score: sql<number>`1`, // Default score for browse
    })
      .from(questpieSearchTable)
      .where(and(...conditions))
      .orderBy(desc(questpieSearchTable.updatedAt))
      .limit(limit)
      .offset(offset);
  }

  /**
   * Browse records with access filtering via JOINs
   */
  private async browseRecordsWithAccess(
    conditions: any[],
    accessFilters: SearchOptions["accessFilters"],
    accessCondition: ReturnType<typeof sql> | null,
    limit: number,
    offset: number,
  ): Promise<any[]> {
    // If no access filters, fall back to regular browse
    if (!accessFilters || accessFilters.length === 0 || !accessCondition) {
      return this.browseRecords(conditions, limit, offset);
    }

    const joins = this.buildAccessJoins(accessFilters);
    const allConditions = [...conditions];
    if (accessCondition) {
      allConditions.push(accessCondition);
    }

    const query = sql`
			SELECT
				${questpieSearchTable.id} as id,
				${questpieSearchTable.collectionName} as collection_name,
				${questpieSearchTable.recordId} as record_id,
				${questpieSearchTable.title} as title,
				${questpieSearchTable.content} as content,
				${questpieSearchTable.metadata} as metadata,
				${questpieSearchTable.locale} as locale,
				${questpieSearchTable.updatedAt} as updated_at,
				1 as score
			FROM ${questpieSearchTable}
			${joins}
			WHERE ${and(...allConditions)}
			ORDER BY ${questpieSearchTable.updatedAt} DESC
			LIMIT ${limit} OFFSET ${offset}
		`;

    const result = await this.db!.execute(query);
    return (result as any).rows ?? result;
  }

  /**
   * Get total count of matching records
   */
  private async getTotal(conditions: any[], tsQuery: any): Promise<number> {
    const countConditions = [...conditions];
    if (tsQuery) {
      countConditions.push(sql`${questpieSearchTable.ftsVector} @@ ${tsQuery}`);
    }

    const result = await this.db!.select({
      count: sql<number>`COUNT(*)`,
    })
      .from(questpieSearchTable)
      .where(and(...countConditions));

    return Number(result[0]?.count) || 0;
  }

  /**
   * Get total count with access filtering
   */
  private async getTotalWithAccess(
    conditions: any[],
    tsQuery: any,
    accessFilters: SearchOptions["accessFilters"],
    accessCondition: ReturnType<typeof sql> | null,
  ): Promise<number> {
    // If no access filters, fall back to regular count
    if (!accessFilters || accessFilters.length === 0 || !accessCondition) {
      return this.getTotal(conditions, tsQuery);
    }

    const joins = this.buildAccessJoins(accessFilters);
    const countConditions = [...conditions];
    if (tsQuery) {
      countConditions.push(sql`${questpieSearchTable.ftsVector} @@ ${tsQuery}`);
    }
    if (accessCondition) {
      countConditions.push(accessCondition);
    }

    const query = sql`
			SELECT COUNT(*) as count
			FROM ${questpieSearchTable}
			${joins}
			WHERE ${and(...countConditions)}
		`;

    const result = await this.db!.execute(query);
    const rows = (result as any).rows ?? result;
    return Number(rows[0]?.count) || 0;
  }

  /**
   * Get facet aggregations
   */
  private async getFacets(
    facetRequests: Array<{
      field: string;
      limit?: number;
      sortBy?: "count" | "alpha";
    }>,
    conditions: any[],
    tsQuery: any,
    locale: string,
  ): Promise<FacetResult[]> {
    const results: FacetResult[] = [];

    // Build subquery to get matching search IDs
    const searchConditions = [...conditions];
    if (tsQuery) {
      searchConditions.push(
        sql`${questpieSearchTable.ftsVector} @@ ${tsQuery}`,
      );
    }

    for (const facetReq of facetRequests) {
      const { field, limit = 10, sortBy = "count" } = facetReq;

      // Aggregate facet values using subquery
      const facetRows = await this.db!.select({
        value: questpieSearchFacetsTable.facetValue,
        count: sql<number>`COUNT(*)`,
      })
        .from(questpieSearchFacetsTable)
        .where(
          and(
            eq(questpieSearchFacetsTable.facetName, field),
            eq(questpieSearchFacetsTable.locale, locale),
            // Join condition: facet's search_id must be in matching search results
            sql`${questpieSearchFacetsTable.searchId} IN (
							SELECT ${questpieSearchTable.id} FROM ${questpieSearchTable}
							WHERE ${and(...searchConditions)}
						)`,
          ),
        )
        .groupBy(questpieSearchFacetsTable.facetValue)
        .orderBy(
          sortBy === "alpha"
            ? asc(questpieSearchFacetsTable.facetValue)
            : desc(sql`COUNT(*)`),
        )
        .limit(limit);

      // Get numeric stats for range facets
      const stats = await this.getFacetStats(field, searchConditions, locale);

      results.push({
        field,
        values: facetRows.map((row) => ({
          value: row.value,
          count: Number(row.count),
        })),
        stats,
      });
    }

    return results;
  }

  /**
   * Get numeric stats (min/max) for range facets
   */
  private async getFacetStats(
    field: string,
    searchConditions: any[],
    locale: string,
  ): Promise<FacetStats | undefined> {
    const result = await this.db!.select({
      min: sql<number>`MIN(${questpieSearchFacetsTable.numericValue}::numeric)`,
      max: sql<number>`MAX(${questpieSearchFacetsTable.numericValue}::numeric)`,
    })
      .from(questpieSearchFacetsTable)
      .where(
        and(
          eq(questpieSearchFacetsTable.facetName, field),
          eq(questpieSearchFacetsTable.locale, locale),
          sql`${questpieSearchFacetsTable.numericValue} IS NOT NULL`,
          sql`${questpieSearchFacetsTable.searchId} IN (
						SELECT ${questpieSearchTable.id} FROM ${questpieSearchTable}
						WHERE ${and(...searchConditions)}
					)`,
        ),
      );

    const row = result[0];
    if (row && row.min !== null && row.max !== null) {
      return {
        min: Number(row.min),
        max: Number(row.max),
      };
    }

    return undefined;
  }

  /**
   * Pure FTS search using ts_rank_cd (no extensions required)
   */
  private async searchFTS(
    tsQuery: any,
    conditions: any[],
    limit: number,
    offset: number,
  ): Promise<any[]> {
    return this.db!.select({
      id: questpieSearchTable.id,
      collection_name: questpieSearchTable.collectionName,
      record_id: questpieSearchTable.recordId,
      title: questpieSearchTable.title,
      content: questpieSearchTable.content,
      metadata: questpieSearchTable.metadata,
      locale: questpieSearchTable.locale,
      updated_at: questpieSearchTable.updatedAt,
      score: sql<number>`ts_rank_cd(${questpieSearchTable.ftsVector}, ${tsQuery})`,
    })
      .from(questpieSearchTable)
      .where(
        and(...conditions, sql`${questpieSearchTable.ftsVector} @@ ${tsQuery}`),
      )
      .orderBy(
        desc(sql`ts_rank_cd(${questpieSearchTable.ftsVector}, ${tsQuery})`),
      )
      .limit(limit)
      .offset(offset);
  }

  /**
   * Pure FTS search with access filtering via JOINs
   */
  private async searchFTSWithAccess(
    tsQuery: any,
    conditions: any[],
    accessFilters: SearchOptions["accessFilters"],
    accessCondition: ReturnType<typeof sql> | null,
    limit: number,
    offset: number,
  ): Promise<any[]> {
    // If no access filters, fall back to regular FTS
    if (!accessFilters || accessFilters.length === 0 || !accessCondition) {
      return this.searchFTS(tsQuery, conditions, limit, offset);
    }

    const joins = this.buildAccessJoins(accessFilters);
    const allConditions = [
      ...conditions,
      sql`${questpieSearchTable.ftsVector} @@ ${tsQuery}`,
    ];
    if (accessCondition) {
      allConditions.push(accessCondition);
    }

    const whereClause = and(...allConditions);

    const query = sql`
			SELECT
				${questpieSearchTable.id} as id,
				${questpieSearchTable.collectionName} as collection_name,
				${questpieSearchTable.recordId} as record_id,
				${questpieSearchTable.title} as title,
				${questpieSearchTable.content} as content,
				${questpieSearchTable.metadata} as metadata,
				${questpieSearchTable.locale} as locale,
				${questpieSearchTable.updatedAt} as updated_at,
				ts_rank_cd(${questpieSearchTable.ftsVector}, ${tsQuery}) as score
			FROM ${questpieSearchTable}
			${joins}
			WHERE ${whereClause}
			ORDER BY ts_rank_cd(${questpieSearchTable.ftsVector}, ${tsQuery}) DESC
			LIMIT ${limit} OFFSET ${offset}
		`;

    const result = await this.db!.execute(query);
    return (result as any).rows ?? result;
  }

  /**
   * Hybrid search combining FTS + trigram (requires pg_trgm)
   */
  private async searchHybrid(
    query: string,
    tsQuery: any,
    conditions: any[],
    limit: number,
    offset: number,
  ): Promise<any[]> {
    const ftsWeight = this.ftsWeight;
    const trigramWeight = 1 - ftsWeight;
    const threshold = this.trigramThreshold;
    const rows = await this.db!.select({
      id: questpieSearchTable.id,
      collection_name: questpieSearchTable.collectionName,
      record_id: questpieSearchTable.recordId,
      title: questpieSearchTable.title,
      content: questpieSearchTable.content,
      metadata: questpieSearchTable.metadata,
      locale: questpieSearchTable.locale,
      updated_at: questpieSearchTable.updatedAt,
      // Combined score: FTS * ftsWeight + trigram * trigramWeight
      score: sql<number>`(
						COALESCE(ts_rank_cd(${questpieSearchTable.ftsVector}, ${tsQuery}), 0) * ${ftsWeight} +
						COALESCE(similarity(${questpieSearchTable.title}, ${query}), 0) * ${trigramWeight}
					)`,
    })
      .from(questpieSearchTable)
      .where(
        and(
          ...conditions,
          or(
            sql`${questpieSearchTable.ftsVector} @@ ${tsQuery}`,
            sql`similarity(${questpieSearchTable.title}, ${query}) > ${threshold}`,
          ),
        ),
      )
      .orderBy(
        desc(sql`(
					COALESCE(ts_rank_cd(${questpieSearchTable.ftsVector}, ${tsQuery}), 0) * ${ftsWeight} +
					COALESCE(similarity(${questpieSearchTable.title}, ${query}), 0) * ${trigramWeight}
				)`),
      )
      .limit(limit)
      .offset(offset);

    return rows;
  }

  /**
   * Hybrid search with access filtering via JOINs
   */
  private async searchHybridWithAccess(
    query: string,
    tsQuery: any,
    conditions: any[],
    accessFilters: SearchOptions["accessFilters"],
    accessCondition: ReturnType<typeof sql> | null,
    limit: number,
    offset: number,
  ): Promise<any[]> {
    // If no access filters, fall back to regular hybrid search
    if (!accessFilters || accessFilters.length === 0 || !accessCondition) {
      return this.searchHybrid(query, tsQuery, conditions, limit, offset);
    }

    const ftsWeight = this.ftsWeight;
    const trigramWeight = 1 - ftsWeight;
    const threshold = this.trigramThreshold;

    const joins = this.buildAccessJoins(accessFilters);
    const allConditions = [
      ...conditions,
      or(
        sql`${questpieSearchTable.ftsVector} @@ ${tsQuery}`,
        sql`similarity(${questpieSearchTable.title}, ${query}) > ${threshold}`,
      ),
    ];
    if (accessCondition) {
      allConditions.push(accessCondition);
    }

    const scoreExpr = sql`(
			COALESCE(ts_rank_cd(${questpieSearchTable.ftsVector}, ${tsQuery}), 0) * ${ftsWeight} +
			COALESCE(similarity(${questpieSearchTable.title}, ${query}), 0) * ${trigramWeight}
		)`;

    const sqlQuery = sql`
			SELECT
				${questpieSearchTable.id} as id,
				${questpieSearchTable.collectionName} as collection_name,
				${questpieSearchTable.recordId} as record_id,
				${questpieSearchTable.title} as title,
				${questpieSearchTable.content} as content,
				${questpieSearchTable.metadata} as metadata,
				${questpieSearchTable.locale} as locale,
				${questpieSearchTable.updatedAt} as updated_at,
				${scoreExpr} as score
			FROM ${questpieSearchTable}
			${joins}
			WHERE ${and(...allConditions)}
			ORDER BY ${scoreExpr} DESC
			LIMIT ${limit} OFFSET ${offset}
		`;

    const result = await this.db!.execute(sqlQuery);
    return (result as any).rows ?? result;
  }

  /**
   * Generate highlights for search results
   */
  private generateHighlights(
    query: string,
    title?: string,
    content?: string,
  ): { title?: string; content?: string } {
    const highlights: { title?: string; content?: string } = {};

    // Escape special regex characters in query
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    if (title) {
      const regex = new RegExp(`(${escapedQuery})`, "gi");
      highlights.title = title.replace(regex, "<mark>$1</mark>");
    }

    if (content) {
      const regex = new RegExp(`(${escapedQuery})`, "gi");
      const match = regex.exec(content);

      if (match) {
        const start = Math.max(0, match.index - 50);
        const end = Math.min(content.length, match.index + query.length + 50);
        let snippet = content.slice(start, end);

        if (start > 0) snippet = "..." + snippet;
        if (end < content.length) snippet = snippet + "...";

        highlights.content = snippet.replace(
          new RegExp(`(${escapedQuery})`, "gi"),
          "<mark>$1</mark>",
        );
      }
    }

    return highlights;
  }

  // --------------------------------------------------------------------------
  // Indexing
  // --------------------------------------------------------------------------

  async index(params: IndexParams): Promise<void> {
    if (!this.db) {
      throw new Error("PostgresSearchAdapter not initialized");
    }

    const { collection, recordId, locale, title, content, metadata, facets } =
      params;

    // Insert/update main search record
    const [searchRecord] = await this.db
      .insert(questpieSearchTable)
      .values({
        collectionName: collection,
        recordId,
        locale,
        title,
        content,
        metadata: metadata || {},
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          questpieSearchTable.collectionName,
          questpieSearchTable.recordId,
          questpieSearchTable.locale,
        ],
        set: {
          title,
          content,
          metadata: metadata || {},
          updatedAt: new Date(),
        },
      })
      .returning({ id: questpieSearchTable.id });

    // Handle facets if provided
    if (facets && facets.length > 0 && searchRecord) {
      // Delete existing facets for this record
      await this.db
        .delete(questpieSearchFacetsTable)
        .where(eq(questpieSearchFacetsTable.searchId, searchRecord.id));

      // Insert new facets
      await this.db.insert(questpieSearchFacetsTable).values(
        facets.map((f) => ({
          searchId: searchRecord.id,
          collectionName: collection,
          locale,
          facetName: f.name,
          facetValue: f.value,
          numericValue: f.numericValue?.toString(),
        })),
      );
    }
  }

  async indexBatch(params: IndexParams[]): Promise<void> {
    if (!this.db) {
      throw new Error("PostgresSearchAdapter not initialized");
    }

    if (params.length === 0) return;

    // Use batch insert with ON CONFLICT DO UPDATE for efficiency
    const values = params.map((p) => ({
      collectionName: p.collection,
      recordId: p.recordId,
      locale: p.locale,
      title: p.title,
      content: p.content,
      metadata: p.metadata || {},
      updatedAt: new Date(),
    }));

    // Insert all records
    const insertedRecords = await this.db
      .insert(questpieSearchTable)
      .values(values)
      .onConflictDoUpdate({
        target: [
          questpieSearchTable.collectionName,
          questpieSearchTable.recordId,
          questpieSearchTable.locale,
        ],
        set: {
          title: sql`excluded.title`,
          content: sql`excluded.content`,
          metadata: sql`excluded.metadata`,
          updatedAt: sql`now()`,
        },
      })
      .returning({
        id: questpieSearchTable.id,
        collectionName: questpieSearchTable.collectionName,
        recordId: questpieSearchTable.recordId,
        locale: questpieSearchTable.locale,
      });

    // Handle facets for each record
    for (let i = 0; i < params.length; i++) {
      const param = params[i];
      const searchRecord = insertedRecords.find(
        (r) =>
          r.collectionName === param.collection &&
          r.recordId === param.recordId &&
          r.locale === param.locale,
      );

      if (param.facets && param.facets.length > 0 && searchRecord) {
        // Delete existing facets for this record
        await this.db
          .delete(questpieSearchFacetsTable)
          .where(eq(questpieSearchFacetsTable.searchId, searchRecord.id));

        // Insert new facets
        await this.db.insert(questpieSearchFacetsTable).values(
          param.facets.map((f) => ({
            searchId: searchRecord.id,
            collectionName: param.collection,
            locale: param.locale,
            facetName: f.name,
            facetValue: f.value,
            numericValue: f.numericValue?.toString(),
          })),
        );
      }
    }
  }

  async remove(params: RemoveParams): Promise<void> {
    if (!this.db) {
      throw new Error("PostgresSearchAdapter not initialized");
    }

    const { collection, recordId, locale } = params;

    const conditions = [
      eq(questpieSearchTable.collectionName, collection),
      eq(questpieSearchTable.recordId, recordId),
    ];

    if (locale) {
      conditions.push(eq(questpieSearchTable.locale, locale));
    }

    await this.db.delete(questpieSearchTable).where(and(...conditions));
  }

  async reindex(_collection: string): Promise<void> {
    // TODO: Implement when we have access to CMS and collection records
    // This would:
    // 1. Clear existing entries for collection
    // 2. Iterate all records
    // 3. Index each record
    throw new Error("reindex() not yet implemented - requires CMS context");
  }

  async clear(): Promise<void> {
    if (!this.db) {
      throw new Error("PostgresSearchAdapter not initialized");
    }

    // Facets are deleted via CASCADE when search records are deleted
    await this.db.delete(questpieSearchTable);
  }

  // --------------------------------------------------------------------------
  // Schema & Extensions (for migration generation)
  // --------------------------------------------------------------------------

  /**
   * Get Drizzle table schemas for migration generation.
   * These tables will be included in cms.getSchema() for Drizzle migrations.
   */
  getTableSchemas(): Record<string, any> {
    return {
      questpie_search: questpieSearchTable,
      questpie_search_facets: questpieSearchFacetsTable,
    };
  }

  /**
   * Get required PostgreSQL extensions.
   * These will be created before migrations are run.
   */
  getExtensions(): string[] {
    return ["CREATE EXTENSION IF NOT EXISTS pg_trgm;"];
  }
}

// ============================================================================
// Factory function
// ============================================================================

/**
 * Create PostgreSQL search adapter
 *
 * @example
 * ```ts
 * questpie({
 *   search: createPostgresSearchAdapter({
 *     trigramThreshold: 0.3,
 *     ftsWeight: 0.7,
 *   }),
 * })
 * ```
 */
export function createPostgresSearchAdapter(
  options?: PostgresSearchAdapterOptions,
): PostgresSearchAdapter {
  return new PostgresSearchAdapter(options);
}
