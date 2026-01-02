import { tmpdir } from "node:os";
import { join } from "node:path";
import { betterAuth } from "better-auth";
import { SQL } from "bun";
import { drizzle as drizzleBun } from "drizzle-orm/bun-sql";
import type { PgTable } from "drizzle-orm/pg-core";
import { drizzle as drizzlePgLite } from "drizzle-orm/pglite";
import { DriveManager } from "flydrive";
import {
	type AccessMode,
	type AnyCollectionOrBuilder,
	type AnyGlobal,
	type AnyGlobalBuilder,
	type Collection,
	CollectionBuilder,
	createQueueClient,
	type DrizzleClientFromCMSConfig,
	type Global,
	GlobalBuilder,
	type InferyDbClientType,
	type Locale,
	type QueueClient,
	startJobWorkerForJobs,
	type WorkerOptions,
} from "#questpie/cms/exports/server";
import type { AnyCollectionState } from "#questpie/cms/server/collection/builder/types";
import type { RequestContext } from "#questpie/cms/server/config/context";
import {
	QCMSAPI,
	type QCMSApi,
} from "#questpie/cms/server/config/integrated/cms-api.js";
import { QCMSMigrationsAPI } from "#questpie/cms/server/config/integrated/migrations-api.js";
import { KVService } from "#questpie/cms/server/integrated/kv";
import { LoggerService } from "#questpie/cms/server/integrated/logger";
import { MailerService } from "#questpie/cms/server/integrated/mailer";
import {
	questpieRealtimeLogTable,
	RealtimeService,
} from "#questpie/cms/server/integrated/realtime";
import {
	createSearchService,
	type SearchService,
} from "#questpie/cms/server/integrated/search";
import { createDiskDriver } from "#questpie/cms/server/integrated/storage/create-driver";
import type { CMSConfig, GetFunctions, InferAuthFromConfig } from "./types";

export class QCMS<TConfig extends CMSConfig = CMSConfig> {
	static readonly __internal = {
		storageDriverServiceName: "cmsDefault",
	};

	private _collections: Record<string, Collection<AnyCollectionState>> = {};
	private _globals: Record<string, AnyGlobal> = {};
	private _functions: GetFunctions<TConfig>;
	public readonly config: TConfig;
	private resolvedLocales: Locale[] | null = null;
	private pgConnectionString?: string;

	/**
	 * Better Auth instance - properly typed based on auth configuration
	 * Type is inferred from the AuthConfig passed to .auth() in the builder
	 */
	public auth: TConfig["auth"] extends undefined
		? undefined
		: InferAuthFromConfig<NonNullable<TConfig["auth"]>>;
	public storage: DriveManager<{
		[QCMS.__internal
			.storageDriverServiceName]: () => import("flydrive/types").DriverContract;
	}>;
	public queue: QueueClient<NonNullable<TConfig["queue"]>["jobs"]>;
	public email: MailerService;
	public kv: KVService;
	public logger: LoggerService;
	public search: SearchService;
	public realtime: RealtimeService;

	public migrations: QCMSMigrationsAPI<TConfig>;
	public api: QCMSApi<TConfig>;

	public db: DrizzleClientFromCMSConfig<
		TConfig["collections"],
		NonNullable<TConfig["globals"]>,
		InferyDbClientType<TConfig["db"]>
	>;

	constructor(config: TConfig) {
		this.config = config;

		// Register collections from config
		this.registerCollections(config.collections);

		if (config.globals) {
			this.registerGlobals(config.globals);
		}

		this._functions = (config.functions || {}) as GetFunctions<TConfig>;

		// Initialize database client from config
		if ("url" in config.db) {
			// Postgres via Bun SQL
			const bunSqlClient = new SQL({ url: config.db.url });
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

		// Initialize search service
		this.search = createSearchService(this.db as any, config.search || {});

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
			this.queue = createQueueClient(
				config.queue.jobs,
				config.queue.adapter,
			) as any;
		} else {
			this.queue = {} as any; // Empty queue client if no jobs defined
		}

		// For critical infrastructure, we currently require config or throw
		// In the future, we could provide safe "dev" defaults (e.g. local storage, console mail)

		if (config.auth) {
			// Resolve auth config - could be a factory function
			const authConfig =
				typeof config.auth === "function" ? config.auth(this.db) : config.auth;

			// Check if it's a betterAuth instance (has handler method) or BetterAuthOptions
			if ("handler" in authConfig && typeof authConfig.handler === "function") {
				// Already a betterAuth instance
				this.auth = authConfig as any;
			} else {
				// BetterAuthOptions - create instance
				this.auth = betterAuth(authConfig) as any;
			}
		} else {
			this.auth = undefined as any;
		}

		// Initialize storage with default or custom driver
		this.storage = new DriveManager({
			default: QCMS.__internal.storageDriverServiceName,
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
				[QCMS.__internal.storageDriverServiceName]: () =>
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

		this.migrations = new QCMSMigrationsAPI(this);
		this.api = new QCMSAPI(this) as QCMSApi<TConfig>;
	}

	private registerCollections(
		collections: Record<string, AnyCollectionOrBuilder>,
	) {
		for (const [_key, item] of Object.entries(collections)) {
			// Auto-build if it's a CollectionBuilder
			const collection =
				item instanceof CollectionBuilder ? item.build() : item;

			if (this._collections[collection.name]) {
				throw new Error(
					`Collection "${collection.name}" is already registered.`,
				);
			}
			this._collections[collection.name] = collection;
		}
	}

	private registerGlobals(
		globals: Record<string, AnyGlobal | AnyGlobalBuilder>,
	) {
		for (const [_key, item] of Object.entries(globals)) {
			// Auto-build if it's a GlobalBuilder
			const global = item instanceof GlobalBuilder ? item.build() : item;

			if (this._globals[global.name]) {
				throw new Error(`Global "${global.name}" is already registered.`);
			}
			this._globals[global.name] = global;
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
	 * Returns minimal context with user, locale, accessMode
	 * Services are accessed via cms.* not context.*
	 * @default accessMode: 'system' - CMS API is backend-only by default
	 */
	public async createContext(
		userCtx: {
			user?: any;
			session?: any;
			locale?: string;
			accessMode?: AccessMode;
			db?: any;
			[key: string]: any;
		} = {},
	): Promise<RequestContext> {
		const defaultLocale = this.config.locale?.defaultLocale || "en";
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
			user: userCtx.user,
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

	public getFunctions(): GetFunctions<TConfig> {
		return this._functions;
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

		// 1. Add tables
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

		// Always include realtime log table since realtime service is always initialized
		schema.questpie_realtime_log = questpieRealtimeLogTable;

		// 2. Add relations (Placeholder)
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

	/**
	 * Start listening to jobs (worker mode)
	 *
	 * This method starts the queue workers and begins processing jobs.
	 * Call this in your worker instances, not in your web server.
	 *
	 * @example
	 * ```ts
	 * // worker.ts
	 * const cms = new QCMS({ ... });
	 * await cms.listenToJobs();
	 * ```
	 *
	 * @example
	 * ```ts
	 * // Listen to specific jobs only
	 * await cms.listenToJobs(['send-email', 'process-image']);
	 * ```
	 *
	 * @example
	 * ```ts
	 * // With custom options
	 * await cms.listenToJobs({ teamSize: 20, batchSize: 10 });
	 * ```
	 */
	public async listenToJobs(options?: WorkerOptions): Promise<void> {
		if (!this.config.queue?.jobs) {
			throw new Error(
				"Cannot start job workers: No jobs configured. Add 'queue.jobs' to your QCMS config.",
			);
		}

		// Create context factory for workers
		const createContext = async (): Promise<RequestContext> => {
			return this.createContext({ accessMode: "system" });
		};

		await startJobWorkerForJobs(
			this.queue,
			this.config.queue.jobs,
			createContext,
			options,
			this,
		);
	}
}
