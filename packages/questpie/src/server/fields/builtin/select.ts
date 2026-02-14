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
import { field } from "../field.js";
import type { OptionsConfig } from "../reactive.js";
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
	 *
	 * Can be static array of options or dynamic OptionsConfig handler.
	 *
	 * @example Static options
	 * ```ts
	 * options: [
	 *   { value: 'draft', label: 'Draft' },
	 *   { value: 'published', label: 'Published' },
	 * ]
	 * ```
	 *
	 * @example Dynamic options
	 * ```ts
	 * options: {
	 *   handler: async ({ data, search, page, limit, ctx }) => {
	 *     const results = await ctx.db.query.statuses.findMany({
	 *       where: { category: data.category },
	 *       limit,
	 *       offset: page * limit,
	 *     });
	 *     return {
	 *       options: results.map(r => ({ value: r.id, label: r.name })),
	 *       hasMore: results.length === limit,
	 *     };
	 *   },
	 *   deps: ({ data }) => [data.category],
	 * }
	 * ```
	 */
	options: readonly SelectOption[] | OptionsConfig;

	/**
	 * Allow multiple selections.
	 * When true, value is stored as JSONB array.
	 * @default false
	 */
	multiple?: boolean;

	/**
	 * Use PostgreSQL enum type for storage.
	 * More efficient but requires migration for changes.
	 * Only works with static options (not OptionsConfig).
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
// Helper Functions
// ============================================================================

/**
 * Check if options is a static array (not OptionsConfig).
 */
function isStaticOptions(
	options: readonly SelectOption[] | OptionsConfig,
): options is readonly SelectOption[] {
	return Array.isArray(options);
}

/**
 * Get static options from config, or empty array if dynamic.
 */
function getStaticOptions(
	options: readonly SelectOption[] | OptionsConfig,
): readonly SelectOption[] {
	return isStaticOptions(options) ? options : [];
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
					sql`${col} ?| ARRAY[${sql.join(
						values.map((v) => sql`${v}`),
						sql`, `,
					)}]::text[]`,
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
				return sql`${col}#>'{${sql.raw(path)}}' ?| ARRAY[${sql.join(
					values.map((v) => sql`${v}`),
					sql`, `,
				)}]::text[]`;
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
export const selectField = field<SelectFieldConfig, string | string[]>()({
	type: "select" as const,
	_value: undefined as unknown as string | string[],
	toColumn(name: string, config: SelectFieldConfig) {
		const { multiple = false, enumType = false, enumName } = config;
		const staticOptions = getStaticOptions(config.options);

		let column: any;

		if (multiple) {
			// Multi-select: store as JSONB array
			column = jsonb(name);
		} else if (enumType && staticOptions.length > 0) {
			// Single select with PostgreSQL enum (only for static options)
			const enumValues = staticOptions.map((o) => String(o.value)) as [
				string,
				...string[],
			];
			const finalEnumName = enumName ?? `${name}_enum`;

			// Create or get cached enum
			let enumDef = enumCache.get(finalEnumName);
			if (!enumDef) {
				enumDef = pgEnum(finalEnumName, enumValues);
				enumCache.set(finalEnumName, enumDef);
			}

			column = (enumDef as any)(name);
		} else {
			// Single select: store as varchar
			// For dynamic options, use a reasonable max length
			const maxLength =
				staticOptions.length > 0
					? Math.max(...staticOptions.map((o) => String(o.value).length), 50)
					: 255; // Default for dynamic options
			column = varchar(name, { length: maxLength });
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
		const staticOptions = getStaticOptions(config.options);

		// For dynamic options, allow any string value
		// Server-side validation will verify against actual options
		if (!isStaticOptions(config.options)) {
			if (multiple) {
				const schema = z.array(z.string());
				if (!config.required && config.nullable !== false) {
					return schema.nullish();
				}
				return schema;
			} else {
				const schema = z.string();
				if (!config.required && config.nullable !== false) {
					return schema.nullish();
				}
				return schema;
			}
		}

		const validValues = staticOptions.map((o) => String(o.value));

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
		const staticOptions = getStaticOptions(config.options);
		// For dynamic options, we don't include options in metadata
		// The client fetches them via the /options endpoint
		const hasDynamicOptions = !isStaticOptions(config.options);

		return {
			type: "select",
			label: config.label,
			description: config.description,
			required: config.required ?? false,
			localized: config.localized ?? false,
			readOnly: config.input === false,
			writeOnly: config.output === false,
			// Only include static options in metadata
			options: hasDynamicOptions
				? []
				: staticOptions.map((o) => ({
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
