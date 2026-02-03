/**
 * Textarea Field Type
 *
 * Multi-line text field with text storage mode.
 * Optimized for longer content like descriptions, comments, etc.
 */

import { eq, ilike, isNotNull, isNull, like, ne, sql } from "drizzle-orm";
import { text } from "drizzle-orm/pg-core";
import { z } from "zod";
import { defineField } from "../define-field.js";
import { getDefaultRegistry } from "../registry.js";
import type {
	BaseFieldConfig,
	ContextualOperators,
	FieldMetadataBase,
} from "../types.js";

// ============================================================================
// Textarea Field Meta (augmentable by admin)
// ============================================================================

/**
 * Textarea field metadata - augmentable by external packages.
 *
 * @example Admin augmentation:
 * ```ts
 * declare module "questpie" {
 *   interface TextareaFieldMeta {
 *     admin?: {
 *       rows?: number;
 *       autoResize?: boolean;
 *       richText?: boolean;
 *     }
 *   }
 * }
 * ```
 */
export interface TextareaFieldMeta {}

// ============================================================================
// Textarea Field Configuration
// ============================================================================

/**
 * Textarea field configuration options.
 */
export interface TextareaFieldConfig extends BaseFieldConfig {
	/** Field-specific metadata, augmentable by external packages. */
	meta?: TextareaFieldMeta;
	/**
	 * Maximum character length for validation.
	 */
	maxLength?: number;

	/**
	 * Minimum character length for validation.
	 */
	minLength?: number;

	/**
	 * Trim whitespace from input.
	 * Applied as Zod transform.
	 * @default true
	 */
	trim?: boolean;

	/**
	 * Suggested number of visible rows (UI hint).
	 * Does not affect storage.
	 * @default 4
	 */
	rows?: number;
}

// ============================================================================
// Textarea Field Operators
// ============================================================================

/**
 * Get operators for textarea field.
 * Similar to text field but optimized for longer content.
 */
function getTextareaOperators(): ContextualOperators {
	return {
		column: {
			eq: (col, value) => eq(col, value as string),
			ne: (col, value) => ne(col, value as string),
			like: (col, value) => like(col, value as string),
			ilike: (col, value) => ilike(col, value as string),
			contains: (col, value) => ilike(col, `%${value}%`),
			startsWith: (col, value) => like(col, `${value}%`),
			endsWith: (col, value) => like(col, `%${value}`),
			isEmpty: (col) => sql`(${col} IS NULL OR ${col} = '')`,
			isNotEmpty: (col) => sql`(${col} IS NOT NULL AND ${col} != '')`,
			isNull: (col) => isNull(col),
			isNotNull: (col) => isNotNull(col),
		},
		jsonb: {
			eq: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>>'{${sql.raw(path)}}' = ${value}`;
			},
			ne: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>>'{${sql.raw(path)}}' != ${value}`;
			},
			like: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>>'{${sql.raw(path)}}' LIKE ${value}`;
			},
			ilike: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>>'{${sql.raw(path)}}' ILIKE ${value}`;
			},
			contains: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>>'{${sql.raw(path)}}' ILIKE ${"%" + value + "%"}`;
			},
			startsWith: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>>'{${sql.raw(path)}}' LIKE ${value + "%"}`;
			},
			endsWith: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>>'{${sql.raw(path)}}' LIKE ${"%" + value}`;
			},
			isEmpty: (col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}' IS NULL OR ${col}#>>'{${sql.raw(path)}}' = '')`;
			},
			isNotEmpty: (col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}' IS NOT NULL AND ${col}#>>'{${sql.raw(path)}}' != '')`;
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
// Textarea Field Definition
// ============================================================================

/**
 * Textarea field factory.
 * Creates a multi-line text field with the given configuration.
 *
 * @example
 * ```ts
 * const description = textareaField({ maxLength: 2000 });
 * const bio = textareaField({ required: true, minLength: 50, maxLength: 500 });
 * const notes = textareaField({ rows: 10 });
 * ```
 */
export const textareaField = defineField<
	"textarea",
	TextareaFieldConfig,
	string
>("textarea", {
	toColumn(_name, config) {
		// Don't specify column name - Drizzle uses the key name
		let column: any = text();

		// Apply constraints
		if (config.required && config.nullable !== true) {
			column = column.notNull();
		}
		if (config.default !== undefined) {
			const defaultValue =
				typeof config.default === "function"
					? config.default()
					: config.default;
			column = column.default(defaultValue as string);
		}
		// NOTE: unique constraint removed from field level
		// Use .indexes() on collection builder instead

		return column;
	},

	toZodSchema(config) {
		const { trim = true } = config;

		let schema = z.string();

		// Validation rules
		if (config.maxLength !== undefined) {
			schema = schema.max(config.maxLength);
		}
		if (config.minLength !== undefined) {
			schema = schema.min(config.minLength);
		}

		// Transforms
		if (trim) {
			schema = schema.trim();
		}

		// Nullability
		if (!config.required && config.nullable !== false) {
			return schema.nullish();
		}

		return schema;
	},

	getOperators() {
		return getTextareaOperators();
	},

	getMetadata(config): FieldMetadataBase {
		return {
			type: "textarea",
			label: config.label,
			description: config.description,
			required: config.required ?? false,
			localized: config.localized ?? false,
			readOnly: config.input === false,
			writeOnly: config.output === false,
			validation: {
				maxLength: config.maxLength,
				minLength: config.minLength,
			},
			meta: config.meta,
		};
	},
});

// Register in default registry
getDefaultRegistry().register("textarea", textareaField);
