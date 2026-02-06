/**
 * MediaPickerDialog Component
 *
 * Dialog for searching and selecting existing assets from the media library.
 * Used in UploadField and UploadManyField to allow browsing existing files.
 *
 * Features:
 * - Search by filename
 * - MIME type filtering
 * - Responsive grid display
 * - Single/multiple selection modes
 * - Pagination support
 *
 * @example
 * ```tsx
 * <MediaPickerDialog
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   mode="single"
 *   onSelect={(id) => field.onChange(id)}
 * />
 * ```
 */

import { Icon } from "@iconify/react";
import * as React from "react";
import { toast } from "sonner";
import { useCollectionList } from "../../hooks/use-collection";
import type { Asset } from "../../hooks/use-upload";
import { AssetPreview } from "../primitives/asset-preview";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";
import { MediaGrid } from "./media-grid";

// ============================================================================
// Types
// ============================================================================

export interface MediaPickerDialogProps {
  /**
   * Dialog open state
   */
  open: boolean;

  /**
   * Called when dialog open state changes
   */
  onOpenChange: (open: boolean) => void;

  /**
   * Selection mode
   * @default "single"
   */
  mode?: "single" | "multiple";

  /**
   * Accepted MIME types filter
   * @example ["image/*", "video/*"]
   */
  accept?: string[];

  /**
   * Called when assets are selected
   */
  onSelect: (ids: string | string[]) => void;

  /**
   * Maximum number of items (for multiple mode)
   */
  maxItems?: number;

  /**
   * Target collection
   * @default "assets"
   */
  collection?: string;
}

// ============================================================================
// MIME Type Filters
// ============================================================================

const MIME_TYPE_FILTERS = [
  { value: "all", label: "All Files", mimePattern: undefined },
  { value: "images", label: "Images", mimePattern: "image/" },
  { value: "videos", label: "Videos", mimePattern: "video/" },
  { value: "audio", label: "Audio", mimePattern: "audio/" },
  { value: "documents", label: "Documents", mimePattern: "application/pdf" },
];

// ============================================================================
// Component
// ============================================================================

export function MediaPickerDialog({
  open,
  onOpenChange,
  mode = "single",
  accept,
  onSelect,
  maxItems,
  collection = "assets",
}: MediaPickerDialogProps) {
  // State
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = React.useState("");
  const [mimeFilter, setMimeFilter] = React.useState("all");
  const [previewAssetId, setPreviewAssetId] = React.useState<string | null>(
    null,
  );

  // Build where clause for query
  const where = React.useMemo(() => {
    const andConditions: any[] = [];

    // MIME type filter
    const selectedFilter = MIME_TYPE_FILTERS.find(
      (f) => f.value === mimeFilter,
    );
    if (selectedFilter?.mimePattern) {
      andConditions.push({
        mimeType: { startsWith: selectedFilter.mimePattern },
      });
    }

    // Accept prop filter
    if (accept && accept.length > 0) {
      const acceptPatterns = accept.map((pattern) => {
        if (pattern.startsWith(".")) {
          return { filename: { endsWith: pattern } };
        }
        if (pattern.endsWith("/*")) {
          // e.g., "image/*" -> "image/"
          return { mimeType: { startsWith: pattern.slice(0, -1) } };
        }
        // Exact match
        return { mimeType: pattern };
      });

      if (acceptPatterns.length === 1) {
        andConditions.push(acceptPatterns[0]);
      } else {
        andConditions.push({ OR: acceptPatterns });
      }
    }

    if (andConditions.length === 0) return undefined;
    if (andConditions.length === 1) return andConditions[0];
    return { AND: andConditions };
  }, [mimeFilter, accept]);

  const trimmedSearch = searchQuery.trim();

  // Fetch assets
  const { data, isLoading } = useCollectionList(
    collection,
    {
      where,
      search: trimmedSearch || undefined,
      limit: 50,
      orderBy: { createdAt: "desc" },
    },
    {
      enabled: open,
    },
  );

  const assets = (data?.docs || []) as Asset[];
  const previewAsset = React.useMemo(
    () => assets.find((asset) => asset.id === previewAssetId) ?? null,
    [assets, previewAssetId],
  );

  // Reset state when dialog closes
  React.useEffect(() => {
    if (!open) {
      setSelectedIds(new Set());
      setSearchQuery("");
      setMimeFilter("all");
      setPreviewAssetId(null);
      return;
    }

    if (!previewAssetId && assets.length > 0) {
      setPreviewAssetId(assets[0].id);
      return;
    }

    if (previewAssetId && assets.length > 0) {
      const stillExists = assets.some((asset) => asset.id === previewAssetId);
      if (!stillExists) {
        setPreviewAssetId(assets[0].id);
      }
    }
  }, [open, assets, previewAssetId]);

  // Handle selection change
  const handleSelectionChange = (ids: Set<string>) => {
    // Check maxItems for multiple mode
    if (mode === "multiple" && maxItems && ids.size > maxItems) {
      toast.warning(`Maximum ${maxItems} items allowed`);
      return;
    }

    setSelectedIds(ids);
  };

  // Handle select button click
  const handleSelect = () => {
    if (selectedIds.size === 0) {
      toast.error("Please select at least one asset");
      return;
    }

    if (mode === "single") {
      const [id] = Array.from(selectedIds);
      onSelect(id);
    } else {
      onSelect(Array.from(selectedIds));
    }

    onOpenChange(false);
  };

  // Handle cancel
  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="data-[side=right]:sm:max-w-6xl w-full p-0"
      >
        <SheetHeader className="px-6 pt-6">
          <SheetTitle>Browse Media Library</SheetTitle>
          <SheetDescription>
            {mode === "single"
              ? "Select an asset from your library"
              : `Select up to ${maxItems || "multiple"} assets`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-hidden px-6 pb-6">
          {/* Filters */}
          <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row">
            {/* Search input */}
            <div className="relative flex-1">
              <Icon
                icon="ph:magnifying-glass-bold"
                className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2"
              />
              <Input
                type="text"
                placeholder="Search by filename..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* MIME type filter */}
            {!accept && (
              <Select
                value={mimeFilter}
                onValueChange={(value) => setMimeFilter(value || "all")}
              >
                <SelectTrigger className="w-full sm:w-[180px]">
                  <div className="flex items-center gap-2">
                    <Icon icon="ph:funnel-simple-bold" className="size-4" />
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {MIME_TYPE_FILTERS.map((filter) => (
                    <SelectItem key={filter.value} value={filter.value}>
                      {filter.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Assets + Preview */}
          <div className="flex flex-1 gap-4 overflow-hidden">
            <div className="flex-1 overflow-y-auto pr-1">
              <MediaGrid
                assets={assets}
                selectedIds={selectedIds}
                onSelectionChange={handleSelectionChange}
                selectionMode={mode}
                loading={isLoading}
                columns={5}
                className="gap-2"
                onAssetClick={(asset) => setPreviewAssetId(asset.id)}
              />
            </div>
            <div className="hidden lg:flex w-80 xl:w-96 shrink-0 flex-col gap-3 border-l pl-4">
              <p className="text-muted-foreground text-xs uppercase tracking-wide">
                Preview
              </p>
              {previewAsset ? (
                <AssetPreview asset={previewAsset} variant="card" />
              ) : (
                <div className="flex items-center justify-center rounded-lg border border-dashed p-6 text-xs text-muted-foreground">
                  Select an asset to preview
                </div>
              )}
            </div>
          </div>

          <div className="lg:hidden border-t pt-4">
            {previewAsset ? (
              <AssetPreview asset={previewAsset} variant="compact" />
            ) : (
              <div className="flex items-center justify-center rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
                Select an asset to preview
              </div>
            )}
          </div>
        </div>

        <SheetFooter className="border-t px-6 py-4">
          <div className="flex w-full justify-end gap-2">
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button
              onClick={handleSelect}
              disabled={selectedIds.size === 0 || isLoading}
            >
              Select {selectedIds.size > 0 && `(${selectedIds.size})`}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
