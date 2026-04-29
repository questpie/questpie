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
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import { selectClient, useAdminStore } from "../../runtime";
import { WidgetCard } from "../../views/dashboard/widget-card";
import { WidgetEmptyState } from "./widget-empty-state";
import { ValueWidgetSkeleton } from "./widget-skeletons";

/**
 * Value widget props
 */
interface ValueWidgetProps {
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
 *     loader: async (client) => ({
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
	const { t } = useTranslation();

	const useServerData = !!config.hasLoader;
	const serverQuery = useServerWidgetData<ValueWidgetResult>(config.id, {
		enabled: useServerData,
		refreshInterval: config.refreshInterval,
	});
	const clientQuery = useQuery<ValueWidgetResult>({
		queryKey: ["widget", "value", config.id],
		queryFn: () => config.loader!(client),
		enabled: !useServerData && !!config.loader,
		refetchInterval: config.refreshInterval,
	});
	const { data, isLoading, error, refetch, isFetching } = useServerData
		? serverQuery
		: clientQuery;

	// Determine if this is a featured variant based on config
	const isFeatured = config.cardVariant === "featured";

	// Handle loading/error via WidgetCard
	if (isLoading || error) {
		return (
			<WidgetCard
				title={config.title ? resolveText(config.title) : undefined}
				description={
					config.description ? resolveText(config.description) : undefined
				}
				icon={config.icon}
				variant={config.cardVariant}
				isLoading={isLoading}
				loadingSkeleton={<ValueWidgetSkeleton featured={isFeatured} />}
				error={
					error instanceof Error
						? error
						: error
							? new Error(String(error))
							: null
				}
				onRefresh={() => refetch()}
				actions={config.actions}
				className={cn(config.className, data?.classNames?.root)}
			/>
		);
	}

	if (!data) {
		return (
			<WidgetCard
				title={config.title ? resolveText(config.title) : undefined}
				description={
					config.description ? resolveText(config.description) : undefined
				}
				icon={config.icon}
				variant={config.cardVariant}
				isRefreshing={isFetching && !isLoading}
				onRefresh={() => refetch()}
				actions={config.actions}
				className={config.className}
			>
				<WidgetEmptyState
					iconName="ph:gauge"
					title={t("widget.value.emptyTitle")}
					description={t("widget.value.emptyDescription")}
				/>
			</WidgetCard>
		);
	}

	const cls = data.classNames ?? {};
	const Icon = data.icon;
	const TrendIcon = data.trend?.icon;

	// Resolve all text fields (supports both string and i18n objects)
	const label = data.label
		? resolveText(data.label)
		: config.title
			? resolveText(config.title)
			: undefined;
	const subtitle = data.subtitle ? resolveText(data.subtitle) : undefined;
	const footer = data.footer ? resolveText(data.footer) : undefined;

	return (
		<WidgetCard
			title={label}
			icon={Icon}
			description={
				config.description ? resolveText(config.description) : undefined
			}
			variant={config.cardVariant}
			onRefresh={() => refetch()}
			isRefreshing={isFetching && !isLoading}
			actions={config.actions}
			className={cn(config.className, cls.root)}
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
					<p className={cn("text-muted-foreground text-xs", cls.subtitle)}>
						{subtitle}
					</p>
				)}

				{/* Footer */}
				{footer && (
					<p className={cn("text-muted-foreground pt-2 text-xs", cls.footer)}>
						{footer}
					</p>
				)}
			</div>
		</WidgetCard>
	);
}
