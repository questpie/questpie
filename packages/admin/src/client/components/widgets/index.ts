/**
 * Dashboard Widgets
 */

// Type exports
export type { ChartWidgetConfig, ChartWidgetProps } from "./chart-widget";
// Default exports
export { default as ChartWidget } from "./chart-widget";
export type { ProgressWidgetProps } from "./progress-widget";
export { default as ProgressWidget } from "./progress-widget";
export type { QuickActionsWidgetProps } from "./quick-actions-widget";
export { default as QuickActionsWidget } from "./quick-actions-widget";
export type {
  RecentItemsWidgetConfig,
  RecentItemsWidgetProps,
} from "./recent-items-widget";
export { default as RecentItemsWidget } from "./recent-items-widget";
export type { StatsWidgetConfig, StatsWidgetProps } from "./stats-widget";
export { default as StatsWidget } from "./stats-widget";
export type { TableWidgetProps } from "./table-widget";
export { default as TableWidget } from "./table-widget";
export type { TimelineWidgetProps } from "./timeline-widget";
export { default as TimelineWidget } from "./timeline-widget";
export type { ValueWidgetProps } from "./value-widget";
export { default as ValueWidget } from "./value-widget";

// Skeleton exports
export {
  ChartWidgetSkeleton,
  GenericWidgetSkeleton,
  ProgressWidgetSkeleton,
  QuickActionsWidgetSkeleton,
  RecentItemsWidgetSkeleton,
  StatsWidgetSkeleton,
  TableWidgetSkeleton,
  TimelineWidgetSkeleton,
  ValueWidgetSkeleton,
} from "./widget-skeletons";
