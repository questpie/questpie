/**
 * Server-Side Type Definitions for Admin Package
 *
 * This file provides type definitions for admin-specific features.
 * The actual methods are added via runtime monkey patching in ./patch.ts.
 *
 * For type-safe usage, use the helper types:
 * - WithAdminMethods<T> - adds admin methods to QuestpieBuilder
 * - WithCollectionAdminMethods<T> - adds admin methods to CollectionBuilder
 * - WithGlobalAdminMethods<T> - adds admin methods to GlobalBuilder
 *
 * @example
 * ```ts
 * import { q } from "questpie";
 * import { adminModule } from "@questpie/admin/server";
 *
 * const cms = q({ name: "my-app" })
 *   .use(adminModule)
 *   .collections({
 *     posts: q.collection("posts")
 *       .fields((f) => ({
 *         title: f.text({ required: true }),
 *       }))
 *       // These methods are added by adminModule at runtime:
 *       .admin(({ c }) => ({
 *         label: { en: "Posts" },
 *         icon: c.icon("ph:article"),
 *       }))
 *       .list(({ v, f }) => v.table({
 *         columns: [f.title],
 *       }))
 *       .form(({ v, f }) => v.form({
 *         fields: [f.title],
 *       })),
 *   });
 * ```
 */

import type { BetterAuthOptions } from "better-auth";
import type {
	BuilderCollectionsMap,
	BuilderEmailTemplatesMap,
	BuilderFieldsMap,
	BuilderGlobalsMap,
	BuilderJobsMap,
	CollectionBuilderState,
	FieldsOf,
	GlobalBuilderState,
	GlobalFieldsOf,
	QuestpieBuilderState,
	QuestpieStateOf,
	RegisteredApp,
} from "questpie";
import type { I18nText } from "questpie/shared";
import type {
	AnyBlockBuilder,
	AnyBlockDefinition,
	BlockBuilder,
} from "./block/index.js";

// ============================================================================
// Admin Locale Configuration
// ============================================================================

/**
 * Admin locale configuration for UI language support.
 * Separate from content locales - UI can have different languages than content.
 *
 * @example
 * ```ts
 * .adminLocale({
 *   locales: ["en", "sk"],  // UI available in 2 languages
 *   defaultLocale: "en",
 * })
 * ```
 */
export interface AdminLocaleConfig {
	/** Available UI locales for admin interface */
	locales: string[];
	/** Default UI locale */
	defaultLocale: string;
}

// ============================================================================
// Admin Configuration Types
// ============================================================================

/**
 * Reference to a server-registered component.
 * Used for icons, badges, and other UI elements defined on server.
 *
 * @example
 * ```ts
 * { type: "icon", props: { name: "ph:users" } }
 * ```
 */
export interface ComponentReference<
	TType extends string = string,
	TProps extends Record<string, unknown> = Record<string, unknown>,
> {
	type: TType;
	props: TProps;
}

/**
 * Icon component reference with typed props.
 */
export type IconReference = ComponentReference<"icon", { name: string }>;

/**
 * Badge component reference with typed props.
 */
export type BadgeReference = ComponentReference<
	"badge",
	{ text: string; color?: string }
>;

/**
 * View definition for list views (table, cards, etc.)
 */
export interface ListViewDefinition<TName extends string = string> {
	type: "listView";
	name: TName;
}

/**
 * View definition for edit views (form, wizard, etc.)
 */
export interface EditViewDefinition<TName extends string = string> {
	type: "editView";
	name: TName;
}

/**
 * Component definition for reusable UI components
 */
export interface ComponentDefinition<TName extends string = string> {
	type: "component";
	name: TName;
}

type ComponentFactoryInput<TName extends string> = TName extends "icon"
	? string | { name: string }
	: TName extends "badge"
		? { text: string; color?: string }
		: Record<string, unknown> | string;

type ComponentFactoryOutput<TName extends string> = TName extends "icon"
	? IconReference
	: TName extends "badge"
		? BadgeReference
		: ComponentReference<TName, Record<string, unknown>>;

/**
 * Component factory API generated from registered components.
 *
 * Each key returns a serializable component reference.
 *
 * Note: `icon` keeps backward-compatible string shorthand:
 * `c.icon("ph:users")` => `{ type: "icon", props: { name: "ph:users" } }`
 */
export type ComponentFactory<TComponentNames extends string = string> = {
	[K in TComponentNames]: (
		props: ComponentFactoryInput<K>,
	) => ComponentFactoryOutput<K>;
};

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
 * v.form({
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

/**
 * Reference to an action
 */
export type ActionReference = string | { type: string; config?: unknown };

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
}

// ============================================================================
// Server-Side Dashboard Configuration
// ============================================================================

/**
 * Context available to widget fetchFn and access functions on the server.
 * When you register your app via `Register.app`, `ctx.app` is automatically typed.
 */
export type WidgetFetchContext = {
	app: RegisteredApp;
	db: any;
	session?: any;
	locale?: string;
};

/**
 * Per-widget access rule. Can be a boolean or async function.
 * - `true` or `undefined`: always visible
 * - `false`: always hidden
 * - function: evaluated at request time
 */
export type WidgetAccessRule =
	| boolean
	| ((ctx: WidgetFetchContext) => boolean | Promise<boolean>);

/**
 * Server-side dashboard widget configuration.
 * These are serializable and can be sent via introspection API.
 */
export type ServerDashboardWidget =
	| ServerStatsWidget
	| ServerChartWidget
	| ServerRecentItemsWidget
	| ServerQuickActionsWidget
	| ServerCustomWidget
	| ServerValueWidget
	| ServerTableWidget
	| ServerTimelineWidget
	| ServerProgressWidget;

/**
 * Stats widget - shows count from a collection
 */
export interface ServerStatsWidget {
	type: "stats";
	/** Unique widget ID */
	id?: string;
	/** Widget label */
	label?: I18nText;
	/** Icon reference */
	icon?: ComponentReference;
	/** Collection to count */
	collection: string;
	/** Filter to apply */
	filter?: Record<string, unknown>;
	/** Grid span (1-4) */
	span?: number;
	/** Optional server-side data fetcher (overrides collection count) */
	fetchFn?: (ctx: WidgetFetchContext) => Promise<{ count: number }>;
	/** Per-widget access rule */
	access?: WidgetAccessRule;
}

/**
 * Chart widget - shows data over time
 */
export interface ServerChartWidget {
	type: "chart";
	/** Unique widget ID */
	id?: string;
	/** Widget label */
	label?: I18nText;
	/** Chart type */
	chartType: "line" | "bar" | "area" | "pie";
	/** Collection to query */
	collection: string;
	/** Date field for time series */
	dateField: string;
	/** Time range */
	timeRange?: "7d" | "30d" | "90d" | "1y";
	/** Filter to apply */
	filter?: Record<string, unknown>;
	/** Grid span (1-4) */
	span?: number;
	/** Optional server-side data fetcher (overrides collection query) */
	fetchFn?: (
		ctx: WidgetFetchContext,
	) => Promise<Array<{ name: string; value: number }>>;
	/** Per-widget access rule */
	access?: WidgetAccessRule;
}

/**
 * Recent items widget - shows latest items from a collection
 */
export interface ServerRecentItemsWidget {
	type: "recentItems";
	/** Unique widget ID */
	id?: string;
	/** Widget label */
	label?: I18nText;
	/** Collection to query */
	collection: string;
	/** Date field for ordering */
	dateField: string;
	/** Number of items to show */
	limit?: number;
	/** Filter to apply */
	filter?: Record<string, unknown>;
	/** Grid span (1-4) */
	span?: number;
	/** Optional server-side data fetcher */
	fetchFn?: (ctx: WidgetFetchContext) => Promise<unknown>;
	/** Per-widget access rule */
	access?: WidgetAccessRule;
}

/**
 * Quick actions widget - shows action buttons
 */
export interface ServerQuickActionsWidget {
	type: "quickActions";
	/** Unique widget ID */
	id?: string;
	/** Widget label */
	label?: I18nText;
	/** Actions to display */
	actions: ServerQuickAction[];
	/** Grid span (1-4) */
	span?: number;
	/** Per-widget access rule */
	access?: WidgetAccessRule;
}

/**
 * Quick action definition
 */
export interface ServerQuickAction {
	/** Action label */
	label: I18nText;
	/** Action icon */
	icon?: ComponentReference;
	/** Action to perform */
	action:
		| { type: "create"; collection: string }
		| { type: "link"; href: string; external?: boolean }
		| { type: "page"; pageId: string };
}

/**
 * Custom widget - rendered by client component
 */
export interface ServerCustomWidget {
	type: "custom";
	/** Unique widget ID (required for custom) */
	id: string;
	/** Widget label */
	label?: I18nText;
	/** Custom widget type name (resolved by client registry) */
	widgetType: string;
	/** Widget props (passed to client component) */
	props?: Record<string, unknown>;
	/** Grid span (1-4) */
	span?: number;
	/** Optional server-side data fetcher */
	fetchFn?: (ctx: WidgetFetchContext) => Promise<unknown>;
	/** Per-widget access rule */
	access?: WidgetAccessRule;
}

/**
 * Value widget - displays a single metric with optional trend
 */
export interface ServerValueWidget {
	type: "value";
	/** Unique widget ID */
	id: string;
	/** Widget label */
	label?: I18nText;
	/** Icon reference */
	icon?: ComponentReference;
	/** Grid span (1-4) */
	span?: number;
	/** Server-side data fetcher (required) */
	fetchFn: (ctx: WidgetFetchContext) => Promise<{
		value: number | string;
		formatted?: string;
		label?: I18nText | string;
		subtitle?: I18nText | string;
		footer?: I18nText | string;
		icon?: ComponentReference;
		trend?: { value: string; icon?: ComponentReference };
		classNames?: Record<string, string>;
	}>;
	/** Per-widget access rule */
	access?: WidgetAccessRule;
}

/**
 * Table widget - displays a mini table from a collection
 */
export interface ServerTableWidget {
	type: "table";
	/** Unique widget ID */
	id: string;
	/** Widget label */
	label?: I18nText;
	/** Collection to fetch from */
	collection: string;
	/** Columns to display */
	columns: Array<string | { key: string; label?: I18nText }>;
	/** Number of rows */
	limit?: number;
	/** Sort field */
	sortBy?: string;
	/** Sort direction */
	sortOrder?: "asc" | "desc";
	/** Filter */
	filter?: Record<string, unknown>;
	/** Grid span (1-4) */
	span?: number;
	/** Optional server-side data fetcher */
	fetchFn?: (ctx: WidgetFetchContext) => Promise<unknown>;
	/** Per-widget access rule */
	access?: WidgetAccessRule;
}

/**
 * Timeline widget - displays activity/event timeline
 */
export interface ServerTimelineWidget {
	type: "timeline";
	/** Unique widget ID */
	id: string;
	/** Widget label */
	label?: I18nText;
	/** Max items to show */
	maxItems?: number;
	/** Show timestamps */
	showTimestamps?: boolean;
	/** Timestamp format */
	timestampFormat?: "relative" | "absolute" | "datetime";
	/** Empty state message */
	emptyMessage?: I18nText;
	/** Grid span (1-4) */
	span?: number;
	/** Server-side data fetcher (required) */
	fetchFn: (ctx: WidgetFetchContext) => Promise<
		Array<{
			id: string;
			title: string;
			description?: string;
			timestamp: Date | string;
			icon?: ComponentReference;
			variant?: "default" | "success" | "warning" | "error" | "info";
			href?: string;
		}>
	>;
	/** Per-widget access rule */
	access?: WidgetAccessRule;
}

/**
 * Progress widget - displays progress towards a goal
 */
export interface ServerProgressWidget {
	type: "progress";
	/** Unique widget ID */
	id: string;
	/** Widget label */
	label?: I18nText;
	/** Progress bar color */
	color?: string;
	/** Show percentage */
	showPercentage?: boolean;
	/** Grid span (1-4) */
	span?: number;
	/** Server-side data fetcher (required) */
	fetchFn: (ctx: WidgetFetchContext) => Promise<{
		current: number;
		target: number;
		label?: string;
		subtitle?: string;
	}>;
	/** Per-widget access rule */
	access?: WidgetAccessRule;
}

/**
 * Dashboard section - groups widgets
 */
export interface ServerDashboardSection {
	type: "section";
	/** Section label */
	label?: I18nText;
	/** Section description */
	description?: I18nText;
	/** Section icon */
	icon?: ComponentReference;
	/** Layout mode */
	layout?: "grid" | "stack";
	/** Grid columns */
	columns?: number;
	/** Wrapper style */
	wrapper?: "flat" | "card" | "collapsible";
	/** Default collapsed (for collapsible) */
	defaultCollapsed?: boolean;
	/** Section items */
	items: ServerDashboardItem[];
}

/**
 * Dashboard tabs - tabbed sections
 */
export interface ServerDashboardTabs {
	type: "tabs";
	/** Tabs configuration */
	tabs: ServerDashboardTab[];
	/** Default active tab ID */
	defaultTab?: string;
}

/**
 * Single tab configuration
 */
export interface ServerDashboardTab {
	/** Tab ID */
	id: string;
	/** Tab label */
	label: I18nText;
	/** Tab icon */
	icon?: ComponentReference;
	/** Tab items */
	items: ServerDashboardItem[];
}

/**
 * Dashboard layout item
 */
export type ServerDashboardItem =
	| ServerDashboardWidget
	| ServerDashboardSection
	| ServerDashboardTabs;

/**
 * Dashboard header action shown beside title/description.
 */
export interface ServerDashboardAction {
	/** Unique action ID */
	id: string;
	/** Action label */
	label: I18nText;
	/** Action icon */
	icon?: ComponentReference;
	/** Action URL */
	href: string;
	/** Visual variant */
	variant?: "default" | "primary" | "secondary" | "outline" | "ghost";
}

/**
 * Server-side dashboard configuration
 */
export interface ServerDashboardConfig {
	/** Dashboard title */
	title?: I18nText;
	/** Dashboard description */
	description?: I18nText;
	/** Header actions */
	actions?: ServerDashboardAction[];
	/** Grid columns (default: 4) */
	columns?: number;
	/** Gap between widgets */
	gap?: number;
	/** Dashboard items */
	items?: ServerDashboardItem[];
	/** Enable realtime invalidation for dashboard widgets by default */
	realtime?: boolean;
	/** Auto-refresh interval in milliseconds */
	refreshInterval?: number;
}

// ============================================================================
// Server-Side Branding Configuration
// ============================================================================

/**
 * Branding configuration for the admin panel.
 */
export interface ServerBrandingConfig {
	/** Admin panel name */
	name?: I18nText;
	/** Logo configuration */
	logo?: unknown;
}

// ============================================================================
// Server-Side Sidebar Configuration
// ============================================================================

/**
 * Server-side sidebar item types
 */
export type ServerSidebarItem =
	| ServerSidebarCollectionItem
	| ServerSidebarGlobalItem
	| ServerSidebarPageItem
	| ServerSidebarLinkItem
	| ServerSidebarDividerItem;

/**
 * Collection item in sidebar
 */
export interface ServerSidebarCollectionItem {
	type: "collection";
	/** Collection name (validated against registered collections) */
	collection: string;
	/** Override display label */
	label?: I18nText;
	/** Override icon */
	icon?: ComponentReference;
}

/**
 * Global item in sidebar
 */
export interface ServerSidebarGlobalItem {
	type: "global";
	/** Global name (validated against registered globals) */
	global: string;
	/** Override display label */
	label?: I18nText;
	/** Override icon */
	icon?: ComponentReference;
}

/**
 * Custom page item in sidebar
 */
export interface ServerSidebarPageItem {
	type: "page";
	/** Page ID (resolved by client) */
	pageId: string;
	/** Display label */
	label?: I18nText;
	/** Icon */
	icon?: ComponentReference;
}

/**
 * External link item in sidebar
 */
export interface ServerSidebarLinkItem {
	type: "link";
	/** Display label */
	label: I18nText;
	/** Link URL */
	href: string;
	/** Icon */
	icon?: ComponentReference;
	/** Open in new tab */
	external?: boolean;
}

/**
 * Divider item in sidebar
 */
export interface ServerSidebarDividerItem {
	type: "divider";
}

/**
 * Sidebar section
 */
export interface ServerSidebarSection {
	/** Section ID (for targeting/extending) */
	id: string;
	/** Section title */
	title?: I18nText;
	/** Section icon */
	icon?: ComponentReference;
	/** Whether collapsed by default */
	collapsed?: boolean;
	/** Section items */
	items?: ServerSidebarItem[];
	/** Nested subsections */
	sections?: ServerSidebarSection[];
}

/**
 * Server-side sidebar configuration
 */
export interface ServerSidebarConfig {
	/** Sidebar sections */
	sections: ServerSidebarSection[];
}

// ============================================================================
// Server-Side Action System
// ============================================================================

/**
 * Action result types returned from action handlers.
 */
export type ServerActionResult =
	| ServerActionSuccess
	| ServerActionError
	| ServerActionRedirect
	| ServerActionDownload;

/**
 * Successful action result
 */
export interface ServerActionSuccess {
	type: "success";
	/** Toast notification to show */
	toast?: {
		message: string;
		title?: string;
	};
	/** Side effects to trigger */
	effects?: ServerActionEffects;
}

/**
 * Error action result
 */
export interface ServerActionError {
	type: "error";
	/** Toast notification to show */
	toast?: {
		message: string;
		title?: string;
	};
	/** Field-level errors */
	errors?: Record<string, string>;
}

/**
 * Redirect action result
 */
export interface ServerActionRedirect {
	type: "redirect";
	/** URL to redirect to */
	url: string;
	/** Open in new tab */
	external?: boolean;
}

/**
 * Download action result
 */
export interface ServerActionDownload {
	type: "download";
	/** File data */
	file: {
		name: string;
		content: string | Uint8Array;
		mimeType: string;
	};
}

/**
 * Action side effects
 */
export interface ServerActionEffects {
	/** Close the action modal */
	closeModal?: boolean;
	/** Invalidate queries (true = all, string[] = specific collections) */
	invalidate?: boolean | string[];
	/** Redirect after success */
	redirect?: string;
}

/**
 * Action handler context
 */
export interface ServerActionContext<TData = Record<string, unknown>> {
	/** Form data submitted */
	data: TData;
	/** Item ID (for single-item actions) */
	itemId?: string;
	/** Item IDs (for bulk actions) */
	itemIds?: string[];
	/** CMS app instance — typed via Register.app */
	app: RegisteredApp;
	/** Database client */
	db: unknown;
	/** Current user session */
	session?: unknown;
	/** Current locale */
	locale?: string;
}

/**
 * Action handler function type
 */
export type ServerActionHandler<TData = Record<string, unknown>> = (
	ctx: ServerActionContext<TData>,
) => Promise<ServerActionResult> | ServerActionResult;

/**
 * Server-side action form field definition.
 * Can be either a field definition from the registry or a simple config object.
 */
export type ServerActionFormField =
	| ServerActionFormFieldConfig
	| ServerActionFormFieldDefinition;

/**
 * Simple field config for action forms (when not using field registry)
 */
export interface ServerActionFormFieldConfig {
	/** Field type */
	type: string;
	/** Field label */
	label?: I18nText;
	/** Field description */
	description?: I18nText;
	/** Whether field is required */
	required?: boolean;
	/** Default value */
	default?: unknown;
	/** Field-specific options */
	options?: unknown;
}

/**
 * Field definition from field registry (has getMetadata method)
 */
export interface ServerActionFormFieldDefinition {
	/** Field definition state */
	state: { label?: I18nText; description?: I18nText; required?: boolean };
	/** Get metadata for introspection */
	getMetadata(): { type: string; label?: I18nText; description?: I18nText };
	/** Generate Zod schema for validation */
	toZodSchema(): unknown;
}

/**
 * Server-side action form configuration
 */
export interface ServerActionForm {
	/** Form dialog title */
	title: I18nText;
	/** Form dialog description */
	description?: I18nText;
	/** Form fields */
	fields: Record<string, ServerActionFormField>;
	/** Submit button label */
	submitLabel?: I18nText;
	/** Cancel button label */
	cancelLabel?: I18nText;
	/** Dialog width */
	width?: "sm" | "md" | "lg" | "xl";
}

/**
 * Server-side action definition
 */
export interface ServerActionDefinition<TData = Record<string, unknown>> {
	/** Unique action ID */
	id: string;
	/** Display label */
	label: I18nText;
	/** Action description */
	description?: I18nText;
	/** Icon reference */
	icon?: ComponentReference;
	/** Button variant */
	variant?: "default" | "destructive" | "outline" | "secondary" | "ghost";
	/** Where the action appears */
	scope?: "single" | "bulk" | "header" | "row";
	/** Form configuration (for actions with input) */
	form?: ServerActionForm;
	/** Confirmation dialog */
	confirmation?: {
		title: I18nText;
		description?: I18nText;
		confirmLabel?: I18nText;
		cancelLabel?: I18nText;
		destructive?: boolean;
	};
	/** Action handler (runs on server) */
	handler: ServerActionHandler<TData>;
}

/**
 * Built-in action types
 */
export type BuiltinActionType =
	| "create"
	| "save"
	| "delete"
	| "deleteMany"
	| "duplicate";

/**
 * Server-side actions configuration for a collection
 */
export interface ServerActionsConfig {
	/** Built-in actions to enable */
	builtin?: BuiltinActionType[];
	/** Custom actions */
	custom?: ServerActionDefinition[];
}

/**
 * Context for actions config function.
 *
 * Uses the same field registry as collections, so you can use `f.text()`, `f.select()` etc.
 * for action form fields.
 *
 * @example
 * ```ts
 * .actions(({ a, c, f }) => ({
 *   custom: [
 *     a.action({
 *       id: "send-email",
 *       label: { en: "Send Email" },
 *       form: {
 *         title: { en: "Send Email" },
 *         fields: {
 *           subject: f.text({ label: { en: "Subject" }, required: true }),
 *           message: f.textarea({ label: { en: "Message" } }),
 *           priority: f.select({
 *             label: { en: "Priority" },
 *             options: [
 *               { value: "low", label: { en: "Low" } },
 *               { value: "high", label: { en: "High" } },
 *             ],
 *           }),
 *         },
 *       },
 *       handler: async ({ data }) => {
 *         // data.subject, data.message, data.priority are typed
 *         return { type: "success" };
 *       },
 *     }),
 *   ],
 * }))
 * ```
 */
export interface ActionsConfigContext<
	TFields extends Record<string, unknown> = Record<string, unknown>,
	TComponentNames extends string = string,
> {
	/** Action builders */
	a: {
		/** Enable create action */
		create: () => BuiltinActionType;
		/** Enable save action */
		save: () => BuiltinActionType;
		/** Enable delete action */
		delete: () => BuiltinActionType;
		/** Enable delete many action */
		deleteMany: () => BuiltinActionType;
		/** Enable duplicate action */
		duplicate: () => BuiltinActionType;
		/** Define a custom action */
		action: <TData = Record<string, unknown>>(
			def: Omit<ServerActionDefinition<TData>, "scope"> & {
				scope?: "single" | "row";
			},
		) => ServerActionDefinition<TData>;
		/** Define a bulk action */
		bulkAction: <TData = Record<string, unknown>>(
			def: Omit<ServerActionDefinition<TData>, "scope">,
		) => ServerActionDefinition<TData>;
		/** Define a header action */
		headerAction: <TData = Record<string, unknown>>(
			def: Omit<ServerActionDefinition<TData>, "scope">,
		) => ServerActionDefinition<TData>;
	};
	/** Component helpers (from registered component registry) */
	c: ComponentFactory<TComponentNames>;
	/**
	 * Field proxy from field registry.
	 * Use the same field types as in collections: f.text(), f.select(), etc.
	 */
	f: Record<
		string,
		(config?: Record<string, unknown>) => ServerActionFormField
	>;
}

// ============================================================================
// Dashboard and Sidebar Context Types
// ============================================================================

/**
 * Action factory for dashboard header actions.
 */
export interface DashboardActionFactory {
	/** Return action as-is */
	action: (config: ServerDashboardAction) => ServerDashboardAction;
	/** Link action */
	link: (config: ServerDashboardAction) => ServerDashboardAction;
	/** Create action linking to collection create view */
	create: (
		config: Omit<ServerDashboardAction, "href"> & { collection: string },
	) => ServerDashboardAction;
	/** Global action linking to global edit view */
	global: (
		config: Omit<ServerDashboardAction, "href"> & { global: string },
	) => ServerDashboardAction;
}

/**
 * Context for dashboard config function
 */
export interface DashboardConfigContext<
	TComponentNames extends string = string,
> {
	/** Dashboard action helpers */
	a: DashboardActionFactory;
	/** Dashboard builder helpers */
	d: {
		/** Create dashboard config */
		dashboard: (config: ServerDashboardConfig) => ServerDashboardConfig;
		/** Create a section */
		section: (
			config: Omit<ServerDashboardSection, "type">,
		) => ServerDashboardSection;
		/** Create tabs */
		tabs: (config: Omit<ServerDashboardTabs, "type">) => ServerDashboardTabs;
		/** Create a stats widget */
		stats: (config: Omit<ServerStatsWidget, "type">) => ServerStatsWidget;
		/** Create a chart widget */
		chart: (config: Omit<ServerChartWidget, "type">) => ServerChartWidget;
		/** Create a recent items widget */
		recentItems: (
			config: Omit<ServerRecentItemsWidget, "type">,
		) => ServerRecentItemsWidget;
		/** Create a quick actions widget */
		quickActions: (
			config: Omit<ServerQuickActionsWidget, "type">,
		) => ServerQuickActionsWidget;
		/** Create a custom widget */
		custom: (config: Omit<ServerCustomWidget, "type">) => ServerCustomWidget;
		/** Create a value widget */
		value: (config: Omit<ServerValueWidget, "type">) => ServerValueWidget;
		/** Create a table widget */
		table: (config: Omit<ServerTableWidget, "type">) => ServerTableWidget;
		/** Create a timeline widget */
		timeline: (
			config: Omit<ServerTimelineWidget, "type">,
		) => ServerTimelineWidget;
		/** Create a progress widget */
		progress: (
			config: Omit<ServerProgressWidget, "type">,
		) => ServerProgressWidget;
	};
	/** Component helpers (from registered component registry) */
	c: ComponentFactory<TComponentNames>;
}

/**
 * Context for sidebar config function
 */
export interface SidebarConfigContext<TComponentNames extends string = string> {
	/** Sidebar builder helpers */
	s: {
		/** Create sidebar config */
		sidebar: (config: ServerSidebarConfig) => ServerSidebarConfig;
		/** Create a section */
		section: (
			config: Omit<ServerSidebarSection, "items"> & {
				items?: ServerSidebarItem[];
			},
		) => ServerSidebarSection;
	};
	/** Component helpers (from registered component registry) */
	c: ComponentFactory<TComponentNames>;
}

// ============================================================================
// Admin Builder Context Types
// ============================================================================

/**
 * Context for admin config functions with component proxy
 */
export interface AdminConfigContext<TComponentNames extends string = string> {
	c: ComponentFactory<TComponentNames>;
}

/**
 * Extract state from a builder-like object.
 */
type BuilderStateOf<TBuilder> = TBuilder extends { state: infer TState }
	? TState
	: never;

/**
 * Resolve source state for registry lookups.
 *
 * - Collection/Global builders: use `state["~questpieApp"].state`
 * - QuestpieBuilder: use `state`
 */
type RegistrySourceStateOf<TBuilder> =
	QuestpieStateOf<
		BuilderStateOf<TBuilder> extends { "~questpieApp"?: infer TQuestpieApp }
			? NonNullable<TQuestpieApp>
			: never
	> extends never
		? BuilderStateOf<TBuilder>
		: QuestpieStateOf<
				BuilderStateOf<TBuilder> extends {
					"~questpieApp"?: infer TQuestpieApp;
				}
					? NonNullable<TQuestpieApp>
					: never
			>;

/**
 * Extract registered list view names from a builder.
 */
type RegisteredListViewNamesOfBuilder<TBuilder> =
	RegistrySourceStateOf<TBuilder> extends {
		listViews?: infer TViews;
	}
		? TViews extends Record<string, ListViewDefinition>
			? keyof TViews & string
			: string
		: string;

/**
 * Extract registered edit view names from a builder.
 */
type RegisteredEditViewNamesOfBuilder<TBuilder> =
	RegistrySourceStateOf<TBuilder> extends {
		editViews?: infer TViews;
	}
		? TViews extends Record<string, EditViewDefinition>
			? keyof TViews & string
			: string
		: string;

/**
 * Extract registered component names from a builder.
 */
type RegisteredComponentNamesOfBuilder<TBuilder> =
	RegistrySourceStateOf<TBuilder> extends {
		components?: infer TComponents;
	}
		? TComponents extends Record<string, ComponentDefinition>
			? keyof TComponents & string
			: string
		: string;

/**
 * View factory API generated from registered list views.
 */
export type ListViewFactory<TListViewNames extends string = string> = {
	[K in TListViewNames]: (
		config: Omit<ListViewConfig, "view">,
	) => ListViewConfig & { view: K };
};

/**
 * View factory API generated from registered edit views.
 */
export type EditViewFactory<TEditViewNames extends string = string> = {
	[K in TEditViewNames]: (
		config: Omit<FormViewConfig, "view">,
	) => FormViewConfig & { view: K };
};

/**
 * Context for list view config functions
 */
export interface ListViewConfigContext<
	TFields extends Record<string, any> = Record<string, any>,
	TListViewNames extends string = string,
> {
	/** View factory */
	v: ListViewFactory<TListViewNames>;
	/** Field reference proxy - returns field names as strings */
	f: { [K in keyof TFields]: K };
	/** Action reference proxy */
	a: {
		create: string;
		save: string;
		delete: string;
		deleteMany: string;
		duplicate: string;
		export: string;
		custom: (
			name: string,
			config?: unknown,
		) => { type: string; config?: unknown };
	};
}

/**
 * Context for form view config functions
 */
export interface FormViewConfigContext<
	TFields extends Record<string, any> = Record<string, any>,
	TEditViewNames extends string = string,
> {
	/** View factory */
	v: EditViewFactory<TEditViewNames>;
	/** Field reference proxy - returns field names as strings */
	f: { [K in keyof TFields]: K };
}

// ============================================================================
// Admin Builder Methods Type (for type-safe usage)
// ============================================================================

/**
 * Admin methods added to QuestpieBuilder via monkey patching.
 * Use with type assertion when you need type safety:
 *
 * @example
 * ```ts
 * import type { WithAdminMethods } from "@questpie/admin/server";
 *
 * const builder = q({ name: "app" }).use(adminModule) as WithAdminMethods<typeof q>;
 * builder.listView("table"); // now has type support
 * ```
 */
export interface QuestpieBuilderAdminMethods<
	TComponentNames extends string = string,
> {
	/** Create a list view definition */
	listView<TName extends string>(
		name: TName,
		config?: Record<string, unknown>,
	): ListViewDefinition<TName>;

	/** Create an edit view definition */
	editView<TName extends string>(
		name: TName,
		config?: Record<string, unknown>,
	): EditViewDefinition<TName>;

	/** Create a component definition */
	component<TName extends string>(
		name: TName,
		config?: Record<string, unknown>,
	): ComponentDefinition<TName>;

	/** Register list views */
	listViews<TViews extends Record<string, ListViewDefinition>>(
		views: TViews,
	): this;

	/** Register edit views */
	editViews<TViews extends Record<string, EditViewDefinition>>(
		views: TViews,
	): this;

	/** Register components */
	components<TComponents extends Record<string, ComponentDefinition>>(
		components: TComponents,
	): this;

	/** Register block definitions */
	blocks<TBlocks extends Record<string, AnyBlockBuilder>>(
		blocks: TBlocks,
	): this;

	/**
	 * Configure the admin dashboard.
	 *
	 * @example
	 * ```ts
	 * .dashboard(({ d, c, a }) => d.dashboard({
	 *   title: { en: "Dashboard" },
	 *   actions: [
	 *     a.create({
	 *       id: "new-user",
	 *       collection: "users",
	 *       label: { en: "New User" },
	 *       icon: c.icon("ph:user-plus"),
	 *     }),
	 *   ],
	 *   items: [
	 *     d.section({
	 *       label: { en: "Overview" },
	 *       items: [
	 *         d.stats({ collection: "users", label: { en: "Total Users" } }),
	 *         d.chart({ collection: "posts", chartType: "line", dateField: "createdAt" }),
	 *       ],
	 *     }),
	 *   ],
	 * }))
	 * ```
	 */
	dashboard(
		configFn: (
			ctx: DashboardConfigContext<TComponentNames>,
		) => ServerDashboardConfig,
	): this;

	/**
	 * Configure the admin sidebar.
	 *
	 * @example
	 * ```ts
	 * .sidebar(({ s, c }) => s.sidebar({
	 *   sections: [
	 *     s.section({
	 *       id: "content",
	 *       title: { en: "Content" },
	 *       icon: c.icon("ph:files"),
	 *       items: [
	 *         { type: "collection", collection: "posts" },
	 *         { type: "collection", collection: "pages" },
	 *       ],
	 *     }),
	 *   ],
	 * }))
	 * ```
	 */
	sidebar(
		configFn: (
			ctx: SidebarConfigContext<TComponentNames>,
		) => ServerSidebarConfig,
	): this;

	/**
	 * Configure admin branding (name, logo).
	 *
	 * @example
	 * ```ts
	 * .branding({
	 *   name: { en: "My App", sk: "Moja Appka" },
	 * })
	 * ```
	 */
	branding(config: ServerBrandingConfig): this;
}

/**
 * Admin methods added to CollectionBuilder via monkey patching.
 */
export interface CollectionBuilderAdminMethods<
	TFields extends Record<string, any> = Record<string, any>,
	TListViewNames extends string = string,
	TEditViewNames extends string = string,
	TComponentNames extends string = string,
> {
	/**
	 * Set admin metadata for the collection.
	 */
	admin(
		configOrFn:
			| AdminCollectionConfig
			| ((ctx: AdminConfigContext<TComponentNames>) => AdminCollectionConfig),
	): this;

	/**
	 * Configure list view for the collection.
	 */
	list(
		configFn: (
			ctx: ListViewConfigContext<TFields, TListViewNames>,
		) => ListViewConfig,
	): this;

	/**
	 * Configure form view for the collection.
	 */
	form(
		configFn: (
			ctx: FormViewConfigContext<TFields, TEditViewNames>,
		) => FormViewConfig,
	): this;

	/**
	 * Configure preview for the collection.
	 */
	preview(config: PreviewConfig): this;

	/**
	 * Configure actions for the collection.
	 * Enables built-in actions and custom actions with forms.
	 *
	 * @example
	 * ```ts
	 * .actions(({ a, c, fr }) => ({
	 *   builtin: [a.create(), a.delete(), a.deleteMany()],
	 *   custom: [
	 *     a.action({
	 *       id: "publish",
	 *       label: { en: "Publish" },
	 *       icon: c.icon("ph:check-circle"),
	 *       handler: async ({ itemId }) => {
	 *         return { type: "success", toast: { message: "Published!" } };
	 *       },
	 *     }),
	 *   ],
	 * }))
	 * ```
	 */
	actions(
		configFn: (
			ctx: ActionsConfigContext<TFields, TComponentNames>,
		) => ServerActionsConfig,
	): this;
}

/**
 * Admin methods added to GlobalBuilder via monkey patching.
 */
export interface GlobalBuilderAdminMethods<
	TFields extends Record<string, any> = Record<string, any>,
	TEditViewNames extends string = string,
	TComponentNames extends string = string,
> {
	/**
	 * Set admin metadata for the global.
	 */
	admin(
		configOrFn:
			| AdminGlobalConfig
			| ((ctx: AdminConfigContext<TComponentNames>) => AdminGlobalConfig),
	): this;

	/**
	 * Configure form view for the global.
	 */
	form(
		configFn: (
			ctx: FormViewConfigContext<TFields, TEditViewNames>,
		) => FormViewConfig,
	): this;
}

/**
 * Type helper to add admin methods to a QuestpieBuilder type.
 *
 * @example
 * ```ts
 * const builder = q({ name: "app" }).use(adminModule) as WithAdminMethods<typeof q>;
 * ```
 */
export type WithAdminMethods<T> = T & QuestpieBuilderAdminMethods;

/**
 * Type helper to add admin methods to a CollectionBuilder type.
 */
export type WithCollectionAdminMethods<
	T,
	TFields extends Record<string, any> = Record<string, any>,
	TListViewNames extends string = string,
	TEditViewNames extends string = string,
	TComponentNames extends string = string,
> = T &
	CollectionBuilderAdminMethods<
		TFields,
		TListViewNames,
		TEditViewNames,
		TComponentNames
	>;

/**
 * Type helper to add admin methods to a GlobalBuilder type.
 */
export type WithGlobalAdminMethods<
	T,
	TFields extends Record<string, any> = Record<string, any>,
	TEditViewNames extends string = string,
	TComponentNames extends string = string,
> = T & GlobalBuilderAdminMethods<TFields, TEditViewNames, TComponentNames>;

declare module "questpie" {
	// ==========================================================================
	// EXTENSION INTERFACES - Using new lazy evaluation pattern
	// ==========================================================================
	// These extensions use FieldsOf<this> which is evaluated LAZILY, avoiding
	// type explosion when combining many collections via .use() and .collections().

	/**
	 * Admin methods for QuestpieBuilder.
	 * Added via runtime monkey patching in ./patch.ts.
	 */
	interface QuestpieBuilderExtensions extends QuestpieBuilderAdminMethods {
		/**
		 * Configure admin UI locales (separate from content locales).
		 *
		 * UI locales control the admin interface language.
		 * Content locales control which languages content can be edited in.
		 * These don't need to match.
		 *
		 * @example
		 * ```ts
		 * const cms = q({ name: "my-app" })
		 *   .use(adminModule)
		 *   // Content can be in 10 languages
		 *   .locale({
		 *     locales: [{ code: "en" }, { code: "sk" }, { code: "de" }, ...],
		 *     defaultLocale: "en",
		 *   })
		 *   // But admin UI only in 2 languages
		 *   .adminLocale({
		 *     locales: ["en", "sk"],
		 *     defaultLocale: "en",
		 *   })
		 *   .build({ ... });
		 * ```
		 */
		adminLocale(config: AdminLocaleConfig): this;

		/**
		 * Create a block builder bound to this Questpie builder.
		 * The block has access to all registered field types.
		 *
		 * @example
		 * ```ts
		 * const qb = q.use(adminModule);
		 *
		 * const heroBlock = qb.block("hero")
		 *   .label({ en: "Hero Section" })
		 *   .icon("ph:image")
		 *   .fields((f) => ({
		 *     title: f.text({ required: true }),  // typed from builder's field registry
		 *     subtitle: f.text(),
		 *   }));
		 *
		 * const cms = qb
		 *   .blocks({ hero: heroBlock })
		 *   .build({ ... });
		 * ```
		 */
		block<TName extends string>(
			name: TName,
		): BlockBuilder<
			{ name: TName },
			QuestpieStateOf<this> extends {
				fields: infer F extends Record<string, any>;
			}
				? F
				: Record<string, any>
		>;
	}

	/**
	 * Admin methods for CollectionBuilder.
	 * Uses FieldsOf<this> for lazy field type extraction - this prevents
	 * type explosion (TS7056) when combining many collections.
	 */
	interface CollectionBuilderExtensions {
		/**
		 * Set admin metadata for the collection.
		 */
		admin(
			configOrFn:
				| AdminCollectionConfig
				| ((
						ctx: AdminConfigContext<RegisteredComponentNamesOfBuilder<this>>,
				  ) => AdminCollectionConfig),
		): this;

		/**
		 * Configure list view for the collection.
		 * Field proxy `f` provides autocomplete for field names.
		 */
		list(
			configFn: (
				ctx: ListViewConfigContext<
					FieldsOf<this>,
					RegisteredListViewNamesOfBuilder<this>
				>,
			) => ListViewConfig,
		): this;

		/**
		 * Configure form view for the collection.
		 */
		form(
			configFn: (
				ctx: FormViewConfigContext<
					FieldsOf<this>,
					RegisteredEditViewNamesOfBuilder<this>
				>,
			) => FormViewConfig,
		): this;

		/**
		 * Configure preview for the collection.
		 */
		preview(config: PreviewConfig): this;

		/**
		 * Configure actions for the collection.
		 */
		actions(
			configFn: (
				ctx: ActionsConfigContext<
					FieldsOf<this>,
					RegisteredComponentNamesOfBuilder<this>
				>,
			) => ServerActionsConfig,
		): this;
	}

	/**
	 * Admin methods for GlobalBuilder.
	 * Uses GlobalFieldsOf<this> for lazy field type extraction.
	 */
	interface GlobalBuilderExtensions {
		/**
		 * Set admin metadata for the global.
		 */
		admin(
			configOrFn:
				| AdminGlobalConfig
				| ((
						ctx: AdminConfigContext<RegisteredComponentNamesOfBuilder<this>>,
				  ) => AdminGlobalConfig),
		): this;

		/**
		 * Configure form view for the global.
		 */
		form(
			configFn: (
				ctx: FormViewConfigContext<
					GlobalFieldsOf<this>,
					RegisteredEditViewNamesOfBuilder<this>
				>,
			) => FormViewConfig,
		): this;
	}

	// ==========================================================================
	// STATE EXTENSIONS - For storing admin config in builder state
	// ==========================================================================

	// Extend QuestpieBuilderState to include admin-specific properties
	interface QuestpieBuilderState<
		TName extends string = string,
		TCollections extends BuilderCollectionsMap = BuilderCollectionsMap,
		TGlobals extends BuilderGlobalsMap = BuilderGlobalsMap,
		TJobs extends BuilderJobsMap = BuilderJobsMap,
		TEmailTemplates extends BuilderEmailTemplatesMap = BuilderEmailTemplatesMap,
		TAuth extends BetterAuthOptions | Record<never, never> = Record<
			never,
			never
		>,
		TMessageKeys extends string = never,
		TBuilderFields extends BuilderFieldsMap = BuilderFieldsMap,
	> {
		listViews?: Record<string, ListViewDefinition>;
		editViews?: Record<string, EditViewDefinition>;
		components?: Record<string, ComponentDefinition>;
		blocks?: Record<string, AnyBlockDefinition>;
		dashboard?: ServerDashboardConfig;
		sidebar?: ServerSidebarConfig;
		branding?: ServerBrandingConfig;
		/** Admin UI locale configuration (separate from content locales) */
		adminLocale?: AdminLocaleConfig;
	}

	// Extend CollectionBuilderState to include admin-specific properties
	interface CollectionBuilderState {
		admin?: AdminCollectionConfig;
		adminList?: ListViewConfig;
		adminForm?: FormViewConfig;
		adminPreview?: PreviewConfig;
		adminActions?: ServerActionsConfig;
	}

	// Extend GlobalBuilderState to include admin-specific properties
	interface GlobalBuilderState {
		admin?: AdminGlobalConfig;
		adminForm?: FormViewConfig;
	}
}
