/**
 * Boolean Field Type
 *
 * Boolean field with true/false storage.
 * Supports default values and boolean operators.
 */

import { eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { boolean } from "drizzle-orm/pg-core";
import { z } from "zod";
import { defineField } from "../define-field.js";
import { getDefaultRegistry } from "../registry.js";
import type {
	BaseFieldConfig,
	ContextualOperators,
	FieldMetadataBase,
} from "../types.js";

// ============================================================================
// Boolean Field Meta (augmentable by admin)
// ============================================================================

/**
 * Boolean field metadata - augmentable by external packages.
 *
 * @example Admin augmentation:
 * ```ts
 * declare module "questpie" {
 *   interface BooleanFieldMeta {
 *     admin?: {
 *       displayAs?: "checkbox" | "switch";
 *     }
 *   }
 * }
 * ```
 */
export type BooleanFieldMeta = {};

// ============================================================================
// Boolean Field Configuration
// ============================================================================

/**
 * Boolean field configuration options.
 */
export interface BooleanFieldConfig extends BaseFieldConfig {
	/**
	 * Field-specific metadata, augmentable by external packages.
	 */
	meta?: BooleanFieldMeta;

	/**
	 * Default to true.
	 * Convenience option equivalent to `default: true`.
	 */
	defaultTrue?: boolean;

	/**
	 * Default to false.
	 * Convenience option equivalent to `default: false`.
	 */
	defaultFalse?: boolean;
}

// ============================================================================
// Boolean Field Operators
// ============================================================================

/**
 * Get operators for boolean field.
 * Supports both column and JSONB path access.
 */
function getBooleanOperators(): ContextualOperators {
	return {
		column: {
			eq: (col, value) => eq(col, value as boolean),
			ne: (col, value) => ne(col, value as boolean),
			is: (col, value) => eq(col, value as boolean),
			isNot: (col, value) => ne(col, value as boolean),
			isTrue: (col) => eq(col, true),
			isFalse: (col) => eq(col, false),
			isNull: (col) => isNull(col),
			isNotNull: (col) => isNotNull(col),
		},
		jsonb: {
			eq: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::boolean = ${value}`;
			},
			ne: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::boolean != ${value}`;
			},
			is: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::boolean = ${value}`;
			},
			isNot: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::boolean != ${value}`;
			},
			isTrue: (col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::boolean = true`;
			},
			isFalse: (col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::boolean = false`;
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
// Boolean Field Definition
// ============================================================================

/**
 * Boolean field factory.
 * Creates a boolean field with the given configuration.
 *
 * @example
 * ```ts
 * const isActive = booleanField({ defaultTrue: true });
 * const isPublished = booleanField({ default: false });
 * const isAdmin = booleanField({ required: true });
 * ```
 */
export const booleanField = defineField<"boolean", BooleanFieldConfig, boolean>(
	"boolean",
	{
		toColumn(_name, config) {
			// Don't specify column name - Drizzle uses the key name
			let column: any = boolean();

			// Apply constraints
			if (config.required && config.nullable !== true) {
				column = column.notNull();
			}

			// Determine default value
			let defaultValue: boolean | undefined;
			if (config.default !== undefined) {
				defaultValue =
					typeof config.default === "function"
						? (config.default() as boolean)
						: (config.default as boolean);
			} else if (config.defaultTrue) {
				defaultValue = true;
			} else if (config.defaultFalse) {
				defaultValue = false;
			}

			if (defaultValue !== undefined) {
				column = column.default(defaultValue);
			}
			// NOTE: unique constraint removed from field level
			// Use .indexes() on collection builder instead

			return column;
		},

		toZodSchema(config) {
			const schema = z.boolean();

			// Nullability
			if (!config.required && config.nullable !== false) {
				return schema.nullish();
			}

			return schema;
		},

		getOperators() {
			return getBooleanOperators();
		},

		getMetadata(config): FieldMetadataBase {
			return {
				type: "boolean",
				label: config.label,
				description: config.description,
				required: config.required ?? false,
				localized: config.localized ?? false,
				readOnly: config.input === false,
				writeOnly: config.output === false,
				meta: config.meta,
			};
		},
	},
);

// Register in default registry
getDefaultRegistry().register("boolean", booleanField);
