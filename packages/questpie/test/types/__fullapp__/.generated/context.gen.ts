/* oxlint-disable */
// FIXTURE L2 context.gen.ts — the ONLY AppContext builder. Owns the cycle-head
// carriers `_AppContextExtensions` + `_AppQuestpieConfig`/`_AppQuestpie` and the
// composition `declare global` (AppContext/ServiceCreateContext*/ContextResolver*/
// AppHookContext/AppDefaultAccessContext/Registry). Imports L1 (entities.gen) +
// the `_runtime`/`_appConfig`/`_authConfig` VALUES + Questpie/Infer* type-utils.
// NEVER imported by L1 → the AppContext⇄config cycle is impossible by construction.
//
// Carriers kept FLAT-EXPLICIT exactly as Step 1 emits them:
//   _AppContextExtensions  = Partial<InferContextExtensionsFromAppConfig<typeof _appConfig>>   (user-derived, acyclic)
//   _AppAuthConfig         = _MPConfigSub<typeof _modules, "auth"> & typeof _authConfig          (positional, acyclic)
//   _ModuleServices        = {}  (gen-time flat; the fixture ships no module services — emitted in entities.gen.ts)
// Re-introducing the `_MP`/UnionToIntersection fuse or a services-fold here (or
// `_ModuleServices = ExtractModulePropArr<typeof _modules,"services">` in
// entities.gen.ts) is the acceptance probe: it re-materializes the
// reporting-carrier (config/reporting-carrier.ts: ReportingWidgetContext =
// AppContext & {…}) and MUST turn this gate RED.

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
import type { MailerService } from "#questpie/server/modules/core/integrated/mailer/service.js";
import type {
	QueueClient,
} from "#questpie/server/modules/core/integrated/queue/types.js";

// ── Runtime ────────────────────────────────────────────────
import _runtime from "../questpie.config.js";

// ── Modules ────────────────────────────────────────────────
import _modules from "../modules.js";

// ── Core Singles ───────────────────────────────────────────
import _appConfig from "../config/app.js";
import _authConfig from "../config/auth.js";

// Named types imported DOWN from entities.gen.ts (L1).
import type {
	AppCollections,
	AppGlobals,
	AppJobs,
	AppEmailTemplates,
	_AppDefaultServices,
	_AppTopLevelServices,
	_AppCustomServiceNamespaces,
	_Registry_Collections,
	_Registry_Globals,
	_Registry_Jobs,
	_Registry_Services,
	_Registry_Emails,
	_Registry_FieldTypes,
	_Registry_Views,
	_Registry_Components,
	_Registry_Blocks,
	_AllModuleFields,
} from "./entities.gen.js";

type _MPConfigSub<A extends readonly any[], K extends string> = A extends readonly [infer H, ...infer T extends readonly any[]] ? (H extends { config: infer C } ? (C extends Record<K, infer V> ? V : {}) : {}) & _MPConfigSub<T, K> : {};
type _AppAppConfig = typeof _appConfig;
type _AppContextExtensions = Partial<InferContextExtensionsFromAppConfig<_AppAppConfig>>;
type _AppAuthConfig = _MPConfigSub<typeof _modules, "auth"> & typeof _authConfig;
type _AppSessionAuthConfig = _AppAuthConfig;
type _AppSession = NonNullable<InferSessionFromAuthConfig<_AppSessionAuthConfig>> | null;

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
export type _AppQuestpie = Omit<_AppQuestpieBase, "collections" | "globals"> & {
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

/** Resolved auth session for this app (`{ user, session } | null`). */
export type AppSession = _AppSession;

/** Authenticated user shape from the app session. */
export type AppSessionUser = NonNullable<_AppSession>["user"];
