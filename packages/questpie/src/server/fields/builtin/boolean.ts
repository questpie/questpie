/**
 * Boolean Field Type
 *
 * Boolean field with true/false storage.
 * Supports default values and boolean operators.
 */

import { eq, ne, sql } from "drizzle-orm";
import { boolean } from "drizzle-orm/pg-core";
import { z } from "zod";
import { field } from "../field.js";
import type { BaseFieldConfig, FieldMetadataBase } from "../types.js";
import { operator } from "../types.js";

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
export interface BooleanFieldMeta {
	/** Phantom property to prevent interface collapse - enables module augmentation */
	_?: never;
}

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
function getBooleanOperators() {
	return {
		column: {
			eq: operator<boolean, unknown>((col, value) => eq(col, value)),
			ne: operator<boolean, unknown>((col, value) => ne(col, value)),
			is: operator<boolean, unknown>((col, value) => eq(col, value)),
			isNot: operator<boolean, unknown>((col, value) => ne(col, value)),
			isTrue: operator<boolean, unknown>((col) => eq(col, true)),
			isFalse: operator<boolean, unknown>((col) => eq(col, false)),
			isNull: operator<boolean, unknown>((col, value) =>
				value ? sql`${col} IS NULL` : sql`${col} IS NOT NULL`,
			),
			isNotNull: operator<boolean, unknown>((col, value) =>
				value ? sql`${col} IS NOT NULL` : sql`${col} IS NULL`,
			),
		},
		jsonb: {
			eq: operator<boolean, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::boolean = ${value}`;
			}),
			ne: operator<boolean, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::boolean != ${value}`;
			}),
			is: operator<boolean, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::boolean = ${value}`;
			}),
			isNot: operator<boolean, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::boolean != ${value}`;
			}),
			isTrue: operator<boolean, unknown>((col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::boolean = true`;
			}),
			isFalse: operator<boolean, unknown>((col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::boolean = false`;
			}),
			isNull: operator<boolean, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return value
					? sql`${col}#>'{${sql.raw(path)}}' IS NULL`
					: sql`${col}#>'{${sql.raw(path)}}' IS NOT NULL`;
			}),
			isNotNull: operator<boolean, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return value
					? sql`${col}#>'{${sql.raw(path)}}' IS NOT NULL`
					: sql`${col}#>'{${sql.raw(path)}}' IS NULL`;
			}),
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
export const booleanField = field<BooleanFieldConfig, boolean>()({
	type: "boolean" as const,
	_value: undefined as unknown as boolean,
	toColumn(name: string, config: BooleanFieldConfig) {
		let column: any = boolean(name);

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

	toZodSchema(config: BooleanFieldConfig) {
		const schema = z.boolean();

		// Nullability
		if (!config.required && config.nullable !== false) {
			return schema.nullish();
		}

		return schema;
	},

	getOperators<TApp>(config: BooleanFieldConfig) {
		return getBooleanOperators();
	},

	getMetadata(config: BooleanFieldConfig): FieldMetadataBase {
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
});

// Register in default registry
