/**
 * Shared Localization Utilities
 *
 * Provides field splitting utilities for localized content.
 * Uses field definition schemas to determine which fields are localized.
 *
 * Supports three types of localization:
 * 1. Flat localized fields - entire column is localized (e.g., title, description)
 * 2. JSONB whole-mode - entire JSONB object per locale
 * 3. JSONB nested-mode - nested fields with `localized: true` in field definitions
 */

import type { NestedLocalizationSchema } from "./field-extraction.js";
import { deepMergeI18n } from "./nested-i18n-merge.js";
import { splitByNestedSchema } from "./nested-i18n-split.js";
import { isPlainObject } from "./path-utils.js";

/**
 * Constant for the _localized column name in i18n table
 */
export const LOCALIZED_COLUMN = "_localized";

/**
 * Split legacy `{ $i18n: value }` wrappers into structure + localized values.
 *
 * Backward compatibility path for fields without explicit nested localization schema.
 */
function splitLegacyI18nWrappers(value: unknown): {
	structure: unknown;
	i18nValues: unknown | null;
} {
	if (value == null) {
		return { structure: value, i18nValues: null };
	}

	if (isPlainObject(value)) {
		const obj = value as Record<string, unknown>;
		const entries = Object.entries(obj);

		if (entries.length === 1 && entries[0]?.[0] === "$i18n") {
			return {
				structure: { $i18n: true },
				i18nValues: entries[0][1],
			};
		}

		const structureObj: Record<string, unknown> = {};
		const i18nObj: Record<string, unknown> = {};
		let hasI18n = false;

		for (const [key, child] of entries) {
			const split = splitLegacyI18nWrappers(child);
			structureObj[key] = split.structure;
			if (split.i18nValues != null) {
				i18nObj[key] = split.i18nValues;
				hasI18n = true;
			}
		}

		return {
			structure: structureObj,
			i18nValues: hasI18n ? i18nObj : null,
		};
	}

	if (Array.isArray(value)) {
		const structureArr: unknown[] = [];
		const i18nArr: Array<unknown | null> = [];
		let hasI18n = false;

		for (const item of value) {
			const split = splitLegacyI18nWrappers(item);
			structureArr.push(split.structure);
			i18nArr.push(split.i18nValues);
			if (split.i18nValues != null) {
				hasI18n = true;
			}
		}

		return {
			structure: structureArr,
			i18nValues: hasI18n ? i18nArr : null,
		};
	}

	return { structure: value, i18nValues: null };
}

/**
 * Split input data into localized and non-localized fields using field definition schemas.
 * Uses nested localization schemas from field definitions to know which paths are localized.
 *
 * @param input - Input data object (plain values)
 * @param localizedFields - Array of field names marked as localized at top level
 * @param nestedSchemas - Map of field name → nested localization schema
 * @returns Object with localized fields, nonLocalized fields, and nested localized values
 *
 * @example
 * // Field definitions have:
 * // - title: localized: true (top-level)
 * // - workingHours.monday.note: localized: true (nested)
 *
 * // Client sends plain data:
 * { title: "Hello", workingHours: { monday: { isOpen: true, note: "Morning only" } } }
 *
 * // Function splits into:
 * // localized: { title: "Hello" }
 * // nonLocalized: { workingHours: { monday: { isOpen: true, note: { $i18n: true } } } }
 * // nestedLocalized: { workingHours: { monday: { note: "Morning only" } } }
 */
export function splitLocalizedFields(
	input: Record<string, any>,
	localizedFields: readonly string[],
	nestedSchemas: Record<string, NestedLocalizationSchema> = {},
): {
	localized: Record<string, any>;
	nonLocalized: Record<string, any>;
	nestedLocalized: Record<string, any> | null;
} {
	const localized: Record<string, any> = {};
	const nonLocalized: Record<string, any> = {};
	const nestedLocalized: Record<string, any> = {};
	let hasNestedLocalized = false;

	// Create set for fast lookup of top-level localized fields
	const localizedSet = new Set(localizedFields);

	for (const [key, value] of Object.entries(input)) {
		const isTopLevelLocalized = localizedSet.has(key);
		const nestedSchema = nestedSchemas[key];

		// Case 1: Field has nested localization schema (object/array/blocks with localized nested fields)
		if (nestedSchema !== undefined && value != null) {
			const { structure, i18nValues } = splitByNestedSchema(
				value,
				nestedSchema,
			);
			nonLocalized[key] = structure;
			if (i18nValues != null) {
				nestedLocalized[key] = i18nValues;
				hasNestedLocalized = true;
			}
			continue;
		}

		// Case 2: Top-level localized field (flat or JSONB whole-mode)
		if (isTopLevelLocalized) {
			localized[key] = value;
			continue;
		}

		// Case 3: Non-localized field - goes to main table
		const split = splitLegacyI18nWrappers(value);
		nonLocalized[key] = split.structure;
		if (split.i18nValues != null) {
			nestedLocalized[key] = split.i18nValues;
			hasNestedLocalized = true;
		}
	}

	return {
		localized,
		nonLocalized,
		nestedLocalized: hasNestedLocalized ? nestedLocalized : null,
	};
}

/**
 * Merge nested localized values from _localized column into row data.
 * For each field with $i18n markers, replaces markers with actual values.
 *
 * @param row - Row data with structure from main table
 * @param localizedCurrent - Current locale _localized data
 * @param localizedFallback - Fallback locale _localized data
 * @returns Row with nested localized values merged
 */
export function mergeNestedLocalizedFromColumn(
	row: Record<string, any>,
	localizedCurrent: Record<string, any> | null | undefined,
	localizedFallback: Record<string, any> | null | undefined,
): Record<string, any> {
	const result = { ...row };

	// Check each field for $i18n markers
	for (const [fieldName, value] of Object.entries(row)) {
		// Skip if not an object or doesn't have i18n markers
		if (!hasI18nMarkers(value)) continue;

		// Build i18n chain for this field from _localized column
		const fieldI18nChain = [
			localizedCurrent?.[fieldName],
			localizedFallback?.[fieldName],
		];

		// Merge using deepMergeI18n
		result[fieldName] = deepMergeI18n(value, fieldI18nChain);
	}

	return result;
}

/**
 * Check if a value contains $i18n markers (indicating nested localization).
 * Recursively checks nested objects.
 *
 * @param value - Value to check
 * @returns True if value contains any $i18n markers
 */
export function hasI18nMarkers(value: unknown): boolean {
	if (value == null || typeof value !== "object") {
		return false;
	}

	// Check if this is an $i18n marker
	if (
		typeof value === "object" &&
		(value as Record<string, unknown>).$i18n === true
	) {
		return true;
	}

	// Check array elements
	if (Array.isArray(value)) {
		return value.some(hasI18nMarkers);
	}

	// Check object properties
	for (const prop of Object.values(value)) {
		if (hasI18nMarkers(prop)) {
			return true;
		}
	}

	return false;
}

/**
 * Auto-detect and merge nested localized JSONB fields.
 * Scans the row for fields containing $i18n markers and applies merge.
 *
 * @param row - Row data from main table
 * @param i18nCurrent - Current locale i18n data (or null)
 * @param i18nFallback - Fallback locale i18n data (or null)
 * @returns Row with nested localized fields merged
 */
export function autoMergeNestedLocalizedFields(
	row: Record<string, any>,
	i18nCurrent: Record<string, any> | null | undefined,
	i18nFallback: Record<string, any> | null | undefined,
): Record<string, any> {
	const result = { ...row };

	for (const [fieldName, value] of Object.entries(row)) {
		// Skip if not an object or doesn't have i18n markers
		if (!hasI18nMarkers(value)) continue;

		// Build i18n chain for this field
		const fieldI18nChain = [
			i18nCurrent?.[fieldName],
			i18nFallback?.[fieldName],
		];

		// Merge using deepMergeI18n
		result[fieldName] = deepMergeI18n(value, fieldI18nChain);
	}

	return result;
}
