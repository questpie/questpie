/**
 * Timeline Widget
 *
 * Displays an activity/event timeline.
 * Uses WidgetCard for consistent styling.
 */

import { Icon as IconifyIcon } from "@iconify/react";
import { useQuery } from "@tanstack/react-query";
import type * as React from "react";

import type {
	TimelineItem,
	TimelineWidgetConfig,
} from "../../builder/types/widget-types";
import { resolveIconElement } from "../../components/component-renderer";
import { useServerWidgetData } from "../../hooks/use-server-widget-data";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import { selectClient, useAdminStore } from "../../runtime";
import { WidgetCard } from "../../views/dashboard/widget-card";
import { WidgetEmptyState } from "./widget-empty-state";
import { TimelineWidgetSkeleton } from "./widget-skeletons";

/**
 * Timeline widget props
 */
interface TimelineWidgetProps {
	config: TimelineWidgetConfig;
	/** Navigate function for item clicks */
	navigate?: (path: string) => void;
}

// Variant styles for timeline items
const variantStyles = {
	default: "bg-muted-foreground",
	success: "bg-success",
	warning: "bg-warning",
	error: "bg-destructive",
	info: "bg-info",
};

/**
 * Format timestamp based on format option
 */
function formatTimestamp(
	date: Date | string,
	format: TimelineWidgetConfig["timestampFormat"] = "relative",
	t: (key: string, params?: Record<string, unknown>) => string,
	formatDate: (
		date: Date | number,
		options?: Intl.DateTimeFormatOptions,
	) => string,
): string {
	const d = typeof date === "string" ? new Date(date) : date;

	switch (format) {
		case "absolute":
			return formatDate(d);

		case "datetime":
			return formatDate(d, {
				dateStyle: "medium",
				timeStyle: "short",
			});

		case "relative":
		default: {
			const now = new Date();
			const diff = now.getTime() - d.getTime();
			const seconds = Math.floor(diff / 1000);
			const minutes = Math.floor(seconds / 60);
			const hours = Math.floor(minutes / 60);
			const days = Math.floor(hours / 24);

			if (days > 7) return formatDate(d);
			if (days > 0) return t("time.daysAgoShort", { count: days });
			if (hours > 0) return t("time.hoursAgoShort", { count: hours });
			if (minutes > 0) return t("time.minutesAgoShort", { count: minutes });
			return t("time.justNow");
		}
	}
}

/**
 * Timeline Widget Component
 *
 * Displays a vertical timeline of events/activities.
 *
 * @example
 * ```tsx
 * <TimelineWidget
 *   config={{
 *     type: "timeline",
 *     id: "recent-activity",
 *     title: "Recent Activity",
 *     loader: async (client) => {
 *       const activities = await client.collections.activities.findMany({
 *         limit: 10,
 *         orderBy: { createdAt: "desc" }
 *       });
 *       return activities.map(a => ({
 *         id: a.id,
 *         title: a.action,
 *         description: a.description,
 *         timestamp: a.createdAt,
 *         variant: a.type === "error" ? "error" : "default"
 *       }));
 *     }
 *   }}
 * />
 * ```
 */
export default function TimelineWidget({
	config,
	navigate,
}: TimelineWidgetProps) {
	const client = useAdminStore(selectClient);
	const resolveText = useResolveText();
	const { t, formatDate } = useTranslation();
	const {
		maxItems = 10,
		showTimestamps = true,
		timestampFormat = "relative",
		emptyMessage,
	} = config;

	const useServerData = !!config.hasLoader;
	const serverQuery = useServerWidgetData<TimelineItem[]>(config.id, {
		enabled: useServerData,
		refreshInterval: config.refreshInterval,
	});
	const clientQuery = useQuery<TimelineItem[]>({
		queryKey: ["widget", "timeline", config.id],
		queryFn: () => config.loader!(client),
		enabled: !useServerData && !!config.loader,
		refetchInterval: config.refreshInterval,
	});
	const { data, isLoading, error, refetch, isFetching } = useServerData
		? serverQuery
		: clientQuery;

	const items = data?.slice(0, maxItems) ?? [];
	const title = config.title ? resolveText(config.title) : undefined;

	// Handle item click
	const handleItemClick = (item: TimelineItem) => {
		if (item.href && navigate) {
			navigate(item.href);
		}
	};

	const resolvedEmptyMessage = emptyMessage
		? resolveText(emptyMessage)
		: undefined;

	// Empty state
	const emptyContent = (
		<WidgetEmptyState
			iconName="ph:clock-counter-clockwise"
			title={resolvedEmptyMessage ?? t("widget.timeline.emptyTitle")}
			description={
				resolvedEmptyMessage ? undefined : t("widget.timeline.emptyDescription")
			}
		/>
	);

	// Timeline content
	const timelineContent =
		items.length === 0 ? (
			emptyContent
		) : (
			<div className="space-y-0">
				{items.map((item, index) => {
					const iconElement = resolveIconElement(item.icon, {
						className: "h-3 w-3 text-white",
					});
					const variant = item.variant || "default";
					const isLast = index === items.length - 1;
					const isClickable = !!(item.href && navigate);

					const itemContent = (
						<>
							{/* Timeline line */}
							{!isLast && (
								<div className="bg-border absolute top-6 bottom-0 left-[11px] w-px" />
							)}

							{/* Icon dot */}
							<div
								className={cn(
									"relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
									variantStyles[variant],
								)}
							>
								{iconElement ?? (
									<IconifyIcon
										icon="ph:circle-bold"
										className="h-3 w-3 text-white"
									/>
								)}
							</div>

							{/* Content */}
							<div className="min-w-0 flex-1 pt-0.5 text-left">
								<p className="truncate text-sm font-medium">{item.title}</p>
								{item.description && (
									<p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
										{item.description}
									</p>
								)}
								{showTimestamps && item.timestamp && (
									<p className="text-muted-foreground mt-1 text-xs">
										{formatTimestamp(
											item.timestamp,
											timestampFormat,
											t,
											formatDate,
										)}
									</p>
								)}
							</div>
						</>
					);

					return (
						<div
							key={item.id}
							className={cn("relative flex gap-3 pb-4", isLast && "pb-0")}
							{...(isClickable
								? {
										role: "button",
										tabIndex: 0,
										onClick: () => handleItemClick(item),
										onKeyDown: (e: React.KeyboardEvent) => {
											if (e.key === "Enter" || e.key === " ")
												handleItemClick(item);
										},
										style: { cursor: "pointer" },
									}
								: {})}
						>
							{itemContent}
						</div>
					);
				})}
			</div>
		);

	return (
		<WidgetCard
			title={title}
			description={
				config.description ? resolveText(config.description) : undefined
			}
			icon={config.icon}
			variant={config.cardVariant}
			isLoading={isLoading}
			isRefreshing={isFetching && !isLoading}
			loadingSkeleton={<TimelineWidgetSkeleton count={maxItems} />}
			error={
				error instanceof Error ? error : error ? new Error(String(error)) : null
			}
			onRefresh={() => refetch()}
			actions={config.actions}
			className={config.className}
		>
			{timelineContent}
		</WidgetCard>
	);
}
