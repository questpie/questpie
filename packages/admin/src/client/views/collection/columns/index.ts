/**
 * Column Building System Index
 *
 * Central export point for column building functionality
 */

// Main column builder
export { buildColumns } from "./build-columns.js";

// Default column computation
export {
  computeDefaultColumns,
  getAllAvailableFields,
  formatHeader,
  SYSTEM_FIELDS,
  EXCLUDED_DEFAULT_FIELD_TYPES,
  MAX_DEFAULT_CONTENT_FIELDS,
} from "./column-defaults";

// Types
export type {
  BuildColumnsOptions,
  CollectionMeta,
  ComputeDefaultColumnsOptions,
  ColumnField,
} from "./types";
