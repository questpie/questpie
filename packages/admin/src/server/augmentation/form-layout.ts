/**
 * Form View Layout Types
 *
 * Types for form view configuration: field layout items, sections,
 * tabs, sidebar, reactive config, and preview configuration.
 * Also includes collection and global admin config types.
 */

import type { I18nText } from "questpie/shared";

import type { AnyBlockBuilder } from "../modules/admin/block/index.js";
import type { ActionReference, ComponentReference } from "./common.js";

// ============================================================================
// Collection Admin Configuration
// ============================================================================

/**
 * Admin metadata for a collection.
 * Defines how the collection appears in the admin sidebar and UI.
 */
export interface AdminCollectionConfig {
	/** Display label for the collection */
	label?: I18nText;
	/** Description shown in tooltips/help text */
	description?: I18nText;
	/** Icon reference (resolved by client's icon component) */
	icon?: ComponentReference;
	/** Hide from admin sidebar */
	hidden?: boolean;
	/** Group in sidebar */
	group?: string;
	/** Order within group */
	order?: number;
	/**
	 * Whether this collection should be included in audit logging.
	 * Requires the audit module to be registered via `runtimeConfig({ modules: [auditModule] })`.
	 *
	 * - `true` or `undefined` (default): audited when audit module is active
	 * - `false`: never audited, even when audit module is active
	 */
	audit?: boolean;
}

/**
 * Block category configuration.
 * Defines how blocks are grouped in the block picker.
 */
export interface BlockCategoryConfig {
	/** Display label for the category */
	label: I18nText;
	/** Icon for the category */
	icon?: ComponentReference;
	/** Order in block picker (lower = first) */
	order?: number;
}

/**
 * Admin metadata for a block.
 * Defines how the block appears in the block picker and editor.
 *
 * @example
 * ```ts
 * block("hero")
 *   .admin(({ c }) => ({
 *     label: { en: "Hero Section", sk: "Hero sekcia" },
 *     icon: c.icon("ph:image"),
 *     category: {
 *       label: { en: "Sections", sk: "Sekcie" },
 *       icon: c.icon("ph:layout"),
 *     },
 *   }))
 * ```
 */
export interface AdminBlockConfig {
	/** Display label for the block */
	label?: I18nText;
	/** Description shown in tooltips/help text */
	description?: I18nText;
	/** Icon reference (resolved by client's icon component) */
	icon?: ComponentReference;
	/** Category for grouping in block picker */
	category?: BlockCategoryConfig;
	/** Order within category in block picker (lower = first) */
	order?: number;
	/** Hide from block picker (useful for deprecated blocks) */
	hidden?: boolean;
}

/**
 * List view configuration for a collection.
 * Defines columns, sorting, filtering, and actions.
 */
export interface ListViewConfig {
	/** View type to use (e.g., "table", "cards") */
	view?: string;
	/** Columns to display */
	columns?: string[];
	/** Default sort configuration */
	defaultSort?: { field: string; direction: "asc" | "desc" };
	/** Searchable fields */
	searchable?: string[];
	/** Filterable fields */
	filterable?: string[];
	/** Client-side grouping options for the current fetched page */
	grouping?: {
		/** Fields users can group by */
		fields: string[];
		/** Initial grouping field */
		defaultField?: string;
		/** Whether groups start collapsed */
		defaultCollapsed?: boolean;
		/** Show page-local item counts in group headers */
		showCounts?: boolean;
	};
	/** Actions configuration */
	actions?: {
		header?: { primary?: ActionReference[]; secondary?: ActionReference[] };
		row?: ActionReference[];
		bulk?: ActionReference[];
	};
}

// ============================================================================
// Form View Layout Types
// ============================================================================

/**
 * Context passed to form reactive handlers.
 */
export interface FormReactiveContext<TData = Record<string, unknown>> {
	data: TData;
	sibling: Record<string, unknown>;
	ctx: {
		db: any;
		user?: any;
		locale?: string;
	};
	prev?: {
		data: TData;
		sibling: Record<string, unknown>;
	};
}

/**
 * Reactive config for field-level form behavior.
 */
export type FormReactiveConfig<TData = any, TReturn = any> =
	| ((ctx: FormReactiveContext<TData>) => TReturn | Promise<TReturn>)
	| {
			handler: (ctx: FormReactiveContext<TData>) => TReturn | Promise<TReturn>;
			deps?: string[] | ((ctx: FormReactiveContext<TData>) => any[]);
			debounce?: number;
	  }
	| {
			deps: string[];
			debounce?: number;
	  };

/**
 * Section layout for form views.
 * Groups fields with optional visual wrapper and layout mode.
 *
 * @example
 * ```ts
 * {
 *   type: "section",
 *   label: { en: "Contact Information" },
 *   layout: "grid",
 *   columns: 2,
 *   fields: [f.name, f.email, f.phone],
 * }
 * ```
 */
export interface FormSectionLayout {
	type: "section";
	/** Section label */
	label?: I18nText;
	/** Section description */
	description?: I18nText;
	/** Visual wrapper mode */
	wrapper?: "flat" | "collapsible";
	/** Default collapsed state (for collapsible wrapper) */
	defaultCollapsed?: boolean;
	/** Field arrangement mode */
	layout?: "stack" | "inline" | "grid";
	/** Number of columns (for grid layout) */
	columns?: number;
	/** Custom gap (in quarter rems) */
	gap?: number;
	/** Fields in this section */
	fields: FieldLayoutItem[];
	/** Conditional visibility */
	hidden?: boolean;
	/** Custom CSS class */
	className?: string;
}

/**
 * Tab configuration for tabbed form views.
 */
export interface FormTabConfig {
	/** Unique tab identifier */
	id: string;
	/** Tab label */
	label: I18nText;
	/** Tab icon */
	icon?: ComponentReference;
	/** Fields in this tab */
	fields: FieldLayoutItem[];
	/** Conditional visibility */
	hidden?: boolean;
}

/**
 * Tabs layout for form views.
 *
 * @example
 * ```ts
 * {
 *   type: "tabs",
 *   tabs: [
 *     { id: "basic", label: { en: "Basic" }, fields: [f.name, f.email] },
 *     { id: "advanced", label: { en: "Advanced" }, fields: [f.settings] },
 *   ],
 * }
 * ```
 */
export interface FormTabsLayout {
	type: "tabs";
	tabs: FormTabConfig[];
}

/**
 * Field entry with optional reactive form behavior.
 */
export interface FormFieldLayoutItem<TData = any> {
	field: string;
	className?: string;
	hidden?: boolean | FormReactiveConfig<TData, boolean>;
	readOnly?: boolean | FormReactiveConfig<TData, boolean>;
	disabled?: boolean | FormReactiveConfig<TData, boolean>;
	compute?: FormReactiveConfig<TData, any>;
}

/**
 * Field layout item - union of field reference or layout container.
 *
 * Can be:
 * - Field name string: `f.name`
 * - Field with className: `{ field: "name", className: "col-span-2" }`
 * - Section layout: `{ type: "section", ... }`
 * - Tabs layout: `{ type: "tabs", ... }`
 */
export type FieldLayoutItem =
	| string
	| FormFieldLayoutItem
	| FormSectionLayout
	| FormTabsLayout;

/**
 * Form sidebar configuration.
 * Places fields in a fixed sidebar alongside the main content.
 *
 * @example
 * ```ts
 * sidebar: {
 *   position: "right",
 *   fields: [f.isActive, f.avatar],
 * }
 * ```
 */
export interface FormSidebarConfig {
	/** Sidebar position (default: "right") */
	position?: "left" | "right";
	/** Fields in the sidebar */
	fields: FieldLayoutItem[];
}

/**
 * Form view configuration for a collection.
 * Defines field layout with sections, tabs, and optional sidebar.
 *
 * @example
 * ```ts
 * v.collectionForm({
 *   sidebar: { position: "right", fields: [f.status] },
 *   fields: [
 *     { type: "section", label: { en: "Details" }, layout: "grid", columns: 2, fields: [f.name, f.email] },
 *     { type: "section", label: { en: "Content" }, fields: [f.body] },
 *   ],
 * })
 * ```
 */
export interface FormViewConfig {
	/** View type to use (e.g., "form", "wizard") */
	view?: string;
	/** Main content fields */
	fields: FieldLayoutItem[];
	/** Sidebar configuration */
	sidebar?: FormSidebarConfig;
}

/**
 * Preview configuration for a collection.
 * Enables live preview of content.
 */
export interface PreviewConfig {
	/** Enable preview panel */
	enabled?: boolean;
	/** Preview URL builder (runs on server) */
	url?: (ctx: { record: Record<string, unknown>; locale?: string }) => string;
	/** Preview panel position */
	position?: "left" | "right" | "bottom";
	/** Default panel width (percentage) */
	defaultWidth?: number;
}

// ============================================================================
// Global Admin Configuration
// ============================================================================

/**
 * Admin metadata for a global.
 */
export interface AdminGlobalConfig {
	/** Display label */
	label?: I18nText;
	/** Description */
	description?: I18nText;
	/** Icon reference */
	icon?: ComponentReference;
	/** Hide from admin */
	hidden?: boolean;
	/** Group in sidebar */
	group?: string;
	/** Order within group */
	order?: number;
	/**
	 * Whether this global should be included in audit logging.
	 * @see AdminCollectionConfig.audit
	 */
	audit?: boolean;
}
