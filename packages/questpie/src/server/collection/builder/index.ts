// builder/index.ts - Main exports for the collection builder

// Re-export CRUD types for convenience
export type {
  Columns,
  CRUD,
  CRUDContext,
  CreateInput,
  CreateInputBase,
  CreateInputWithRelations,
  DeleteParams,
  Extras,
  FindManyOptions,
  FindOneOptions,
  OrderBy,
  OrderByDirection,
  RestoreParams,
  UpdateParams,
  Where,
  WhereOperators,
  With,
} from "#questpie/server/collection/crud/index.js";
// Introspection API
export {
  type AccessResult,
  type AdminCollectionSchema,
  type AdminFormViewSchema,
  type AdminListViewSchema,
  type AdminPreviewSchema,
  type CollectionAccessInfo,
  type CollectionSchema,
  type FieldAccessInfo,
  type FieldSchema,
  introspectCollection,
  introspectCollections,
  type RelationSchema,
} from "../introspection.js";
export { Collection } from "./collection.js";
export { CollectionBuilder, collection } from "./collection-builder.js";
// Extension types for module augmentation
export type {
  CollectionBuilderExtensions,
  FieldsOf,
  StateOf,
} from "./extensions.js";
export { softDeleteUniqueIndex } from "./index-helpers.js";
export type {
  AccessContext,
  AccessRule,
  AccessWhere,
  CollectionAccess,
  CollectionBuilderState,
  CollectionHooks,
  CollectionOptions,
  // TState-based field extraction (new approach)
  ExtractFieldsByLocation,
  FieldAccess,
  HookContext,
  HookFunction,
  InferI18nColumnsFromFields,
  InferI18nTableWithColumns,
  InferMainColumnsFromFields,
  InferMainTableWithColumns,
  InferSQLType,
  RelationConfig,
  UploadOptions,
} from "./types.js";
export {
  createCollectionValidationSchemas,
  mergeFieldsForValidation,
  type ValidationSchemas,
} from "./validation-helpers.js";
