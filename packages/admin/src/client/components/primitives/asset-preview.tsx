/**
 * AssetPreview Primitive
 *
 * Displays an uploaded asset with thumbnail/icon, metadata, and actions.
 * Supports images, videos, PDFs, and other file types.
 *
 * @example
 * ```tsx
 * <AssetPreview
 *   asset={asset}
 *   onRemove={() => handleRemove(asset.id)}
 *   onEdit={() => openEditDialog(asset)}
 * />
 * ```
 */

import { Icon } from "@iconify/react";
import * as React from "react";

import type { Asset } from "../../hooks/use-upload";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";

// ============================================================================
// Types
// ============================================================================

interface AssetPreviewProps {
	/**
	 * Asset data (from upload or existing record)
	 */
	asset: Partial<Asset> & {
		id?: string;
		filename?: string;
		mimeType?: string;
		size?: number;
		url?: string;
		alt?: string | null;
	};

	/**
	 * Pending file object (for displaying local preview before upload)
	 */
	pendingFile?: File;

	/**
	 * Called when remove button is clicked
	 */
	onRemove?: () => void;

	/**
	 * Called when edit button is clicked
	 */
	onEdit?: () => void;

	/**
	 * Show loading state
	 */
	loading?: boolean;

	/**
	 * Upload progress (0-100)
	 */
	progress?: number;

	/**
	 * Whether the preview is disabled
	 */
	disabled?: boolean;

	/**
	 * Whether to show the drag handle (for sortable lists)
	 */
	showDragHandle?: boolean;

	/**
	 * Drag handle props (from dnd-kit)
	 */
	dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;

	/**
	 * Display variant
	 * @default "card"
	 */
	variant?: "card" | "compact" | "thumbnail";

	/**
	 * Link to asset detail page (makes the preview clickable)
	 */
	href?: string;

	/**
	 * Called when the preview is clicked
	 */
	onClick?: (id: string) => void;

	/**
	 * Additional className
	 */
	className?: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get icon name based on MIME type
 */
function getFileIconName(mimeType?: string): string {
	if (!mimeType) return "ph:file";

	const type = mimeType.toLowerCase();

	if (type.startsWith("image/")) return "ph:file-image";
	if (type.startsWith("video/")) return "ph:file-video";
	if (type.startsWith("audio/")) return "ph:file-audio";
	if (type === "application/pdf") return "ph:file-pdf";
	if (
		type.includes("zip") ||
		type.includes("compressed") ||
		type.includes("archive")
	)
		return "ph:file-zip";
	if (type.includes("csv") || type.includes("spreadsheet"))
		return "ph:file-csv";
	if (
		type.includes("word") ||
		type.includes("document") ||
		type === "application/rtf"
	)
		return "ph:file-doc";
	if (
		type.includes("json") ||
		type.includes("javascript") ||
		type.includes("typescript") ||
		type.includes("xml") ||
		type.includes("html")
	)
		return "ph:file-code";

	return "ph:file";
}

/**
 * Check if MIME type is an image
 */
function isImage(mimeType?: string): boolean {
	return !!mimeType?.toLowerCase().startsWith("image/");
}

/**
 * Format file size for display
 */
function formatFileSize(bytes?: number): string {
	if (!bytes) return "";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Get file extension from filename or MIME type
 */
function getExtension(filename?: string, mimeType?: string): string {
	if (filename) {
		const parts = filename.split(".");
		if (parts.length > 1) {
			return parts[parts.length - 1].toUpperCase();
		}
	}
	if (mimeType) {
		const parts = mimeType.split("/");
		return parts[parts.length - 1].toUpperCase();
	}
	return "";
}

// ============================================================================
// Component
// ============================================================================

export function AssetPreview({
	asset,
	pendingFile,
	onRemove,
	onEdit,
	loading = false,
	progress,
	disabled = false,
	showDragHandle = false,
	dragHandleProps,
	variant = "card",
	href,
	onClick,
	className,
}: AssetPreviewProps) {
	const [imageError, setImageError] = React.useState(false);

	// Check if we have actual asset data or just an ID (loading state)
	const hasAssetData = !!(asset.filename || asset.url || pendingFile);
	const isLoadingAsset = loading && !hasAssetData;

	// Get display values
	const filename = asset.filename || pendingFile?.name || "Unknown file";
	const mimeType = asset.mimeType || pendingFile?.type;
	const size = asset.size || pendingFile?.size;
	const isImageType = isImage(mimeType);
	const fileIconName = getFileIconName(mimeType);
	const extension = getExtension(filename, mimeType);

	// Build thumbnail URL
	const thumbnailUrl = React.useMemo(() => {
		// If we have a pending file, create object URL
		if (pendingFile && isImageType) {
			return URL.createObjectURL(pendingFile);
		}
		// If we have an asset URL and it's an image
		if (asset.url && isImageType) {
			return asset.url;
		}
		return null;
	}, [pendingFile, asset.url, isImageType]);

	// Clean up object URL on unmount
	React.useEffect(() => {
		return () => {
			if (pendingFile && thumbnailUrl) {
				URL.revokeObjectURL(thumbnailUrl);
			}
		};
	}, [pendingFile, thumbnailUrl]);

	// Thumbnail variant
	if (variant === "thumbnail") {
		// Show skeleton when loading and no actual asset data
		if (isLoadingAsset) {
			return <Skeleton className={cn("aspect-square w-full", className)} />;
		}

		const isInteractive = onClick && !disabled && asset.id;
		const interactiveProps = isInteractive
			? {
					role: "button" as const,
					tabIndex: 0 as const,
					onClick: () => onClick(asset.id!),
					onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							onClick(asset.id!);
						}
					},
				}
			: {};
		const content = (
			<div
				className={cn(
					"group relative aspect-square overflow-hidden border",
					"bg-muted border-border",
					disabled && "opacity-60",
					onClick && !disabled && "hover:border-border cursor-pointer",
					className,
				)}
				{...interactiveProps}
			>
				{/* Thumbnail or icon */}
				{thumbnailUrl && !imageError ? (
					<img
						src={thumbnailUrl}
						alt={asset.alt || filename}
						className="image-outline h-full w-full object-cover"
						onError={() => setImageError(true)}
					/>
				) : (
					<div className="flex h-full w-full items-center justify-center">
						<Icon
							icon={fileIconName}
							className="text-muted-foreground size-8"
						/>
					</div>
				)}

				{/* Loading overlay */}
				{loading && (
					<div className="bg-background absolute inset-0 flex items-center justify-center">
						<div className="relative">
							<Icon
								icon="ph:spinner-gap"
								className="text-muted-foreground size-6 animate-spin"
							/>
							{typeof progress === "number" && (
								<span className="text-muted-foreground absolute inset-0 flex items-center justify-center text-[10px] font-medium tabular-nums">
									{progress}%
								</span>
							)}
						</div>
					</div>
				)}

				{/* Action buttons (visible on hover) */}
				{!loading && !disabled && (onRemove || onEdit || href) && (
					<div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
						{href && (
							<Button
								type="button"
								variant="secondary"
								size="icon-xs"
								nativeButton={false}
								render={<a href={href} onClick={(e) => e.stopPropagation()} />}
							>
								<Icon icon="ph:arrow-square-out-bold" />
							</Button>
						)}
						{onEdit && (
							<Button
								type="button"
								variant="secondary"
								size="icon-xs"
								onClick={(e) => {
									e.stopPropagation();
									onEdit();
								}}
							>
								<Icon icon="ph:pencil-bold" />
							</Button>
						)}
						{onRemove && (
							<Button
								type="button"
								variant="destructive"
								size="icon-xs"
								onClick={(e) => {
									e.stopPropagation();
									onRemove();
								}}
							>
								<Icon icon="ph:trash-bold" />
							</Button>
						)}
					</div>
				)}
			</div>
		);

		return content;
	}

	// Compact variant
	if (variant === "compact") {
		// Show skeleton when loading and no actual asset data
		if (isLoadingAsset) {
			return (
				<div
					className={cn("panel-surface flex items-center gap-2 p-2", className)}
				>
					{showDragHandle && (
						<Skeleton variant="text" className="-ml-1 size-4" />
					)}
					<Skeleton className="size-8 shrink-0" />
					<div className="min-w-0 flex-1 space-y-1.5">
						<Skeleton variant="text" className="h-4 w-32" />
						<Skeleton variant="text" className="h-3 w-16" />
					</div>
				</div>
			);
		}

		const isCompactInteractive = onClick && !disabled && asset.id;
		const compactInteractiveProps = isCompactInteractive
			? {
					role: "button" as const,
					tabIndex: 0 as const,
					onClick: () => onClick(asset.id!),
					onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							onClick(asset.id!);
						}
					},
				}
			: {};
		return (
			<div
				className={cn(
					"panel-surface group flex items-center gap-2 p-2",
					disabled && "opacity-60",
					onClick && !disabled && "hover:bg-accent/20 cursor-pointer",
					className,
				)}
				{...compactInteractiveProps}
			>
				{/* Drag handle */}
				{showDragHandle && (
					<button
						type="button"
						className="text-muted-foreground hover:text-foreground -ml-1 cursor-grab touch-none active:cursor-grabbing"
						{...dragHandleProps}
					>
						<Icon icon="ph:dots-six-vertical-bold" className="size-4" />
					</button>
				)}

				{/* Icon or thumbnail */}
				<div className="bg-muted flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-sm">
					{thumbnailUrl && !imageError ? (
						<img
							src={thumbnailUrl}
							alt={asset.alt || filename}
							className="image-outline h-full w-full object-cover"
							onError={() => setImageError(true)}
						/>
					) : (
						<Icon
							icon={fileIconName}
							className="text-muted-foreground size-4"
						/>
					)}
				</div>

				{/* File info */}
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-medium">{filename}</p>
					{size && (
						<p className="text-muted-foreground text-xs tabular-nums">
							{formatFileSize(size)}
						</p>
					)}
				</div>

				{/* Loading indicator */}
				{loading && (
					<Icon
						icon="ph:spinner-gap"
						className="text-muted-foreground size-4 shrink-0 animate-spin"
					/>
				)}

				{/* Action buttons */}
				{!loading && !disabled && (href || onEdit || onRemove) && (
					<div className="flex shrink-0 items-center gap-1">
						{href && (
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								nativeButton={false}
								render={<a href={href} onClick={(e) => e.stopPropagation()} />}
							>
								<Icon icon="ph:arrow-square-out-bold" />
							</Button>
						)}
						{onEdit && (
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								onClick={(e) => {
									e.stopPropagation();
									onEdit();
								}}
							>
								<Icon icon="ph:pencil-bold" />
							</Button>
						)}
						{onRemove && (
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								onClick={(e) => {
									e.stopPropagation();
									onRemove();
								}}
								className="text-destructive hover:text-destructive"
							>
								<Icon icon="ph:x-bold" />
							</Button>
						)}
					</div>
				)}
			</div>
		);
	}

	// Card variant (default)
	// Show skeleton when loading and no actual asset data
	if (isLoadingAsset) {
		return (
			<div className={cn("panel-surface overflow-hidden", className)}>
				<Skeleton className="aspect-video w-full" />
				<div className="space-y-1.5 p-3">
					<Skeleton variant="text" className="h-4 w-3/4" />
					<Skeleton variant="text" className="h-3 w-1/2" />
				</div>
			</div>
		);
	}

	const isCardInteractive = onClick && !disabled && asset.id;
	const cardInteractiveProps = isCardInteractive
		? {
				role: "button" as const,
				tabIndex: 0 as const,
				onClick: () => onClick(asset.id!),
				onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						onClick(asset.id!);
					}
				},
			}
		: {};
	return (
		<div
			className={cn(
				"panel-surface group relative overflow-hidden",
				disabled && "opacity-60",
				onClick && !disabled && "hover:bg-accent/20 cursor-pointer",
				className,
			)}
			{...cardInteractiveProps}
		>
			{/* Drag handle */}
			{showDragHandle && (
				<button
					type="button"
					className="text-muted-foreground hover:text-foreground absolute top-2 left-2 z-10 cursor-grab touch-none rounded p-1 active:cursor-grabbing"
					{...dragHandleProps}
				>
					<Icon icon="ph:dots-six-vertical-bold" className="size-4" />
				</button>
			)}

			{/* Thumbnail area */}
			<div className="bg-muted relative aspect-video w-full">
				{thumbnailUrl && !imageError ? (
					<img
						src={thumbnailUrl}
						alt={asset.alt || filename}
						className="image-outline h-full w-full object-contain"
						onError={() => setImageError(true)}
					/>
				) : (
					<div className="flex h-full w-full flex-col items-center justify-center gap-2">
						<Icon
							icon={fileIconName}
							className="text-muted-foreground size-12"
						/>
						{extension && (
							<span className="item-surface border-border bg-muted text-muted-foreground px-2 py-0.5 text-xs font-medium">
								{extension}
							</span>
						)}
					</div>
				)}

				{/* Loading overlay */}
				{loading && (
					<div className="bg-background absolute inset-0 flex flex-col items-center justify-center gap-2">
						<Icon
							icon="ph:spinner-gap"
							className="text-muted-foreground size-8 animate-spin"
						/>
						{typeof progress === "number" && (
							<>
								<span className="text-muted-foreground text-sm font-medium tabular-nums">
									{progress}%
								</span>
								<div className="bg-muted h-1.5 w-24 overflow-hidden rounded-sm">
									<div
										className="bg-primary h-full rounded-sm transition-[width] duration-300"
										style={{ width: `${progress}%` }}
									/>
								</div>
							</>
						)}
					</div>
				)}

				{/* Remove button (top right) */}
				{!loading && !disabled && onRemove && (
					<Button
						type="button"
						variant="secondary"
						size="icon-xs"
						className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100"
						onClick={(e) => {
							e.stopPropagation();
							onRemove();
						}}
					>
						<Icon icon="ph:x-bold" />
					</Button>
				)}
			</div>

			{/* File info footer */}
			<div className="border-border flex items-center gap-2 border-t p-2">
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-medium" title={filename}>
						{filename}
					</p>
					<p className="text-muted-foreground text-xs tabular-nums">
						{formatFileSize(size)}
						{mimeType && ` • ${mimeType.split("/")[1]?.toUpperCase()}`}
					</p>
				</div>

				{/* Action buttons */}
				{!loading && !disabled && (href || onEdit) && (
					<div className="flex items-center gap-1">
						{href && (
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								nativeButton={false}
								render={
									// oxlint-disable-next-line jsx-a11y/anchor-has-content -- TODO: improve accessibility
									<a href={href} onClick={(e) => e.stopPropagation()} />
								}
							>
								<Icon icon="ph:arrow-square-out-bold" />
							</Button>
						)}
						{onEdit && (
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								onClick={(e) => {
									e.stopPropagation();
									onEdit();
								}}
							>
								<Icon icon="ph:pencil-bold" />
							</Button>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
