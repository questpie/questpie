import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
	questpieSearchFacetsTable,
	questpieSearchTable,
} from "./collection.js";
import type { FacetDefinition, FacetResult, FacetStats } from "./types.js";

async function getFacetStats(
	db: PostgresJsDatabase<any>,
	field: string,
	searchConditions: SQL[],
	locale: string,
): Promise<FacetStats | undefined> {
	const result = await db
		.select({
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
					SELECT ${questpieSearchTable.id}
					FROM ${questpieSearchTable}
					WHERE ${and(...searchConditions)}
				)`,
			),
		);

	const row = result[0];
	if (row && row.min !== null && row.max !== null) {
		return { min: Number(row.min), max: Number(row.max) };
	}
	return undefined;
}

export async function querySearchFacets(
	db: PostgresJsDatabase<any>,
	facetRequests: FacetDefinition[],
	searchConditions: SQL[],
	locale: string,
): Promise<FacetResult[]> {
	const results: FacetResult[] = [];

	for (const facetReq of facetRequests) {
		const { field, limit = 10, sortBy = "count" } = facetReq;
		const facetRows = await db
			.select({
				value: questpieSearchFacetsTable.facetValue,
				count: sql<number>`COUNT(*)`,
			})
			.from(questpieSearchFacetsTable)
			.where(
				and(
					eq(questpieSearchFacetsTable.facetName, field),
					eq(questpieSearchFacetsTable.locale, locale),
					sql`${questpieSearchFacetsTable.searchId} IN (
						SELECT ${questpieSearchTable.id}
						FROM ${questpieSearchTable}
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

		results.push({
			field,
			values: facetRows.map((row) => ({
				value: row.value,
				count: Number(row.count),
			})),
			stats: await getFacetStats(db, field, searchConditions, locale),
		});
	}

	return results;
}
