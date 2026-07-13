export { isNotNull, isNull, type SQL, sql } from "drizzle-orm";
export { json, jsonb } from "drizzle-orm/pg-core";

export {
	CollectionBuilder,
	collection,
} from "#questpie/server/collection/builder/collection-builder.js";
export { Collection } from "#questpie/server/collection/builder/collection.js";
export * from "#questpie/server/collection/builder/index.js";
export { global } from "#questpie/server/global/builder/global-builder.js";
export * from "#questpie/server/global/builder/global.js";
export * from "#questpie/server/global/builder/global-builder.js";
export * from "#questpie/server/global/builder/types.js";
export * from "#questpie/server/global/crud/global-crud-generator.js";
export * from "#questpie/server/global/crud/types.js";
export type {
	FieldsOf,
	StateOf,
} from "#questpie/server/collection/builder/extensions.js";
export type {
	GlobalFieldsOf,
	GlobalStateOf,
} from "#questpie/server/global/builder/extensions.js";
export {
	wrapBuilderWithExtensions,
	type BuilderExtensionEntry,
} from "#questpie/server/utils/builder-extensions.js";
export { createFieldNameProxy } from "#questpie/server/utils/callback-proxies.js";
export * from "#questpie/server/utils/drizzle-to-zod.js";

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
} from "#questpie/server/fields/builder.js";
export * from "#questpie/server/modules/core/fields/index.js";
// Operator sets + combinators: required by app-land `fieldType()` definitions
// (every FieldRuntimeState carries an operatorSet — without these exports a
// custom field type could not be assembled outside the framework).
export * from "#questpie/server/fields/operators/builtin.js";
export { Field, field } from "#questpie/server/fields/field-class.js";
export type {
	ArrayFieldState,
	DefaultFieldState,
	ExtractInputType,
	ExtractSelectType,
	ExtractWhereType,
	FieldRuntimeState,
	FieldState,
} from "#questpie/server/fields/field-class-types.js";
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
} from "#questpie/server/fields/types.js";
export {
	fieldType,
	wrapFieldComplete,
	type FieldTypeDefinition,
} from "#questpie/server/fields/field-type.js";
export type {
	FieldCommonMethods,
	FieldWithMethods,
} from "#questpie/server/fields/field-with-methods.js";

export {
	getCurrentTransaction,
	getTransactionContext,
	isInTransaction,
	onAfterCommit,
	type TransactionContext,
	withTransaction,
} from "#questpie/server/collection/crud/shared/transaction.js";
