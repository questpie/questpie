/**
 * Block Editor Provider
 *
 * Provides selector-driven state and actions for the block editor.
 */

"use client";

import * as React from "react";
import type { StoreApi } from "zustand";
import { createStore } from "zustand";

import type { BlockSchema } from "#questpie/admin/server/block/index.js";

import {
	addBlockToContent,
	duplicateBlockInContent,
	moveBlockInContent,
	removeBlockFromContent,
	updateBlockValuesInContent,
} from "../../blocks/block-operations.js";
import type { BlockContent } from "../../blocks/types.js";
import { defaultBlocksPath } from "../../preview/block-paths.js";
import {
	type BlockEditorActions,
	BlockEditorContextProvider,
	type BlockEditorStore,
} from "./block-editor-context.js";
import { getAllBlockIds } from "./utils/tree-utils.js";

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
	/**
	 * Form path of the surrounding blocks field (e.g. `"content"` or `"page.body"`).
	 * Defaults to `"content"`. Block fields rendered inside this provider scope
	 * to `${blocksPath}._values.${blockId}.${fieldName}`.
	 */
	blocksPath?: string;
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
	blocksPath = defaultBlocksPath(),
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

				// CRUD — all delegate to the pure helpers in
				// `blocks/block-operations.ts` so the Visual Edit Workspace
				// can perform the same edits without spinning up this store.
				addBlock: (type, position) => {
					const state = get();
					const result = addBlockToContent(
						state.content,
						state.blocks,
						type,
						position,
					);
					if (!result) {
						if (process.env.NODE_ENV !== "production") {
							console.warn(`Block type "${type}" not found`);
						}
						return;
					}

					onChangeRef.current(result.content);

					set((prev) => ({
						content: result.content,
						selectedBlockId: result.blockId,
						isLibraryOpen: false,
						insertPosition: null,
						expandedBlockIds: position.parentId
							? new Set([...prev.expandedBlockIds, position.parentId])
							: prev.expandedBlockIds,
					}));
				},

				removeBlock: (id) => {
					const state = get();
					const { content: nextContent, removedIds } =
						removeBlockFromContent(state.content, id);

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
					const { content: nextContent, newIds } = duplicateBlockInContent(
						state.content,
						id,
					);

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
					const nextContent = moveBlockInContent(
						state.content,
						parentId,
						fromIndex,
						toIndex,
					);

					onChangeRef.current(nextContent);
					set({ content: nextContent });
				},

				// Values
				updateBlockValues: (id, newValues) => {
					const state = get();
					const nextContent = updateBlockValuesInContent(
						state.content,
						id,
						newValues,
					);

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
				blocksPath,
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

		if (state.blocksPath !== blocksPath) {
			patch.blocksPath = blocksPath;
		}

		if (Object.keys(patch).length > 0) {
			store.setState(patch);
		}
	}, [value, blocks, allowedBlocks, locale, blocksPath, store]);

	return (
		<BlockEditorContextProvider value={store}>
			{children}
		</BlockEditorContextProvider>
	);
}
