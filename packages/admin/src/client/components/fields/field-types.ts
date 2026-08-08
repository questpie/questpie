import type { Control } from "react-hook-form";

import type { SelectOption as PrimitiveSelectOption } from "../primitives/types";
import type {
	RelationDisplayFields as DisplayFields,
	RelationDisplayMode as DisplayMode,
} from "./relation/displays/types";

// Re-export SelectOption for backwards compatibility
export type SelectOption<TValue = string> = PrimitiveSelectOption<TValue>;
/**
 * Base props shared by all field components (runtime).
 * These integrate with react-hook-form via Controller.
 * I18nText values are resolved to plain strings before reaching components.
 */
export type BaseFieldProps = {
	/** Field name (path in form values) */
	name: string;
	/** Field label (resolved from I18nText) */
	label?: string;
	/** Helper text shown below the field (resolved from I18nText) */
	description?: string;
	/** Placeholder text (resolved from I18nText) */
	placeholder?: string;
	/** Mark field as required (visual indicator) */
	required?: boolean;
	/** Disable the field */
	disabled?: boolean;
	/** Show locale badge for localized fields */
	localized?: boolean;
	/** Current locale code for localized fields */
	locale?: string;
	/**
	 * Render the control WITHOUT its own label (and description) — for compact
	 * contexts (e.g. Notion-style property rows) where the label is supplied by
	 * the surrounding layout.
	 */
	hideLabel?: boolean;
	/** Form control from react-hook-form (optional if using FormProvider) */
	control?: Control<any>;
	/** Additional className for the field wrapper */
	className?: string;
};

/**
 * Props for text-based fields
 */
export type TextFieldProps = BaseFieldProps & {
	type?: "text" | "email" | "password" | "url" | "tel" | "search";
	minLength?: number;
	maxLength?: number;
	/** Regex pattern for validation (from server metadata) */
	pattern?: string | RegExp;
	autoComplete?: string;
};

/**
 * Props for number field
 */
export type NumberFieldProps = BaseFieldProps & {
	min?: number;
	max?: number;
	step?: number;
	showButtons?: boolean;
};

/**
 * Props for textarea field
 */
export type TextareaFieldProps = BaseFieldProps & {
	rows?: number;
	minLength?: number;
	maxLength?: number;
	autoResize?: boolean;
};

/**
 * Props for select field
 */
export type SelectFieldProps<TValue = string> = BaseFieldProps & {
	options?: SelectOption<TValue>[];
	loadOptions?: (search: string) => Promise<SelectOption<TValue>[]>;
	multiple?: boolean;
	clearable?: boolean;
	maxSelections?: number;
	emptyMessage?: string;
};

/**
 * Props for date field
 */
export type DateFieldProps = BaseFieldProps & {
	minDate?: Date;
	maxDate?: Date;
	format?: string;
};

/**
 * Props for datetime field
 */
export type DateTimeFieldProps = DateFieldProps & {
	precision?: "minute" | "second";
};

/**
 * Props for time field (time-only, no date)
 */
export type TimeFieldProps = BaseFieldProps & {
	precision?: "minute" | "second";
};

// ============================================================================
// Config Types (for admin builder - without BaseFieldProps)
// ============================================================================

/** Text field config */
export type TextFieldConfig = Omit<TextFieldProps, keyof BaseFieldProps>;

/** Number field config */
export type NumberFieldConfig = Omit<NumberFieldProps, keyof BaseFieldProps>;

/** Textarea field config */
export type TextareaFieldConfig = Omit<
	TextareaFieldProps,
	keyof BaseFieldProps
>;

/** Select field config */
export type SelectFieldConfig<TValue = string> = Omit<
	SelectFieldProps<TValue>,
	keyof BaseFieldProps
>;

/** Date field config */
export type DateFieldConfig = Omit<DateFieldProps, keyof BaseFieldProps>;

/** DateTime field config */
export type DateTimeFieldConfig = Omit<
	DateTimeFieldProps,
	keyof BaseFieldProps
>;

/** Time field config */
export type TimeFieldConfig = Omit<TimeFieldProps, keyof BaseFieldProps>;

/** Boolean (checkbox/switch) field config */
export type BooleanFieldConfig = {
	/**
	 * Display mode for the boolean field.
	 * @default "checkbox"
	 */
	displayAs?: "checkbox" | "switch";
};

/** JSON field config */
export type JsonFieldConfig = Record<string, never>;

// Re-export display types from relation module (single source of truth)
export type RelationDisplayMode = DisplayMode;
export type RelationDisplayFields = DisplayFields;

export type RelationListCellConfig = {
	/**
	 * Table list display mode for relation cells.
	 * @default "chip"
	 */
	display?: "chip" | "avatarChip";
	/**
	 * Dot-path to avatar/image field on related record.
	 * Examples: "image", "avatar.url"
	 */
	avatarField?: string;
	/**
	 * Dot-path to preferred label field on related record.
	 * Example: "fullName"
	 */
	labelField?: string;
};

/** Relation field config */
export type RelationFieldConfig = {
	/** Target collection name */
	targetCollection: string;
	/** Relation type: single (one-to-one) or multiple (one-to-many) */
	type: "single" | "multiple";
	/**
	 * Backend relation name for auto-expand in list views.
	 * Use this when the admin field name differs from the backend relation name.
	 *
	 * @example
	 * // Admin field: customerId, Backend relation: customer
	 * customerId: r.relation({
	 *   targetCollection: "user",
	 *   type: "single",
	 *   relationName: "customer", // Will expand as { with: { customer: true } }
	 * })
	 */
	relationName?: string;
	/** Filter options based on form values */
	filter?: (formValues: any) => any;
	/** Enable drag-and-drop reordering (only for multiple) */
	orderable?: boolean;
	/** Maximum number of items (only for multiple) */
	maxItems?: number;
	/**
	 * Display mode for selected items (only for multiple type)
	 * @default "list"
	 */
	display?: RelationDisplayMode;
	/**
	 * Columns to show in table display mode (only for multiple type)
	 */
	columns?: string[];
	/**
	 * Field mapping for cards/grid display modes (only for multiple type)
	 */
	fields?: RelationDisplayFields;
	/**
	 * Number of columns for grid/cards layout (only for multiple type)
	 */
	gridColumns?: 1 | 2 | 3 | 4;
	/**
	 * List table cell rendering config (used when relation appears as a column).
	 */
	listCell?: RelationListCellConfig;
};

/**
 * Upload field config.
 *
 * Handles both single and multiple file uploads based on `multiple` option.
 * Maps to server's `upload` field type.
 *
 * @example Single upload (default)
 * ```ts
 * featuredImage: r.upload({
 *   accept: ["image/*"],
 *   maxSize: 5_000_000,
 * })
 * ```
 *
 * @example Multiple uploads
 * ```ts
 * gallery: r.upload({
 *   multiple: true,
 *   accept: ["image/*"],
 *   maxItems: 10,
 *   orderable: true,
 * })
 * ```
 */
export type UploadFieldConfig = {
	/** Target collection for uploads */
	to?: string;
	/** Accepted file types (MIME types or extensions) */
	accept?: string[];
	/** Maximum file size in bytes */
	maxSize?: number;
	/** Show image preview for uploaded files (default: true) */
	showPreview?: boolean;
	/** Allow editing alt/caption */
	editable?: boolean;
	/** Preview variant */
	previewVariant?: "card" | "compact" | "thumbnail";

	// ── Multiple upload options ──────────────────────────────────────────────
	/**
	 * Enable multiple file uploads.
	 * When true, field value is an array of asset IDs.
	 * @default false
	 */
	multiple?: boolean;
	/** Maximum number of files (only when multiple: true) */
	maxItems?: number;
	/** Enable drag-and-drop reordering (only when multiple: true) */
	orderable?: boolean;
	/** Layout for previews (only when multiple: true) */
	layout?: "grid" | "list";
};

// ============================================================================
// Object Field Config
// ============================================================================

/**
 * Nested field definition for object fields.
 * Uses a callback pattern to allow access to the field registry.
 */
export type NestedFieldsDefinition = Record<string, any>;

/**
 * Object field layout options - controls how nested fields are arranged inside the container.
 *
 * @example Visual comparison:
 * ```
 * ┌─────────────────────────────────────────────────────────────┐
 * │ "stack" (default)           │ "inline"                      │
 * │                             │                               │
 * │ ┌─────────────────────────┐ │ ┌────────┐ ┌────────┐ ┌─────┐ │
 * │ │ First Name              │ │ │ First  │ │ Last   │ │ Age │ │
 * │ └─────────────────────────┘ │ └────────┘ └────────┘ └─────┘ │
 * │ ┌─────────────────────────┐ │                               │
 * │ │ Last Name               │ │ Fields wrap to next line     │
 * │ └─────────────────────────┘ │ if space is limited          │
 * │ ┌─────────────────────────┐ │                               │
 * │ │ Age                     │ │                               │
 * │ └─────────────────────────┘ │                               │
 * └─────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │ "grid" (columns: 2)                                         │
 * │                                                             │
 * │ ┌─────────────────┐  ┌─────────────────┐                    │
 * │ │ First Name      │  │ Last Name       │                    │
 * │ └─────────────────┘  └─────────────────┘                    │
 * │ ┌─────────────────┐  ┌─────────────────┐                    │
 * │ │ Email           │  │ Phone           │                    │
 * │ └─────────────────┘  └─────────────────┘                    │
 * │                                                             │
 * │ Responsive: collapses to 1 column on mobile                 │
 * └─────────────────────────────────────────────────────────────┘
 * ```
 *
 * - `"stack"` - Vertical layout, each field on its own line. Best for forms with
 *   longer labels or when fields need full width (textareas, rich text).
 *
 * - `"inline"` - Horizontal layout using flexbox. Fields sit side-by-side and wrap
 *   when space runs out. Best for compact groups of small fields (e.g., time range:
 *   start + end, or address: city + zip).
 *
 * - `"grid"` - CSS Grid layout with configurable columns. Fields are evenly distributed.
 *   Best for forms with many similar-sized fields. Use `columns` prop to control
 *   column count (default: 2). Responsive breakpoints adjust columns automatically.
 */
export type ObjectFieldLayout = "stack" | "inline" | "grid";

/**
 * Object field wrapper options - controls the container's visual appearance and behavior.
 *
 * @example Visual comparison:
 * ```
 * ┌─────────────────────────────────────────────────────────────┐
 * │ "flat" (default)                                            │
 * │                                                             │
 * │ No visual container - fields render directly.               │
 * │ Use when parent already provides structure (e.g., inside    │
 * │ a card, section, or another collapsible).                   │
 * │                                                             │
 * │ ┌─────────────────────────┐                                 │
 * │ │ Field 1                 │                                 │
 * │ └─────────────────────────┘                                 │
 * │ ┌─────────────────────────┐                                 │
 * │ │ Field 2                 │                                 │
 * │ └─────────────────────────┘                                 │
 * └─────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │ "collapsible"                                               │
 * │                                                             │
 * │ ┌─────────────────────────────────────────────────────────┐ │
 * │ │ ▶ Section Label                              [expand]   │ │
 * │ └─────────────────────────────────────────────────────────┘ │
 * │                                                             │
 * │ When expanded:                                              │
 * │ ┌─────────────────────────────────────────────────────────┐ │
 * │ │ ▼ Section Label                            [collapse]   │ │
 * │ ├─────────────────────────────────────────────────────────┤ │
 * │ │ ┌─────────────────────────┐                             │ │
 * │ │ │ Field 1                 │                             │ │
 * │ │ └─────────────────────────┘                             │ │
 * │ │ ┌─────────────────────────┐                             │ │
 * │ │ │ Field 2                 │                             │ │
 * │ │ └─────────────────────────┘                             │ │
 * │ └─────────────────────────────────────────────────────────┘ │
 * │                                                             │
 * │ Accordion-style with subtle background. Use for optional    │
 * │ or advanced sections to reduce visual clutter.              │
 * └─────────────────────────────────────────────────────────────┘
 * ```
 *
 * - `"flat"` - No visual container. Fields render directly without any wrapper styling.
 *   Use when the parent element already provides visual structure.
 *
 * - `"collapsible"` - Accordion-style container with click-to-expand header.
 *   Has subtle background styling. Use `defaultCollapsed` to control initial state.
 *   Requires a `label` prop for the header text.
 */
export type ObjectFieldWrapper = "flat" | "collapsible";

/**
 * Object field config - for nested JSON structures.
 *
 * Combines `wrapper` (container behavior) with `layout` (field arrangement)
 * to create flexible nested field groups.
 *
 * @example Collapsible section with grid layout
 * ```ts
 * address: r.object({
 *   label: "Shipping Address",
 *   wrapper: "collapsible",    // Accordion-style expandable section
 *   layout: "grid",            // Fields in 2-column grid
 *   columns: 2,
 *   defaultCollapsed: false,
 *   fields: ({ r }) => ({
 *     street: r.text({ label: "Street" }),
 *     city: r.text({ label: "City" }),
 *     zip: r.text({ label: "ZIP Code" }),
 *     country: r.text({ label: "Country" }),
 *   }),
 * })
 * ```
 *
 * @example Inline layout for compact field groups
 * ```ts
 * timeRange: r.object({
 *   label: "Working Hours",
 *   layout: "inline",          // Fields side-by-side
 *   fields: ({ r }) => ({
 *     start: r.text({ label: "From", placeholder: "09:00" }),
 *     end: r.text({ label: "To", placeholder: "17:00" }),
 *   }),
 * })
 * ```
 *
 * @example Flat wrapper (no container) - for use inside sections
 * ```ts
 * seoSettings: r.object({
 *   // No label, no wrapper - parent section handles structure
 *   wrapper: "flat",
 *   layout: "stack",
 *   fields: ({ r }) => ({
 *     metaTitle: r.text({ label: "Meta Title" }),
 *     metaDescription: r.textarea({ label: "Meta Description" }),
 *   }),
 * })
 * ```
 */
export type ObjectFieldConfig = {
	/**
	 * Nested field definitions.
	 * Callback receives field registry for creating nested fields.
	 *
	 * The `r` parameter type is automatically inferred from your field registry
	 * when using the builder (e.g., `builder.collection(...).fields(({ r }) => ...)`).
	 * This provides full autocomplete for nested object/array fields.
	 */
	fields?: (ctx: { r: any }) => NestedFieldsDefinition;
	/**
	 * Wrapper mode for the container.
	 * Controls visual appearance and expand/collapse behavior.
	 *
	 * @default "flat"
	 * @see ObjectFieldWrapper for detailed visual examples
	 */
	wrapper?: ObjectFieldWrapper;
	/**
	 * Layout mode for nested fields inside the container.
	 * Controls how fields are arranged spatially.
	 *
	 * @default "stack"
	 * @see ObjectFieldLayout for detailed visual examples
	 */
	layout?: ObjectFieldLayout;
	/**
	 * Number of columns for grid layout.
	 * Only applies when `layout: "grid"`.
	 * Responsive: automatically reduces columns on smaller screens.
	 *
	 * @default 2
	 */
	columns?: number;
	/**
	 * Default collapsed state for collapsible wrapper.
	 * Only applies when `wrapper: "collapsible"`.
	 *
	 * @default true
	 */
	defaultCollapsed?: boolean;
};

// ============================================================================
// Array Field Config (Extended for Objects)
// ============================================================================

/**
 * Primitive item types supported by array field
 */
export type ArrayItemType = "text" | "number" | "email" | "textarea" | "select";

/**
 * Array field config - for arrays of primitives or objects.
 *
 * @example Object array with inline layout
 * ```ts
 * socialLinks: r.array({
 *   label: "Social Links",
 *   mode: "inline",           // Edit fields directly in list
 *   layout: "inline",         // Fields side-by-side within each item
 *   orderable: true,
 *   item: ({ r }) => ({
 *     platform: r.select({ label: "Platform", options: [...] }),
 *     url: r.text({ label: "URL" }),
 *   }),
 * })
 * ```
 *
 * @example Object array with drawer editing and grid layout
 * ```ts
 * teamMembers: r.array({
 *   label: "Team Members",
 *   mode: "drawer",           // Edit in side panel
 *   layout: "grid",           // Fields in grid inside drawer
 *   columns: 2,
 *   itemLabel: (item) => item.name || "New Member",
 *   item: ({ r }) => ({
 *     name: r.text({ label: "Name" }),
 *     role: r.text({ label: "Role" }),
 *     email: r.text({ label: "Email" }),
 *     phone: r.text({ label: "Phone" }),
 *     bio: r.textarea({ label: "Bio" }),
 *   }),
 * })
 * ```
 *
 * @example Primitive array (simple tags)
 * ```ts
 * tags: r.array({
 *   label: "Tags",
 *   itemType: "text",
 *   orderable: true,
 *   maxItems: 10,
 * })
 * ```
 */
export type ArrayFieldConfig = {
	// === Primitive array options ===
	/**
	 * Item type for primitive arrays (without `item` callback).
	 * Each array element is a single value of this type.
	 */
	itemType?: ArrayItemType;
	/** Options for select-type items */
	options?: SelectOption[];

	// === Object array options ===
	/**
	 * Item field definitions for object arrays.
	 * When provided, each array element is an object with these fields.
	 * Mutually exclusive with `itemType`.
	 *
	 * The `r` parameter type is automatically inferred from your field registry
	 * when using the builder. This provides full autocomplete for array item fields.
	 */
	item?: (ctx: { r: any }) => NestedFieldsDefinition;
	/**
	 * Display mode - controls WHERE fields are edited.
	 * Only applies to object arrays (when `item` is provided).
	 *
	 * @default "inline"
	 * @see ArrayFieldMode for detailed visual examples
	 */
	mode?: "inline" | "modal" | "drawer";
	/**
	 * Layout for fields inside each item - controls HOW fields are arranged.
	 * Only applies to object arrays (when `item` is provided).
	 *
	 * @default "stack"
	 * @see ObjectFieldLayout for detailed visual examples
	 */
	layout?: ObjectFieldLayout;
	/**
	 * Number of columns for grid layout.
	 * Only applies when `layout: "grid"`.
	 *
	 * @default 2
	 */
	columns?: number;
	/**
	 * Label displayed in the item header.
	 * - String: Static label for all items
	 * - Function: Dynamic label based on item data (e.g., `(item) => item.name`)
	 *
	 * Falls back to checking `item.name`, `item.title`, `item.label`,
	 * then "Item {index}".
	 */
	itemLabel?: string | ((item: any, index: number) => string);

	// === Common options ===
	/** Enable drag-and-drop reordering */
	orderable?: boolean;
	/** Minimum number of items required */
	minItems?: number;
	/** Maximum number of items allowed */
	maxItems?: number;
};

// ============================================================================
// Rich Text Field Config
// ============================================================================

/**
 * Rich text feature toggles
 */
export type RichTextFeatures = {
	toolbar?: boolean;
	bubbleMenu?: boolean;
	slashCommands?: boolean;
	history?: boolean;
	heading?: boolean;
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	strike?: boolean;
	code?: boolean;
	codeBlock?: boolean;
	blockquote?: boolean;
	bulletList?: boolean;
	orderedList?: boolean;
	horizontalRule?: boolean;
	align?: boolean;
	link?: boolean;
	image?: boolean;
	table?: boolean;
	tableControls?: boolean;
	characterCount?: boolean;
};

/**
 * Rich text field config
 *
 * @example
 * ```ts
 * content: r.richText({
 *   features: {
 *     image: true,
 *     table: true,
 *   },
 * })
 * ```
 */
export type RichTextFieldConfig = {
	/** Feature toggles */
	features?: RichTextFeatures;
	/** Show character count */
	showCharacterCount?: boolean;
	/** Max character limit */
	maxCharacters?: number;
	/** Enable image uploads */
	enableImages?: boolean;
	/** Target collection for image uploads */
	imageCollection?: string;
	/** Enable media library picker for images */
	enableMediaLibrary?: boolean;
};
