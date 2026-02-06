/**
 * Block Item
 *
 * Single draggable block item in the tree.
 */

"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Icon } from "@iconify/react";
import * as React from "react";
import type { BlockNode } from "../../blocks/types.js";
import { useFocusOptional } from "../../context/focus-context.js";
import { cn } from "../../lib/utils.js";
import {
  useBlockEditor,
  useIsBlockExpanded,
  useIsBlockSelected,
} from "./block-editor-context.js";
import { BlockItemDropdownMenu } from "./block-item-menu.js";
import { BlockTree } from "./block-tree.js";
import { BlockTypeIcon } from "./block-type-icon.js";

// ============================================================================
// Types
// ============================================================================

export type BlockItemProps = {
  /** Block node data */
  block: BlockNode;
  /** Nesting level (0 = root) */
  level: number;
  /** Index in parent's children */
  index: number;
  /** Parent block ID (null = root) */
  parentId: string | null;
};

// ============================================================================
// Component
// ============================================================================

export function BlockItem({ block, level, index, parentId }: BlockItemProps) {
  const { state, actions } = useBlockEditor();
  const blockDef = state.blocks[block.type];
  const isSelected = useIsBlockSelected(block.id);
  const isExpanded = useIsBlockExpanded(block.id);
  const canHaveChildren = blockDef?.allowChildren ?? false;
  const focusContext = useFocusOptional();

  // Drag and drop
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
    active,
  } = useSortable({ id: block.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Show drop indicator when dragging over this item (but not self)
  const showDropIndicator = isOver && active?.id !== block.id;

  // Get block label from values or definition
  const values = state.content._values[block.id];
  const blockLabel = getBlockLabel(block, blockDef, values);

  // Handlers
  const handleSelect = (e: React.MouseEvent) => {
    e.stopPropagation();
    focusContext?.clearFocus();
    actions.selectBlock(block.id);
  };

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    actions.toggleExpanded(block.id);
  };

  const handleDuplicate = React.useCallback(() => {
    actions.duplicateBlock(block.id);
  }, [actions, block.id]);

  const handleRemove = React.useCallback(() => {
    actions.removeBlock(block.id);
  }, [actions, block.id]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("group/item relative", isDragging && "opacity-50")}
    >
      {/* Drop indicator line */}
      {showDropIndicator && (
        <div className="absolute -top-0.5 left-0 right-0 z-10 h-0.5 bg-primary" />
      )}

      {/* Block row */}
      <div
        role="button"
        tabIndex={0}
        className={cn(
          "flex min-w-[200px] cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors",
          "hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          isSelected && "bg-accent ring-2 ring-primary",
          showDropIndicator && "ring-1 ring-primary/30",
        )}
        onClick={handleSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleSelect(e as unknown as React.MouseEvent);
          }
        }}
      >
        {/* Drag handle */}
        <button
          type="button"
          className="cursor-grab opacity-0 transition-opacity group-hover/item:opacity-100 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <Icon
            icon="ph:dots-six-vertical"
            className="h-4 w-4 text-muted-foreground"
          />
        </button>

        {/* Expand/collapse for layout blocks */}
        {canHaveChildren ? (
          <button
            type="button"
            onClick={handleToggleExpand}
            className="p-0.5 text-muted-foreground hover:text-foreground"
          >
            {isExpanded ? (
              <Icon icon="ph:caret-down" className="h-4 w-4" />
            ) : (
              <Icon icon="ph:caret-right" className="h-4 w-4" />
            )}
          </button>
        ) : null}

        {/* Block icon */}
        <BlockTypeIcon
          type={block.type}
          className="h-4 w-4 shrink-0 text-muted-foreground"
        />

        {/* Block label */}
        <span className="flex-1 min-w-0 truncate text-sm">{blockLabel}</span>

        {/* Actions */}
        <div className="flex items-center">
          <BlockItemDropdownMenu
            blockId={block.id}
            canHaveChildren={canHaveChildren}
            onDuplicate={handleDuplicate}
            onRemove={handleRemove}
            className={cn(
              "h-8 w-8 sm:h-7 sm:w-7 transition-opacity",
              "opacity-100 sm:opacity-0 sm:group-hover/item:opacity-100",
            )}
          />
        </div>
      </div>

      {/* Children */}
      {canHaveChildren && isExpanded && (
        <div className="ml-4 mt-1 border-l border-border/40 pl-3">
          <BlockTree
            blocks={block.children}
            level={level + 1}
            parentId={block.id}
          />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

import type { BlockDefinition } from "../../builder/block/types.js";

function getBlockLabel(
  block: BlockNode,
  blockDef: BlockDefinition | undefined,
  values: Record<string, unknown> | undefined,
): string {
  // Try to get meaningful label from values
  if (values) {
    const title = values.title || values.name || values.label || values.heading;
    if (title && typeof title === "string") {
      return title.slice(0, 50);
    }
  }

  // Fall back to block type label
  if (blockDef?.label) {
    const label = blockDef.label;

    // Handle string directly
    if (typeof label === "string") {
      return label;
    }

    // Handle function (not ideal but return type name)
    if (typeof label === "function") {
      return block.type.charAt(0).toUpperCase() + block.type.slice(1);
    }

    // Handle key-based translation object
    if ("key" in label) {
      return label.fallback || block.type;
    }

    // Handle I18nLocaleMap - use English or first available
    const localeLabel = (label as Record<string, string>).en;
    if (localeLabel) {
      return localeLabel;
    }
    const firstValue = Object.values(label)[0];
    if (typeof firstValue === "string") {
      return firstValue;
    }
  }

  // Fall back to type name
  return block.type.charAt(0).toUpperCase() + block.type.slice(1);
}
