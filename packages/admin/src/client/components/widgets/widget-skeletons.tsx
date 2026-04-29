/**
 * Widget Skeletons
 *
 * Loading skeleton components for different widget types.
 * Provides visual feedback while data is being fetched.
 */

import { cn } from "../../lib/utils";
import { Skeleton } from "../ui/skeleton";

// ============================================================================
// Stats Widget Skeleton
// ============================================================================

export function StatsWidgetSkeleton() {
	return (
		<div className="space-y-3">
			<Skeleton className="h-8 w-20" />
			<Skeleton className="h-4 w-32" />
		</div>
	);
}

// ============================================================================
// Chart Widget Skeleton
// ============================================================================

export function ChartWidgetSkeleton() {
	return (
		<div className="flex h-48 w-full items-end gap-2 pt-4">
			{/* Bar chart style skeleton */}
			<Skeleton className="h-[40%] flex-1 rounded-t-sm" />
			<Skeleton className="h-[65%] flex-1 rounded-t-sm" />
			<Skeleton className="h-[45%] flex-1 rounded-t-sm" />
			<Skeleton className="h-[80%] flex-1 rounded-t-sm" />
			<Skeleton className="h-[55%] flex-1 rounded-t-sm" />
			<Skeleton className="h-[70%] flex-1 rounded-t-sm" />
			<Skeleton className="h-[50%] flex-1 rounded-t-sm" />
			<Skeleton className="h-[75%] flex-1 rounded-t-sm" />
			<Skeleton className="h-[60%] flex-1 rounded-t-sm" />
			<Skeleton className="h-[85%] flex-1 rounded-t-sm" />
		</div>
	);
}

// ============================================================================
// Recent Items Widget Skeleton
// ============================================================================

export function RecentItemsWidgetSkeleton({ count = 5 }: { count?: number }) {
	return (
		<div className="space-y-1">
			<SkeletonRow />
			{count > 1 && <SkeletonRow />}
			{count > 2 && <SkeletonRow />}
			{count > 3 && <SkeletonRow />}
			{count > 4 && <SkeletonRow />}
		</div>
	);
}

function SkeletonRow() {
	return (
		<div className="flex items-center gap-3 p-2">
			<div className="flex-1 space-y-2">
				<Skeleton className="h-4 w-3/4" />
				<Skeleton className="h-3 w-1/2" />
			</div>
		</div>
	);
}

// ============================================================================
// Quick Actions Widget Skeleton
// ============================================================================

function QuickActionsWidgetSkeleton({
	count = 3,
	layout = "list",
}: {
	count?: number;
	layout?: "list" | "grid";
}) {
	if (layout === "grid") {
		return (
			<div className="grid grid-cols-2 gap-2">
				<ActionGridItem />
				{count > 1 && <ActionGridItem />}
				{count > 2 && <ActionGridItem />}
				{count > 3 && <ActionGridItem />}
			</div>
		);
	}

	return (
		<div className="-mx-1 space-y-1">
			<ActionListItem />
			{count > 1 && <ActionListItem />}
			{count > 2 && <ActionListItem />}
		</div>
	);
}

function ActionGridItem() {
	return (
		<div className="flex flex-col items-center justify-center gap-2 p-3">
			<Skeleton className="h-9 w-9" />
			<Skeleton className="h-3 w-16" />
		</div>
	);
}

function ActionListItem() {
	return (
		<div className="flex items-center gap-3 px-2 py-2">
			<Skeleton className="h-8 w-8 shrink-0" />
			<Skeleton className="h-4 flex-1" />
		</div>
	);
}

// ============================================================================
// Table Widget Skeleton
// ============================================================================

export function TableWidgetSkeleton({
	rows = 5,
	columns = 3,
}: {
	rows?: number;
	columns?: number;
}) {
	return (
		<div className="-mx-5">
			{/* Header */}
			<div className="border-border flex gap-4 border-b px-5 py-2">
				<Skeleton variant="text" className="h-4 w-24" />
				{columns > 1 && <Skeleton variant="text" className="h-4 flex-1" />}
				{columns > 2 && <Skeleton variant="text" className="h-4 flex-1" />}
			</div>
			{/* Rows */}
			<TableSkeletonRow columns={columns} />
			{rows > 1 && <TableSkeletonRow columns={columns} />}
			{rows > 2 && <TableSkeletonRow columns={columns} />}
			{rows > 3 && <TableSkeletonRow columns={columns} />}
			{rows > 4 && <TableSkeletonRow columns={columns} last />}
		</div>
	);
}

function TableSkeletonRow({
	columns = 3,
	last = false,
}: {
	columns?: number;
	last?: boolean;
}) {
	return (
		<div
			className={cn(
				"border-border flex gap-4 border-b px-5 py-3",
				last && "border-0",
			)}
		>
			<Skeleton variant="text" className="h-4 w-20" />
			{columns > 1 && <Skeleton variant="text" className="h-4 flex-1" />}
			{columns > 2 && <Skeleton variant="text" className="h-4 flex-1" />}
		</div>
	);
}

// ============================================================================
// Timeline Widget Skeleton
// ============================================================================

export function TimelineWidgetSkeleton({ count = 5 }: { count?: number }) {
	return (
		<div className="space-y-4">
			<TimelineSkeletonItem />
			{count > 1 && <TimelineSkeletonItem />}
			{count > 2 && <TimelineSkeletonItem />}
			{count > 3 && <TimelineSkeletonItem />}
			{count > 4 && <TimelineSkeletonItem last />}
		</div>
	);
}

function TimelineSkeletonItem({ last = false }: { last?: boolean }) {
	return (
		<div className="flex gap-3">
			{/* Timeline dot */}
			<div className="flex flex-col items-center">
				<Skeleton variant="avatar" className="h-3 w-3" />
				{!last && <Skeleton className="mt-1 w-0.5 flex-1" />}
			</div>
			{/* Content */}
			<div className="flex-1 space-y-1 pb-4">
				<Skeleton className="h-4 w-3/4" />
				<Skeleton className="h-3 w-1/2" />
				<Skeleton className="h-3 w-20" />
			</div>
		</div>
	);
}

// ============================================================================
// Progress Widget Skeleton
// ============================================================================

export function ProgressWidgetSkeleton() {
	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<Skeleton variant="text" className="h-4 w-32" />
				<Skeleton variant="text" className="h-4 w-12" />
			</div>
			<Skeleton variant="chip" className="h-2 w-full" />
			<Skeleton variant="text" className="h-3 w-24" />
		</div>
	);
}

// ============================================================================
// Value Widget Skeleton
// ============================================================================

export function ValueWidgetSkeleton({
	featured = false,
}: {
	featured?: boolean;
}) {
	return (
		<div className="space-y-3">
			<div className="flex items-start gap-3">
				<Skeleton className="h-10 w-10 shrink-0" />
				<div className="flex-1 space-y-2">
					<Skeleton className="h-4 w-24" />
					<Skeleton className={cn("h-8", featured ? "w-40" : "w-24")} />
				</div>
			</div>
			<Skeleton className="h-3 w-32" />
		</div>
	);
}

// ============================================================================
// Generic Widget Skeleton
// ============================================================================

function GenericWidgetSkeleton() {
	return (
		<div className="space-y-4">
			<Skeleton className="h-20 w-full" />
		</div>
	);
}
