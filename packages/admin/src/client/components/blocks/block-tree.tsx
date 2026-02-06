/**
 * Block Tree
 *
 * Renders a list of blocks with drag-and-drop support.
 */

"use client";

import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import * as React from "react";
import type { BlockNode } from "../../blocks/types.js";
import { cn } from "../../lib/utils.js";
import { BlockInsertButton } from "./block-insert-button.js";
import { BlockItem } from "./block-item.js";

// ============================================================================
// Types
// ============================================================================

export type BlockTreeProps = {
  /** Block nodes to render */
  blocks: BlockNode[];
  /** Nesting level (0 = root) */
  level: number;
  /** Parent block ID (null = root) */
  parentId: string | null;
};

// ============================================================================
// Component
// ============================================================================

export function BlockTree({ blocks, level, parentId }: BlockTreeProps) {
  // Get block IDs for sortable context
  const blockIds = React.useMemo(() => blocks.map((b) => b.id), [blocks]);

  return (
    <div className="min-w-fit space-y-1">
      <SortableContext items={blockIds} strategy={verticalListSortingStrategy}>
        {blocks.map((block, index) => (
          <BlockItem
            key={block.id}
            block={block}
            level={level}
            index={index}
            parentId={parentId}
          />
        ))}
      </SortableContext>

      {/* Single add button at the end of this level */}
      <BlockInsertButton
        position={{ parentId, index: blocks.length }}
        compact
        className={level > 0 ? "mt-1" : "mt-2"}
      />
    </div>
  );
}
