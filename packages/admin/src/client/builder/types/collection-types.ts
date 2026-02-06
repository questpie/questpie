/**
 * Collection Builder Types
 */

import type { ComponentReference } from "#questpie/admin/server";
import type { I18nText } from "../../i18n/types.js";
import type { AdminBuilder } from "../admin-builder";
import type { FieldDefinition } from "../field/field";
import type { IconComponent, MaybeLazyComponent } from "./common";
import type { FormViewConfig } from "./field-types";
import type { ActionsConfig } from "./action-types";

/**
 * Collection metadata for navigation and display
 */
export interface CollectionMeta {
  /** Display label - supports inline translations */
  label?: I18nText;
  icon?: IconComponent | ComponentReference | string;
  group?: string;
  order?: number;
  hidden?: boolean;
}

// ============================================================================
// Column Configuration
// ============================================================================

/**
 * Column configuration for list views
 * Can be a simple field name or detailed config object
 */
export type ColumnConfig<TFieldNames extends string = string> =
  | TFieldNames
  | ColumnConfigObject<TFieldNames>;

/**
 * Detailed column configuration object
 */
export interface ColumnConfigObject<TFieldNames extends string = string> {
  /**
   * Field name to display
   */
  field: TFieldNames;

  /**
   * Custom header label (defaults to field label)
   */
  header?: string;

  /**
   * Column width (CSS value like "200px", "20%", etc.)
   */
  width?: string | number;

  /**
   * Minimum column width
   */
  minWidth?: string | number;

  /**
   * Maximum column width
   */
  maxWidth?: string | number;

  /**
   * Enable sorting for this column
   * @default true
   */
  sortable?: boolean;

  /**
   * Custom cell renderer component
   * Overrides the field's default cell component
   */
  cell?: MaybeLazyComponent;

  /**
   * Column visibility
   * Can be a boolean or function for conditional visibility
   */
  visible?: boolean | ((row: any) => boolean);

  /**
   * Custom CSS class for column cells
   */
  className?: string;

  /**
   * Text alignment
   */
  align?: "left" | "center" | "right";
}

/**
 * Helper to normalize column config to field name
 */
export function getColumnFieldName<T extends string>(
  column: ColumnConfig<T>,
): T {
  return typeof column === "string" ? column : column.field;
}

/**
 * Helper to get column config object (normalizes string to object)
 */
export function normalizeColumnConfig<T extends string>(
  column: ColumnConfig<T>,
): ColumnConfigObject<T> {
  return typeof column === "string" ? { field: column } : column;
}

// ============================================================================
// List View Configuration
// ============================================================================

/**
 * List view configuration
 */
export interface ListViewConfig<TFieldNames extends string = string> {
  /**
   * Columns to display (field names or column configs)
   */
  columns?: ColumnConfig<TFieldNames>[];

  /**
   * Relations to include in query
   */
  with?: string[];

  /**
   * Default sort
   */
  defaultSort?: {
    field: TFieldNames;
    direction: "asc" | "desc";
  };

  /**
   * Enable search
   * @default true
   */
  searchable?: boolean;

  /**
   * Searchable fields (defaults to all text-like fields)
   */
  searchFields?: TFieldNames[];

  /**
   * Enable row selection
   * @default false
   */
  selectable?: boolean;

  /**
   * Enable pagination
   * @default true
   */
  paginated?: boolean;

  /**
   * Enable realtime invalidation for list queries.
   * Falls back to AdminProvider realtime config when undefined.
   */
  realtime?: boolean;

  /**
   * Default page size
   * @default 25
   */
  pageSize?: number;

  /**
   * Available page size options
   * @default [10, 25, 50, 100]
   */
  pageSizeOptions?: number[];

  /**
   * Actions configuration for list view
   */
  actions?: ActionsConfig;
}

/**
 * Collection configuration - runtime config object
 */
export interface CollectionConfig<TFieldNames extends string = string> {
  /**
   * Collection name
   */
  name: string;

  /**
   * Collection metadata (for navigation/display)
   */
  meta?: CollectionMeta;

  /**
   * Display label - supports inline translations
   */
  label?: I18nText;

  /**
   * Icon
   */
  icon?: IconComponent | ComponentReference | string;

  /**
   * Description - supports inline translations
   */
  description?: I18nText;

  /**
   * Field configurations (FieldDefinition objects)
   *
   * @deprecated Admin UI is schema-driven. Prefer server-side schema fields.
   */
  fields?: Record<string, FieldDefinition>;

  /**
   * List view configuration
   *
   * @deprecated Admin UI is schema-driven. Prefer server-side schema config.
   */
  list?: ListViewConfig<TFieldNames>;

  /**
   * Form view configuration
   *
   * @deprecated Admin UI is schema-driven. Prefer server-side schema config.
   */
  form?: FormViewConfig;

  /**
   * Navigation group
   */
  group?: string;

  /**
   * Sort order
   */
  order?: number;

  /**
   * Hide from navigation
   */
  hidden?: boolean;
}

/**
 * Preview configuration for live preview in form view
 */
export interface PreviewConfig {
  /**
   * URL builder function that returns preview URL for current form values
   * @param values - Current form values
   * @param locale - Current content locale
   * @returns Preview URL string
   */
  url: (values: Record<string, unknown>, locale: string) => string;
  /**
   * Whether preview is enabled (default: true)
   */
  enabled?: boolean;
  /**
   * Position of the preview panel (default: "right")
   */
  position?: "right" | "bottom";
  /**
   * Default width/height percentage of preview panel (default: 50)
   */
  defaultWidth?: number;
  /**
   * Minimum width/height percentage (default: 30)
   */
  minWidth?: number;
  /**
   * Maximum width/height percentage (default: 70)
   */
  maxWidth?: number;
}

/**
 * Autosave configuration for form view
 */
export interface AutoSaveConfig {
  /**
   * Whether autosave is enabled
   * @default false
   */
  enabled?: boolean;
  /**
   * Debounce delay in milliseconds before autosave triggers
   * @default 500 (0.5s as specified)
   */
  debounce?: number;
  /**
   * Show autosave status indicator in form header
   * @default true
   */
  indicator?: boolean;
  /**
   * Warn user before navigating away with unsaved changes
   * @default true
   */
  preventNavigation?: boolean;
}

/**
 * Collection builder state - internal state during building
 */
export interface CollectionBuilderState<
  TAdminApp extends AdminBuilder<any> = AdminBuilder<any>,
> {
  readonly name: string;
  readonly "~adminApp": TAdminApp;
  /** Display label - supports inline translations */
  readonly label?: I18nText;
  /** Description - supports inline translations */
  readonly description?: I18nText;
  readonly icon?: IconComponent | ComponentReference;
  readonly fields?: Record<string, FieldDefinition<any, any>>;
  readonly list?: any; // View result from .list() callback
  readonly form?: any; // View result from .form() callback
  readonly preview?: PreviewConfig; // Preview configuration
  readonly autoSave?: AutoSaveConfig; // Autosave configuration
}
