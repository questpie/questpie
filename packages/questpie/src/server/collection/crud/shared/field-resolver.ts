/**
 * Field Resolution Utilities
 *
 * Pure functions for resolving field keys from column definitions.
 */

import type { PgTable } from "drizzle-orm/pg-core";
import type { CollectionBuilderState } from "#questpie/server/collection/builder/types.js";

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
