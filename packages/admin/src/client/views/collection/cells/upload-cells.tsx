/**
 * Upload Cell Components
 *
 * Cells for displaying asset/upload fields:
 * - UploadCell - single asset
 * - UploadManyCell - multiple assets
 *
 * Uses unified AssetThumbnail component
 */

import * as React from "react";
import { Badge } from "../../../components/ui/badge";
import { AssetThumbnail } from "./shared/asset-thumbnail";

// ============================================================================
// Upload Cell
// ============================================================================

/**
 * Upload cell - displays single asset thumbnail or file info
 * Uses AssetThumbnail with size="sm"
 */
export function UploadCell({ value }: { value: unknown }) {
  return <AssetThumbnail asset={value} size="sm" showFilename />;
}

// ============================================================================
// Upload Many Cell
// ============================================================================

/**
 * Upload many cell - displays multiple assets count or thumbnails
 */
export function UploadManyCell({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">-</span>;
  }

  if (!Array.isArray(value)) {
    return <span className="text-muted-foreground">-</span>;
  }

  if (value.length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }

  // Get image assets for preview
  const imageAssets = value
    .filter((item): item is Record<string, unknown> => {
      if (typeof item !== "object" || item === null) return false;
      const mimeType = (item as Record<string, unknown>).mimeType;
      return typeof mimeType === "string" && mimeType.startsWith("image/");
    })
    .slice(0, 3);

  // Show mini grid of thumbnails for images
  if (imageAssets.length > 0) {
    const remaining = value.length - imageAssets.length;
    return (
      <div className="flex items-center gap-1">
        <div className="flex -space-x-2">
          {imageAssets.map((asset, index) => (
            <img
              key={(asset.id as string) || index}
              src={asset.url as string}
              alt={(asset.filename as string) || "Asset"}
              className="size-6 rounded border bg-background object-cover"
            />
          ))}
        </div>
        {remaining > 0 && (
          <span className="text-xs text-muted-foreground ml-1">
            +{remaining}
          </span>
        )}
      </div>
    );
  }

  // Show count badge for non-images
  return (
    <Badge variant="secondary">
      {value.length} file{value.length !== 1 ? "s" : ""}
    </Badge>
  );
}
