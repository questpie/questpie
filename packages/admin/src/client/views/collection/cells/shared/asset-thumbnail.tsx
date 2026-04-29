/**
 * AssetThumbnail Component
 *
 * Unified asset display component for all contexts.
 * Replaces 3 duplicate implementations:
 * - UploadCell (32px table)
 * - AssetPreviewCell (40px preview)
 * - AssetPreviewField (400px form preview)
 */

import { Icon } from "@iconify/react";
import type * as React from "react";

import { Button } from "../../../../components/ui/button";
import { cn } from "../../../../lib/utils";

// ============================================================================
// Types
// ============================================================================

interface AssetThumbnailProps {
	/**
	 * Asset object or ID
	 */
	asset: unknown;

	/**
	 * Size variant
	 * - sm: 32px (table cells)
	 * - md: 40px/64px (preview)
	 * - lg: 400px (form preview with controls)
	 */
	size?: "sm" | "md" | "lg";

	/**
	 * Show filename next to thumbnail (sm/md sizes only)
	 */
	showFilename?: boolean;

	/**
	 * Show video/audio controls (lg size only)
	 */
	showControls?: boolean;

	/**
	 * Called when the thumbnail is clicked
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

function getFileIcon(mimeType?: string): string {
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

function isImage(mimeType?: string): boolean {
	return !!mimeType?.toLowerCase().startsWith("image/");
}

function isVideo(mimeType?: string): boolean {
	return !!mimeType?.toLowerCase().startsWith("video/");
}

function isAudio(mimeType?: string): boolean {
	return !!mimeType?.toLowerCase().startsWith("audio/");
}

// ============================================================================
// Component
// ============================================================================

export function AssetThumbnail({
	asset,
	size = "sm",
	showFilename = false,
	showControls = false,
	onClick,
	className,
}: AssetThumbnailProps) {
	// Handle null/undefined
	if (asset === null || asset === undefined) {
		return <span className="text-muted-foreground">-</span>;
	}

	// If asset is just an ID string
	if (typeof asset === "string") {
		return (
			<span
				className={cn(
					"qa-asset-thumbnail text-muted-foreground inline-flex items-center gap-2",
					className,
				)}
				title={asset}
			>
				<span className="bg-muted border-border-subtle flex size-8 shrink-0 items-center justify-center rounded border">
					<Icon icon="ph:file" className="size-4" />
				</span>
			</span>
		);
	}

	// Extract asset properties
	const assetObj = asset as Record<string, unknown>;
	const url = assetObj.url as string | undefined;
	const filename = assetObj.filename as string | undefined;
	const mimeType = assetObj.mimeType as string | undefined;
	const alt = assetObj.alt as string | undefined;

	const isImageType = isImage(mimeType);
	const isVideoType = isVideo(mimeType);
	const isAudioType = isAudio(mimeType);
	const fileIcon = getFileIcon(mimeType);

	// ========== SM SIZE (32px) - Table cells ==========
	if (size === "sm") {
		const assetId = assetObj.id as string | undefined;
		const handleClick = onClick && assetId ? () => onClick(assetId) : undefined;

		const containerProps = handleClick
			? {
					role: "button" as const,
					tabIndex: 0 as const,
					onClick: handleClick,
					onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							handleClick();
						}
					},
				}
			: {};

		return (
			<div
				className={cn(
					"qa-asset-thumbnail flex items-center gap-2",
					onClick && "cursor-pointer hover:opacity-80",
					className,
				)}
				{...containerProps}
			>
				{isImageType && url ? (
					<img
						src={url}
						alt={filename || "Asset"}
						className="image-outline size-8 rounded object-cover"
					/>
				) : (
					<span className="bg-muted border-border-subtle flex size-8 shrink-0 items-center justify-center rounded border">
						<Icon icon={fileIcon} className="text-muted-foreground size-4" />
					</span>
				)}
				{showFilename && filename && (
					<span className="max-w-[120px] truncate text-xs" title={filename}>
						{filename}
					</span>
				)}
			</div>
		);
	}

	// ========== MD SIZE (40px) - Preview/Icon ==========
	if (size === "md") {
		const assetId = assetObj.id as string | undefined;
		const handleClick = onClick && assetId ? () => onClick(assetId) : undefined;

		if (isImageType && url) {
			const interactiveProps = handleClick
				? {
						role: "button" as const,
						tabIndex: 0 as const,
						onClick: handleClick,
						onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								handleClick();
							}
						},
					}
				: {};
			return (
				<div
					className={cn(
						"qa-asset-thumbnail flex items-center justify-center",
						onClick && "cursor-pointer hover:opacity-80",
						className,
					)}
					{...interactiveProps}
				>
					<img
						src={url}
						alt={filename || "Asset"}
						className="image-outline size-10 rounded object-cover"
					/>
				</div>
			);
		}

		// Show icon for non-images
		{
			const interactiveProps = handleClick
				? {
						role: "button" as const,
						tabIndex: 0 as const,
						onClick: handleClick,
						onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								handleClick();
							}
						},
					}
				: {};
			return (
				<div
					className={cn(
						"qa-asset-thumbnail flex items-center justify-center",
						onClick && "cursor-pointer hover:opacity-80",
						className,
					)}
					{...interactiveProps}
				>
					<div className="bg-muted flex size-10 items-center justify-center rounded border">
						<Icon icon={fileIcon} className="text-muted-foreground size-5" />
					</div>
				</div>
			);
		}
	}

	// ========== LG SIZE (400px) - Full preview with controls ==========
	return (
		<div
			className={cn(
				"qa-asset-thumbnail bg-muted relative overflow-hidden border",
				className,
			)}
		>
			{/* Image Preview */}
			{isImageType && url && (
				<div className="relative">
					<img
						src={url}
						alt={alt || filename || "Asset preview"}
						className="image-outline max-h-[400px] w-full object-contain"
					/>
				</div>
			)}

			{/* Video Preview */}
			{isVideoType && url && (
				<div className="relative">
					{showControls ? (
						<video
							src={url}
							controls
							className="max-h-[400px] w-full"
							preload="metadata"
						>
							<track kind="captions" />
							Your browser does not support the video tag.
						</video>
					) : (
						<div className="flex flex-col items-center justify-center gap-4 p-12">
							<Icon icon={fileIcon} className="text-muted-foreground size-20" />
							<p className="text-muted-foreground text-sm">
								{filename || "Video"}
							</p>
						</div>
					)}
				</div>
			)}

			{/* Audio Preview */}
			{isAudioType && url && (
				<div className="flex flex-col items-center justify-center gap-4 p-8">
					<Icon icon={fileIcon} className="text-muted-foreground size-16" />
					{showControls && (
						<audio
							src={url}
							controls
							className="w-full max-w-md"
							preload="metadata"
						>
							<track kind="captions" />
							Your browser does not support the audio tag.
						</audio>
					)}
					{!showControls && (
						<p className="text-muted-foreground text-sm">
							{filename || "Audio"}
						</p>
					)}
				</div>
			)}

			{/* Other File Types */}
			{(!url || (!isImageType && !isVideoType && !isAudioType)) && (
				<div className="flex flex-col items-center justify-center gap-4 p-12">
					<Icon icon={fileIcon} className="text-muted-foreground size-20" />
					<p className="text-muted-foreground text-sm">{filename || "File"}</p>
				</div>
			)}

			{/* Open in new tab button (lg size only) */}
			{url && (
				<div className="absolute top-2 right-2">
					<Button
						type="button"
						variant="secondary"
						size="icon-sm"
						nativeButton={false}
						render={
							// oxlint-disable-next-line jsx-a11y/anchor-has-content -- Button provides the visible content.
							<a href={url} target="_blank" rel="noopener noreferrer" />
						}
					>
						<Icon icon="ph:arrow-square-out-bold" />
					</Button>
				</div>
			)}
		</div>
	);
}
