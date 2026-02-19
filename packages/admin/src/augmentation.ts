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
 * @example Reactive field states:
 * ```ts
 * f.text({
 *   label: "Slug",
 *   meta: {
 *     admin: {
 *       // Reactive compute - auto-generate slug from title
 *       compute: ({ data }) => slugify(data.title),
 *
 *       // Reactive hidden - show only when advanced mode is on
 *       hidden: ({ data }) => !data.showAdvanced,
 *
 *       // Reactive readOnly - lock after published
 *       readOnly: ({ data }) => data.status === 'published',
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

import type { ReactiveConfig } from "questpie";

// ============================================================================
// Shared Admin Options (common across field types)
// ============================================================================

/**
 * Common admin options shared by all fields.
 * Each field-specific admin meta extends this.
 *
 * Supports reactive configurations for dynamic field states:
 * - `hidden`, `readOnly`, `disabled` can be boolean or reactive function
 * - `compute` can auto-generate field values based on other fields
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
	 * Hide the field conditionally.
	 * - `true`: Always hidden
	 * - Function/config: Evaluated on server based on form data
	 *
	 * @example Static
	 * ```ts
	 * hidden: true
	 * ```
	 *
	 * @example Reactive (short syntax)
	 * ```ts
	 * hidden: ({ data }) => !data.showAdvanced
	 * ```
	 *
	 * @example Reactive (full syntax with deps)
	 * ```ts
	 * hidden: {
	 *   handler: ({ data }) => !data.showAdvanced,
	 *   deps: ['showAdvanced'],
	 * }
	 * ```
	 */
	hidden?: boolean | ReactiveConfig<boolean>;

	/**
	 * Make field read-only conditionally.
	 * - `true`: Always read-only
	 * - Function/config: Evaluated on server based on form data
	 *
	 * @example Reactive
	 * ```ts
	 * readOnly: ({ data }) => data.status === 'published'
	 * ```
	 */
	readOnly?: boolean | ReactiveConfig<boolean>;

	/**
	 * Disable the field conditionally.
	 * - `true`: Always disabled
	 * - Function/config: Evaluated on server based on form data
	 *
	 * @example Reactive
	 * ```ts
	 * disabled: ({ data }) => data.isLocked
	 * ```
	 */
	disabled?: boolean | ReactiveConfig<boolean>;

	/**
	 * Compute field value automatically based on other fields.
	 * Handler should return the computed value or undefined to keep current.
	 * Return null to reset field to null/default.
	 *
	 * @example Auto-generate slug from title
	 * ```ts
	 * compute: ({ data }) => slugify(data.title)
	 * ```
	 *
	 * @example With debounce and explicit deps
	 * ```ts
	 * compute: {
	 *   handler: ({ data }) => slugify(data.title),
	 *   deps: ['title'],
	 *   debounce: 300,
	 * }
	 * ```
	 *
	 * @example Reset on parent change
	 * ```ts
	 * compute: ({ data, prev }) => {
	 *   if (data.category !== prev.data.category) {
	 *     return null; // Reset when category changes
	 *   }
	 * }
	 * ```
	 */
	compute?: ReactiveConfig<any>;

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
	/**
	 * List table cell rendering for relation values.
	 * - "chip": default text chip
	 * - "avatarChip": chip with avatar image + label
	 */
	listCell?: {
		display?: "chip" | "avatarChip";
		/** Dot-path on related record (e.g. "image" or "avatar.url") */
		avatarField?: string;
		/** Dot-path for display label override (e.g. "fullName") */
		labelField?: string;
	};
}

/**
 * Object field admin options
 */
export interface ObjectFieldAdminMeta extends BaseAdminMeta {
	/** Visual wrapper mode */
	wrapper?: "flat" | "collapsible";
	/** Field arrangement mode */
	layout?: "stack" | "inline" | "grid";
	/** Number of columns (for grid layout) */
	columns?: number;
	/** Default collapsed state (for collapsible wrapper) */
	defaultCollapsed?: boolean;
}

/**
 * Array field admin options
 */
export interface ArrayFieldAdminMeta extends BaseAdminMeta {
	/** Enable drag-and-drop reordering */
	orderable?: boolean;
	/** Minimum number of items */
	minItems?: number;
	/** Maximum number of items */
	maxItems?: number;
	/** Item editing mode */
	mode?: "inline" | "modal" | "drawer";
	/** Field arrangement mode for items */
	layout?: "stack" | "inline" | "grid";
	/** Number of columns (for grid layout) */
	columns?: number;
	/** Label for array items */
	itemLabel?: string;
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
	/** Accepted file types */
	accept?: string | string[];
	/** Dropzone placeholder text */
	dropzoneText?: string;
	/** Show file preview */
	showPreview?: boolean;
	/** Allow editing uploaded files */
	editable?: boolean;
	/** Preview display variant */
	previewVariant?: "card" | "compact" | "thumbnail";
	/** Allow multiple file uploads */
	multiple?: boolean;
	/** Maximum number of files */
	maxItems?: number;
	/** Enable drag-and-drop reordering */
	orderable?: boolean;
	/** Layout for multiple files */
	layout?: "grid" | "list";
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
 *     myCustomWidget: { loader: (client: any) => Promise<MyData> };
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

// ============================================================================
// Field Meta Augmentation
// ============================================================================
// Add `admin` property to all questpie field meta interfaces.

declare module "questpie" {
	interface TextFieldMeta {
		admin?: TextFieldAdminMeta;
	}
	interface EmailFieldMeta {
		admin?: EmailFieldAdminMeta;
	}
	interface UrlFieldMeta {
		admin?: UrlFieldAdminMeta;
	}
	interface TextareaFieldMeta {
		admin?: TextareaFieldAdminMeta;
	}
	interface NumberFieldMeta {
		admin?: NumberFieldAdminMeta;
	}
	interface BooleanFieldMeta {
		admin?: BooleanFieldAdminMeta;
	}
	interface DateFieldMeta {
		admin?: DateFieldAdminMeta;
	}
	interface DatetimeFieldMeta {
		admin?: DateFieldAdminMeta;
	}
	interface TimeFieldMeta {
		admin?: TimeFieldAdminMeta;
	}
	interface SelectFieldMeta {
		admin?: SelectFieldAdminMeta;
	}
	interface RelationFieldMeta {
		admin?: RelationFieldAdminMeta;
	}
	interface ObjectFieldMeta {
		admin?: ObjectFieldAdminMeta;
	}
	interface ArrayFieldMeta {
		admin?: ArrayFieldAdminMeta;
	}
	interface JsonFieldMeta {
		admin?: JsonFieldAdminMeta;
	}
	interface UploadFieldMeta {
		admin?: UploadFieldAdminMeta;
	}
}

declare module "@questpie/admin/server" {
	interface RichTextFieldMeta {
		admin?: RichTextFieldAdminMeta;
	}
	interface BlocksFieldMeta {
		admin?: BlocksFieldAdminMeta;
	}
}
