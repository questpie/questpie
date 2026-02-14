/**
 * Array Field Type
 *
 * Array field stored as JSONB array or PostgreSQL array.
 * Supports typed items via nested field definition.
 */

import { sql } from "drizzle-orm";
import { jsonb } from "drizzle-orm/pg-core";
import { z } from "zod";
import { field } from "../field.js";
import type {
	AnyFieldDefinition,
	BaseFieldConfig,
	NestedFieldMetadata,
} from "../types.js";
import { operator } from "../types.js";

// ============================================================================
// Array Field Meta (augmentable by admin)
// ============================================================================

/**
 * Array field metadata - augmentable by external packages.
 *
 * @example Admin augmentation:
 * ```ts
 * declare module "questpie" {
 *   interface ArrayFieldMeta {
 *     admin?: {
 *       displayAs?: "list" | "table" | "cards";
 *       addLabel?: string;
 *       collapsible?: boolean;
 *     }
 *   }
 * }
 * ```
 */
export interface ArrayFieldMeta {
	/** Phantom property to prevent interface collapse - enables module augmentation */
	_?: never;
}

// ============================================================================
// Array Field Configuration
// ============================================================================

/**
 * Array field configuration options.
 */
export interface ArrayFieldConfig extends BaseFieldConfig {
	/** Field-specific metadata, augmentable by external packages. */
	meta?: ArrayFieldMeta;
	/**
	 * Item field definition.
	 * Defines the type and validation of array items.
	 * Can be:
	 * - Direct field definition
	 * - Factory function for deferred definition
	 */
	of: AnyFieldDefinition | (() => AnyFieldDefinition);

	/**
	 * Minimum number of items.
	 */
	minItems?: number;

	/**
	 * Maximum number of items.
	 */
	maxItems?: number;

	/**
	 * Storage mode.
	 * Currently only JSONB is supported for complex items.
	 * @default "jsonb"
	 */
	mode?: "jsonb";
}

// ============================================================================
// Array Field Operators
// ============================================================================

/**
 * Get operators for array field.
 * Provides JSONB array operators.
 */
function getArrayOperators() {
	return {
		column: {
			// Contains the given element
			contains: operator<unknown, unknown>(
				(col, value) => sql`${col} @> ${JSON.stringify([value])}::jsonb`,
			),
			// Contains all the given elements
			containsAll: operator<unknown[], unknown>(
				(col, values) => sql`${col} @> ${JSON.stringify(values)}::jsonb`,
			),
			// Contains any of the given elements
			containsAny: operator<unknown[], unknown>((col, values) => {
				if (values.length === 0) return sql`FALSE`;
				return sql`${col} ?| ARRAY[${sql.join(
					values.map((v) => sql`${JSON.stringify(v)}`),
					sql`, `,
				)}]::text[]`;
			}),
			// Is contained by the given array
			containedBy: operator<unknown[], unknown>(
				(col, values) => sql`${col} <@ ${JSON.stringify(values)}::jsonb`,
			),
			// Array length equals
			length: operator<number, unknown>(
				(col, value) =>
					sql`jsonb_array_length(COALESCE(${col}, '[]'::jsonb)) = ${value}`,
			),
			// Array length greater than
			lengthGt: operator<number, unknown>(
				(col, value) =>
					sql`jsonb_array_length(COALESCE(${col}, '[]'::jsonb)) > ${value}`,
			),
			// Array length less than
			lengthLt: operator<number, unknown>(
				(col, value) =>
					sql`jsonb_array_length(COALESCE(${col}, '[]'::jsonb)) < ${value}`,
			),
			// Array length between
			lengthBetween: operator<[number, number], unknown>((col, value) => {
				return sql`jsonb_array_length(COALESCE(${col}, '[]'::jsonb)) BETWEEN ${value[0]} AND ${value[1]}`;
			}),
			// Is empty array
			isEmpty: operator<boolean, unknown>(
				(col) => sql`(${col} = '[]'::jsonb OR ${col} IS NULL)`,
			),
			// Is not empty
			isNotEmpty: operator<boolean, unknown>(
				(col) => sql`(${col} != '[]'::jsonb AND ${col} IS NOT NULL)`,
			),
			// Some element matches condition (requires subquery in practice)
			some: operator<unknown, unknown>(() => sql`TRUE`), // Placeholder
			// Every element matches condition
			every: operator<unknown, unknown>(() => sql`TRUE`), // Placeholder
			// No element matches condition
			none: operator<unknown, unknown>(() => sql`TRUE`), // Placeholder
			isNull: operator<boolean, unknown>((col, value) =>
				value ? sql`${col} IS NULL` : sql`${col} IS NOT NULL`,
			),
			isNotNull: operator<boolean, unknown>((col, value) =>
				value ? sql`${col} IS NOT NULL` : sql`${col} IS NULL`,
			),
		},
		jsonb: {
			contains: operator<unknown, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' @> ${JSON.stringify([value])}::jsonb`;
			}),
			containsAll: operator<unknown[], unknown>((col, values, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' @> ${JSON.stringify(values)}::jsonb`;
			}),
			containedBy: operator<unknown[], unknown>((col, values, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' <@ ${JSON.stringify(values)}::jsonb`;
			}),
			length: operator<number, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`jsonb_array_length(COALESCE(${col}#>'{${sql.raw(path)}}', '[]'::jsonb)) = ${value}`;
			}),
			isEmpty: operator<boolean, unknown>((col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>'{${sql.raw(path)}}' = '[]'::jsonb OR ${col}#>'{${sql.raw(path)}}' IS NULL)`;
			}),
			isNotEmpty: operator<boolean, unknown>((col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>'{${sql.raw(path)}}' != '[]'::jsonb AND ${col}#>'{${sql.raw(path)}}' IS NOT NULL)`;
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
// Array Field Definition
// ============================================================================

/**
 * Resolve item field from config (handles factory functions).
 */
function resolveItemField(
	of: AnyFieldDefinition | (() => AnyFieldDefinition),
): AnyFieldDefinition {
	return typeof of === "function" ? of() : of;
}

/**
 * Array field factory.
 * Creates an array field with typed items.
 *
 * @example
 * ```ts
 * // Array of strings (tags)
 * const tags = arrayField({
 *   of: textField({ maxLength: 50 }),
 *   maxItems: 10,
 * });
 *
 * // Array of objects (phone numbers)
 * const phones = arrayField({
 *   of: objectField({
 *     fields: {
 *       type: selectField({
 *         options: [
 *           { value: "mobile", label: "Mobile" },
 *           { value: "home", label: "Home" },
 *           { value: "work", label: "Work" },
 *         ],
 *       }),
 *       number: textField({ required: true }),
 *     },
 *   }),
 *   minItems: 1,
 * });
 *
 * // Array of numbers (scores)
 * const scores = arrayField({
 *   of: numberField({ min: 0, max: 100 }),
 * });
 * ```
 */
export const arrayField = field<ArrayFieldConfig, unknown[]>()({
	type: "array" as const,
	_value: undefined as unknown as unknown[],
	toColumn(name: string, config: ArrayFieldConfig) {
		// Always use JSONB for complex typed arrays
		let column: any = jsonb(name);

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

	toZodSchema(config: ArrayFieldConfig) {
		const itemField = resolveItemField(config.of);

		// Build array schema from item field
		let schema = z.array(itemField.toZodSchema());

		// Length constraints
		if (config.minItems !== undefined) {
			schema = schema.min(config.minItems);
		}
		if (config.maxItems !== undefined) {
			schema = schema.max(config.maxItems);
		}

		// Nullability
		if (!config.required && config.nullable !== false) {
			return schema.nullish();
		}

		return schema;
	},

	getOperators<TApp>(config: ArrayFieldConfig) {
		return getArrayOperators();
	},

	getMetadata(config: ArrayFieldConfig): NestedFieldMetadata {
		const itemField = resolveItemField(config.of);

		return {
			type: "array",
			label: config.label,
			description: config.description,
			required: config.required ?? false,
			localized: config.localized ?? false,
			readOnly: config.input === false,
			writeOnly: config.output === false,
			nestedFields: {
				item: itemField.getMetadata(),
			},
			validation: {
				minItems: config.minItems,
				maxItems: config.maxItems,
			},
			meta: config.meta,
		};
	},
});

// Register in default registry
// ArrayFieldConfig is now compatible with AnyFieldDefinition (no cast needed)
