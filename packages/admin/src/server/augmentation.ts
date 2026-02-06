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
} from "questpie";
import type { I18nText } from "questpie/shared";
import type { AnyBlockBuilder, AnyBlockDefinition } from "./block/index.js";

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
export interface ComponentReference<TType extends string = string> {
	type: TType;
	props: Record<string, unknown>;
}

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
	icon?: ComponentReference<"icon">;
	/** Hide from admin sidebar */
	hidden?: boolean;
	/** Group in sidebar */
	group?: string;
	/** Order within group */
	order?: number;
}

/**
 * List view configuration for a collection.
 * Defines columns, sorting, filtering, and actions.
 */
export interface ListViewConfig {
	/** View type to use (e.g., "table", "cards") */
	view?: string;
	/** Columns to display */
	columns?: FieldReference[];
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

/**
 * Form view configuration for a collection.
 * Defines field layout, sections, and tabs.
 */
export interface FormViewConfig {
	/** View type to use (e.g., "form", "wizard") */
	view?: string;
	/** Fields to include */
	fields?: FieldReference[];
	/** Form sections */
	sections?: FormSection[];
	/** Form tabs */
	tabs?: FormTab[];
}

/**
 * Form section configuration
 */
export interface FormSection {
	/** Section label */
	label?: I18nText;
	/** Section description */
	description?: I18nText;
	/** Fields in this section */
	fields: FieldReference[];
	/** Collapsible section */
	collapsible?: boolean;
	/** Default collapsed state */
	defaultCollapsed?: boolean;
}

/**
 * Form tab configuration
 */
export interface FormTab {
	/** Tab label */
	label: I18nText;
	/** Tab icon */
	icon?: ComponentReference<"icon">;
	/** Sections in this tab */
	sections: FormSection[];
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
 * Reference to a field in the collection
 */
export type FieldReference = string;

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
	icon?: ComponentReference<"icon">;
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
 */
export type WidgetFetchContext = {
	cms: any;
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
	icon?: ComponentReference<"icon">;
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
	icon?: ComponentReference<"icon">;
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
	icon?: ComponentReference<"icon">;
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
	fetchFn: (
		ctx: WidgetFetchContext,
	) => Promise<
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
	icon?: ComponentReference<"icon">;
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
	icon?: ComponentReference<"icon">;
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
 * Server-side dashboard configuration
 */
export interface ServerDashboardConfig {
	/** Dashboard title */
	title?: I18nText;
	/** Dashboard description */
	description?: I18nText;
	/** Grid columns (default: 4) */
	columns?: number;
	/** Gap between widgets */
	gap?: number;
	/** Dashboard items */
	items?: ServerDashboardItem[];
	/** Auto-refresh interval in milliseconds */
	refreshInterval?: number;
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
	icon?: ComponentReference<"icon">;
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
	icon?: ComponentReference<"icon">;
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
	icon?: ComponentReference<"icon">;
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
	icon?: ComponentReference<"icon">;
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
	icon?: ComponentReference<"icon">;
	/** Whether collapsed by default */
	collapsed?: boolean;
	/** Section items */
	items: ServerSidebarItem[];
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
	/** CMS app instance */
	app: unknown;
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
	icon?: ComponentReference<"icon">;
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
	/** Component helpers */
	c: {
		icon: (name: string) => ComponentReference<"icon">;
	};
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
 * Context for dashboard config function
 */
export interface DashboardConfigContext {
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
	/** Component helpers */
	c: {
		icon: (name: string) => ComponentReference<"icon">;
	};
}

/**
 * Context for sidebar config function
 */
export interface SidebarConfigContext {
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
	/** Component helpers */
	c: {
		icon: (name: string) => ComponentReference<"icon">;
	};
}

// ============================================================================
// Admin Builder Context Types
// ============================================================================

/**
 * Context for admin config functions with component proxy
 */
export interface AdminConfigContext {
	c: {
		/** Create an icon reference */
		icon: (name: string) => ComponentReference<"icon">;
		/** Create a badge reference */
		badge: (props: {
			text: string;
			color?: string;
		}) => ComponentReference<"badge">;
	};
}

/**
 * Context for list view config functions
 */
export interface ListViewConfigContext<
	TFields extends Record<string, any> = Record<string, any>,
> {
	/** View factory */
	v: {
		table: (config: Omit<ListViewConfig, "view">) => ListViewConfig;
		cards: (config: Omit<ListViewConfig, "view">) => ListViewConfig;
	};
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
> {
	/** View factory */
	v: {
		form: (config: Omit<FormViewConfig, "view">) => FormViewConfig;
		wizard: (config: Omit<FormViewConfig, "view">) => FormViewConfig;
	};
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
export interface QuestpieBuilderAdminMethods {
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
	 * .dashboard(({ d, c }) => d.dashboard({
	 *   title: { en: "Dashboard" },
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
		configFn: (ctx: DashboardConfigContext) => ServerDashboardConfig,
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
	sidebar(configFn: (ctx: SidebarConfigContext) => ServerSidebarConfig): this;
}

/**
 * Admin methods added to CollectionBuilder via monkey patching.
 */
export interface CollectionBuilderAdminMethods<
	TFields extends Record<string, any> = Record<string, any>,
> {
	/**
	 * Set admin metadata for the collection.
	 */
	admin(
		configOrFn:
			| AdminCollectionConfig
			| ((ctx: AdminConfigContext) => AdminCollectionConfig),
	): this;

	/**
	 * Configure list view for the collection.
	 */
	list(configFn: (ctx: ListViewConfigContext<TFields>) => ListViewConfig): this;

	/**
	 * Configure form view for the collection.
	 */
	form(configFn: (ctx: FormViewConfigContext<TFields>) => FormViewConfig): this;

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
		configFn: (ctx: ActionsConfigContext<TFields>) => ServerActionsConfig,
	): this;
}

/**
 * Admin methods added to GlobalBuilder via monkey patching.
 */
export interface GlobalBuilderAdminMethods<
	TFields extends Record<string, any> = Record<string, any>,
> {
	/**
	 * Set admin metadata for the global.
	 */
	admin(
		configOrFn:
			| AdminGlobalConfig
			| ((ctx: AdminConfigContext) => AdminGlobalConfig),
	): this;

	/**
	 * Configure form view for the global.
	 */
	form(configFn: (ctx: FormViewConfigContext<TFields>) => FormViewConfig): this;
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
> = T & CollectionBuilderAdminMethods<TFields>;

/**
 * Type helper to add admin methods to a GlobalBuilder type.
 */
export type WithGlobalAdminMethods<
	T,
	TFields extends Record<string, any> = Record<string, any>,
> = T & GlobalBuilderAdminMethods<TFields>;

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
				| ((ctx: AdminConfigContext) => AdminCollectionConfig),
		): this;

		/**
		 * Configure list view for the collection.
		 * Field proxy `f` provides autocomplete for field names.
		 */
		list(
			configFn: (ctx: ListViewConfigContext<FieldsOf<this>>) => ListViewConfig,
		): this;

		/**
		 * Configure form view for the collection.
		 */
		form(
			configFn: (ctx: FormViewConfigContext<FieldsOf<this>>) => FormViewConfig,
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
				ctx: ActionsConfigContext<FieldsOf<this>>,
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
				| ((ctx: AdminConfigContext) => AdminGlobalConfig),
		): this;

		/**
		 * Configure form view for the global.
		 */
		form(
			configFn: (
				ctx: FormViewConfigContext<GlobalFieldsOf<this>>,
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
