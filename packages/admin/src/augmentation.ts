/**
 * Admin Field Meta Types
 *
 * These types define UI options for admin field rendering.
 * They are used by the admin package to configure field appearance and behavior.
 *
 * @example Usage in field definition (server-side):
 * ```ts
 * f.text({
 *   label: "Title",
 *   meta: {
 *     admin: {
 *       placeholder: "Enter title...",
 *       showCounter: true,
 *     }
 *   }
 * })
 * ```
 *
 * For type-safe `meta.admin` property, users should add module augmentation
 * in their project's types file:
 *
 * ```ts
 * // types/questpie.d.ts
 * import type { TextFieldAdminMeta } from "@questpie/admin";
 *
 * declare module "questpie" {
 *   interface TextFieldMeta {
 *     admin?: TextFieldAdminMeta;
 *   }
 *   // ... other field types
 * }
 * ```
 */

// ============================================================================
// Shared Admin Options (common across field types)
// ============================================================================

/**
 * Common admin options shared by all fields.
 * Each field-specific admin meta extends this.
 */
export interface BaseAdminMeta {
  /**
   * Field width in form (CSS value or number for pixels).
   * @example "100%" | 400 | "50%"
   */
  width?: string | number;

  /**
   * Column span in grid layout (1-12).
   * @default 12
   */
  colspan?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

  /**
   * Field group for form organization.
   */
  group?: string;

  /**
   * Display order within group.
   */
  order?: number;

  /**
   * Always hide the field.
   */
  hidden?: boolean;

  /**
   * Always make the field read-only.
   */
  readOnly?: boolean;

  /**
   * Always disable the field.
   */
  disabled?: boolean;

  /**
   * Show this field in list view columns.
   */
  showInList?: boolean;

  /**
   * Column width in list view.
   */
  listWidth?: string | number;

  /**
   * Enable sorting by this field.
   */
  sortable?: boolean;

  /**
   * Enable filtering by this field.
   */
  filterable?: boolean;
}

// ============================================================================
// Field-Specific Admin Options
// ============================================================================

/**
 * Text field admin options
 */
export interface TextFieldAdminMeta extends BaseAdminMeta {
  placeholder?: string;
  showCounter?: boolean;
  prefix?: string;
  suffix?: string;
  inputType?: "text" | "email" | "url" | "tel" | "search" | "password";
}

/**
 * Email field admin options
 */
export interface EmailFieldAdminMeta extends BaseAdminMeta {
  placeholder?: string;
  /** Show domain hint (e.g., "@company.com") */
  domainHint?: string;
}

/**
 * URL field admin options
 */
export interface UrlFieldAdminMeta extends BaseAdminMeta {
  placeholder?: string;
  /** Show protocol dropdown (http/https) */
  showProtocolDropdown?: boolean;
  /** Default protocol if not provided */
  defaultProtocol?: "http" | "https";
}

/**
 * Textarea field admin options
 */
export interface TextareaFieldAdminMeta extends BaseAdminMeta {
  placeholder?: string;
  rows?: number;
  autoResize?: boolean;
  richText?: boolean;
  showCounter?: boolean;
}

/**
 * Number field admin options
 */
export interface NumberFieldAdminMeta extends BaseAdminMeta {
  placeholder?: string;
  showButtons?: boolean;
  step?: number;
}

/**
 * Boolean field admin options
 */
export interface BooleanFieldAdminMeta extends BaseAdminMeta {
  displayAs?: "checkbox" | "switch";
}

/**
 * Date field admin options
 */
export interface DateFieldAdminMeta extends BaseAdminMeta {
  placeholder?: string;
}

/**
 * Time field admin options
 */
export interface TimeFieldAdminMeta extends BaseAdminMeta {
  placeholder?: string;
}

/**
 * Select field admin options
 */
export interface SelectFieldAdminMeta extends BaseAdminMeta {
  displayAs?: "dropdown" | "radio" | "checkbox" | "buttons";
  searchable?: boolean;
  creatable?: boolean;
  clearable?: boolean;
}

/**
 * Relation field admin options
 */
export interface RelationFieldAdminMeta extends BaseAdminMeta {
  displayAs?: "select" | "table" | "cards" | "list";
  displayFields?: string[];
  titleField?: string;
  allowCreate?: boolean;
  allowEdit?: boolean;
  preload?: boolean;
  maxItems?: number;
}

/**
 * Object field admin options
 */
export interface ObjectFieldAdminMeta extends BaseAdminMeta {
  displayAs?: "card" | "section" | "inline";
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

/**
 * Array field admin options
 */
export interface ArrayFieldAdminMeta extends BaseAdminMeta {
  displayAs?: "list" | "table" | "cards";
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  addLabel?: string;
  emptyMessage?: string;
  maxItems?: number;
}

/**
 * JSON field admin options
 */
export interface JsonFieldAdminMeta extends BaseAdminMeta {
  /** Show as code editor */
  codeEditor?: boolean;
}

/**
 * Upload field admin options
 */
export interface UploadFieldAdminMeta extends BaseAdminMeta {
  accept?: string;
  dropzoneText?: string;
}

/**
 * Rich text field admin options
 */
export interface RichTextFieldAdminMeta extends BaseAdminMeta {
  /** Placeholder text when editor is empty */
  placeholder?: string;
  /** Show character count */
  showCharacterCount?: boolean;
  /** Maximum characters allowed */
  maxCharacters?: number;
  /** Minimum characters required */
  minCharacters?: number;
  /** Enable image uploads within editor */
  enableImages?: boolean;
  /** Collection to use for image uploads */
  imageCollection?: string;
  /** Enable media library integration */
  enableMediaLibrary?: boolean;
}

/**
 * Blocks field admin options
 */
export interface BlocksFieldAdminMeta extends BaseAdminMeta {
  /** Label for add block button */
  addLabel?: string;
  /** Message shown when no blocks present */
  emptyMessage?: string;
  /** Maximum number of blocks allowed */
  maxBlocks?: number;
  /** Minimum number of blocks required */
  minBlocks?: number;
  /** Enable drag & drop reordering */
  sortable?: boolean;
  /** Show block type selector as dropdown or grid */
  selectorDisplayAs?: "dropdown" | "grid";
  /** Default collapsed state for blocks */
  defaultCollapsed?: boolean;
}

// ============================================================================
// Union type for all admin metas (useful for generic handling)
// ============================================================================

export type AnyAdminMeta =
  | TextFieldAdminMeta
  | TextareaFieldAdminMeta
  | EmailFieldAdminMeta
  | UrlFieldAdminMeta
  | NumberFieldAdminMeta
  | BooleanFieldAdminMeta
  | DateFieldAdminMeta
  | TimeFieldAdminMeta
  | SelectFieldAdminMeta
  | RelationFieldAdminMeta
  | ObjectFieldAdminMeta
  | ArrayFieldAdminMeta
  | JsonFieldAdminMeta
  | UploadFieldAdminMeta
  | RichTextFieldAdminMeta
  | BlocksFieldAdminMeta;

// ============================================================================
// Widget Augmentation Types
// ============================================================================

/**
 * Base widget admin meta (common options for all widgets)
 */
export interface BaseWidgetAdminMeta {
  /** Default grid span */
  span?: number;
  /** Default refresh interval */
  refreshInterval?: number;
}

/**
 * Registry interface for widget types.
 * Users can augment this to add custom widget type configs.
 *
 * @example
 * ```ts
 * declare module "@questpie/admin" {
 *   interface WidgetTypeRegistry {
 *     myCustomWidget: { fetchFn: (client: any) => Promise<MyData> };
 *   }
 * }
 * ```
 */
export interface WidgetTypeRegistry {
  stats: {};
  chart: {};
  recentItems: {};
  quickActions: {};
  value: {};
  table: {};
  timeline: {};
  progress: {};
}
