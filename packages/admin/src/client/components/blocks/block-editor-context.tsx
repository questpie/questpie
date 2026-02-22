/**
 * Block Editor Context
 *
 * Context and selector hooks for block editor state management.
 */

"use client";

import * as React from "react";
import type { StoreApi } from "zustand";
import { useStore } from "zustand";
import type { BlockSchema } from "#questpie/admin/server";
import type { BlockContent, BlockNode } from "../../blocks/types.js";
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
	/** Registered block definitions (from server introspection) */
	blocks: Record<string, BlockSchema>;
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
	moveBlock: (
		id: string,
		parentId: string | null,
		fromIndex: number,
		toIndex: number,
	) => void;

	// Values
	updateBlockValues: (id: string, values: Record<string, unknown>) => void;

	// Library
	openLibrary: (position: InsertPosition) => void;
	closeLibrary: () => void;
};

/**
 * Block editor context value.
 */
type BlockEditorContextValue = {
	state: BlockEditorState;
	actions: BlockEditorActions;
};

export type BlockEditorStore = BlockEditorState & {
	actions: BlockEditorActions;
};

// ============================================================================
// Context
// ============================================================================

const BlockEditorContext =
	React.createContext<StoreApi<BlockEditorStore> | null>(null);

export const BlockEditorContextProvider = BlockEditorContext.Provider;

/**
 * Selector hook for block editor store.
 */
function useBlockEditorStore<T>(selector: (state: BlockEditorStore) => T): T {
	const store = React.useContext(BlockEditorContext);
	if (!store) {
		throw new Error("useBlockEditor must be used within BlockEditorProvider");
	}

	return useStore(store, selector);
}

/**
 * Hook to access block editor state and actions.
 * Must be used within BlockEditorProvider.
 */
function useBlockEditor(): BlockEditorContextValue {
	const state = useBlockEditorState();
	const actions = useBlockEditorActions();

	return { state, actions };
}

/**
 * Hook to access only block editor state.
 */
function useBlockEditorState(): BlockEditorState {
	return useBlockEditorStore((state) => ({
		content: state.content,
		selectedBlockId: state.selectedBlockId,
		expandedBlockIds: state.expandedBlockIds,
		isLibraryOpen: state.isLibraryOpen,
		insertPosition: state.insertPosition,
		blocks: state.blocks,
		allowedBlocks: state.allowedBlocks,
		locale: state.locale,
	}));
}

/**
 * Hook to access only block editor actions.
 */
export function useBlockEditorActions(): BlockEditorActions {
	return useBlockEditorStore((state) => state.actions);
}

/**
 * Hook to access current block tree.
 */
export function useBlockTree(): BlockNode[] {
	return useBlockEditorStore((state) => state.content._tree);
}

/**
 * Hook to access values for a specific block.
 */
export function useBlockValues(
	blockId: string,
): Record<string, unknown> | undefined {
	return useBlockEditorStore((state) => state.content._values[blockId]);
}

/**
 * Hook to access registered block definitions.
 */
export function useBlockRegistry(): Record<string, BlockSchema> {
	return useBlockEditorStore((state) => state.blocks);
}

/**
 * Hook to access allowed block type filter.
 */
export function useAllowedBlockTypes(): string[] | null {
	return useBlockEditorStore((state) => state.allowedBlocks);
}

/**
 * Hook to access current insert position.
 */
export function useBlockInsertPosition(): InsertPosition | null {
	return useBlockEditorStore((state) => state.insertPosition);
}

/**
 * Hook to check if block library is open.
 */
export function useBlockLibraryOpen(): boolean {
	return useBlockEditorStore((state) => state.isLibraryOpen);
}

/**
 * Hook to check if a block is selected.
 */
function useIsBlockSelected(blockId: string): boolean {
	return useBlockEditorStore((state) => state.selectedBlockId === blockId);
}

/**
 * Hook to check if a block is expanded.
 */
export function useIsBlockExpanded(blockId: string): boolean {
	return useBlockEditorStore((state) => state.expandedBlockIds.has(blockId));
}

/**
 * Hook to get a block schema by type.
 */
export function useBlockSchema(blockType: string): BlockSchema | undefined {
	return useBlockEditorStore((state) => state.blocks[blockType]);
}

/**
 * Hook to get a block schema by type.
 * @deprecated Use useBlockSchema instead
 */
export function useBlockDefinition(blockType: string): BlockSchema | undefined {
	return useBlockSchema(blockType);
}

/**
 * Hook to get the selected block's schema.
 */
function useSelectedBlockSchema(): BlockSchema | undefined {
	return useBlockEditorStore((state) => {
		if (!state.selectedBlockId) return undefined;

		const blockNode = findBlockNodeById(
			state.content._tree,
			state.selectedBlockId,
		);
		if (!blockNode) return undefined;

		return state.blocks[blockNode.type];
	});
}

/**
 * Hook to get the selected block's definition.
 * @deprecated Use useSelectedBlockSchema instead
 */
function useSelectedBlockDefinition(): BlockSchema | undefined {
	return useSelectedBlockSchema();
}

/**
 * Hook to get the selected block's values.
 */
function useSelectedBlockValues(): Record<string, unknown> | undefined {
	return useBlockEditorStore((state) => {
		if (!state.selectedBlockId) return undefined;
		return state.content._values[state.selectedBlockId];
	});
}

// ============================================================================
// Helpers
// ============================================================================

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
