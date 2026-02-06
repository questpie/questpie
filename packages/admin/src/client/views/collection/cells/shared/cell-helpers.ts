/**
 * Shared helper functions for cell rendering
 * Extracted from build-columns.tsx to reduce duplication
 */

import type { FieldDefinition } from "../../../../builder/field/field";
import { formatLabel } from "../../../../lib/utils";

/**
 * Get display label for a relation item
 * Prefers _title (backend computed), then common label fields, then id
 */
export function getRelationItemLabel(item: unknown): string {
  if (typeof item === "object" && item !== null) {
    const obj = item as Record<string, unknown>;
    // Prefer _title computed field from backend
    return String(obj._title || obj.name || obj.title || obj.id || "-");
  }
  return String(item);
}

/**
 * Get ID from a relation item
 */
export function getRelationItemId(item: unknown): string | null {
  if (typeof item === "object" && item !== null) {
    const obj = item as Record<string, unknown>;
    return obj.id ? String(obj.id) : null;
  }
  if (typeof item === "string" || typeof item === "number") {
    return String(item);
  }
  return null;
}

/**
 * Format a field key as a readable label (camelCase -> Title Case)
 * @deprecated Use `formatLabel` from `@/lib/utils` instead
 */
export const formatFieldLabel = formatLabel;

/**
 * Get label for a field from field definition or format from key
 */
export function getFieldLabel(key: string, fieldDef?: FieldDefinition): string {
  if (fieldDef?.["~options"]?.label) {
    return fieldDef["~options"].label;
  }
  return formatFieldLabel(key);
}

/**
 * Format a primitive value for display
 */
export function formatPrimitiveValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return value.toLocaleDateString();
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}

/**
 * Summarize a value for inline preview
 */
export function summarizeValue(val: unknown): string {
  if (val === null || val === undefined) return "-";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (typeof val === "number") return val.toLocaleString();
  if (typeof val === "string")
    return val.length > 25 ? `${val.slice(0, 25)}…` : val;
  if (Array.isArray(val)) return `${val.length} items`;
  if (typeof val === "object") return `${Object.keys(val).length} fields`;
  return String(val);
}

/**
 * Get item label from various sources (used in array cells)
 */
export function getItemLabel(
  item: unknown,
  idx: number,
  itemLabelFn?: (item: unknown) => string,
): string {
  if (itemLabelFn) {
    try {
      return itemLabelFn(item) || `Item ${idx + 1}`;
    } catch {
      return `Item ${idx + 1}`;
    }
  }
  if (typeof item === "object" && item !== null) {
    const obj = item as Record<string, unknown>;
    return (
      String(
        obj.name || obj.title || obj.label || obj.platform || obj.type || "",
      ) || `Item ${idx + 1}`
    );
  }
  return formatPrimitiveValue(item);
}
