/**
 * Text Field Type
 *
 * String field with varchar or text storage mode.
 * Supports validation, transforms, and search operators.
 */

import {
	eq,
	ilike,
	inArray,
	isNotNull,
	isNull,
	like,
	ne,
	notInArray,
	sql,
} from "drizzle-orm";
import { text, varchar } from "drizzle-orm/pg-core";
import { z } from "zod";
import { defineField } from "../define-field.js";
import { getDefaultRegistry } from "../registry.js";
import type {
	BaseFieldConfig,
	ContextualOperators,
	FieldMetadataBase,
} from "../types.js";

// ============================================================================
// Text Field Meta (augmentable by admin)
// ============================================================================

/**
 * Text field metadata - augmentable by external packages.
 *
 * @example Admin augmentation:
 * ```ts
 * declare module "questpie" {
 *   interface TextFieldMeta {
 *     admin?: {
 *       placeholder?: string;
 *       showCounter?: boolean;
 *       prefix?: string;
 *       suffix?: string;
 *     }
 *   }
 * }
 * ```
 */
export interface TextFieldMeta {}

// ============================================================================
// Text Field Configuration
// ============================================================================

/**
 * Text field configuration options.
 */
export interface TextFieldConfig extends BaseFieldConfig {
	/**
	 * Field-specific metadata, augmentable by external packages.
	 */
	meta?: TextFieldMeta;
	/**
	 * Storage mode: varchar (default) or text.
	 * - varchar: Fixed max length, slightly more efficient for short strings
	 * - text: Unlimited length, use for potentially long content
	 * @default "varchar"
	 */
	mode?: "varchar" | "text";

	/**
	 * Maximum character length.
	 * Applied to varchar mode and Zod validation.
	 * @default 255
	 */
	maxLength?: number;

	/**
	 * Minimum character length for validation.
	 */
	minLength?: number;

	/**
	 * Regex pattern for validation.
	 * Can be a RegExp or string pattern.
	 */
	pattern?: RegExp | string;

	/**
	 * Trim whitespace from input.
	 * Applied as Zod transform.
	 */
	trim?: boolean;

	/**
	 * Convert to lowercase.
	 * Applied as Zod transform.
	 */
	lowercase?: boolean;

	/**
	 * Convert to uppercase.
	 * Applied as Zod transform.
	 */
	uppercase?: boolean;
}

// ============================================================================
// Text Field Operators
// ============================================================================

/**
 * Get operators for text field.
 * Supports both column and JSONB path access.
 */
function getTextOperators(): ContextualOperators {
	return {
		column: {
			eq: (col, value) => eq(col, value as string),
			ne: (col, value) => ne(col, value as string),
			like: (col, value) => like(col, value as string),
			ilike: (col, value) => ilike(col, value as string),
			startsWith: (col, value) => like(col, `${value}%`),
			endsWith: (col, value) => like(col, `%${value}`),
			contains: (col, value) => ilike(col, `%${value}%`),
			in: (col, values) => inArray(col, values as string[]),
			notIn: (col, values) => notInArray(col, values as string[]),
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
// Text Field Definition
// ============================================================================

/**
 * Text field factory.
 * Creates a text field with the given configuration.
 *
 * @example
 * ```ts
 * const title = textField({ required: true, maxLength: 255 });
 * const slug = textField({ required: true, pattern: /^[a-z0-9-]+$/, lowercase: true });
 * const content = textField({ mode: "text" });
 * ```
 */
export const textField = defineField<"text", TextFieldConfig, string>("text", {
	toColumn(_name, config) {
		const { mode = "varchar", maxLength = 255 } = config;

		// Don't specify column name - Drizzle uses the key name
		// User's casing config handles naming (title → title or title → title)
		let column: any = mode === "text" ? text() : varchar({ length: maxLength });

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
		let schema = z.string();

		// Validation rules
		if (config.maxLength !== undefined) {
			schema = schema.max(config.maxLength);
		}
		if (config.minLength !== undefined) {
			schema = schema.min(config.minLength);
		}
		if (config.pattern) {
			const regex =
				typeof config.pattern === "string"
					? new RegExp(config.pattern)
					: config.pattern;
			schema = schema.regex(regex);
		}

		// Transforms
		if (config.trim) {
			schema = schema.trim();
		}
		if (config.lowercase) {
			schema = schema.toLowerCase();
		}
		if (config.uppercase) {
			schema = schema.toUpperCase();
		}

		// Nullability
		if (!config.required && config.nullable !== false) {
			return schema.nullish();
		}

		return schema;
	},

	getOperators() {
		return getTextOperators();
	},

	getMetadata(config): FieldMetadataBase {
		return {
			type: "text",
			label: config.label,
			description: config.description,
			required: config.required ?? false,
			localized: config.localized ?? false,
			readOnly: config.input === false,
			writeOnly: config.output === false,
			validation: {
				maxLength: config.maxLength,
				minLength: config.minLength,
				pattern: config.pattern?.toString(),
			},
			meta: config.meta,
		};
	},
});

// Register in default registry
getDefaultRegistry().register("text", textField);
