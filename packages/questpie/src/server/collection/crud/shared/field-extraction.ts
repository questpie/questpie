/**
 * Field Extraction Utilities
 *
 * Runtime helpers to extract field information from Field state.
 */

import type {
	FieldRuntimeState,
	FieldState,
} from "#questpie/server/fields/field-class-types.js";
import type { Field } from "#questpie/server/fields/field-class.js";

/**
 * Extract field names by location from field definitions.
 * Runtime version of ExtractFieldsByLocation type.
 */
export function extractFieldNamesByLocation(
	fieldDefinitions: Record<string, Field<FieldState>>,
	location: "main" | "i18n" | "virtual" | "relation",
): string[] {
	const names: string[] = [];
	for (const [name, fieldDef] of Object.entries(fieldDefinitions)) {
		if (fieldDef.getLocation() === location) {
			names.push(name);
		}
	}
	return names;
}

/**
 * Extract localized field names (for i18n operations).
 * Replaces the old state.localized array.
 */
export function extractLocalizedFieldNames(
	fieldDefinitions: Record<string, Field<FieldState>>,
): string[] {
	return extractFieldNamesByLocation(fieldDefinitions, "i18n");
}

/**
 * Extract main field names.
 */
export function extractMainFieldNames(
	fieldDefinitions: Record<string, Field<FieldState>>,
): string[] {
	return extractFieldNamesByLocation(fieldDefinitions, "main");
}

/**
 * Extract virtual field names.
 */
export function extractVirtualFieldNames(
	fieldDefinitions: Record<string, Field<FieldState>>,
): string[] {
	return extractFieldNamesByLocation(fieldDefinitions, "virtual");
}

/**
 * Check if collection has any localized fields.
 */
export function hasLocalizedFields(
	fieldDefinitions: Record<string, Field<FieldState>> | undefined,
): boolean {
	if (!fieldDefinitions) return false;
	return extractLocalizedFieldNames(fieldDefinitions).length > 0;
}

/**
 * Check if collection has any virtual fields.
 */
export function hasVirtualFields(
	fieldDefinitions: Record<string, Field<FieldState>> | undefined,
): boolean {
	if (!fieldDefinitions) return false;
	return extractVirtualFieldNames(fieldDefinitions).length > 0;
}

/**
 * Split fields into main and localized for data operations.
 * Returns { main: Record, localized: Record }
 */
export function splitFieldsByLocation<T extends Record<string, any>>(
	data: T,
	fieldDefinitions: Record<string, Field<FieldState>>,
): { main: Partial<T>; localized: Partial<T> } {
	const main: Partial<T> = {};
	const localized: Partial<T> = {};

	const localizedNames = new Set(extractLocalizedFieldNames(fieldDefinitions));

	for (const [key, value] of Object.entries(data)) {
		if (localizedNames.has(key)) {
			(localized as Record<string, unknown>)[key] = value;
		} else {
			(main as Record<string, unknown>)[key] = value;
		}
	}

	return { main, localized };
}

/**
 * Merge localized fields back into main data.
 * Inverse of splitFieldsByLocation.
 */
export function mergeFieldsByLocation<T extends Record<string, any>>(
	main: Partial<T>,
	localized: Partial<T>,
): Partial<T> {
	return { ...main, ...localized };
}

// ============================================================================
// Nested Localization Schema Extraction
// ============================================================================

/**
 * Schema describing which paths within a JSONB field are localized.
 * Used by the localization system to automatically split/merge nested values.
 *
 * Structure mirrors the data shape:
 * - For objects: Record<fieldName, NestedLocalizationSchema>
 * - For arrays: { _item: NestedLocalizationSchema } (special key for array items)
 * - For localized leaf fields: true
 * - For non-localized fields: not present in schema
 *
 * @example
 * // Field definition:
 * workingHours: f.object({
 *   fields: () => ({
 *     monday: f.object({
 *       fields: () => ({
 *         isOpen: f.boolean(),
 *         note: f.text({ localized: true }),
 *       }),
 *     }),
 *   }),
 * })
 *
 * // Generated schema:
 * { monday: { note: true } }
 *
 * @example
 * // Array with localized fields:
 * socialLinks: f.array({
 *   of: f.object({
 *     fields: () => ({
 *       platform: f.select({ options: [...] }),
 *       description: f.text({ localized: true }),
 *     }),
 *   }),
 * })
 *
 * // Generated schema:
 * { _item: { description: true } }
 */
/**
 * Schema for object nested fields - maps field names to their localization schemas.
 */
export interface NestedObjectSchema {
	[fieldName: string]: NestedLocalizationSchema;
}

/**
 * Schema for array items - uses special _item key.
 */
export interface NestedArraySchema {
	_item: NestedLocalizationSchema;
}

/**
 * Schema for blocks field - maps block types to their field schemas.
 * Uses special _blocks key to identify this as a blocks schema.
 *
 * @example
 * // Blocks field with hero block having localized title:
 * {
 *   _blocks: {
 *     hero: { title: true, subtitle: true },
 *     text: { content: true }
 *   }
 * }
 */
export interface NestedBlocksSchema {
	_blocks: Record<string, NestedLocalizationSchema>;
}

/**
 * Union type for nested localization schema.
 */
export type NestedLocalizationSchema =
	| true // Leaf localized field
	| NestedArraySchema // Array item schema
	| NestedBlocksSchema // Blocks field schema
	| NestedObjectSchema; // Object fields schema

/**
 * Extract nested localization schema from a field definition.
 * Recursively traverses object/array fields to find nested localized fields.
 *
 * Returns the schema for localized nested paths, or null if no nested localization.
 */
export function extractNestedLocalizationSchema(
	fieldDef: Field<FieldState>,
): NestedLocalizationSchema | null {
	const s = fieldDef._state;
	const fieldType = fieldDef.getType();

	// Handle object fields
	if (fieldType === "object" && s.nestedFields) {
		const nestedFields = resolveFieldsConfig(s.nestedFields);
		if (!nestedFields) return null;

		const schema: Record<string, NestedLocalizationSchema> = {};
		let hasLocalized = false;

		for (const [fieldName, nestedFieldDef] of Object.entries(nestedFields)) {
			// Check if this nested field is directly localized
			if (nestedFieldDef._state.localized) {
				schema[fieldName] = true;
				hasLocalized = true;
				continue;
			}

			// Recursively check for nested localized fields
			const nestedSchema = extractNestedLocalizationSchema(nestedFieldDef);
			if (nestedSchema !== null) {
				schema[fieldName] = nestedSchema;
				hasLocalized = true;
			}
		}

		return hasLocalized ? schema : null;
	}

	// Handle array fields
	if (fieldType === "array" && s.innerField) {
		const itemFieldDef = resolveItemConfig(s.innerField);
		if (!itemFieldDef) return null;

		// Check if array item itself is localized (whole array item is localized)
		if (itemFieldDef._state.localized) {
			return { _item: true };
		}

		// Recursively check array item for nested localized fields
		const itemSchema = extractNestedLocalizationSchema(itemFieldDef);
		if (itemSchema !== null) {
			return { _item: itemSchema };
		}

		return null;
	}

	// Handle blocks field - extract schema from block definitions
	// NOTE: _blockDefinitions is a forward-reference for the blocks field type
	// which stores block definitions on the runtime state. This property is not
	// part of FieldRuntimeState yet — it will be added when blocks are fully typed.
	if (fieldType === "blocks") {
		const blockDefinitions = (s as Record<string, unknown>)._blockDefinitions as
			| Record<string, { state?: { fields?: unknown } }>
			| undefined;

		if (!blockDefinitions) return null;

		const blocksSchema: Record<string, NestedLocalizationSchema> = {};
		let hasBlocksLocalized = false;

		for (const [blockType, blockDef] of Object.entries(blockDefinitions)) {
			const blockFields = resolveFieldsConfig(blockDef.state?.fields);
			if (!blockFields) continue;

			// Extract schema for this block type's fields (inline logic)
			const blockSchema: Record<string, NestedLocalizationSchema> = {};
			let hasFieldLocalized = false;

			for (const [fieldName, blockFieldDef] of Object.entries(blockFields)) {
				// Check if this field is directly localized
				if (blockFieldDef._state.localized) {
					blockSchema[fieldName] = true;
					hasFieldLocalized = true;
					continue;
				}

				// Recursively check for nested localized fields
				const nestedSchema = extractNestedLocalizationSchema(blockFieldDef);
				if (nestedSchema !== null) {
					blockSchema[fieldName] = nestedSchema;
					hasFieldLocalized = true;
				}
			}

			if (hasFieldLocalized) {
				blocksSchema[blockType] = blockSchema;
				hasBlocksLocalized = true;
			}
		}

		if (hasBlocksLocalized) {
			return { _blocks: blocksSchema };
		}
		return null;
	}

	// Primitive fields - no nested localization possible
	return null;
}

/**
 * Extract nested localization schemas for all JSONB fields in a collection.
 * Returns a map of field name → nested localization schema.
 *
 * Only includes fields that have nested localized content (not top-level localized).
 */
export function extractNestedLocalizationSchemas(
	fieldDefinitions: Record<string, Field<FieldState>>,
): Record<string, NestedLocalizationSchema> {
	const schemas: Record<string, NestedLocalizationSchema> = {};

	for (const [fieldName, fieldDef] of Object.entries(fieldDefinitions)) {
		// Skip top-level localized fields (they go to i18n table columns directly)
		if (fieldDef.getLocation() === "i18n") continue;

		// Skip non-JSONB fields (only object/array/blocks can have nested localization)
		const fieldType = fieldDef.getType();
		if (
			fieldType !== "object" &&
			fieldType !== "array" &&
			fieldType !== "blocks"
		) {
			continue;
		}

		const schema = extractNestedLocalizationSchema(fieldDef);
		if (schema !== null) {
			schemas[fieldName] = schema;
		}
	}

	return schemas;
}

/**
 * Check if a collection has any nested localized fields (in JSONB).
 */
export function hasNestedLocalizedFields(
	fieldDefinitions: Record<string, Field<FieldState>> | undefined,
): boolean {
	if (!fieldDefinitions) return false;
	return (
		Object.keys(extractNestedLocalizationSchemas(fieldDefinitions)).length > 0
	);
}

// ============================================================================
// Helper functions for resolving field configs
// ============================================================================

/**
 * Resolve fields config (handles factory functions).
 */
function resolveFieldsConfig(
	fields: unknown,
): Record<string, Field<FieldState>> | null {
	if (!fields) return null;
	if (typeof fields === "function") {
		return fields() as Record<string, Field<FieldState>>;
	}
	return fields as Record<string, Field<FieldState>>;
}

/**
 * Resolve array item config (handles factory functions).
 */
function resolveItemConfig(of: unknown): Field<FieldState> | null {
	if (!of) return null;
	if (typeof of === "function") {
		return of() as Field<FieldState>;
	}
	return of as Field<FieldState>;
}
