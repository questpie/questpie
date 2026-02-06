/**
 * Block Library
 *
 * Block picker component for adding new blocks.
 * Used both as standalone panel and as popover content.
 */

"use client";

import { Icon } from "@iconify/react";
import * as React from "react";
import type { BlockDefinition } from "../../builder/block/types.js";
import { cn } from "../../lib/utils.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { useBlockEditor, useBlockEditorState } from "./block-editor-context.js";
import { BlockIcon } from "./block-type-icon.js";

// ============================================================================
// Types
// ============================================================================

type BlockWithName = BlockDefinition & { name: string };

export type BlockLibraryContentProps = {
  /** Callback when a block is selected */
  onSelect: (type: string) => void;
  /** Show header with close button */
  showHeader?: boolean;
  /** Close handler for header */
  onClose?: () => void;
};

// ============================================================================
// BlockLibraryContent - Reusable content for popover or panel
// ============================================================================

export function BlockLibraryContent({
  onSelect,
  showHeader = false,
  onClose,
}: BlockLibraryContentProps) {
  const state = useBlockEditorState();
  const [search, setSearch] = React.useState("");

  // Group blocks by category
  const blocksByCategory = React.useMemo(() => {
    const result = new Map<string, BlockWithName[]>();

    for (const [name, def] of Object.entries(state.blocks)) {
      // Filter by allowed blocks
      if (state.allowedBlocks && !state.allowedBlocks.includes(name)) {
        continue;
      }

      // Filter by search
      if (search) {
        const label = getBlockDisplayLabel(def);
        if (!label.toLowerCase().includes(search.toLowerCase())) {
          continue;
        }
      }

      const category = def.category || "other";
      if (!result.has(category)) {
        result.set(category, []);
      }
      result.get(category)!.push({ ...def, name });
    }

    return result;
  }, [state.blocks, state.allowedBlocks, search]);

  // Focus search on mount
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    const timer = setTimeout(() => searchInputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex flex-col">
      {/* Optional Header */}
      {showHeader && (
        <div className="flex items-center justify-between border-b p-3">
          <h3 className="font-medium text-sm">Add Block</h3>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onClose}
            >
              <Icon icon="ph:x" className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      {/* Search */}
      <div className="p-3">
        <div className="relative">
          <Icon
            icon="ph:magnifying-glass"
            className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={searchInputRef}
            placeholder="Search blocks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      {/* Block list by category */}
      <div className="max-h-64 overflow-auto px-3 pb-3">
        {blocksByCategory.size === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-4">
            No blocks found
          </div>
        ) : (
          <div className="space-y-4">
            {Array.from(blocksByCategory.entries()).map(
              ([category, blocks]) => (
                <div key={category}>
                  <h4 className="mb-1.5 text-xs font-medium uppercase text-muted-foreground">
                    {getCategoryLabel(category)}
                  </h4>
                  <div className="grid grid-cols-2 gap-1.5">
                    {blocks.map((block) => (
                      <button
                        type="button"
                        key={block.name}
                        className={cn(
                          "flex items-center gap-2 rounded-md border p-2 text-left",
                          "transition-colors hover:border-primary hover:bg-accent",
                          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        )}
                        onClick={() => onSelect(block.name)}
                      >
                        <BlockIcon
                          icon={block.icon}
                          size={16}
                          className="text-muted-foreground flex-shrink-0"
                        />
                        <span className="text-xs truncate">
                          {getBlockDisplayLabel(block)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// BlockLibrary - Standalone panel version (legacy, for sidebar use)
// ============================================================================

export function BlockLibrary() {
  const { state, actions } = useBlockEditor();

  const handleSelect = (type: string) => {
    if (state.insertPosition) {
      actions.addBlock(type, state.insertPosition);
    }
  };

  return (
    <div className="h-full">
      <BlockLibraryContent
        onSelect={handleSelect}
        showHeader
        onClose={actions.closeLibrary}
      />
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function getBlockDisplayLabel(block: BlockDefinition): string {
  if (!block.label) {
    return block.name;
  }

  const label = block.label;

  if (typeof label === "string") {
    return label;
  }

  if (typeof label === "function") {
    return block.name;
  }

  if ("key" in label) {
    return label.fallback || block.name;
  }

  // I18nLocaleMap
  const localeMap = label as Record<string, string>;
  return localeMap.en || Object.values(localeMap)[0] || block.name;
}

function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    layout: "Layout",
    content: "Content",
    media: "Media",
    sections: "Sections",
    interactive: "Interactive",
    other: "Other",
  };
  return (
    labels[category] || category.charAt(0).toUpperCase() + category.slice(1)
  );
}
