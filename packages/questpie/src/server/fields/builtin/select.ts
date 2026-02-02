/**
 * Select Field Type
 *
 * Enumeration field for selecting from predefined options.
 * Supports single and multiple selection, enum types, and option labels.
 */

import {
	eq,
	inArray,
	isNotNull,
	isNull,
	ne,
	notInArray,
	sql,
} from "drizzle-orm";
import { jsonb, pgEnum, varchar } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { I18nText } from "#questpie/shared/i18n/types.js";
import { defineField } from "../define-field.js";
import { getDefaultRegistry } from "../registry.js";
import type {
	BaseFieldConfig,
	ContextualOperators,
	SelectFieldMetadata,
} from "../types.js";

// ============================================================================
// Select Field Meta (augmentable by admin)
// ============================================================================

/**
 * Select field metadata - augmentable by external packages.
 *
 * @example Admin augmentation:
 * ```ts
 * declare module "questpie" {
 *   interface SelectFieldMeta {
 *     admin?: {
 *       displayAs?: "dropdown" | "radio" | "checkbox" | "buttons";
 *       searchable?: boolean;
 *       creatable?: boolean;
 *     }
 *   }
 * }
 * ```
 */
export type SelectFieldMeta = {};

// ============================================================================
// Select Field Configuration
// ============================================================================

/**
 * Option definition for select field.
 */
export interface SelectOption {
	/** The stored value */
	value: string | number;

	/** Display label (i18n supported) */
	label: I18nText;

	/** Optional description */
	description?: I18nText;

	/** Disable this option */
	disabled?: boolean;
}

/**
 * Select field configuration options.
 */
export interface SelectFieldConfig extends BaseFieldConfig {
	/** Field-specific metadata, augmentable by external packages. */
	meta?: SelectFieldMeta;

	/**
	 * Available options for selection.
	 */
	options: readonly SelectOption[];

	/**
	 * Allow multiple selections.
	 * When true, value is stored as JSONB array.
	 * @default false
	 */
	multiple?: boolean;

	/**
	 * Use PostgreSQL enum type for storage.
	 * More efficient but requires migration for changes.
	 * @default false
	 */
	enumType?: boolean;

	/**
	 * Custom enum type name (for enumType: true).
	 * Generated from field name if not provided.
	 */
	enumName?: string;
}

// ============================================================================
// Select Field Operators
// ============================================================================

/**
 * Get operators for single select field.
 */
function getSingleSelectOperators(): ContextualOperators {
	return {
		column: {
			eq: (col, value) => eq(col, value as string),
			ne: (col, value) => ne(col, value as string),
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
			in: (col, values, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>>'{${sql.raw(path)}}' = ANY(${values}::text[])`;
			},
			notIn: (col, values, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`NOT (${col}#>>'{${sql.raw(path)}}' = ANY(${values}::text[]))`;
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

/**
 * Get operators for multi-select field.
 */
function getMultiSelectOperators(): ContextualOperators {
	return {
		column: {
			// Contains all specified values
			containsAll: (col, values) =>
				sql`${col} @> ${JSON.stringify(values)}::jsonb`,
			// Contains any of specified values
			containsAny: (col, values) =>
				sql`${col} ?| ${sql.raw(`ARRAY[${(values as string[]).map((v) => `'${v}'`).join(",")}]`)}`,
			// Exactly equals (same values, same order)
			eq: (col, values) => sql`${col} = ${JSON.stringify(values)}::jsonb`,
			// Is empty array
			isEmpty: (col) => sql`${col} = '[]'::jsonb OR ${col} IS NULL`,
			// Is not empty
			isNotEmpty: (col) => sql`${col} != '[]'::jsonb AND ${col} IS NOT NULL`,
			// Length equals
			length: (col, value) => sql`jsonb_array_length(${col}) = ${value}`,
			isNull: (col) => isNull(col),
			isNotNull: (col) => isNotNull(col),
		},
		jsonb: {
			containsAll: (col, values, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' @> ${JSON.stringify(values)}::jsonb`;
			},
			containsAny: (col, values, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' ?| ${sql.raw(`ARRAY[${(values as string[]).map((v) => `'${v}'`).join(",")}]`)}`;
			},
			eq: (col, values, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' = ${JSON.stringify(values)}::jsonb`;
			},
			isEmpty: (col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>'{${sql.raw(path)}}' = '[]'::jsonb OR ${col}#>'{${sql.raw(path)}}' IS NULL)`;
			},
			isNotEmpty: (col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>'{${sql.raw(path)}}' != '[]'::jsonb AND ${col}#>'{${sql.raw(path)}}' IS NOT NULL)`;
			},
			length: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`jsonb_array_length(${col}#>'{${sql.raw(path)}}') = ${value}`;
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
// Select Field Definition
// ============================================================================

// Cache for dynamically created enum types
const enumCache = new Map<string, any>();

/**
 * Select field factory.
 * Creates a select field with the given configuration.
 *
 * @example
 * ```ts
 * const status = selectField({
 *   options: [
 *     { value: "draft", label: "Draft" },
 *     { value: "published", label: "Published" },
 *     { value: "archived", label: "Archived" },
 *   ],
 *   required: true,
 * });
 *
 * const tags = selectField({
 *   options: [
 *     { value: "tech", label: "Technology" },
 *     { value: "news", label: "News" },
 *     { value: "sports", label: "Sports" },
 *   ],
 *   multiple: true,
 * });
 *
 * const priority = selectField({
 *   options: [
 *     { value: "low", label: "Low" },
 *     { value: "medium", label: "Medium" },
 *     { value: "high", label: "High" },
 *   ],
 *   enumType: true,
 *   enumName: "priority_enum",
 * });
 * ```
 */
export const selectField = defineField<
	"select",
	SelectFieldConfig,
	string | string[]
>("select", {
	toColumn(name, config) {
		const { multiple = false, enumType = false, enumName } = config;

		// Don't specify column name - Drizzle uses the key name
		let column: any;

		if (multiple) {
			// Multi-select: store as JSONB array
			column = jsonb();
		} else if (enumType) {
			// Single select with PostgreSQL enum
			const enumValues = config.options.map((o) => String(o.value)) as [
				string,
				...string[],
			];
			// Note: enum name uses field name for uniqueness, but column name is from key
			const finalEnumName = enumName ?? `${name}_enum`;

			// Create or get cached enum
			let enumDef = enumCache.get(finalEnumName);
			if (!enumDef) {
				enumDef = pgEnum(finalEnumName, enumValues);
				enumCache.set(finalEnumName, enumDef);
			}

			column = (enumDef as any)();
		} else {
			// Single select: store as varchar
			const maxLength = Math.max(
				...config.options.map((o) => String(o.value).length),
				50,
			);
			column = varchar({ length: maxLength });
		}

		// Apply constraints
		if (config.required && config.nullable !== true) {
			column = column.notNull();
		}
		if (config.default !== undefined) {
			const defaultValue =
				typeof config.default === "function"
					? config.default()
					: config.default;
			column = column.default(
				multiple ? JSON.stringify(defaultValue) : defaultValue,
			);
		}
		// NOTE: unique constraint removed from field level
		// Use .indexes() on collection builder instead

		return column;
	},

	toZodSchema(config) {
		const { multiple = false } = config;
		const validValues = config.options.map((o) => String(o.value));

		if (multiple) {
			// Multi-select: array of valid values
			const schema = z.array(z.enum(validValues as [string, ...string[]]));

			// Nullability
			if (!config.required && config.nullable !== false) {
				return schema.nullish();
			}

			return schema;
		} else {
			// Single select: one of valid values
			const schema = z.enum(validValues as [string, ...string[]]);

			// Nullability
			if (!config.required && config.nullable !== false) {
				return schema.nullish();
			}

			return schema;
		}
	},

	getOperators(config) {
		return config.multiple
			? getMultiSelectOperators()
			: getSingleSelectOperators();
	},

	getMetadata(config): SelectFieldMetadata {
		return {
			type: "select",
			label: config.label,
			description: config.description,
			required: config.required ?? false,
			localized: config.localized ?? false,
			readOnly: config.input === false,
			writeOnly: config.output === false,
			options: config.options.map((o) => ({
				value: o.value,
				label: o.label,
			})),
			multiple: config.multiple,
			meta: config.meta,
		};
	},
});

// Register in default registry
// Note: Cast needed because SelectFieldConfig has required options property
getDefaultRegistry().register("select", selectField as any);
