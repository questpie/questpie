/**
 * Value Widget
 *
 * Flexible widget with async data fetching and full Tailwind customization.
 * Uses WidgetCard for consistent styling while allowing custom classNames.
 */

import { useQuery } from "@tanstack/react-query";
import type {
  ValueWidgetConfig,
  ValueWidgetResult,
} from "../../builder/types/widget-types";
import { resolveIconElement } from "../../components/component-renderer";
import { useServerWidgetData } from "../../hooks/use-server-widget-data";
import { useResolveText } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import { selectClient, useAdminStore } from "../../runtime";
import { WidgetCard } from "../../views/dashboard/widget-card";
import { ValueWidgetSkeleton } from "./widget-skeletons";

/**
 * Value widget props
 */
export interface ValueWidgetProps {
  config: ValueWidgetConfig;
}

/**
 * Format value for display
 */
function formatValue(value: number | string): string {
  if (typeof value === "number") {
    return value.toLocaleString();
  }
  return value;
}

/**
 * Value Widget Component
 *
 * Fetches data via async function and renders with full customization.
 *
 * @example
 * ```tsx
 * <ValueWidget
 *   config={{
 *     type: "value",
 *     id: "total-revenue",
 *     fetchFn: async (client) => ({
 *       value: 42,
 *       label: "Total",
 *       classNames: { root: "bg-blue-50" },
 *     }),
 *   }}
 * />
 * ```
 */
export default function ValueWidget({ config }: ValueWidgetProps) {
  const client = useAdminStore(selectClient);
  const resolveText = useResolveText();

  const useServerData = !!config.hasFetchFn;
  const serverQuery = useServerWidgetData<ValueWidgetResult>(config.id, {
    enabled: useServerData,
    refreshInterval: config.refreshInterval,
  });
  const clientQuery = useQuery<ValueWidgetResult>({
    queryKey: ["widget", "value", config.id],
    queryFn: () => config.fetchFn!(client),
    enabled: !useServerData && !!config.fetchFn,
    refetchInterval: config.refreshInterval,
  });
  const { data, isLoading, error, refetch, isFetching } = useServerData
    ? serverQuery
    : clientQuery;

  // Determine if this is a featured variant based on config
  const isFeatured = config.cardVariant === "featured";

  // Handle loading/error via WidgetCard
  if (isLoading || error || !data) {
    return (
      <WidgetCard
        title={config.title ? resolveText(config.title) : undefined}
        isLoading={isLoading}
        loadingSkeleton={<ValueWidgetSkeleton featured={isFeatured} />}
        error={
          error instanceof Error
            ? error
            : !data && !isLoading
              ? new Error("No data returned")
              : null
        }
        onRefresh={() => refetch()}
        className={data?.classNames?.root}
      />
    );
  }

  const cls = data.classNames ?? {};
  const Icon = data.icon;
  const TrendIcon = data.trend?.icon;

  // Resolve all text fields (supports both string and i18n objects)
  const label = data.label ? resolveText(data.label) : undefined;
  const subtitle = data.subtitle ? resolveText(data.subtitle) : undefined;
  const footer = data.footer ? resolveText(data.footer) : undefined;

  return (
    <WidgetCard
      title={label}
      icon={Icon}
      onRefresh={() => refetch()}
      isRefreshing={isFetching && !isLoading}
      className={cls.root}
    >
      <div className={cn("space-y-1", cls.content)}>
        {/* Main value */}
        <div className={cn("text-2xl font-bold", cls.value)}>
          {data.formatted ?? formatValue(data.value)}
        </div>

        {/* Trend indicator */}
        {data.trend && (
          <div className={cn("flex items-center gap-1 text-sm", cls.trend)}>
            {resolveIconElement(TrendIcon, {
              className: cn("h-3 w-3", cls.trendIcon),
            })}
            <span>{data.trend.value}</span>
          </div>
        )}

        {/* Subtitle */}
        {subtitle && (
          <p className={cn("text-xs text-muted-foreground", cls.subtitle)}>
            {subtitle}
          </p>
        )}

        {/* Footer */}
        {footer && (
          <p className={cn("text-xs text-muted-foreground pt-2", cls.footer)}>
            {footer}
          </p>
        )}
      </div>
    </WidgetCard>
  );
}
