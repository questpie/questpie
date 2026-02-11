/**
 * Nested I18n Split Utilities
 *
 * Provides functionality to split data into structure and i18n values
 * based on field definition schemas.
 *
 * This is the reverse operation of deepMergeI18n from nested-i18n-merge.ts.
 *
 * ## Schema-based approach
 *
 * Server uses field definition schemas to know which paths are localized.
 * Client sends plain data without any wrappers:
 * ```typescript
 * { title: "Hello", alignment: "center" }
 * ```
 *
 * Server splits into (based on schema):
 * - structure: `{ title: { $i18n: true }, alignment: "center" }`
 * - i18nValues: `{ title: "Hello" }`
 */

import {
	I18N_MARKER,
	isBlocksStructure,
	TREE_KEY,
	VALUES_KEY,
} from "./nested-i18n-merge.js";
import { isPlainObject } from "./path-utils.js";

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
// Schema-based Split
// ============================================================================

import type {
	NestedBlocksSchema,
	NestedLocalizationSchema,
} from "./field-extraction.js";

/**
 * Find a block node in the tree by ID.
 * Searches recursively through children.
 */
function findBlockTypeInTree(
	tree: Array<{ id: string; type: string; children?: unknown[] }>,
	blockId: string,
): string | null {
	for (const node of tree) {
		if (node.id === blockId) {
			return node.type;
		}
		if (Array.isArray(node.children) && node.children.length > 0) {
			const found = findBlockTypeInTree(
				node.children as Array<{
					id: string;
					type: string;
					children?: unknown[];
				}>,
				blockId,
			);
			if (found) return found;
		}
	}
	return null;
}

/**
 * Split data according to nested localization schema.
 * Uses the field definition schema to know which paths are localized.
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
 * @param data - Input data (plain values)
 * @param schema - Nested localization schema from field definitions
 * @returns Split result with structure and i18n values
 */
export function splitByNestedSchema(
	data: unknown,
	schema: NestedLocalizationSchema,
): SplitResult {
	// Schema is `true` - this entire value is localized
	if (schema === true) {
		// Backward compatibility: unwrap legacy wrapper input
		// `{ $i18n: value }` -> `value`
		if (isPlainObject(data)) {
			const entries = Object.entries(data as Record<string, unknown>);
			if (entries.length === 1 && entries[0]?.[0] === I18N_MARKER) {
				return {
					structure: { [I18N_MARKER]: true },
					i18nValues: entries[0][1],
				};
			}
		}

		return {
			structure: { [I18N_MARKER]: true },
			i18nValues: data,
		};
	}

	// Null/undefined data - nothing to split
	if (data == null) {
		return { structure: data, i18nValues: null };
	}

	// Schema has _blocks - blocks field schema
	if ("_blocks" in schema && schema._blocks !== undefined) {
		return splitBlocksData(data, schema as NestedBlocksSchema);
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
 * Split blocks data according to blocks schema.
 *
 * Blocks have special structure:
 * - _tree: Array of block nodes with id, type, children (NOT localized)
 * - _values: Record mapping block id to field values
 *
 * @example
 * // Schema: { _blocks: { hero: { title: true } } }
 * // Input: { _tree: [{id: "a", type: "hero", children: []}], _values: { a: { title: "Hi" } } }
 * // Output:
 * // structure: { _tree: [...], _values: { a: { title: { $i18n: true } } } }
 * // i18nValues: { _values: { a: { title: "Hi" } } }
 */
function splitBlocksData(
	data: unknown,
	schema: NestedBlocksSchema,
): SplitResult {
	if (!isBlocksStructure(data)) {
		// Data is not a valid blocks structure - return as-is
		return { structure: data, i18nValues: null };
	}

	const blocksData = data as {
		_tree: Array<{ id: string; type: string; children?: unknown[] }>;
		_values: Record<string, Record<string, unknown>>;
	};

	const blockSchemas = schema._blocks;
	const structureValues: Record<string, unknown> = {};
	const i18nValuesMap: Record<string, unknown> = {};
	let hasI18n = false;

	for (const [blockId, blockValues] of Object.entries(blocksData._values)) {
		// Find block type from tree
		const blockType = findBlockTypeInTree(blocksData._tree, blockId);
		if (!blockType) {
			// Block not found in tree - keep values as-is
			structureValues[blockId] = blockValues;
			continue;
		}

		const blockSchema = blockSchemas[blockType];
		if (!blockSchema) {
			// No schema for this block type - not localized, keep as-is
			structureValues[blockId] = blockValues;
			continue;
		}

		// Split block values according to schema
		const { structure, i18nValues } = splitByNestedSchema(
			blockValues,
			blockSchema,
		);
		structureValues[blockId] = structure;
		if (i18nValues != null) {
			i18nValuesMap[blockId] = i18nValues;
			hasI18n = true;
		}
	}

	return {
		structure: {
			[TREE_KEY]: blocksData._tree,
			[VALUES_KEY]: structureValues,
		},
		i18nValues: hasI18n ? { [VALUES_KEY]: i18nValuesMap } : null,
	};
}
