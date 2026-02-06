/**
 * Block Editor Provider
 *
 * Provides state and actions for the block editor.
 */

"use client";

import * as React from "react";
import type { BlockContent, BlockNode } from "../../blocks/types.js";
import type { BlockDefinition } from "../../builder/block/types.js";
import {
  type BlockEditorActions,
  BlockEditorContextProvider,
  type BlockEditorState,
} from "./block-editor-context.js";
import {
  duplicateBlockInTree,
  findBlockById,
  getAllBlockIds,
  getDefaultValues,
  type InsertPosition,
  insertBlockInTree,
  moveBlockInTree,
  removeBlockFromTree,
} from "./utils/tree-utils.js";

// ============================================================================
// Props
// ============================================================================

export type BlockEditorProviderProps = {
  /** Initial/controlled content */
  value: BlockContent;
  /** Change handler */
  onChange: (content: BlockContent) => void;
  /** Registered blocks */
  blocks: Record<string, BlockDefinition>;
  /** Allowed block types (optional filter) */
  allowedBlocks?: string[];
  /** Current locale */
  locale?: string;
  /** Children */
  children: React.ReactNode;
};

// ============================================================================
// Provider Component
// ============================================================================

export function BlockEditorProvider({
  value,
  onChange,
  blocks,
  allowedBlocks,
  locale = "en",
  children,
}: BlockEditorProviderProps) {
  // Selection state
  const [selectedBlockId, setSelectedBlockId] = React.useState<string | null>(
    null,
  );

  // Expanded blocks state
  const [expandedBlockIds, setExpandedBlockIds] = React.useState<Set<string>>(
    () => new Set(),
  );

  // Library state
  const [isLibraryOpen, setIsLibraryOpen] = React.useState(false);
  const [insertPosition, setInsertPosition] =
    React.useState<InsertPosition | null>(null);

  // Actions
  const actions: BlockEditorActions = React.useMemo(
    () => ({
      // Selection
      selectBlock: (id) => {
        setSelectedBlockId(id);
        // Close library when selecting a block
        if (id !== null) {
          setIsLibraryOpen(false);
          setInsertPosition(null);
        }
      },

      toggleExpanded: (id) => {
        setExpandedBlockIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          return next;
        });
      },

      expandAll: () => {
        const allIds = getAllBlockIds(value._tree);
        setExpandedBlockIds(new Set(allIds));
      },

      collapseAll: () => {
        setExpandedBlockIds(new Set());
      },

      // CRUD
      addBlock: (type, position) => {
        const blockDef = blocks[type];
        if (!blockDef) {
          if (process.env.NODE_ENV !== "production") {
            console.warn(`Block type "${type}" not found`);
          }
          return;
        }

        const newBlock: BlockNode = {
          id: crypto.randomUUID(),
          type,
          children: [],
        };

        const newValues = getDefaultValues(blockDef.fields);

        onChange({
          _tree: insertBlockInTree(value._tree, newBlock, position),
          _values: { ...value._values, [newBlock.id]: newValues },
        });

        // Select the new block and close library
        setSelectedBlockId(newBlock.id);
        setIsLibraryOpen(false);
        setInsertPosition(null);

        // Expand parent if inserting as child
        if (position.parentId) {
          setExpandedBlockIds((prev) => new Set([...prev, position.parentId!]));
        }
      },

      removeBlock: (id) => {
        const { newTree, removedIds } = removeBlockFromTree(value._tree, id);
        const newValues = { ...value._values };
        for (const removedId of removedIds) {
          delete newValues[removedId];
        }

        onChange({ _tree: newTree, _values: newValues });

        // Clear selection if removed block was selected
        if (selectedBlockId === id || removedIds.includes(selectedBlockId!)) {
          setSelectedBlockId(null);
        }

        // Clear from expanded
        setExpandedBlockIds((prev) => {
          const next = new Set(prev);
          for (const removedId of removedIds) {
            next.delete(removedId);
          }
          return next;
        });
      },

      duplicateBlock: (id) => {
        const { newTree, newIds, newValues } = duplicateBlockInTree(
          value._tree,
          value._values,
          id,
        );

        onChange({
          _tree: newTree,
          _values: { ...value._values, ...newValues },
        });

        // Select the first duplicated block
        if (newIds.length > 0) {
          setSelectedBlockId(newIds[0]);
        }
      },

      // Reorder
      moveBlock: (id, toPosition) => {
        // Don't allow moving into itself or its children
        const block = findBlockById(value._tree, id);
        if (!block) return;

        // Check if target parent is a child of the block being moved
        if (toPosition.parentId) {
          const isChildOfSelf = findBlockById(
            block.children,
            toPosition.parentId,
          );
          if (isChildOfSelf || toPosition.parentId === id) {
            if (process.env.NODE_ENV !== "production") {
              console.warn("Cannot move block into itself or its children");
            }
            return;
          }
        }

        onChange({
          ...value,
          _tree: moveBlockInTree(value._tree, id, toPosition),
        });
      },

      // Values
      updateBlockValues: (id, newValues) => {
        onChange({
          ...value,
          _values: {
            ...value._values,
            [id]: { ...value._values[id], ...newValues },
          },
        });
      },

      // Library
      openLibrary: (position) => {
        setInsertPosition(position);
        setIsLibraryOpen(true);
        setSelectedBlockId(null);
      },

      closeLibrary: () => {
        setIsLibraryOpen(false);
        setInsertPosition(null);
      },
    }),
    [value, onChange, blocks, selectedBlockId],
  );

  // State object
  const state: BlockEditorState = React.useMemo(
    () => ({
      content: value,
      selectedBlockId,
      expandedBlockIds,
      isLibraryOpen,
      insertPosition,
      blocks,
      allowedBlocks: allowedBlocks || null,
      locale,
    }),
    [
      value,
      selectedBlockId,
      expandedBlockIds,
      isLibraryOpen,
      insertPosition,
      blocks,
      allowedBlocks,
      locale,
    ],
  );

  // Context value
  const contextValue = React.useMemo(
    () => ({ state, actions }),
    [state, actions],
  );

  return (
    <BlockEditorContextProvider value={contextValue}>
      {children}
    </BlockEditorContextProvider>
  );
}
