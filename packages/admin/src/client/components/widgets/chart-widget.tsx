/**
 * Chart Widget
 *
 * Displays data visualization over time.
 * Uses WidgetCard for consistent styling.
 */

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipProps,
  XAxis,
  YAxis,
} from "recharts";
import type {
  NameType,
  ValueType,
} from "recharts/types/component/DefaultTooltipContent";
import { useCollectionList } from "../../hooks/use-collection";
import { useServerWidgetData } from "../../hooks/use-server-widget-data";
import { useResolveText } from "../../i18n/hooks";
import { formatCollectionName } from "../../lib/utils";
import { WidgetCard } from "../../views/dashboard/widget-card";
import { ChartWidgetSkeleton } from "./widget-skeletons";

/**
 * Chart widget config (local type for component props)
 */
export type ChartWidgetConfig = {
  id: string;
  collection: string;
  /** Field to aggregate by (e.g., "createdAt" for time series, "status" for categories) */
  field: string;
  chartType?: "line" | "bar" | "area" | "pie";
  timeRange?: "7d" | "30d" | "90d" | "1y";
  label?: string;
  realtime?: boolean;
  /** Color for the chart (CSS color value) */
  color?: string;
  /** Show grid lines */
  showGrid?: boolean;
  /** Aggregation type */
  aggregation?: "count" | "sum" | "average";
  /** Value field for sum/average aggregation */
  valueField?: string;
  /** Server has a fetchFn for this widget */
  hasFetchFn?: boolean;
  /** Refresh interval in ms */
  refreshInterval?: number;
};

/**
 * Chart widget props
 */
export type ChartWidgetProps = {
  config: ChartWidgetConfig;
};

// Theme-aware chart colors using CSS variables
// Note: CSS vars contain full oklch() value, so use var() directly
const CHART_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

/**
 * Custom tooltip component matching shadcn style
 */
function ChartTooltip({
  active,
  payload,
  label,
}: TooltipProps<ValueType, NameType>) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-md border border-border bg-background px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{label}</p>
      {payload.map((entry) => (
        <p key={String(entry.name)} className="text-muted-foreground">
          {entry.name}:{" "}
          <span className="font-medium text-foreground">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}

/**
 * Chart widget component
 *
 * Displays:
 * - Time series data visualization
 * - Multiple chart types (line, bar, area, pie)
 * - Configurable time ranges
 */
export default function ChartWidget({ config }: ChartWidgetProps) {
  const resolveText = useResolveText();
  const {
    collection,
    field,
    chartType = "area",
    timeRange = "30d",
    label,
    color = "var(--color-chart-1)",
    showGrid = true,
    realtime,
    hasFetchFn,
    refreshInterval,
  } = config;

  // Server-side data fetching (when hasFetchFn is true)
  type ChartDataPoint = { name: string; value: number };
  const serverQuery = useServerWidgetData<ChartDataPoint[]>(config.id, {
    enabled: !!hasFetchFn,
    refreshInterval,
  });

  // Fetch collection data (limited to 1000 items for performance)
  const collectionQuery = useCollectionList(
    collection as any,
    {
      limit: 1000,
    },
    undefined,
    { realtime },
  );

  const { isLoading, error, refetch } = hasFetchFn
    ? serverQuery
    : collectionQuery;

  // API returns PaginatedResult with { docs, totalDocs, ... }
  const collectionItems = hasFetchFn
    ? []
    : Array.isArray((collectionQuery.data as any)?.docs)
      ? (collectionQuery.data as any).docs
      : [];
  const displayLabel = label
    ? resolveText(label)
    : `${formatCollectionName(collection)} by ${field}`;

  // Process data for chart
  const chartData = React.useMemo(() => {
    // When using server data, it's already in the right format
    if (hasFetchFn) {
      return (serverQuery.data as ChartDataPoint[] | undefined) ?? [];
    }

    if (!collectionItems.length) return [];

    // Group by field value
    const grouped = collectionItems.reduce(
      (acc: Record<string, number>, item: any) => {
        const value = item[field];
        if (value === undefined || value === null) return acc;

        // For date fields, group by day/week/month based on timeRange
        let key: string;
        if (value instanceof Date || !isNaN(Date.parse(value))) {
          const date = new Date(value);
          key = formatDateForRange(date, timeRange);
        } else {
          key = String(value);
        }

        acc[key] = (acc[key] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    // Convert to array and sort
    return Object.entries(grouped)
      .map(([name, value]) => ({ name, value: value as number }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [hasFetchFn, serverQuery.data, collectionItems, field, timeRange]);

  // Empty state content
  const emptyContent = (
    <div className="flex h-48 items-center justify-center text-muted-foreground">
      <p className="text-sm">No data available</p>
    </div>
  );

  // Chart content
  const chartContent =
    chartData.length === 0 ? (
      emptyContent
    ) : (
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {renderChart(chartType, chartData, color, showGrid)}
        </ResponsiveContainer>
      </div>
    );

  return (
    <WidgetCard
      title={displayLabel}
      isLoading={isLoading}
      loadingSkeleton={<ChartWidgetSkeleton />}
      error={
        error instanceof Error ? error : error ? new Error(String(error)) : null
      }
      onRefresh={() => refetch()}
    >
      {chartContent}
    </WidgetCard>
  );
}

/**
 * Render the appropriate chart type
 */
function renderChart(
  type: ChartWidgetConfig["chartType"],
  data: Array<{ name: string; value: number }>,
  color: string,
  showGrid: boolean,
) {
  const commonProps = {
    data,
    margin: { top: 5, right: 5, left: -20, bottom: 5 },
  };

  // Use CSS color variables (already contain full oklch values)
  const axisStyle = {
    fontSize: 10,
    fill: "var(--color-muted-foreground)",
  };

  switch (type) {
    case "line":
      return (
        <LineChart {...commonProps}>
          {showGrid && (
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--color-border)"
              opacity={0.5}
            />
          )}
          <XAxis
            dataKey="name"
            tick={axisStyle}
            tickLine={false}
            axisLine={false}
          />
          <YAxis tick={axisStyle} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip />} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      );

    case "bar":
      return (
        <BarChart {...commonProps}>
          {showGrid && (
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--color-border)"
              opacity={0.5}
            />
          )}
          <XAxis
            dataKey="name"
            tick={axisStyle}
            tickLine={false}
            axisLine={false}
          />
          <YAxis tick={axisStyle} tickLine={false} axisLine={false} />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ fill: "var(--color-muted)", opacity: 0.3 }}
          />
          <Bar dataKey="value" fill={color} radius={[2, 2, 0, 0]} />
        </BarChart>
      );

    case "pie":
      return (
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={60}
            label={({ name }) => name}
            labelLine={false}
            stroke="var(--color-background)"
            strokeWidth={2}
          >
            {data.map((entry) => (
              <Cell
                key={`cell-${entry.name}`}
                fill={CHART_COLORS[data.indexOf(entry) % CHART_COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
        </PieChart>
      );

    case "area":
    default:
      return (
        <AreaChart {...commonProps}>
          {showGrid && (
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--color-border)"
              opacity={0.5}
            />
          )}
          <XAxis
            dataKey="name"
            tick={axisStyle}
            tickLine={false}
            axisLine={false}
          />
          <YAxis tick={axisStyle} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip />} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            fill={color}
            fillOpacity={0.15}
          />
        </AreaChart>
      );
  }
}

/**
 * Format date based on time range for grouping
 */
function formatDateForRange(
  date: Date,
  timeRange: ChartWidgetConfig["timeRange"],
): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  switch (timeRange) {
    case "7d": {
      // Group by day: "Mon 15"
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      return `${days[date.getDay()]} ${date.getDate()}`;
    }

    case "30d":
      // Group by day: "Jan 15"
      return `${months[date.getMonth()]} ${date.getDate()}`;

    case "90d": {
      // Group by week: "W1 Jan"
      const weekNum = Math.ceil(date.getDate() / 7);
      return `W${weekNum} ${months[date.getMonth()]}`;
    }

    case "1y":
      // Group by month: "Jan 2024"
      return `${months[date.getMonth()]} ${date.getFullYear()}`;

    default:
      return `${months[date.getMonth()]} ${date.getDate()}`;
  }
}
