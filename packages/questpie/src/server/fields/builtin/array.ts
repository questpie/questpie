/**
 * Array Field Type
 *
 * Array field stored as JSONB array or PostgreSQL array.
 * Supports typed items via nested field definition.
 */

import { isNull, isNotNull, sql } from "drizzle-orm";
import { jsonb } from "drizzle-orm/pg-core";
import { z } from "zod";
import { defineField } from "../define-field.js";
import type {
	BaseFieldConfig,
	ContextualOperators,
	NestedFieldMetadata,
	AnyFieldDefinition,
} from "../types.js";
import { getDefaultRegistry } from "../registry.js";

// ============================================================================
// Array Field Configuration
// ============================================================================

/**
 * Array field configuration options.
 */
export interface ArrayFieldConfig extends BaseFieldConfig {
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
function getArrayOperators(): ContextualOperators {
	return {
		column: {
			// Contains the given element
			contains: (col, value) =>
				sql`${col} @> ${JSON.stringify([value])}::jsonb`,
			// Contains all the given elements
			containsAll: (col, values) =>
				sql`${col} @> ${JSON.stringify(values)}::jsonb`,
			// Contains any of the given elements
			containsAny: (col, values) => {
				const arr = values as unknown[];
				if (arr.length === 0) return sql`FALSE`;
				return sql`${col} ?| ${sql.raw(`ARRAY[${arr.map((v) => `'${JSON.stringify(v)}'`).join(",")}]`)}`;
			},
			// Is contained by the given array
			containedBy: (col, values) =>
				sql`${col} <@ ${JSON.stringify(values)}::jsonb`,
			// Array length equals
			length: (col, value) =>
				sql`jsonb_array_length(COALESCE(${col}, '[]'::jsonb)) = ${value}`,
			// Array length greater than
			lengthGt: (col, value) =>
				sql`jsonb_array_length(COALESCE(${col}, '[]'::jsonb)) > ${value}`,
			// Array length less than
			lengthLt: (col, value) =>
				sql`jsonb_array_length(COALESCE(${col}, '[]'::jsonb)) < ${value}`,
			// Array length between
			lengthBetween: (col, value) => {
				const [min, max] = value as [number, number];
				return sql`jsonb_array_length(COALESCE(${col}, '[]'::jsonb)) BETWEEN ${min} AND ${max}`;
			},
			// Is empty array
			isEmpty: (col) =>
				sql`(${col} = '[]'::jsonb OR ${col} IS NULL)`,
			// Is not empty
			isNotEmpty: (col) =>
				sql`(${col} != '[]'::jsonb AND ${col} IS NOT NULL)`,
			// Some element matches condition (requires subquery in practice)
			some: () => sql`TRUE`, // Placeholder
			// Every element matches condition
			every: () => sql`TRUE`, // Placeholder
			// No element matches condition
			none: () => sql`TRUE`, // Placeholder
			isNull: (col) => isNull(col),
			isNotNull: (col) => isNotNull(col),
		},
		jsonb: {
			contains: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' @> ${JSON.stringify([value])}::jsonb`;
			},
			containsAll: (col, values, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' @> ${JSON.stringify(values)}::jsonb`;
			},
			containedBy: (col, values, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' <@ ${JSON.stringify(values)}::jsonb`;
			},
			length: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`jsonb_array_length(COALESCE(${col}#>'{${sql.raw(path)}}', '[]'::jsonb)) = ${value}`;
			},
			isEmpty: (col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>'{${sql.raw(path)}}' = '[]'::jsonb OR ${col}#>'{${sql.raw(path)}}' IS NULL)`;
			},
			isNotEmpty: (col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>'{${sql.raw(path)}}' != '[]'::jsonb AND ${col}#>'{${sql.raw(path)}}' IS NOT NULL)`;
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
export const arrayField = defineField<"array", ArrayFieldConfig, unknown[]>(
	"array",
	{
		toColumn(name, config) {
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

		toZodSchema(config) {
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

		getOperators() {
			return getArrayOperators();
		},

		getMetadata(config): NestedFieldMetadata {
			const itemField = resolveItemField(config.of);

			return {
				type: "array",
				label: config.label,
				description: config.description,
				required: config.required ?? false,
				localized: config.localized ?? false,
				unique: config.unique ?? false,
				searchable: config.searchable ?? false,
				readOnly: config.input === false,
				writeOnly: config.output === false,
				nestedFields: {
					item: itemField.getMetadata(),
				},
				validation: {
					minItems: config.minItems,
					maxItems: config.maxItems,
				},
			};
		},
	},
);

// Register in default registry
// Note: Cast needed because ArrayFieldConfig has required 'of' property
getDefaultRegistry().register("array", arrayField as any);
