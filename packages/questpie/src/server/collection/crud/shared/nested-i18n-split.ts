/**
 * Nested I18n Split Utilities
 *
 * Provides functionality to split merged data into structure and i18n values.
 * Used in beforeWrite hooks to separate localized content from structure.
 *
 * This is the reverse operation of deepMergeI18n from nested-i18n-merge.ts.
 *
 * ## Auto-detect mode
 *
 * Client wraps localized values in `{ $i18n: value }`:
 * ```typescript
 * { title: { $i18n: "Hello" }, alignment: "center" }
 * ```
 *
 * Server splits into:
 * - structure: `{ title: { $i18n: true }, alignment: "center" }`
 * - i18nValues: `{ title: "Hello" }`
 */

import { I18N_MARKER } from "./nested-i18n-merge.js";
import { isPlainObject } from "./path-utils.js";

/**
 * Check if a value is an i18n value wrapper: `{ $i18n: actualValue }`
 * This is used by clients to mark values as localized.
 */
export function isI18nValueWrapper(
	value: unknown,
): value is { $i18n: unknown } {
	return (
		isPlainObject(value) &&
		I18N_MARKER in (value as Record<string, unknown>) &&
		(value as Record<string, unknown>)[I18N_MARKER] !== true // Not a marker, has actual value
	);
}

/**
 * Auto-split nested data by detecting `{ $i18n: value }` wrappers.
 *
 * Client wraps localized values: `{ title: { $i18n: "Hello" }, alignment: "center" }`
 * Server splits into:
 * - structure: `{ title: { $i18n: true }, alignment: "center" }`
 * - i18nValues: `{ title: "Hello" }`
 *
 * @param data - Data with `{ $i18n: value }` wrappers for localized values
 * @returns Structure with markers and extracted i18n values
 */
export function autoSplitNestedI18n(data: unknown): SplitResult {
	if (data == null) {
		return { structure: null, i18nValues: null };
	}

	// Check if this is an i18n wrapper
	if (isI18nValueWrapper(data)) {
		return {
			structure: { [I18N_MARKER]: true },
			i18nValues: (data as { $i18n: unknown }).$i18n,
		};
	}

	// Handle arrays
	if (Array.isArray(data)) {
		const structureArr: unknown[] = [];
		const i18nArr: unknown[] = [];
		let hasI18n = false;

		for (const item of data) {
			const { structure, i18nValues } = autoSplitNestedI18n(item);
			structureArr.push(structure);
			i18nArr.push(i18nValues);
			if (i18nValues != null) hasI18n = true;
		}

		return {
			structure: structureArr,
			i18nValues: hasI18n ? i18nArr : null,
		};
	}

	// Handle objects
	if (isPlainObject(data)) {
		const obj = data as Record<string, unknown>;
		const structureObj: Record<string, unknown> = {};
		const i18nObj: Record<string, unknown> = {};
		let hasI18n = false;

		for (const [key, value] of Object.entries(obj)) {
			const { structure, i18nValues } = autoSplitNestedI18n(value);
			structureObj[key] = structure;
			if (i18nValues != null) {
				i18nObj[key] = i18nValues;
				hasI18n = true;
			}
		}

		return {
			structure: structureObj,
			i18nValues: hasI18n ? i18nObj : null,
		};
	}

	// Primitives - not localized
	return { structure: data, i18nValues: null };
}

/**
 * Result of splitting nested i18n data.
 */
export type SplitResult = {
	/** Structure with `{$i18n: true}` markers */
	structure: unknown;
	/** Extracted i18n values */
	i18nValues: unknown;
};

// ============================================================================
// Schema-based Split (new approach - no $i18n wrappers needed from client)
// ============================================================================

import type { NestedLocalizationSchema } from "./field-extraction.js";

/**
 * Split data according to nested localization schema.
 * Unlike autoSplitNestedI18n, this doesn't require client to send $i18n wrappers.
 * Instead, it uses the field definition schema to know which paths are localized.
 *
 * @example
 * // Schema (from extractNestedLocalizationSchema):
 * { monday: { note: true } }
 *
 * // Input data (plain, no wrappers):
 * { monday: { isOpen: true, note: "Morning only" } }
 *
 * // Output:
 * // structure: { monday: { isOpen: true, note: { $i18n: true } } }
 * // i18nValues: { monday: { note: "Morning only" } }
 *
 * @param data - Input data without $i18n wrappers
 * @param schema - Nested localization schema from field definitions
 * @returns Split result with structure and i18n values
 */
export function splitByNestedSchema(
	data: unknown,
	schema: NestedLocalizationSchema,
): SplitResult {
	// Schema is `true` - this entire value is localized
	if (schema === true) {
		return {
			structure: { [I18N_MARKER]: true },
			i18nValues: data,
		};
	}

	// Null/undefined data - nothing to split
	if (data == null) {
		return { structure: data, i18nValues: null };
	}

	// Schema has _item - array schema
	if ("_item" in schema && schema._item !== undefined) {
		if (!Array.isArray(data)) {
			// Data is not an array but schema expects array - just return as-is
			return { structure: data, i18nValues: null };
		}

		const itemSchema = schema._item;
		const structureArr: unknown[] = [];
		const i18nArr: unknown[] = [];
		let hasI18n = false;

		for (const item of data) {
			const { structure, i18nValues } = splitByNestedSchema(item, itemSchema);
			structureArr.push(structure);
			i18nArr.push(i18nValues);
			if (i18nValues != null) hasI18n = true;
		}

		return {
			structure: structureArr,
			i18nValues: hasI18n ? i18nArr : null,
		};
	}

	// Schema is object - nested field schema
	if (!isPlainObject(data)) {
		// Data is not an object but schema expects object - return as-is
		return { structure: data, i18nValues: null };
	}

	const obj = data as Record<string, unknown>;
	const objSchema = schema as Record<string, NestedLocalizationSchema>;
	const structureObj: Record<string, unknown> = {};
	const i18nObj: Record<string, unknown> = {};
	let hasI18n = false;

	for (const [key, value] of Object.entries(obj)) {
		const fieldSchema = objSchema[key];

		if (fieldSchema === undefined) {
			// Field not in schema - not localized, keep in structure
			structureObj[key] = value;
		} else {
			// Field has localization schema - split it
			const { structure, i18nValues } = splitByNestedSchema(value, fieldSchema);
			structureObj[key] = structure;
			if (i18nValues != null) {
				i18nObj[key] = i18nValues;
				hasI18n = true;
			}
		}
	}

	return {
		structure: structureObj,
		i18nValues: hasI18n ? i18nObj : null,
	};
}

/**
 * Split multiple fields using their respective schemas.
 * Combines splitByNestedSchema with autoSplitNestedI18n for backward compatibility.
 *
 * Priority:
 * 1. If field has schema, use schema-based split (new approach)
 * 2. Otherwise, try auto-detect $i18n wrappers (backward compatibility)
 *
 * @param data - Input data object
 * @param schemas - Map of field name → nested localization schema
 * @returns Object with field names → split results
 */
export function splitFieldsByNestedSchemas(
	data: Record<string, unknown>,
	schemas: Record<string, NestedLocalizationSchema>,
): Record<string, SplitResult> {
	const results: Record<string, SplitResult> = {};

	for (const [fieldName, value] of Object.entries(data)) {
		const schema = schemas[fieldName];

		if (schema !== undefined) {
			// Has schema - use schema-based split
			results[fieldName] = splitByNestedSchema(value, schema);
		} else if (value != null && typeof value === "object") {
			// No schema but is object - try auto-detect $i18n wrappers (backward compat)
			results[fieldName] = autoSplitNestedI18n(value);
		}
		// Primitives without schema - not localized, skip
	}

	return results;
}
