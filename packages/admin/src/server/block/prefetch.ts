/**
 * Blocks Prefetch Utility
 *
 * Handles automatic prefetching of data for blocks that have prefetch functions.
 * This runs during the afterRead hook of collections with blocks fields.
 *
 * @example
 * ```ts
 * // Manual usage in collection hooks
 * .hooks({
 *   afterRead: async (ctx) => {
 *     await processBlocksPrefetch(ctx.data, ctx.app);
 *   }
 * })
 *
 * // Or use the helper to create the hook
 * .hooks({
 *   afterRead: createBlocksPrefetchHook()
 * })
 * ```
 */

import type { BlocksDocument } from "../fields/blocks.js";
import type {
	AnyBlockDefinition,
	BlockPrefetchContext,
} from "./block-builder.js";

/**
 * Context for blocks prefetch processing.
 */
export interface BlocksPrefetchContext {
	/** CMS app instance */
	app: unknown;
	/** Database client */
	db: unknown;
	/** Current locale */
	locale?: string;
}

/**
 * Process blocks prefetch for a single blocks document.
 * Recursively processes all blocks in the tree and executes their prefetch functions.
 *
 * @param blocks - The blocks document to process
 * @param blockDefinitions - Registered block definitions
 * @param ctx - Prefetch context
 * @returns The blocks document with `_data` populated
 */
export async function processBlocksDocument(
	blocks: BlocksDocument | null | undefined,
	blockDefinitions: Record<string, AnyBlockDefinition>,
	ctx: BlocksPrefetchContext,
): Promise<BlocksDocument | null | undefined> {
	if (!blocks || !blocks._tree || !blocks._values) {
		return blocks;
	}

	const prefetchedData: Record<string, Record<string, unknown>> = {};

	// Process all blocks in the tree (including nested children)
	await processBlockTree(
		blocks._tree,
		blocks._values,
		blockDefinitions,
		ctx,
		prefetchedData,
	);

	// Return blocks document with _data attached
	return {
		...blocks,
		_data: prefetchedData,
	};
}

/**
 * Recursively process block tree and execute prefetch functions.
 */
async function processBlockTree(
	tree: Array<{ id: string; type: string; children?: any[] }>,
	values: Record<string, Record<string, unknown>>,
	blockDefinitions: Record<string, AnyBlockDefinition>,
	ctx: BlocksPrefetchContext,
	prefetchedData: Record<string, Record<string, unknown>>,
): Promise<void> {
	// Collect all prefetch promises for parallel execution
	const prefetchPromises: Promise<void>[] = [];

	for (const node of tree) {
		const blockDef = blockDefinitions[node.type];
		const blockValues = values[node.id] || {};

		// If block has prefetch function, execute it
		if (blockDef?.state.prefetch) {
			const prefetchCtx: BlockPrefetchContext = {
				blockId: node.id,
				blockType: node.type,
				app: ctx.app,
				db: ctx.db,
				locale: ctx.locale,
			};

			prefetchPromises.push(
				(async () => {
					try {
						const data = await blockDef.executePrefetch(
							blockValues,
							prefetchCtx,
						);
						prefetchedData[node.id] = data;
					} catch (error) {
						// Log error but don't fail the entire request
						console.error(
							`Block prefetch failed for ${node.type}:${node.id}:`,
							error,
						);
						prefetchedData[node.id] = { _error: "Prefetch failed" };
					}
				})(),
			);
		}

		// Process children recursively
		if (node.children && node.children.length > 0) {
			prefetchPromises.push(
				processBlockTree(
					node.children,
					values,
					blockDefinitions,
					ctx,
					prefetchedData,
				),
			);
		}
	}

	// Wait for all prefetches in parallel
	await Promise.all(prefetchPromises);
}

/**
 * Process blocks prefetch for a document.
 * Finds all blocks fields in the document and processes them.
 *
 * @param doc - The document containing blocks fields
 * @param fieldDefinitions - Field definitions to identify blocks fields
 * @param blockDefinitions - Registered block definitions
 * @param ctx - Prefetch context
 * @returns The document with blocks prefetch data attached
 */
export async function processDocumentBlocksPrefetch<
	T extends Record<string, unknown>,
>(
	doc: T,
	fieldDefinitions: Record<string, { state: { config: { type?: string } } }>,
	blockDefinitions: Record<string, AnyBlockDefinition>,
	ctx: BlocksPrefetchContext,
): Promise<T> {
	if (!doc || !blockDefinitions || Object.keys(blockDefinitions).length === 0) {
		return doc;
	}

	const result: Record<string, unknown> = { ...doc };

	// Find all blocks fields and process them
	for (const [fieldName, fieldDef] of Object.entries(fieldDefinitions)) {
		const fieldType = fieldDef?.state?.config?.type;

		if (fieldType === "blocks" && result[fieldName]) {
			result[fieldName] = await processBlocksDocument(
				result[fieldName] as BlocksDocument,
				blockDefinitions,
				ctx,
			);
		}
	}

	return result as T;
}

/**
 * Create an afterRead hook for processing blocks prefetch.
 * This hook can be added to collections that have blocks fields.
 *
 * @example
 * ```ts
 * import { createBlocksPrefetchHook } from "@questpie/admin/server";
 *
 * const pages = q.collection("pages")
 *   .fields((f) => ({
 *     title: f.text({ required: true }),
 *     content: f.blocks({ allowedBlocks: ["hero", "text"] }),
 *   }))
 *   .hooks({
 *     afterRead: createBlocksPrefetchHook(),
 *   });
 * ```
 */
export function createBlocksPrefetchHook() {
	return async (ctx: {
		data: Record<string, unknown>;
		app: {
			state?: {
				blocks?: Record<string, AnyBlockDefinition>;
			};
		};
		db: unknown;
		locale?: string;
	}) => {
		const blocks = ctx.app?.state?.blocks;
		if (!blocks || Object.keys(blocks).length === 0) {
			return;
		}

		// Get collection's field definitions from the app
		// Note: This requires access to collection state which may need adjustment
		// For now, we process any field that looks like blocks data
		for (const [key, value] of Object.entries(ctx.data)) {
			if (isBlocksDocument(value)) {
				ctx.data[key] = await processBlocksDocument(value, blocks, {
					app: ctx.app,
					db: ctx.db,
					locale: ctx.locale,
				});
			}
		}
	};
}

/**
 * Check if a value is a blocks document.
 */
function isBlocksDocument(value: unknown): value is BlocksDocument {
	if (!value || typeof value !== "object") return false;
	const doc = value as Record<string, unknown>;
	return (
		Array.isArray(doc._tree) &&
		typeof doc._values === "object" &&
		doc._values !== null
	);
}
