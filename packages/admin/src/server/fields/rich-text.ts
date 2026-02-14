/**
 * Rich Text Field Type
 *
 * TipTap-based WYSIWYG editor field stored as JSONB.
 * Provides structured rich text editing with configurable features.
 *
 * This field type is only available when using adminModule.
 */

import {
  type BaseFieldConfig,
  type ContextualOperators,
  field,
  type FieldMetadataBase,
  isNotNull,
  isNull,
  jsonb,
  sql,
} from "questpie";
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

// ============================================================================
// Rich Text Field Configuration
// ============================================================================

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

/**
 * Rich text field configuration options.
 */
export interface RichTextFieldConfig extends BaseFieldConfig {
  /** Field-specific metadata, augmentable by external packages. */
  meta?: RichTextFieldMeta;

  /**
   * Maximum character count (excluding formatting).
   * When set, shows character counter in editor.
   */
  maxCharacters?: number;

  /**
   * Minimum character count (excluding formatting).
   */
  minCharacters?: number;

  /**
   * Enabled editor features.
   * If not specified, uses a sensible default set.
   * @default ["bold", "italic", "link", "heading", "bulletList", "orderedList"]
   */
  features?: RichTextFeature[];

  /**
   * Allowed heading levels when heading feature is enabled.
   * @default [1, 2, 3]
   */
  headingLevels?: (1 | 2 | 3 | 4 | 5 | 6)[];

  /**
   * Placeholder text shown when editor is empty.
   */
  placeholder?: string;

  /**
   * Allow uploading/embedding images.
   * Requires storage configuration.
   */
  allowImages?: boolean;

  /**
   * Collection to use for image uploads.
   * Defaults to "assets" if storage is configured.
   */
  imageCollection?: string;
}

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
// Rich Text Field Definition
// ============================================================================

/**
 * Default features for rich text editor.
 */
const DEFAULT_FEATURES: RichTextFeature[] = [
  "bold",
  "italic",
  "link",
  "heading",
  "bulletList",
  "orderedList",
];

/**
 * Default heading levels.
 */
const DEFAULT_HEADING_LEVELS: (1 | 2 | 3 | 4 | 5 | 6)[] = [1, 2, 3];

/**
 * Rich text field factory.
 * Creates a TipTap-based rich text editor field.
 *
 * @example
 * ```ts
 * // Basic rich text
 * const content = richTextField({ label: "Content" });
 *
 * // With all features
 * const richContent = richTextField({
 *   label: "Article Content",
 *   features: ["bold", "italic", "underline", "heading", "bulletList", "orderedList", "link", "image", "blockquote", "codeBlock"],
 *   maxCharacters: 50000,
 *   allowImages: true,
 * });
 *
 * // Minimal editor
 * const bio = richTextField({
 *   label: "Bio",
 *   features: ["bold", "italic", "link"],
 *   maxCharacters: 500,
 * });
 * ```
 */
export const richTextField = field<RichTextFieldConfig, TipTapDocument>()(
  {
    type: "richText" as const,
    _value: undefined as unknown as TipTapDocument,

    toColumn(_name: string, config: RichTextFieldConfig) {
      // Rich text is always stored as JSONB
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

    toZodSchema(config: RichTextFieldConfig) {
      // TipTap document structure validation
      // We use a loose schema that validates the basic structure
      // but allows any valid TipTap content
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

      const docSchema = z.object({
        type: z.literal("doc"),
        content: z.array(nodeSchema).optional(),
      });

      // Nullability
      if (!config.required && config.nullable !== false) {
        return docSchema.nullish() as any;
      }

      return docSchema as any;
    },

    getOperators<TApp>() {
      return getRichTextOperators();
    },

    getMetadata(config: RichTextFieldConfig): FieldMetadataBase & {
      maxCharacters?: number;
      minCharacters?: number;
      features: RichTextFeature[];
      headingLevels: (1 | 2 | 3 | 4 | 5 | 6)[];
      placeholder?: string;
      allowImages?: boolean;
      imageCollection?: string;
    } {
      return {
        type: "richText",
        label: config.label,
        description: config.description,
        required: config.required ?? false,
        localized: config.localized ?? false,
        readOnly: config.input === false,
        writeOnly: config.output === false,
        meta: config.meta,
        // Rich text specific
        maxCharacters: config.maxCharacters,
        minCharacters: config.minCharacters,
        features: config.features ?? DEFAULT_FEATURES,
        headingLevels: config.headingLevels ?? DEFAULT_HEADING_LEVELS,
        placeholder: config.placeholder,
        allowImages: config.allowImages,
        imageCollection: config.imageCollection,
      };
    },
  },
);
