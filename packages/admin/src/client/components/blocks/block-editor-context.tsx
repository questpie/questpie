/**
 * Block Editor Context
 *
 * Context and hooks for the block editor state management.
 */

"use client";

import * as React from "react";
import type { BlockContent } from "../../blocks/types.js";
import type { BlockDefinition } from "../../builder/block/types.js";
import type { InsertPosition } from "./utils/tree-utils.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Block editor state.
 */
export type BlockEditorState = {
  /** Block content (tree + values) */
  content: BlockContent;
  /** Currently selected block ID */
  selectedBlockId: string | null;
  /** Expanded block IDs (for nested blocks) */
  expandedBlockIds: Set<string>;
  /** Is block library open */
  isLibraryOpen: boolean;
  /** Insert position when adding new block */
  insertPosition: InsertPosition | null;
  /** Registered block definitions */
  blocks: Record<string, BlockDefinition>;
  /** Allowed block types for this field */
  allowedBlocks: string[] | null;
  /** Current locale for editing */
  locale: string;
};

/**
 * Block editor actions.
 */
export type BlockEditorActions = {
  // Selection
  selectBlock: (id: string | null) => void;
  toggleExpanded: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;

  // CRUD
  addBlock: (type: string, position: InsertPosition) => void;
  removeBlock: (id: string) => void;
  duplicateBlock: (id: string) => void;

  // Reorder
  moveBlock: (id: string, toPosition: InsertPosition) => void;

  // Values
  updateBlockValues: (id: string, values: Record<string, unknown>) => void;

  // Library
  openLibrary: (position: InsertPosition) => void;
  closeLibrary: () => void;
};

/**
 * Block editor context value.
 */
export type BlockEditorContextValue = {
  state: BlockEditorState;
  actions: BlockEditorActions;
};

// ============================================================================
// Context
// ============================================================================

const BlockEditorContext = React.createContext<BlockEditorContextValue | null>(
  null,
);

/**
 * Hook to access block editor state and actions.
 * Must be used within BlockEditorProvider.
 */
export function useBlockEditor(): BlockEditorContextValue {
  const ctx = React.useContext(BlockEditorContext);
  if (!ctx) {
    throw new Error("useBlockEditor must be used within BlockEditorProvider");
  }
  return ctx;
}

/**
 * Hook to access only block editor state.
 */
export function useBlockEditorState(): BlockEditorState {
  return useBlockEditor().state;
}

/**
 * Hook to access only block editor actions.
 */
export function useBlockEditorActions(): BlockEditorActions {
  return useBlockEditor().actions;
}

/**
 * Hook to check if a block is selected.
 */
export function useIsBlockSelected(blockId: string): boolean {
  const { state } = useBlockEditor();
  return state.selectedBlockId === blockId;
}

/**
 * Hook to check if a block is expanded.
 */
export function useIsBlockExpanded(blockId: string): boolean {
  const { state } = useBlockEditor();
  return state.expandedBlockIds.has(blockId);
}

/**
 * Hook to get a block definition by type.
 */
export function useBlockDefinition(
  blockType: string,
): BlockDefinition | undefined {
  const { state } = useBlockEditor();
  return state.blocks[blockType];
}

/**
 * Hook to get the selected block's definition.
 */
export function useSelectedBlockDefinition(): BlockDefinition | undefined {
  const { state } = useBlockEditor();
  if (!state.selectedBlockId) return undefined;

  const blockNode = findBlockNodeById(
    state.content._tree,
    state.selectedBlockId,
  );
  if (!blockNode) return undefined;

  return state.blocks[blockNode.type];
}

/**
 * Hook to get the selected block's values.
 */
export function useSelectedBlockValues(): Record<string, unknown> | undefined {
  const { state } = useBlockEditor();
  if (!state.selectedBlockId) return undefined;
  return state.content._values[state.selectedBlockId];
}

// ============================================================================
// Provider Component
// ============================================================================

export const BlockEditorContextProvider = BlockEditorContext.Provider;

// ============================================================================
// Helpers
// ============================================================================

import type { BlockNode } from "../../blocks/types.js";

function findBlockNodeById(
  tree: BlockNode[],
  id: string,
): BlockNode | undefined {
  for (const node of tree) {
    if (node.id === id) return node;
    const found = findBlockNodeById(node.children, id);
    if (found) return found;
  }
  return undefined;
}
