/**
 * Field-Based Schema Builder
 *
 * Builds Zod validation schemas directly from field definitions.
 * This is the source-of-truth approach: fields define their own schemas,
 * and we compose them into collection-level input/update schemas.
 *
 * Key benefits:
 * - Uses field names (author), not FK column names (authorId)
 * - Each field's toZodSchema() defines its validation rules
 * - Relation fields produce schemas matching TypeScript types
 * - No reverse-engineering from Drizzle columns
 */

import { z } from "zod";
import type {
  FieldDefinition,
  FieldDefinitionState,
  RelationFieldMetadata,
} from "#questpie/server/fields/types.js";

// ============================================================================
// Schema Building
// ============================================================================

/**
 * Build a Zod input schema from field definitions.
 *
 * Creates a schema where:
 * - Each field uses its own toZodSchema() for validation
 * - Field names are used (author), not FK column names (authorId)
 * - Relation fields accept string IDs or nested mutation objects
 *
 * @param fieldDefinitions - Collection field definitions
 * @param mode - "insert" for create, "update" for partial updates
 * @returns Zod schema for input validation
 */
export function buildFieldBasedSchema(
  fieldDefinitions: Record<string, FieldDefinition<FieldDefinitionState>>,
  mode: "insert" | "update" = "insert",
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [fieldName, fieldDef] of Object.entries(fieldDefinitions)) {
    // Skip fields that don't accept input
    if (fieldDef.state.input === false) {
      continue;
    }

    // Get the field's own schema
    let fieldSchema = fieldDef.toZodSchema();

    // For update mode, make all fields optional
    if (mode === "update") {
      fieldSchema = fieldSchema.optional();
    }

    // For insert mode with optional input, make the field optional
    if (mode === "insert" && fieldDef.state.input === "optional") {
      fieldSchema = fieldSchema.optional();
    }

    shape[fieldName] = fieldSchema;
  }

  return z.object(shape);
}

/**
 * Extend a schema to also accept nested relation mutations.
 *
 * For relation fields, this adds support for:
 * - Simple ID: `author: "user-uuid"`
 * - Connect: `author: { connect: { id: "user-uuid" } }`
 * - Create: `author: { create: { name: "John" } }`
 * - ConnectOrCreate: `author: { connectOrCreate: { where: {...}, create: {...} } }`
 *
 * @param schema - Base schema from buildFieldBasedSchema
 * @param fieldDefinitions - Collection field definitions
 * @returns Extended schema with nested mutation support
 */
export function extendSchemaWithNestedMutations(
  schema: z.ZodObject<Record<string, z.ZodTypeAny>>,
  fieldDefinitions: Record<string, FieldDefinition<FieldDefinitionState>>,
): z.ZodTypeAny {
  // Create a nested mutation schema for each relation field
  const nestedMutationShape: Record<string, z.ZodTypeAny> = {};

  for (const [fieldName, fieldDef] of Object.entries(fieldDefinitions)) {
    const metadata = fieldDef.state.metadata as
      | RelationFieldMetadata
      | undefined;
    if (!metadata?.relationType) continue;

    // Create a flexible schema that accepts nested mutations
    const nestedMutationSchema = z
      .object({
        connect: z
          .union([
            z.object({ id: z.string() }),
            z.array(z.object({ id: z.string() })),
          ])
          .optional(),
        create: z
          .union([
            z.record(z.string(), z.any()),
            z.array(z.record(z.string(), z.any())),
          ])
          .optional(),
        connectOrCreate: z
          .object({
            where: z.record(z.string(), z.any()),
            create: z.record(z.string(), z.any()),
          })
          .optional(),
        disconnect: z
          .union([z.boolean(), z.object({ id: z.string() })])
          .optional(),
        set: z.array(z.object({ id: z.string() })).optional(),
      })
      .passthrough();

    nestedMutationShape[fieldName] = nestedMutationSchema.optional();
  }

  // Use passthrough to allow extra keys (nested mutations)
  // The CRUD layer will handle separating them
  return schema.passthrough();
}

// ============================================================================
// Field Name to FK Column Transformation
// ============================================================================

/**
 * Extract relation field mappings for transformation.
 *
 * With unified field API, the column key is the same as the field name.
 * This function returns an empty map since no transformation is needed.
 *
 * @param fieldDefinitions - Collection field definitions
 * @returns Empty map (no transformation needed with unified field API)
 */
export function extractBelongsToMappings(
  _fieldDefinitions: Record<string, FieldDefinition<FieldDefinitionState>>,
): Record<string, string> {
  // With unified field API, field name = column key
  // No transformation needed
  return {};
}

/**
 * Transform input data: convert relation field names to FK column names.
 *
 * Transforms:
 * - `{ author: "user-uuid" }` → `{ authorId: "user-uuid" }`
 *
 * Leaves nested mutations untouched (they're handled separately).
 *
 * @param input - Input data with field names
 * @param mappings - Field name to FK column mappings
 * @returns Transformed data with FK column names
 */
export function transformFieldNamesToFkColumns(
  input: Record<string, unknown>,
  mappings: Record<string, string>,
): Record<string, unknown> {
  const result = { ...input };

  for (const [fieldName, fkColumnName] of Object.entries(mappings)) {
    if (!(fieldName in result)) continue;

    const value = result[fieldName];

    // Only transform simple values (string IDs or null)
    // Objects are nested mutations, handled separately
    if (typeof value === "string" || value === null) {
      result[fkColumnName] = value;
      delete result[fieldName];
    }
  }

  return result;
}

// ============================================================================
// Collection Validation Schemas
// ============================================================================

export interface CollectionSchemas {
  /** Schema for insert (create) operations */
  insertSchema: z.ZodTypeAny;
  /** Schema for update operations */
  updateSchema: z.ZodTypeAny;
  /** Mapping of relation field names to FK column names */
  belongsToMappings: Record<string, string>;
}

/**
 * Build complete validation schemas for a collection.
 *
 * This is the main entry point for creating collection validation schemas.
 * Uses field definitions as the source of truth.
 *
 * @param fieldDefinitions - Collection field definitions
 * @returns Insert and update schemas with relation mappings
 */
export function buildCollectionSchemas(
  fieldDefinitions: Record<string, FieldDefinition<FieldDefinitionState>>,
): CollectionSchemas {
  const insertSchema = buildFieldBasedSchema(fieldDefinitions, "insert");
  const updateSchema = buildFieldBasedSchema(fieldDefinitions, "update");
  const belongsToMappings = extractBelongsToMappings(fieldDefinitions);

  return {
    // Use passthrough to allow extra keys (nested mutations, FK columns)
    insertSchema: insertSchema.passthrough(),
    updateSchema: updateSchema.passthrough(),
    belongsToMappings,
  };
}
