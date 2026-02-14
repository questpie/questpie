/**
 * Time Field Type
 *
 * Time field for storing time of day (without date).
 * Supports precision and time operators.
 */

import { between, eq, gt, gte, lt, lte, ne, sql } from "drizzle-orm";
import { time } from "drizzle-orm/pg-core";
import { z } from "zod";
import { field } from "../field.js";
import type { BaseFieldConfig, FieldMetadataBase } from "../types.js";
import { operator } from "../types.js";

// ============================================================================
// Time Field Meta (augmentable by admin)
// ============================================================================

/**
 * Time field metadata - augmentable by external packages.
 */
export interface TimeFieldMeta {
  /** Phantom property to prevent interface collapse - enables module augmentation */
  _?: never;
}

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
function getTimeOperators() {
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
        return sql`(${col}#>>'{${sql.raw(path)}}')::time = ${value}::time`;
      }),
      ne: operator<string, unknown>((col, value, ctx) => {
        const path = ctx.jsonbPath?.join(",") ?? "";
        return sql`(${col}#>>'{${sql.raw(path)}}')::time != ${value}::time`;
      }),
      gt: operator<string, unknown>((col, value, ctx) => {
        const path = ctx.jsonbPath?.join(",") ?? "";
        return sql`(${col}#>>'{${sql.raw(path)}}')::time > ${value}::time`;
      }),
      gte: operator<string, unknown>((col, value, ctx) => {
        const path = ctx.jsonbPath?.join(",") ?? "";
        return sql`(${col}#>>'{${sql.raw(path)}}')::time >= ${value}::time`;
      }),
      lt: operator<string, unknown>((col, value, ctx) => {
        const path = ctx.jsonbPath?.join(",") ?? "";
        return sql`(${col}#>>'{${sql.raw(path)}}')::time < ${value}::time`;
      }),
      lte: operator<string, unknown>((col, value, ctx) => {
        const path = ctx.jsonbPath?.join(",") ?? "";
        return sql`(${col}#>>'{${sql.raw(path)}}')::time <= ${value}::time`;
      }),
      between: operator<[string, string], unknown>((col, value, ctx) => {
        const path = ctx.jsonbPath?.join(",") ?? "";
        return sql`(${col}#>>'{${sql.raw(path)}}')::time BETWEEN ${value[0]}::time AND ${value[1]}::time`;
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
export const timeField = field<TimeFieldConfig, string>()({
  type: "time" as const,
  _value: undefined as unknown as string,
  toColumn(name: string, config: TimeFieldConfig) {
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

  toZodSchema(config: TimeFieldConfig) {
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

  getOperators<TApp>() {
    return getTimeOperators();
  },

  getMetadata(config: TimeFieldConfig): FieldMetadataBase & {
    min?: string;
    max?: string;
    withSeconds?: boolean;
    precision?: number;
  } {
    return {
      type: "time",
      label: config.label,
      description: config.description,
      required: config.required ?? false,
      localized: config.localized ?? false,
      readOnly: config.input === false,
      writeOnly: config.output === false,
      meta: config.meta,
      // Time-specific constraints for admin UI
      min: config.min,
      max: config.max,
      withSeconds: config.withSeconds,
      precision: config.precision,
    };
  },
});

// Register in default registry
