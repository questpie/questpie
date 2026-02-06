/**
 * Block Insert Button
 *
 * Button with popover to add new blocks at a specific position.
 */

"use client";

import { Icon } from "@iconify/react";
import * as React from "react";
import { cn } from "../../lib/utils.js";
import { Button } from "../ui/button.js";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.js";
import { useBlockEditorActions } from "./block-editor-context.js";
import { BlockLibraryContent } from "./block-library.js";
import type { InsertPosition } from "./utils/tree-utils.js";

// ============================================================================
// Types
// ============================================================================

export type BlockInsertButtonProps = {
  /** Position where the block will be inserted */
  position: InsertPosition;
  /** Compact style (shows on hover) */
  compact?: boolean;
  /** Custom class name */
  className?: string;
};

// ============================================================================
// Component
// ============================================================================

export function BlockInsertButton({
  position,
  compact = false,
  className,
}: BlockInsertButtonProps) {
  const [open, setOpen] = React.useState(false);
  const { addBlock } = useBlockEditorActions();

  const handleSelectBlock = (type: string) => {
    addBlock(type, position);
    setOpen(false);
  };

  if (compact) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <div
              className={cn(
                "group relative w-full cursor-pointer -my-0.5 z-10",
                "h-2 sm:h-1",
                className,
              )}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen(true);
                }
              }}
            />
          }
        >
          {/* Hover indicator line */}
          <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-primary/40 transition-colors sm:bg-transparent sm:group-hover:bg-primary" />

          {/* Add button that appears on hover - overlays other content */}
          <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-center opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
            <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground shadow-sm">
              <Icon icon="ph:plus-bold" width={10} height={10} />
              <span>Add</span>
            </div>
          </div>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <BlockLibraryContent onSelect={handleSelectBlock} />
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className={cn("w-full border-dashed", className)}
          />
        }
      >
        <Icon icon="ph:plus" className="mr-2 h-4 w-4" />
        Add block
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <BlockLibraryContent onSelect={handleSelectBlock} />
      </PopoverContent>
    </Popover>
  );
}
