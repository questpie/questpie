/**
 * Admin Field Meta Types
 *
 * These types define UI options for admin field rendering.
 * They are used by the admin package to configure field appearance and behavior.
 *
 * @example Usage in field definition (server-side):
 * ```ts
 * f.text(255).label("Title").admin({
 *   placeholder: "Enter title...",
 *   showCounter: true,
 * })
 * ```
 *
 * @example Reactive field states:
 * ```ts
 * f.text(255).label("Slug").admin({
 *   // Reactive compute - auto-generate slug from title
 *   compute: ({ data }) => slugify(data.title),
 *
 *   // Reactive hidden - show only when advanced mode is on
 *   hidden: ({ data }) => !data.showAdvanced,
 *
 *   // Reactive readOnly - lock after published
 *   readOnly: ({ data }) => data.status === 'published',
 * })
 * ```
 *
 * Type-safety for `meta.admin` is automatic — importing anything
 * from `@questpie/admin` (server or client) pulls in this file,
 * which declares `interface TextFieldMeta { admin?: TextFieldAdminMeta }`
 * (and the equivalents for every field kind) on the
 * `Questpie` namespace. Projects don't need to author their own
 * `declare module "questpie"` augmentation.
 */

import type { ReactiveConfig } from "questpie";

import type { ComponentReference } from "./server/augmentation/common.js";

// ============================================================================
// Visual Edit Workspace contract
// ============================================================================

/**
 * Patch strategy for a field inside the Visual Edit Workspace.
 *
 * - `"patch"` (default for scalar/object fields): mutate the
 *   preview's local draft via `PATCH_BATCH` so edits land
 *   without re-running the loader.
 * - `"refresh"` (default for relations, uploads, blocks, and
 *   fields with a server-side `compute` handler): emit
 *   `PREVIEW_REFRESH` after the controller commits — the loader
 *   picks up the new value. Set explicitly on slug-style fields
 *   whose value is server-derived.
 * - `"deferred"`: don't propagate live; rely on `COMMIT` after
 *   the user saves. Useful for fields that are only meaningful
 *   at the database level (e.g. cron expressions).
 */
export type VisualEditPatchStrategy = "patch" | "refresh" | "deferred";

/**
 * Optional Visual Edit Workspace metadata for a field.
 *
 * Plugins and projects can override how a field shows up inside
 * the workspace's right-pane inspector — the legacy form view is
 * unaffected. All keys are optional; the workspace falls back to
 * the field's existing component when nothing is configured.
 *
 * @example
 * ```ts
 * .fields(({ f, c }) => ({
 *   body: f.richText().set("admin", {
 *     visualEdit: {
 *       inspector: c.component("rich-text-inspector"),
 *       patchStrategy: "patch",
 *       hidden: ({ data }) => !data.published,
 *     },
 *   }),
 * }));
 * ```
 */
export interface VisualEditFieldMeta {
	/**
	 * Component reference rendered inside the inspector instead of
	 * the default field component.
	 *
	 * The override receives:
	 *
	 * - `fieldName` — the resolved top-level field name
	 * - `fieldPath` — the full selection path (e.g. `meta.seo.title`,
	 *   `items.0.label`); use this when the override needs to read or
	 *   write a deeply-nested value via `useFormContext()`
	 * - `collection` — the active collection name
	 * - `fieldDef` — the same `FieldInstance` `FieldRenderer` would receive
	 * - `registry` — optional component registry override
	 * - `allCollectionsConfig` — passed through for embedded fields
	 *
	 * The override is rendered inside `FormProvider`, so any RHF hook
	 * (`useFormContext`, `useWatch`, `useController`, …) works
	 * directly. If the registered component type isn't found in the
	 * admin registry, the workspace falls back to the default
	 * `FieldRenderer` so the field stays editable.
	 */
	inspector?: ComponentReference;

	/**
	 * How the workspace should propagate this field's changes to
	 * the preview iframe. Defaults are kind-aware:
	 * - scalar fields → `"patch"`
	 * - relation/upload/blocks → `"refresh"`
	 * - fields with a server `compute` handler → `"refresh"`
	 *
	 * Set explicitly to override or to mark a field as deferred.
	 * Slug-style fields with server-derived values should opt
	 * into `"refresh"` themselves.
	 */
	patchStrategy?: VisualEditPatchStrategy;

	/**
	 * Hide the field from the document inspector body. Click
	 * targets in the canvas still work — useful for read-only
	 * fields that are only inspected via the preview.
	 */
	hidden?: boolean | ReactiveConfig<boolean>;

	/**
	 * Pin the field to a specific group in the Document inspector
	 * panel — overrides the shared `group` on `BaseAdminMeta` for
	 * the workspace only. Useful when you want different grouping
	 * in the workspace vs. the legacy form layout.
	 */
	group?: string;

	/**
	 * Display order inside the resolved group. Lower values come
	 * first; ties fall back to declaration order.
	 */
	order?: number;
}

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

	/**
	 * Optional Visual Edit Workspace metadata. Lets a field opt
	 * into a custom inspector component, override the default
	 * patch strategy, or pin itself to a specific document group
	 * — all without touching the legacy form view.
	 *
	 * Defaults to `undefined`: the workspace renders the field's
	 * existing component with `patchStrategy = "patch"` for
	 * scalars and `"refresh"` for relations/uploads/blocks.
	 *
	 * @see VisualEditFieldMeta
	 */
	visualEdit?: VisualEditFieldMeta;
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
	 * Restrict which related records can be picked. Static `Record` is used
	 * as-is; a function or `{ handler, deps?, debounce? }` config stays on
	 * the server (introspection emits a `ReactivePropPlaceholder`) and is
	 * resolved on demand via `/admin/reactive` against current form data.
	 *
	 * @example Static
	 * ```ts
	 * f.relation("users").admin({ filter: { role: "admin" } })
	 * ```
	 *
	 * @example Reactive — depends on form state
	 * ```ts
	 * f.relation("users").admin({
	 *   filter: ({ data }) => ({ role: "admin", team: data.team }),
	 * })
	 * ```
	 */
	filter?:
		| Record<string, unknown>
		| ((ctx: {
				data: Record<string, unknown>;
				sibling: Record<string, unknown>;
				prev: { data: Record<string, unknown>; sibling: Record<string, unknown> };
				ctx: unknown;
			}) => Record<string, unknown> | Promise<Record<string, unknown>>)
		| {
				handler: (ctx: {
					data: Record<string, unknown>;
					sibling: Record<string, unknown>;
					prev: { data: Record<string, unknown>; sibling: Record<string, unknown> };
					ctx: unknown;
				}) => Record<string, unknown> | Promise<Record<string, unknown>>;
				deps?: string[];
				debounce?: number;
			};
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

declare global {
	namespace Questpie {
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
}

declare module "./server/fields/rich-text.js" {
	interface RichTextFieldMeta {
		admin?: RichTextFieldAdminMeta;
	}
}

declare module "./server/fields/blocks.js" {
	interface BlocksFieldMeta {
		admin?: BlocksFieldAdminMeta;
	}
}
