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

// Builder
export {
	createFieldBuilder,
	type DefaultFieldTypeMap,
	extractFieldDefinitions,
	type FieldBuilderProxy,
	type FieldInputs,
	type FieldOutputs,
	type FieldValues,
	type InferFieldsFromFactory,
} from "./builder.js";
// Built-in field types
export * from "./builtin/index.js";
// Define field helper
export { defineField, type FieldImplementation } from "./define-field.js";
// Registry
export {
	type AnyFieldFactory,
	createFieldRegistry,
	type FieldFactory,
	FieldRegistry,
	getDefaultRegistry,
} from "./registry.js";
// Core types
export type {
	AnyFieldDefinition,
	BaseFieldConfig,
	ContextualOperators,
	FieldAccessContext,
	FieldDefinition,
	FieldDefinitionAccess,
	FieldDefinitionState,
	FieldHookContext,
	FieldHooks,
	FieldMetadata,
	FieldMetadataBase,
	FieldMetadataMeta,
	InferColumnType,
	InferInputType,
	InferOutputType,
	JoinBuilder,
	NestedFieldMetadata,
	OperatorFn,
	OperatorMap,
	QueryContext,
	RelationFieldMetadata,
	SelectFieldMetadata,
	SelectModifier,
} from "./types.js";

// Utilities
export * from "./utils/index.js";
