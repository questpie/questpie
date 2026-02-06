/**
 * ORDER BY Clause Building Utilities
 *
 * Pure functions for building SQL ORDER BY clauses from query options.
 */

import { type SQL, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { CollectionBuilderState } from "#questpie/server/collection/builder/types.js";
import type { OrderBy } from "#questpie/server/collection/crud/types.js";

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
 * Supports two syntaxes:
 * - Object syntax: { field: 'asc' | 'desc' }
 * - Function syntax: (table, { asc, desc }) => [asc(table.id)]
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

  // Object syntax
  const clauses: SQL[] = [];
  for (const [field, direction] of Object.entries(orderBy)) {
    let column: SQL | any = (table as any)[field];

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

    if (column) {
      clauses.push(
        direction === "desc" ? sql`${column} DESC` : sql`${column} ASC`,
      );
    }
  }

  return clauses;
}
