/**
 * Progress Widget
 *
 * Displays progress towards a goal.
 * Uses WidgetCard for consistent styling.
 */

import { useQuery } from "@tanstack/react-query";
import type { ProgressWidgetConfig } from "../../builder/types/widget-types";
import { useServerWidgetData } from "../../hooks/use-server-widget-data";
import { useResolveText } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import { selectClient, useAdminStore } from "../../runtime";
import { WidgetCard } from "../../views/dashboard/widget-card";
import { ProgressWidgetSkeleton } from "./widget-skeletons";

/**
 * Progress widget props
 */
export interface ProgressWidgetProps {
	config: ProgressWidgetConfig;
}

/**
 * Progress Widget Component
 *
 * Displays a progress bar with current/target values.
 *
 * @example
 * ```tsx
 * <ProgressWidget
 *   config={{
 *     type: "progress",
 *     id: "monthly-sales",
 *     title: "Monthly Sales Goal",
 *     fetchFn: async (client) => ({
 *       current: 75000,
 *       target: 100000,
 *       label: "$75,000 / $100,000"
 *     }),
 *     showPercentage: true,
 *   }}
 * />
 * ```
 */
export default function ProgressWidget({ config }: ProgressWidgetProps) {
	const client = useAdminStore(selectClient);
	const resolveText = useResolveText();
	const { color, showPercentage = true } = config;

	type ProgressData = {
		current: number;
		target: number;
		label?: string;
		subtitle?: string;
	};
	const useServerData = !!config.hasFetchFn;
	const serverQuery = useServerWidgetData<ProgressData>(config.id, {
		enabled: useServerData,
		refreshInterval: config.refreshInterval,
	});
	const clientQuery = useQuery<ProgressData>({
		queryKey: ["widget", "progress", config.id],
		queryFn: () => config.fetchFn!(client),
		enabled: !useServerData && !!config.fetchFn,
		refetchInterval: config.refreshInterval,
	});
	const { data, isLoading, error, refetch } = useServerData
		? serverQuery
		: clientQuery;

	const title = config.title ? resolveText(config.title) : undefined;

	// Calculate percentage
	const percentage = data
		? Math.min((data.current / data.target) * 100, 100)
		: 0;
	const percentageFormatted = percentage.toFixed(0);

	// Determine color based on progress
	const getProgressColor = () => {
		if (color) return color;
		if (percentage >= 100) return "bg-green-500";
		if (percentage >= 75) return "bg-primary";
		if (percentage >= 50) return "bg-yellow-500";
		return "bg-muted-foreground";
	};

	// Progress content
	const progressContent = data ? (
		<div className="space-y-3">
			{/* Progress bar */}
			<div className="relative">
				<div className="h-2 w-full overflow-hidden rounded-full bg-muted">
					<div
						className={cn(
							"h-full rounded-full transition-all duration-500",
							getProgressColor(),
						)}
						style={{ width: `${percentage}%` }}
					/>
				</div>
			</div>

			{/* Labels */}
			<div className="flex items-center justify-between text-sm">
				<span className="text-muted-foreground">
					{data.label ||
						`${data.current.toLocaleString()} / ${data.target.toLocaleString()}`}
				</span>
				{showPercentage && (
					<span className="font-medium">{percentageFormatted}%</span>
				)}
			</div>

			{/* Subtitle */}
			{data.subtitle && (
				<p className="text-xs text-muted-foreground">{data.subtitle}</p>
			)}
		</div>
	) : null;

	return (
		<WidgetCard
			title={title}
			isLoading={isLoading}
			loadingSkeleton={<ProgressWidgetSkeleton />}
			error={
				error instanceof Error ? error : error ? new Error(String(error)) : null
			}
			onRefresh={() => refetch()}
		>
			{progressContent}
		</WidgetCard>
	);
}
