/**
 * Stats Widget
 *
 * Displays count and change percentage for a collection.
 * Uses WidgetCard for consistent styling.
 */

import type * as React from "react";
import { useMemo } from "react";
import type { ComponentReference } from "#questpie/admin/server";
import type {
	DateFilterConfig,
	DateFilterPreset,
} from "../../builder/types/widget-types";
import { useCollectionCount } from "../../hooks/use-collection";
import { useServerWidgetData } from "../../hooks/use-server-widget-data";
import { useResolveText } from "../../i18n/hooks";
import { cn, formatCollectionName } from "../../lib/utils";
import { WidgetCard } from "../../views/dashboard/widget-card";
import { StatsWidgetSkeleton } from "./widget-skeletons";

/**
 * Stats widget config (local type for component props)
 */
export type StatsWidgetConfig = {
	id: string;
	collection: string;
	label?: string;
	realtime?: boolean;
	/** Static filter (evaluated at build time) */
	filter?: Record<string, any>;
	/** Dynamic filter function (evaluated at render time) */
	filterFn?: () => Record<string, any>;
	/** Date filter preset (evaluated at render time) */
	dateFilter?: DateFilterConfig;
	/** Icon component or server-defined reference */
	icon?:
		| React.ComponentType<{ className?: string }>
		| ComponentReference
		| string;
	/** Color variant for the stat card */
	variant?: "default" | "primary" | "success" | "warning" | "danger";
	/** Server has a fetchFn for this widget */
	hasFetchFn?: boolean;
	/** Refresh interval in ms */
	refreshInterval?: number;
};

/**
 * Stats widget props
 */
export type StatsWidgetProps = {
	config: StatsWidgetConfig;
};

/**
 * Get date range for a preset
 */
function getDateRange(preset: DateFilterPreset): { gte: Date; lte: Date } {
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

	switch (preset) {
		case "today":
			return {
				gte: today,
				lte: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1),
			};
		case "yesterday": {
			const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
			return {
				gte: yesterday,
				lte: new Date(today.getTime() - 1),
			};
		}
		case "thisWeek": {
			const dayOfWeek = today.getDay();
			const monday = new Date(
				today.getTime() -
					(dayOfWeek === 0 ? 6 : dayOfWeek - 1) * 24 * 60 * 60 * 1000,
			);
			return {
				gte: monday,
				lte: now,
			};
		}
		case "lastWeek": {
			const dayOfWeek = today.getDay();
			const thisMonday = new Date(
				today.getTime() -
					(dayOfWeek === 0 ? 6 : dayOfWeek - 1) * 24 * 60 * 60 * 1000,
			);
			const lastMonday = new Date(
				thisMonday.getTime() - 7 * 24 * 60 * 60 * 1000,
			);
			return {
				gte: lastMonday,
				lte: new Date(thisMonday.getTime() - 1),
			};
		}
		case "thisMonth":
			return {
				gte: new Date(now.getFullYear(), now.getMonth(), 1),
				lte: now,
			};
		case "lastMonth": {
			const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
			return {
				gte: new Date(now.getFullYear(), now.getMonth() - 1, 1),
				lte: new Date(firstOfThisMonth.getTime() - 1),
			};
		}
		case "last7days":
			return {
				gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
				lte: now,
			};
		case "last30days":
			return {
				gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
				lte: now,
			};
		case "last90days":
			return {
				gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
				lte: now,
			};
		case "thisYear":
			return {
				gte: new Date(now.getFullYear(), 0, 1),
				lte: now,
			};
		case "lastYear":
			return {
				gte: new Date(now.getFullYear() - 1, 0, 1),
				lte: new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59),
			};
		default:
			return { gte: today, lte: now };
	}
}

// Variant styles for the card border/background
const variantStyles = {
	default: "",
	primary: "border-primary/30 bg-primary/5",
	success: "border-green-500/30 bg-green-500/5",
	warning: "border-yellow-500/30 bg-yellow-500/5",
	danger: "border-red-500/30 bg-red-500/5",
};

// Variant styles for the value text
const variantValueStyles = {
	default: "",
	primary: "text-primary",
	success: "text-green-600 dark:text-green-400",
	warning: "text-yellow-600 dark:text-yellow-400",
	danger: "text-red-600 dark:text-red-400",
};

/**
 * Stats widget component
 *
 * Shows:
 * - Total count for a collection
 * - Optional icon
 * - Color variant for visual distinction
 */
export default function StatsWidget({ config }: StatsWidgetProps) {
	const resolveText = useResolveText();
	const {
		collection,
		label,
		filter,
		filterFn,
		dateFilter,
		icon: Icon,
		variant = "default",
		realtime,
		hasFetchFn,
		refreshInterval,
	} = config;

	// Server-side data fetching (when hasFetchFn is true)
	const serverQuery = useServerWidgetData<{ count: number }>(config.id, {
		enabled: !!hasFetchFn,
		refreshInterval,
	});

	// Build the final filter - evaluated at render time
	const computedFilter = useMemo(() => {
		let result: Record<string, any> = {};

		// 1. Static filter
		if (filter) {
			result = { ...result, ...filter };
		}

		// 2. Dynamic filter function
		if (filterFn) {
			result = { ...result, ...filterFn() };
		}

		// 3. Date filter preset
		if (dateFilter) {
			const { gte, lte } = getDateRange(dateFilter.range);
			result[dateFilter.field] = {
				gte: gte.toISOString(),
				lte: lte.toISOString(),
			};
		}

		return Object.keys(result).length > 0 ? result : undefined;
	}, [filter, filterFn, dateFilter]);

	// Fetch count using dedicated count endpoint (more efficient than fetching all docs)
	const collectionQuery = useCollectionCount(
		collection as any,
		computedFilter ? { where: computedFilter } : undefined,
		undefined,
		{ realtime },
	);

	// Use server data or client data
	const {
		data: rawData,
		isLoading,
		error,
		refetch,
	} = hasFetchFn ? serverQuery : collectionQuery;

	const count = hasFetchFn
		? (rawData as { count: number } | undefined)?.count ?? 0
		: (rawData as number | undefined) ?? 0;

	const displayLabel = label
		? resolveText(label)
		: formatCollectionName(collection);

	return (
		<WidgetCard
			title={displayLabel}
			icon={Icon}
			isLoading={isLoading}
			loadingSkeleton={<StatsWidgetSkeleton />}
			error={
				error instanceof Error ? error : error ? new Error(String(error)) : null
			}
			onRefresh={() => refetch()}
			className={variantStyles[variant]}
		>
			<div className={cn("text-2xl font-bold", variantValueStyles[variant])}>
				{count.toLocaleString()}
			</div>
		</WidgetCard>
	);
}
