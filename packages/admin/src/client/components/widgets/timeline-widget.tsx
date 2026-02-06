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
import { useResolveText } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import { selectClient, useAdminStore } from "../../runtime";
import { WidgetCard } from "../../views/dashboard/widget-card";
import { TimelineWidgetSkeleton } from "./widget-skeletons";

/**
 * Timeline widget props
 */
export interface TimelineWidgetProps {
	config: TimelineWidgetConfig;
	/** Navigate function for item clicks */
	navigate?: (path: string) => void;
}

// Variant styles for timeline items
const variantStyles = {
	default: "bg-muted-foreground",
	success: "bg-green-500",
	warning: "bg-yellow-500",
	error: "bg-red-500",
	info: "bg-blue-500",
};

/**
 * Format timestamp based on format option
 */
function formatTimestamp(
	date: Date | string,
	format: TimelineWidgetConfig["timestampFormat"] = "relative",
): string {
	const d = typeof date === "string" ? new Date(date) : date;

	switch (format) {
		case "absolute":
			return d.toLocaleDateString();

		case "datetime":
			return d.toLocaleString();

		case "relative":
		default: {
			const now = new Date();
			const diff = now.getTime() - d.getTime();
			const seconds = Math.floor(diff / 1000);
			const minutes = Math.floor(seconds / 60);
			const hours = Math.floor(minutes / 60);
			const days = Math.floor(hours / 24);

			if (days > 7) return d.toLocaleDateString();
			if (days > 0) return `${days}d ago`;
			if (hours > 0) return `${hours}h ago`;
			if (minutes > 0) return `${minutes}m ago`;
			return "just now";
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
 *     fetchFn: async (client) => {
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
	const {
		maxItems = 10,
		showTimestamps = true,
		timestampFormat = "relative",
		emptyMessage,
	} = config;

	const useServerData = !!config.hasFetchFn;
	const serverQuery = useServerWidgetData<TimelineItem[]>(config.id, {
		enabled: useServerData,
		refreshInterval: config.refreshInterval,
	});
	const clientQuery = useQuery<TimelineItem[]>({
		queryKey: ["widget", "timeline", config.id],
		queryFn: () => config.fetchFn!(client),
		enabled: !useServerData && !!config.fetchFn,
		refetchInterval: config.refreshInterval,
	});
	const { data, isLoading, error, refetch } = useServerData
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

	// Empty state
	const emptyContent = (
		<div className="flex h-24 items-center justify-center text-muted-foreground">
			<p className="text-sm">
				{emptyMessage ? resolveText(emptyMessage) : "No activity yet"}
			</p>
		</div>
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
								<div className="absolute left-[11px] top-6 bottom-0 w-px bg-border" />
							)}

							{/* Icon dot */}
							<div
								className={cn(
									"relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
									variantStyles[variant],
								)}
							>
								{iconElement ?? (
									<IconifyIcon icon="ph:circle-bold" className="h-3 w-3 text-white" />
								)}
							</div>

							{/* Content */}
							<div className="flex-1 min-w-0 pt-0.5 text-left">
								<p className="text-sm font-medium truncate">{item.title}</p>
								{item.description && (
									<p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
										{item.description}
									</p>
								)}
								{showTimestamps && item.timestamp && (
									<p className="text-xs text-muted-foreground mt-1">
										{formatTimestamp(item.timestamp, timestampFormat)}
									</p>
								)}
							</div>
						</>
					);

					if (isClickable) {
						return (
							<button
								key={item.id}
								type="button"
								className={cn(
									"relative flex gap-3 pb-4 w-full",
									"cursor-pointer hover:bg-muted/30 -mx-2 px-2 rounded-md transition-colors",
									isLast && "pb-0",
								)}
								onClick={() => handleItemClick(item)}
							>
								{itemContent}
							</button>
						);
					}

					return (
						<div
							key={item.id}
							className={cn("relative flex gap-3 pb-4", isLast && "pb-0")}
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
			isLoading={isLoading}
			loadingSkeleton={<TimelineWidgetSkeleton count={maxItems} />}
			error={
				error instanceof Error ? error : error ? new Error(String(error)) : null
			}
			onRefresh={() => refetch()}
		>
			{timelineContent}
		</WidgetCard>
	);
}
