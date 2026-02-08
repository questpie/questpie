/**
 * Block System Exports
 *
 * Core types and components for the visual page building system.
 */

// Block Registry (type-safe renderer registration)
export {
  type AllBlockData,
  type AllBlockValues,
  type BlockComponentProps,
  type BlockPrefetchData,
  type BlockRegistry,
  type BlockRendererComponent,
  type BlockRendererDefinition,
  type BlockRendererProps as TypedBlockRendererProps,
  type BlockValues,
  createBlockRegistry,
  type ExtractBlockFieldValues,
  type ExtractBlockPrefetchData,
  type ExtractServerBlocks,
  type ServerBlockNames,
} from "./block-registry.js";
// Components
export {
  BlockRenderer,
  type BlockRendererProps as BlockRendererComponentProps,
} from "./block-renderer.js";
// Prefetch utilities (deprecated - server handles data fetching now)
export {
  type BlockPrefetchContext,
  BlockPrefetchError,
  type BlockPrefetchParams,
  type BlockPrefetchResult,
  prefetchBlockData,
  type TypedBlockPrefetch,
} from "./prefetch.js";
// Types
export type {
  BlockCategory,
  BlockContent,
  BlockNode,
  BlockRendererProps,
} from "./types.js";
export {
  EMPTY_BLOCK_CONTENT,
  isBlockContent,
} from "./types.js";
