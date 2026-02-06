/**
 * Blocks Field Type
 *
 * Visual block editor field stored as JSONB.
 * Provides a tree-based structure for page builder functionality.
 *
 * The blocks field stores data in a normalized format:
 * - _tree: Array of block nodes with id, type, and children
 * - _values: Record mapping block id to field values
 *
 * This field type is only available when using adminModule.
 */

import {
  type BaseFieldConfig,
  type ContextualOperators,
  defineField,
  type FieldMetadataBase,
  isNotNull,
  isNull,
  jsonb,
  sql,
} from "questpie";
import { z } from "zod";
import type { AnyBlockDefinition } from "../block/block-builder.js";

// ============================================================================
// Blocks Data Schema
// ============================================================================

/**
 * Block node in the tree structure.
 * Each block has an id, type, and optional children.
 */
export interface BlockNode {
  /** Unique identifier for this block instance */
  id: string;
  /** Block type name (e.g., "hero", "text", "image") */
  type: string;
  /** Nested child blocks */
  children: BlockNode[];
}

/**
 * Block field values.
 * Maps field names to their values for a single block.
 */
export type BlockValues = Record<string, unknown>;

/**
 * Blocks document structure.
 * Normalized format separating tree structure from values.
 */
export interface BlocksDocument {
  /** Tree structure defining block hierarchy */
  _tree: BlockNode[];
  /** Map of block id to field values */
  _values: Record<string, BlockValues>;
  /** Prefetched data for blocks (populated by afterRead hook) */
  _data?: Record<string, Record<string, unknown>>;
}

// ============================================================================
// Blocks Field Meta (augmentable by admin)
// ============================================================================

/**
 * Blocks field metadata - augmentable by external packages.
 *
 * @example Admin augmentation:
 * ```ts
 * declare module "@questpie/admin/server" {
 *   interface BlocksFieldMeta {
 *     admin?: {
 *       addLabel?: string;
 *       emptyMessage?: string;
 *     }
 *   }
 * }
 * ```
 */
export interface BlocksFieldMeta {
  /** Phantom property to prevent interface collapse - enables module augmentation */
  _?: never;
}

// ============================================================================
// Blocks Field Configuration
// ============================================================================

/**
 * Blocks field configuration options.
 */
export interface BlocksFieldConfig extends BaseFieldConfig {
  /** Field-specific metadata, augmentable by external packages. */
  meta?: BlocksFieldMeta;

  /**
   * Allowed block types.
   * If specified, only these block types can be added.
   * Block types must be registered via `.blocks()` on the CMS builder.
   */
  allowedBlocks?: string[];

  /**
   * Minimum number of blocks required.
   */
  minBlocks?: number;

  /**
   * Maximum number of blocks allowed.
   */
  maxBlocks?: number;

  /**
   * Allow nesting blocks (blocks with children).
   * @default true
   */
  allowNesting?: boolean;

  /**
   * Maximum nesting depth for blocks.
   * Only applies when allowNesting is true.
   * @default 3
   */
  maxDepth?: number;

  /**
   * Placeholder text shown when no blocks exist.
   */
  placeholder?: string;

  /**
   * Block definitions injected at build time by `.blocks()` patch.
   * Used for per-block field validation in toZodSchema().
   * @internal
   */
  _blockDefinitions?: Record<string, AnyBlockDefinition>;
}

// ============================================================================
// Blocks Field Operators
// ============================================================================

/**
 * Get operators for blocks field.
 * Provides operators for querying block content.
 */
function getBlocksOperators(): ContextualOperators {
  return {
    column: {
      // Check if any block of a specific type exists
      hasBlockType: (col, value) =>
        sql`EXISTS (
					SELECT 1 FROM jsonb_array_elements(${col}->'_tree') AS block
					WHERE block->>'type' = ${value}
				)`,
      // Count blocks at root level
      blockCount: (col, value) => {
        const { op, count } = value as { op: string; count: number };
        const operator = op === "gte" ? ">=" : op === "lte" ? "<=" : "=";
        return sql`jsonb_array_length(${col}->'_tree') ${sql.raw(operator)} ${count}`;
      },
      // Check if document is empty (no blocks)
      isEmpty: (col) =>
        sql`(
					${col} IS NULL 
					OR ${col}->'_tree' IS NULL
					OR jsonb_array_length(${col}->'_tree') = 0
				)`,
      isNotEmpty: (col) =>
        sql`(
					${col} IS NOT NULL 
					AND ${col}->'_tree' IS NOT NULL
					AND jsonb_array_length(${col}->'_tree') > 0
				)`,
      isNull: (col) => isNull(col),
      isNotNull: (col) => isNotNull(col),
    },
    jsonb: {
      hasBlockType: (col, value, ctx) => {
        const path = ctx.jsonbPath?.join(",") ?? "";
        return sql`EXISTS (
					SELECT 1 FROM jsonb_array_elements(${col}#>'{${sql.raw(path)},_tree}') AS block
					WHERE block->>'type' = ${value}
				)`;
      },
      isEmpty: (col, _value, ctx) => {
        const path = ctx.jsonbPath?.join(",") ?? "";
        return sql`(
					${col}#>'{${sql.raw(path)}}' IS NULL 
					OR ${col}#>'{${sql.raw(path)},_tree}' IS NULL
					OR jsonb_array_length(${col}#>'{${sql.raw(path)},_tree}') = 0
				)`;
      },
      isNotEmpty: (col, _value, ctx) => {
        const path = ctx.jsonbPath?.join(",") ?? "";
        return sql`(
					${col}#>'{${sql.raw(path)}}' IS NOT NULL 
					AND ${col}#>'{${sql.raw(path)},_tree}' IS NOT NULL
					AND jsonb_array_length(${col}#>'{${sql.raw(path)},_tree}') > 0
				)`;
      },
      isNull: (col, _value, ctx) => {
        const path = ctx.jsonbPath?.join(",") ?? "";
        return sql`${col}#>'{${sql.raw(path)}}' IS NULL`;
      },
      isNotNull: (col, _value, ctx) => {
        const path = ctx.jsonbPath?.join(",") ?? "";
        return sql`${col}#>'{${sql.raw(path)}}' IS NOT NULL`;
      },
    },
  };
}

// ============================================================================
// Blocks Field Definition
// ============================================================================

/**
 * Blocks field factory.
 * Creates a visual block editor field for page builder functionality.
 *
 * @example
 * ```ts
 * // Basic blocks field
 * const content = blocksField({ label: "Content" });
 *
 * // With allowed blocks
 * const pageContent = blocksField({
 *   label: "Page Sections",
 *   allowedBlocks: ["hero", "features", "testimonials", "cta"],
 *   minBlocks: 1,
 *   maxBlocks: 20,
 * });
 *
 * // With nesting disabled
 * const simpleBlocks = blocksField({
 *   label: "Components",
 *   allowNesting: false,
 * });
 * ```
 */
export const blocksField = defineField<BlocksFieldConfig, BlocksDocument>()({
  type: "blocks" as const,
  _value: undefined as unknown as BlocksDocument,

  toColumn(_name: string, config: BlocksFieldConfig) {
    // Blocks are always stored as JSONB
    let column: any = jsonb();

    // Apply constraints
    if (config.required && config.nullable !== true) {
      column = column.notNull();
    }
    if (config.default !== undefined) {
      const defaultValue =
        typeof config.default === "function"
          ? config.default()
          : config.default;
      column = column.default(defaultValue);
    }

    return column;
  },

  toZodSchema(config: BlocksFieldConfig) {
    // Block node schema (recursive for nested blocks)
    const blockNodeSchema: z.ZodType<BlockNode> = z.lazy(() =>
      z.object({
        id: z.string(),
        type: z.string(),
        children: z.array(blockNodeSchema).default([]),
      }),
    );

    // Blocks document schema
    let docSchema = z.object({
      _tree: z.array(blockNodeSchema),
      _values: z.record(z.string(), z.record(z.string(), z.any())),
    });

    // Apply validation for min/max blocks
    if (config.minBlocks !== undefined || config.maxBlocks !== undefined) {
      docSchema = docSchema.refine(
        (doc) => {
          const count = doc._tree.length;
          if (config.minBlocks !== undefined && count < config.minBlocks) {
            return false;
          }
          if (config.maxBlocks !== undefined && count > config.maxBlocks) {
            return false;
          }
          return true;
        },
        {
          message:
            config.minBlocks !== undefined && config.maxBlocks !== undefined
              ? `Must have between ${config.minBlocks} and ${config.maxBlocks} blocks`
              : config.minBlocks !== undefined
                ? `Must have at least ${config.minBlocks} blocks`
                : `Must have at most ${config.maxBlocks} blocks`,
        },
      ) as typeof docSchema;
    }

    // Per-block field validation when block definitions are available
    if (
      config._blockDefinitions &&
      Object.keys(config._blockDefinitions).length > 0
    ) {
      const blockDefs = config._blockDefinitions;
      docSchema = docSchema.superRefine((doc, ctx) => {
        // Collect all block nodes (flatten tree)
        const allNodes: BlockNode[] = [];
        const collectNodes = (nodes: BlockNode[]) => {
          for (const node of nodes) {
            allNodes.push(node);
            if (node.children.length > 0) {
              collectNodes(node.children);
            }
          }
        };
        collectNodes(doc._tree);

        // Validate each block's values against its definition's field schemas
        for (const node of allNodes) {
          const blockDef = blockDefs[node.type];
          if (!blockDef?.state.fields) continue;

          const blockValues = doc._values[node.id] || {};

          for (const [fieldName, fieldDef] of Object.entries(
            blockDef.state.fields,
          )) {
            // Server FieldDefinition has toZodSchema()
            if (
              fieldDef &&
              typeof fieldDef === "object" &&
              "toZodSchema" in fieldDef &&
              typeof (fieldDef as any).toZodSchema === "function"
            ) {
              const fieldSchema = (fieldDef as any).toZodSchema() as z.ZodType;
              const result = fieldSchema.safeParse(blockValues[fieldName]);
              if (!result.success) {
                for (const issue of result.error.issues) {
                  ctx.addIssue({
                    ...issue,
                    path: ["_values", node.id, fieldName, ...issue.path],
                    message: `Block "${node.type}" field "${fieldName}": ${issue.message}`,
                  });
                }
              }
            }
          }
        }
      }) as typeof docSchema;
    }

    // Nullability
    if (!config.required && config.nullable !== false) {
      return docSchema.nullish() as z.ZodType<
        BlocksDocument | null | undefined
      >;
    }

    return docSchema as z.ZodType<BlocksDocument>;
  },

  getOperators<TApp>() {
    return getBlocksOperators();
  },

  getMetadata(config: BlocksFieldConfig): FieldMetadataBase & {
    allowedBlocks?: string[];
    minBlocks?: number;
    maxBlocks?: number;
    allowNesting: boolean;
    maxDepth: number;
    placeholder?: string;
  } {
    return {
      type: "blocks",
      label: config.label,
      description: config.description,
      required: config.required ?? false,
      localized: config.localized ?? false,
      readOnly: config.input === false,
      writeOnly: config.output === false,
      meta: config.meta,
      // Blocks specific
      allowedBlocks: config.allowedBlocks,
      minBlocks: config.minBlocks,
      maxBlocks: config.maxBlocks,
      allowNesting: config.allowNesting ?? true,
      maxDepth: config.maxDepth ?? 3,
      placeholder: config.placeholder,
    };
  },
});
