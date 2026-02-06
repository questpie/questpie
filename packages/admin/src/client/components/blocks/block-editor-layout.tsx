/**
 * Block Editor Layout
 *
 * Side-by-side layout: tree on left, form on right when block selected.
 * Uses resizable panels for flexible sizing.
 */

"use client";

import * as React from "react";
import { useFocusOptional } from "../../context/focus-context.js";
import { cn } from "../../lib/utils.js";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../ui/resizable.js";
import { BlockCanvas } from "./block-canvas.js";
import { useBlockEditor } from "./block-editor-context.js";
import { BlockForm } from "./block-form.js";

// ============================================================================
// Types
// ============================================================================

export type BlockEditorLayoutProps = {
  /** Custom class name */
  className?: string;
  /** Minimum height for the editor */
  minHeight?: number;
};

// ============================================================================
// Component
// ============================================================================

export function BlockEditorLayout({
  className,
  minHeight = 500,
}: BlockEditorLayoutProps) {
  const { state, actions } = useBlockEditor();
  const focusContext = useFocusOptional();
  const hasSelectedBlock = !!state.selectedBlockId;
  const hasBlocks = state.content._tree.length > 0;

  // Sync FocusContext block focus to BlockEditor
  React.useEffect(() => {
    if (!focusContext) return;

    const { state: focusState } = focusContext;

    if (focusState.type === "block") {
      const blockId = focusState.blockId;

      // Select the block
      actions.selectBlock(blockId);

      // Expand if collapsed
      if (!state.expandedBlockIds.has(blockId)) {
        actions.toggleExpanded(blockId);
      }
    }
  }, [focusContext?.state, state.expandedBlockIds, actions]);

  return (
    <div
      className={cn(
        "rounded-lg border bg-background overflow-hidden",
        className,
      )}
      style={{ height: minHeight }}
    >
      <ResizablePanelGroup orientation="horizontal" className="h-full">
        {/* Block Tree Panel - always visible */}
        <ResizablePanel
          defaultSize={hasSelectedBlock ? 40 : 100}
          minSize={20}
          className="bg-muted/30"
        >
          <div className="h-full overflow-x-auto overflow-y-auto p-2">
            <div className="min-w-fit">
              <BlockCanvas />

              {/* Empty state hint when no blocks */}
              {!hasBlocks && (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  Click the + button above to add your first block
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>

        {/* Resize handle and form panel - only when block selected */}
        {hasSelectedBlock && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={60} minSize={30}>
              <div className="h-full overflow-auto">
                <BlockForm />
              </div>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}
