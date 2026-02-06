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

import * as React from "react";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import type { Asset } from "../../hooks/use-upload";

// ============================================================================
// Types
// ============================================================================

export interface AssetPreviewProps {
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
    const content = (
      <div
        className={cn(
          "group relative aspect-square overflow-hidden rounded-lg border",
          "bg-muted/30 border-border/60",
          disabled && "opacity-60",
          onClick && !disabled && "cursor-pointer hover:border-border",
          className,
        )}
        onClick={
          onClick && !disabled && asset.id
            ? () => onClick(asset.id!)
            : undefined
        }
      >
        {/* Thumbnail or icon */}
        {thumbnailUrl && !imageError ? (
          <img
            src={thumbnailUrl}
            alt={asset.alt || filename}
            className="h-full w-full object-cover"
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
          <div className="bg-background/80 absolute inset-0 flex items-center justify-center">
            <div className="relative">
              <Icon
                icon="ph:spinner-gap"
                className="text-muted-foreground size-6 animate-spin"
              />
              {typeof progress === "number" && (
                <span className="text-muted-foreground absolute inset-0 flex items-center justify-center text-[10px] font-medium">
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
    return (
      <div
        className={cn(
          "group flex items-center gap-2 rounded-md border p-2",
          "bg-muted/30 border-border/60",
          disabled && "opacity-60",
          onClick && !disabled && "cursor-pointer hover:border-border",
          className,
        )}
        onClick={
          onClick && !disabled && asset.id
            ? () => onClick(asset.id!)
            : undefined
        }
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
        <div className="bg-muted flex size-8 shrink-0 items-center justify-center overflow-hidden rounded">
          {thumbnailUrl && !imageError ? (
            <img
              src={thumbnailUrl}
              alt={asset.alt || filename}
              className="h-full w-full object-cover"
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
            <p className="text-muted-foreground text-xs">
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
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-lg border",
        "bg-muted/30 border-border/60",
        disabled && "opacity-60",
        onClick && !disabled && "cursor-pointer hover:border-border",
        className,
      )}
      onClick={
        onClick && !disabled && asset.id ? () => onClick(asset.id!) : undefined
      }
    >
      {/* Drag handle */}
      {showDragHandle && (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground absolute left-2 top-2 z-10 cursor-grab touch-none rounded p-1 active:cursor-grabbing"
          {...dragHandleProps}
        >
          <Icon icon="ph:dots-six-vertical-bold" className="size-4" />
        </button>
      )}

      {/* Thumbnail area */}
      <div className="bg-muted/50 relative aspect-video w-full">
        {thumbnailUrl && !imageError ? (
          <img
            src={thumbnailUrl}
            alt={asset.alt || filename}
            className="h-full w-full object-contain"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2">
            <Icon
              icon={fileIconName}
              className="text-muted-foreground size-12"
            />
            {extension && (
              <span className="bg-muted text-muted-foreground rounded px-2 py-0.5 text-xs font-medium">
                {extension}
              </span>
            )}
          </div>
        )}

        {/* Loading overlay */}
        {loading && (
          <div className="bg-background/80 absolute inset-0 flex flex-col items-center justify-center gap-2">
            <Icon
              icon="ph:spinner-gap"
              className="text-muted-foreground size-8 animate-spin"
            />
            {typeof progress === "number" && (
              <>
                <span className="text-muted-foreground text-sm font-medium">
                  {progress}%
                </span>
                <div className="bg-muted h-1.5 w-24 overflow-hidden rounded-full">
                  <div
                    className="bg-primary h-full rounded-full transition-all duration-300"
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
            className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100"
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
      <div className="flex items-center gap-2 border-t p-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={filename}>
            {filename}
          </p>
          <p className="text-muted-foreground text-xs">
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
                  // biome-ignore lint/a11y/useAnchorContent: TODO: improve accessibility
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
