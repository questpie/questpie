/**
 * Date Field Type
 *
 * Date field for storing dates (without time).
 * Supports min/max constraints and date operators.
 */

import { between, eq, gt, gte, lt, lte, ne, sql } from "drizzle-orm";
import { date } from "drizzle-orm/pg-core";
import { z } from "zod";
import { field } from "../field.js";
import type { BaseFieldConfig, FieldMetadataBase } from "../types.js";
import { operator } from "../types.js";

// ============================================================================
// Date Field Meta (augmentable by admin)
// ============================================================================

/**
 * Date field metadata - augmentable by external packages.
 */
export interface DateFieldMeta {
  /** Phantom property to prevent interface collapse - enables module augmentation */
  _?: never;
}

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
function getDateOperators() {
  return {
    column: {
      eq: operator<string, unknown>((col, value) => eq(col, value)),
      ne: operator<string, unknown>((col, value) => ne(col, value)),
      gt: operator<string, unknown>((col, value) => gt(col, value)),
      gte: operator<string, unknown>((col, value) => gte(col, value)),
      lt: operator<string, unknown>((col, value) => lt(col, value)),
      lte: operator<string, unknown>((col, value) => lte(col, value)),
      between: operator<[string, string], unknown>((col, value) =>
        between(col, value[0], value[1]),
      ),
      before: operator<string, unknown>((col, value) => lt(col, value)),
      after: operator<string, unknown>((col, value) => gt(col, value)),
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
        return sql`(${col}#>>'{${sql.raw(path)}}')::date = ${value}::date`;
      }),
      ne: operator<string, unknown>((col, value, ctx) => {
        const path = ctx.jsonbPath?.join(",") ?? "";
        return sql`(${col}#>>'{${sql.raw(path)}}')::date != ${value}::date`;
      }),
      gt: operator<string, unknown>((col, value, ctx) => {
        const path = ctx.jsonbPath?.join(",") ?? "";
        return sql`(${col}#>>'{${sql.raw(path)}}')::date > ${value}::date`;
      }),
      gte: operator<string, unknown>((col, value, ctx) => {
        const path = ctx.jsonbPath?.join(",") ?? "";
        return sql`(${col}#>>'{${sql.raw(path)}}')::date >= ${value}::date`;
      }),
      lt: operator<string, unknown>((col, value, ctx) => {
        const path = ctx.jsonbPath?.join(",") ?? "";
        return sql`(${col}#>>'{${sql.raw(path)}}')::date < ${value}::date`;
      }),
      lte: operator<string, unknown>((col, value, ctx) => {
        const path = ctx.jsonbPath?.join(",") ?? "";
        return sql`(${col}#>>'{${sql.raw(path)}}')::date <= ${value}::date`;
      }),
      between: operator<[string, string], unknown>((col, value, ctx) => {
        const path = ctx.jsonbPath?.join(",") ?? "";
        return sql`(${col}#>>'{${sql.raw(path)}}')::date BETWEEN ${value[0]}::date AND ${value[1]}::date`;
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
export const dateField = field<DateFieldConfig, string>()({
  type: "date" as const,
  _value: undefined as unknown as string,
  toColumn(name: string, config: DateFieldConfig) {
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

  toZodSchema(config: DateFieldConfig) {
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

  getOperators<TApp>() {
    return getDateOperators();
  },

  getMetadata(config: DateFieldConfig): FieldMetadataBase & {
    min?: string;
    max?: string;
  } {
    // Convert Date objects to ISO strings for metadata
    const minDate = config.min
      ? typeof config.min === "string"
        ? config.min
        : config.min.toISOString().split("T")[0]
      : undefined;
    const maxDate = config.max
      ? typeof config.max === "string"
        ? config.max
        : config.max.toISOString().split("T")[0]
      : undefined;

    return {
      type: "date",
      label: config.label,
      description: config.description,
      required: config.required ?? false,
      localized: config.localized ?? false,
      readOnly: config.input === false,
      writeOnly: config.output === false,
      meta: config.meta,
      // Date-specific constraints for admin UI
      min: minDate,
      max: maxDate,
    };
  },
});

// Register in default registry
