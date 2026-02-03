/**
 * Wrap Localized Values Utility
 *
 * Transforms nested field values by wrapping localized values with $i18n marker.
 * Used before sending data to server for proper i18n storage.
 *
 * Only processes nested fields (object, array, blocks) - flat localized fields
 * are handled separately by the server based on collection schema.
 */

import type { BlockContent } from "#questpie/admin/client/blocks/types";
import type { BlockDefinition } from "#questpie/admin/client/builder/block/types";
import {
	builtInFields,
	createRegistryProxy,
} from "#questpie/admin/client/builder/defaults/fields";
import type { FieldDefinition } from "#questpie/admin/client/builder/field/field";

/**
 * I18n marker value wrapper
 */
interface I18nWrapper<T = unknown> {
	$i18n: T;
}

/**
 * Check if a value is already wrapped with $i18n
 */
function isI18nWrapped(value: unknown): value is I18nWrapper {
	return (
		value !== null &&
		typeof value === "object" &&
		"$i18n" in value &&
		Object.keys(value).length === 1
	);
}

/**
 * Wrap a value with $i18n marker
 */
function wrapI18n<T>(value: T): I18nWrapper<T> {
	return { $i18n: value };
}

/**
 * Get nested field definitions from a field's options
 */
function getNestedFields(
	fieldDef: FieldDefinition | undefined,
): Record<string, FieldDefinition> | undefined {
	if (!fieldDef) return undefined;

	const options = (fieldDef as any)["~options"];
	if (!options) return undefined;

	// Object field - has `fields` callback
	if (options.fields) {
		if (typeof options.fields === "function") {
			try {
				return options.fields({ r: createRegistryProxy(builtInFields) });
			} catch {
				return undefined;
			}
		}
		if (typeof options.fields === "object") {
			return options.fields as Record<string, FieldDefinition>;
		}
	}

	// Array field with object items - has `item` callback
	if (options.item) {
		if (typeof options.item === "function") {
			try {
				return options.item({ r: createRegistryProxy(builtInFields) });
			} catch {
				return undefined;
			}
		}
		if (typeof options.item === "object") {
			return options.item as Record<string, FieldDefinition>;
		}
	}

	return undefined;
}

/**
 * Check if a field is localized
 */
function isFieldLocalized(fieldDef: FieldDefinition | undefined): boolean {
	if (!fieldDef) return false;
	const options = (fieldDef as any)["~options"];
	return options?.localized === true;
}

/**
 * Check if a field is computed (has compute function = UI-only, not submitted to backend)
 */
function isFieldComputed(fieldDef: FieldDefinition | undefined): boolean {
	if (!fieldDef) return false;
	const options = (fieldDef as any)["~options"];
	return typeof options?.compute === "function";
}

/**
 * Check if nested fields contain any localized fields
 */
function hasLocalizedFields(
	nestedFields: Record<string, FieldDefinition> | undefined,
): boolean {
	if (!nestedFields) return false;
	return Object.values(nestedFields).some((fieldDef) => {
		if (isFieldLocalized(fieldDef)) return true;
		// Check deeper nested fields
		const deepNested = getNestedFields(fieldDef);
		if (deepNested) return hasLocalizedFields(deepNested);
		return false;
	});
}

/**
 * Check if a field is a blocks field
 */
function isBlocksField(fieldDef: FieldDefinition | undefined): boolean {
	if (!fieldDef) return false;
	return (fieldDef as any).name === "blocks";
}

/**
 * Check if a field is an object field
 */
function isObjectField(fieldDef: FieldDefinition | undefined): boolean {
	if (!fieldDef) return false;
	return (fieldDef as any).name === "object";
}

/**
 * Check if a field is an array field
 */
function isArrayField(fieldDef: FieldDefinition | undefined): boolean {
	if (!fieldDef) return false;
	return (fieldDef as any).name === "array";
}

/**
 * Process object value - wrap localized nested fields
 */
function processObjectValue(
	value: Record<string, unknown>,
	nestedFields: Record<string, FieldDefinition>,
	blocks?: Record<string, BlockDefinition>,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};

	for (const [key, fieldValue] of Object.entries(value)) {
		const nestedFieldDef = nestedFields[key];

		if (fieldValue === undefined || fieldValue === null) {
			result[key] = fieldValue;
			continue;
		}

		// Already wrapped - keep as is
		if (isI18nWrapped(fieldValue)) {
			result[key] = fieldValue;
			continue;
		}

		// Check if this nested field is localized
		if (isFieldLocalized(nestedFieldDef)) {
			result[key] = wrapI18n(fieldValue);
			continue;
		}

		// Recursively process nested object fields
		if (isObjectField(nestedFieldDef)) {
			const deepNestedFields = getNestedFields(nestedFieldDef);
			if (
				deepNestedFields &&
				hasLocalizedFields(deepNestedFields) &&
				typeof fieldValue === "object" &&
				!Array.isArray(fieldValue)
			) {
				result[key] = processObjectValue(
					fieldValue as Record<string, unknown>,
					deepNestedFields,
					blocks,
				);
				continue;
			}
		}

		// Recursively process nested array fields (only if item has localized fields)
		if (isArrayField(nestedFieldDef)) {
			const itemFields = getNestedFields(nestedFieldDef);
			if (
				itemFields &&
				hasLocalizedFields(itemFields) &&
				Array.isArray(fieldValue)
			) {
				result[key] = fieldValue.map((item) => {
					if (
						typeof item === "object" &&
						item !== null &&
						!Array.isArray(item)
					) {
						return processObjectValue(
							item as Record<string, unknown>,
							itemFields,
							blocks,
						);
					}
					return item;
				});
				continue;
			}
		}

		// Recursively process nested blocks fields
		if (isBlocksField(nestedFieldDef) && blocks) {
			result[key] = processBlocksValue(fieldValue as BlockContent, blocks);
			continue;
		}

		// Not localized - keep as is
		result[key] = fieldValue;
	}

	return result;
}

/**
 * Process blocks content - wrap localized block field values
 */
function processBlocksValue(
	content: BlockContent,
	blocks: Record<string, BlockDefinition>,
): BlockContent {
	if (!content || !content._values) {
		return content;
	}

	const processedValues: Record<string, Record<string, unknown>> = {};

	for (const [blockId, blockValues] of Object.entries(content._values)) {
		// Find block type from tree
		const blockNode = findBlockInTree(content._tree, blockId);
		if (!blockNode) {
			processedValues[blockId] = blockValues;
			continue;
		}

		const blockDef = blocks[blockNode.type];
		if (!blockDef) {
			processedValues[blockId] = blockValues;
			continue;
		}

		// Get block field definitions
		const blockFields = (blockDef as any).fields as
			| Record<string, FieldDefinition>
			| undefined;
		if (!blockFields || !hasLocalizedFields(blockFields)) {
			processedValues[blockId] = blockValues;
			continue;
		}

		// Process block values
		processedValues[blockId] = processObjectValue(
			blockValues,
			blockFields,
			blocks,
		);
	}

	return {
		...content,
		_values: processedValues,
	};
}

/**
 * Find a block node in the tree by ID
 */
function findBlockInTree(
	tree: BlockContent["_tree"],
	blockId: string,
): BlockContent["_tree"][number] | undefined {
	for (const node of tree) {
		if (node.id === blockId) {
			return node;
		}
		if (node.children?.length) {
			const found = findBlockInTree(node.children, blockId);
			if (found) return found;
		}
	}
	return undefined;
}

/**
 * Options for wrapLocalizedNestedValues
 */
export interface WrapLocalizedOptions {
	/**
	 * Field definitions from collection/global config
	 */
	fields: Record<string, FieldDefinition>;

	/**
	 * Block definitions (required if using blocks fields)
	 */
	blocks?: Record<string, BlockDefinition>;
}

/**
 * Wrap localized values in nested fields with $i18n marker.
 *
 * Processes:
 * - Object fields with nested localized fields
 * - Array fields with nested localized item fields
 * - Blocks fields with localized block fields
 *
 * Only processes fields that actually have localized nested fields.
 *
 * @param data - Form data to process
 * @param options - Field and block definitions
 * @returns Transformed data with $i18n wrappers
 *
 * @example
 * ```ts
 * const transformedData = wrapLocalizedNestedValues(formData, {
 *   fields: config.fields,
 *   blocks: admin.state.blocks,
 * });
 * ```
 */
export function wrapLocalizedNestedValues(
	data: Record<string, unknown>,
	options: WrapLocalizedOptions,
): Record<string, unknown> {
	const { fields, blocks } = options;
	const result: Record<string, unknown> = {};

	for (const [fieldName, fieldValue] of Object.entries(data)) {
		const fieldDef = fields[fieldName];

		// Skip computed fields - they are UI-only and should not be submitted
		if (isFieldComputed(fieldDef)) {
			continue;
		}

		if (fieldValue === undefined || fieldValue === null) {
			result[fieldName] = fieldValue;
			continue;
		}

		// Process object fields (only if has localized nested fields)
		if (isObjectField(fieldDef)) {
			const nestedFields = getNestedFields(fieldDef);
			if (
				nestedFields &&
				hasLocalizedFields(nestedFields) &&
				typeof fieldValue === "object" &&
				!Array.isArray(fieldValue)
			) {
				result[fieldName] = processObjectValue(
					fieldValue as Record<string, unknown>,
					nestedFields,
					blocks,
				);
				continue;
			}
		}

		// Process array fields (only if item has localized fields)
		if (isArrayField(fieldDef)) {
			const itemFields = getNestedFields(fieldDef);
			if (
				itemFields &&
				hasLocalizedFields(itemFields) &&
				Array.isArray(fieldValue)
			) {
				result[fieldName] = fieldValue.map((item) => {
					if (
						typeof item === "object" &&
						item !== null &&
						!Array.isArray(item)
					) {
						return processObjectValue(
							item as Record<string, unknown>,
							itemFields,
							blocks,
						);
					}
					return item;
				});
				continue;
			}
		}

		// Process blocks fields
		if (isBlocksField(fieldDef) && blocks) {
			result[fieldName] = processBlocksValue(
				fieldValue as BlockContent,
				blocks,
			);
			continue;
		}

		// Not a nested field type or no localized fields - keep as is
		result[fieldName] = fieldValue;
	}

	return result;
}
