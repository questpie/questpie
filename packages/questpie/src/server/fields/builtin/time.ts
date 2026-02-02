/**
 * Time Field Type
 *
 * Time field for storing time of day (without date).
 * Supports precision and time operators.
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
import { time } from "drizzle-orm/pg-core";
import { z } from "zod";
import { defineField } from "../define-field.js";
import { getDefaultRegistry } from "../registry.js";
import type {
	BaseFieldConfig,
	ContextualOperators,
	FieldMetadataBase,
} from "../types.js";

// ============================================================================
// Time Field Meta (augmentable by admin)
// ============================================================================

/**
 * Time field metadata - augmentable by external packages.
 */
export type TimeFieldMeta = {};

// ============================================================================
// Time Field Configuration
// ============================================================================

/**
 * Time field configuration options.
 */
export interface TimeFieldConfig extends BaseFieldConfig {
	/** Field-specific metadata, augmentable by external packages. */
	meta?: TimeFieldMeta;
	/**
	 * Minimum time constraint (inclusive).
	 * Format: "HH:MM" or "HH:MM:SS"
	 */
	min?: string;

	/**
	 * Maximum time constraint (inclusive).
	 * Format: "HH:MM" or "HH:MM:SS"
	 */
	max?: string;

	/**
	 * Include seconds in the time.
	 * @default true
	 */
	withSeconds?: boolean;

	/**
	 * Time precision (0-6 fractional seconds digits).
	 * @default 0
	 */
	precision?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

// ============================================================================
// Time Field Operators
// ============================================================================

/**
 * Get operators for time field.
 * Supports both column and JSONB path access.
 */
function getTimeOperators(): ContextualOperators {
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
				return sql`(${col}#>>'{${sql.raw(path)}}')::time = ${value}::time`;
			},
			ne: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::time != ${value}::time`;
			},
			gt: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::time > ${value}::time`;
			},
			gte: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::time >= ${value}::time`;
			},
			lt: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::time < ${value}::time`;
			},
			lte: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::time <= ${value}::time`;
			},
			between: (col, value, ctx) => {
				const [min, max] = value as [string, string];
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>>'{${sql.raw(path)}}')::time BETWEEN ${min}::time AND ${max}::time`;
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
// Time Field Definition
// ============================================================================

/**
 * Time field factory.
 * Creates a time field with the given configuration.
 *
 * @example
 * ```ts
 * const openingTime = timeField({ min: "09:00", max: "18:00" });
 * const scheduledTime = timeField({ precision: 3 }); // With milliseconds
 * const startTime = timeField({ required: true });
 * ```
 */
export const timeField = defineField<"time", TimeFieldConfig, string>("time", {
	toColumn(name, config) {
		const { precision = 0 } = config;

		let column: any = time(name, { precision });

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

	toZodSchema(config) {
		// Time format: HH:MM or HH:MM:SS
		const withSeconds = config.withSeconds !== false;
		const timePattern = withSeconds
			? /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d+)?$/
			: /^([01]\d|2[0-3]):([0-5]\d)$/;

		let schema = z.string().regex(timePattern, {
			message: withSeconds
				? "Invalid time format. Expected HH:MM:SS"
				: "Invalid time format. Expected HH:MM",
		});

		// Min/max constraints (string comparison works for time)
		if (config.min) {
			schema = schema.refine((val) => val >= config.min!, {
				message: `Time must be at or after ${config.min}`,
			});
		}
		if (config.max) {
			schema = schema.refine((val) => val <= config.max!, {
				message: `Time must be at or before ${config.max}`,
			});
		}

		// Nullability
		if (!config.required && config.nullable !== false) {
			return schema.nullish();
		}

		return schema;
	},

	getOperators() {
		return getTimeOperators();
	},

	getMetadata(config): FieldMetadataBase {
		return {
			type: "time",
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
getDefaultRegistry().register("time", timeField);
