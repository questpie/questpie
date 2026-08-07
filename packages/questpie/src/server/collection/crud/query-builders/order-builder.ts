/**
 * ORDER BY Clause Building Utilities
 *
 * Pure functions for building SQL ORDER BY clauses from query options.
 */

import { type SQL, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import type { CollectionBuilderState } from "#questpie/server/collection/builder/types.js";
import type { OrderBy } from "#questpie/server/collection/crud/types.js";
import { ApiError } from "#questpie/server/errors/base.js";

/**
 * Options for building ORDER BY clauses
 */
export interface BuildOrderByClausesOptions {
	/** The main table */
	table: PgTable;
	/** Collection builder state (for localized field checking) */
	state: CollectionBuilderState;
	/** Aliased i18n table for current locale (null if no i18n) */
	i18nCurrentTable: PgTable | null;
	/** Aliased i18n table for fallback locale (null if no fallback) */
	i18nFallbackTable: PgTable | null;
	/** Whether to use i18n tables for localized fields */
	useI18n?: boolean;
}

/**
 * Build ORDER BY clauses from orderBy option
 *
 * Supports three syntaxes:
 * - Object syntax: { field: 'asc' | 'desc' }
 * - Array syntax: [{ field1: 'desc' }, { field2: 'asc' }]
 * - Function syntax: (table, { asc, desc }) => [asc(table.id)]
 *
 * Array syntax and object syntax both support multi-field sorting.
 * The order of fields determines sort priority - first field is primary sort,
 * second field is secondary sort, etc.
 *
 * For localized fields, uses COALESCE(current, fallback) for sorting.
 *
 * @param orderBy - The orderBy option from query
 * @param options - Options for building the clauses
 * @returns Array of SQL ORDER BY clauses
 */
export function buildOrderByClauses(
	orderBy: OrderBy,
	options: BuildOrderByClausesOptions,
): SQL[] {
	const {
		table,
		state,
		i18nCurrentTable,
		i18nFallbackTable,
		useI18n = false,
	} = options;

	if (typeof orderBy === "function") {
		return orderBy(table, {
			asc: (col: any) => sql`${col} ASC`,
			desc: (col: any) => sql`${col} DESC`,
		});
	}

	// Array syntax: [{ field1: 'desc' }, { field2: 'asc' }]
	if (Array.isArray(orderBy)) {
		return orderBy.flatMap((obj) => buildOrderByClauses(obj as any, options));
	}

	// Object syntax
	const clauses: SQL[] = [];
	for (const [field, direction] of Object.entries(orderBy)) {
		// A `virtual(sql)` field has no table column but does have an ordered SQL
		// expression, and `buildWhereClause` already resolves it that way
		// (`buildLocalizedFieldRef`). Resolving it here too means a field is
		// orderable exactly when it is filterable, instead of silently sorting by
		// nothing.
		let column: SQL | any = state.virtuals?.[field] ?? (table as any)[field];

		// For localized fields, use COALESCE with i18n tables
		if (useI18n && i18nCurrentTable && state.localized.includes(field as any)) {
			const i18nCurrentTbl = i18nCurrentTable as any;

			if (i18nFallbackTable) {
				const i18nFallbackTbl = i18nFallbackTable as any;
				column = sql`COALESCE(${i18nCurrentTbl[field]}, ${i18nFallbackTbl[field]})`;
			} else {
				column = i18nCurrentTbl[field];
			}
		}

		// An order term that resolves to nothing used to be dropped in silence, so
		// the rows came back in an arbitrary order that merely LOOKED sorted. That
		// is a typo you cannot see. It also breaks any caller that has to reproduce
		// the sort — a keyset cursor compares against the terms it was told about,
		// so a dropped term makes the ORDER BY and the cursor predicate disagree
		// and pages then overlap or skip.
		if (!column) {
			throw ApiError.badRequest(
				`Cannot order by '${field}': it is not a column of '${state.name}'. ` +
					`Order by a stored field, a localized field, or a field declared with 'virtual: sql\`...\`'.`,
			);
		}

		clauses.push(
			direction === "desc" ? sql`${column} DESC` : sql`${column} ASC`,
		);
	}

	return clauses;
}
