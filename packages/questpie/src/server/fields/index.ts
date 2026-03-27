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
 * import { createFieldBuilder, builtinFields } from "questpie/server/fields";
 *
 * // Using built-in fields
 * const posts = collection("posts").fields(({ f }) => ({
 *   title: f.text(255).required(),
 *   content: f.textarea().localized(),
 *   status: f.select([
 *     { value: "draft", label: "Draft" },
 *     { value: "published", label: "Published" },
 *   ]),
 * }));
 * ```
 */

// Builder
export {
	type BuiltinFields,
	createFieldBuilder,
	createFieldsCallbackContext,
	extractFieldDefinitions,
	type FieldBuilderProxy,
	type FieldInputs,
	type FieldOutputs,
	type FieldsCallbackContext,
	type FieldValues,
	type InferFieldsFromFactory,
} from "./builder.js";
// Built-in fields map (used by codegen-generated factories to construct merged field defs)
export { builtinFields } from "./builtin/defaults.js";
// Built-in field factories
export * from "./builtin-factories/index.js";
// Field builder class
export { Field, field } from "./field-class.js";
// Field state types
export type {
	ArrayFieldState,
	DefaultFieldState,
	ExtractInputType,
	ExtractSelectType,
	ExtractWhereType,
	FieldRuntimeState,
	FieldState,
} from "./field-class-types.js";

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
// NOTE: FieldAccess is NOT re-exported here to avoid name collision with
// collection-level FieldAccess in collection/builder/types.ts.
// Import field-level FieldAccess directly from "#questpie/server/fields/types.js".
export type {
	ContextualOperators,
	FieldAccessContext,
	FieldHookContext,
	FieldHooks,
	FieldMetadata,
	FieldMetadataBase,
	FieldType,
	FieldTypeRegistry,
	JoinBuilder,
	NestedFieldMetadata,
	OperatorFn,
	OperatorMap,
	QueryContext,
	RelationFieldMetadata,
	SelectFieldMetadata,
	SelectModifier,
} from "./types.js";
