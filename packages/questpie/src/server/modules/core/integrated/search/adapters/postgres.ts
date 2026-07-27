/**
 * PostgresSearchAdapter
 *
 * Default search adapter using PostgreSQL built-in features:
 * - Full-text search (FTS) with ts_rank_cd (no extensions required)
 * - Trigram fuzzy matching (requires pg_trgm extension)
 *
 * FTS rank and trigram similarity are combined as one lexical strategy.
 */

import { and, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { DEFAULT_LOCALE } from "#questpie/shared/constants.js";

import { buildAuthorizedCandidateCondition } from "../access-plan.js";
import {
	questpieSearchFacetsTable,
	questpieSearchTable,
} from "../collection.js";
import { querySearchFacets } from "../facets-query.js";
import type {
	AdapterCapabilities,
	AdapterInitContext,
	AdapterMigration,
	FacetResult,
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
	 * Weight for FTS score in lexical ranking (0-1)
	 * Trigram weight = 1 - ftsWeight
	 * @default 0.7
	 */
	ftsWeight?: number;
}

function buildPrefixTsQuery(query: string): string | null {
	const words = query
		.replace(/[^\p{L}\p{N}_]+/gu, " ")
		.trim()
		.split(/\s+/)
		.filter(Boolean);

	if (words.length === 0) return null;

	return words.map((word) => `${word}:*`).join(" & ");
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
			trigram: true, // requires the pg_trgm extension (provided out-of-band)
			semantic: false,
			hybrid: false,
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

	// TODO: this should return the standard migration format and type, and we should make sure this is actually run upon generate -> this should not be implicit, but really appear inside the generated migrations folder
	// if we need to add to this it should be additive
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
				up: `CREATE EXTENSION IF NOT EXISTS "pg_trgm";`,
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
			mode = "lexical",
			filters,
			highlights = true,
			facets: facetRequests,
			accessFilters,
		} = options;

		if (mode !== "lexical") {
			throw new Error(
				`PostgresSearchAdapter does not support "${mode}" search mode`,
			);
		}

		const conditions: SQL[] = [];

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
						value.length > 0
							? or(
									...value.map(
										(v) => sql`${questpieSearchTable.metadata}->>${key} = ${v}`,
									),
								)!
							: sql`FALSE`,
					);
				} else {
					conditions.push(
						sql`${questpieSearchTable.metadata}->>${key} = ${value}`,
					);
				}
			}
		}

		const authorizedCandidates =
			buildAuthorizedCandidateCondition(accessFilters);
		if (authorizedCandidates) conditions.push(authorizedCandidates);

		const prefixQuery = buildPrefixTsQuery(query);
		const hasQuery = prefixQuery !== null;
		const tsQuery = prefixQuery
			? sql`to_tsquery('simple', ${prefixQuery})`
			: null;
		const searchConditions = [...conditions];
		if (hasQuery) {
			searchConditions.push(this.buildLexicalMatchCondition(query, tsQuery!));
		}

		let rows: any[];
		if (!hasQuery) {
			rows = await this.browseRecords(searchConditions, limit, offset);
		} else {
			rows = await this.searchLexical(
				query,
				tsQuery!,
				searchConditions,
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

		const total = await this.getTotal(searchConditions);

		let facets: FacetResult[] | undefined;
		if (facetRequests && facetRequests.length > 0) {
			facets = await querySearchFacets(
				this.db,
				facetRequests,
				searchConditions,
				locale,
			);
		}

		return { results, total, facets };
	}

	/**
	 * Browse records without a search query (for facet-only or browsing)
	 */
	private async browseRecords(
		conditions: SQL[],
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

	private async getTotal(conditions: SQL[]): Promise<number> {
		const result = await this.db!.select({
			count: sql<number>`COUNT(*)`,
		})
			.from(questpieSearchTable)
			.where(and(...conditions));

		return Number(result[0]?.count) || 0;
	}

	private buildLexicalMatchCondition(query: string, tsQuery: SQL): SQL {
		return or(
			sql`${questpieSearchTable.ftsVector} @@ ${tsQuery}`,
			sql`similarity(${questpieSearchTable.title}, ${query}) > ${this.trigramThreshold}`,
		)!;
	}

	/**
	 * Lexical search combines FTS rank with trigram similarity. This is one
	 * lexical ranking strategy, not the reserved lexical+semantic hybrid mode.
	 */
	private async searchLexical(
		query: string,
		tsQuery: SQL,
		conditions: SQL[],
		limit: number,
		offset: number,
	): Promise<any[]> {
		const ftsWeight = this.ftsWeight;
		const trigramWeight = 1 - ftsWeight;
		const rows = await this.db!.select({
			id: questpieSearchTable.id,
			collection_name: questpieSearchTable.collectionName,
			record_id: questpieSearchTable.recordId,
			title: questpieSearchTable.title,
			content: questpieSearchTable.content,
			metadata: questpieSearchTable.metadata,
			locale: questpieSearchTable.locale,
			updated_at: questpieSearchTable.updatedAt,
			score: sql<number>`(
						COALESCE(ts_rank_cd(${questpieSearchTable.ftsVector}, ${tsQuery}), 0) * ${ftsWeight} +
						COALESCE(similarity(${questpieSearchTable.title}, ${query}), 0) * ${trigramWeight}
					)`,
		})
			.from(questpieSearchTable)
			.where(and(...conditions))
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

		// Facets are a replacement projection. Clear previous values even when the
		// new projection is empty so removed fields cannot remain observable.
		if (searchRecord) {
			await this.db
				.delete(questpieSearchFacetsTable)
				.where(eq(questpieSearchFacetsTable.searchId, searchRecord.id));

			if (facets && facets.length > 0) {
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

			if (searchRecord) {
				await this.db
					.delete(questpieSearchFacetsTable)
					.where(eq(questpieSearchFacetsTable.searchId, searchRecord.id));

				if (param.facets && param.facets.length > 0) {
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
		// TODO: Implement when we have access to app and collection records
		// This would:
		// 1. Clear existing entries for collection
		// 2. Iterate all records
		// 3. Index each record
		throw new Error("reindex() not yet implemented - requires app context");
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
	 * These tables will be included in app.getSchema() for Drizzle migrations.
	 */
	getTableSchemas(): Record<string, any> {
		return {
			questpie_search: questpieSearchTable,
			questpie_search_facets: questpieSearchFacetsTable,
		};
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
 * config({
 *   search: createPostgresSearchAdapter({
 *     trigramThreshold: 0.3,
 *     ftsWeight: 0.7,
 *   }),
 *   db: { url: process.env.DATABASE_URL! },
 *   app: { url: process.env.APP_URL! },
 * })
 * ```
 */
export function createPostgresSearchAdapter(
	options?: PostgresSearchAdapterOptions,
): PostgresSearchAdapter {
	return new PostgresSearchAdapter(options);
}
