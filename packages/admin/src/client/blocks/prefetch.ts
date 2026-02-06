/**
 * Client Block Prefetch Utilities
 *
 * @deprecated Client-side block prefetch is no longer needed.
 * Block data is now automatically handled by the server:
 *
 * 1. **Auto-expansion**: Relation/upload fields are automatically expanded
 *    to full records in the afterRead hook. No configuration needed.
 *
 * 2. **Manual prefetch**: For custom data, define prefetch in `.blocks()`:
 *    ```ts
 *    .blocks({
 *      featuredPosts: {
 *        block: featuredPostsBlock,
 *        prefetch: async ({ values, ctx }) => ({ ... }),
 *      },
 *    })
 *    ```
 *
 * Both populate `_data[blockId]` in the API response, which is
 * automatically available as the `data` prop in block renderers.
 *
 * These exports are kept for backwards compatibility but will be
 * removed in a future version.
 */

import type { BlockContent, BlockNode } from "./types.js";

/**
 * @deprecated No longer needed. Server auto-expands relation/upload fields.
 */
export type BlockPrefetchContext<TCms = unknown> = {
  cms: TCms;
  locale: string;
  defaultLocale: string;
  request?: Request;
};

/**
 * @deprecated No longer needed. Server auto-expands relation/upload fields.
 */
export type BlockPrefetchParams<TCms = unknown> = BlockPrefetchContext<TCms> & {
  id: string;
  values: Record<string, unknown>;
};

/**
 * @deprecated No longer needed. Server auto-expands relation/upload fields.
 */
export type BlockPrefetchResult = Record<string, unknown>;

/**
 * @deprecated No longer needed. Server auto-expands relation/upload fields
 * and supports manual prefetch via `.blocks({ name: { block, prefetch } })`.
 */
export async function prefetchBlockData<TCms = unknown>(
  content: BlockContent | null | undefined,
  _blocks: Record<string, unknown>,
  _context: BlockPrefetchContext<TCms>,
): Promise<BlockPrefetchResult> {
  console.warn(
    "[prefetchBlockData] Deprecated: Client-side block prefetch is no longer needed. " +
      "Block data is now automatically fetched by the server afterRead hook. " +
      "Remove this call — data is available via the `data` prop in block renderers.",
  );
  return {};
}

/**
 * @deprecated No longer needed. Server handles block data fetching.
 */
export class BlockPrefetchError extends Error {
  constructor(
    public readonly blockId: string,
    public readonly blockType: string,
    public readonly cause: unknown,
  ) {
    const message =
      cause instanceof Error ? cause.message : "Unknown prefetch error";
    super(`Block prefetch failed for "${blockType}" (${blockId}): ${message}`);
    this.name = "BlockPrefetchError";
  }
}

/**
 * @deprecated No longer needed. Server handles block data fetching.
 */
export type TypedBlockPrefetch<TData, TCms = unknown> = (
  params: BlockPrefetchParams<TCms>,
) => Promise<TData>;
