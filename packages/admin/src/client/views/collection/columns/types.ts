/**
 * Column Builder Types
 *
 * Type definitions for column building system
 */

import type { ListViewConfig } from "../../../builder/types/collection-types";
import type { FieldDefinition } from "../../../builder/field/field";

/**
 * Options for building columns
 */
export interface BuildColumnsOptions {
  /**
   * Collection config with fields and list view settings
   */
  config?: {
    fields?: Record<string, FieldDefinition>;
    list?: ListViewConfig<string>;
  };

  /**
   * Fallback columns if none specified
   */
  fallbackColumns?: string[];

  /**
   * Build column definitions for ALL fields (not just configured/default)
   * Use this when users can toggle column visibility in the UI.
   * When true, visibleColumnDefs filtering determines what's actually shown.
   * @default false
   */
  buildAllColumns?: boolean;

  /**
   * Collection metadata from backend (for title field detection)
   * When provided, uses title.fieldName instead of _title
   */
  meta?: CollectionMeta;
}

/**
 * Collection metadata from backend /meta endpoint
 */
export interface CollectionMeta {
  /**
   * Title field configuration
   */
  title?: {
    /** Whether title is defined */
    defined?: boolean;
    /** Type of title field */
    type?: "field" | "virtual" | null;
    /** Name of the field used for title */
    fieldName?: string | null;
  };
  /** Whether timestamps (createdAt, updatedAt) are enabled */
  timestamps?: boolean;
  /** List of virtual field names */
  virtualFields?: string[];
  /** List of localized field names */
  localizedFields?: string[];
  /** List of relation field names */
  relations?: string[];
}

/**
 * Options for computing default columns
 */
export interface ComputeDefaultColumnsOptions {
  /**
   * Collection metadata from backend (optional)
   * When provided, uses title.fieldName instead of _title
   */
  meta?: CollectionMeta;

  /**
   * Configured columns from .list() config
   * If provided, these are used as defaults instead of auto-detection
   */
  configuredColumns?: Array<string | { field: string }>;
}

/**
 * Field information for column picker
 * Note: Using inline type to avoid conflict with filter-builder's AvailableField
 */
export type ColumnField = {
  /** Field name */
  name: string;
  /** Display label */
  label: string;
  /** Field type */
  type: string;
  /** Whether this is a system field */
  isSystem: boolean;
  /** Field options */
  options?: Record<string, any>;
};
