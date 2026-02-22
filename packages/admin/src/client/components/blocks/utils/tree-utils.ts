/**
 * Block Tree Utilities
 *
 * Functions for manipulating the block tree structure.
 * All functions are pure and return new objects.
 */

import { arrayMove } from "@dnd-kit/sortable";
import type { BlockNode } from "../../../blocks/types.js";

/**
 * Position where a block should be inserted.
 */
export type InsertPosition = {
	/** Parent block ID (null = root level) */
	parentId: string | null;
	/** Index within parent's children or root */
	index: number;
};

/**
 * Find a block by ID in the tree.
 */
export function findBlockById(tree: BlockNode[], id: string): BlockNode | null {
	for (const node of tree) {
		if (node.id === id) return node;
		const found = findBlockById(node.children, id);
		if (found) return found;
	}
	return null;
}

/**
 * Find a block's position (parent and index) in the tree.
 */
export function findBlockPosition(
	tree: BlockNode[],
	id: string,
	parentId: string | null = null,
): InsertPosition | null {
	for (let i = 0; i < tree.length; i++) {
		const node = tree[i];
		if (node.id === id) {
			return { parentId, index: i };
		}
		const found = findBlockPosition(node.children, id, node.id);
		if (found) return found;
	}
	return null;
}

/**
 * Insert a block at the specified position.
 */
export function insertBlockInTree(
	tree: BlockNode[],
	block: BlockNode,
	position: InsertPosition,
): BlockNode[] {
	if (position.parentId === null) {
		// Insert at root level
		const newTree = [...tree];
		newTree.splice(position.index, 0, block);
		return newTree;
	}

	// Insert as child of parent
	return tree.map((node) => {
		if (node.id === position.parentId) {
			const newChildren = [...node.children];
			newChildren.splice(position.index, 0, block);
			return { ...node, children: newChildren };
		}
		return {
			...node,
			children: insertBlockInTree(node.children, block, position),
		};
	});
}

/**
 * Remove a block and all its children from the tree.
 * Returns the new tree and list of removed block IDs.
 */
export function removeBlockFromTree(
	tree: BlockNode[],
	id: string,
): { newTree: BlockNode[]; removedIds: string[] } {
	const removedIds: string[] = [];

	function collectIds(node: BlockNode) {
		removedIds.push(node.id);
		node.children.forEach(collectIds);
	}

	function remove(nodes: BlockNode[]): BlockNode[] {
		return nodes
			.filter((node) => {
				if (node.id === id) {
					collectIds(node);
					return false;
				}
				return true;
			})
			.map((node) => ({
				...node,
				children: remove(node.children),
			}));
	}

	return { newTree: remove(tree), removedIds };
}

/**
 * Move a block to a new position in the tree (remove + insert).
 * Used for cross-parent moves (e.g., from context menu).
 */
function moveBlockInTree(
	tree: BlockNode[],
	blockId: string,
	toPosition: InsertPosition,
): BlockNode[] {
	// Find and remove block
	const block = findBlockById(tree, blockId);
	if (!block) return tree;

	const { newTree } = removeBlockFromTree(tree, blockId);

	// Insert at new position
	return insertBlockInTree(newTree, block, toPosition);
}

/**
 * Reorder a block within the same parent using arrayMove.
 * Used for DnD reordering — avoids remove+insert index shifting issues.
 */
export function reorderBlockInTree(
	tree: BlockNode[],
	parentId: string | null,
	fromIndex: number,
	toIndex: number,
): BlockNode[] {
	if (parentId === null) {
		return arrayMove(tree, fromIndex, toIndex);
	}

	return tree.map((node) => {
		if (node.id === parentId) {
			return {
				...node,
				children: arrayMove(node.children, fromIndex, toIndex),
			};
		}
		return {
			...node,
			children: reorderBlockInTree(node.children, parentId, fromIndex, toIndex),
		};
	});
}

/**
 * Duplicate a block and all its children.
 * Returns the new tree, list of new IDs, and new values.
 */
export function duplicateBlockInTree(
	tree: BlockNode[],
	values: Record<string, Record<string, unknown>>,
	blockId: string,
): {
	newTree: BlockNode[];
	newIds: string[];
	newValues: Record<string, Record<string, unknown>>;
} {
	const block = findBlockById(tree, blockId);
	if (!block) {
		return { newTree: tree, newIds: [], newValues: {} };
	}

	const newIds: string[] = [];
	const newValues: Record<string, Record<string, unknown>> = {};

	function cloneNode(node: BlockNode): BlockNode {
		const newId = crypto.randomUUID();
		newIds.push(newId);
		newValues[newId] = { ...values[node.id] };

		return {
			id: newId,
			type: node.type,
			children: node.children.map(cloneNode),
		};
	}

	const clonedBlock = cloneNode(block);

	// Find parent and index
	const position = findBlockPosition(tree, blockId);
	if (!position) {
		return { newTree: tree, newIds: [], newValues: {} };
	}

	// Insert after original
	const newTree = insertBlockInTree(tree, clonedBlock, {
		parentId: position.parentId,
		index: position.index + 1,
	});

	return { newTree, newIds, newValues };
}

/**
 * Get all block IDs in the tree (flattened).
 */
export function getAllBlockIds(tree: BlockNode[]): string[] {
	const ids: string[] = [];

	function collect(nodes: BlockNode[]) {
		for (const node of nodes) {
			ids.push(node.id);
			collect(node.children);
		}
	}

	collect(tree);
	return ids;
}

/**
 * Count total blocks in the tree.
 */
export function countBlocks(tree: BlockNode[]): number {
	let count = 0;

	function traverse(nodes: BlockNode[]) {
		for (const node of nodes) {
			count++;
			traverse(node.children);
		}
	}

	traverse(tree);
	return count;
}

/**
 * Get default values for block fields.
 */
export function getDefaultValues(
	fields:
		| Record<string, { "~options"?: { defaultValue?: unknown } }>
		| undefined,
): Record<string, unknown> {
	if (!fields) return {};

	const values: Record<string, unknown> = {};

	for (const [key, field] of Object.entries(fields)) {
		const defaultValue = field["~options"]?.defaultValue;
		if (defaultValue !== undefined) {
			values[key] = defaultValue;
		}
	}

	return values;
}
