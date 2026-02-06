/**
 * Auto Expand Fields Utility
 *
 * Automatically detects upload and relation fields that need to be expanded
 * when fetching data from the backend (e.g., for displaying in list views).
 */

import type { FieldDefinition } from "../builder/field/field";

export interface AutoExpandFieldsConfig {
  /**
   * Collection fields configuration
   */
  fields?: Record<string, FieldDefinition>;

  /**
   * List view configuration
   */
  list?: {
    /**
     * Explicit relations to include
     */
    with?: string[];

    /**
     * Columns to display
     */
    columns?: Array<string | { field: string }>;
  };

  /**
   * Known relation names from collection metadata
   */
  relations?: string[];
}

/**
 * Auto-detect upload and relation fields that need to be expanded.
 *
 * This analyzes the collection config to determine which fields require
 * data expansion when fetching from the backend:
 * - Upload fields need their asset data expanded
 * - Relation fields need their related record data expanded
 *
 * @param config - Collection configuration with fields and list view settings
 * @returns Object mapping field names to `true` for fields that need expansion
 *
 * @example
 * ```tsx
 * const expandedFields = autoExpandFields({
 *   fields: config?.fields,
 *   list: config?.list,
 * });
 *
 * // Use with query
 * const { data } = useCollectionList(collection, {
 *   with: expandedFields,
 * });
 * ```
 */
export function autoExpandFields(
  config: AutoExpandFieldsConfig,
): Record<string, boolean> {
  const withFields: Record<string, boolean> = {};

  // Add explicitly configured relations
  if (config.list?.with) {
    for (const rel of config.list.with) {
      withFields[rel] = true;
    }
  }

  // Determine which columns are displayed
  // TODO: this should adhere to visible columns based on adminPrefs
  const columnFields = config.list?.columns ?? [];
  const fieldsToCheck: string[] = [];

  if (columnFields.length > 0) {
    // Use explicitly configured columns
    for (const col of columnFields) {
      const fieldName = typeof col === "string" ? col : col.field;
      if (fieldName === "_title") continue;
      fieldsToCheck.push(fieldName);
    }
  } else if (config.fields) {
    // When columns not set, check all fields (buildColumns auto-generates from them)
    fieldsToCheck.push(...Object.keys(config.fields));
  }

  // Auto-detect upload and relation fields from columns
  for (const fieldName of fieldsToCheck) {
    const fieldDef = config.fields?.[fieldName] as any;
    if (fieldDef) {
      // fieldDef.name contains the field type (e.g., "upload", "relation")
      const fieldType = fieldDef.name;

      // Auto-expand upload and uploadMany fields
      if (fieldType === "upload" || fieldType === "uploadMany") {
        withFields[fieldName] = true;
      }
      // For relation fields, only expand if relationName is explicitly specified
      // This ensures we don't try to expand relations that don't exist on the backend
      else if (fieldType === "relation") {
        const relationName =
          fieldDef["~options"]?.relationName ?? (fieldName as string);
        const knownRelations = config.relations;
        if (!relationName) continue;
        if (!knownRelations || knownRelations.length === 0) {
          withFields[relationName] = true;
          continue;
        }
        if (knownRelations.includes(relationName)) {
          withFields[relationName] = true;
        }
      }
    }
  }

  return withFields;
}

/**
 * Check if there are any fields to expand
 */
export function hasFieldsToExpand(
  expandedFields: Record<string, boolean>,
): boolean {
  return Object.keys(expandedFields).length > 0;
}
