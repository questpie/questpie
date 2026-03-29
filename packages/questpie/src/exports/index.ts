/**
 * questpie — Public Server API
 *
 * This is the ONLY barrel for server exports. It exists solely as the
 * package entry point for external consumers (`questpie`).
 *
 * Internal code within this package MUST NOT import from this file.
 * Use direct module paths instead (e.g. `#questpie/server/collection/builder/index.js`).
 */

// Re-export commonly used drizzle-orm utilities for use by dependent packages
// This ensures all packages use the same drizzle-orm instance (type compatibility)
export { isNotNull, isNull, type SQL, sql } from "drizzle-orm";
export { json, jsonb } from "drizzle-orm/pg-core";
export * from "#questpie/server/adapters/http.js";
// Re-export standalone factory functions
export { collection } from "#questpie/server/collection/builder/collection-builder.js";
export * from "#questpie/server/collection/builder/index.js";
// Access control utilities
export {
	type AccessRuleEvaluationContext,
	executeAccessRule,
} from "#questpie/server/collection/crud/shared/access-control.js";
// Transaction utilities with afterCommit support
export {
	getCurrentTransaction,
	getTransactionContext,
	isInTransaction,
	onAfterCommit,
	type TransactionContext,
	withTransaction,
} from "#questpie/server/collection/crud/shared/transaction.js";
export {
	type AppContext,
	extractAppServices,
	type KnownBlockNames,
	type KnownCollectionNames,
	type KnownComponentNames,
	type KnownEmailNames,
	type KnownFormViewNames,
	type KnownGlobalNames,
	type KnownJobNames,
	type KnownListViewNames,
	type KnownRouteNames,
	type KnownServiceNames,
	type KnownViewNames,
	type Registry,
	type RegistryNames,
} from "#questpie/server/config/app-context.js";
export {
	CLOUD_ENV,
	isQuestpieCloud,
} from "#questpie/server/config/cloud-env.js";
export type {
	ExtractModuleProp,
	ExtractModulePropArr,
	MergeModuleProp,
	RegistryProp,
	ServiceCustomNamespaceInstances,
	ServiceDefinitionsInNamespace,
	ServiceInstancesInNamespace,
	ServiceTopLevelInstances,
	UnionToIntersection,
} from "#questpie/server/config/codegen-type-utils.js";
// Re-export type safety helpers (getContext, etc. exported via context.js)
export type {
	InferAppFromApp,
	InferDbFromApp,
	InferSessionFromApp,
} from "#questpie/server/config/context.js";
export * from "#questpie/server/config/context.js";
export * from "#questpie/server/config/create-app.js";
export {
	createApp,
	module,
	runtimeConfig,
} from "#questpie/server/config/create-app.js";
export { createContextFactory } from "#questpie/server/config/create-context-factory.js";
export * from "#questpie/server/config/global-hooks-types.js";
export * from "#questpie/server/config/module-types.js";
export { appConfig, authConfig } from "#questpie/server/config/factories.js";
export type { AppStateConfig, ResolvedAppStateConfig } from "#questpie/server/config/app-state-config.js";
export * from "#questpie/server/config/questpie.js";
export * from "#questpie/server/config/types.js";
export * from "#questpie/server/errors/index.js";
// Field builder system (expanded from fields/index.ts barrel)
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
export {
	extractDependencies,
	getDebounce,
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
	type TrackingResult,
	trackDependencies,
	trackDepsFunction,
} from "#questpie/server/fields/reactive.js";
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
// v3 field primitives
export { fieldType, wrapFieldComplete } from "#questpie/server/fields/field-type.js";
export type { FieldTypeDefinition } from "#questpie/server/fields/field-type.js";
export type {
	FieldCommonMethods,
	FieldWithMethods,
} from "#questpie/server/fields/field-with-methods.js";
export type * from "#questpie/server/fields/reactive-types.js";
export { global } from "#questpie/server/global/builder/global-builder.js";
// Global builder (expanded from global/builder/index.ts barrel)
export {
	type AdminFormViewSchema as AdminGlobalFormViewSchema,
	type AdminGlobalSchema,
	type GlobalAccessInfo,
	type GlobalAccessResult,
	type GlobalFieldAccessInfo,
	type GlobalFieldSchema,
	type GlobalSchema,
	introspectGlobal,
	introspectGlobals,
} from "#questpie/server/global/introspection.js";
export type { GlobalFieldsOf, GlobalStateOf } from "#questpie/server/global/builder/extensions.js";
export * from "#questpie/server/global/builder/global.js";
export * from "#questpie/server/global/builder/global-builder.js";
export * from "#questpie/server/global/builder/types.js";
export * from "#questpie/server/global/crud/global-crud-generator.js";
export * from "#questpie/server/global/crud/types.js";
export * from "#questpie/server/i18n/types.js";
export { auth } from "#questpie/server/modules/core/integrated/auth/merge.js";
export * from "#questpie/server/modules/core/integrated/auth/types.js";
export * from "#questpie/server/modules/core/integrated/mailer/adapters/console.adapter.js";
export * from "#questpie/server/modules/core/integrated/mailer/adapters/smtp.adapter.js";
export * from "#questpie/server/modules/core/integrated/mailer/adapter.js";
export * from "#questpie/server/modules/core/integrated/mailer/service.js";
export {
	email,
	type EmailHandlerArgs,
	type EmailResult,
	type EmailTemplateDefinition,
	type EmailTemplateNames,
	type GetEmailTemplate,
	type InferEmailTemplateContext,
	type InferEmailTemplateInput,
} from "#questpie/server/modules/core/integrated/mailer/template.js";
export * from "#questpie/server/modules/core/integrated/mailer/types.js";
export * from "#questpie/server/modules/core/integrated/queue/adapter.js";
export * from "#questpie/server/modules/core/integrated/queue/adapters/cloudflare-queues.js";
export * from "#questpie/server/modules/core/integrated/queue/adapters/pg-boss.js";
export * from "#questpie/server/modules/core/integrated/queue/job.js";
export * from "#questpie/server/modules/core/integrated/queue/service.js";
export * from "#questpie/server/modules/core/integrated/queue/types.js";
export * from "#questpie/server/modules/core/integrated/queue/worker.js";
export * from "#questpie/server/modules/core/integrated/queue/workflow.js";
export * from "#questpie/server/modules/core/integrated/realtime/adapter.js";
export * from "#questpie/server/modules/core/integrated/realtime/adapters/pg-notify.js";
export * from "#questpie/server/modules/core/integrated/realtime/adapters/redis-streams.js";
export * from "#questpie/server/modules/core/integrated/realtime/collection.js";
export * from "#questpie/server/modules/core/integrated/realtime/service.js";
export * from "#questpie/server/modules/core/integrated/realtime/types.js";
// Search adapters
export * from "#questpie/server/modules/core/integrated/search/adapters/pgvector.js";
export * from "#questpie/server/modules/core/integrated/search/adapters/postgres.js";
// Search module
export * from "#questpie/server/modules/core/integrated/search/collection.js";
export * from "#questpie/server/modules/core/integrated/search/facet-utils.js";
export * from "#questpie/server/modules/core/integrated/search/jobs/index-records.job.js";
export * from "#questpie/server/modules/core/integrated/search/providers/index.js";
export { createSearchService, SearchServiceWrapper } from "#questpie/server/modules/core/integrated/search/service.js";
export * from "#questpie/server/modules/core/integrated/search/types.js";
export * from "#questpie/server/modules/core/integrated/storage/signed-url.js";
export type { KVConfig } from "#questpie/server/modules/core/integrated/kv/types.js";
export type { LoggerConfig } from "#questpie/server/modules/core/integrated/logger/types.js";
export { migration } from "#questpie/server/migration/define-migration.js";
export * from "#questpie/server/migration/generator.js";
export * from "#questpie/server/migration/operation-snapshot.js";
export * from "#questpie/server/migration/runner.js";
export * from "#questpie/server/migration/types.js";
export * from "#questpie/server/modules/starter/.generated/module.js";
export { default as starterModule } from "#questpie/server/modules/starter/.generated/module.js";
export { type CoreMessageKey, coreBackendMessages } from "#questpie/server/modules/starter/_messages.js";
export { route } from "#questpie/server/routes/define-route.js";
export * from "#questpie/server/routes/index.js";
export { seed } from "#questpie/server/seed/define-seed.js";
export * from "#questpie/server/seed/index.js";
export * from "#questpie/server/services/define-service.js";
export { service } from "#questpie/server/services/define-service.js";
export * from "#questpie/server/utils/builder-extensions.js";
export * from "#questpie/server/utils/callback-proxies.js";
export * from "#questpie/server/utils/drizzle-to-zod.js";
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
} from "#questpie/shared/type-utils.js";
export type { CollectionAPI } from "#questpie/server/config/integrated/questpie-api.js";
