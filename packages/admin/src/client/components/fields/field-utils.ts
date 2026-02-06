import { type Control, useFormContext } from "react-hook-form";

export function useResolvedControl(control?: Control<any>) {
  const form = useFormContext();
  return control ?? form.control;
}

/**
 * Sanitize filename for safe storage.
 * Removes special characters, replaces spaces with hyphens.
 */
export function sanitizeFilename(filename: string): string {
  // Get extension
  const lastDot = filename.lastIndexOf(".");
  const ext = lastDot > 0 ? filename.slice(lastDot) : "";
  const name = lastDot > 0 ? filename.slice(0, lastDot) : filename;

  // Normalize unicode, remove diacritics, replace spaces, remove invalid chars
  const sanitized = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/[^a-zA-Z0-9._-]/g, "") // Remove invalid chars
    .replace(/-+/g, "-") // Collapse multiple hyphens
    .replace(/^-|-$/g, "") // Remove leading/trailing hyphens
    .toLowerCase();

  return (sanitized || "file") + ext.toLowerCase();
}

/**
 * Extract columns from collection list config.
 * Used by relation fields to auto-detect display columns.
 */
export function getAutoColumns(collectionConfig: any): string[] {
  if (!collectionConfig?.list?.columns) return ["_title"];

  // List columns can be field references (f.fieldName) or strings
  const columns = collectionConfig.list.columns;
  if (Array.isArray(columns)) {
    return columns
      .map((col: any) => {
        // Handle field proxy objects
        if (col && typeof col === "object" && col["~fieldName"]) {
          return col["~fieldName"];
        }
        // Handle string field names
        if (typeof col === "string") {
          return col;
        }
        return null;
      })
      .filter(Boolean)
      .slice(0, 4); // Limit to 4 columns for relation display
  }

  return ["_title"];
}

/**
 * Grid column classes for responsive layouts.
 * Uses standard responsive breakpoints (sm:, lg:, etc.)
 */
export const gridColumnClasses: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4",
};

/**
 * Grid column classes using container queries.
 * Parent must have @container class for these to work.
 */
export const containerGridColumnClasses: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 @sm:grid-cols-2",
  3: "grid-cols-1 @sm:grid-cols-2 @lg:grid-cols-3",
  4: "grid-cols-1 @sm:grid-cols-2 @md:grid-cols-3 @xl:grid-cols-4",
  5: "grid-cols-1 @xs:grid-cols-2 @sm:grid-cols-3 @lg:grid-cols-4 @xl:grid-cols-5",
  6: "grid-cols-1 @xs:grid-cols-2 @sm:grid-cols-3 @md:grid-cols-4 @lg:grid-cols-5 @xl:grid-cols-6",
};

/**
 * Get grid columns class for a given column count.
 * @param columns Number of columns
 * @param useContainerQueries Use container query classes instead of viewport breakpoints
 */
export function getGridColumnsClass(
  columns?: number,
  useContainerQueries = false,
): string {
  if (!columns) return "";
  const classes = useContainerQueries
    ? containerGridColumnClasses
    : gridColumnClasses;
  return classes[columns] || "";
}
