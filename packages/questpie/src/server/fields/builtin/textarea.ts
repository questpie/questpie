/**
 * Textarea Field Type
 *
 * Multi-line text field with text storage mode.
 * Optimized for longer content like descriptions, comments, etc.
 */

import { sql } from "drizzle-orm";
import { text } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
	stringColumnOperators,
	stringJsonbOperators,
} from "../common-operators.js";
import { field } from "../field.js";
import type { BaseFieldConfig, FieldMetadataBase } from "../types.js";
import { operator } from "../types.js";

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
export interface TextareaFieldMeta {
	/** Phantom property to prevent interface collapse - enables module augmentation */
	_?: never;
}

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
function getTextareaOperators() {
	return {
		column: {
			...stringColumnOperators,
			isEmpty: operator<boolean, unknown>(
				(col) => sql`(${col} IS NULL OR ${col} = '')`,
			),
			isNotEmpty: operator<boolean, unknown>(
				(col) => sql`(${col} IS NOT NULL AND ${col} != '')`,
			),
		},
		jsonb: {
			...stringJsonbOperators,
			isEmpty: operator<boolean, unknown>((col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}' IS NULL OR ${col}#>>'{${sql.raw(path)}}' = '')`;
			}),
			isNotEmpty: operator<boolean, unknown>((col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}' IS NOT NULL AND ${col}#>>'{${sql.raw(path)}}' != '')`;
			}),
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
export const textareaField = field<TextareaFieldConfig, string>()({
	type: "textarea" as const,
	_value: undefined as unknown as string,
	toColumn(name: string, config: TextareaFieldConfig) {
		let column: any = text(name);

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

	toZodSchema(config: TextareaFieldConfig) {
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

	getOperators<TApp>(config: TextareaFieldConfig) {
		return getTextareaOperators();
	},

	getMetadata(config: TextareaFieldConfig): FieldMetadataBase {
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
