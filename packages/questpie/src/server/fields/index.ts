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
 * import { field, createFieldBuilder, builtinFields } from "questpie/server/fields";
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
 * const slugField = field<SlugFieldConfig, string>()({
 *   type: "slug" as const,
 *   _value: undefined as unknown as string,
 *   toColumn: (name, config) => varchar({ length: 255 }),
 *   toZodSchema: (config) => z.string().regex(/^[a-z0-9-]+$/),
 *   getOperators: <TApp>(config) => ({ column: stringOperators, jsonb: stringJsonbOperators }),
 *   getMetadata: (config) => ({ type: "slug", ... }),
 * });
 * ```
 */

// Builder
export {
	type BuiltinFields,
	createFieldBuilder,
	/** @deprecated Use `createFieldBuilder` instead */
	createFieldBuilderFromDefs,
	/** @deprecated Use `BuiltinFields` instead */
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
export {
	type BuildFieldState,
	createFieldDefinition,
	field,
	type ExtractConfigFromFieldDef,
	type ExtractOpsFromFieldDef,
	type ExtractTypeFromFieldDef,
	type ExtractValueFromFieldDef,
	type FieldDef,
} from "./field.js";
// Reactive field system
export {
	extractDependencies,
	getDebounce,
	getHandler,
	isReactiveConfig,
	type OptionsConfig,
	type OptionsContext,
	type OptionsHandler,
	type OptionsResult,
	type ReactiveAdminMeta,
	type ReactiveConfig,
	type ReactiveContext,
	type ReactiveHandler,
	type ReactiveServerContext,
	type SerializedOptionsConfig,
	type SerializedReactiveConfig,
	serializeOptionsConfig,
	serializeReactiveConfig,
	type TrackingResult,
	trackDependencies,
	trackDepsFunction,
} from "./reactive.js";
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
