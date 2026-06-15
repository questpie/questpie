/**
 * AppContext — the extensible context interface.
 *
 * Empty by default. Generated code augments this via module augmentation:
 *   declare module "questpie" {
 *     interface AppContext { db: ...; queue: ...; session: ...; }
 *   }
 *
 * ALL handler contexts (HookContext, AccessContext, FunctionHandlerArgs,
 * JobHandlerArgs, BlockPrefetchContext) extend AppContext.
 *
 * Plugins can add custom keys:
 *   declare module "questpie" {
 *     interface AppContext { channels: ChannelsService; }
 *   }
 *   → ({ channels }) available in every hook, function, job, etc.
 *
 * User services support namespace placement:
 *   ({ services }) => services.blog.computeReadingTime(text) // default
 *   ({ workflows }) => workflows.run(...)                    // namespace: null
 *   ({ analytics }) => analytics.tracker.track(...)          // namespace: "analytics"
 *
 * @see RFC-CONTEXT-FIRST.md §2
 */
/**
 * Global augmentation namespace.
 * Uses `declare global` so augmentations work correctly with workspace symlinks
 * (where `declare module "questpie"` fails due to module identity mismatch).
 *
 * Augment via: `declare global { namespace Questpie { interface AppContext { ... } } }`
 */
declare global {
	namespace Questpie {
		interface AppContext {}
		interface JobHandlerContext {}
		interface WorkflowContext {}
		interface Registry {}
		/**
		 * Augmentable interface for view record types.
		 * Populated by each module's codegen output to provide autocomplete on `v.*` proxies.
		 * Declared empty to break circular references in the CollectionBuilder augmentation chain.
		 */
		interface ViewsRegistry {}

		/**
		 * Augmentable interface for component record types.
		 * Populated by each module's codegen output to provide autocomplete on `c.*` proxies.
		 */
		interface ComponentsRegistry {}

		/**
		 * Augmentable interface for merged field type map.
		 * Populated by each module's codegen output with field factory functions.
		 * Used by `.fields(({ f }) => ...)` for autocomplete on `f.*`.
		 */
		interface FieldTypesMap {}

		/**
		 * Extra parameters available to `appConfig({ context })` resolvers.
		 * Empty by default — the root codegen template augments it with the
		 * typed service surface (collections, globals, logger, kv, queue, t,
		 * services) so resolvers get full inference without `typeof app`.
		 */
		interface ContextResolverContext {}

		/**
		 * Lazy infra seam for app-level lifecycle-hook ctx (`appConfig({ hooks })`).
		 * Empty by default — the root codegen template fills it with the real
		 * infra surface (db/session/collections/globals/queue/...), DELIBERATELY
		 * excluding `_AppContextExtensions` so the seam stays off the cyclic edge
		 * (`AppContext → extensions → typeof appConfig → ...`). Pre-codegen it is
		 * empty and consumers fall back to {@link ResolvedAppHookContext}'s loose
		 * (non-`any`) default — strictly better than the old all-`any`
		 * `AppContextBase`.
		 */
		interface AppHookContext {}

		/**
		 * Lazy infra seam for app-level default-access-rule ctx
		 * (`appConfig({ access })`). Filled by codegen with the real infra
		 * surface. @see AppHookContext
		 */
		interface AppDefaultAccessContext {}

		/**
		 * Lazy seam for the `appConfig({ context })` resolver's own
		 * `session`/`db` params. Filled by codegen with the real session/db so
		 * `ContextResolverParams` no longer threads the full augmented
		 * `AppContext` (which re-enters the augmentation cycle). @see AppHookContext
		 */
		interface ContextResolverBase {}

		/**
		 * Names-only collection key registry — acyclic by construction.
		 *
		 * Codegen emits `interface CollectionKeys { posts: unknown; ... }` from
		 * file discovery alone (zero imports, zero type references), so consumers
		 * like `relation()` can offer key autocomplete without touching builder
		 * types (which would recreate the Registry cycle).
		 */
		interface CollectionKeys {}

		/** Names-only global key registry. @see CollectionKeys */
		interface GlobalKeys {}

		/** Names-only job key registry. @see CollectionKeys */
		interface JobKeys {}
	}
}

/**
 * Loose-but-not-`any` infra default for the app-level ctx seams. Used by the
 * `Resolved*` helpers below ONLY pre-codegen (when the lazy seam is still
 * empty). Entity/request members are `unknown` (never `any`) so the degraded
 * shape stays type-safe (a typo'd `session.user.rOle` is `unknown`, not
 * silently allowed). The always-initialized core services
 * (`logger`/`search`/`realtime`) carry their concrete base types so first-party
 * module hooks (`modules/core/config/app.ts`) keep type-checking pre-codegen.
 * Once codegen fills the seam, the precise members replace ALL of these.
 */
export interface AppCtxInfraDefault {
	app?: unknown;
	db?: unknown;
	session?: unknown;
	queue?: unknown;
	email?: unknown;
	storage?: unknown;
	kv?: unknown;
	executor?: unknown;
	logger?: import("#questpie/server/modules/core/integrated/logger/service.js").LoggerService;
	search?: import("#questpie/server/modules/core/integrated/search/types.js").SearchService;
	realtime?: import("#questpie/server/modules/core/integrated/realtime/service.js").RealtimeService;
	collections?: unknown;
	globals?: unknown;
	tables?: unknown;
	t?: unknown;
	services?: Record<string, unknown>;
	workflows?: unknown;
}

/**
 * Resolve the app-level hook ctx infra: the codegen-filled
 * {@link Questpie.AppHookContext} seam when present, else the loose
 * (non-`any`) {@link AppCtxInfraDefault}. This is the precise replacement for
 * the all-`any` `AppContextBase` the hook/access surfaces used as a cycle-break.
 */
export type ResolvedAppHookContext = [
	keyof Questpie.AppHookContext,
] extends [never]
	? AppCtxInfraDefault
	: Questpie.AppHookContext;

/** Resolve the app-level default-access ctx infra. @see ResolvedAppHookContext */
export type ResolvedAppDefaultAccessContext = [
	keyof Questpie.AppDefaultAccessContext,
] extends [never]
	? AppCtxInfraDefault
	: Questpie.AppDefaultAccessContext;

/**
 * Resolve the context-resolver's own `session`/`db` params: the codegen-filled
 * {@link Questpie.ContextResolverBase} seam when present, else the loose
 * (non-`any`) default. Replaces routing through the full augmented `AppContext`,
 * which held a live `AppContext → extensions → typeof appConfig →
 * ContextResolverParams → AppContext` loop.
 */
export type ResolvedContextResolverBase = [
	keyof Questpie.ContextResolverBase,
] extends [never]
	? { session: unknown; db: unknown }
	: Questpie.ContextResolverBase;

/**
 * Base handler context — shared by global hooks and other pre-codegen handlers.
 */
export type { AppContextBase } from "#questpie/server/config/app-context-base.js";

/**
 * AppContext — the extensible context interface.
 * Augment via `declare global { namespace Questpie { interface AppContext { ... } } }`
 */
export interface AppContext extends Questpie.AppContext {}

/**
 * Registry — the app-wide type catalogue.
 * Augment via `declare global { namespace Questpie { interface Registry { ... } } }`
 */
export interface Registry extends Questpie.Registry {}

/**
 * Extract known names from a Registry key.
 * When the key exists → union of its keys + (string & {}) for autocomplete.
 * When it doesn't (no codegen) → plain string.
 */
export type RegistryNames<K extends string> =
	Registry extends Record<K, infer R>
		? (keyof R & string) | (string & {})
		: string;

/** Known collection names (includes module collections). @see Registry['collections'] */
export type KnownCollectionNames = RegistryNames<"collections">;

/** Known global names. @see Registry['globals'] */
export type KnownGlobalNames = RegistryNames<"globals">;

/** Known block names. @see Registry['blocks'] */
export type KnownBlockNames = RegistryNames<"blocks">;

/** Known job names (includes module jobs). @see Registry['jobs'] */
export type KnownJobNames = RegistryNames<"jobs">;

/** Known service names. @see Registry['services'] */
export type KnownServiceNames = RegistryNames<"services">;

/** Known email template names. @see Registry['emails'] */
export type KnownEmailNames = RegistryNames<"emails">;

/** Known route names. @see Registry['routes'] */
export type KnownRouteNames = RegistryNames<"routes">;

/** Known view names (from admin modules). @see Registry['views'] */
export type KnownViewNames = RegistryNames<"views">;

/**
 * Known list view names (from admin modules).
 * @deprecated Use KnownViewNames instead — list/form filtering is now type-level.
 */
export type KnownListViewNames = RegistryNames<"views">;

/**
 * Known form view names (from admin modules).
 * @deprecated Use KnownViewNames instead — list/form filtering is now type-level.
 */
export type KnownFormViewNames = RegistryNames<"views">;

/** Known component names (from admin modules). @see Registry['components'] */
export type KnownComponentNames = RegistryNames<"components">;

/**
 * Collection keys from the names-only key registry.
 * Union of generated keys + `(string & {})` so plain strings keep working
 * (autocomplete, not strictness). Falls back to plain string pre-codegen.
 */
export type KnownCollectionKey = [keyof Questpie.CollectionKeys] extends [never]
	? string & {}
	: (keyof Questpie.CollectionKeys & string) | (string & {});

/** Global keys from the names-only key registry. @see KnownCollectionKey */
export type KnownGlobalKey = [keyof Questpie.GlobalKeys] extends [never]
	? string & {}
	: (keyof Questpie.GlobalKeys & string) | (string & {});

/** Job keys from the names-only key registry. @see KnownCollectionKey */
export type KnownJobKey = [keyof Questpie.JobKeys] extends [never]
	? string & {}
	: (keyof Questpie.JobKeys & string) | (string & {});

/** Known runtime fields populated by extractAppServices before namespace projection. */
type ExtractAppServicesBase = {
	app: unknown;
	db: unknown;
	session: unknown;
	services: Record<string, unknown>;
	queue: unknown;
	email: unknown;
	storage: unknown;
	kv: unknown;
	executor: unknown;
	logger: unknown;
	search: unknown;
	realtime: unknown;
	collections: unknown;
	globals: unknown;
	tables?: unknown;
	t: unknown;
};

/**
 * Extract flat AppContext services from a Questpie app instance.
 * Used internally by context creation functions (hooks, access, routes, jobs).
 *
 * @deprecated Prefer `createContext()` from your generated index — it returns a fully
 * typed `AppContext` and handles service resolution automatically.
 * `extractAppServices` remains for internal framework use but should not be called
 * directly in user code.
 *
 * @param app - Questpie app instance (typed as `any` to avoid circular deps)
 * @param overrides - Optional overrides (e.g. db from transaction, session from request)
 * @returns Flat service object matching AppContext shape
 */
export function extractAppServices(
	app: any,
	overrides?: {
		db?: any;
		session?: any;
		locale?: string;
		scope?: import("#questpie/server/config/request-scope.js").RequestScope;
	},
): AppContext {
	if (!app) return { db: overrides?.db } as unknown as AppContext;
	const result: ExtractAppServicesBase & Record<string, unknown> = {
		app,
		db: overrides?.db ?? app.db,
		session: overrides?.session ?? null,
		services: {},
		queue: app.queue,
		email: app.email,
		storage: app.storage,
		kv: app.kv,
		executor: app.executor,
		logger: app.logger,
		search: app.search,
		realtime: app.realtime,
		collections: app.collections,
		globals: app.globals,
		t: app.t,
	};

	const serviceDefs = app._serviceDefs ?? app.config?.services;
	if (serviceDefs) {
		const services: Record<string, unknown> = {};

		for (const [name, input] of Object.entries(
			serviceDefs as Record<string, any>,
		)) {
			const instance = app.resolveService(
				name,
				{
					db: result.db,
					session: result.session,
					locale: overrides?.locale,
				},
				overrides?.scope,
			);

			const state =
				input && typeof input === "object" && "state" in input
					? (input.state as Record<string, unknown>)
					: (input as Record<string, unknown>);
			const namespace = state?.namespace as string | null | undefined;

			if (namespace === undefined || namespace === "services") {
				services[name] = instance;
				continue;
			}

			if (namespace === null) {
				// Don't override already-set context values (db, session, locale, etc.)
				// These are managed by createContext() / extractAppServices() directly.
				if (!(name in result)) {
					result[name] = instance;
				}
				continue;
			}

			if (!(namespace in result) || typeof result[namespace] !== "object") {
				result[namespace] = {};
			}

			(result[namespace] as Record<string, unknown>)[name] = instance;
		}

		result.services = services;
	}

	return result as unknown as AppContext;
}
