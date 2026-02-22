/**
 * I18n Application-Side Merge Utilities
 *
 * Provides utilities for merging localized field values from multiple locale sources.
 * This replaces SQL-side COALESCE with application-side merge for better flexibility.
 *
 * Supports three types of localized fields:
 * 1. Flat localized fields - entire column is localized (title, description)
 * 2. JSONB whole-mode - entire JSONB object per locale
 * 3. JSONB nested-mode - { $i18n: value } wrappers stored in _localized column
 */

import {
	hasI18nMarkers,
	LOCALIZED_COLUMN,
	mergeNestedLocalizedFromColumn,
} from "./localization.js";

/**
 * Parse a localized field name to extract field name and mode.
 */
function parseLocalizedField(localizedField: string): {
	name: string;
	mode: "whole" | "nested";
} {
	if (localizedField.endsWith(":nested")) {
		return {
			name: localizedField.slice(0, -7),
			mode: "nested",
		};
	}
	return {
		name: localizedField,
		mode: "whole",
	};
}

/**
 * Prefix used for current locale values in SELECT
 */
export const I18N_CURRENT_PREFIX = "_i18n_";

/**
 * Prefix used for fallback locale values in SELECT
 */
export const I18N_FALLBACK_PREFIX = "_i18n_fallback_";

/**
 * Options for merging i18n row data
 */
export interface MergeI18nOptions {
	/** List of field names that are flat localized (entire column) */
	localizedFields: readonly string[];
	/** Whether fallback was used (if false, no fallback columns exist) */
	hasFallback: boolean;
}

/**
 * Merge i18n values from prefixed columns into final field values.
 *
 * Handles three types of localized fields:
 *
 * 1. Flat localized fields:
 *    - Takes `_i18n_title` (current) and `_i18n_fallback_title` (fallback)
 *    - Produces `title` (merged value: current ?? fallback ?? null)
 *
 * 2. JSONB whole-mode (entire JSONB per locale):
 *    - Takes `_i18n_description` (current) and `_i18n_fallback_description` (fallback)
 *    - Produces `description` (merged JSONB value)
 *
 * 3. JSONB nested-mode (via _localized column):
 *    - `_i18n__localized` contains current locale nested values
 *    - `_i18n_fallback__localized` contains fallback locale nested values
 *    - For fields with $i18n markers, merges with values from _localized
 *
 * @param row - Database row with prefixed i18n columns
 * @param options - Merge options specifying localized fields
 * @returns Row with merged localized field values (prefixed columns removed)
 */
export function mergeI18nRow<T extends Record<string, unknown>>(
	row: T,
	options: MergeI18nOptions,
): T {
	const result = { ...row } as Record<string, unknown>;

	// 1. Handle flat localized fields and JSONB whole-mode fields
	// Both have prefixed columns in the i18n table
	// Nested-mode JSONB fields use _localized column instead
	for (const localizedField of options.localizedFields) {
		const parsed = parseLocalizedField(localizedField);

		// Skip nested-mode fields - they're handled via _localized column
		if (parsed.mode === "nested") {
			continue;
		}

		const fieldName = parsed.name;
		const currentKey = `${I18N_CURRENT_PREFIX}${fieldName}`;
		const fallbackKey = `${I18N_FALLBACK_PREFIX}${fieldName}`;

		// Only process if this field has prefixed columns in result
		if (!(currentKey in result)) {
			continue;
		}

		// Priority: current locale > fallback locale > null
		const currentValue = result[currentKey];
		const fallbackValue = result[fallbackKey];

		result[fieldName] =
			currentValue ?? (options.hasFallback ? fallbackValue : null) ?? null;

		// Cleanup internal prefixed keys
		delete result[currentKey];
		if (options.hasFallback) {
			delete result[fallbackKey];
		}
	}

	// 2. Handle _localized column (nested localized values)
	const localizedCurrentKey = `${I18N_CURRENT_PREFIX}${LOCALIZED_COLUMN}`;
	const localizedFallbackKey = `${I18N_FALLBACK_PREFIX}${LOCALIZED_COLUMN}`;

	const localizedCurrent = result[localizedCurrentKey] as
		| Record<string, any>
		| null
		| undefined;
	const localizedFallback = options.hasFallback
		? (result[localizedFallbackKey] as Record<string, any> | null | undefined)
		: null;

	// Cleanup _localized prefixed keys
	delete result[localizedCurrentKey];
	if (options.hasFallback) {
		delete result[localizedFallbackKey];
	}

	const hasNestedMarkers = Object.values(result).some(hasI18nMarkers);

	// Merge nested localized values if markers exist or _localized data is present
	if (
		hasNestedMarkers ||
		localizedCurrent != null ||
		localizedFallback != null
	) {
		const merged = mergeNestedLocalizedFromColumn(
			result as Record<string, any>,
			localizedCurrent,
			localizedFallback,
		);
		return merged as T;
	}

	return result as T;
}

/**
 * Merge i18n values for multiple rows.
 *
 * @param rows - Array of database rows with prefixed i18n columns
 * @param options - Merge options specifying localized fields
 * @returns Rows with merged localized field values
 */
export function mergeI18nRows<T extends Record<string, unknown>>(
	rows: T[],
	options: MergeI18nOptions,
): T[] {
	return rows.map((row) => mergeI18nRow(row, options));
}

/**
 * Check if a row needs i18n merging based on presence of prefixed columns.
 *
 * @param row - Database row to check
 * @returns True if row contains i18n prefixed columns
 */
export function hasI18nPrefixedColumns(row: Record<string, unknown>): boolean {
	return Object.keys(row).some((key) => key.startsWith(I18N_CURRENT_PREFIX));
}
