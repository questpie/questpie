/**
 * Block Introspection
 *
 * Provides introspection of registered blocks for admin UI consumption.
 */

import type { I18nText } from "questpie/shared";
import type { AnyBlockDefinition, BlockBuilderState } from "./block-builder.js";

// ============================================================================
// Block Schema Types
// ============================================================================

/**
 * Introspected block schema for admin consumption.
 */
export interface BlockSchema {
  /** Block type name */
  name: string;

  /** Display label */
  label?: I18nText;

  /** Description */
  description?: I18nText;

  /** Icon identifier */
  icon?: string;

  /** Category for grouping in block picker */
  category?: string;

  /** Order in block picker */
  order?: number;

  /** Hide from block picker */
  hidden?: boolean;

  /** Allow child blocks */
  allowChildren?: boolean;

  /** Maximum number of child blocks */
  maxChildren?: number;

  /** Has prefetch function */
  hasPrefetch: boolean;

  /** Field schemas */
  fields: Record<string, unknown>;
}

// ============================================================================
// Introspection Functions
// ============================================================================

/**
 * Introspect a single block definition.
 * Handles both server BlockBuilder definitions and client BlockDefinition objects
 * that were converted via the `.blocks()` patch.
 */
export function introspectBlock(blockDef: AnyBlockDefinition): BlockSchema {
  const state = blockDef.state as BlockBuilderState;

  return {
    name: state.name ?? blockDef.name,
    label: state.label,
    description: state.description,
    icon: state.icon,
    category: state.category,
    order: state.order,
    hidden: state.hidden,
    allowChildren: state.allowChildren,
    maxChildren: state.maxChildren,
    hasPrefetch: typeof state.prefetch === "function",
    fields: blockDef.getFieldMetadata(),
  };
}

/**
 * Introspect all registered blocks.
 *
 * @param blocks - Record of registered block definitions
 * @returns Record of block schemas
 *
 * @example
 * ```ts
 * import { introspectBlocks } from "@questpie/admin/server";
 *
 * // In an API route
 * const blocks = introspectBlocks(cms.state.blocks);
 * return Response.json({ blocks });
 * ```
 */
export function introspectBlocks(
  blocks: Record<string, AnyBlockDefinition> | undefined,
): Record<string, BlockSchema> {
  if (!blocks) {
    return {};
  }

  const schemas: Record<string, BlockSchema> = {};

  for (const [name, blockDef] of Object.entries(blocks)) {
    schemas[name] = introspectBlock(blockDef);
  }

  return schemas;
}

/**
 * Get blocks grouped by category.
 * Useful for block picker UI.
 */
export function getBlocksByCategory(
  blocks: Record<string, BlockSchema>,
): Record<string, BlockSchema[]> {
  const grouped: Record<string, BlockSchema[]> = {
    uncategorized: [],
  };

  for (const block of Object.values(blocks)) {
    if (block.hidden) continue;

    const category = block.category || "uncategorized";
    if (!grouped[category]) {
      grouped[category] = [];
    }
    grouped[category].push(block);
  }

  // Sort blocks within each category by order
  for (const category of Object.keys(grouped)) {
    grouped[category].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  }

  return grouped;
}
