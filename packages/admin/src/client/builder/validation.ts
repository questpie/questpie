/**
 * Client-side Validation Schema Builder
 *
 * Generates Zod schemas from admin field configurations.
 * Uses createZod from field definitions for automatic schema generation.
 * Supports nested fields (object, array) via recursive schema building.
 */

import { z } from "zod";
import type { FieldDefinition, ZodBuildContext } from "./field/field";
import type { FieldValidationConfig } from "./types/field-types";

// ============================================================================
// Types
// ============================================================================

/**
 * Collection fields map (from admin config)
 */
type FieldsMap = Record<string, FieldDefinition>;

/**
 * Field registry type
 */
type FieldRegistry = Record<string, any>;

// ============================================================================
// Fallback Schema Builders (for fields without createZod)
// ============================================================================

/**
 * Build a string schema with validations (fallback)
 */
function buildStringSchema(validation?: FieldValidationConfig): z.ZodString {
  let schema = z.string();

  if (validation) {
    if (validation.minLength !== undefined) {
      schema = schema.min(
        validation.minLength,
        `Must be at least ${validation.minLength} characters`,
      );
    }
    if (validation.maxLength !== undefined) {
      schema = schema.max(
        validation.maxLength,
        `Must be at most ${validation.maxLength} characters`,
      );
    }
    if (validation.email) {
      schema = schema.email("Invalid email address");
    }
    if (validation.url) {
      schema = schema.url("Invalid URL");
    }
    if (validation.pattern) {
      const regex =
        typeof validation.pattern === "string"
          ? new RegExp(validation.pattern)
          : validation.pattern;
      schema = schema.regex(
        regex,
        validation.patternMessage || "Invalid format",
      );
    }
  }

  return schema;
}

/**
 * Build a number schema with validations (fallback)
 */
function buildNumberSchema(validation?: FieldValidationConfig): z.ZodNumber {
  let schema = z.number();

  if (validation) {
    if (validation.min !== undefined) {
      schema = schema.min(validation.min, `Must be at least ${validation.min}`);
    }
    if (validation.max !== undefined) {
      schema = schema.max(validation.max, `Must be at most ${validation.max}`);
    }
  }

  return schema;
}

/**
 * Fallback schema builder for fields without createZod
 */
function buildFallbackSchema(
  fieldType: string,
  required?: boolean,
  validation?: FieldValidationConfig,
): z.ZodTypeAny {
  let schema: z.ZodTypeAny;

  switch (fieldType) {
    case "text":
    case "textarea":
    case "email":
    case "password":
    case "slug":
    case "code":
    case "time":
      schema = buildStringSchema(validation);
      break;

    case "number":
    case "currency":
      schema = buildNumberSchema(validation);
      break;

    case "switch":
    case "checkbox":
      schema = z.boolean();
      break;

    case "date":
    case "datetime":
      schema = z.date().or(z.string());
      break;

    case "select":
      schema = z.string().or(z.number());
      break;

    case "relation":
      schema = z.string().or(z.array(z.string()));
      break;

    case "upload":
      schema = z.string();
      break;

    case "uploadMany":
      schema = z.array(z.string());
      break;

    case "array":
      schema = z.array(z.any());
      break;

    case "object":
      schema = z.record(z.string(), z.any());
      break;

    case "json":
    case "richText":
      schema = z.any();
      break;

    default:
      schema = z.any();
  }

  // Apply custom refinement from validation config
  if (validation?.refine) {
    schema = validation.refine(schema);
  }

  // Handle required/optional
  if (!required) {
    schema = schema.optional().nullable();
  }

  return schema;
}

// ============================================================================
// Main Schema Builder
// ============================================================================

/**
 * Creates the ZodBuildContext for recursive schema building
 */
function createBuildContext(registry: FieldRegistry): ZodBuildContext {
  const ctx: ZodBuildContext = {
    registry,
    buildSchema: (fieldDef: FieldDefinition): z.ZodTypeAny => {
      const opts = fieldDef["~options"] || {};

      // If field has createZod, use it
      if (fieldDef.createZod) {
        return fieldDef.createZod(opts, ctx);
      }

      // Fallback to generic schema based on field type name
      return buildFallbackSchema(fieldDef.name, opts.required, opts.validation);
    },
  };

  return ctx;
}

/**
 * Build a Zod schema from admin field definitions
 *
 * Uses createZod from each field definition if available,
 * otherwise falls back to generic schema based on field type.
 *
 * @param fields - Field definitions from admin collection config
 * @param registry - Field registry from admin builder
 * @returns Zod object schema for the collection
 *
 * @example
 * ```ts
 * const schema = buildValidationSchema(collectionConfig.fields, admin.getFields());
 *
 * // Use with react-hook-form
 * const form = useForm({
 *   resolver: zodResolver(schema),
 * });
 * ```
 */
export function buildValidationSchema(
  fields: FieldsMap,
  registry: FieldRegistry,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const ctx = createBuildContext(registry);
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [name, fieldDef] of Object.entries(fields)) {
    shape[name] = ctx.buildSchema(fieldDef);
  }

  return z.object(shape);
}

/**
 * Build validation schema with custom validation functions
 *
 * This version supports the `validate` callback in FieldValidationConfig
 * which receives form values for cross-field validation.
 *
 * @param fields - Field definitions from admin collection config
 * @param registry - Field registry from admin builder
 * @returns Zod schema with superRefine for custom validators
 */
export function buildValidationSchemaWithCustom(
  fields: FieldsMap,
  registry: FieldRegistry,
): z.ZodTypeAny {
  const baseSchema = buildValidationSchema(fields, registry);

  // Collect fields with custom validate functions
  const customValidators: Array<{
    name: string;
    validate: NonNullable<FieldValidationConfig["validate"]>;
  }> = [];

  for (const [name, fieldDef] of Object.entries(fields)) {
    const options = fieldDef["~options"] || {};
    if (options.validation?.validate) {
      customValidators.push({
        name,
        validate: options.validation.validate,
      });
    }
  }

  // If no custom validators, return base schema
  if (customValidators.length === 0) {
    return baseSchema;
  }

  // Apply custom validators via superRefine
  return baseSchema.superRefine((data, ctx) => {
    for (const { name, validate } of customValidators) {
      const error = validate(data[name], data);
      if (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: error,
          path: [name],
        });
      }
    }
  });
}

/**
 * Create a Zod validation schema from admin field config
 *
 * Use with @hookform/resolvers/zod for react-hook-form integration.
 *
 * @param fields - Field definitions from admin collection config
 * @param registry - Field registry from admin builder
 * @returns Zod schema for form validation
 *
 * @example
 * ```tsx
 * import { zodResolver } from "@hookform/resolvers/zod";
 * import { createFormSchema } from "@questpie/admin/builder";
 *
 * // From collection config
 * const schema = createFormSchema(collectionConfig.fields, admin.getFields());
 *
 * function MyForm() {
 *   const form = useForm({
 *     resolver: zodResolver(schema),
 *   });
 *   // ...
 * }
 *
 * // Or use the hook
 * import { useCollectionValidation } from "@questpie/admin/hooks";
 *
 * function MyCollectionForm() {
 *   const schema = useCollectionValidation("posts");
 *   const form = useForm({
 *     resolver: schema ? zodResolver(schema) : undefined,
 *   });
 * }
 * ```
 */
export function createFormSchema(
  fields: FieldsMap,
  registry: FieldRegistry,
): z.ZodTypeAny {
  return buildValidationSchemaWithCustom(fields, registry);
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type { ZodBuildContext } from "./field/field";
export { createFieldRegistryProxy as createRegistryProxy } from "./proxies";
