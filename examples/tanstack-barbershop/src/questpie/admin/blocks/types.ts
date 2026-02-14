/**
 * Block Props Type Helper
 *
 * Extracts typed props from server block definitions,
 * avoiding manual type duplication.
 *
 * @example
 * ```ts
 * import type { BlockProps } from "./types";
 *
 * export function HeroRenderer({ values, data }: BlockProps<"hero">) {
 *   // values.title, values.subtitle etc. are typed
 *   // data.backgroundImage is typed as ExpandedRecord | null
 * }
 * ```
 */

import type { BlockRendererProps } from "@questpie/admin/client";
import type { InferBlockData, InferBlockValues } from "@questpie/admin/server";
import type { blocks } from "@/questpie/server/blocks";

type Blocks = typeof blocks;

/**
 * Typed block renderer props.
 * Infers `values` type from server block field definitions
 * and `data` type from `.prefetch()` configuration.
 */
export type BlockProps<TBlockName extends keyof Blocks> = BlockRendererProps<
  InferBlockValues<Blocks[TBlockName]["state"]>,
  InferBlockData<Blocks[TBlockName]>
>;
