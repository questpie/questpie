/**
 * Column Defaults Computation
 *
 * Functions for computing default visible columns and available fields
 * Extracted from build-columns.tsx
 */

import type { FieldDefinition } from "../../../builder/field/field";
import { formatFieldLabel } from "../cells/shared/cell-helpers";
import type { ColumnField, ComputeDefaultColumnsOptions } from "./types";

// ============================================================================
// Constants
// ============================================================================

/**
 * System fields that are typically auto-generated and not user-editable
 */
export const SYSTEM_FIELDS = new Set([
  "id",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "createdBy",
  "updatedBy",
]);

/**
 * Field types that are typically not shown by default in list view
 * (too complex or take up too much space)
 */
export const EXCLUDED_DEFAULT_FIELD_TYPES = new Set([
  "relation",
  "reverseRelation",
  "upload",
  "uploadMany",
  "json",
  "object",
  "richText",
  "textarea",
]);

/**
 * Maximum number of content fields to show by default
 */
export const MAX_DEFAULT_CONTENT_FIELDS = 4;

// ============================================================================
// Default Column Computation
// ============================================================================

/**
 * Compute sane default visible columns for a collection
 *
 * Default columns are selected with the following logic:
 * 1. If configuredColumns is provided (from .list()), use those + title
 * 2. Otherwise, auto-detect:
 *    - Title field first
 *    - Up to 4 content fields (non-system, non-relation, non-upload)
 *    - `createdAt` at the end (if timestamps enabled)
 *
 * @param fields - Field definitions from collection config
 * @param options - Optional metadata and configured columns
 * @returns Array of field names for default visible columns
 */
export function computeDefaultColumns(
  fields?: Record<string, FieldDefinition>,
  options?: ComputeDefaultColumnsOptions,
): string[] {
  // Determine the title column to use
  const titleFieldName = options?.meta?.title?.fieldName;
  const titleType = options?.meta?.title?.type;
  const useTitleField = titleType === "field" && titleFieldName;
  const titleColumn = useTitleField ? titleFieldName : "_title";

  // If columns are explicitly configured in .list(), use those
  if (options?.configuredColumns && options.configuredColumns.length > 0) {
    const configuredNames = options.configuredColumns.map((col) =>
      typeof col === "string" ? col : col.field,
    );

    // Always include title column first, then configured columns (excluding title to avoid dupe)
    const defaultCols: string[] = [titleColumn];
    for (const colName of configuredNames) {
      if (colName !== titleColumn) {
        defaultCols.push(colName);
      }
    }
    return defaultCols;
  }

  // No configured columns - auto-detect defaults
  const defaultCols: string[] = [titleColumn];

  if (!fields || Object.keys(fields).length === 0) {
    return defaultCols;
  }

  // Get content fields (non-system, non-excluded types)
  const contentFields = Object.entries(fields)
    .filter(([key, fieldDef]) => {
      // Skip system fields
      if (SYSTEM_FIELDS.has(key)) return false;

      // Skip the title field if we're already showing it
      if (useTitleField && key === titleFieldName) return false;

      // Skip complex field types
      const fieldType = fieldDef?.name ?? "text";
      if (EXCLUDED_DEFAULT_FIELD_TYPES.has(fieldType)) return false;

      return true;
    })
    .map(([key]) => key);

  // Add up to MAX_DEFAULT_CONTENT_FIELDS content fields
  const selectedContentFields = contentFields.slice(
    0,
    MAX_DEFAULT_CONTENT_FIELDS,
  );
  defaultCols.push(...selectedContentFields);

  // Add createdAt at the end if timestamps enabled (from meta or field existence)
  const hasTimestamps = options?.meta?.timestamps ?? !!fields.createdAt;
  if (hasTimestamps && fields.createdAt) {
    defaultCols.push("createdAt");
  }

  return defaultCols;
}

// ============================================================================
// Available Fields
// ============================================================================

/**
 * Get all available fields for the column picker
 *
 * Includes all fields (both content and system fields) so users can
 * choose to display any field in their view.
 *
 * @param fields - Field definitions from collection config
 * @param options - Optional metadata from backend
 * @returns Array of available field info for the column picker
 */
export function getAllAvailableFields(
  fields?: Record<string, FieldDefinition>,
  options?: ComputeDefaultColumnsOptions,
): ColumnField[] {
  const availableFields: ColumnField[] = [];

  // Determine title field from meta
  const titleFieldName = options?.meta?.title?.fieldName;
  const titleType = options?.meta?.title?.type;
  const useTitleField = titleType === "field" && titleFieldName;

  // Only add _title as an option if title is NOT a real field
  // (i.e., title is virtual/computed, so _title is the way to access it)
  if (!useTitleField) {
    // For virtual titles, show the virtual field's label instead of generic "Title"
    if (titleType === "virtual" && titleFieldName && fields?.[titleFieldName]) {
      const titleFieldDef = fields[titleFieldName];
      const titleFieldOptions = titleFieldDef?.["~options"] ?? {};
      const titleLabel =
        titleFieldOptions.label ?? formatFieldLabel(titleFieldName);
      availableFields.push({
        name: "_title",
        label: titleLabel,
        type: "text",
        isSystem: false,
        options: undefined,
      });
    } else {
      // Fallback to generic "Title" when no title defined or field not found
      availableFields.push({
        name: "_title",
        label: "Title",
        type: "text",
        isSystem: false,
        options: undefined,
      });
    }
  }

  if (!fields) return availableFields;

  // Add all fields from config (except virtual title field to avoid duplication)
  for (const [key, fieldDef] of Object.entries(fields)) {
    // Skip the virtual title field since we already added _title for it
    if (titleType === "virtual" && key === titleFieldName) continue;

    const fieldType = fieldDef?.name ?? "text";
    const fieldOptions = fieldDef?.["~options"] ?? {};
    const label = fieldOptions.label ?? formatFieldLabel(key);
    const isSystem = SYSTEM_FIELDS.has(key);

    availableFields.push({
      name: key,
      label,
      type: fieldType,
      isSystem,
      options: fieldOptions,
    });
  }

  return availableFields;
}

/**
 * Format field name as header (camelCase to Title Case)
 */
export function formatHeader(fieldName: string): string {
  return formatFieldLabel(fieldName);
}
