import type { BetterAuthOptions } from "better-auth";
import { betterAuth } from "better-auth";
import type { Session, User } from "better-auth/types";
import type { PgTable } from "drizzle-orm/pg-core";

import {
	type Collection,
	CollectionBuilder,
} from "#questpie/server/collection/builder/index.js";
import type {
	AnyCollectionState,
	RelationConfig,
} from "#questpie/server/collection/builder/types.js";
import { extractAppServices } from "#questpie/server/config/app-context.js";
import {
	accessModeForPrincipal,
	runWithContext,
} from "#questpie/server/config/context.js";
import type {
	Principal,
	RequestContext,
} from "#questpie/server/config/context.js";
import { QuestpieMigrationsAPI } from "#questpie/server/config/integrated/migrations-api.js";
import {
	QuestpieAPI,
	type QuestpieApi,
} from "#questpie/server/config/integrated/questpie-api.js";
import { QuestpieSeedsAPI } from "#questpie/server/config/integrated/seeds-api.js";
import {
	RequestScope,
	runInFreshRequestScope,
} from "#questpie/server/config/request-scope.js";
import type {
	AccessMode,
	DbCloseFn,
	DrizzleClientFromQuestpieConfig,
	Locale,
	StorageFromQuestpieConfig,
	TablesFromConfig,
} from "#questpie/server/config/types.js";
import { GlobalBuilder } from "#questpie/server/global/builder/global-builder.js";
import type { Global } from "#questpie/server/global/builder/global.js";
import type { CrdtRuntimeManifests } from "#questpie/server/modules/core/integrated/crdt/manifest-runtime.js";
import {
	createCrdtRegistry,
	type CrdtRegistry,
} from "#questpie/server/modules/core/integrated/crdt/registry.js";
import { questpieCrdtTables } from "#questpie/server/modules/core/integrated/crdt/schema.js";
import type { ExecutorService } from "#questpie/server/modules/core/integrated/executor/service.js";
import type { KVService } from "#questpie/server/modules/core/integrated/kv/service.js";
import type { LoggerService } from "#questpie/server/modules/core/integrated/logger/service.js";
import type { MailerService } from "#questpie/server/modules/core/integrated/mailer/service.js";
import type { ObservabilityService } from "#questpie/server/modules/core/integrated/observability/service.js";
import { questpieQueueDispatchTable } from "#questpie/server/modules/core/integrated/queue/dispatch-table.js";
import type { QueueClient } from "#questpie/server/modules/core/integrated/queue/types.js";
import {
	questpieChannelAuthorityFenceTable,
	questpieChannelAuthorityRevocationTable,
	questpieChannelDispatchTable,
	questpieChannelEventTable,
	questpieChannelHeadTable,
	questpieChannelPresenceTable,
	questpieRealtimeLogTable,
	questpieRealtimeTopologyTable,
} from "#questpie/server/modules/core/integrated/realtime/collection.js";
import type { RealtimeService } from "#questpie/server/modules/core/integrated/realtime/service.js";
import type { SearchService } from "#questpie/server/modules/core/integrated/search/types.js";
import {
	questpieStorageCleanupTable,
	questpieStorageObjectKeyTable,
} from "#questpie/server/modules/core/integrated/storage/cleanup-table.js";
import { resolveAutoSeedCategories } from "#questpie/server/seed/types.js";
import {
	ServiceBuilder,
	type ServiceCreateContext,
	type ServiceLifecycle,
} from "#questpie/server/services/define-service.js";
import { getNodeEnv } from "#questpie/server/utils/env.js";
import { DEFAULT_LOCALE } from "#questpie/shared/constants.js";
import type {
	AnyCollectionOrBuilder,
	AnyGlobal,
	AnyGlobalBuilder,
} from "#questpie/shared/type-utils.js";

import type { GlobalHooksState } from "./global-hooks-types.js";
import type { RuntimeConfigExtensions } from "./module-types.js";
import type { GetMessageKeys, QuestpieConfig } from "./types.js";

interface ResolvedServiceDefinition {
	lifecycle: ServiceLifecycle;
	create: (ctx: ServiceCreateContext) => unknown | Promise<unknown>;
	dispose?: (instance: unknown) => void | Promise<void>;
	namespace: string | null;
}

/**
 * Context keys a `appConfig({ context })` resolver should not return.
 * Base request keys (`session`, `db`, …) and per-operation keys (`data`,
 * `input`, …) are set by the framework after the extension merge — a
 * resolver-returned value never lands. `collections`/`globals` would shadow
 * the typed entity APIs in rule/hook contexts — almost certainly a mistake.
 */
const RESERVED_CONTEXT_KEYS = new Set([
	"session",
	"principal",
	"actor",
	"db",
	"locale",
	"defaultLocale",
	"localeFallback",
	"accessMode",
	"stage",
	"request",
	"requestId",
	"traceId",
	"data",
	"input",
	"original",
	"operation",
	"params",
	"app",
	"collections",
	"globals",
	"~contextExtensions",
]);

/**
 * Reconstruct a {@link Principal} from the legacy `session` + `accessMode`
 * inputs so `accessMode` can be derived from a single source of truth while
 * reproducing today's two access modes exactly.
 *
 * - `"system"` → `{ kind: "system" }` (full-access bypass, today's stdio path).
 * - `"user"` **with** a resolved session → `{ kind: "user", user, session }`.
 * - `"user"` **without** a session → `undefined` (no user to attach; the caller
 *   keeps the legacy `"user"` accessMode). Matches the session-less HTTP /
 *   explicit `{ accessMode: "user" }` path.
 */
function principalFromLegacy(
	session: { user: User; session: Session } | null | undefined,
	accessMode: AccessMode,
): Principal | undefined {
	if (accessMode === "system") {
		return { kind: "system" };
	}
	if (session?.user) {
		return { kind: "user", user: session.user, session: session.session };
	}
	return undefined;
}

export class Questpie<TConfig extends QuestpieConfig = QuestpieConfig> {
	private _collections: Record<string, Collection<AnyCollectionState>> = {};
	private _globals: Record<string, AnyGlobal> = {};
	private _singletonServices: Record<string, any> = {};
	private _singletonServiceOrder: string[] = [];
	private _serviceDefs: Record<string, ResolvedServiceDefinition> = {};
	private _customServiceNamespaces = new Set<string>();
	private _warnedContextExtensionKeys = new Set<string>();
	public readonly config: TConfig;
	public readonly crdtRegistry: CrdtRegistry;
	public crdtManifests: CrdtRuntimeManifests = Object.freeze({
		collections: Object.freeze({}),
		globals: Object.freeze({}),
	});
	/** @internal Qualified host application installed by the CRDT session kernel. */
	private resolvedLocales: Locale[] | null = null;

	/**
	 * @internal Exposed for service definitions (db, realtime).
	 * Stores the database cleanup callback supplied by the db service.
	 */
	public _dbCleanup?: DbCloseFn;
	/**
	 * @internal Exposed for service definitions (realtime).
	 * Stores the PG connection string for PgNotify adapter.
	 */
	public _pgConnectionString?: string;

	/**
	 * Default access control for all collections and globals.
	 * Applied when a collection/global doesn't define its own `.access()` rules.
	 *
	 * Set via `.defaultAccess()` on the builder. The `starterModule` sets this to
	 * require an authenticated session for all CRUD operations.
	 *
	 * Even without this, the framework falls back to requiring a session
	 * (see `executeAccessRule` in access-control.ts).
	 */
	public readonly defaultAccess: TConfig["defaultAccess"];

	/**
	 * Global lifecycle hooks that fire for ALL collections/globals.
	 */
	public readonly globalHooks: GlobalHooksState;

	/**
	 * Backend translator function for i18n
	 * Translates error messages and system messages
	 *
	 * Project messages are discovered from `questpie/server/messages/<locale>.ts`:
	 * ```ts title="questpie/server/messages/en.ts"
	 * export default { "custom.key": "Value" } as const;
	 * ```
	 *
	 * Generated apps can translate both module and project messages:
	 * ```ts
	 * app.t("error.notFound"); // Type-safe from starterModule
	 * app.t("custom.key");     // Type-safe from messages
	 * ```
	 *
	 * @example
	 * ```ts
	 * app.t("error.notFound", { resource: "User" }, "sk");
	 * // => "Záznam nenájdený" (in Slovak)
	 * ```
	 */
	public t!: (
		key: GetMessageKeys<TConfig> | (string & {}),
		params?: Record<string, unknown>,
		locale?: string,
	) => string;

	/**
	 * Better Auth instance - properly typed based on auth configuration
	 * Type is inferred from the AuthConfig passed to .auth() in the builder
	 */
	public auth!: TConfig["auth"] extends BetterAuthOptions
		? ReturnType<typeof betterAuth<TConfig["auth"]>>
		: ReturnType<typeof betterAuth<BetterAuthOptions>>;
	public storage!: StorageFromQuestpieConfig<TConfig>;
	public queue!: QueueClient<NonNullable<TConfig["queue"]>["jobs"]>;
	public email!: MailerService;
	public kv!: KVService;
	public executor!: ExecutorService;
	public logger!: LoggerService;
	public observability!: ObservabilityService;
	public search!: SearchService;
	public realtime!: RealtimeService;
	/** @internal App-owned CRDT operational coordinator; request APIs resolve through the service container. */
	public crdtOperations!: import("#questpie/server/modules/core/integrated/crdt/server-service.js").QuestpieCrdtOperationalService;
	/** Extension state for plugin-contributed configurations (admin layout, blocks, sidebar, etc.) */
	public state?: {
		config?: import("./app-state-config.js").ResolvedAppStateConfig;
	} & Partial<RuntimeConfigExtensions> &
		Record<string, unknown>;

	/**
	 * Validated app environment (from `env.ts`, via `AppDefinition.env`).
	 * The generated app type narrows this to the inferred env shape.
	 */
	public env: Readonly<Record<string, unknown>> = {};

	public migrations!: QuestpieMigrationsAPI<TConfig>;
	public seeds!: QuestpieSeedsAPI<TConfig>;
	private _api: QuestpieApi<TConfig>;

	/**
	 * Access collections CRUD operations.
	 * @example
	 * await app.collections.users.create({ email: '...' }, context)
	 * await app.collections.posts.find({ where: { status: 'published' } })
	 */
	public get collections(): QuestpieApi<TConfig>["collections"] {
		return this._api.collections;
	}

	/**
	 * Access globals CRUD operations.
	 * @example
	 * await app.globals.settings.get()
	 * await app.globals.settings.update({ siteName: 'New name' })
	 */
	public get globals(): QuestpieApi<TConfig>["globals"] {
		return this._api.globals;
	}

	public db!: DrizzleClientFromQuestpieConfig<TConfig>;

	private _initPromise: Promise<void> | null = null;

	constructor(config: TConfig) {
		this.config = config;
		this.defaultAccess = config.defaultAccess;
		const rawHooks = config.globalHooks ?? { collections: [], globals: [] };
		this.globalHooks = {
			collections: Array.isArray(rawHooks.collections)
				? rawHooks.collections
				: rawHooks.collections
					? [rawHooks.collections]
					: [],
			globals: Array.isArray(rawHooks.globals)
				? rawHooks.globals
				: rawHooks.globals
					? [rawHooks.globals]
					: [],
		};

		// Register collections from config
		this.registerCollections(config.collections);

		if (config.globals) {
			this.registerGlobals(config.globals);
		}

		this.crdtRegistry = createCrdtRegistry({
			collections: this._collections,
			globals: this._globals,
		});

		// Inject global hooks into individual collection/global hooks
		this.injectGlobalHooks();

		// Validate all relations point to existing collections
		this.validateRelations();

		// Create API (lazy — no db needed at construction time)
		this._api = new QuestpieAPI(this) as QuestpieApi<TConfig>;

		// Resolve service definitions so _initServices can use them
		this._resolveServiceDefs();
	}

	/**
	 * Wait for auto-initialization (migrations + seeds) to complete.
	 * No-op if autoMigrate/autoSeed are not configured.
	 * Safe to call multiple times.
	 *
	 * @example
	 * ```ts
	 * const app = q.build({ autoMigrate: true, autoSeed: "required" });
	 * await app.waitForInit(); // Wait for migrations + seeds
	 * // Now safe to serve requests
	 * ```
	 */
	async waitForInit(): Promise<void> {
		if (this._initPromise) await this._initPromise;
	}

	/**
	 * Gracefully closes all database connections and background services.
	 *
	 * Call this during server shutdown or HMR teardown to prevent connection leaks.
	 *
	 * Generated app entrypoints install the corresponding HMR teardown.
	 */
	async destroy(): Promise<void> {
		const errors: unknown[] = [];
		for (
			let index = this._singletonServiceOrder.length - 1;
			index >= 0;
			index--
		) {
			const name = this._singletonServiceOrder[index]!;
			const def = this._serviceDefs[name];
			if (!def?.dispose) continue;
			try {
				await def.dispose(this._singletonServices[name]);
			} catch (error) {
				errors.push(error);
			}
		}

		this._singletonServices = {};
		this._singletonServiceOrder = [];

		// Close raw DB connection/client if one was created by the db service.
		try {
			await this._dbCleanup?.();
		} catch (error) {
			errors.push(error);
		}
		this._dbCleanup = undefined;

		if (errors.length > 0) {
			throw new AggregateError(
				errors,
				"Failed to dispose one or more singleton services",
			);
		}
	}

	private async _autoInit(): Promise<void> {
		try {
			if (this.config.autoMigrate) {
				await this.migrations.up();
			}
			if (this.config.autoSeed) {
				const categories = resolveAutoSeedCategories(this.config.autoSeed);
				await this.seeds.run(categories ? { category: categories } : {});
			}
		} catch (err) {
			this.logger.error("[QUESTPIE] Auto-initialization failed:", err);
			throw err;
		}
	}

	private _normalizeServiceNamespace(
		namespace: string | null | undefined,
	): string | null {
		if (namespace === undefined || namespace === "services") {
			return "services";
		}

		if (namespace === "") {
			throw new Error(
				"[QUESTPIE] Service namespace cannot be an empty string.",
			);
		}

		return namespace;
	}

	private _resolveServiceDefs(): void {
		this._serviceDefs = {};
		this._customServiceNamespaces.clear();

		if (!this.config.services) return;

		for (const [name, input] of Object.entries(this.config.services)) {
			const state =
				input instanceof ServiceBuilder
					? input.state
					: (((input as { state?: unknown }).state as
							| Record<string, unknown>
							| undefined) ?? (input as Record<string, unknown>));

			if (!state || typeof state !== "object") {
				throw new Error(
					`[QUESTPIE] Service "${name}" is invalid. Use service().create(...) or service({ create: ... }).`,
				);
			}

			if (typeof state.create !== "function") {
				throw new Error(`[QUESTPIE] Service "${name}" must define create().`);
			}

			const lifecycle = (state.lifecycle ?? "singleton") as ServiceLifecycle;
			if (lifecycle !== "singleton" && lifecycle !== "request") {
				throw new Error(
					`[QUESTPIE] Service "${name}" has invalid lifecycle "${String(state.lifecycle)}".`,
				);
			}

			const namespace = this._normalizeServiceNamespace(
				state.namespace as string | null | undefined,
			);

			// Request-scoped services can use namespace: null (top-level on ctx)
			// or namespace: "services" (default). Custom namespaces are singleton-only.
			if (
				lifecycle === "request" &&
				namespace !== "services" &&
				namespace !== null
			) {
				throw new Error(
					`[QUESTPIE] Service "${name}" uses namespace "${namespace}" but only singleton services may use custom namespaces. Use namespace: null or "services" for request-scoped services.`,
				);
			}

			this._serviceDefs[name] = {
				lifecycle,
				create: state.create as (
					ctx: ServiceCreateContext,
				) => unknown | Promise<unknown>,
				dispose: state.dispose as
					| ((instance: unknown) => void | Promise<void>)
					| undefined,
				namespace,
			};

			if (namespace !== "services" && namespace !== null) {
				this._customServiceNamespaces.add(namespace);
			}
		}
	}

	/**
	 * Infrastructure service name → Questpie property name mapping.
	 * Defines resolution order (topological): independent services first,
	 * then services that depend on earlier ones.
	 */
	private static readonly _INFRA_SERVICES: ReadonlyArray<
		readonly [serviceName: string, propertyName: string]
	> = [
		// Tier 0: no dependencies (config only)
		["i18n", "t"],
		["logger", "logger"],
		// Tier 0 on purpose: the HTTP adapter opens the root span before any
		// other service is touched, so observability must exist by then.
		["observability", "observability"],
		["kv", "kv"],
		["executor", "executor"],
		["db", "db"],
		["email", "email"],
		["storage", "storage"],
		// Tier 1: depend on db and/or logger
		["auth", "auth"],
		["search", "search"],
		["realtime", "realtime"],
		["crdtOperations", "crdtOperations"],
		// Tier 2: depend on logger + needs app.createContext
		["queue", "queue"],
	] as const;

	async _initServices(): Promise<void> {
		// Phase 1: Resolve infrastructure services in dependency order.
		// After each, assign to `this.*` so subsequent services can read them.
		for (const [svcName, propName] of Questpie._INFRA_SERVICES) {
			const def = this._serviceDefs[svcName];
			if (!def) continue;

			const result = await this._resolveSingletonService(svcName, {
				stack: [],
				lazyTriggered: false,
				allowAsync: true,
			});
			(this as any)[propName] = result;
		}

		// Wire search service → queue for per-instance debounced indexing
		if (
			this.search &&
			typeof (this.queue as any)?.["index-records"]?.publish === "function"
		) {
			(this.search as any)._queuePublish = (payload: any) =>
				(this.queue as any)["index-records"].publish(payload);
		}

		// Create migrations and seeds now that db is available
		this.migrations = new QuestpieMigrationsAPI(this);
		this.seeds = new QuestpieSeedsAPI(this);

		// Phase 2: Resolve remaining singleton services (user-defined)
		for (const [name, def] of Object.entries(this._serviceDefs)) {
			if (def.lifecycle !== "singleton") continue;
			// Skip infrastructure services — already resolved
			if (Questpie._INFRA_SERVICES.some(([svcName]) => svcName === name)) {
				continue;
			}

			await this._resolveSingletonService(name, {
				stack: [],
				lazyTriggered: false,
				allowAsync: true,
			});
		}

		if (
			!this._initPromise &&
			(this.config.autoMigrate || this.config.autoSeed)
		) {
			this._initPromise = this._autoInit();
		}
	}

	private _createServiceContext(options: {
		requestDeps?: Record<string, any>;
		stack: string[];
		scope?: RequestScope;
	}): ServiceCreateContext {
		const namespaceProxyCache = new Map<string, Record<string, unknown>>();
		const { requestDeps, stack } = options;

		const resolveFromProxy = (serviceName: string): unknown => {
			return this._resolveServiceFromProxy(serviceName, {
				requestDeps,
				stack,
				scope: options.scope,
			});
		};

		const getNamespaceProxy = (namespace: string): Record<string, unknown> => {
			const existing = namespaceProxyCache.get(namespace);
			if (existing) return existing;

			const proxy = new Proxy<Record<string, unknown>>(
				{},
				{
					get: (_target, prop) => {
						if (typeof prop !== "string") return undefined;
						const def = this._serviceDefs[prop];
						if (!def || def.namespace !== namespace) return undefined;
						return resolveFromProxy(prop);
					},
					has: (_target, prop) => {
						if (typeof prop !== "string") return false;
						const def = this._serviceDefs[prop];
						return !!def && def.namespace === namespace;
					},
				},
			);

			namespaceProxyCache.set(namespace, proxy);
			return proxy;
		};

		const context = {
			...requestDeps,
			db: requestDeps?.db ?? this.db,
			queue: this.queue,
			storage: this.storage,
			kv: this.kv,
			executor: this.executor,
			logger: this.logger,
			observability: this.observability,
			search: this.search,
			realtime: this.realtime,
			email: this.email,
			auth: this.auth,
			app: this,
			collections: this.collections,
			globals: this.globals,
			t: this.t,
		} as Record<string, unknown>;

		return new Proxy(context, {
			get: (target, prop, receiver) => {
				if (typeof prop !== "string") {
					return Reflect.get(target, prop, receiver);
				}

				if (Object.hasOwn(target, prop)) {
					return target[prop];
				}

				const topLevelDef = this._serviceDefs[prop];
				if (topLevelDef?.namespace === null) {
					return resolveFromProxy(prop);
				}

				if (this._customServiceNamespaces.has(prop)) {
					return getNamespaceProxy(prop);
				}

				if (prop === "services") {
					return getNamespaceProxy("services");
				}

				return undefined;
			},
			has: (target, prop) => {
				if (typeof prop !== "string") return false;
				if (Object.hasOwn(target, prop)) return true;
				if (prop === "services") return true;
				if (this._customServiceNamespaces.has(prop)) return true;
				const topLevelDef = this._serviceDefs[prop];
				return !!topLevelDef && topLevelDef.namespace === null;
			},
		}) as unknown as ServiceCreateContext;
	}

	private _resolveServiceFromProxy(
		name: string,
		options: {
			requestDeps?: Record<string, any>;
			stack: string[];
			scope?: RequestScope;
		},
	): unknown {
		const def = this._serviceDefs[name];
		if (!def) return undefined;

		if (def.lifecycle === "singleton") {
			return this._resolveSingletonService(name, {
				requestDeps: options.requestDeps,
				stack: options.stack,
				lazyTriggered: true,
				allowAsync: false,
			});
		}

		if (
			!options.scope &&
			options.stack.some(
				(dependency) =>
					this._serviceDefs[dependency]?.lifecycle === "singleton",
			)
		) {
			throw new Error(
				`[QUESTPIE] Singleton service cannot depend on request-scoped service "${name}". Move the dependency to a request-scoped service or pass it to the singleton method explicitly.`,
			);
		}

		const create = () =>
			this._createServiceInstance(name, def, {
				requestDeps: options.requestDeps,
				stack: options.stack,
				scope: options.scope,
				cacheSingleton: false,
				lazyTriggered: true,
				allowAsync: false,
			});

		return options.scope
			? options.scope.getOrCreate(name, create, def.dispose)
			: create();
	}

	private _resolveSingletonService(
		name: string,
		options: {
			requestDeps?: Record<string, any>;
			stack: string[];
			lazyTriggered: boolean;
			allowAsync: boolean;
		},
	): unknown | Promise<unknown> {
		if (Object.hasOwn(this._singletonServices, name)) {
			return this._singletonServices[name];
		}

		const def = this._serviceDefs[name];
		if (!def) return undefined;

		return this._createServiceInstance(name, def, {
			requestDeps: options.requestDeps,
			stack: options.stack,
			cacheSingleton: true,
			lazyTriggered: options.lazyTriggered,
			allowAsync: options.allowAsync,
		});
	}

	private _createServiceInstance(
		name: string,
		def: ResolvedServiceDefinition,
		options: {
			requestDeps?: Record<string, any>;
			stack: string[];
			scope?: RequestScope;
			cacheSingleton: boolean;
			lazyTriggered: boolean;
			allowAsync: boolean;
		},
	): unknown | Promise<unknown> {
		this._assertNoCircularServiceDependency(name, options.stack);
		const stack = [...options.stack, name];
		const context = this._createServiceContext({
			requestDeps: options.requestDeps,
			stack,
			scope: options.scope,
		});
		const created = def.create(context);

		if (created instanceof Promise) {
			if (!options.allowAsync) {
				if (options.lazyTriggered) {
					throw new Error(
						`[QUESTPIE] Service "${name}" has async create() but was lazily triggered. Reorder services so "${name}" initializes first.`,
					);
				}

				throw new Error(
					`[QUESTPIE] Service "${name}" has async create() but this resolution path is synchronous.`,
				);
			}

			return created.then((instance) => {
				if (options.cacheSingleton) {
					this._singletonServices[name] = instance;
					this._singletonServiceOrder.push(name);
				}
				return instance;
			});
		}

		if (options.cacheSingleton) {
			this._singletonServices[name] = created;
			this._singletonServiceOrder.push(name);
		}

		return created;
	}

	private _assertNoCircularServiceDependency(
		name: string,
		stack: string[],
	): void {
		const existingIndex = stack.indexOf(name);
		if (existingIndex === -1) return;

		const cycle = [...stack.slice(existingIndex), name].join(" -> ");
		throw new Error(
			`[QUESTPIE] Circular service dependency detected: ${cycle}`,
		);
	}

	/**
	 * Resolve a service by name (singleton or create request-scoped).
	 * @internal Used by context creation for flat service injection.
	 */
	resolveService(
		name: string,
		requestDeps?: Record<string, any>,
		scope?: RequestScope,
	): any {
		const def = this._serviceDefs[name];
		if (!def) return undefined;

		if (def.lifecycle === "singleton") {
			if (!Object.hasOwn(this._singletonServices, name)) {
				throw new Error(
					`[QUESTPIE] Singleton service "${name}" is not initialized. Await createApp() before accessing services.`,
				);
			}
			return this._singletonServices[name];
		}

		// Scope-aware: memoize request-scoped services within the scope
		if (scope) {
			return scope.getOrCreate(
				name,
				() =>
					this._createServiceInstance(name, def, {
						requestDeps,
						stack: [],
						scope,
						cacheSingleton: false,
						lazyTriggered: false,
						allowAsync: false,
					}),
				def.dispose,
			);
		}

		return this._createServiceInstance(name, def, {
			requestDeps,
			stack: [],
			cacheSingleton: false,
			lazyTriggered: false,
			allowAsync: false,
		});
	}

	private registerCollections(
		collections: Record<string, AnyCollectionOrBuilder>,
	) {
		for (const [key, item] of Object.entries(collections)) {
			// Auto-build if it's a CollectionBuilder
			const collection =
				item instanceof CollectionBuilder ? item.build() : item;

			if (this._collections[key]) {
				throw new Error(
					`Collection "${collection.name}" is already registered.`,
				);
			}
			this._collections[key] = collection;
		}
	}

	private registerGlobals(
		globals: Record<string, AnyGlobal | AnyGlobalBuilder>,
	) {
		for (const [key, item] of Object.entries(globals)) {
			// Auto-build if it's a GlobalBuilder
			const global = item instanceof GlobalBuilder ? item.build() : item;

			if (this._globals[key]) {
				throw new Error(`Global "${key}" is already registered.`);
			}
			this._globals[key] = global;
		}
	}

	/**
	 * Inject global hooks directly into each collection's and global's own hooks.
	 *
	 * This merges hooks registered via `.hooks()` on modules (e.g. audit module)
	 * into the individual entity's hook arrays so they execute via the standard
	 * `executeHooks` path in the CRUD generators. No separate execution needed.
	 *
	 * - `before*` hooks propagate errors (can abort operations).
	 * - `after*` hooks are wrapped with try/catch (errors logged, not propagated).
	 * - Deduplicates entries that appear multiple times due to `.use()` composition.
	 */
	private injectGlobalHooks(): void {
		// NOTE: Collection global hooks are handled by executeCollectionHooksWithGlobal
		// in crud-generator.ts — no injection needed here.
		// NOTE: Global global hooks are handled by executeHooksWithGlobal and
		// executeTransitionHooksWithGlobal in global-crud-generator.ts. Injecting
		// them into entity hooks here would execute module hooks twice.
	}

	/**
	 * Validates that all relations reference existing collections.
	 * This catches configuration errors early at build time rather than at runtime.
	 */
	private validateRelations() {
		const collectionKeys = Object.keys(this._collections);
		const globalKeys = Object.keys(this._globals);
		const relationTargetKeys = [...collectionKeys, ...globalKeys];
		const errors: string[] = [];

		// Validate collection relations
		for (const [collectionKey, collection] of Object.entries(
			this._collections,
		)) {
			const relations = (collection.state.relations || {}) as Record<
				string,
				RelationConfig
			>;
			for (const [relationName, relation] of Object.entries(relations)) {
				// Validate target collection
				if (
					relation.collection &&
					!relationTargetKeys.includes(relation.collection)
				) {
					errors.push(
						`Collection "${collectionKey}" has relation "${relationName}" pointing to unknown target "${relation.collection}". ` +
							`Available collections/globals: ${relationTargetKeys.join(", ")}`,
					);
				}
				// Validate through/junction collection for many-to-many
				if (relation.through && !collectionKeys.includes(relation.through)) {
					errors.push(
						`Collection "${collectionKey}" has relation "${relationName}" with "through: ${relation.through}" pointing to unknown collection. ` +
							`Did you mean one of: ${collectionKeys.join(", ")}?`,
					);
				}
			}
		}

		// Validate global relations
		for (const [globalKey, global] of Object.entries(this._globals)) {
			const relations = (global.state.relations || {}) as Record<
				string,
				RelationConfig
			>;
			for (const [relationName, relation] of Object.entries(relations)) {
				// Validate target collection
				if (
					relation.collection &&
					!relationTargetKeys.includes(relation.collection)
				) {
					errors.push(
						`Global "${globalKey}" has relation "${relationName}" pointing to unknown target "${relation.collection}". ` +
							`Available collections/globals: ${relationTargetKeys.join(", ")}`,
					);
				}
				// Validate through/junction collection for many-to-many
				if (relation.through && !collectionKeys.includes(relation.through)) {
					errors.push(
						`Global "${globalKey}" has relation "${relationName}" with "through: ${relation.through}" pointing to unknown collection. ` +
							`Did you mean one of: ${collectionKeys.join(", ")}?`,
					);
				}
			}
		}

		if (errors.length > 0) {
			throw new Error(
				`QUESTPIE: Invalid relation configuration:\n\n${errors.map((e) => `  - ${e}`).join("\n\n")}`,
			);
		}
	}

	public getCollectionConfig<TName extends keyof TConfig["collections"]>(
		name: TName,
	): TConfig["collections"][TName] extends Collection<infer TState>
		? Collection<TState>
		: TConfig["collections"][TName] extends CollectionBuilder<infer TState>
			? Collection<TState>
			: never {
		const collection = this._collections[name as string];
		if (!collection) {
			throw new Error(`Collection "${String(name)}" not found.`);
		}
		return collection as any;
	}

	public getGlobalConfig<TName extends keyof NonNullable<TConfig["globals"]>>(
		name: TName,
	): NonNullable<TConfig["globals"]>[TName] extends Global<infer TState>
		? Global<TState>
		: NonNullable<TConfig["globals"]>[TName] extends GlobalBuilder<infer TState>
			? Global<TState>
			: never {
		const global = this._globals[name as string];
		if (!global) {
			throw new Error(`Global "${String(name)}" not found.`);
		}
		return global as any;
	}

	public async getLocales(): Promise<Locale[]> {
		if (this.resolvedLocales) return this.resolvedLocales;

		if (!this.config.locale) {
			this.resolvedLocales = [
				{
					code: "en",
				},
			];
			return this.resolvedLocales;
		}

		if (Array.isArray(this.config.locale.locales)) {
			this.resolvedLocales = this.config.locale.locales;
		} else {
			this.resolvedLocales = await this.config.locale.locales();
		}

		return this.resolvedLocales;
	}

	/**
	 * Create request context
	 * Returns minimal context with session, locale, accessMode
	 * Services are accessed via app.* not context.*
	 *
	 * Single derivation point for `appConfig({ context })`: when a `request` is
	 * present and extensions haven't been resolved yet, the resolver runs here
	 * (once per HTTP request). The result is merged flat AND carried as the
	 * `"~contextExtensions"` bundle so it travels into access rules, hooks,
	 * and `getContext()`.
	 *
	 * @default accessMode: 'system' - API is backend-only by default
	 */
	public async createContext(
		userCtx: {
			/** Auth session from Better Auth (contains user + session) */
			session?: { user: any; session: any } | null;
			/**
			 * Discriminated identity for this request. When provided it is the
			 * source of truth and `accessMode` is derived from it. When omitted,
			 * a principal is derived from `session`/`accessMode` for back-compat.
			 */
			principal?: Principal;
			actor?: import("#questpie/server/modules/core/integrated/crdt/authority.js").AuthorityActor;
			locale?: string;
			accessMode?: AccessMode;
			stage?: string;
			requestId?: string;
			traceId?: string;
			db?: any;
			/** Incoming request (if in HTTP scope) */
			request?: Request;
			/**
			 * Pre-resolved request-context extensions bundle. Present when
			 * re-entering an already-resolved context (idempotence by presence).
			 * @internal
			 */
			"~contextExtensions"?: Record<string, unknown>;
		} = {},
	): Promise<RequestContext> {
		const defaultLocale = this.config.locale?.defaultLocale || DEFAULT_LOCALE;
		let locale = userCtx.locale || defaultLocale;

		// Validate locale if provided
		if (userCtx.locale) {
			const locales = await this.getLocales();
			if (!locales.find((l) => l.code === userCtx.locale)) {
				// Fallback logic
				if (this.config.locale?.fallbacks?.[userCtx.locale]) {
					locale = this.config.locale.fallbacks[userCtx.locale];
				} else {
					locale = defaultLocale;
				}
			}
		}

		// accessMode defaults (legacy inputs):
		// - explicit override has highest precedence
		// - with request → "user" (HTTP scope, access rules apply)
		// - without request → "system" (job/script scope, bypass access)
		const legacyAccessMode: AccessMode =
			userCtx.accessMode ?? (userCtx.request ? "user" : "system");

		// Resolve the effective principal. When callers hand us one (e.g. the
		// OAuth path) it is authoritative; otherwise reconstruct it from the
		// legacy session/accessMode inputs so `accessMode` can be *derived* from
		// a single source of truth while reproducing today's behavior exactly.
		const principal: Principal | undefined =
			userCtx.principal ??
			principalFromLegacy(userCtx.session, legacyAccessMode);

		// `accessMode` is derived from the principal whenever one exists (the
		// user/oauth/system cases). The session-less "user" request has no user
		// to attach, so no principal is derived and the legacy value stands.
		const accessMode: AccessMode = principal
			? accessModeForPrincipal(principal)
			: legacyAccessMode;

		// Resolve context extensions exactly once per request.
		// Idempotence by presence: contexts that already carry the bundle
		// (e.g. re-entering createContext) skip resolution.
		let extensions = userCtx["~contextExtensions"] as
			| Record<string, unknown>
			| undefined;
		if (extensions === undefined && userCtx.request) {
			extensions = await this.resolveContextExtensions({
				request: userCtx.request,
				session: userCtx.session,
				actor: userCtx.actor,
				db: userCtx.db ?? this.db,
				locale,
				stage: userCtx.stage,
				requestId: userCtx.requestId,
				traceId: userCtx.traceId,
			});
		}

		return {
			...userCtx,
			// Flat merge for handler/ctx reads — never shadows base keys below.
			...(extensions ?? {}),
			session: userCtx.session,
			...(principal ? { principal } : {}),
			...(userCtx.actor ? { actor: userCtx.actor } : {}),
			locale,
			defaultLocale,
			accessMode,
			db: userCtx.db ?? this.db,
			...(extensions !== undefined ? { "~contextExtensions": extensions } : {}),
		};
	}

	/**
	 * Run the `appConfig({ context })` resolver with the full system-mode
	 * service surface. Returns `undefined` when no resolver is configured.
	 */
	private async resolveContextExtensions(params: {
		request: Request;
		session: { user: User; session: Session } | null | undefined;
		actor?: import("#questpie/server/modules/core/integrated/crdt/authority.js").AuthorityActor;
		db: any;
		locale: string;
		stage?: string;
		requestId?: string;
		traceId?: string;
	}): Promise<Record<string, unknown> | undefined> {
		// Loose call signature on purpose: the static `ContextResolver` params
		// type is the USER-facing contract (augmented per-app by codegen); the
		// framework passes the full runtime service surface regardless.
		const resolver = this.state?.config?.app?.context as
			| ((params: Record<string, unknown>) => unknown)
			| undefined;
		if (typeof resolver !== "function") return undefined;

		const result = await runInFreshRequestScope(this, () =>
			runWithContext(
				{
					app: this,
					db: params.db,
					session: params.session,
					principal: { kind: "system" },
					actor: params.actor,
					locale: params.locale,
					accessMode: "system",
					stage: params.stage,
					requestId: params.requestId,
					traceId: params.traceId,
				},
				async () => {
					const services = extractAppServices(this, {
						db: params.db,
						session: params.session,
						locale: params.locale,
						accessMode: "system",
						principal: { kind: "system" },
						actor: params.actor,
					});

					return resolver({
						...services,
						request: params.request,
						session: params.session,
						db: params.db,
					});
				},
			),
		);
		const extensions = (result ?? {}) as Record<string, unknown>;

		if (getNodeEnv() !== "production") {
			for (const key of Object.keys(extensions)) {
				if (!RESERVED_CONTEXT_KEYS.has(key)) continue;
				if (this._warnedContextExtensionKeys.has(key)) continue;
				this._warnedContextExtensionKeys.add(key);
				this.logger.warn(
					`[QUESTPIE] appConfig({ context }) returned reserved key "${key}" — framework-set context keys cannot be shadowed by resolver results.`,
				);
			}
		}

		return extensions;
	}

	public getCollections(): {
		[K in keyof TConfig["collections"]]: TConfig["collections"][K] extends Collection<
			infer TState
		>
			? Collection<TState>
			: TConfig["collections"][K] extends CollectionBuilder<infer TState>
				? Collection<TState>
				: never;
	} {
		return this._collections as any;
	}

	public getGlobals(): {
		[K in keyof NonNullable<TConfig["globals"]>]: NonNullable<
			TConfig["globals"]
		>[K] extends Global<infer TState>
			? Global<TState>
			: NonNullable<TConfig["globals"]>[K] extends GlobalBuilder<infer TState>
				? Global<TState>
				: never;
	} {
		return this._globals as any;
	}

	public getTables(): Record<string, PgTable> {
		const tables: Record<string, PgTable> = {};
		for (const [name, collection] of Object.entries(this._collections)) {
			tables[name] = collection.table as unknown as PgTable;
			if (collection.i18nTable) {
				tables[`${name}_i18n`] = collection.i18nTable as unknown as PgTable;
			}
			if (collection.versionsTable) {
				tables[`${name}_versions`] =
					collection.versionsTable as unknown as PgTable;
			}
			if (collection.i18nVersionsTable) {
				tables[`${name}_i18n_versions`] =
					collection.i18nVersionsTable as unknown as PgTable;
			}
		}
		for (const [name, global] of Object.entries(this._globals)) {
			tables[name] = global.table as unknown as PgTable;
			if (global.i18nTable) {
				tables[`${name}_i18n`] = global.i18nTable as unknown as PgTable;
			}
			if (global.versionsTable) {
				tables[`${name}_versions`] = global.versionsTable as unknown as PgTable;
			}
			if (global.i18nVersionsTable) {
				tables[`${name}_i18n_versions`] =
					global.i18nVersionsTable as unknown as PgTable;
			}
		}
		return tables;
	}

	public get tables(): TablesFromConfig<TConfig> {
		return this.getTables() as TablesFromConfig<TConfig>;
	}

	public getSchema(): Record<string, unknown> {
		const schema: Record<string, unknown> = {};

		// 1. Add collection tables
		for (const [name, collection] of Object.entries(this._collections)) {
			schema[name] = collection.table;
			if (collection.i18nTable) {
				schema[`${name}_i18n`] = collection.i18nTable;
			}
			if (collection.versionsTable) {
				schema[`${name}_versions`] = collection.versionsTable;
			}
			if (collection.i18nVersionsTable) {
				schema[`${name}_i18n_versions`] = collection.i18nVersionsTable;
			}
		}

		// 2. Add global tables
		for (const [name, global] of Object.entries(this._globals)) {
			schema[name] = global.table;
			if (global.i18nTable) {
				schema[`${name}_i18n`] = global.i18nTable;
			}
			if (global.versionsTable) {
				schema[`${name}_versions`] = global.versionsTable;
			}
			if (global.i18nVersionsTable) {
				schema[`${name}_i18n_versions`] = global.i18nVersionsTable;
			}
		}

		// 3. Always include realtime log table since realtime service is always initialized
		schema.questpie_realtime_log = questpieRealtimeLogTable;
		schema.questpie_channel_head = questpieChannelHeadTable;
		schema.questpie_channel_event = questpieChannelEventTable;
		schema.questpie_channel_dispatch = questpieChannelDispatchTable;
		schema.questpie_channel_authority_fence =
			questpieChannelAuthorityFenceTable;
		schema.questpie_channel_authority_revocation =
			questpieChannelAuthorityRevocationTable;
		schema.questpie_channel_presence = questpieChannelPresenceTable;
		schema.questpie_realtime_topology = questpieRealtimeTopologyTable;

		// 4. CRDT recovery history is framework-owned and must remain in the
		// migration graph even when the current app has no collaborative owner.
		// Conditional removal would generate destructive DROP TABLE migrations.
		Object.assign(schema, questpieCrdtTables);

		// 5. Storage cleanup intents are durable even when no queue consumer is
		// currently running. Conditional removal would generate destructive
		// schema diffs when upload collections are toggled.
		schema.questpie_storage_cleanup = questpieStorageCleanupTable;
		schema.questpie_storage_object_key = questpieStorageObjectKeyTable;

		// 6. Queue dispatch intent remains in the migration graph even when an
		// adapter can publish directly, so changing adapters never proposes a
		// destructive DROP TABLE migration.
		schema.questpie_queue_dispatch = questpieQueueDispatchTable;

		// 7. Add search tables if adapter provides local storage schemas
		// Local adapters (Postgres, PgVector) return their tables for migration generation.
		// External adapters (Meilisearch, Elasticsearch) don't need local tables.
		const searchAdapter = this.search?.getAdapter();
		if (searchAdapter?.getTableSchemas) {
			const searchTables = searchAdapter.getTableSchemas();
			if (searchTables) {
				Object.assign(schema, searchTables);
			}
		}

		// 8. Add relations (Placeholder)
		// To enable, import { relations } from 'drizzle-orm' and uncomment logic

		return schema;
	}

	/**
	 * Resolve collection dependencies from a WITH or WHERE query fragment for
	 * realtime subscriptions. Returns every collection that should trigger a
	 * refresh (main + relations).
	 * @internal Exposed for service definitions (realtime).
	 */
	_resolveCollectionDependencies(
		baseCollection: string,
		withConfig?: Record<string, any>,
	): Set<string> {
		const dependencies = new Set<string>([baseCollection]);

		if (
			!withConfig ||
			typeof withConfig !== "object" ||
			Array.isArray(withConfig)
		) {
			return dependencies;
		}

		const collectionMap = this.getCollections();

		this.visitCollectionRelations(
			collectionMap,
			dependencies,
			baseCollection,
			withConfig,
		);

		return dependencies;
	}

	/**
	 * Resolve global dependencies from WITH config for realtime subscriptions.
	 * @internal Exposed for service definitions (realtime).
	 */
	_resolveGlobalDependencies(
		globalName: string,
		withConfig?: Record<string, any>,
	): { collections: Set<string>; globals: Set<string> } {
		const dependencies = {
			collections: new Set<string>(),
			globals: new Set<string>([globalName]),
		};

		if (
			!withConfig ||
			typeof withConfig !== "object" ||
			Array.isArray(withConfig)
		) {
			return dependencies;
		}

		const globalMap = this.getGlobals();
		const global = globalMap[globalName];
		if (!global) return dependencies;

		const collectionMap = this.getCollections();

		for (const [relationName, relationOptions] of Object.entries(withConfig)) {
			if (!relationOptions) continue;
			const relation = global.state.relations?.[relationName];
			if (!relation) continue;

			dependencies.collections.add(relation.collection);

			if (relation.type === "manyToMany" && relation.through) {
				dependencies.collections.add(relation.through);
			}

			const nestedWith =
				typeof relationOptions === "object" && !Array.isArray(relationOptions)
					? (relationOptions as any).with
					: undefined;

			if (nestedWith) {
				this.visitCollectionRelations(
					collectionMap,
					dependencies.collections,
					relation.collection,
					nestedWith as Record<string, any>,
				);
			}
		}

		return dependencies;
	}

	/**
	 * Visit collection relations recursively to build dependency tree.
	 */
	private visitCollectionRelations(
		collectionMap: Record<string, any>,
		dependencies: Set<string>,
		collectionName: string,
		withConfig?: Record<string, any>,
	): void {
		if (
			!withConfig ||
			typeof withConfig !== "object" ||
			Array.isArray(withConfig)
		) {
			return;
		}

		const collection = collectionMap[collectionName];
		if (!collection) return;

		for (const [relationName, relationOptions] of Object.entries(withConfig)) {
			if (!relationOptions) continue;
			if (relationName === "AND" || relationName === "OR") {
				const branches = Array.isArray(relationOptions)
					? relationOptions
					: [relationOptions];
				for (const branch of branches) {
					this.visitCollectionRelations(
						collectionMap,
						dependencies,
						collectionName,
						branch as Record<string, any>,
					);
				}
				continue;
			}
			if (relationName === "NOT") {
				this.visitCollectionRelations(
					collectionMap,
					dependencies,
					collectionName,
					relationOptions as Record<string, any>,
				);
				continue;
			}
			const relation = collection.state.relations?.[relationName];
			if (!relation) continue;

			dependencies.add(relation.collection);

			if (relation.type === "manyToMany" && relation.through) {
				dependencies.add(relation.through);
			}

			// Support WITH and relation-WHERE formats:
			// 1. { post: { with: { user: true } } } - explicit .with
			// 2. { post: { user: true } } - direct nesting (user is itself a relation)
			// 3. { posts: { some: { author: { is: { ... } } } } } - relation filter
			let nestedWith: Record<string, any> | undefined;

			if (
				typeof relationOptions === "object" &&
				!Array.isArray(relationOptions)
			) {
				// Check if it has explicit .with property
				if ("with" in relationOptions) {
					nestedWith = (relationOptions as any).with;
				} else {
					const relationFilter = ["some", "none", "every", "is", "isNot"]
						.map((operator) => (relationOptions as any)[operator])
						.find(
							(value) =>
								value && typeof value === "object" && !Array.isArray(value),
						);
					if (relationFilter) {
						nestedWith = relationFilter as Record<string, any>;
					} else if (relationOptions !== true) {
						// The object itself contains nested relations (direct nesting format)
						nestedWith = relationOptions as Record<string, any>;
					}
				}
			}

			if (nestedWith) {
				this.visitCollectionRelations(
					collectionMap,
					dependencies,
					relation.collection,
					nestedWith as Record<string, any>,
				);
			}
		}
	}
}
