/**
 * Block Builder Module
 *
 * Provides the block builder for defining visual block editor blocks.
 *
 * @example
 * ```ts
 * import { block } from "@questpie/admin/server";
 *
 * const heroBlock = block("hero")
 *   .label({ en: "Hero Section" })
 *   .fields((f) => ({
 *     title: f.text({ required: true }),
 *   }));
 * ```
 */

export {
	type AnyBlockBuilder,
	type AnyBlockDefinition,
	BlockBuilder,
	type BlockBuilderState,
	type BlockDefinition,
	type BlockPrefetchContext,
	type BlockPrefetchFn,
	block,
	type InferBlockValues,
} from "./block-builder.js";
// Introspection
export {
	type BlockSchema,
	getBlocksByCategory,
	introspectBlock,
	introspectBlocks,
} from "./introspection.js";
// Prefetch utilities
export {
	type BlocksPrefetchContext,
	createBlocksPrefetchHook,
	processBlocksDocument,
	processDocumentBlocksPrefetch,
} from "./prefetch.js";
