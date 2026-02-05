/**
 * UI Configuration Types
 *
 * Types for dashboard, sidebar, branding, and locale configuration.
 */

import type { ComponentReference } from "#questpie/admin/server";
import type { I18nText } from "../../i18n/types.js";
import type { DynamicI18nText, IconComponent } from "./common";
import type { WidgetConfig } from "./widget-types";

// ============================================================================
// Dashboard Action Types
// ============================================================================

/**
 * Dashboard action item - simplified action for dashboard header
 */
export interface DashboardAction {
	/** Unique action ID */
	id: string;
	/** Action label */
	label: DynamicI18nText;
	/** Action icon */
	icon?: IconComponent | ComponentReference;
	/** Link URL */
	href?: string;
	/** Click handler */
	onClick?: () => void;
	/** Visual variant */
	variant?: "default" | "primary" | "secondary" | "outline" | "ghost";
}

// ============================================================================
// Dashboard Configuration
// ============================================================================

/**
 * Widget card visual variant
 */
export type WidgetCardVariant = "default" | "compact" | "featured";

/**
 * Dashboard layout item - can be a widget, section, or tabs
 */
export type DashboardLayoutItem =
	| WidgetConfig
	| DashboardSection
	| DashboardTabs;

/**
 * Dashboard section - groups widgets together
 *
 * @example
 * ```ts
 * {
 *   type: "section",
 *   label: { en: "Sales Overview", sk: "Prehľad predaja" },
 *   layout: "grid",
 *   columns: 3,
 *   items: [
 *     { type: "stats", ... },
 *     { type: "chart", ... },
 *   ]
 * }
 * ```
 */
export interface DashboardSection {
	type: "section";
	/** Section label */
	label?: DynamicI18nText;
	/** Section description */
	description?: DynamicI18nText;
	/** Section icon */
	icon?: IconComponent | ComponentReference;
	/** Wrapper style */
	wrapper?: "flat" | "card" | "collapsible";
	/** Whether collapsed by default (for collapsible wrapper) */
	defaultCollapsed?: boolean;
	/** Layout mode */
	layout?: "grid" | "stack";
	/** Grid columns (for grid layout) */
	columns?: number;
	/** Gap between items */
	gap?: number;
	/** Section items */
	items: DashboardLayoutItem[];
	/** Custom CSS class */
	className?: string;
}

/**
 * Dashboard tabs - tabbed widget groups
 *
 * @example
 * ```ts
 * {
 *   type: "tabs",
 *   tabs: [
 *     {
 *       id: "overview",
 *       label: { en: "Overview", sk: "Prehľad" },
 *       items: [...widgets]
 *     },
 *     {
 *       id: "analytics",
 *       label: { en: "Analytics", sk: "Analytika" },
 *       items: [...widgets]
 *     }
 *   ]
 * }
 * ```
 */
export interface DashboardTabs {
	type: "tabs";
	/** Tab configurations */
	tabs: DashboardTabConfig[];
	/** Default active tab ID */
	defaultTab?: string;
	/** Tabs visual variant */
	variant?: "default" | "line" | "pills";
}

/**
 * Single tab configuration
 */
export interface DashboardTabConfig {
	/** Unique tab ID */
	id: string;
	/** Tab label */
	label: DynamicI18nText;
	/** Tab icon */
	icon?: IconComponent | ComponentReference;
	/** Tab items (widgets or sections) */
	items: DashboardLayoutItem[];
	/** Badge text (e.g., count) */
	badge?: string | number;
}

/**
 * Dashboard configuration
 */
export interface DashboardConfig {
	/** Dashboard layout mode */
	layout?: "grid" | "list";
	/** Dashboard title - supports inline translations */
	title?: DynamicI18nText;
	/** Dashboard description - supports inline translations */
	description?: DynamicI18nText;
	/** Grid columns (default: 4) */
	columns?: number;
	/** Gap between widgets */
	gap?: number;
	/** Dashboard items - widgets, sections, or tabs */
	items?: DashboardLayoutItem[];
	/**
	 * @deprecated Use `items` instead
	 */
	widgets?: WidgetConfig[];
	/** Default widget card variant */
	defaultCardVariant?: WidgetCardVariant;
	/** Show refresh button in header */
	showRefresh?: boolean;
	/** Auto-refresh interval in milliseconds */
	refreshInterval?: number;
	/** Enable realtime invalidation for dashboard widgets by default */
	realtime?: boolean;
	/** Header actions (buttons in dashboard header) */
	actions?: DashboardAction[];
}

// ============================================================================
// Sidebar Configuration
// ============================================================================

/**
 * Sidebar configuration
 */
export interface SidebarConfig<TSectionIds extends string = string> {
	sections: SidebarSection<TSectionIds>[];
}

/**
 * Sidebar section with required ID for targeting
 */
export interface SidebarSection<TId extends string = string> {
	/** Unique ID for targeting this section (required for extend) */
	id: TId;
	/** Display title - supports inline translations */
	title?: I18nText;
	/** Section icon */
	icon?: IconComponent | ComponentReference;
	/** Whether section is collapsed by default */
	collapsed?: boolean;
	/** Items in this section */
	items: SidebarItem[];
}

/**
 * Sidebar item types
 */
export type SidebarItem =
	| SidebarCollectionItem
	| SidebarGlobalItem
	| SidebarPageItem
	| SidebarLinkItem
	| SidebarDividerItem;

export interface SidebarCollectionItem {
	type: "collection";
	/** Collection name */
	collection: string;
	/** Override display label (defaults to collection label) - supports inline translations */
	label?: I18nText;
	/** Override icon */
	icon?: IconComponent | ComponentReference;
}

export interface SidebarGlobalItem {
	type: "global";
	/** Global name */
	global: string;
	/** Override display label (defaults to global label) - supports inline translations */
	label?: I18nText;
	/** Override icon */
	icon?: IconComponent | ComponentReference;
}

export interface SidebarPageItem {
	type: "page";
	/** Page ID */
	pageId: string;
	/** Override display label - supports inline translations */
	label?: I18nText;
	/** Override icon */
	icon?: IconComponent | ComponentReference;
}

export interface SidebarLinkItem {
	type: "link";
	/** Display label - supports inline translations */
	label: I18nText;
	/** Link URL */
	href: string;
	/** Icon */
	icon?: IconComponent | ComponentReference;
	/** Open in new tab */
	external?: boolean;
}

export interface SidebarDividerItem {
	type: "divider";
}

/**
 * Branding configuration
 */
export interface BrandingConfig {
	/** Brand name - supports inline translations */
	name?: I18nText;
	logo?: IconComponent | ComponentReference;
	favicon?: string;
	primaryColor?: string;
}

/**
 * Locale configuration
 */
export interface LocaleConfig {
	default?: string;
	supported?: string[];
}
