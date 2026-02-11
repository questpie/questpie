/**
 * Field Component Types
 *
 * Types for field components, form views, and field configuration.
 */

import type { z } from "zod";
import type { ComponentReference } from "#questpie/admin/server";
import type { I18nText } from "../../i18n/types.js";
import type { ActionDefinition } from "./action-types";
import type {
	BaseFieldProps,
	DynamicI18nText,
	IconComponent,
	MaybeLazyComponent,
} from "./common";

// ============================================================================
// Validation Configuration
// ============================================================================

/**
 * Validation configuration for fields
 *
 * These options are used to generate Zod schemas for client-side validation.
 */
export interface FieldValidationConfig {
	/**
	 * Minimum length for strings
	 */
	minLength?: number;

	/**
	 * Maximum length for strings
	 */
	maxLength?: number;

	/**
	 * Minimum value for numbers
	 */
	min?: number;

	/**
	 * Maximum value for numbers
	 */
	max?: number;

	/**
	 * Regex pattern for strings
	 */
	pattern?: RegExp | string;

	/**
	 * Custom error message for pattern validation
	 */
	patternMessage?: string;

	/**
	 * Email validation (for text fields)
	 */
	email?: boolean;

	/**
	 * URL validation (for text fields)
	 */
	url?: boolean;

	/**
	 * Custom validation function
	 * @returns Error message if invalid, undefined if valid
	 */
	validate?: (
		value: any,
		formValues: Record<string, any>,
	) => string | undefined;

	/**
	 * Custom Zod refinement
	 */
	refine?: (schema: z.ZodTypeAny) => z.ZodTypeAny;
}

// ============================================================================
// Field Component Props
// ============================================================================

/**
 * Props passed to field components
 *
 * @typeParam TValue - Type of the field value
 */
export interface FieldComponentProps<TValue = any> extends BaseFieldProps {
	/**
	 * Field value (typed)
	 */
	value: TValue;

	/**
	 * Change handler (typed)
	 * Optional to support read-only/preview modes
	 */
	onChange?: (value: TValue) => void;

	/**
	 * Field configuration options
	 */
	config?: FieldUIConfig;
}

/**
 * Props for embedded collection fields
 */
export interface EmbeddedCollectionProps extends BaseFieldProps {
	/**
	 * Target collection name
	 */
	collection: string;

	/**
	 * Display mode
	 */
	mode?: "inline" | "modal" | "drawer";

	/**
	 * Whether items can be reordered
	 */
	orderable?: boolean;

	/**
	 * Function to generate row labels
	 */
	rowLabel?: (item: any) => string;
}

// ============================================================================
// Field Hooks Context
// ============================================================================

/**
 * Context provided to field hooks (onChange, etc.)
 */
export interface FieldHookContext {
	/**
	 * Set value of any field in the form
	 */
	setValue: (name: string, value: any) => void;

	/**
	 * Get current values of all fields
	 */
	getValues: () => Record<string, any>;

	/**
	 * Get value of a specific field
	 */
	getValue: (name: string) => any;

	/**
	 * Current field name
	 */
	fieldName: string;

	/**
	 * Current locale (for localized fields)
	 */
	locale?: string;
}

// ============================================================================
// Field UI Configuration
// ============================================================================

/**
 * Field UI configuration (per-field overrides in collection config)
 */
export interface FieldUIConfig {
	/**
	 * Display label
	 */
	label?: DynamicI18nText;

	/**
	 * Description text
	 */
	description?: DynamicI18nText;

	/**
	 * Placeholder text
	 */
	placeholder?: DynamicI18nText;

	/**
	 * Field type override
	 */
	type?: string;

	/**
	 * Whether field is required
	 */
	required?: boolean | ((values: Record<string, any>) => boolean);

	/**
	 * Whether field is read-only
	 */
	readOnly?: boolean | ((values: Record<string, any>) => boolean);

	/**
	 * Whether field is disabled (grayed out, can be dynamic)
	 */
	disabled?: boolean | ((values: Record<string, any>) => boolean);

	/**
	 * Whether field is hidden (can be dynamic based on form values).
	 * Hidden fields are not rendered. Default is false (visible).
	 *
	 * Note: undefined/false = visible, true = hidden.
	 * This follows JavaScript falsy semantics for better DX.
	 */
	hidden?: boolean | ((values: Record<string, any>) => boolean);

	/**
	 * Whether field is localized
	 */
	localized?: boolean;

	/**
	 * Validation configuration for client-side validation
	 */
	validation?: FieldValidationConfig;

	/**
	 * Custom field component
	 */
	component?: MaybeLazyComponent<FieldComponentProps>;

	/**
	 * Additional options for field type
	 */
	options?: SelectOption[] | ((values: Record<string, any>) => SelectOption[]);

	/**
	 * Relation configuration
	 */
	relation?: RelationFieldConfig;

	/**
	 * Embedded collection configuration
	 */
	embedded?: EmbeddedFieldConfig;

	/**
	 * Rich text configuration
	 */
	richText?: RichTextConfig;

	/**
	 * Array field configuration
	 */
	array?: ArrayFieldConfig;

	// ========================================================================
	// Field Hooks
	// ========================================================================

	/**
	 * Compute field value from other fields (proxy-tracked dependencies).
	 * Makes the field read-only and virtual (not submitted to backend).
	 *
	 * Dependencies are automatically detected via Proxy tracking.
	 * Works in both forms (reactive) and tables (static).
	 *
	 * @example
	 * ```ts
	 * pricePerMinute: r.number({
	 *   label: "Price/Minute",
	 *   compute: (values) => values.price / values.duration,
	 * })
	 *
	 * fullName: r.text({
	 *   compute: (values) => `${values.firstName} ${values.lastName}`,
	 * })
	 * ```
	 */
	compute?: (values: Record<string, any>) => any;

	/**
	 * Called when field value changes.
	 * Use for side effects like updating other fields.
	 * Can be async for API calls.
	 *
	 * @example
	 * ```ts
	 * onChange: async (value, { setValue }) => {
	 *   // Auto-generate slug from title
	 *   setValue('slug', slugify(value));
	 * }
	 * ```
	 */
	onChange?: (value: any, ctx: FieldHookContext) => void | Promise<void>;

	/**
	 * Dynamic default value for new records.
	 * Can be a static value, sync function, or async function.
	 * Only evaluated when creating new records (not on edit).
	 *
	 * @example
	 * ```ts
	 * // Static
	 * defaultValue: "draft"
	 *
	 * // Based on other fields
	 * defaultValue: (values) => values.type === "post" ? "draft" : "published"
	 *
	 * // Async (fetch from API)
	 * defaultValue: async (values) => {
	 *   const settings = await fetchSettings();
	 *   return settings.defaultStatus;
	 * }
	 * ```
	 */
	defaultValue?:
		| any
		| ((values: Record<string, any>) => any)
		| ((values: Record<string, any>) => Promise<any>);

	/**
	 * Async options loader for select-type fields.
	 * Dependencies are automatically detected via Proxy tracking.
	 *
	 * @example
	 * ```ts
	 * subcategory: r.select({
	 *   loadOptions: async (values) => {
	 *     // Automatically re-fetches when values.category changes
	 *     return fetchSubcategories(values.category);
	 *   },
	 * })
	 * ```
	 */
	loadOptions?: (values: Record<string, any>) => Promise<SelectOption[]>;
}

/**
 * Select field option
 */
export interface SelectOption {
	label: I18nText;
	value: string | number | boolean;
	disabled?: boolean;
}

/**
 * Relation field configuration
 */
export interface RelationFieldConfig {
	/**
	 * Target collection name
	 */
	targetCollection: string;

	/**
	 * Display mode
	 */
	mode?: "inline" | "picker" | "create";

	/**
	 * Whether multiple items can be selected
	 */
	multiple?: boolean;

	/**
	 * Whether items can be reordered
	 */
	orderable?: boolean;

	/**
	 * Filter for relation options
	 */
	filter?: (values: Record<string, any>) => Record<string, any>;
}

/**
 * Embedded collection configuration
 */
export interface EmbeddedFieldConfig {
	/**
	 * Target collection name
	 */
	collection: string;

	/**
	 * Display mode
	 */
	mode?: "inline" | "modal" | "drawer";

	/**
	 * Whether items can be reordered
	 */
	orderable?: boolean;

	/**
	 * Function to generate row labels
	 */
	rowLabel?: (item: any) => string;
}

/**
 * Rich text editor configuration
 */
export interface RichTextConfig {
	/**
	 * Enable image uploads
	 */
	enableImages?: boolean;

	/**
	 * Show character count
	 */
	showCharacterCount?: boolean;

	/**
	 * Maximum characters
	 */
	maxCharacters?: number;

	/**
	 * Feature toggles
	 */
	features?: {
		slashCommands?: boolean;
		tableControls?: boolean;
		bubbleMenu?: boolean;
	};

	/**
	 * Image upload handler
	 */
	onImageUpload?: (file: File) => Promise<string>;
}

/**
 * Array field configuration
 */
export interface ArrayFieldConfig {
	/**
	 * Placeholder text for items
	 */
	placeholder?: string;

	/**
	 * Type of items in array
	 */
	itemType?: string;

	/**
	 * Options for select-type items
	 */
	options?: SelectOption[];

	/**
	 * Whether items can be reordered
	 */
	orderable?: boolean;

	/**
	 * Minimum items
	 */
	minItems?: number;

	/**
	 * Maximum items
	 */
	maxItems?: number;
}

// ============================================================================
// Field Layout Configuration - Mirrors Object Field API
// ============================================================================

/**
 * Layout mode - controls spatial arrangement of fields
 * Mirrors ObjectFieldLayout from field components
 *
 * - `"stack"` - Vertical layout, each field on its own line
 * - `"inline"` - Horizontal flexbox, fields side-by-side with wrapping
 * - `"grid"` - CSS Grid with configurable columns
 *
 * @see ObjectFieldLayout in field-types.ts for detailed visual examples
 */
export type LayoutMode = "stack" | "inline" | "grid";

/**
 * Wrapper mode - controls container visual appearance
 * Mirrors ObjectFieldWrapper from field components
 *
 * - `"flat"` - No visual container, fields render directly
 * - `"collapsible"` - Accordion-style expandable container
 *
 * @see ObjectFieldWrapper in field-types.ts for detailed visual examples
 */
export type WrapperMode = "flat" | "collapsible";

/**
 * Section layout - universal container for grouping fields
 *
 * Mirrors object field API exactly:
 * - wrapper: visual container style (flat | collapsible)
 * - layout: field arrangement (stack | inline | grid)
 * - columns: for grid layout
 * - defaultCollapsed: for collapsible wrapper
 *
 * @example Simple section with label
 * ```ts
 * {
 *   type: 'section',
 *   label: 'Contact Information',
 *   fields: [f.name, f.email, f.phone]
 * }
 * ```
 *
 * @example Grid layout (acts as "row")
 * ```ts
 * {
 *   type: 'section',
 *   layout: 'grid',
 *   columns: 2,
 *   fields: [f.firstName, f.lastName]
 * }
 * ```
 *
 * @example Collapsible section
 * ```ts
 * {
 *   type: 'section',
 *   label: 'Advanced Settings',
 *   wrapper: 'collapsible',
 *   defaultCollapsed: true,
 *   fields: [f.apiKey, f.webhookUrl]
 * }
 * ```
 *
 * @example Collapsible + Grid
 * ```ts
 * {
 *   type: 'section',
 *   label: 'Address',
 *   wrapper: 'collapsible',
 *   layout: 'grid',
 *   columns: 2,
 *   fields: [f.street, f.city, f.zip, f.country]
 * }
 * ```
 */
export interface SectionLayout<TData = any> {
	type: "section";

	// Visual grouping
	label?: DynamicI18nText;
	description?: DynamicI18nText;

	// Wrapper (mirrors object field)
	wrapper?: WrapperMode;
	defaultCollapsed?: boolean;

	// Layout (mirrors object field)
	layout?: LayoutMode;
	columns?: number;
	gap?: number;

	// Content
	fields: FieldLayoutItem<TData>[];

	// Conditional visibility (hidden: false/undefined = visible, true = hidden)
	hidden?: boolean | ((values: Record<string, any>) => boolean);

	// Custom styling
	className?: string;
}

/**
 * Tab configuration for tabbed forms
 */
export interface TabConfig<TData = any> {
	id: string;
	label: DynamicI18nText;
	icon?: IconComponent | ComponentReference;
	fields: FieldLayoutItem<TData>[];
	// Conditional visibility (hidden: false/undefined = visible, true = hidden)
	hidden?: boolean | ((values: Record<string, any>) => boolean);
}

/**
 * Tabs layout container for tabbed forms.
 */
export interface TabsLayout<TData = any> {
	type: "tabs";
	tabs: TabConfig<TData>[];
}

/**
 * Context passed to reactive handlers.
 */
export interface FieldReactiveContext<TData = any> {
	data: TData;
	sibling: Record<string, any>;
	ctx?: Record<string, any>;
	prev?: {
		data: TData;
		sibling: Record<string, any>;
	};
}

/**
 * Reactive handler config (short function form or object form).
 */
export type FieldReactiveHandlerConfig<TData = any, TReturn = any> =
	| ((ctx: FieldReactiveContext<TData>) => TReturn | Promise<TReturn>)
	| {
			handler: (ctx: FieldReactiveContext<TData>) => TReturn | Promise<TReturn>;
			deps?: string[] | ((ctx: { data: TData }) => any[]);
			debounce?: number;
	  };

/**
 * Serialized reactive config from server introspection.
 */
export interface SerializedReactiveDepsConfig {
	deps: string[];
	debounce?: number;
}

/**
 * Reactive field config for form layout.
 * Handlers are executed server-side; deps tracked for client reactivity.
 */
export interface FieldReactiveConfig<TData = any> {
	/** Hide field conditionally */
	hidden?:
		| boolean
		| FieldReactiveHandlerConfig<TData, boolean>
		| SerializedReactiveDepsConfig;
	/** Make field read-only conditionally */
	readOnly?:
		| boolean
		| FieldReactiveHandlerConfig<TData, boolean>
		| SerializedReactiveDepsConfig;
	/** Disable field conditionally */
	disabled?:
		| boolean
		| FieldReactiveHandlerConfig<TData, boolean>
		| SerializedReactiveDepsConfig;
	/** Auto-compute field value */
	compute?:
		| FieldReactiveHandlerConfig<TData, any>
		| SerializedReactiveDepsConfig;
}

/**
 * Field layout item with optional reactive config
 */
export interface FieldLayoutItemWithReactive<TData = any>
	extends FieldReactiveConfig<TData> {
	field: string;
	className?: string;
}

/**
 * Field layout item - can be a simple field name, field with config, section, or tabs
 *
 * @example
 * ```ts
 * fields: [
 *   f.name,  // simple field reference
 *   { field: f.email, className: 'col-span-2' },  // with className
 *   { field: f.slug, compute: { handler: ({ data }) => slugify(data.name), deps: ['name'] } },  // with compute
 *   { field: f.reason, hidden: ({ data }) => data.status !== 'cancelled' },  // with hidden
 *   { type: 'section', layout: 'grid', columns: 2, fields: [...] },  // section
 *   { type: 'tabs', tabs: [...] }  // tabs
 * ]
 * ```
 */
export type FieldLayoutItem<TData = any> =
	| string
	| FieldLayoutItemWithReactive<TData>
	| SectionLayout<TData>
	| TabsLayout<TData>;

/**
 * Helper to check if item is a field reference (string or object with field)
 */
export function isFieldReference<TData = any>(
	item: FieldLayoutItem<TData>,
): item is string | FieldLayoutItemWithReactive<TData> {
	return typeof item === "string" || ("field" in item && !("type" in item));
}

/**
 * Helper to get field name from layout item
 */
export function getFieldName<TData = any>(
	item: FieldLayoutItem<TData>,
): string | null {
	if (typeof item === "string") return item;
	if ("field" in item && typeof item.field === "string") return item.field;
	return null;
}

/**
 * Helper to get className from field layout item
 */
export function getFieldClassName<TData = any>(
	item: FieldLayoutItem<TData>,
): string | undefined {
	return typeof item === "string"
		? undefined
		: "className" in item
			? item.className
			: undefined;
}

// ============================================================================
// Form View Configuration
// ============================================================================

/**
 * Form sidebar configuration
 * Uses `fields` array (same structure as main form)
 */
export interface FormSidebarConfig<TData = any> {
	position?: "left" | "right";
	fields: FieldLayoutItem<TData>[];
}

/**
 * Form view configuration
 * Uses `fields` array for main content
 *
 * @example
 * ```ts
 * .form(({ v, f }) => v.form({
 *   sidebar: {
 *     position: 'right',
 *     fields: [f.status, f.publishedAt]
 *   },
 *   fields: [
 *     { type: 'section', layout: 'grid', columns: 2, fields: [f.name, f.email] },
 *     { type: 'section', label: 'Content', fields: [f.body] }
 *   ]
 * }))
 * ```
 */
export interface FormViewConfig<TData = any> {
	fields: FieldLayoutItem<TData>[];
	sidebar?: FormSidebarConfig<TData>;
	actions?: FormViewActionsConfig;
}

/**
 * Actions configuration for form views
 *
 * @example
 * ```ts
 * actions: {
 *   primary: [a.action({ id: "publish", label: "Publish" })],  // Buttons next to Save
 *   secondary: [a.action({ id: "delete", label: "Delete" })],  // In dropdown menu (...)
 * }
 * ```
 */
export interface FormViewActionsConfig<TItem = any> {
	/** Actions shown as buttons (next to Save) */
	primary?: ActionDefinition<TItem>[];
	/** Actions shown in dropdown menu (...) */
	secondary?: ActionDefinition<TItem>[];
}

// ============================================================================
// Component Registry
// ============================================================================

/**
 * Registry for custom field and widget components
 */
export interface ComponentRegistry {
	/**
	 * Custom field components by type
	 */
	fields?: Record<string, MaybeLazyComponent<FieldComponentProps>>;

	/**
	 * Custom widget components by type
	 */
	widgets?: Record<string, MaybeLazyComponent<any>>;

	/**
	 * Custom named components (for component prop on fields)
	 */
	custom?: Record<string, MaybeLazyComponent<any>>;
}
