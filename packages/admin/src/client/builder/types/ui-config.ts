/**
 * UI Configuration Types
 *
 * Types for dashboard, sidebar, branding, and locale configuration.
 */

import type { ComponentReference } from "../../../server/augmentation/index.js";
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
	/** Stable section ID */
	id?: string;
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
	/** Fixed row height for widgets in this section */
	rowHeight?: number | string;
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
	/** Stable tabs group ID */
	id?: string;
	/** Tab configurations */
	tabs: DashboardTabConfig[];
	/** Default active tab ID */
	defaultTab?: string;
	/** Custom CSS class */
	className?: string;
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
	/** Grid columns for this tab */
	columns?: number;
	/** Fixed row height for widgets in this tab */
	rowHeight?: number | string;
	/** Gap between tab items */
	gap?: number;
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
	/** Fixed row height for dashboard widgets */
	rowHeight?: number | string;
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

/**
 * Locale configuration
 */
export interface LocaleConfig {
	default?: string;
	supported?: string[];
}
