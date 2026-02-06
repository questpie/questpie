/**
 * SELECT Object Building Utilities
 *
 * Pure functions for building SQL SELECT objects from query options.
 * Handles regular fields, localized fields with application-side merge, virtual fields, and timestamps.
 *
 * ## I18n Strategy (Application-Side Fallback)
 *
 * Instead of SQL COALESCE subqueries, we use two LEFT JOINs and application-side merge:
 * - SELECT columns are prefixed: `_i18n_title`, `_i18n_fallback_title`
 * - Application code merges: `title = current ?? fallback ?? null`
 *
 * Benefits:
 * - Simpler SQL queries (no N subqueries per N localized fields)
 * - Foundation for nested localized JSONB
 * - Flexible locale chains
 */

import { type Column, type SQL, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { CollectionBuilderState } from "#questpie/server/collection/builder/types.js";
import { buildLocalizedFieldRef } from "#questpie/server/collection/crud/query-builders/where-builder.js";
import {
  I18N_CURRENT_PREFIX,
  I18N_FALLBACK_PREFIX,
} from "#questpie/server/collection/crud/shared/i18n-merge.js";
import type {
  Columns,
  CRUDContext,
  Extras,
} from "#questpie/server/collection/crud/types.js";

/** Title expression for SQL queries - resolved column or SQL expression */
type TitleExpressionSQL = SQL | Column | null;

/**
 * Options for building SELECT object
 */
export interface BuildSelectObjectOptions {
  /** The main table */
  table: PgTable;
  /** Collection builder state */
  state: CollectionBuilderState;
  /** Aliased i18n table for current locale (null if no i18n) */
  i18nCurrentTable: PgTable | null;
  /** Aliased i18n table for fallback locale (null if no fallback needed) */
  i18nFallbackTable: PgTable | null;
  /**
   * Function to get virtuals with aliased i18n tables.
   * Takes context and aliased tables to generate virtuals with proper COALESCE.
   */
  getVirtualsWithAliases?: (
    context: any,
    i18nCurrentTable: PgTable | null,
    i18nFallbackTable: PgTable | null,
  ) => CollectionBuilderState["virtuals"];
  /** Function to get title expression based on context (deprecated - title now computed from virtuals) */
  getTitle?: (context: any) => TitleExpressionSQL;
}

/**
 * Build SELECT object for query
 * Includes: regular fields, localized fields (with prefixed columns for app-side merge),
 * _localized column for nested localized values, virtual fields, timestamps, _title
 *
 * Localized fields are selected with prefixes:
 * - `_i18n_${field}` from current locale table
 * - `_i18n_fallback_${field}` from fallback locale table (if fallback enabled)
 *
 * Nested localized values (via _localized column):
 * - `_i18n__localized` from current locale table
 * - `_i18n_fallback__localized` from fallback locale table
 * - Application-side merge using mergeNestedLocalizedFromColumn
 *
 * @param columns - Column selection (true/false for each field)
 * @param extras - Extra SQL fields to include
 * @param context - CRUD context (locale, etc.)
 * @param options - Options for building the select
 * @returns SELECT object for Drizzle query
 */
export function buildSelectObject(
  columns: Columns | undefined,
  extras: Extras | undefined,
  context: CRUDContext | undefined,
  options: BuildSelectObjectOptions,
): Record<string, any> {
  const {
    table,
    state,
    i18nCurrentTable,
    i18nFallbackTable,
    getVirtualsWithAliases,
    getTitle,
  } = options;

  const select: Record<string, any> = {
    id: (table as any).id,
  };

  const locale = context?.locale;
  const hasFallback =
    i18nFallbackTable !== null && context?.localeFallback !== false;

  // Determine which fields to include based on columns option
  const includedFields = getIncludedFields(columns, state);

  // Regular and localized fields
  for (const [name, _column] of Object.entries(state.fields)) {
    // Skip if not in included fields
    if (!includedFields.has(name)) continue;

    const isLocalizedField = state.localized.includes(name as any);

    // Check if this is a flat localized field (has column in i18n table)
    // JSONB localized fields don't have columns in i18n table - they use _localized
    if (isLocalizedField && i18nCurrentTable && locale) {
      const i18nCurrentTbl = i18nCurrentTable as any;

      // Check if column exists in ORIGINAL i18n table (aliased tables don't support property checks)
      const columnExistsInI18n =
        i18nCurrentTbl && (i18nCurrentTbl as any)[name];

      if (columnExistsInI18n) {
        // Flat localized field: select from i18n table with prefixed keys
        select[`${I18N_CURRENT_PREFIX}${name}`] = i18nCurrentTbl[name];

        // Fallback locale value (prefixed) - only if fallback is enabled
        if (hasFallback) {
          const i18nFallbackTbl = i18nFallbackTable as any;
          select[`${I18N_FALLBACK_PREFIX}${name}`] = i18nFallbackTbl[name];
        }
      } else {
        // JSONB localized field: select from main table (uses _localized for values)
        select[name] = (table as any)[name];
      }
    }
    // Regular field: direct column reference
    else {
      select[name] = (table as any)[name];
    }
  }

  // Select _localized column from i18n tables for nested localized values
  if (i18nCurrentTable && locale) {
    const i18nCurrentTbl = i18nCurrentTable as any;
    if (i18nCurrentTbl._localized) {
      select[`${I18N_CURRENT_PREFIX}_localized`] = i18nCurrentTbl._localized;

      if (hasFallback) {
        const i18nFallbackTbl = i18nFallbackTable as any;
        select[`${I18N_FALLBACK_PREFIX}_localized`] =
          i18nFallbackTbl._localized;
      }
    }
  }

  // Virtual fields (computed SQL expressions)
  // Use getVirtualsWithAliases to get virtuals with proper COALESCE using aliased tables
  const virtuals = getVirtualsWithAliases
    ? getVirtualsWithAliases(context, i18nCurrentTable, i18nFallbackTable)
    : state.virtuals;

  for (const [name, sqlExpr] of Object.entries(virtuals ?? {})) {
    if (!includedFields.has(name)) continue;
    select[name] = sqlExpr;
  }

  // _title field (pure virtual - computed from title expression, fallback to id)
  if (includedFields.has("_title")) {
    let titleExpr: unknown = null;

    if (state.title) {
      // Check if title is a simple localized field name
      // In that case, use buildLocalizedFieldRef to get COALESCE with aliased tables
      if (
        state.localized.includes(state.title as any) &&
        i18nCurrentTable &&
        locale
      ) {
        titleExpr = buildLocalizedFieldRef(state.title, {
          table,
          state,
          i18nCurrentTable,
          i18nFallbackTable,
          useI18n: true,
        });
      }
      // Check if title is a regular (non-localized) field
      else if (state.title in state.fields) {
        titleExpr = (table as any)[state.title];
      }
      // Check if title is a virtual field - use the virtual directly from virtuals
      // (virtuals is already generated with aliased tables via getVirtualsWithAliases)
      else if (virtuals && state.title in virtuals) {
        titleExpr = (virtuals as any)[state.title];
      }
    }

    // Always return _title, fallback to id if no title expression defined
    select._title = titleExpr || (table as any).id;
  }

  // Timestamps
  if (state.options.timestamps !== false) {
    if (includedFields.has("createdAt")) {
      select.createdAt = (table as any).createdAt;
    }
    if (includedFields.has("updatedAt")) {
      select.updatedAt = (table as any).updatedAt;
    }
  }

  // Soft delete
  if (state.options.softDelete && includedFields.has("deletedAt")) {
    select.deletedAt = (table as any).deletedAt;
  }

  // Extras (custom SQL fields)
  if (extras) {
    const extrasObj =
      typeof extras === "function" ? extras(table, { sql }) : extras;
    Object.assign(select, extrasObj);
  }

  return select;
}

/**
 * Options for building versions SELECT object
 */
export interface BuildVersionsSelectObjectOptions {
  /** The versions table */
  versionsTable: PgTable;
  /** Aliased i18n versions table for current locale (null if no i18n) */
  i18nVersionsCurrentTable: PgTable | null;
  /** Aliased i18n versions table for fallback locale (null if no fallback needed) */
  i18nVersionsFallbackTable: PgTable | null;
  /** Collection builder state */
  state: CollectionBuilderState;
  /**
   * Function to get virtuals for versions with aliased i18n tables.
   * Takes context and aliased tables to generate virtuals with proper COALESCE.
   */
  getVirtualsForVersionsWithAliases?: (
    context: any,
    i18nVersionsCurrentTable: PgTable | null,
    i18nVersionsFallbackTable: PgTable | null,
  ) => CollectionBuilderState["virtuals"];
  /** Function to get title expression for versions based on context (deprecated) */
  getTitleForVersions?: (context: any) => TitleExpressionSQL;
}

/**
 * Build SELECT object for versions query
 * Includes: version metadata, regular fields, localized fields (with prefixed columns),
 * _localized column for nested values, timestamps
 *
 * @param context - CRUD context (locale, etc.)
 * @param options - Options for building the select
 * @returns SELECT object for versions query
 */
export function buildVersionsSelectObject(
  context: CRUDContext,
  options: BuildVersionsSelectObjectOptions,
): Record<string, any> {
  const {
    versionsTable,
    i18nVersionsCurrentTable,
    i18nVersionsFallbackTable,
    state,
    getVirtualsForVersionsWithAliases,
    getTitleForVersions,
  } = options;

  if (!versionsTable) return {};

  const versionsTbl = versionsTable as any;
  const select: Record<string, any> = {
    versionId: versionsTbl.versionId,
    id: versionsTbl.id,
    versionNumber: versionsTbl.versionNumber,
    versionOperation: versionsTbl.versionOperation,
    versionUserId: versionsTbl.versionUserId,
    versionCreatedAt: versionsTbl.versionCreatedAt,
  };

  const locale = context.locale;
  const hasFallback =
    i18nVersionsFallbackTable !== null && context.localeFallback !== false;

  for (const [name, _column] of Object.entries(state.fields)) {
    // Flat localized field
    if (state.localized.includes(name as any)) {
      if (i18nVersionsCurrentTable && locale) {
        const i18nVersionsCurrentTbl = i18nVersionsCurrentTable as any;

        // Check if column exists in ORIGINAL i18n versions table
        const columnExistsInI18n =
          i18nVersionsCurrentTbl && (i18nVersionsCurrentTbl as any)[name];

        if (columnExistsInI18n) {
          // Current locale value (prefixed)
          select[`${I18N_CURRENT_PREFIX}${name}`] =
            i18nVersionsCurrentTbl[name];

          // Fallback locale value (prefixed) - only if fallback is enabled
          if (hasFallback) {
            const i18nVersionsFallbackTbl = i18nVersionsFallbackTable as any;
            select[`${I18N_FALLBACK_PREFIX}${name}`] =
              i18nVersionsFallbackTbl[name];
          }
        }
      }
      continue;
    }

    // Regular field
    select[name] = versionsTbl[name];
  }

  // Select _localized column from i18n versions tables
  if (i18nVersionsCurrentTable && locale) {
    const i18nVersionsCurrentTbl = i18nVersionsCurrentTable as any;
    if (i18nVersionsCurrentTbl._localized) {
      select[`${I18N_CURRENT_PREFIX}_localized`] =
        i18nVersionsCurrentTbl._localized;

      if (hasFallback) {
        const i18nVersionsFallbackTbl = i18nVersionsFallbackTable as any;
        select[`${I18N_FALLBACK_PREFIX}_localized`] =
          i18nVersionsFallbackTbl._localized;
      }
    }
  }

  // Get virtuals with aliased tables
  const versionVirtuals = getVirtualsForVersionsWithAliases
    ? getVirtualsForVersionsWithAliases(
        context,
        i18nVersionsCurrentTable,
        i18nVersionsFallbackTable,
      )
    : {};
  if (versionVirtuals) {
    for (const [name, sqlExpr] of Object.entries(versionVirtuals)) {
      select[name] = sqlExpr;
    }
  }

  // _title for versions - use virtual from versionVirtuals if title is a virtual field
  let titleExpr: unknown = null;
  if (state.title) {
    // If title is a virtual, get it from versionVirtuals (already generated with aliased tables)
    if (versionVirtuals && state.title in versionVirtuals) {
      titleExpr = (versionVirtuals as any)[state.title];
    }
    // If title is a localized field, use COALESCE with aliased tables
    else if (
      state.localized.includes(state.title as any) &&
      i18nVersionsCurrentTable
    ) {
      const currentTbl = i18nVersionsCurrentTable as any;
      if (i18nVersionsFallbackTable) {
        const fallbackTbl = i18nVersionsFallbackTable as any;
        titleExpr = sql`COALESCE(${currentTbl[state.title]}, ${fallbackTbl[state.title]})`;
      } else {
        titleExpr = currentTbl[state.title];
      }
    }
    // If title is a regular field
    else if (state.title in state.fields) {
      titleExpr = versionsTbl[state.title];
    }
  }
  select._title = titleExpr || versionsTbl.id;

  // Note: versions table doesn't have timestamps or soft delete
  // Those are represented by versionCreatedAt in the versions table
  // Don't add these fields as they don't exist in versions table

  return select;
}

/**
 * Get included fields based on columns option
 * Two modes:
 * 1. Inclusion mode: If any field is set to true, only include those fields
 * 2. Omission mode: If all fields are false (or undefined), include all fields except false ones
 *
 * @param columns - Column selection option
 * @param state - Collection builder state
 * @returns Set of field names to include
 */
export function getIncludedFields(
  columns: Columns | undefined,
  state: CollectionBuilderState,
): Set<string> {
  const allFields = [
    ...Object.keys(state.fields),
    ...Object.keys(state.virtuals ?? {}),
    "_title",
    "createdAt",
    "updatedAt",
    "deletedAt",
  ];

  if (!columns) {
    // No columns specified - include all fields
    return new Set(allFields);
  }

  const included = new Set<string>();
  const hasTrueValues = Object.values(columns).some((v) => v === true);

  if (hasTrueValues) {
    // Inclusion mode: only include fields explicitly set to true
    for (const [key, value] of Object.entries(columns)) {
      if (value === true) {
        included.add(key);
      }
    }
  } else {
    // Omission mode: include all fields except those set to false
    for (const key of allFields) {
      if (columns[key] !== false) {
        included.add(key);
      }
    }
  }

  // Always include 'id'
  included.add("id");

  return included;
}
