/**
 * Block System Exports
 *
 * Core types and components for the visual page building system.
 */

// Components
export {
	BlockRenderer,
	type BlockRendererProps as BlockRendererComponentProps,
} from "./block-renderer.js";
// Types
export type {
	BlockCategory,
	BlockContent,
	BlockNode,
	BlockRendererProps,
} from "./types.js";
export { EMPTY_BLOCK_CONTENT, isBlockContent } from "./types.js";
