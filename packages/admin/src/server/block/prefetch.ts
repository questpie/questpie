/**
 * Server CRUD Block Prefetch Utility
 *
 * Handles automatic data fetching for blocks during the afterRead hook.
 * The fetched data is attached to `_data[blockId]` in the response.
 *
 * Two mechanisms populate `_data`:
 *
 * 1. **Auto-expansion** (automatic): Relation and upload fields in blocks are
 *    automatically expanded to full records. No configuration needed — the system
 *    inspects block field definitions, collects IDs, batch-fetches by collection,
 *    and attaches expanded records keyed by field name.
 *
 * 2. **Manual prefetch** (escape hatch): For custom computed data that can't be
 *    auto-expanded, define a prefetch function in `.blocks()` registration:
 *    ```ts
 *    .blocks({
 *      featuredPosts: {
 *        block: featuredPostsBlock,
 *        prefetch: async ({ values, ctx }) => {
 *          const posts = await ctx.app.api.collections.posts.find({ limit: values.count });
 *          return { posts: posts.docs };
 *        },
 *      },
 *    })
 *    ```
 *
 * Auto-expanded data and manual prefetch data are merged into `_data[blockId]`.
 * Manual prefetch keys take precedence over auto-expanded keys on conflict.
 *
 * @example
 * ```ts
 * // Use the helper to create the afterRead hook
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
  /** CMS app instance (has `api.collections` for auto-expansion) */
  app: unknown;
  /** Database client */
  db: unknown;
  /** Current locale */
  locale?: string;
}

// ============================================================================
// Auto-expansion of relation/upload fields
// ============================================================================

/**
 * Tracks a relation field that needs expansion.
 * @internal
 */
interface ExpansionTarget {
  blockId: string;
  fieldName: string;
  /** Whether the original value was a single ID (not an array) */
  isSingle: boolean;
}

/**
 * Auto-expand relation and upload fields in block values.
 *
 * Inspects block field definitions for relation/upload fields,
 * collects referenced IDs, batch-fetches records by target collection,
 * and returns expanded data keyed by block ID and field name.
 *
 * Only expands "belongsTo" relations (single ID) and upload fields.
 * hasMany/manyToMany relations with junction tables are skipped.
 *
 * @internal
 */
async function autoExpandRelations(
  allNodes: Array<{ id: string; type: string }>,
  values: Record<string, Record<string, unknown>>,
  blockDefinitions: Record<string, AnyBlockDefinition>,
  ctx: BlocksPrefetchContext,
): Promise<Record<string, Record<string, unknown>>> {
  // Group expansion requirements by target collection for batch fetching
  const expansionsByCollection = new Map<
    string,
    { ids: Set<string>; targets: ExpansionTarget[] }
  >();

  for (const node of allNodes) {
    const blockDef = blockDefinitions[node.type];
    if (!blockDef?.state.fields) continue;

    const blockValues = values[node.id] || {};

    for (const [fieldName, fieldDef] of Object.entries(blockDef.state.fields)) {
      if (!fieldDef || typeof fieldDef !== "object") continue;

      // Get field metadata to check if it's a relation/upload
      const metadata =
        "getMetadata" in fieldDef &&
        typeof (fieldDef as any).getMetadata === "function"
          ? (fieldDef as any).getMetadata()
          : undefined;
      if (!metadata || metadata.type !== "relation") continue;

      const targetCollection = metadata.targetCollection;
      if (!targetCollection || typeof targetCollection !== "string") continue;

      // Only expand belongsTo (single ID) or upload fields
      // Skip hasMany/manyToMany with junction tables
      const relType = metadata.relationType;
      const isExpandable =
        relType === "belongsTo" || metadata.isUpload === true;
      if (!isExpandable) continue;

      // Extract ID(s) from block value
      const value = blockValues[fieldName];
      if (!value) continue;

      const rawIds = Array.isArray(value) ? value : [value];
      const stringIds = rawIds.filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      );
      if (stringIds.length === 0) continue;

      if (!expansionsByCollection.has(targetCollection)) {
        expansionsByCollection.set(targetCollection, {
          ids: new Set(),
          targets: [],
        });
      }
      const entry = expansionsByCollection.get(targetCollection)!;
      for (const id of stringIds) entry.ids.add(id);
      entry.targets.push({
        blockId: node.id,
        fieldName,
        isSingle: !Array.isArray(value),
      });
    }
  }

  if (expansionsByCollection.size === 0) return {};

  // Batch-fetch records from each target collection
  const fetchedByCollection = new Map<string, Map<string, unknown>>();

  const fetchPromises = [...expansionsByCollection.entries()].map(
    async ([collection, { ids }]) => {
      try {
        const appApi = (ctx.app as any)?.api?.collections?.[collection];
        if (!appApi?.find) {
          console.warn(
            `[auto-expand] Collection "${collection}" not found on app API, skipping`,
          );
          return;
        }
        const result = await appApi.find({
          where: { id: { in: [...ids] } },
          limit: ids.size,
        });
        const recordMap = new Map<string, unknown>();
        for (const doc of result?.docs || []) {
          if (doc && typeof doc === "object" && "id" in doc) {
            recordMap.set((doc as any).id, doc);
          }
        }
        fetchedByCollection.set(collection, recordMap);
      } catch (error) {
        console.error(
          `[auto-expand] Failed to fetch from "${collection}":`,
          error,
        );
      }
    },
  );
  await Promise.all(fetchPromises);

  // Distribute expanded records to block _data
  const expandedData: Record<string, Record<string, unknown>> = {};

  for (const [collection, { targets }] of expansionsByCollection) {
    const recordMap = fetchedByCollection.get(collection);
    if (!recordMap) continue;

    for (const { blockId, fieldName, isSingle } of targets) {
      if (!expandedData[blockId]) expandedData[blockId] = {};

      const blockVal = (values[blockId] || {})[fieldName];
      if (isSingle) {
        expandedData[blockId][fieldName] =
          recordMap.get(blockVal as string) ?? null;
      } else {
        const ids = blockVal as string[];
        expandedData[blockId][fieldName] = ids
          .map((id) => recordMap.get(id))
          .filter(Boolean);
      }
    }
  }

  return expandedData;
}

/**
 * Process blocks data for a single blocks document.
 *
 * This function does two things:
 * 1. **Auto-expands** relation/upload fields to full records (batch-fetched)
 * 2. **Executes manual prefetch** functions for blocks that have them
 *
 * The results are merged into `_data[blockId]`. Manual prefetch data
 * takes precedence over auto-expanded data on key conflicts.
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

  // Flatten the tree for both auto-expansion and manual prefetch
  const allNodes: Array<{ id: string; type: string; children: any[] }> = [];
  const collectNodes = (
    nodes: Array<{ id: string; type: string; children: any[] }>,
  ) => {
    for (const node of nodes) {
      allNodes.push(node);
      if (node.children.length > 0) {
        collectNodes(node.children);
      }
    }
  };
  collectNodes(blocks._tree);

  // Run auto-expansion and manual prefetch in parallel
  const [autoExpanded, manualPrefetched] = await Promise.all([
    autoExpandRelations(allNodes, blocks._values, blockDefinitions, ctx),
    executeManualPrefetch(allNodes, blocks._values, blockDefinitions, ctx),
  ]);

  // Merge: auto-expanded first, then manual prefetch overrides
  const mergedData: Record<string, Record<string, unknown>> = {};
  const allBlockIds = new Set([
    ...Object.keys(autoExpanded),
    ...Object.keys(manualPrefetched),
  ]);

  for (const blockId of allBlockIds) {
    mergedData[blockId] = {
      ...(autoExpanded[blockId] || {}),
      ...(manualPrefetched[blockId] || {}),
    };
  }

  // Return blocks document with _data attached
  return {
    ...blocks,
    _data: mergedData,
  };
}

/**
 * Execute manual prefetch functions for blocks that have them.
 * Runs all prefetches in parallel for optimal performance.
 * @internal
 */
async function executeManualPrefetch(
  allNodes: Array<{ id: string; type: string }>,
  values: Record<string, Record<string, unknown>>,
  blockDefinitions: Record<string, AnyBlockDefinition>,
  ctx: BlocksPrefetchContext,
): Promise<Record<string, Record<string, unknown>>> {
  const prefetchedData: Record<string, Record<string, unknown>> = {};
  const prefetchPromises: Promise<void>[] = [];

  for (const node of allNodes) {
    const blockDef = blockDefinitions[node.type];
    const blockValues = values[node.id] || {};

    // If block has a manual prefetch function, execute it
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
            console.error(
              `Block prefetch failed for ${node.type}:${node.id}:`,
              error,
            );
            prefetchedData[node.id] = { _error: "Prefetch failed" };
          }
        })(),
      );
    }
  }

  await Promise.all(prefetchPromises);
  return prefetchedData;
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
