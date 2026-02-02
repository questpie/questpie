/**
 * Date Field Type
 *
 * Date field for storing dates (without time).
 * Supports min/max constraints and date operators.
 */

import {
	between,
	eq,
	gt,
	gte,
	isNotNull,
	isNull,
	lt,
	lte,
	ne,
	sql,
} from "drizzle-orm";
import { date } from "drizzle-orm/pg-core";
import { z } from "zod";
import { defineField } from "../define-field.js";
import { getDefaultRegistry } from "../registry.js";
import type {
	BaseFieldConfig,
	ContextualOperators,
	FieldMetadataBase,
} from "../types.js";

// ============================================================================
// Date Field Meta (augmentable by admin)
// ============================================================================

/**
 * Date field metadata - augmentable by external packages.
 */
export type DateFieldMeta = {};

// ============================================================================
// Date Field Configuration
// ============================================================================

/**
 * Date field configuration options.
 */
export interface DateFieldConfig extends BaseFieldConfig {
	/** Field-specific metadata, augmentable by external packages. */
	meta?: DateFieldMeta;
	/**
	 * Minimum date constraint (inclusive).
	 * Can be a Date object or ISO date string.
	 */
	min?: Date | string;

	/**
	 * Maximum date constraint (inclusive).
	 * Can be a Date object or ISO date string.
	 */
	max?: Date | string;

	/**
	 * Auto-set to current date on create.
	 */
	autoNow?: boolean;
}

// ============================================================================
// Date Field Operators
// ============================================================================

/**
 * Get operators for date field.
 * Supports both column and JSONB path access.
 */
function getDateOperators(): ContextualOperators {
	return {
		column: {
			eq: (col, value) => eq(col, value as string),
			ne: (col, value) => ne(col, value as string),
			gt: (col, value) => gt(col, value as string),
			gte: (col, value) => gte(col, value as string),
			lt: (col, value) => lt(col, value as string),
			lte: (col, value) => lte(col, value as string),
			between: (col, value) => {
				const [min, max] = value as [string, string];
				return between(col, min, max);
			},
			before: (col, value) => lt(col, value as string),
			after: (col, value) => gt(col, value as string),
			isNull: (col) => isNull(col),
			isNotNull: (col) => isNotNull(col),
		},
		jsonb: {
			eq: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::date = ${value}::date`;
			},
			ne: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::date != ${value}::date`;
			},
			gt: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::date > ${value}::date`;
			},
			gte: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::date >= ${value}::date`;
			},
			lt: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::date < ${value}::date`;
			},
			lte: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::date <= ${value}::date`;
			},
			between: (col, value, ctx) => {
				const [min, max] = value as [string, string];
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::date BETWEEN ${min}::date AND ${max}::date`;
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
// Date Field Definition
// ============================================================================

/**
 * Date field factory.
 * Creates a date field with the given configuration.
 *
 * @example
 * ```ts
 * const birthDate = dateField({ required: true });
 * const startDate = dateField({ min: "2024-01-01" });
 * const createdAt = dateField({ autoNow: true, input: false });
 * ```
 */
export const dateField = defineField<"date", DateFieldConfig, string>("date", {
	toColumn(name, config) {
		let column: any = date(name, { mode: "string" });

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
			column = column.default(defaultValue as string);
		}
		// NOTE: unique constraint removed from field level
		// Use .indexes() on collection builder instead

		return column;
	},

	toZodSchema(config) {
		// Use string for date in ISO format (YYYY-MM-DD)
		let schema = z.string().date();

		// Min/max constraints (use refine since .min/.max on string().date() is for length)
		if (config.min) {
			const minDate =
				typeof config.min === "string"
					? config.min
					: config.min.toISOString().split("T")[0];
			schema = schema.refine((val) => val >= minDate, {
				message: `Date must be on or after ${minDate}`,
			}) as unknown as typeof schema;
		}
		if (config.max) {
			const maxDate =
				typeof config.max === "string"
					? config.max
					: config.max.toISOString().split("T")[0];
			schema = schema.refine((val) => val <= maxDate, {
				message: `Date must be on or before ${maxDate}`,
			}) as unknown as typeof schema;
		}

		// Nullability
		if (!config.required && config.nullable !== false) {
			return schema.nullish();
		}

		return schema;
	},

	getOperators() {
		return getDateOperators();
	},

	getMetadata(config): FieldMetadataBase {
		return {
			type: "date",
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
getDefaultRegistry().register("date", dateField);
