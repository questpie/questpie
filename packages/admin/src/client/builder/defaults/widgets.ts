/**
 * Built-in Widget Definitions
 *
 * Registers all built-in dashboard widgets through the widget registry.
 * Uses lazy imports to avoid bundling everything upfront.
 */

import { widget } from "../widget/widget";

const StatsWidget = () => import("../../components/widgets/stats-widget");
const ChartWidget = () => import("../../components/widgets/chart-widget");
const RecentItemsWidget = () =>
  import("../../components/widgets/recent-items-widget");
const QuickActionsWidget = () =>
  import("../../components/widgets/quick-actions-widget");
const ValueWidget = () => import("../../components/widgets/value-widget");
const TableWidget = () => import("../../components/widgets/table-widget");
const TimelineWidget = () => import("../../components/widgets/timeline-widget");
const ProgressWidget = () => import("../../components/widgets/progress-widget");

export const builtInWidgets = {
  stats: widget("stats", { component: StatsWidget }),
  chart: widget("chart", { component: ChartWidget }),
  recentItems: widget("recentItems", { component: RecentItemsWidget }),
  quickActions: widget("quickActions", { component: QuickActionsWidget }),
  value: widget("value", { component: ValueWidget }),
  table: widget("table", { component: TableWidget }),
  timeline: widget("timeline", { component: TimelineWidget }),
  progress: widget("progress", { component: ProgressWidget }),
} as const;
