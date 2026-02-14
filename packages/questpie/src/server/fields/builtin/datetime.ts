/**
 * Datetime Field Type
 *
 * Timestamp field for storing date and time.
 * Supports timezone, precision, auto-now on create/update.
 */

import { between, eq, gt, gte, lt, lte, ne, sql } from "drizzle-orm";
import { timestamp } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { DateInput } from "#questpie/shared/type-utils.js";
import { field } from "../field.js";
import type { BaseFieldConfig, FieldMetadataBase } from "../types.js";
import { operator } from "../types.js";

// ============================================================================
// Datetime Field Meta (augmentable by admin)
// ============================================================================

/**
 * Datetime field metadata - augmentable by external packages.
 */
export interface DatetimeFieldMeta {
	/** Phantom property to prevent interface collapse - enables module augmentation */
	_?: never;
}

// ============================================================================
// Datetime Field Configuration
// ============================================================================

/**
 * Datetime field configuration options.
 */
export interface DatetimeFieldConfig extends BaseFieldConfig {
	/** Field-specific metadata, augmentable by external packages. */
	meta?: DatetimeFieldMeta;
	/**
	 * Minimum datetime constraint (inclusive).
	 * Can be a Date object or ISO datetime string.
	 */
	min?: Date | string;

	/**
	 * Maximum datetime constraint (inclusive).
	 * Can be a Date object or ISO datetime string.
	 */
	max?: Date | string;

	/**
	 * Auto-set to current datetime on create.
	 */
	autoNow?: boolean;

	/**
	 * Auto-update to current datetime on every update.
	 * Note: This is applied via hooks, not DB default.
	 */
	autoNowUpdate?: boolean;

	/**
	 * Timestamp precision (0-6 fractional seconds digits).
	 * @default 3 (milliseconds)
	 */
	precision?: 0 | 1 | 2 | 3 | 4 | 5 | 6;

	/**
	 * Store with timezone information.
	 * @default true
	 */
	withTimezone?: boolean;
}

// ============================================================================
// Datetime Field Operators
// ============================================================================

/**
 * Get operators for datetime field.
 * Supports both column and JSONB path access.
 */
function getDatetimeOperators() {
	return {
		column: {
			eq: operator<DateInput, unknown>((col, value) =>
				eq(col, new Date(value as string)),
			),
			ne: operator<DateInput, unknown>((col, value) =>
				ne(col, new Date(value as string)),
			),
			gt: operator<DateInput, unknown>((col, value) =>
				gt(col, new Date(value as string)),
			),
			gte: operator<DateInput, unknown>((col, value) =>
				gte(col, new Date(value as string)),
			),
			lt: operator<DateInput, unknown>((col, value) =>
				lt(col, new Date(value as string)),
			),
			lte: operator<DateInput, unknown>((col, value) =>
				lte(col, new Date(value as string)),
			),
			between: operator<[DateInput, DateInput], unknown>((col, value) =>
				between(
					col,
					new Date(value[0] as string),
					new Date(value[1] as string),
				),
			),
			before: operator<DateInput, unknown>((col, value) =>
				lt(col, new Date(value as string)),
			),
			after: operator<DateInput, unknown>((col, value) =>
				gt(col, new Date(value as string)),
			),
			isNull: operator<boolean, unknown>((col, value) =>
				value ? sql`${col} IS NULL` : sql`${col} IS NOT NULL`,
			),
			isNotNull: operator<boolean, unknown>((col, value) =>
				value ? sql`${col} IS NOT NULL` : sql`${col} IS NULL`,
			),
		},
		jsonb: {
			eq: operator<DateInput, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::timestamptz = ${value}::timestamptz`;
			}),
			ne: operator<DateInput, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::timestamptz != ${value}::timestamptz`;
			}),
			gt: operator<DateInput, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::timestamptz > ${value}::timestamptz`;
			}),
			gte: operator<DateInput, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::timestamptz >= ${value}::timestamptz`;
			}),
			lt: operator<DateInput, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::timestamptz < ${value}::timestamptz`;
			}),
			lte: operator<DateInput, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::timestamptz <= ${value}::timestamptz`;
			}),
			between: operator<[DateInput, DateInput], unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::timestamptz BETWEEN ${value[0]}::timestamptz AND ${value[1]}::timestamptz`;
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
// Datetime Field Definition
// ============================================================================

/**
 * Datetime field factory.
 * Creates a datetime (timestamp) field with the given configuration.
 *
 * @example
 * ```ts
 * const createdAt = datetimeField({ autoNow: true, input: false });
 * const updatedAt = datetimeField({ autoNowUpdate: true, input: false });
 * const publishedAt = datetimeField({ min: new Date() });
 * const eventTime = datetimeField({ precision: 0 }); // No fractional seconds
 * ```
 */
export const datetimeField = field<DatetimeFieldConfig, Date>()({
	type: "datetime" as const,
	_value: undefined as unknown as Date,
	toColumn(name: string, config: DatetimeFieldConfig) {
		const { precision = 3, withTimezone = true } = config;

		let column: any = timestamp(name, {
			precision,
			withTimezone,
			mode: "date",
		});

		// Apply constraints
		if (config.required && config.nullable !== true) {
			column = column.notNull();
		}

		// Default value
		if (config.autoNow) {
			column = column.defaultNow();
		} else if (config.default !== undefined) {
			const defaultValue =
				typeof config.default === "function"
					? config.default()
					: config.default;
			column = column.default(defaultValue as Date);
		}
		// NOTE: unique constraint removed from field level
		// Use .indexes() on collection builder instead

		return column;
	},

	toZodSchema(config: DatetimeFieldConfig) {
		// Accept string or Date, coerce to Date
		let schema = z.coerce.date();

		// Min/max constraints
		if (config.min) {
			const minDate =
				typeof config.min === "string" ? new Date(config.min) : config.min;
			schema = schema.min(minDate);
		}
		if (config.max) {
			const maxDate =
				typeof config.max === "string" ? new Date(config.max) : config.max;
			schema = schema.max(maxDate);
		}

		// Nullability
		if (!config.required && config.nullable !== false) {
			return schema.nullish();
		}

		return schema;
	},

	getOperators<TApp>() {
		return getDatetimeOperators();
	},

	getMetadata(config: DatetimeFieldConfig): FieldMetadataBase & {
		min?: string;
		max?: string;
		precision?: number;
		withTimezone?: boolean;
	} {
		// Convert Date objects to ISO strings for metadata
		const minDate = config.min
			? typeof config.min === "string"
				? config.min
				: config.min.toISOString()
			: undefined;
		const maxDate = config.max
			? typeof config.max === "string"
				? config.max
				: config.max.toISOString()
			: undefined;

		return {
			type: "datetime",
			label: config.label,
			description: config.description,
			required: config.required ?? false,
			localized: config.localized ?? false,
			readOnly: config.input === false,
			writeOnly: config.output === false,
			meta: config.meta,
			// Datetime-specific constraints for admin UI
			min: minDate,
			max: maxDate,
			precision: config.precision,
			withTimezone: config.withTimezone,
		};
	},
});

// Register in default registry
