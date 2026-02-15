/**
 * Block Editor Components
 *
 * Exports all block editor components and utilities.
 */

// Components
export { BlockCanvas } from "./block-canvas.js";
// Context and Provider
export {
	type BlockEditorActions,
	type BlockEditorContextValue,
	type BlockEditorState,
	useBlockDefinition,
	useBlockEditor,
	useBlockEditorActions,
	useBlockEditorState,
	useBlockSchema,
	useIsBlockExpanded,
	useIsBlockSelected,
	useSelectedBlockDefinition,
	useSelectedBlockSchema,
	useSelectedBlockValues,
} from "./block-editor-context.js";

// Layout
export {
	BlockEditorLayout,
	type BlockEditorLayoutProps,
} from "./block-editor-layout.js";
export {
	BlockEditorProvider,
	type BlockEditorProviderProps,
} from "./block-editor-provider.js";
export {
	BlockFieldsRenderer,
	type BlockFieldsRendererProps,
} from "./block-fields-renderer.js";
export {
	BlockInsertButton,
	type BlockInsertButtonProps,
} from "./block-insert-button.js";
export { BlockItem, type BlockItemProps } from "./block-item.js";
export { BlockLibrary, BlockLibraryContent } from "./block-library.js";
export {
	BlockLibrarySidebar,
	type BlockLibrarySidebarProps,
} from "./block-library-sidebar.js";
export { BlockTree, type BlockTreeProps } from "./block-tree.js";
export {
	BlockIcon,
	BlockTypeIcon,
	type BlockTypeIconProps,
} from "./block-type-icon.js";

// Utilities
export {
	countBlocks,
	duplicateBlockInTree,
	findBlockById,
	findBlockPosition,
	getAllBlockIds,
	getDefaultValues,
	type InsertPosition,
	insertBlockInTree,
	moveBlockInTree,
	removeBlockFromTree,
} from "./utils/tree-utils.js";
