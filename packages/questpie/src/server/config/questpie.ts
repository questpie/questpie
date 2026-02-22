import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BetterAuthOptions } from "better-auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { SQL } from "bun";
import { drizzle as drizzleBun } from "drizzle-orm/bun-sql";
import type { PgTable } from "drizzle-orm/pg-core";
import { drizzle as drizzlePgLite } from "drizzle-orm/pglite";
import { DriveManager } from "flydrive";
import {
	type Collection,
	CollectionBuilder,
} from "#questpie/server/collection/builder/index.js";
import type {
	AnyCollectionState,
	RelationConfig,
} from "#questpie/server/collection/builder/types.js";
import type { RequestContext } from "#questpie/server/config/context.js";
import { QuestpieMigrationsAPI } from "#questpie/server/config/integrated/migrations-api.js";
import {
	QuestpieAPI,
	type QuestpieApi,
} from "#questpie/server/config/integrated/questpie-api.js";
import { QuestpieSeedsAPI } from "#questpie/server/config/integrated/seeds-api.js";
import type {
	AccessMode,
	DrizzleClientFromQuestpieConfig,
	Locale,
} from "#questpie/server/config/types.js";
import {
	type Global,
	GlobalBuilder,
} from "#questpie/server/global/builder/index.js";
import { createTranslator } from "#questpie/server/i18n/translator.js";
import { KVService } from "#questpie/server/integrated/kv/index.js";
import { LoggerService } from "#questpie/server/integrated/logger/index.js";
import { MailerService } from "#questpie/server/integrated/mailer/index.js";
import {
	createQueueClient,
	type QueueClient,
} from "#questpie/server/integrated/queue/index.js";
import {
	questpieRealtimeLogTable,
	RealtimeService,
} from "#questpie/server/integrated/realtime/index.js";
import {
	createSearchService,
	type SearchService,
	type SearchServiceWrapper,
} from "#questpie/server/integrated/search/index.js";
import { createDiskDriver } from "#questpie/server/integrated/storage/create-driver.js";
import { resolveAutoSeedCategories } from "#questpie/server/seed/types.js";
import { DEFAULT_LOCALE } from "#questpie/shared/constants.js";
import type {
	AnyCollectionOrBuilder,
	AnyGlobal,
	AnyGlobalBuilder,
} from "#questpie/shared/type-utils.js";
import type { GlobalHooksState } from "./global-hooks-types.js";
import type { GetMessageKeys, QuestpieConfig } from "./types.js";

export class Questpie<TConfig extends QuestpieConfig = QuestpieConfig> {
	static readonly __internal = {
		storageDriverServiceName: "appDefault",
	};

	private _collections: Record<string, Collection<AnyCollectionState>> = {};
	private _globals: Record<string, AnyGlobal> = {};
	public readonly config: TConfig;
	private resolvedLocales: Locale[] | null = null;
	private pgConnectionString?: string;

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
	 * When using .messages() on the builder, the keys are type-safe:
	 * ```ts
	 * const app = questpie({ name: "app" })
	 *   .use(starterModule) // Includes core messages
	 *   .messages({ en: { "custom.key": "Value" } } as const)
	 *   .build({ ... });
	 *
	 * app.t("error.notFound"); // Type-safe from starterModule
	 * app.t("custom.key");     // Type-safe from .messages()
	 * ```
	 *
	 * @example
	 * ```ts
	 * app.t("error.notFound", { resource: "User" }, "sk");
	 * // => "Záznam nenájdený" (in Slovak)
	 * ```
	 */
	public readonly t: (
		key: GetMessageKeys<TConfig> | (string & {}),
		params?: Record<string, unknown>,
		locale?: string,
	) => string;

	/**
	 * Better Auth instance - properly typed based on auth configuration
	 * Type is inferred from the AuthConfig passed to .auth() in the builder
	 */
	public auth: TConfig["auth"] extends BetterAuthOptions
		? ReturnType<typeof betterAuth<TConfig["auth"]>>
		: ReturnType<typeof betterAuth<BetterAuthOptions>>;
	public storage: DriveManager<{
		[Questpie.__internal
			.storageDriverServiceName]: () => import("flydrive/types").DriverContract;
	}>;
	public queue: QueueClient<NonNullable<TConfig["queue"]>["jobs"]>;
	public email: MailerService;
	public kv: KVService;
	public logger: LoggerService;
	public search: SearchService;
	public realtime: RealtimeService;

	public migrations: QuestpieMigrationsAPI<TConfig>;
	public seeds: QuestpieSeedsAPI<TConfig>;
	public api: QuestpieApi<TConfig>;

	public db: DrizzleClientFromQuestpieConfig<TConfig>;

	private _initPromise: Promise<void> | null = null;
	private _sqlClient?: SQL;

	constructor(config: TConfig) {
		this.config = config;
		this.defaultAccess = config.defaultAccess;
		this.globalHooks = config.globalHooks ?? { collections: [], globals: [] };

		// Initialize translator
		this.t = createTranslator(config.translations);

		// Register collections from config
		this.registerCollections(config.collections);

		if (config.globals) {
			this.registerGlobals(config.globals);
		}

		// Inject global hooks into individual collection/global hooks
		this.injectGlobalHooks();

		// Validate all relations point to existing collections
		this.validateRelations();

		// Initialize database client from config
		if ("url" in config.db) {
			// Postgres via Bun SQL
			const bunSqlClient = new SQL({ url: config.db.url });
			this._sqlClient = bunSqlClient;
			this.db = drizzleBun({
				client: bunSqlClient,
				schema: this.getSchema(),
			}) as any;
			// Store connection string for pg client (used by realtime, migrations, etc.)
			this.pgConnectionString = config.db.url;
		} else {
			// PGlite for testing
			this.db = drizzlePgLite({
				client: config.db.pglite,
				schema: this.getSchema(),
			}) as any;
		}

		// Batteries Included - Guaranteed Initialization with sensible defaults
		this.kv = new KVService(config.kv);
		this.logger = new LoggerService(config.logger);

		// Initialize search service with adapter
		// config.search is now a SearchAdapter (or undefined for default)
		this.search = createSearchService(
			config.search,
			this.db as any,
			this.logger,
		);

		// Initialize search adapter asynchronously
		// This is done here but the actual initialization happens on first use
		// or can be explicitly called via app.search.initialize()
		this.search.initialize().catch((err: unknown) => {
			this.logger.error("[QuestPie] Failed to initialize search adapter:", err);
		});

		// Initialize realtime service with auto-configured adapter
		this.realtime = new RealtimeService(
			this.db as any,
			config.realtime,
			this.pgConnectionString,
		);

		// Set subscription context for dependency resolution
		this.realtime.setSubscriptionContext({
			resolveCollectionDependencies: (baseCollection, withConfig) => {
				return this.resolveCollectionDependencies(baseCollection, withConfig);
			},
			resolveGlobalDependencies: (globalName, withConfig) => {
				return this.resolveGlobalDependencies(globalName, withConfig);
			},
		});

		// Initialize queue if configured
		if (config.queue) {
			if (!config.queue.adapter) {
				throw new Error(
					"QUESTPIE: Queue adapter is required when jobs are defined. Provide adapter in .build({ queue: { adapter: ... } })",
				);
			}
			this.queue = createQueueClient(config.queue.jobs, config.queue.adapter, {
				createContext: async () => this.createContext({ accessMode: "system" }),
				getApp: () => this,
				logger: this.logger,
			}) as any;
		} else {
			this.queue = {} as any; // Empty queue client if no jobs defined
		}

		// For critical infrastructure, we currently require config or throw
		// In the future, we could provide safe "dev" defaults (e.g. local storage, console mail)

		// Resolve auth config - could be a factory function

		this.auth = betterAuth({
			...(config.auth ?? {}),
			database: drizzleAdapter(this.db, {
				provider: "pg",
				schema: this.getSchema(),
				transaction: true,
			}),
		}) as typeof this.auth;

		// Initialize storage with default or custom driver
		this.storage = new DriveManager({
			default: Questpie.__internal.storageDriverServiceName,
			fakes: {
				location: new URL(
					join(tmpdir(), "fakes", crypto.randomUUID()),
					import.meta.url,
				),
				urlBuilder: {
					// TODO: is this correct?
					generateSignedURL(key, _filePath, _optionss) {
						return Promise.resolve(`http://fake-storage.local/${key}`);
					},
					generateURL(key, _filePath) {
						return Promise.resolve(`http://fake-storage.local/${key}`);
					},
				},
			},
			services: {
				[Questpie.__internal.storageDriverServiceName]: () =>
					createDiskDriver(this.config),
			},
		});

		if (config.email?.adapter) {
			this.email = new MailerService(config.email as any);
		} else {
			throw new Error(
				"QUESTPIE: 'email.adapter' is required. Provide adapter in .build({ email: { adapter: ... } })",
			);
		}

		this.migrations = new QuestpieMigrationsAPI(this);
		this.seeds = new QuestpieSeedsAPI(this);
		this.api = new QuestpieAPI(this) as QuestpieApi<TConfig>;

		// Auto-init if configured (autoMigrate / autoSeed)
		if (config.autoMigrate || config.autoSeed) {
			this._initPromise = this._autoInit();
		}

		// In development, track this instance in globalThis so that HMR module
		// re-evaluations automatically close the previous instance's connection
		// pools instead of leaking them (postgres "too many clients" in dev).
		if (process.env.NODE_ENV !== "production") {
			const hmrKey = `__questpie_hmr_${config.app.url}`;
			const existing = (globalThis as Record<string, unknown>)[hmrKey];
			if (existing && typeof (existing as Questpie).destroy === "function") {
				(existing as Questpie).destroy().catch(() => {});
			}
			(globalThis as Record<string, unknown>)[hmrKey] = this;
		}
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
	 * @example HMR-safe singleton pattern (TanStack Start / Nitro):
	 * ```ts
	 * // app.ts
	 * declare global { var __app: typeof app | undefined }
	 *
	 * globalThis.__app ??= baseApp.build({ db: { url: DATABASE_URL }, ... })
	 * export const app = globalThis.__app
	 *
	 * if (import.meta.hot) {
	 *   import.meta.hot.dispose(async () => {
	 *     await globalThis.__app?.destroy()
	 *     globalThis.__app = undefined
	 *   })
	 * }
	 * ```
	 */
	async destroy(): Promise<void> {
		await Promise.allSettled([
			this._sqlClient?.close({ timeout: 5 }),
			this.realtime?.destroy(),
			this.queue?.stop?.(),
		]);
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
			this.logger.error("[QuestPie] Auto-initialization failed:", err);
			throw err;
		}
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
		const {
			collections: rawCollectionEntries = [],
			globals: rawGlobalEntries = [],
		} = this.globalHooks;

		// Deduplicate entries (same object ref can appear multiple times via .use() merges)
		const collectionEntries = [...new Set(rawCollectionEntries)];
		const globalEntries = [...new Set(rawGlobalEntries)];

		// Helper: check if a hook entry matches a given entity name
		const matchesFilter = (
			entry: { include?: string[]; exclude?: string[] },
			name: string,
		): boolean => {
			if (entry.include && !entry.include.includes(name)) return false;
			if (entry.exclude && entry.exclude.includes(name)) return false;
			return true;
		};

		// Helper: append a hook fn to an entity's hooks (supports array or single)
		const appendHook = (
			hooks: Record<string, any>,
			hookName: string,
			fn: (...args: any[]) => any,
		) => {
			const existing = hooks[hookName];
			if (existing) {
				const arr = Array.isArray(existing) ? existing : [existing];
				hooks[hookName] = [...arr, fn];
			} else {
				hooks[hookName] = [fn];
			}
		};

		// Inject global collection hooks
		for (const [name, collection] of Object.entries(this._collections)) {
			const state = collection.state as any;

			for (const entry of collectionEntries) {
				if (!matchesFilter(entry, name)) continue;

				if (!state.hooks) state.hooks = {};

				// Standard hooks: beforeChange, afterChange, beforeDelete, afterDelete
				for (const hookName of [
					"beforeChange",
					"afterChange",
					"beforeDelete",
					"afterDelete",
				] as const) {
					const globalFn = entry[hookName];
					if (!globalFn) continue;

					const isAfter = hookName.startsWith("after");
					const wrapped = isAfter
						? async (ctx: any) => {
								try {
									await globalFn({ ...ctx, collection: name });
								} catch (err) {
									console.error(
										`[QuestPie] Global collection hook "${hookName}" error for "${name}":`,
										err,
									);
								}
							}
						: async (ctx: any) => {
								await globalFn({ ...ctx, collection: name });
							};

					appendHook(state.hooks, hookName, wrapped);
				}

				// Transition hooks: beforeTransition, afterTransition
				for (const hookName of [
					"beforeTransition",
					"afterTransition",
				] as const) {
					const globalFn = entry[hookName];
					if (!globalFn) continue;

					const isAfter = hookName === "afterTransition";
					const wrapped = isAfter
						? async (ctx: any) => {
								try {
									await globalFn({ ...ctx, collection: name });
								} catch (err) {
									console.error(
										`[QuestPie] Global collection hook "${hookName}" error for "${name}":`,
										err,
									);
								}
							}
						: async (ctx: any) => {
								await globalFn({ ...ctx, collection: name });
							};

					appendHook(state.hooks, hookName, wrapped);
				}
			}
		}

		// Inject global global hooks
		for (const [name, global] of Object.entries(this._globals)) {
			const state = (global as any).state as any;

			for (const entry of globalEntries) {
				if (!matchesFilter(entry, name)) continue;

				if (!state.hooks) state.hooks = {};

				// Standard hooks: beforeChange, afterChange
				for (const hookName of ["beforeChange", "afterChange"] as const) {
					const globalFn = entry[hookName];
					if (!globalFn) continue;

					const isAfter = hookName === "afterChange";
					const wrapped = isAfter
						? async (ctx: any) => {
								try {
									await globalFn({ ...ctx, global: name });
								} catch (err) {
									console.error(
										`[QuestPie] Global global hook "${hookName}" error for "${name}":`,
										err,
									);
								}
							}
						: async (ctx: any) => {
								await globalFn({ ...ctx, global: name });
							};

					appendHook(state.hooks, hookName, wrapped);
				}

				// Transition hooks: beforeTransition, afterTransition
				for (const hookName of [
					"beforeTransition",
					"afterTransition",
				] as const) {
					const globalFn = entry[hookName];
					if (!globalFn) continue;

					const isAfter = hookName === "afterTransition";
					const wrapped = isAfter
						? async (ctx: any) => {
								try {
									await globalFn({ ...ctx, global: name });
								} catch (err) {
									console.error(
										`[QuestPie] Global global hook "${hookName}" error for "${name}":`,
										err,
									);
								}
							}
						: async (ctx: any) => {
								await globalFn({ ...ctx, global: name });
							};

					appendHook(state.hooks, hookName, wrapped);
				}
			}
		}
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
	 * @default accessMode: 'system' - API is backend-only by default
	 */
	public async createContext(
		userCtx: {
			/** Auth session from Better Auth (contains user + session) */
			session?: { user: any; session: any } | null;
			locale?: string;
			accessMode?: AccessMode;
			db?: any;
			[key: string]: any;
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

		return {
			...userCtx,
			session: userCtx.session,
			locale,
			defaultLocale,
			accessMode: userCtx.accessMode ?? ("system" as AccessMode), // Default to system
			db: userCtx.db ?? this.db,
		};
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

		// 4. Add search tables if adapter provides local storage schemas
		// Local adapters (Postgres, PgVector) return their tables for migration generation.
		// External adapters (Meilisearch, Elasticsearch) don't need local tables.
		const searchAdapter = this.search?.getAdapter();
		if (searchAdapter?.getTableSchemas) {
			const searchTables = searchAdapter.getTableSchemas();
			if (searchTables) {
				Object.assign(schema, searchTables);
			}
		}

		// 5. Add relations (Placeholder)
		// To enable, import { relations } from 'drizzle-orm' and uncomment logic

		return schema;
	}

	/**
	 * Resolve collection dependencies from WITH config for realtime subscriptions.
	 * Returns all collections that should trigger a refresh (main + relations).
	 */
	private resolveCollectionDependencies(
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
	 */
	private resolveGlobalDependencies(
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
			const relation = collection.state.relations?.[relationName];
			if (!relation) continue;

			dependencies.add(relation.collection);

			if (relation.type === "manyToMany" && relation.through) {
				dependencies.add(relation.through);
			}

			// Support both formats:
			// 1. { post: { with: { user: true } } } - explicit .with
			// 2. { post: { user: true } } - direct nesting (user is itself a relation)
			// In format 2, the object keys are relation names, not .with property
			let nestedWith: Record<string, any> | undefined;

			if (
				typeof relationOptions === "object" &&
				!Array.isArray(relationOptions)
			) {
				// Check if it has explicit .with property
				if ("with" in relationOptions) {
					nestedWith = (relationOptions as any).with;
				} else if (relationOptions !== true) {
					// The object itself contains nested relations (direct nesting format)
					nestedWith = relationOptions as Record<string, any>;
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
