/**
 * Field Extraction Utilities (TState-based)
 *
 * Runtime helpers to extract field information from FieldDefinition TState.
 * Replaces the old localized[] array approach.
 */

import type {
  FieldDefinition,
  FieldDefinitionState,
} from "#questpie/server/fields/types.js";

/**
 * Extract field names by location from field definitions.
 * Runtime version of ExtractFieldsByLocation type.
 */
export function extractFieldNamesByLocation(
  fieldDefinitions: Record<string, FieldDefinition<FieldDefinitionState>>,
  location: "main" | "i18n" | "virtual" | "relation",
): string[] {
  const names: string[] = [];
  for (const [name, fieldDef] of Object.entries(fieldDefinitions)) {
    if (fieldDef.state.location === location) {
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
  fieldDefinitions: Record<string, FieldDefinition<FieldDefinitionState>>,
): string[] {
  return extractFieldNamesByLocation(fieldDefinitions, "i18n");
}

/**
 * Extract main field names.
 */
export function extractMainFieldNames(
  fieldDefinitions: Record<string, FieldDefinition<FieldDefinitionState>>,
): string[] {
  return extractFieldNamesByLocation(fieldDefinitions, "main");
}

/**
 * Extract virtual field names.
 */
export function extractVirtualFieldNames(
  fieldDefinitions: Record<string, FieldDefinition<FieldDefinitionState>>,
): string[] {
  return extractFieldNamesByLocation(fieldDefinitions, "virtual");
}

/**
 * Check if collection has any localized fields.
 */
export function hasLocalizedFields(
  fieldDefinitions:
    | Record<string, FieldDefinition<FieldDefinitionState>>
    | undefined,
): boolean {
  if (!fieldDefinitions) return false;
  return extractLocalizedFieldNames(fieldDefinitions).length > 0;
}

/**
 * Check if collection has any virtual fields.
 */
export function hasVirtualFields(
  fieldDefinitions:
    | Record<string, FieldDefinition<FieldDefinitionState>>
    | undefined,
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
  fieldDefinitions: Record<string, FieldDefinition<FieldDefinitionState>>,
): { main: Partial<T>; localized: Partial<T> } {
  const main: Partial<T> = {};
  const localized: Partial<T> = {};

  const localizedNames = new Set(extractLocalizedFieldNames(fieldDefinitions));

  for (const [key, value] of Object.entries(data)) {
    if (localizedNames.has(key)) {
      (localized as any)[key] = value;
    } else {
      (main as any)[key] = value;
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
 * Union type for nested localization schema.
 */
export type NestedLocalizationSchema =
  | true // Leaf localized field
  | NestedArraySchema // Array item schema
  | NestedObjectSchema; // Object fields schema

/**
 * Extract nested localization schema from a field definition.
 * Recursively traverses object/array fields to find nested localized fields.
 *
 * Returns the schema for localized nested paths, or null if no nested localization.
 */
export function extractNestedLocalizationSchema(
  fieldDef: FieldDefinition<FieldDefinitionState>,
): NestedLocalizationSchema | null {
  const config = fieldDef.state.config as Record<string, unknown>;
  const fieldType = fieldDef.state.type;

  // Handle object fields
  if (fieldType === "object" && config.fields) {
    const nestedFields = resolveFieldsConfig(config.fields);
    if (!nestedFields) return null;

    const schema: Record<string, NestedLocalizationSchema> = {};
    let hasLocalized = false;

    for (const [fieldName, nestedFieldDef] of Object.entries(nestedFields)) {
      const nestedConfig = nestedFieldDef.state.config as Record<
        string,
        unknown
      >;

      // Check if this nested field is directly localized
      if (nestedConfig.localized === true) {
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
  if (fieldType === "array" && config.of) {
    const itemFieldDef = resolveItemConfig(config.of);
    if (!itemFieldDef) return null;

    const itemConfig = itemFieldDef.state.config as Record<string, unknown>;

    // Check if array item itself is localized (whole array item is localized)
    if (itemConfig.localized === true) {
      return { _item: true };
    }

    // Recursively check array item for nested localized fields
    const itemSchema = extractNestedLocalizationSchema(itemFieldDef);
    if (itemSchema !== null) {
      return { _item: itemSchema };
    }

    return null;
  }

  // For blocks field, treat similarly to array with special handling
  if (fieldType === "blocks") {
    // Blocks have their own localization handling via _values
    // For now, return null - blocks use the $i18n wrapper approach
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
  fieldDefinitions: Record<string, FieldDefinition<FieldDefinitionState>>,
): Record<string, NestedLocalizationSchema> {
  const schemas: Record<string, NestedLocalizationSchema> = {};

  for (const [fieldName, fieldDef] of Object.entries(fieldDefinitions)) {
    // Skip top-level localized fields (they go to i18n table columns directly)
    if (fieldDef.state.location === "i18n") continue;

    // Skip non-JSONB fields (only object/array/blocks can have nested localization)
    const fieldType = fieldDef.state.type;
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
  fieldDefinitions:
    | Record<string, FieldDefinition<FieldDefinitionState>>
    | undefined,
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
): Record<string, FieldDefinition<FieldDefinitionState>> | null {
  if (!fields) return null;
  if (typeof fields === "function") {
    return fields() as Record<string, FieldDefinition<FieldDefinitionState>>;
  }
  return fields as Record<string, FieldDefinition<FieldDefinitionState>>;
}

/**
 * Resolve array item config (handles factory functions).
 */
function resolveItemConfig(
  of: unknown,
): FieldDefinition<FieldDefinitionState> | null {
  if (!of) return null;
  if (typeof of === "function") {
    return of() as FieldDefinition<FieldDefinitionState>;
  }
  return of as FieldDefinition<FieldDefinitionState>;
}
