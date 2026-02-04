/**
 * Select Field Type
 *
 * Enumeration field for selecting from predefined options.
 * Supports single and multiple selection, enum types, and option labels.
 */

import { eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { jsonb, pgEnum, varchar } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { I18nText } from "#questpie/shared/i18n/types.js";
import { defineField } from "../define-field.js";
import type { BaseFieldConfig, SelectFieldMetadata } from "../types.js";
import { operator } from "../types.js";

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
export interface SelectFieldMeta {
	/** Phantom property to prevent interface collapse - enables module augmentation */
	_?: never;
}

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
function getSingleSelectOperators() {
	return {
		column: {
			eq: operator<string, unknown>((col, value) => eq(col, value)),
			ne: operator<string, unknown>((col, value) => ne(col, value)),
			in: operator<string[], unknown>((col, values) => inArray(col, values)),
			notIn: operator<string[], unknown>((col, values) =>
				notInArray(col, values),
			),
			isNull: operator<boolean, unknown>((col, value) =>
				value ? sql`${col} IS NULL` : sql`${col} IS NOT NULL`,
			),
			isNotNull: operator<boolean, unknown>((col, value) =>
				value ? sql`${col} IS NOT NULL` : sql`${col} IS NULL`,
			),
		},
		jsonb: {
			eq: operator<string, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>>'{${sql.raw(path)}}' = ${value}`;
			}),
			ne: operator<string, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>>'{${sql.raw(path)}}' != ${value}`;
			}),
			in: operator<string[], unknown>((col, values, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>>'{${sql.raw(path)}}' = ANY(${values}::text[])`;
			}),
			notIn: operator<string[], unknown>((col, values, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`NOT (${col}#>>'{${sql.raw(path)}}' = ANY(${values}::text[]))`;
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

/**
 * Get operators for multi-select field.
 */
function getMultiSelectOperators() {
	return {
		column: {
			// Contains all specified values
			containsAll: operator<string[], unknown>(
				(col, values) => sql`${col} @> ${JSON.stringify(values)}::jsonb`,
			),
			// Contains any of specified values
			containsAny: operator<string[], unknown>(
				(col, values) =>
					sql`${col} ?| ${sql.raw(`ARRAY[${values.map((v) => `'${v}'`).join(",")}]`)}`,
			),
			// Exactly equals (same values, same order)
			eq: operator<string[], unknown>(
				(col, values) => sql`${col} = ${JSON.stringify(values)}::jsonb`,
			),
			// Is empty array
			isEmpty: operator<boolean, unknown>(
				(col) => sql`${col} = '[]'::jsonb OR ${col} IS NULL`,
			),
			// Is not empty
			isNotEmpty: operator<boolean, unknown>(
				(col) => sql`${col} != '[]'::jsonb AND ${col} IS NOT NULL`,
			),
			// Length equals
			length: operator<number, unknown>(
				(col, value) => sql`jsonb_array_length(${col}) = ${value}`,
			),
			isNull: operator<boolean, unknown>((col, value) =>
				value ? sql`${col} IS NULL` : sql`${col} IS NOT NULL`,
			),
			isNotNull: operator<boolean, unknown>((col, value) =>
				value ? sql`${col} IS NOT NULL` : sql`${col} IS NULL`,
			),
		},
		jsonb: {
			containsAll: operator<string[], unknown>((col, values, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' @> ${JSON.stringify(values)}::jsonb`;
			}),
			containsAny: operator<string[], unknown>((col, values, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' ?| ${sql.raw(`ARRAY[${values.map((v) => `'${v}'`).join(",")}]`)}`;
			}),
			eq: operator<string[], unknown>((col, values, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' = ${JSON.stringify(values)}::jsonb`;
			}),
			isEmpty: operator<boolean, unknown>((col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>'{${sql.raw(path)}}' = '[]'::jsonb OR ${col}#>'{${sql.raw(path)}}' IS NULL)`;
			}),
			isNotEmpty: operator<boolean, unknown>((col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>'{${sql.raw(path)}}' != '[]'::jsonb AND ${col}#>'{${sql.raw(path)}}' IS NOT NULL)`;
			}),
			length: operator<number, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`jsonb_array_length(${col}#>'{${sql.raw(path)}}') = ${value}`;
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
export const selectField = defineField<SelectFieldConfig, string | string[]>()({
	type: "select" as const,
	_value: undefined as unknown as string | string[],
	toColumn(name: string, config: SelectFieldConfig) {
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

	toZodSchema(config: SelectFieldConfig) {
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

	getOperators<TApp>(config: SelectFieldConfig) {
		return config.multiple
			? getMultiSelectOperators()
			: getSingleSelectOperators();
	},

	getMetadata(config: SelectFieldConfig): SelectFieldMetadata {
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
// SelectFieldConfig is now compatible with AnyFieldDefinition (no cast needed)
