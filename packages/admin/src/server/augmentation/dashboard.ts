/**
 * Dashboard Types
 *
 * Server-side dashboard configuration: widgets, sections, tabs,
 * branding, and dashboard context types.
 */

import type { AppContext } from "questpie";
import type { I18nText } from "questpie/shared";

import type { ComponentReference } from "./common.js";
import type { ComponentFactory } from "./views.js";

// ============================================================================
// Server-Side Dashboard Configuration
// ============================================================================

/**
 * Context available to widget loader and access functions on the server.
 * Provides typed access to collections, globals, and infrastructure.
 */
export type WidgetFetchContext = AppContext & {
	/** Database handle — populated at runtime by extractAppServices */
	db: unknown;
	/** Collection APIs — populated at runtime by extractAppServices */
	collections: Record<string, any>;
	/** Global APIs — populated at runtime by extractAppServices */
	globals: Record<string, any>;
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
	/** Grid row span. span=2 + rowSpan=2 renders as a 2x2 tile. */
	rowSpan?: number;
	/** Optional server-side data loader (overrides collection count) */
	loader?: (ctx: WidgetFetchContext) => Promise<{ count: number }>;
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
	dateField?: string;
	/** Field to aggregate by (for pie charts, etc.) */
	field?: string;
	/** Time range */
	timeRange?: "7d" | "30d" | "90d" | "1y";
	/** Filter to apply */
	filter?: Record<string, unknown>;
	/** Grid span (1-4) */
	span?: number;
	/** Grid row span. */
	rowSpan?: number;
	/** Optional server-side data loader (overrides collection query) */
	loader?: (
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
	/** Grid row span. */
	rowSpan?: number;
	/** Optional server-side data loader */
	loader?: (ctx: WidgetFetchContext) => Promise<unknown>;
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
	/** Layout variant */
	layout?: "grid" | "list";
	/** Grid span (1-4) */
	span?: number;
	/** Grid row span. */
	rowSpan?: number;
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
	/** Visual variant */
	variant?: "default" | "primary" | "secondary" | "outline";
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
	/** Grid row span. */
	rowSpan?: number;
	/** Optional server-side data loader */
	loader?: (ctx: WidgetFetchContext) => Promise<unknown>;
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
	/** Card visual variant */
	cardVariant?: "default" | "compact" | "featured";
	/** Grid span (1-4) */
	span?: number;
	/** Grid row span. */
	rowSpan?: number;
	/** Auto-refresh interval in milliseconds */
	refreshInterval?: number;
	/** Server-side data loader (required) */
	loader: (ctx: WidgetFetchContext) => Promise<{
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
	/** Grid row span. */
	rowSpan?: number;
	/** Optional server-side data loader */
	loader?: (ctx: WidgetFetchContext) => Promise<unknown>;
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
	/** Grid row span. */
	rowSpan?: number;
	/** Server-side data loader (required) */
	loader: (ctx: WidgetFetchContext) => Promise<
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
	/** Grid row span. */
	rowSpan?: number;
	/** Server-side data loader (required) */
	loader: (ctx: WidgetFetchContext) => Promise<{
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
	/** Stable section ID, useful for keyed updates and contributions */
	id?: string;
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
	/** Fixed row height for widgets in this section */
	rowHeight?: number | string;
	/** Gap between items */
	gap?: number;
	/** Wrapper style */
	wrapper?: "flat" | "card" | "collapsible";
	/** Default collapsed (for collapsible) */
	defaultCollapsed?: boolean;
	/** Section items */
	items: ServerDashboardItem[];
	/** Custom CSS class */
	className?: string;
}

/**
 * Dashboard tabs - tabbed sections
 */
export interface ServerDashboardTabs {
	type: "tabs";
	/** Stable tabs group ID */
	id?: string;
	/** Tabs configuration */
	tabs: ServerDashboardTab[];
	/** Default active tab ID */
	defaultTab?: string;
	/** Custom CSS class */
	className?: string;
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
	/** Grid columns for this tab */
	columns?: number;
	/** Fixed row height for widgets in this tab */
	rowHeight?: number | string;
	/** Gap between tab items */
	gap?: number;
	/** Badge text */
	badge?: string | number;
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
	/** Fixed row height for dashboard widgets */
	rowHeight?: number | string;
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
 * Brand logo. Either a URL string (same image both modes), an object with
 * separate light/dark sources, or a server-registered component reference
 * (e.g. an SVG component you ship in your own package).
 */
export type BrandLogo =
	| string
	| {
			src: string;
			srcDark?: string;
			alt?: string;
			width?: number;
			height?: number;
	  }
	| ComponentReference;

/**
 * Branding configuration for the admin panel. Covers content only — name,
 * logo, tagline, favicon. Visual tokens (colors, fonts, radius, shadows)
 * are customized via `admin.css` overrides; see the admin theming docs.
 */
export interface ServerBrandingConfig {
	/** Admin panel name. Shown in sidebar header, document title, auth pages. */
	name?: I18nText;
	/** Logo. Renders next to the brand name in the sidebar and on auth pages. */
	logo?: BrandLogo;
	/** Optional sub-headline rendered on auth pages. Replaces "Built with QUESTPIE". */
	tagline?: I18nText;
	/** Favicon URL. Injected as `<link rel="icon">` during SSR head render. */
	favicon?: string;
}

// ============================================================================
// Dashboard Context Types
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
	TComponents extends Record<string, any> | string = string,
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
	c: ComponentFactory<TComponents>;
}

/**
 * Dashboard action proxy — provided in dashboard callbacks as `a`.
 * Creates dashboard header action objects.
 */
export interface DashboardActionProxy {
	/** Create link for a collection. */
	create(
		config: Omit<ServerDashboardAction, "href"> & { collection: string },
	): ServerDashboardAction;
	/** Edit link for a global. */
	global(
		config: Omit<ServerDashboardAction, "href"> & { global: string },
	): ServerDashboardAction;
	/** Plain link. */
	link(config: ServerDashboardAction): ServerDashboardAction;
}

/**
 * Dashboard proxy — provided in dashboard callbacks as `d`.
 * Creates serializable widget/section objects.
 */
export interface DashboardProxy {
	/** Define a dashboard section. */
	section(def: DashboardSectionDef): DashboardSectionDef;
	/** Stats widget — count docs from a collection. */
	stats(def: DashboardItemDef): DashboardItemDef;
	/** Value widget — custom value from async loader. */
	value(def: DashboardItemDef): DashboardItemDef;
	/** Progress widget — progress bar from async loader. */
	progress(def: DashboardItemDef): DashboardItemDef;
	/** Chart widget — aggregate a field into chart. */
	chart(def: DashboardItemDef): DashboardItemDef;
	/** Recent items widget — latest docs from a collection. */
	recentItems(def: DashboardItemDef): DashboardItemDef;
	/** Timeline widget — event stream from async loader. */
	timeline(def: DashboardItemDef): DashboardItemDef;
	/** Table widget — tabular data from async loader. */
	table(def: DashboardItemDef): DashboardItemDef;
	/** Custom widget — resolved by client. */
	custom(def: DashboardItemDef): DashboardItemDef;
}

/**
 * Dashboard section definition for contributions.
 */
export interface DashboardSectionDef {
	/** Unique section ID. */
	id: string;
	/** Section title. */
	label?: I18nText;
	/** Section description. */
	description?: I18nText;
	/** Layout mode. */
	layout?: "grid" | "stack";
	/** Grid columns for this section. */
	columns?: number;
	/** Fixed row height for widgets in this section. */
	rowHeight?: number | string;
	/** Gap between section items. */
	gap?: number;
	/** Wrapper style. */
	wrapper?: "flat" | "card" | "collapsible";
	/** Default collapsed state for collapsible sections. */
	defaultCollapsed?: boolean;
	/** Custom CSS class. */
	className?: string;
}

/**
 * Dashboard item (widget) definition for contributions.
 * Each item references a sectionId to indicate which section it belongs to.
 */
export interface DashboardItemDef {
	/** Which section this item belongs to. */
	sectionId: string;
	/** 'start' to prepend, default is 'end' (append). */
	position?: "start" | "end";
	/** Unique widget ID. */
	id: string;
	/** Widget type. */
	type:
		| "stats"
		| "value"
		| "progress"
		| "chart"
		| "recentItems"
		| "timeline"
		| "table"
		| "custom";
	/** Display label. */
	label?: I18nText;
	/** Grid span (1-4). */
	span?: number;
	/** Grid row span. */
	rowSpan?: number;
	/** Refresh interval in ms. */
	refreshInterval?: number;
	/** Widget-specific config (collection, filter, loader, chartType, etc.) */
	[key: string]: unknown;
}

/**
 * Dashboard contribution — what a module or user config contributes.
 * Multiple contributions are merged by createApp() (§5.8.3).
 * Resolved from callback: `dashboard: ({ d, c, a }) => ({ ... })`
 */
export interface DashboardContribution {
	/** Dashboard title — last module/user wins. */
	title?: I18nText;
	/** Dashboard description — last module/user wins. */
	description?: I18nText;
	/** Grid columns — last module/user wins. */
	columns?: number;
	/** Fixed widget row height — last module/user wins. */
	rowHeight?: number | string;
	/** Widget gap — last module/user wins. */
	gap?: number;
	/** Enable realtime — last module/user wins. */
	realtime?: boolean;

	/** Quick actions — concatenated from all modules. */
	actions?: ServerDashboardAction[];
	/** Section definitions — merged by id across modules. */
	sections?: DashboardSectionDef[];
	/** Widget items — appended to sections by sectionId, or direct layout items. */
	items?: Array<DashboardItemDef | ServerDashboardItem>;
}

/**
 * Context for dashboard callbacks on module() and config().
 */
export interface DashboardCallbackContext {
	/** Dashboard builder proxy. */
	d: DashboardProxy;
	/** Component proxy (scoped to registered components). */
	c: ComponentFactory;
	/** Dashboard action proxy. */
	a: DashboardActionProxy;
}

/**
 * Dashboard callback type for module() and config().
 */
export type DashboardCallback = (
	ctx: DashboardCallbackContext,
) => DashboardContribution;
