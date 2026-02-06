/**
 * Widget Component Types
 *
 * Types for dashboard widgets and widget configuration.
 */

import type * as React from "react";
import type { ComponentReference } from "#questpie/admin/server";
import type { I18nText } from "../../i18n/types";
import type {
  DynamicI18nText,
  IconComponent,
  MaybeLazyComponent,
} from "./common";

// ============================================================================
// Base Widget Config
// ============================================================================

/**
 * Widget card visual variant
 */
export type WidgetCardVariant = "default" | "compact" | "featured";

/**
 * Base widget configuration shared by all widget types
 */
export interface BaseWidgetConfig {
  /**
   * Widget ID
   */
  id: string;

  /**
   * Widget title
   */
  title?: I18nText;

  /**
   * Widget description
   */
  description?: I18nText;

  /**
   * Widget icon
   */
  icon?: IconComponent | ComponentReference | string;

  /**
   * Card visual variant
   */
  cardVariant?: WidgetCardVariant;

  /**
   * Widget size
   */
  size?: "small" | "medium" | "large" | "full";

  /**
   * Column span (1-12)
   */
  span?: number;

  /**
   * Grid position (for dashboard layouts)
   */
  position?: {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
  };

  /**
   * Data source configuration
   */
  dataSource?: WidgetDataSource;

  /**
   * Widget-specific options
   */
  options?: Record<string, any>;

  /**
   * Refresh interval in milliseconds
   */
  refreshInterval?: number;

  /**
   * Enable realtime invalidation for widget data queries.
   * Falls back to AdminProvider realtime config when undefined.
   */
  realtime?: boolean;

  /**
   * Header actions
   */
  actions?: WidgetAction[];

  /**
   * Custom CSS class
   */
  className?: string;

  /**
   * Indicates server has a fetchFn for this widget (set by getAdminConfig).
   * When true, the widget fetches data via the fetchWidgetData RPC endpoint
   * instead of calling a client-side fetchFn.
   */
  hasFetchFn?: boolean;
}

// ============================================================================
// Specific Widget Types
// ============================================================================

/**
 * Date filter presets for time-based filtering
 */
export type DateFilterPreset =
  | "today"
  | "yesterday"
  | "thisWeek"
  | "lastWeek"
  | "thisMonth"
  | "lastMonth"
  | "last7days"
  | "last30days"
  | "last90days"
  | "thisYear"
  | "lastYear";

/**
 * Date filter configuration
 */
export interface DateFilterConfig {
  /**
   * Field name to filter on (e.g., "createdAt", "scheduledAt")
   */
  field: string;
  /**
   * Preset time range
   */
  range: DateFilterPreset;
}

/**
 * Stats widget configuration
 */
export interface StatsWidgetConfig extends BaseWidgetConfig {
  type: "stats";
  collection: string;
  label?: I18nText;
  /**
   * Static filter (evaluated at build time)
   */
  filter?: Record<string, any>;
  /**
   * Dynamic filter function (evaluated at render time)
   * Use this for filters that depend on current date/time
   */
  filterFn?: () => Record<string, any>;
  /**
   * Date filter preset (evaluated at render time)
   * Shorthand for common date-based filters
   */
  dateFilter?: DateFilterConfig;
  variant?: "default" | "primary" | "success" | "warning" | "danger";
}

/**
 * Chart widget configuration
 */
export interface ChartWidgetConfig extends BaseWidgetConfig {
  type: "chart";
  collection: string;
  field: string;
  chartType?: "line" | "bar" | "area" | "pie";
  timeRange?: "7d" | "30d" | "90d" | "1y";
  label?: I18nText;
  color?: string;
  showGrid?: boolean;
  aggregation?: "count" | "sum" | "average";
  valueField?: string;
}

/**
 * Recent items widget configuration
 */
export interface RecentItemsWidgetConfig extends BaseWidgetConfig {
  type: "recentItems";
  collection: string;
  limit?: number;
  titleField?: string;
  dateField?: string;
  subtitleFields?: string[];
  label?: I18nText;
}

/**
 * Quick action item configuration
 */
export interface QuickActionItem {
  /** Action label */
  label: I18nText;
  /** Action icon */
  icon?: IconComponent | ComponentReference | string;
  /** Link URL */
  href?: string;
  /** Click handler */
  onClick?: () => void;
  /** Visual variant */
  variant?: "default" | "primary" | "secondary" | "outline";
}

/**
 * Quick actions widget configuration
 */
export interface QuickActionsWidgetConfig extends BaseWidgetConfig {
  type: "quickActions";
  /** List of quick action items */
  quickActions: Array<string | QuickActionItem>;
  /** Layout variant */
  layout?: "grid" | "list";
}

/**
 * Custom widget configuration
 */
export interface CustomWidgetConfig extends BaseWidgetConfig {
  type: "custom";
  component: MaybeLazyComponent<WidgetComponentProps>;
  config?: Record<string, any>;
}

// ============================================================================
// Value Widget - Flexible widget with async data fetching
// ============================================================================

/**
 * ClassNames for styling value widget parts
 */
export interface ValueWidgetClassNames {
  /** Card container */
  root?: string;
  /** Header wrapper */
  header?: string;
  /** Label text */
  label?: string;
  /** Main icon */
  icon?: ComponentReference | string;
  /** Content wrapper */
  content?: string;
  /** Main value display */
  value?: string;
  /** Trend wrapper + text */
  trend?: string;
  /** Trend icon */
  trendIcon?: string;
  /** Subtitle text */
  subtitle?: string;
  /** Footer text */
  footer?: string;
}

/**
 * Trend indicator configuration
 */
export interface ValueWidgetTrend {
  /** Trend value (e.g., "+15.3%", "-5%") */
  value: string;
  /** Optional trend icon */
  icon?: IconComponent | ComponentReference;
}

/**
 * Result returned by fetchFn
 */
export interface ValueWidgetResult {
  /** Main value to display */
  value: number | string;
  /** Formatted value (if not provided, value.toLocaleString() is used) */
  formatted?: string;
  /** Label/title - supports i18n objects */
  label?: I18nText | string;
  /** Subtitle text - supports i18n objects */
  subtitle?: I18nText | string;
  /** Footer text - supports i18n objects */
  footer?: I18nText | string;
  /** Main icon */
  icon?: IconComponent | ComponentReference;
  /** Trend indicator */
  trend?: ValueWidgetTrend;
  /** Tailwind classes for each part */
  classNames?: ValueWidgetClassNames;
}

/**
 * Value widget configuration
 *
 * Flexible widget that fetches data via async function and supports
 * full customization through Tailwind classes.
 *
 * @example
 * ```tsx
 * {
 *   type: "value",
 *   fetchFn: async (client) => {
 *     const count = await client.collections.appointments.count({
 *       where: { status: "pending" }
 *     });
 *     return {
 *       value: count,
 *       label: "Pending",
 *       icon: Clock,
 *       classNames: {
 *         root: count > 10 ? "border-red-300 bg-red-50" : "",
 *         value: count > 10 ? "text-red-600" : "",
 *       },
 *     };
 *   },
 * }
 * ```
 */
export interface ValueWidgetConfig extends BaseWidgetConfig {
  type: "value";

  /**
   * Async function to fetch and transform data.
   * Receives the Questpie client and returns widget display data.
   * Optional when hasFetchFn is true (server provides the data).
   */
  fetchFn?: (client: any) => Promise<ValueWidgetResult>;

  /**
   * Refresh interval in milliseconds
   * If set, the widget will refetch data at this interval
   */
  refreshInterval?: number;
}

// ============================================================================
// Table Widget - Mini table display
// ============================================================================

/**
 * Table column configuration with overrides
 */
export interface TableWidgetColumnConfig {
  /** Column key (field name) */
  key: string;
  /** Override column header label (defaults to field label) */
  label?: I18nText;
  /** Column width */
  width?: number | string;
  /** Text alignment */
  align?: "left" | "center" | "right";
  /** Custom cell renderer (overrides field's cell) */
  render?: (value: any, row: any) => React.ReactNode;
}

/**
 * Table column - can be a simple field key string or full config object
 *
 * @example
 * ```ts
 * // Simple - just field keys, uses field definitions automatically
 * columns: ["name", "status", "createdAt"]
 *
 * // With overrides
 * columns: [
 *   "name",
 *   { key: "price", align: "right" },
 *   { key: "rating", render: (v) => `${v}/5` },
 * ]
 * ```
 */
export type TableWidgetColumn = string | TableWidgetColumnConfig;

/**
 * Table widget configuration - displays a mini table
 *
 * Columns can be simple field keys (strings) or objects with overrides.
 * Field definitions (label, cell renderer) are automatically pulled
 * from the collection's admin config.
 *
 * @example
 * ```ts
 * {
 *   type: "table",
 *   id: "recent-orders",
 *   title: "Recent Orders",
 *   collection: "orders",
 *   // Simple - field keys only, auto-uses field labels and cells
 *   columns: ["orderNumber", "customer", "total", "status"],
 *   limit: 5,
 * }
 *
 * // With overrides
 * {
 *   type: "table",
 *   collection: "reviews",
 *   columns: [
 *     "customer",
 *     { key: "rating", render: (v) => `${v}/5` },
 *     "comment",
 *   ],
 * }
 * ```
 */
export interface TableWidgetConfig extends BaseWidgetConfig {
  type: "table";
  /** Collection to fetch from */
  collection: string;
  /** Columns to display - field keys or config objects */
  columns: TableWidgetColumn[];
  /** Number of rows to show */
  limit?: number;
  /** Sort field */
  sortBy?: string;
  /** Sort direction */
  sortOrder?: "asc" | "desc";
  /** Filter */
  filter?: Record<string, any>;
  /** Show row actions */
  showActions?: boolean;
  /** Link rows to detail */
  linkToDetail?: boolean;
  /** Empty state message */
  emptyMessage?: I18nText;
}

// ============================================================================
// Timeline Widget - Activity/event timeline
// ============================================================================

/**
 * Timeline item configuration
 */
export interface TimelineItem {
  /** Item ID */
  id: string;
  /** Title */
  title: string;
  /** Description */
  description?: string;
  /** Timestamp */
  timestamp: Date | string;
  /** Icon */
  icon?: IconComponent | ComponentReference;
  /** Status/color variant */
  variant?: "default" | "success" | "warning" | "error" | "info";
  /** Link URL */
  href?: string;
  /** Additional metadata */
  meta?: Record<string, any>;
}

/**
 * Timeline widget configuration - displays activity/event timeline
 *
 * @example
 * ```ts
 * {
 *   type: "timeline",
 *   id: "recent-activity",
 *   title: "Recent Activity",
 *   fetchFn: async (client) => {
 *     const activities = await client.collections.activities.findMany({
 *       limit: 10,
 *       orderBy: { createdAt: "desc" }
 *     });
 *     return activities.map(a => ({
 *       id: a.id,
 *       title: a.action,
 *       description: a.description,
 *       timestamp: a.createdAt,
 *       variant: a.type === "error" ? "error" : "default"
 *     }));
 *   }
 * }
 * ```
 */
export interface TimelineWidgetConfig extends BaseWidgetConfig {
  type: "timeline";
  /** Async function to fetch timeline items. Optional when hasFetchFn is true. */
  fetchFn?: (client: any) => Promise<TimelineItem[]>;
  /** Max items to show */
  maxItems?: number;
  /** Show timestamps */
  showTimestamps?: boolean;
  /** Timestamp format */
  timestampFormat?: "relative" | "absolute" | "datetime";
  /** Empty state message */
  emptyMessage?: I18nText;
}

// ============================================================================
// Progress Widget - Progress/goal tracking
// ============================================================================

/**
 * Progress widget configuration - displays progress towards a goal
 *
 * @example
 * ```ts
 * {
 *   type: "progress",
 *   id: "monthly-sales",
 *   title: "Monthly Sales Goal",
 *   fetchFn: async (client) => ({
 *     current: 75000,
 *     target: 100000,
 *     label: "$75,000 / $100,000"
 *   })
 * }
 * ```
 */
export interface ProgressWidgetConfig extends BaseWidgetConfig {
  type: "progress";
  /** Async function to fetch progress data. Optional when hasFetchFn is true. */
  fetchFn?: (client: any) => Promise<{
    current: number;
    target: number;
    label?: string;
    subtitle?: string;
  }>;
  /** Progress bar color */
  color?: string;
  /** Show percentage */
  showPercentage?: boolean;
}

// ============================================================================
// Widget Configuration Union
// ============================================================================

/**
 * Known widget types (for type narrowing)
 */
export type KnownWidgetType =
  | "stats"
  | "chart"
  | "recentItems"
  | "quickActions"
  | "custom"
  | "value"
  | "table"
  | "timeline"
  | "progress";

/**
 * Widget configuration - discriminated union of all widget types
 */
export type WidgetConfig =
  | StatsWidgetConfig
  | ChartWidgetConfig
  | RecentItemsWidgetConfig
  | QuickActionsWidgetConfig
  | CustomWidgetConfig
  | ValueWidgetConfig
  | TableWidgetConfig
  | TimelineWidgetConfig
  | ProgressWidgetConfig;

/**
 * Generic widget configuration (for unknown/custom types registered at runtime)
 * This is kept separate from WidgetConfig to allow proper type narrowing
 */
export interface GenericWidgetConfig extends BaseWidgetConfig {
  type: string;
  component?: MaybeLazyComponent<WidgetComponentProps>;
  actions?: WidgetAction[];
  [key: string]: any;
}

/**
 * Any widget config (union of known configs and generic)
 */
export type AnyWidgetConfig = WidgetConfig | GenericWidgetConfig;

// ============================================================================
// Widget Component Props
// ============================================================================

/**
 * Props passed to widget components
 */
export interface WidgetComponentProps<TData = any> {
  /**
   * Widget configuration
   */
  config: WidgetConfig | Record<string, any>;

  /**
   * Widget data (from data source)
   */
  data?: TData;

  /**
   * Loading state
   */
  isLoading?: boolean;

  /**
   * Error state
   */
  error?: Error | null;

  /**
   * Refresh data
   */
  onRefresh?: () => void;

  /**
   * Column span for grid layout
   */
  span?: number;
}

/**
 * Widget data source configuration
 */
export interface WidgetDataSource {
  /**
   * Data source type
   */
  type: "collection" | "global" | "function" | "custom";

  /**
   * Collection name (for collection type)
   */
  collection?: string;

  /**
   * Global name (for global type)
   */
  global?: string;

  /**
   * Function name (for function type)
   */
  function?: string;

  /**
   * Query options
   */
  query?: Record<string, any>;

  /**
   * Custom data fetcher
   */
  fetcher?: () => Promise<any>;
}

/**
 * Widget action configuration
 */
export interface WidgetAction {
  /**
   * Action ID
   */
  id: string;

  /**
   * Action label
   */
  label: string;

  /**
   * Action icon
   */
  icon?: IconComponent | ComponentReference | string;

  /**
   * Action handler
   */
  onClick?: () => void;

  /**
   * Link target
   */
  href?: string;

  /**
   * Variant
   */
  variant?: "default" | "primary" | "secondary" | "destructive";
}

// ============================================================================
// Dashboard Configuration
// ============================================================================

/**
 * Extended dashboard configuration with widgets
 */
export interface DashboardWidgetConfig {
  /**
   * Dashboard layout
   */
  layout?: "grid" | "list" | "masonry";

  /**
   * Grid columns
   */
  columns?: number;

  /**
   * Gap between widgets
   */
  gap?: number;

  /**
   * Widget instances
   */
  widgets?: WidgetConfig[];

  /**
   * Default widgets (used when no custom config)
   */
  defaultWidgets?: string[];
}
