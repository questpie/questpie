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
 * This field type is only available when using the `adminModule`.
 */

import type { PgJsonbBuilder } from "drizzle-orm/pg-core";
import {
	type ContextualOperators,
	type DefaultFieldState,
	type Field,
	field,
	fieldType,
	type FieldTypeDefinition,
	getContext,
	isNotNull,
	isNull,
	jsonb,
	sql,
} from "questpie";
import { z } from "zod";

import { processBlocksDocument } from "../block/prefetch.js";

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
export type BlockValues = Record<string, {}>;

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
	_data?: Record<string, Record<string, {}>>;
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
 * // In collection fields callback:
 * sections: f.blocks().required()
 * ```
 */
// ============================================================================
// Blocks Field State & Factory
// ============================================================================

export type BlocksFieldState = DefaultFieldState & {
	type: "blocks";
	data: BlocksDocument;
	column: PgJsonbBuilder;
};

/**
 * Create a blocks field.
 *
 * @example
 * ```ts
 * sections: f.blocks().required()
 * ```
 */
/**
 * Blocks field runtime state factory.
 * Shared between the legacy `blocks()` function and the new `blocksFieldType`.
 */
function createBlocksState() {
	return {
		type: "blocks" as const,
		columnFactory: (name: string) => jsonb(name) as any,
		schemaFactory: () => {
			const blockNodeSchema: z.ZodType<BlockNode> = z.lazy(() =>
				z.object({
					id: z.string(),
					type: z.string(),
					children: z.array(blockNodeSchema).default([]),
				}),
			);
			return z.object({
				_tree: z.array(blockNodeSchema),
				_values: z.record(z.string(), z.record(z.string(), z.any())),
			});
		},
		operatorSet: {
			jsonbCast: null,
			column: getBlocksOperators().column,
		} as any,
		metadataFactory: (state: any) => ({
			type: "blocks" as const,
			label: state.label,
			description: state.description,
			required: state.notNull ?? false,
			localized: state.localized ?? false,
			readOnly: state.input === false ? true : undefined,
			writeOnly: state.output === false ? true : undefined,
			meta: state.extensions?.admin as any,
		}),
		hooks: {
			afterRead: async (value: unknown) => {
				if (!value || typeof value !== "object") return value;
				const doc = value as BlocksDocument;
				if (!doc._tree || !doc._values) return value;
				try {
					const { app, db, locale } = getContext();
					const blockDefs = (app as any).state?.blocks;
					if (!blockDefs || Object.keys(blockDefs).length === 0) return value;
					return await processBlocksDocument(doc, blockDefs, {
						app,
						db,
						locale,
						collections: (app as any).collections,
						globals: (app as any).globals,
					});
				} catch {
					// getContext() fails outside request scope — return as-is
					return value;
				}
			},
		},
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
	};
}

export function blocks(): Field<BlocksFieldState> {
	return field<BlocksFieldState>(createBlocksState());
}

/**
 * Blocks field type definition (v3 API).
 *
 * Use this with the `fieldType()` discovery system instead of the
 * legacy `blocks()` factory function.
 */
export const blocksFieldType: FieldTypeDefinition<"blocks", []> = fieldType("blocks", {
	create: createBlocksState as any,
});
