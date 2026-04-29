/**
 * Field Resolution Utilities
 *
 * Pure functions for resolving field keys from column definitions.
 */

import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

import type { CollectionBuilderState } from "#questpie/server/collection/builder/types.js";

/**
 * Internal record type for dynamic column access on PgTable.
 *
 * Drizzle's PgTable type does not expose an index signature, so accessing
 * columns by dynamic string key requires a cast. This type centralizes
 * that cast in one place so individual call-sites stay clean.
 */
type TableRecord = Record<string, AnyPgColumn | undefined>;

/**
 * Access a column on a PgTable by dynamic string key.
 *
 * Returns the column or `undefined` if the key does not exist.
 * This is the **single place** where the PgTable → Record cast happens,
 * replacing scattered `(table as any)[field]` casts throughout the CRUD
 * pipeline.
 */
export function getColumn(
	table: PgTable,
	name: string,
): AnyPgColumn | undefined {
	return (table as unknown as TableRecord)[name];
}

/**
 * Resolve field key from column definition
 *
 * Supports both string field names and column objects with a `.name` property.
 * Looks up the field key in state.fields first, then falls back to table columns.
 *
 * @param state - Collection builder state
 * @param column - Column definition (string or object with .name)
 * @param table - Optional table to search for column name
 * @returns The field key or undefined if not found
 */
export function resolveFieldKey(
	state: CollectionBuilderState,
	column: any,
	table?: PgTable,
): string | undefined {
	if (typeof column === "string") return column;

	// Get column name - supports both built columns (.name) and builders (.config.name)
	const columnName = column?.name ?? column?.config?.name;
	if (!columnName) return undefined;

	// Search in state fields
	for (const [key, value] of Object.entries(state.fields)) {
		const fieldName = (value as any)?.name ?? (value as any)?.config?.name;
		if (fieldName === columnName) return key;
	}

	// Search in table columns
	if (table) {
		for (const [key, value] of Object.entries(table)) {
			const fieldName = (value as any)?.name ?? (value as any)?.config?.name;
			if (fieldName === columnName) return key;
		}
	}

	return undefined;
}
