/* oxlint-disable */
// FIXTURE: full-app composed index — mirrors the post-Step-1 flat-explicit
// codegen emission (see ideal-codegen-design §5.3b). This is NOT machine-emitted:
// inside the `questpie` package the generated `questpie/...` import specifiers do
// not resolve (no self-symlink, no `questpie` paths alias), so this fixture is the
// design-blessed hand-written representative. It composes a REAL `AppContext`
// (extends `_AppCoreContext`, `_AppInfraContext.app`, `_AppAuthConfig`,
// `_AppContextExtensions`, services) over real carriers (appConfig context
// resolver + authConfig additionalFields/plugin + the pulled starterModule), so
// the DEFAULT package gate SEES the AppContext⇄config composition the module-only
// gate is blind to.
//
// Carriers kept FLAT-EXPLICIT exactly as Step 1 emits them:
//   _AppContextExtensions  = Partial<InferContextExtensionsFromAppConfig<typeof _appConfig>>   (user-derived, acyclic)
//   _AppAuthConfig         = _MPConfigSub<typeof _modules, "auth"> & typeof _authConfig          (positional, acyclic)
//   _ModuleServices        = {}  (gen-time flat; the fixture ships no module services)
// Re-introducing the `_MP`/UnionToIntersection fuse or a services-fold here is the
// acceptance probe: it must turn this gate RED.

import { createApp } from "#questpie/server/config/create-app.js";
import { createContextFactory } from "#questpie/server/config/create-context-factory.js";
import type { AppDefinition } from "#questpie/server/config/module-types.js";
import type { Questpie } from "#questpie/server/config/questpie.js";
import type {
	QuestpieConfig,
	DrizzleClientFromQuestpieConfig,
	TablesFromConfig,
} from "#questpie/server/config/types.js";
import type {
	InferContextExtensionsFromAppConfig,
	InferSessionFromAuthConfig,
} from "#questpie/server/config/context.js";
import type {
	AnyCollectionOrBuilder,
	AnyGlobalOrBuilder,
} from "#questpie/shared/type-utils.js";
import type { CollectionAPI } from "#questpie/server/config/integrated/questpie-api.js";
import type { CollectionSelect, GlobalSelect } from "#questpie/shared/type-utils.js";
import type { AccessContext, HookContext } from "#questpie/server/collection/builder/types.js";
import type { MailerService } from "#questpie/server/modules/core/integrated/mailer/service.js";
import type {
	QueueClient,
	QueueJobType,
} from "#questpie/server/modules/core/integrated/queue/types.js";
import type {
	ExtractModuleProp,
	ExtractModulePropArr,
	ServiceCustomNamespaceInstances,
	ServiceInstancesInNamespace,
	ServiceTopLevelInstances,
} from "#questpie/server/config/codegen-type-utils.js";
import type { ServiceInstanceOf } from "#questpie/server/services/define-service.js";

// ── Runtime ────────────────────────────────────────────────
import _runtime from "../questpie.config.js";

// ── Modules ────────────────────────────────────────────────
import _modules from "../modules.js";

// ── Collections ────────────────────────────────────────────
import { articles as _coll_articles } from "../collections/articles.js";
import { categories as _coll_categories } from "../collections/categories.js";

// ── Globals ────────────────────────────────────────────────
import { siteSettings as _glob_siteSettings } from "../globals/site-settings.js";

// ── Services (gen-time-resolved FLAT — never a fold over typeof _modules) ──
import { reportingService as _svc_reporting } from "../services/reporting.js";

// ── Core Singles ───────────────────────────────────────────
import _appConfig from "../config/app.js";
import _authConfig from "../config/auth.js";

// ════════════════════════════════════════════════════════════
// TYPES — composed from typeof references (zero inference cost)
// ════════════════════════════════════════════════════════════

type _MPConfigSub<A extends readonly any[], K extends string> = A extends readonly [infer H, ...infer T extends readonly any[]] ? (H extends { config: infer C } ? (C extends Record<K, infer V> ? V : {}) : {}) & _MPConfigSub<T, K> : {};
type _AppAppConfig = typeof _appConfig;
type _AppContextExtensions = Partial<InferContextExtensionsFromAppConfig<_AppAppConfig>>;
type _AppAuthConfig = _MPConfigSub<typeof _modules, "auth"> & typeof _authConfig;
type _AppSessionAuthConfig = _AppAuthConfig;
type _AppSession = NonNullable<InferSessionFromAuthConfig<_AppSessionAuthConfig>> | null;

type _ModuleCollections = ExtractModulePropArr<typeof _modules, "collections">;
type _ModuleGlobals = ExtractModulePropArr<typeof _modules, "globals">;
type _ModuleJobs = ExtractModulePropArr<typeof _modules, "jobs">;
type _ModuleServices = {};
// Registry category extraction from modules
type _Registry_Collections = ExtractModulePropArr<typeof _modules, "collections">;
type _Registry_Globals = ExtractModulePropArr<typeof _modules, "globals">;
type _Registry_Jobs = ExtractModulePropArr<typeof _modules, "jobs">;
type _Registry_Services = {};
type _Registry_Emails = ExtractModulePropArr<typeof _modules, "emails">;
type _Registry_FieldTypes = ExtractModulePropArr<typeof _modules, "fieldTypes">;
type _Registry_Views = ExtractModulePropArr<typeof _modules, "views">;
type _Registry_Components = ExtractModulePropArr<typeof _modules, "components">;
type _Registry_Blocks = ExtractModulePropArr<typeof _modules, "blocks">;

// Recursive module property extraction (for fields contributed at each level)
type _AllModuleFields = ExtractModuleProp<{ modules: typeof _modules }, "fields">;

/** All collections in the app (modules + user, user overrides) */
export type AppCollections = _ModuleCollections & {
	articles: typeof _coll_articles;
	categories: typeof _coll_categories;
};

/** All globals in the app (modules + user, user overrides) */
export type AppGlobals = _ModuleGlobals & {
	siteSettings: typeof _glob_siteSettings;
};

/** All jobs in the app (modules + user, user overrides) */
export type AppJobs = _ModuleJobs;

/**
 * All service definitions in the app. `_ModuleServices` is the gen-time FLAT
 * literal `{}` (the contributing module's services are enumerated DIRECTLY by
 * name below — never folded over `typeof _modules`, which would cycle via
 * ServiceCreateContext → AppContext, §2.2).
 */
type _AppServiceDefinitions = _ModuleServices & {
	reporting: typeof _svc_reporting;
};

/** All services in the app as resolved service instances. */
export type AppServices = {
	[K in keyof _AppServiceDefinitions]: ServiceInstanceOf<_AppServiceDefinitions[K]>;
};
type _AppDefaultServices = ServiceInstancesInNamespace<_AppServiceDefinitions, "services">;
type _AppTopLevelServices = ServiceTopLevelInstances<_AppServiceDefinitions>;
type _AppCustomServiceNamespaces = ServiceCustomNamespaceInstances<_AppServiceDefinitions>;

/** All email templates in the app — use with email.sendTemplate() */
export type AppEmailTemplates = {};

type _CollectionsAPI = { [K in keyof AppCollections]: CollectionAPI<AppCollections[K], AppCollections> };
type _AppCollectionDefinitions = AppCollections & Record<string, AnyCollectionOrBuilder>;
type _AppGlobalDefinitions = AppGlobals & Record<string, AnyGlobalOrBuilder>;
type _AppQuestpieConfig = Omit<QuestpieConfig, "app" | "db" | "collections" | "globals" | "auth" | "~contextExtensions"> & {
	app: (typeof _runtime)["app"];
	db: (typeof _runtime)["db"];
	collections: _AppCollectionDefinitions;
	globals: _AppGlobalDefinitions;
	auth: _AppAuthConfig;
	storage: (typeof _runtime)["storage"];
	"~contextExtensions": _AppContextExtensions;
};
type _AppQuestpieBase = Questpie<_AppQuestpieConfig>;
type _AppDb = DrizzleClientFromQuestpieConfig<_AppQuestpieConfig>;
type _AppGlobalsAPI = _AppQuestpieBase["globals"];
type _AppStorage = _AppQuestpieBase["storage"];
type _AppTables = TablesFromConfig<_AppQuestpieConfig>;
type _AppQuestpie = Omit<_AppQuestpieBase, "collections" | "globals"> & {
	collections: _CollectionsAPI;
	globals: _AppGlobalsAPI;
};

// ── AppContext augmentation — auto-types ALL handlers ──────
type _AppInfraContext = {
	// Infrastructure
	app: _AppQuestpie;
	db: _AppDb;
	email: MailerService<AppEmailTemplates>;
	queue: QueueClient<AppJobs>;
	storage: _AppStorage;
	kv: _AppQuestpie["kv"];
	logger: _AppQuestpie["logger"];
	search: _AppQuestpie["search"];
	realtime: _AppQuestpie["realtime"];

	// Entity APIs
	collections: _CollectionsAPI;
	globals: _AppGlobalsAPI;
	tables: _AppTables;

	// Request-scoped
	session: _AppSession;
	t: (key: string, params?: Record<string, unknown>, locale?: string) => string;

	// User services
	services: _AppDefaultServices;
} & _AppCustomServiceNamespaces;
type _AppCoreContext = _AppContextExtensions & _AppInfraContext;

type _ModuleCollectionsKeyNames = (typeof _modules)[number] extends infer M ? M extends { collections: infer C } ? keyof C & string : never : never;
type _ModuleGlobalsKeyNames = (typeof _modules)[number] extends infer M ? M extends { globals: infer C } ? keyof C & string : never : never;
type _ModuleJobsKeyNames = (typeof _modules)[number] extends infer M ? M extends { jobs: infer C } ? keyof C & string : never : never;

declare global {
	namespace Questpie {
		interface AppContext extends _AppCoreContext, _AppTopLevelServices {}

		interface ServiceCreateContext extends _AppCoreContext {}
		// Names-only marker — the `ServiceCreateContext` fallback conditional
		// probes THIS interface's keys instead of the real one (whose base
		// resolves through module service definitions and would cycle).
		interface ServiceCreateContextGenerated { generated: unknown }

		// Typed service surface for appConfig({ context }) resolvers.
		// Excludes _AppContextExtensions — the resolver produces them.
		interface ContextResolverContext {
			collections: _CollectionsAPI;
			globals: _AppGlobalsAPI;
			logger: _AppQuestpie["logger"];
			kv: _AppQuestpie["kv"];
			queue: QueueClient<AppJobs>;
			t: (key: string, params?: Record<string, unknown>, locale?: string) => string;
			services: _AppDefaultServices;
		}

		// App-level hook / default-access ctx infra seams (CL-05).
		// Filled with the real infra MINUS _AppContextExtensions, so the
		// app-level hooks/access predicates get precise db/session/
		// collections/globals/queue WITHOUT re-entering the extensions cycle.
		interface AppHookContext extends _AppInfraContext {}
		interface AppDefaultAccessContext extends _AppInfraContext {}

		// appConfig({ context }) resolver session/db — off the cyclic edge.
		interface ContextResolverBase {
			session: _AppSession;
			db: _AppDb;
		}
		interface CollectionKeys extends Record<_ModuleCollectionsKeyNames, unknown> {}
		interface GlobalKeys extends Record<_ModuleGlobalsKeyNames, unknown> {}
		interface JobKeys extends Record<_ModuleJobsKeyNames, unknown> {}

		interface Registry {
			collections: _Registry_Collections;
			globals: _Registry_Globals;
			jobs: _Registry_Jobs;
			routes: {};
			services: _Registry_Services;
			emails: _Registry_Emails;
			"~fieldTypes": _Registry_FieldTypes & _AllModuleFields;
			views: _Registry_Views;
			components: _Registry_Components;
			blocks: _Registry_Blocks;
			workflows: {};
		}
	}
}

/**
 * Select/document type for a collection key — prefer over `Record<string, any>` for docs.
 */
export type CollectionDoc<K extends keyof AppCollections> = CollectionSelect<AppCollections[K]>;

/**
 * Select/document type for a global key.
 */
export type GlobalDoc<K extends keyof AppGlobals> = GlobalSelect<AppGlobals[K]>;

/** Resolved auth session for this app (`{ user, session } | null`). */
export type AppSession = _AppSession;

/** Authenticated user shape from the app session. */
export type AppSessionUser = NonNullable<_AppSession>["user"];

/** Access-rule ctx for shared helpers. `K` narrows `data` to that collection's row. */
export type AccessRuleContext<K extends keyof AppCollections | unknown = unknown> =
	AccessContext<K extends keyof AppCollections ? CollectionDoc<K> : unknown>;

/** Hook ctx for shared helpers. `K` narrows `data` to that collection's row. */
export type HookRuleContext<K extends keyof AppCollections | unknown = unknown> =
	HookContext<K extends keyof AppCollections ? CollectionDoc<K> : unknown>;

/**
 * Flat config type for client APIs.
 */
export type AppConfig = {
	collections: AppCollections;
	globals: AppGlobals;
	storage: (typeof _runtime)["storage"];
	auth: typeof _authConfig;
};

// ════════════════════════════════════════════════════════════
// RUNTIME — create the app instance
// ════════════════════════════════════════════════════════════

var _appPromise: Promise<unknown> | undefined;

_appPromise = createApp(
	({
		modules: _modules,
		collections: {
			articles: _coll_articles,
			categories: _coll_categories,
		},
		globals: {
			siteSettings: _glob_siteSettings,
		},
		services: {
			reporting: _svc_reporting,
		},
		config: {
			app: _appConfig,
			auth: _authConfig,
		},
	}) satisfies AppDefinition,
	_runtime,
);

export const app = (await _appPromise) as unknown as _AppQuestpie;

/** Fully typed QUESTPIE app instance. */
export type App = typeof app;

// ── createContext — typed context for scripts ──────────────
export async function createContext(
	options?: Parameters<ReturnType<typeof createContextFactory>>[0],
) {
	while (!_appPromise) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}

	return createContextFactory((await _appPromise) as _AppQuestpie)(options);
}
