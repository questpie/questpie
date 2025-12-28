import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import type { PgTable } from "drizzle-orm/pg-core";
import { Disk } from "flydrive";
import {
	type AccessMode,
	type AnyCollectionOrBuilder,
	type AnyGlobal,
	type AnyGlobalBuilder,
	type AnyGlobalOrBuilder,
	type CMSConfig,
	type Collection,
	CollectionBuilder,
	type CollectionNames,
	createQueueClient,
	type DrizzleClientFromCMSConfig,
	type Global,
	GlobalBuilder,
	type GlobalNames,
	type JobDefinition,
	type Locale,
	type QueueClient,
	startJobWorkerForJobs,
	type WorkerOptions,
} from "#questpie/cms/exports/server";
import type { AnyCollectionState } from "#questpie/cms/server/collection/builder/types";
import {
	accountsCollection,
	sessionsCollection,
	usersCollection,
	verificationsCollection,
} from "#questpie/cms/server/collection/defaults/auth";
import type { RequestContext } from "#questpie/cms/server/config/context";
import { QCMSCrudAPI } from "#questpie/cms/server/config/integrated/crud-api.js";
import { QCMSMigrationsAPI } from "#questpie/cms/server/config/integrated/migrations-api.js";
import { betterAuth } from "better-auth";
import { KVService } from "#questpie/cms/server/integrated/kv";
import { LoggerService } from "#questpie/cms/server/integrated/logger";
import { MailerService } from "#questpie/cms/server/integrated/mailer";
import {
	createSearchService,
	type SearchService,
} from "#questpie/cms/server/integrated/search";
import { createDiskDriver } from "#questpie/cms/server/integrated/storage/create-driver";
import { assetsCollection } from "../collection/defaults/assets";

// Helper type to extract collection from builder or collection
type ExtractCollection<T> =
	T extends CollectionBuilder<infer TState> ? Collection<TState> : T;

// Helper type to find a collection by name in the tuple
type GetCollection<
	T extends AnyCollectionOrBuilder[],
	Name extends string,
> = ExtractCollection<Extract<T[number], { name: Name }>>;

// Helper type to extract global from builder or global
type ExtractGlobal<T> =
	T extends GlobalBuilder<infer TState> ? Global<TState> : T;

// Helper type to find a global by name in the tuple
type GetGlobal<
	T extends (AnyGlobal | AnyGlobalBuilder)[],
	Name extends string,
> = ExtractGlobal<Extract<T[number], { name: Name }>>;

export class QCMS<
	TCollections extends AnyCollectionOrBuilder[] = AnyCollectionOrBuilder[],
	TGlobals extends AnyGlobalOrBuilder[] = AnyGlobalOrBuilder[],
	TJobs extends JobDefinition<any, any>[] = JobDefinition<any, any>[],
> {
	private _collections = new Map<string, Collection<AnyCollectionState>>();
	private _globals = new Map<string, AnyGlobal>();
	public readonly config: CMSConfig<TCollections, TGlobals, TJobs>;
	private resolvedLocales: Locale[] | null = null;

	public auth?: any; // betterAuth instance (type depends on options)
	public storage: Disk;
	public queue: QueueClient<TJobs>;
	public email: MailerService;
	public kv: KVService;
	public logger: LoggerService;
	public search: SearchService;

	public migrations: QCMSMigrationsAPI<TCollections, TGlobals, TJobs>;
	public api: QCMSCrudAPI<TCollections, TGlobals, TJobs>;

	public db: {
		client: SQL;
		drizzle: DrizzleClientFromCMSConfig<TCollections, TGlobals>;
	};

	constructor(config: CMSConfig<TCollections, TGlobals, TJobs>) {
		this.config = config;

		this.registerCollections([
			assetsCollection,
			usersCollection,
			sessionsCollection,
			accountsCollection,
			verificationsCollection,
			...config.collections,
		]);

		if (config.globals) {
			this.registerGlobals(config.globals);
		}

		const client = new SQL(config.db.connection);
		this.db = {
			client,
			drizzle: drizzle({
				client: client,
				schema: this.getSchema(),
			}) as DrizzleClientFromCMSConfig<TCollections, TGlobals>,
		};

		// Batteries Included - Guaranteed Initialization with sensible defaults or explicit errors
		this.kv = new KVService();
		this.logger = new LoggerService();

		// Initialize search service
		this.search = createSearchService(
			this.db.drizzle as any,
			config.search || {},
		);

		// Initialize queue if configured
		if (config.queue?.jobs) {
			if (!config.queue.adapter) {
				throw new Error(
					"QUESTPIE: Queue adapter is required when jobs are defined. Example: adapter: pgBossAdapter(options)",
				);
			}
			this.queue = createQueueClient(
				config.queue.jobs,
				config.queue.adapter,
			) as any;
		} else {
			// Queue is required if defined in config
			throw new Error(
				"QUESTPIE: 'queue' configuration is required. Define jobs using defineJobs().",
			);
		}

		// For critical infrastructure, we currently require config or throw
		// In the future, we could provide safe "dev" defaults (e.g. local storage, console mail)

		if (config.auth) {
			// Resolve auth config - could be a factory function
			const authConfig =
				typeof config.auth === "function"
					? config.auth(this.db.client)
					: config.auth;

			// Check if it's a betterAuth instance (has handler method) or BetterAuthOptions
			if ("handler" in authConfig && typeof authConfig.handler === "function") {
				// Already a betterAuth instance
				this.auth = authConfig;
			} else {
				// BetterAuthOptions - create instance
				this.auth = betterAuth(authConfig);
			}
		}

		if (config.storage) {
			this.storage = new Disk(createDiskDriver(config));
		} else {
			throw new Error("QUESTPIE: 'storage' configuration is required.");
		}

		if (config.email) {
			this.email = new MailerService(config.email);
		} else {
			throw new Error("QUESTPIE: 'email' configuration is required.");
		}

		this.migrations = new QCMSMigrationsAPI(this);
		this.api = new QCMSCrudAPI(this);
	}

	private registerCollections(collections: AnyCollectionOrBuilder[]) {
		for (const item of collections) {
			// Auto-build if it's a CollectionBuilder
			const collection =
				item instanceof CollectionBuilder ? item.build() : item;

			if (this._collections.has(collection.name)) {
				throw new Error(
					`Collection "${collection.name}" is already registered.`,
				);
			}
			this._collections.set(collection.name, collection);
		}
	}

	private registerGlobals(globals: (AnyGlobal | AnyGlobalBuilder)[]) {
		for (const item of globals) {
			// Auto-build if it's a GlobalBuilder
			const global = item instanceof GlobalBuilder ? item.build() : item;

			if (this._globals.has(global.name)) {
				throw new Error(`Global "${global.name}" is already registered.`);
			}
			this._globals.set(global.name, global);
		}
	}

	public getCollectionConfig<TName extends CollectionNames<TCollections>>(
		name: TName,
	): GetCollection<TCollections, TName> {
		const collection = this._collections.get(name);
		if (!collection) {
			throw new Error(`Collection "${name}" not found.`);
		}
		return collection as GetCollection<TCollections, TName>;
	}

	public getGlobalConfig<TName extends GlobalNames<TGlobals>>(
		name: TName,
	): GetGlobal<TGlobals, TName> {
		const global = this._globals.get(name);
		if (!global) {
			throw new Error(`Global "${name}" not found.`);
		}
		return global as GetGlobal<TGlobals, TName>;
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
			db: userCtx.db ?? this.db.drizzle,
		};
	}

	public getCollections(): Collection<AnyCollectionState>[] {
		return Array.from(this._collections.values());
	}

	public getGlobals(): AnyGlobal[] {
		return Array.from(this._globals.values());
	}

	public getTables(): Record<string, PgTable> {
		const tables: Record<string, PgTable> = {};
		for (const [name, collection] of this._collections) {
			tables[name] = collection.table as unknown as PgTable;
			if (collection.i18nTable) {
				tables[`${name}_i18n`] = collection.i18nTable as unknown as PgTable;
			}
			if (collection.versionsTable) {
				tables[`${name}_versions`] =
					collection.versionsTable as unknown as PgTable;
			}
		}
		for (const [name, global] of this._globals) {
			tables[name] = global.table as unknown as PgTable;
			if (global.i18nTable) {
				tables[`${name}_i18n`] = global.i18nTable as unknown as PgTable;
			}
			if (global.versionsTable) {
				tables[`${name}_versions`] = global.versionsTable as unknown as PgTable;
			}
		}
		return tables;
	}

	public getSchema(): Record<string, unknown> {
		const schema: Record<string, unknown> = {};

		// 1. Add tables
		for (const [name, collection] of this._collections) {
			schema[name] = collection.table;
			if (collection.i18nTable) {
				schema[`${name}_i18n`] = collection.i18nTable;
			}
			if (collection.versionsTable) {
				schema[`${name}_versions`] = collection.versionsTable;
			}
		}
		for (const [name, global] of this._globals) {
			schema[name] = global.table;
			if (global.i18nTable) {
				schema[`${name}_i18n`] = global.i18nTable;
			}
			if (global.versionsTable) {
				schema[`${name}_versions`] = global.versionsTable;
			}
		}

		// 2. Add relations (Placeholder)
		// To enable, import { relations } from 'drizzle-orm' and uncomment logic

		return schema;
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
		);
	}
}
