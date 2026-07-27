import { and, eq, sql, type SQL } from "drizzle-orm";
import { alias, type PgTable } from "drizzle-orm/pg-core";

import { buildWhereClause } from "#questpie/server/collection/crud/query-builders/where-builder.js";
import { getColumn } from "#questpie/server/collection/crud/shared/index.js";

import { questpieSearchTable } from "./collection.js";
import type { CollectionAccessFilter } from "./types.js";

const CANDIDATE_COLLECTION_COLUMN = sql.identifier("collection_name");
const CANDIDATE_RECORD_COLUMN = sql.identifier("record_id");

function safeAliasPart(value: string): string {
	return value.replace(/[^a-zA-Z0-9_]/g, "_");
}

function validateAccessPredicateNode(
	node: unknown,
	collection: string,
): asserts node is Record<string, any> {
	if (!node || typeof node !== "object" || Array.isArray(node)) {
		throw new Error(
			`Search access predicate for "${collection}" has an invalid boolean node`,
		);
	}

	for (const [key, value] of Object.entries(node)) {
		if (key === "AND" || key === "OR") {
			if (!Array.isArray(value) || value.length === 0) {
				throw new Error(
					`Search access predicate for "${collection}" has an empty or invalid ${key} branch`,
				);
			}
			for (const branch of value) {
				validateAccessPredicateNode(branch, collection);
			}
		} else if (key === "NOT") {
			validateAccessPredicateNode(value, collection);
			if (Object.keys(value).length === 0) {
				throw new Error(
					`Search access predicate for "${collection}" has an empty NOT branch`,
				);
			}
		}
	}
}

function buildI18nPlan(
	filter: CollectionAccessFilter,
	table: PgTable,
): {
	current: PgTable | null;
	fallback: PgTable | null;
	joins: SQL[];
} {
	const i18nTable = filter.i18nTable as PgTable | undefined;
	if (!i18nTable) {
		return { current: null, fallback: null, joins: [] };
	}

	const context = filter.context;
	const locale = context?.locale ?? context?.defaultLocale ?? "en";
	const defaultLocale = context?.defaultLocale ?? "en";
	const needsFallback =
		context?.localeFallback !== false && locale !== defaultLocale;
	const aliasPart = safeAliasPart(filter.collection);
	const current = alias(
		i18nTable,
		`search_${aliasPart}_i18n_current`,
	) as PgTable;
	const fallback = needsFallback
		? (alias(i18nTable, `search_${aliasPart}_i18n_fallback`) as PgTable)
		: null;
	const sourceId = getColumn(table, "id");
	const currentParentId = getColumn(current, "parentId");
	const currentLocale = getColumn(current, "locale");
	if (!sourceId || !currentParentId || !currentLocale) {
		throw new Error(
			`Search access plan cannot join localized collection "${filter.collection}"`,
		);
	}

	const joins: SQL[] = [
		sql`LEFT JOIN ${current} ON ${and(
			eq(currentParentId, sourceId),
			eq(currentLocale, locale),
		)}`,
	];

	if (fallback) {
		const fallbackParentId = getColumn(fallback, "parentId");
		const fallbackLocale = getColumn(fallback, "locale");
		if (!fallbackParentId || !fallbackLocale) {
			throw new Error(
				`Search access plan cannot join fallback locale for collection "${filter.collection}"`,
			);
		}
		joins.push(
			sql`LEFT JOIN ${fallback} ON ${and(
				eq(fallbackParentId, sourceId),
				eq(fallbackLocale, defaultLocale),
			)}`,
		);
	}

	return { current, fallback, joins };
}

/**
 * Compile the collection read predicates into one authorized candidate
 * universe. Every built-in query surface reuses the returned correlated
 * predicate, so hits, totals, facets, statistics, browse, and semantic ranking
 * cannot disagree about which source rows are visible.
 */
export function buildAuthorizedCandidateCondition(
	accessFilters?: CollectionAccessFilter[],
): SQL | null {
	if (!accessFilters) return null;

	const candidates: SQL[] = [];
	for (const filter of accessFilters) {
		if (filter.accessWhere === false) continue;

		const table = filter.table as PgTable | undefined;
		const state = filter.state;
		if (!table) {
			throw new Error(
				`Search access filter for "${filter.collection}" is missing its source table`,
			);
		}
		if (filter.accessWhere !== true && !state) {
			throw new Error(
				`Search access filter for "${filter.collection}" is missing canonical collection state`,
			);
		}

		const idColumn = getColumn(table, "id");
		if (!idColumn) {
			throw new Error(
				`Search access filter for "${filter.collection}" has no id column`,
			);
		}

		const i18n = buildI18nPlan(filter, table);
		const predicates: SQL[] = [];
		if (filter.accessWhere !== true) {
			validateAccessPredicateNode(filter.accessWhere, filter.collection);
			const accessWhere = buildWhereClause(filter.accessWhere, {
				table,
				state: state!,
				i18nCurrentTable: i18n.current,
				i18nFallbackTable: i18n.fallback,
				context: filter.context,
				app: filter.app,
				useI18n: i18n.current !== null,
				db: filter.db,
				failClosedAccess: true,
			});
			if (accessWhere) predicates.push(accessWhere);
		}

		if (filter.softDelete) {
			const deletedAt = getColumn(table, "deletedAt");
			if (!deletedAt) {
				throw new Error(
					`Soft-delete Search collection "${filter.collection}" has no deletedAt column`,
				);
			}
			predicates.push(sql`${deletedAt} IS NULL`);
		}

		candidates.push(sql`
			SELECT
				${filter.collection}::text AS ${CANDIDATE_COLLECTION_COLUMN},
				${idColumn}::text AS ${CANDIDATE_RECORD_COLUMN}
			FROM ${table}
			${sql.join(i18n.joins, sql` `)}
			${predicates.length > 0 ? sql`WHERE ${and(...predicates)}` : sql``}
		`);
	}

	if (candidates.length === 0) return sql`FALSE`;

	const candidateAlias = sql.identifier("questpie_authorized_candidates");
	return sql`EXISTS (
		SELECT 1
		FROM (${sql.join(candidates, sql` UNION ALL `)}) AS ${candidateAlias}
		WHERE ${candidateAlias}.${CANDIDATE_COLLECTION_COLUMN} = ${questpieSearchTable.collectionName}
			AND ${candidateAlias}.${CANDIDATE_RECORD_COLUMN} = ${questpieSearchTable.recordId}
	)`;
}
