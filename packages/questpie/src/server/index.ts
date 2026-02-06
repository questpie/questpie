// Re-export shared type utilities for convenience

// Re-export commonly used drizzle-orm utilities for use by dependent packages
// This ensures all packages use the same drizzle-orm instance (type compatibility)
export { isNotNull, isNull, type SQL, sql } from "drizzle-orm";
export { json, jsonb } from "drizzle-orm/pg-core";
export type {
  CollectionInfer,
  CollectionInsert,
  CollectionRelations,
  CollectionSelect,
  CollectionUpdate,
  ExtractRelationInsert,
  ExtractRelationRelations,
  ExtractRelationSelect,
  GetCollection,
  GetGlobal,
  GlobalInfer,
  GlobalInsert,
  GlobalRelations,
  GlobalSelect,
  GlobalUpdate,
  Prettify,
  RelationShape,
  ResolveRelations,
  ResolveRelationsDeep,
  SetProperty,
  TypeMerge,
  UnsetProperty,
} from "#questpie/shared/type-utils.js";
export * from "./adapters/http.js";
export * from "./collection/builder/index.js";
// Access control utilities
export {
  type AccessRuleEvaluationContext,
  executeAccessRule,
} from "./collection/crud/shared/access-control.js";
// Transaction utilities with afterCommit support
export {
  getCurrentTransaction,
  getTransactionContext,
  isInTransaction,
  onAfterCommit,
  type TransactionContext,
  withTransaction,
} from "./collection/crud/shared/transaction.js";
export * from "./config/builder.js";
export * from "./config/builder-types.js";
export * from "./config/cms.js";
// Re-export type safety helpers (getApp, getDb, getSession already exported via context.js)
export type {
  InferAppFromApp,
  InferBaseCMS,
  InferDbFromApp,
  InferSessionFromApp,
} from "./config/context.js";
export * from "./config/context.js";
// QuestpieBuilder extensions for module augmentation
export type {
  QuestpieBuilderExtensions,
  QuestpieStateOf,
} from "./config/extensions.js";
export * from "./config/types.js";
export * from "./fields/index.js";
export * from "./functions/index.js";
export * from "./global/builder/index.js";
export * from "./global/crud/index.js";
export * from "./i18n/types.js";
export * from "./integrated/auth/index.js";
export * from "./integrated/mailer/adapters/index.js";
export * from "./integrated/mailer/index.js";
export * from "./integrated/queue/index.js";
export * from "./integrated/realtime/index.js";
export * from "./integrated/search/index.js";
export * from "./integrated/storage/signed-url.js";
export * from "./migration/index.js";
export * from "./modules/core/core.module.js";
export * from "./modules/starter/index.js";
export * from "./rpc/index.js";
export * from "./utils/drizzle-to-zod.js";
