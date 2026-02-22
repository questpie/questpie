/**
 * Nested I18n Merge Utilities
 *
 * Provides deep merge functionality for localized JSONB fields.
 * Uses `{$i18n: true}` markers to identify localized values within nested structures.
 *
 * ## Patterns Supported:
 * - Primitive localized: `{ title: { $i18n: true } }`
 * - Array of primitives (whole array): `{ tags: { $i18n: true } }`
 * - Nested objects with mixed fields
 * - ID-based maps (array of objects): `{ _order: ["f1"], f1: {...} }`
 */

import { isPlainObject } from "./path-utils.js";

/**
 * Marker used to identify localized values in structure.
 */
export const I18N_MARKER = "$i18n";

/**
 * Key used to store order in ID-based maps.
 */
export const ORDER_KEY = "_order";

/**
 * Key used to store tree structure in blocks.
 */
export const TREE_KEY = "_tree";

/**
 * Key used to store block values.
 */
export const VALUES_KEY = "_values";

/**
 * Check if a value is an i18n marker.
 *
 * @param value - Value to check
 * @returns True if value is `{ $i18n: true }`
 */
export function isI18nMarker(value: unknown): boolean {
	return (
		isPlainObject(value) &&
		(value as Record<string, unknown>)[I18N_MARKER] === true
	);
}

/**
 * Check if a value is an ID-based map (array of objects pattern).
 * ID-based maps have an `_order` array that defines item ordering.
 *
 * @param value - Value to check
 * @returns True if value has `_order` array
 */
export function isIdBasedMap(value: unknown): boolean {
	return (
		isPlainObject(value) &&
		Array.isArray((value as Record<string, unknown>)[ORDER_KEY])
	);
}

/**
 * Check if a value is a blocks structure.
 * Blocks have `_tree` for hierarchy and `_values` for data.
 *
 * @param value - Value to check
 * @returns True if value has `_tree` and `_values`
 */
export function isBlocksStructure(value: unknown): boolean {
	return (
		isPlainObject(value) &&
		Array.isArray((value as Record<string, unknown>)[TREE_KEY]) &&
		isPlainObject((value as Record<string, unknown>)[VALUES_KEY])
	);
}

/**
 * Deep merge structure with i18n values from a locale chain.
 *
 * The structure contains `{$i18n: true}` markers where localized values should be.
 * The i18nChain is an array of locale-specific data, ordered by priority (current locale first).
 *
 * @param structure - Structure with `{$i18n: true}` markers
 * @param i18nChain - Array of locale data, ordered by priority (e.g., [skData, enData])
 * @returns Merged structure with markers replaced by actual values
 *
 * @example
 * // Structure
 * { title: { $i18n: true }, alignment: "center" }
 *
 * // i18nChain (SK first, EN fallback)
 * [{ title: "Ahoj" }, { title: "Hello" }]
 *
 * // Result
 * { title: "Ahoj", alignment: "center" }
 */
export function deepMergeI18n(
	structure: unknown,
	i18nChain: Array<unknown | null | undefined>,
): unknown {
	// 1. Marker - find first non-null value in chain
	if (isI18nMarker(structure)) {
		for (const layer of i18nChain) {
			if (layer != null) {
				return layer;
			}
		}
		return null;
	}

	// 2. Blocks structure (_tree + _values)
	if (isBlocksStructure(structure)) {
		const blocksStruct = structure as Record<string, unknown>;
		const result: Record<string, unknown> = {
			[TREE_KEY]: blocksStruct[TREE_KEY], // Tree is not localized
		};

		// Merge _values recursively
		const valuesStruct = blocksStruct[VALUES_KEY] as Record<string, unknown>;
		const mergedValues: Record<string, unknown> = {};

		for (const blockId of Object.keys(valuesStruct)) {
			mergedValues[blockId] = deepMergeI18n(
				valuesStruct[blockId],
				i18nChain.map((layer) => {
					const layerValues = (layer as Record<string, unknown>)?.[VALUES_KEY];
					return (layerValues as Record<string, unknown>)?.[blockId];
				}),
			);
		}

		result[VALUES_KEY] = mergedValues;
		return result;
	}

	// 3. ID-based map (array of objects pattern)
	if (isIdBasedMap(structure)) {
		const map = structure as Record<string, unknown>;
		const result: Record<string, unknown> = {
			[ORDER_KEY]: map[ORDER_KEY], // Preserve order
		};

		for (const key of Object.keys(map)) {
			if (key === ORDER_KEY) continue;

			result[key] = deepMergeI18n(
				map[key],
				i18nChain.map((layer) => (layer as Record<string, unknown>)?.[key]),
			);
		}

		return result;
	}

	// 4. Plain array - recursively process elements
	if (Array.isArray(structure)) {
		return structure.map((item, index) =>
			deepMergeI18n(
				item,
				i18nChain.map((layer) => (layer as unknown[])?.[index]),
			),
		);
	}

	// 5. Plain object - recursively process properties
	if (isPlainObject(structure)) {
		const result: Record<string, unknown> = {};

		for (const key of Object.keys(structure)) {
			result[key] = deepMergeI18n(
				(structure as Record<string, unknown>)[key],
				i18nChain.map((layer) => (layer as Record<string, unknown>)?.[key]),
			);
		}

		return result;
	}

	// 6. Static value (primitive)
	return structure;
}

/**
 * Convert an ID-based map to an array, using `_order` for ordering.
 *
 * @param map - ID-based map with `_order` array
 * @returns Array of items in order
 *
 * @example
 * mapToArray({
 *   _order: ["f1", "f2"],
 *   f1: { title: "First" },
 *   f2: { title: "Second" }
 * })
 * // Returns: [{ title: "First" }, { title: "Second" }]
 */
export function mapToArray<T>(
	map: { _order: string[] } & Record<string, T>,
): T[] {
	return map._order.map((id) => map[id]);
}

/**
 * Convert an array to an ID-based map.
 * Items must have an `id` property or one will be generated.
 *
 * @param array - Array of items
 * @param idKey - Property to use as ID (default: "id")
 * @returns ID-based map with `_order` array
 */
export function arrayToMap<T extends Record<string, unknown>>(
	array: T[],
	idKey: string = "id",
): { _order: string[] } & Record<string, T> {
	const result: Record<string, unknown> = {
		_order: [] as string[],
	};

	for (const item of array) {
		const id = String(item[idKey] ?? crypto.randomUUID());
		(result._order as string[]).push(id);
		result[id] = item;
	}

	return result as { _order: string[] } & Record<string, T>;
}
