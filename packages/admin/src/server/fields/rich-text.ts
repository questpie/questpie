/**
 * Rich Text Field Type
 *
 * TipTap-based WYSIWYG editor field stored as JSONB.
 * Provides structured rich text editing with configurable features.
 *
 * This field type is only available when using the `adminModule`.
 */

import {
	type ContextualOperators,
	type DefaultFieldState,
	type Field,
	field,
	fieldType,
	type FieldTypeDefinition,
	isNotNull,
	isNull,
	jsonb,
	sql,
} from "questpie";
import type { PgJsonbBuilder, PgTextBuilder } from "questpie/drizzle-pg-core";
import { text as pgText } from "questpie/drizzle-pg-core";
import { z } from "zod";

// ============================================================================
// Rich Text Document Schema
// ============================================================================

/**
 * TipTap node type.
 * Represents a single node in the document tree.
 */
export interface TipTapNode {
	type: string;
	attrs?: Record<string, any>;
	content?: TipTapNode[];
	marks?: Array<{
		type: string;
		attrs?: Record<string, any>;
	}>;
	text?: string;
}

/**
 * TipTap document structure.
 * Root node always has type "doc".
 */
export interface TipTapDocument {
	type: "doc";
	content?: TipTapNode[];
}

// ============================================================================
// Rich Text Field Meta (augmentable by admin)
// ============================================================================

/**
 * Rich text field metadata - augmentable by external packages.
 *
 * @example Admin augmentation:
 * ```ts
 * declare module "@questpie/admin/server" {
 *   interface RichTextFieldMeta {
 *     admin?: {
 *       placeholder?: string;
 *       showCharacterCount?: boolean;
 *     }
 *   }
 * }
 * ```
 */
export interface RichTextFieldMeta {
	/** Phantom property to prevent interface collapse - enables module augmentation */
	_?: never;
}

/**
 * Available rich text editor features.
 */
export type RichTextFeature =
	| "bold"
	| "italic"
	| "underline"
	| "strike"
	| "code"
	| "subscript"
	| "superscript"
	| "heading"
	| "bulletList"
	| "orderedList"
	| "taskList"
	| "blockquote"
	| "codeBlock"
	| "horizontalRule"
	| "link"
	| "image"
	| "table"
	| "textAlign"
	| "textColor"
	| "highlight"
	| "mention";

// ============================================================================
// Rich Text Field Operators
// ============================================================================

/**
 * Get operators for rich text field.
 * Provides text search within the JSON structure.
 */
function getRichTextOperators(): ContextualOperators {
	return {
		column: {
			// Full-text search in document content
			contains: (col, value) => {
				// Search in text content using recursive CTE or JSON path
				return sql`EXISTS (
					SELECT 1 FROM jsonb_array_elements_text(
						jsonb_path_query_array(${col}, '$..text')
					) AS t
					WHERE t ILIKE ${"%" + value + "%"}
				)`;
			},
			// Check if document is empty (no content or only whitespace)
			isEmpty: (col) =>
				sql`(
					${col} IS NULL 
					OR ${col} = '{"type":"doc"}'::jsonb 
					OR ${col} = '{"type":"doc","content":[]}'::jsonb
					OR NOT EXISTS (
						SELECT 1 FROM jsonb_array_elements_text(
							jsonb_path_query_array(${col}, '$..text')
						) AS t
						WHERE length(trim(t)) > 0
					)
				)`,
			isNotEmpty: (col) =>
				sql`(
					${col} IS NOT NULL 
					AND ${col} != '{"type":"doc"}'::jsonb 
					AND ${col} != '{"type":"doc","content":[]}'::jsonb
					AND EXISTS (
						SELECT 1 FROM jsonb_array_elements_text(
							jsonb_path_query_array(${col}, '$..text')
						) AS t
						WHERE length(trim(t)) > 0
					)
				)`,
			isNull: (col) => isNull(col),
			isNotNull: (col) => isNotNull(col),
		},
		jsonb: {
			contains: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`EXISTS (
					SELECT 1 FROM jsonb_array_elements_text(
						jsonb_path_query_array(${col}#>'{${sql.raw(path)}}', '$..text')
					) AS t
					WHERE t ILIKE ${"%" + value + "%"}
				)`;
			},
			isEmpty: (col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(
					${col}#>'{${sql.raw(path)}}' IS NULL 
					OR ${col}#>'{${sql.raw(path)}}' = '{"type":"doc"}'::jsonb
				)`;
			},
			isNotEmpty: (col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(
					${col}#>'{${sql.raw(path)}}' IS NOT NULL 
					AND ${col}#>'{${sql.raw(path)}}' != '{"type":"doc"}'::jsonb
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
// Markdown-mode operators (simple text column)
// ============================================================================

const markdownOperators = {
	contains: (col: any, value: any) => sql`${col} ILIKE ${"%" + value + "%"}`,
	isEmpty: (col: any) =>
		sql`(${col} IS NULL OR length(trim(${col})) = 0)`,
	isNotEmpty: (col: any) =>
		sql`(${col} IS NOT NULL AND length(trim(${col})) > 0)`,
	isNull: (col: any) => isNull(col),
	isNotNull: (col: any) => isNotNull(col),
};

// ============================================================================
// Rich Text Field Options & State
// ============================================================================

export type RichTextMode = "json" | "markdown";

export type RichTextOptions = {
	mode?: RichTextMode;
};

type RichTextData<TMode extends RichTextMode> = TMode extends "markdown"
	? string
	: TipTapDocument;

type RichTextColumn<TMode extends RichTextMode> = TMode extends "markdown"
	? PgTextBuilder
	: PgJsonbBuilder;

export type RichTextFieldState<TMode extends RichTextMode = "json"> =
	DefaultFieldState & {
	type: "richText";
	data: RichTextData<TMode>;
	column: RichTextColumn<TMode>;
};

/**
 * Create a rich text field.
 *
 * @example
 * ```ts
 * content: f.richText().required().localized()
 * ```
 */
/**
 * Rich text field runtime state factory.
 * Shared between the legacy `richText()` function and the new `richTextFieldType`.
 */
function createRichTextState(options?: RichTextOptions) {
	const mode = options?.mode ?? "json";
	const isMarkdown = mode === "markdown";

	return {
		type: "richText" as const,
		columnFactory: isMarkdown
			? (name: string) => pgText(name) as any
			: (name: string) => jsonb(name) as any,
		schemaFactory: isMarkdown
			? () => z.string()
			: () => {
					const nodeSchema: z.ZodType<TipTapNode> = z.lazy(() =>
						z.object({
							type: z.string(),
							attrs: z.record(z.string(), z.any()).optional(),
							content: z.array(nodeSchema).optional(),
							marks: z
								.array(
									z.object({
										type: z.string(),
										attrs: z.record(z.string(), z.any()).optional(),
									}),
								)
								.optional(),
							text: z.string().optional(),
						}),
					);
					return z.object({
						type: z.literal("doc"),
						content: z.array(nodeSchema).optional(),
					});
				},
		operatorSet: isMarkdown
			? (markdownOperators as any)
			: ({
					jsonbCast: null,
					column: getRichTextOperators().column,
				} as any),
		metadataFactory: (state: any) => ({
			type: "richText" as const,
			label: state.label,
			description: state.description,
			required: state.notNull ?? false,
			localized: state.localized ?? false,
			readOnly: state.input === false ? true : undefined,
			writeOnly: state.output === false ? true : undefined,
			meta: state.extensions?.admin as any,
			outputMode: mode,
		}),
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
	};
}

export function richText(): Field<RichTextFieldState<"json">>;
export function richText<const TMode extends RichTextMode>(
	options: { mode: TMode },
): Field<RichTextFieldState<TMode>>;
export function richText(options?: RichTextOptions): Field<RichTextFieldState> {
	return field(createRichTextState(options));
}

/**
 * Rich text field type definition (v3 API).
 *
 * Use this with the `fieldType()` discovery system instead of the
 * legacy `richText()` factory function.
 */
export const richTextFieldType: FieldTypeDefinition<
	"richText",
	[RichTextOptions?]
> = fieldType("richText", {
	create: createRichTextState,
});
