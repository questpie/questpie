/**
 * Field Builder System
 *
 * Type-safe field definitions for collections with:
 * - Column generation for Drizzle
 * - Validation schemas (Zod v4)
 * - Query operators (column vs JSONB)
 * - Admin metadata for introspection
 *
 * @example
 * ```ts
 * import { defineField, createFieldBuilder, getDefaultRegistry } from "questpie/server/fields";
 *
 * // Using built-in fields
 * const posts = collection("posts").fields((f) => ({
 *   title: f.text({ required: true, maxLength: 255 }),
 *   content: f.textarea({ required: true }),
 *   status: f.select({
 *     options: [
 *       { value: "draft", label: "Draft" },
 *       { value: "published", label: "Published" },
 *     ],
 *   }),
 * }));
 *
 * // Creating custom fields
 * const slugField = defineField<"slug", SlugFieldConfig, string>("slug", {
 *   toColumn: (name, config) => varchar(name, { length: 255 }),
 *   toZodSchema: (config) => z.string().regex(/^[a-z0-9-]+$/),
 *   getOperators: (config) => ({ column: stringOperators, jsonb: stringJsonbOperators }),
 *   getMetadata: (config) => ({ type: "slug", ... }),
 * });
 * ```
 */

// Core types
export type {
	FieldDefinition,
	AnyFieldDefinition,
	BaseFieldConfig,
	FieldAccess,
	FieldHooks,
	FieldHookContext,
	FieldAccessContext,
	ContextualOperators,
	OperatorMap,
	OperatorFn,
	QueryContext,
	FieldMetadata,
	FieldMetadataBase,
	SelectFieldMetadata,
	RelationFieldMetadata,
	PolymorphicRelationFieldMetadata,
	NestedFieldMetadata,
	SelectModifier,
	JoinBuilder,
	InferInputType,
	InferOutputType,
	InferColumnType,
} from "./types.js";

// Registry
export {
	FieldRegistry,
	getDefaultRegistry,
	createFieldRegistry,
	type FieldFactory,
	type AnyFieldFactory,
} from "./registry.js";

// Builder
export {
	createFieldBuilder,
	extractFieldDefinitions,
	type FieldBuilderProxy,
	type FieldTypeMap,
	type DefaultFieldTypeMap,
	type InferFieldsFromFactory,
	type FieldValues,
	type FieldInputs,
	type FieldOutputs,
} from "./builder.js";

// Define field helper
export { defineField, type FieldImplementation } from "./define-field.js";

// Utilities
export * from "./utils/index.js";
