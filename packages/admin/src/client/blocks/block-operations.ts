/**
 * Block operations
 *
 * Pure, allocation-only transformations on `BlockContent`. They wrap
 * the tree-level helpers in `block-tree-utils` and combine them with
 * the matching `_values` update so the result is always a coherent
 * `BlockContent` snapshot — `_tree` and `_values` stay in sync.
 *
 * Used by `BlockEditorProvider` (today) and by the Visual Edit
 * Workspace's Blocks panel (Phase 4) so add/duplicate/remove/reorder
 * follow exactly the same code path regardless of UI surface.
 */

import type { BlockSchema } from "#questpie/admin/server/block/index.js";

import type { BlockContent, BlockNode } from "../blocks/types.js";
import {
	type InsertPosition,
	duplicateBlockInTree,
	getDefaultValues,
	insertBlockInTree,
	removeBlockFromTree,
	reorderBlockInTree,
} from "../components/blocks/utils/tree-utils.js";

// ============================================================================
// Add
// ============================================================================

export type AddBlockResult = {
	content: BlockContent;
	/** Id of the inserted block */
	blockId: string;
};

/**
 * Insert a new block of `type` at `position`. Returns `null` when
 * the type isn't registered — caller decides whether to warn.
 */
export function addBlockToContent(
	content: BlockContent,
	blocks: Record<string, BlockSchema>,
	type: string,
	position: InsertPosition,
): AddBlockResult | null {
	const blockDef = blocks[type];
	if (!blockDef) return null;

	const newBlock: BlockNode = {
		id: crypto.randomUUID(),
		type,
		children: [],
	};

	const newValues = getDefaultValues(
		blockDef.fields as Record<
			string,
			{ "~options"?: { defaultValue?: unknown } }
		>,
	);

	const next: BlockContent = {
		_tree: insertBlockInTree(content._tree, newBlock, position),
		_values: { ...content._values, [newBlock.id]: newValues },
	};

	return { content: next, blockId: newBlock.id };
}

// ============================================================================
// Remove
// ============================================================================

export type RemoveBlockResult = {
	content: BlockContent;
	/** Ids of every block removed (the target plus its descendants) */
	removedIds: string[];
};

/**
 * Remove a block (and all of its descendants) from the tree and
 * drop their values from `_values`. No-op if the id isn't found.
 */
export function removeBlockFromContent(
	content: BlockContent,
	id: string,
): RemoveBlockResult {
	const { newTree, removedIds } = removeBlockFromTree(content._tree, id);

	const newValues = { ...content._values };
	for (const removed of removedIds) {
		delete newValues[removed];
	}

	return {
		content: {
			_tree: newTree,
			_values: newValues,
		},
		removedIds,
	};
}

// ============================================================================
// Duplicate
// ============================================================================

export type DuplicateBlockResult = {
	content: BlockContent;
	/** Ids of every block created by the duplicate (root + descendants) */
	newIds: string[];
};

/**
 * Duplicate a block (and all of its descendants) right after the
 * source block. Returns the new ids in document order — index 0 is
 * the new root that the caller usually wants to select.
 */
export function duplicateBlockInContent(
	content: BlockContent,
	id: string,
): DuplicateBlockResult {
	const { newTree, newIds, newValues } = duplicateBlockInTree(
		content._tree,
		content._values,
		id,
	);

	return {
		content: {
			_tree: newTree,
			_values: { ...content._values, ...newValues },
		},
		newIds,
	};
}

// ============================================================================
// Reorder (same-parent only)
// ============================================================================

/**
 * Move a child within the same parent's `children` array. The id
 * arg is unused but kept for symmetry with the legacy API and to
 * give callers a stable signature for future cross-parent moves.
 */
export function moveBlockInContent(
	content: BlockContent,
	parentId: string | null,
	fromIndex: number,
	toIndex: number,
): BlockContent {
	return {
		...content,
		_tree: reorderBlockInTree(content._tree, parentId, fromIndex, toIndex),
	};
}

// ============================================================================
// Values update
// ============================================================================

/**
 * Shallow-merge a partial values record into `_values[id]`. The
 * `_tree` is preserved by reference. Use this for inspector edits
 * that affect a single block — multi-field updates from the form
 * controller still go through react-hook-form.
 */
export function updateBlockValuesInContent(
	content: BlockContent,
	id: string,
	partialValues: Record<string, unknown>,
): BlockContent {
	const previous = content._values[id] ?? {};
	return {
		...content,
		_values: {
			...content._values,
			[id]: { ...previous, ...partialValues },
		},
	};
}
