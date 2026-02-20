/**
 * Block Editor Provider
 *
 * Provides selector-driven state and actions for the block editor.
 */

"use client";

import * as React from "react";
import type { StoreApi } from "zustand";
import { createStore } from "zustand";
import type { BlockSchema } from "#questpie/admin/server";
import type { BlockContent, BlockNode } from "../../blocks/types.js";
import {
	type BlockEditorActions,
	BlockEditorContextProvider,
	type BlockEditorStore,
} from "./block-editor-context.js";
import {
	duplicateBlockInTree,
	getAllBlockIds,
	getDefaultValues,
	insertBlockInTree,
	removeBlockFromTree,
	reorderBlockInTree,
} from "./utils/tree-utils.js";

// ============================================================================
// Props
// ============================================================================

type BlockEditorProviderProps = {
	/** Initial/controlled content */
	value: BlockContent;
	/** Change handler */
	onChange: (content: BlockContent) => void;
	/** Registered blocks (from server introspection) */
	blocks: Record<string, BlockSchema>;
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
	const onChangeRef = React.useRef(onChange);
	React.useEffect(() => {
		onChangeRef.current = onChange;
	}, [onChange]);

	const [store] = React.useState<StoreApi<BlockEditorStore>>(() =>
		createStore<BlockEditorStore>((set, get) => {
			const actions: BlockEditorActions = {
				// Selection
				selectBlock: (id) => {
					set((prev) => ({
						selectedBlockId: id,
						isLibraryOpen: id !== null ? false : prev.isLibraryOpen,
						insertPosition: id !== null ? null : prev.insertPosition,
					}));
				},

				toggleExpanded: (id) => {
					set((prev) => {
						const next = new Set(prev.expandedBlockIds);
						if (next.has(id)) {
							next.delete(id);
						} else {
							next.add(id);
						}
						return { expandedBlockIds: next };
					});
				},

				expandAll: () => {
					const allIds = getAllBlockIds(get().content._tree);
					set({ expandedBlockIds: new Set(allIds) });
				},

				collapseAll: () => {
					set({ expandedBlockIds: new Set() });
				},

				// CRUD
				addBlock: (type, position) => {
					const state = get();
					const blockDef = state.blocks[type];
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

					const newValues = getDefaultValues(
						blockDef.fields as Record<
							string,
							{ "~options"?: { defaultValue?: unknown } }
						>,
					);

					const nextContent: BlockContent = {
						_tree: insertBlockInTree(state.content._tree, newBlock, position),
						_values: { ...state.content._values, [newBlock.id]: newValues },
					};

					onChangeRef.current(nextContent);

					set((prev) => ({
						content: nextContent,
						selectedBlockId: newBlock.id,
						isLibraryOpen: false,
						insertPosition: null,
						expandedBlockIds: position.parentId
							? new Set([...prev.expandedBlockIds, position.parentId])
							: prev.expandedBlockIds,
					}));
				},

				removeBlock: (id) => {
					const state = get();
					const { newTree, removedIds } = removeBlockFromTree(
						state.content._tree,
						id,
					);

					const newValues = { ...state.content._values };
					for (const removedId of removedIds) {
						delete newValues[removedId];
					}

					const nextContent: BlockContent = {
						_tree: newTree,
						_values: newValues,
					};

					onChangeRef.current(nextContent);

					set((prev) => {
						const nextExpanded = new Set(prev.expandedBlockIds);
						for (const removedId of removedIds) {
							nextExpanded.delete(removedId);
						}

						const selectedBlockRemoved =
							prev.selectedBlockId === id ||
							(prev.selectedBlockId
								? removedIds.includes(prev.selectedBlockId)
								: false);

						return {
							content: nextContent,
							expandedBlockIds: nextExpanded,
							selectedBlockId: selectedBlockRemoved
								? null
								: prev.selectedBlockId,
						};
					});
				},

				duplicateBlock: (id) => {
					const state = get();
					const { newTree, newIds, newValues } = duplicateBlockInTree(
						state.content._tree,
						state.content._values,
						id,
					);

					const nextContent: BlockContent = {
						_tree: newTree,
						_values: { ...state.content._values, ...newValues },
					};

					onChangeRef.current(nextContent);

					set({
						content: nextContent,
						selectedBlockId:
							newIds.length > 0 ? newIds[0] : state.selectedBlockId,
					});
				},

				// Reorder (same-parent only)
				moveBlock: (_id, parentId, fromIndex, toIndex) => {
					const state = get();
					const nextContent: BlockContent = {
						...state.content,
						_tree: reorderBlockInTree(
							state.content._tree,
							parentId,
							fromIndex,
							toIndex,
						),
					};

					onChangeRef.current(nextContent);
					set({ content: nextContent });
				},

				// Values
				updateBlockValues: (id, newValues) => {
					const state = get();
					const nextContent: BlockContent = {
						...state.content,
						_values: {
							...state.content._values,
							[id]: { ...state.content._values[id], ...newValues },
						},
					};

					onChangeRef.current(nextContent);
					set({ content: nextContent });
				},

				// Library
				openLibrary: (position) => {
					set({
						insertPosition: position,
						isLibraryOpen: true,
						selectedBlockId: null,
					});
				},

				closeLibrary: () => {
					set({
						isLibraryOpen: false,
						insertPosition: null,
					});
				},
			};

			let initialAllowedBlocks: string[] | null;
			if (allowedBlocks != null) {
				initialAllowedBlocks = allowedBlocks;
			} else {
				initialAllowedBlocks = null;
			}

			return {
				content: value,
				selectedBlockId: null,
				expandedBlockIds: new Set<string>(),
				isLibraryOpen: false,
				insertPosition: null,
				blocks,
				allowedBlocks: initialAllowedBlocks,
				locale,
				actions,
			};
		}),
	);

	React.useEffect(() => {
		const state = store.getState();
		let nextAllowedBlocks: string[] | null;
		if (allowedBlocks != null) {
			nextAllowedBlocks = allowedBlocks;
		} else {
			nextAllowedBlocks = null;
		}

		const patch: Partial<BlockEditorStore> = {};

		if (state.content !== value) {
			patch.content = value;
		}

		if (state.blocks !== blocks) {
			patch.blocks = blocks;
		}

		if (state.allowedBlocks !== nextAllowedBlocks) {
			patch.allowedBlocks = nextAllowedBlocks;
		}

		if (state.locale !== locale) {
			patch.locale = locale;
		}

		if (Object.keys(patch).length > 0) {
			store.setState(patch);
		}
	}, [value, blocks, allowedBlocks, locale, store]);

	return (
		<BlockEditorContextProvider value={store}>
			{children}
		</BlockEditorContextProvider>
	);
}
