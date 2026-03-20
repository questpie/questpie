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
	config,
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
export * from "#questpie/server/fields/index.js";
export { global } from "#questpie/server/global/builder/global-builder.js";
export * from "#questpie/server/global/builder/index.js";
export * from "#questpie/server/global/crud/index.js";
export * from "#questpie/server/i18n/types.js";
export { auth } from "#questpie/server/integrated/auth/config.js";
export * from "#questpie/server/integrated/auth/index.js";
export * from "#questpie/server/integrated/mailer/adapters/index.js";
export * from "#questpie/server/integrated/mailer/index.js";
export { email } from "#questpie/server/integrated/mailer/template.js";
export * from "#questpie/server/integrated/queue/index.js";
export { job } from "#questpie/server/integrated/queue/job.js";
export * from "#questpie/server/integrated/realtime/index.js";
export * from "#questpie/server/integrated/search/index.js";
export * from "#questpie/server/integrated/storage/signed-url.js";
export { migration } from "#questpie/server/migration/define-migration.js";
export * from "#questpie/server/migration/index.js";
export * from "#questpie/server/modules/starter/index.js";
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
