/**
 * MediaGrid Component
 *
 * Reusable grid display for assets with selection support.
 * Used in MediaPickerDialog and potentially in assets table view.
 *
 * Features:
 * - Responsive columns (2-5)
 * - Single/multiple/no selection modes
 * - Loading skeleton
 * - Click handling
 *
 * @example
 * ```tsx
 * <MediaGrid
 *   assets={assets}
 *   selectedIds={selectedIds}
 *   onSelectionChange={setSelectedIds}
 *   selectionMode="multiple"
 * />
 * ```
 */

import { Icon } from "@iconify/react";
import * as React from "react";
import type { Asset } from "../../hooks/use-upload";
import { cn } from "../../lib/utils";
import { Skeleton } from "../ui/skeleton";

// ============================================================================
// Types
// ============================================================================

interface MediaGridProps {
	/**
	 * Assets to display
	 */
	assets: Asset[];

	/**
	 * Currently selected asset IDs
	 */
	selectedIds?: Set<string>;

	/**
	 * Called when selection changes
	 */
	onSelectionChange?: (ids: Set<string>) => void;

	/**
	 * Selection mode
	 * @default "none"
	 */
	selectionMode?: "single" | "multiple" | "none";

	/**
	 * Loading state (shows skeleton)
	 */
	loading?: boolean;

	/**
	 * Called when an asset is clicked
	 */
	onAssetClick?: (asset: Asset) => void;

	/**
	 * Number of columns
	 * @default 4
	 */
	columns?: 2 | 3 | 4 | 5;

	/**
	 * Additional className
	 */
	className?: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get file icon color based on MIME type
 */
function getAssetTypeColor(mimeType?: string): string {
	if (!mimeType) return "bg-muted";

	const type = mimeType.toLowerCase();

	if (type.startsWith("image/")) return "bg-info/10";
	if (type.startsWith("video/")) return "bg-primary/10";
	if (type.startsWith("audio/")) return "bg-success/10";
	if (type === "application/pdf") return "bg-destructive/10";

	return "bg-muted";
}

/**
 * Check if MIME type is an image
 */
function isImage(mimeType?: string): boolean {
	return !!mimeType?.toLowerCase().startsWith("image/");
}

// ============================================================================
// Skeleton Component
// ============================================================================

function MediaGridSkeleton({ columns = 4 }: { columns?: 2 | 3 | 4 | 5 }) {
	const count = columns * 3; // Show 3 rows
	const skeletonKeys = React.useMemo(
		() => Array.from({ length: count }, () => crypto.randomUUID()),
		[count],
	);
	const gridClass =
		columns === 2
			? "grid-cols-2"
			: columns === 3
				? "grid-cols-2 sm:grid-cols-3"
				: columns === 5
					? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
					: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4";

	return (
		<div className={cn("grid gap-3", gridClass)}>
			{skeletonKeys.map((key) => (
				<div key={key} className="space-y-2">
					<Skeleton className="aspect-square w-full rounded-lg" />
					<Skeleton className="h-4 w-3/4" />
				</div>
			))}
		</div>
	);
}

// ============================================================================
// Asset Item Component
// ============================================================================

interface AssetItemProps {
	asset: Asset;
	selected: boolean;
	selectionMode: "single" | "multiple" | "none";
	onToggle: () => void;
	onClick?: () => void;
}

function AssetItem({
	asset,
	selected,
	selectionMode,
	onToggle,
	onClick,
}: AssetItemProps) {
	const [imageError, setImageError] = React.useState(false);
	const thumbnailUrl = asset.url;
	const isImageType = isImage(asset.mimeType);
	const showCheckbox = selectionMode !== "none";

	const handleClick = () => {
		if (selectionMode !== "none") {
			onToggle();
		}
		onClick?.();
	};

	return (
		<button
			type="button"
			onClick={handleClick}
			className={cn(
				"group relative aspect-square w-full overflow-hidden rounded-lg border",
				"transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
				selected
					? "ring-primary border-primary ring-2"
					: "border-border/60 hover:border-border",
				"bg-muted/30",
			)}
		>
			{/* Thumbnail or icon */}
			{thumbnailUrl && isImageType && !imageError ? (
				<img
					src={thumbnailUrl}
					alt={asset.alt || asset.filename || "Asset"}
					className="h-full w-full object-cover"
					onError={() => setImageError(true)}
				/>
			) : (
				<div
					className={cn(
						"flex h-full w-full items-center justify-center",
						getAssetTypeColor(asset.mimeType),
					)}
				>
					<span className="text-muted-foreground text-xs font-medium uppercase">
						{asset.mimeType?.split("/")[1]?.slice(0, 4) || "FILE"}
					</span>
				</div>
			)}

			{/* Selection checkbox */}
			{showCheckbox && (
				<div
					className={cn(
						"absolute right-2 top-2 flex size-5 items-center justify-center rounded-full border-2 transition-all",
						selected
							? "bg-primary border-primary"
							: "border-white bg-black/20 backdrop-blur-sm group-hover:bg-black/40",
					)}
				>
					{selected && (
						<Icon icon="ph:check-bold" className="size-3 text-white" />
					)}
				</div>
			)}

			{/* Filename overlay (on hover) */}
			{asset.filename && (
				<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
					<p className="truncate text-xs text-white" title={asset.filename}>
						{asset.filename}
					</p>
				</div>
			)}
		</button>
	);
}

// ============================================================================
// Main Component
// ============================================================================

const EMPTY_SET = new Set<string>();

export function MediaGrid({
	assets,
	selectedIds = EMPTY_SET,
	onSelectionChange,
	selectionMode = "none",
	loading = false,
	onAssetClick,
	columns = 4,
	className,
}: MediaGridProps) {
	// Handle toggle selection
	const handleToggle = (assetId: string) => {
		if (!onSelectionChange) return;

		const newSelection = new Set(selectedIds);

		if (selectionMode === "single") {
			// Single mode: clear all and select only this one
			newSelection.clear();
			newSelection.add(assetId);
		} else {
			// Multiple mode: toggle this one
			if (newSelection.has(assetId)) {
				newSelection.delete(assetId);
			} else {
				newSelection.add(assetId);
			}
		}

		onSelectionChange(newSelection);
	};

	// Show loading skeleton
	if (loading) {
		return (
			<div className={className}>
				<MediaGridSkeleton columns={columns} />
			</div>
		);
	}

	// Empty state
	if (assets.length === 0) {
		return (
			<div
				className={cn(
					"flex flex-col items-center justify-center rounded-lg border border-dashed p-12",
					"bg-muted/30 text-muted-foreground",
					className,
				)}
			>
				<p className="text-sm">No assets found</p>
			</div>
		);
	}

	// Grid columns class
	const gridClass =
		columns === 2
			? "grid-cols-2"
			: columns === 3
				? "grid-cols-2 sm:grid-cols-3"
				: columns === 5
					? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
					: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4";

	return (
		<div className={cn("grid gap-3", gridClass, className)}>
			{assets.map((asset) => (
				<AssetItem
					key={asset.id}
					asset={asset}
					selected={selectedIds.has(asset.id)}
					selectionMode={selectionMode}
					onToggle={() => handleToggle(asset.id)}
					onClick={onAssetClick ? () => onAssetClick(asset) : undefined}
				/>
			))}
		</div>
	);
}
