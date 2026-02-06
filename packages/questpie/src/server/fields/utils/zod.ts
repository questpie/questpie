/**
 * Zod Schema Helpers for Field Definitions
 *
 * Utility functions for creating Zod schemas from field configurations.
 */

import { z, type ZodType } from "zod";

/**
 * Apply nullability to a Zod schema based on field configuration.
 *
 * @param schema - The base Zod schema
 * @param required - Whether the field is required
 * @param nullable - Whether the field can be null (defaults to !required)
 * @returns Schema with appropriate nullability
 */
export function applyNullability<T extends ZodType>(
  schema: T,
  required?: boolean,
  nullable?: boolean,
): ZodType {
  // If explicitly nullable, make it nullable
  if (nullable === true) {
    return schema.nullable();
  }

  // If required, don't add nullability
  if (required) {
    return schema;
  }

  // If explicitly not nullable, keep as is
  if (nullable === false) {
    return schema;
  }

  // Default: not required means nullish (null | undefined)
  return schema.nullish();
}

/**
 * Create a string schema with common field validations.
 *
 * @param options - Validation options
 * @returns Configured Zod string schema
 */
export function createStringSchema(options: {
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp | string;
  trim?: boolean;
  lowercase?: boolean;
  uppercase?: boolean;
  required?: boolean;
  nullable?: boolean;
}): ZodType {
  let schema = z.string();

  if (options.minLength !== undefined) {
    schema = schema.min(options.minLength);
  }
  if (options.maxLength !== undefined) {
    schema = schema.max(options.maxLength);
  }
  if (options.pattern) {
    const regex =
      typeof options.pattern === "string"
        ? new RegExp(options.pattern)
        : options.pattern;
    schema = schema.regex(regex);
  }
  if (options.trim) {
    schema = schema.trim();
  }
  if (options.lowercase) {
    schema = schema.toLowerCase();
  }
  if (options.uppercase) {
    schema = schema.toUpperCase();
  }

  return applyNullability(schema, options.required, options.nullable);
}

/**
 * Create a number schema with common field validations.
 *
 * @param options - Validation options
 * @returns Configured Zod number schema
 */
export function createNumberSchema(options: {
  min?: number;
  max?: number;
  int?: boolean;
  positive?: boolean;
  negative?: boolean;
  multipleOf?: number;
  required?: boolean;
  nullable?: boolean;
}): ZodType {
  let schema = z.number();

  if (options.int) {
    schema = schema.int();
  }
  if (options.min !== undefined) {
    schema = schema.min(options.min);
  }
  if (options.max !== undefined) {
    schema = schema.max(options.max);
  }
  if (options.positive) {
    schema = schema.positive();
  }
  if (options.negative) {
    schema = schema.negative();
  }
  if (options.multipleOf !== undefined) {
    schema = schema.multipleOf(options.multipleOf);
  }

  return applyNullability(schema, options.required, options.nullable);
}

/**
 * Create a boolean schema.
 *
 * @param options - Validation options
 * @returns Configured Zod boolean schema
 */
export function createBooleanSchema(options: {
  required?: boolean;
  nullable?: boolean;
}): ZodType {
  const schema = z.boolean();
  return applyNullability(schema, options.required, options.nullable);
}

/**
 * Create a date schema with common validations.
 *
 * @param options - Validation options
 * @returns Configured Zod date schema
 */
export function createDateSchema(options: {
  min?: Date;
  max?: Date;
  required?: boolean;
  nullable?: boolean;
}): ZodType {
  let schema = z.date();

  if (options.min) {
    schema = schema.min(options.min);
  }
  if (options.max) {
    schema = schema.max(options.max);
  }

  return applyNullability(schema, options.required, options.nullable);
}

/**
 * Create an enum schema from select options.
 *
 * @param options - Array of option values
 * @param config - Schema configuration
 * @returns Configured Zod enum schema
 */
export function createEnumSchema<T extends string>(
  options: readonly [T, ...T[]],
  config: {
    required?: boolean;
    nullable?: boolean;
  },
): ZodType {
  const schema = z.enum(options);
  return applyNullability(schema, config.required, config.nullable);
}

/**
 * Create an array schema with item validation.
 *
 * @param itemSchema - Schema for array items
 * @param options - Array validation options
 * @returns Configured Zod array schema
 */
export function createArraySchema(
  itemSchema: ZodType,
  options: {
    minItems?: number;
    maxItems?: number;
    required?: boolean;
    nullable?: boolean;
  },
): ZodType {
  let schema = z.array(itemSchema);

  if (options.minItems !== undefined) {
    schema = schema.min(options.minItems);
  }
  if (options.maxItems !== undefined) {
    schema = schema.max(options.maxItems);
  }

  return applyNullability(schema, options.required, options.nullable);
}
