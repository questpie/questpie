export {
	createApp,
	module,
	runtimeConfig,
	type MergeFn,
	mergeRecord,
	mergeConcat,
	mergeDeepConcat,
	lastWins,
} from "#questpie/server/config/create-app.js";
export { createContextFactory } from "#questpie/server/config/create-context-factory.js";
export {
	appConfig,
	authConfig,
	type TypedAuthConfig,
} from "#questpie/server/config/factories.js";
export { default as starterModule } from "#questpie/server/modules/starter/.generated/module.js";
export { default as oauthModule } from "#questpie/server/modules/oauth/.generated/module.js";
export {
	type CoreMessageKey,
	coreBackendMessages,
} from "#questpie/server/modules/starter/_messages.js";

export type {
	AppDefinition,
	AppConfig,
	AppConfigInput,
	AppModuleInput,
	RuntimeConfig,
	RuntimeConfigInput,
	ResolvedRuntimeConfig,
	ModuleDefinition,
	AuthConfig,
} from "#questpie/server/config/module-types.js";

export type {
	InferAppFromApp,
	InferDbFromApp,
	InferContextExtensionsFromAppConfig,
	InferSessionFromAuthConfig,
	InferSessionFromApp,
} from "#questpie/server/config/context.js";

export type {
	QuestpieConfig,
	DbConfig,
	DbClientType,
	LocaleConfig,
} from "#questpie/server/config/types.js";
