import type { CollectionBuilder } from "#questpie/server/collection/builder/collection-builder.js";
import type { Collection } from "#questpie/server/collection/builder/collection.js";
import type { ResolvedContextResolverBase } from "#questpie/server/config/app-context.js";
import type {
	CollectionAccess,
	ExtractFieldsByLocation,
	InferTableWithColumns,
} from "#questpie/server/collection/builder/types.js";
import type { FieldState } from "#questpie/server/fields/field-class-types.js";
import type { GlobalBuilder } from "#questpie/server/global/builder/global-builder.js";
import type { Global } from "#questpie/server/global/builder/global.js";
import type { TranslationsConfig } from "#questpie/server/i18n/types.js";
import type {
	AnyCollectionOrBuilder,
	AnyGlobal,
	AnyGlobalBuilder,
	AnyGlobalOrBuilder,
	GetCollection,
	GetGlobal,
} from "#questpie/shared/type-utils.js";

// Field extraction by location — dispatches via Field<TState> phantom type
type NonLocalizedFields<
	TFields extends Record<string, any>,
	TLocalized extends ReadonlyArray<keyof TFields>,
> =
	TFields extends Record<string, { readonly _: FieldState }>
		? ExtractFieldsByLocation<TFields, "main">
		: Omit<TFields, TLocalized[number]>;

type LocalizedFields<
	TFields extends Record<string, any>,
	TLocalized extends ReadonlyArray<keyof TFields>,
> =
	TFields extends Record<string, { readonly _: FieldState }>
		? ExtractFieldsByLocation<TFields, "i18n">
		: Pick<TFields, TLocalized[number]>;

/**
 * Resolve which fields property to use for schema inference.
 * When fieldDefinitions has keys, use it — it carries Field<TState> types
 * that NonLocalizedFields/LocalizedFields can dispatch on.
 * Otherwise fall back to raw Drizzle columns in `fields`.
 */
type SchemaFields<
	TState extends {
		fields: Record<string, any>;
		fieldDefinitions: Record<string, any>;
	},
> = [keyof TState["fieldDefinitions"]] extends [never]
	? TState["fields"]
	: TState["fieldDefinitions"];

/**
 * Check if a collection state has i18n fields.
 * New builder pattern: check ExtractFieldsByLocation for "i18n" keys.
 * Legacy pattern: check localized tuple.
 */
type HasI18nFields<
	TState extends {
		fieldDefinitions: Record<string, any>;
		localized: readonly any[];
	},
> = [keyof TState["fieldDefinitions"]] extends [never]
	? TState["localized"][number] extends string
		? true
		: false
	: [
				keyof ExtractFieldsByLocation<TState["fieldDefinitions"], "i18n">,
		  ] extends [never]
		? false
		: true;

// Re-export for convenience (many files import from here)
export type {
	AnyCollectionOrBuilder,
	AnyGlobal,
	AnyGlobalBuilder,
	AnyGlobalOrBuilder,
	GetCollection,
	GetGlobal,
};

import type { BetterAuthOptions } from "better-auth";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { Adapter, Files } from "files-sdk";

import type { Migration } from "../migration/types.js";
import type { MailerConfig } from "../modules/core/integrated/mailer/types.js";
import type { QueueConfig as BaseQueueConfig } from "../modules/core/integrated/queue/types.js";
import type { RealtimeConfig } from "../modules/core/integrated/realtime/types.js";
import type {
	SearchAdapter,
	SearchConfig,
} from "../modules/core/integrated/search/types.js";
import type { SeedCategory, SeedsConfig } from "../seed/types.js";

export type DrizzleSchemaFromCollections<
	TCollections extends Record<string, AnyCollectionOrBuilder>,
> = {
	[K in keyof TCollections as TCollections[K] extends Collection<infer TState>
		? TState["name"]
		: TCollections[K] extends CollectionBuilder<infer TState>
			? TState["name"]
			: never]: TCollections[K] extends Collection<infer TState>
		? InferTableWithColumns<
				TState["name"],
				NonLocalizedFields<SchemaFields<TState>, TState["localized"]>,
				TState["title"],
				TState["options"]
			>
		: TCollections[K] extends CollectionBuilder<infer TState>
			? InferTableWithColumns<
					TState["name"],
					NonLocalizedFields<SchemaFields<TState>, TState["localized"]>,
					TState["title"],
					TState["options"]
				>
			: never;
} & {
	[K in keyof TCollections as TCollections[K] extends Collection<infer TState>
		? HasI18nFields<TState> extends true
			? `${TState["name"]}_i18n`
			: never
		: TCollections[K] extends CollectionBuilder<infer TState>
			? HasI18nFields<TState> extends true
				? `${TState["name"]}_i18n`
				: never
			: never]: TCollections[K] extends Collection<infer TState>
		? HasI18nFields<TState> extends true
			? InferTableWithColumns<
					TState["name"],
					LocalizedFields<SchemaFields<TState>, TState["localized"]>,
					TState["title"],
					TState["options"]
				>
			: never
		: TCollections[K] extends CollectionBuilder<infer TState>
			? HasI18nFields<TState> extends true
				? InferTableWithColumns<
						TState["name"],
						LocalizedFields<SchemaFields<TState>, TState["localized"]>,
						TState["title"],
						TState["options"]
					>
				: never
			: never;
};

export type DrizzleSchemaFromGlobals<
	TGlobals extends Record<string, AnyGlobalOrBuilder>,
> = {
	[K in keyof TGlobals as TGlobals[K] extends Global<infer TState>
		? TState["name"]
		: TGlobals[K] extends GlobalBuilder<infer TState>
			? TState["name"]
			: never]: TGlobals[K] extends Global<infer TState>
		? InferTableWithColumns<
				TState["name"],
				NonLocalizedFields<TState["fields"], TState["localized"]>,
				never,
				{}
			>
		: TGlobals[K] extends GlobalBuilder<infer TState>
			? InferTableWithColumns<
					TState["name"],
					NonLocalizedFields<TState["fields"], TState["localized"]>,
					never,
					{}
				>
			: never;
} & {
	[K in keyof TGlobals as TGlobals[K] extends Global<infer TState>
		? TState["localized"][number] extends string
			? `${TState["name"]}_i18n`
			: never
		: TGlobals[K] extends GlobalBuilder<infer TState>
			? TState["localized"][number] extends string
				? `${TState["name"]}_i18n`
				: never
			: never]: TGlobals[K] extends Global<infer TState>
		? TState["localized"][number] extends string
			? InferTableWithColumns<
					TState["name"],
					LocalizedFields<TState["fields"], TState["localized"]>,
					never,
					{}
				>
			: never
		: TGlobals[K] extends GlobalBuilder<infer TState>
			? TState["localized"][number] extends string
				? InferTableWithColumns<
						TState["name"],
						LocalizedFields<TState["fields"], TState["localized"]>,
						never,
						{}
					>
				: never
			: never;
};

export type TablesFromConfig<TConfig extends QuestpieConfig> =
	DrizzleSchemaFromCollections<TConfig["collections"]> &
		(TConfig["globals"] extends Record<string, AnyGlobalOrBuilder>
			? DrizzleSchemaFromGlobals<TConfig["globals"]>
			: {});

export type Locale = {
	/** Locale code (e.g. "en", "sk", "en-US") */
	code: string;
	/** Human-readable label (e.g. "English", "Slovenčina") */
	label?: string;
	/** Is this the fallback locale? */
	fallback?: boolean;
	/**
	 * Custom country code for flag display (e.g. "us" for "en").
	 * If not provided, will use smart mapping based on locale code.
	 */
	flagCountryCode?: string;
	// Future extensions:
	// direction?: "ltr" | "rtl";
	// enabled?: boolean;
};

export interface LocaleConfig {
	/**
	 * Available locales. Can be a static array or an async function.
	 */
	locales: Locale[] | (() => Promise<Locale[]> | Locale[]);

	/**
	 * Default locale to use when none is specified.
	 */
	defaultLocale: string;

	/**
	 * Fallback locale mappings. Maps a locale code to its fallback locale code.
	 * Example: { "en-GB": "en", "fr-CA": "fr" }
	 */
	fallbacks?: Record<string, string>;
}

export type DbClientType = "postgres" | "pglite" | "custom";

export type DrizzleSchemaFromQuestpieConfig<TConfig extends QuestpieConfig> =
	DrizzleSchemaFromCollections<TConfig["collections"]> &
		DrizzleSchemaFromGlobals<
			TConfig["globals"] extends Record<string, AnyGlobalOrBuilder>
				? TConfig["globals"]
				: Record<string, never>
		>;

export type AnyDrizzleClient<TSchema extends DbSchemaInput = DbSchemaInput> =
	PgDatabase<any, TSchema, any>;

type ExtractDbFromCreateResult<TResult> = TResult extends {
	drizzle: infer TDb;
}
	? TDb
	: TResult;

type NormalizeDrizzleClient<TDb> =
	TDb extends AnyDrizzleClient<any> ? TDb : never;

type DrizzleClientFromDbConfig<
	TDbConfig extends DbConfig,
	TSchema extends DbSchemaInput,
> = TDbConfig extends { drizzle: infer TDb }
	? NormalizeDrizzleClient<TDb>
	: TDbConfig extends { create: (...args: any[]) => infer TResult }
		? NormalizeDrizzleClient<ExtractDbFromCreateResult<Awaited<TResult>>>
		: AnyDrizzleClient<TSchema>;

export type DrizzleClientFromQuestpieConfig<TConfig extends QuestpieConfig> =
	DrizzleClientFromDbConfig<
		TConfig["db"],
		DrizzleSchemaFromQuestpieConfig<TConfig>
	>;

export type AccessMode = "user" | "system";

export type StorageVisibility = "public" | "private";

type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * Base storage options shared by all storage configurations.
 */
export interface StorageBaseConfig {
	/**
	 * Default visibility for uploaded files.
	 * - "public": Files accessible without authentication
	 * - "private": Files require signed URL
	 * @default "public"
	 */
	defaultVisibility?: StorageVisibility;

	/**
	 * Token expiration for signed URLs (seconds).
	 * @default 3600 (1 hour)
	 */
	signedUrlExpiration?: number;

	/**
	 * Base path for serving storage files.
	 * @default "/"
	 */
	basePath?: string;

	/** Disallow the removed storage registration shape. */
	driver?: never;

	/** Disallow the removed storage registration shape. */
	files?: never;
}

/**
 * Local filesystem storage configuration.
 * QUESTPIE creates a Files SDK filesystem adapter and serves upload collection files at `/:collection/files/:key`.
 */
export interface StorageLocalConfig extends StorageBaseConfig {
	/**
	 * Directory path for local file storage.
	 * Can be relative (to cwd) or absolute path.
	 *
	 * @example "./uploads"
	 * @example "/var/data/app-uploads"
	 * @default "./uploads"
	 */
	location?: string;
	adapter?: never;
}

/**
 * Files SDK adapter-first storage configuration.
 */
export interface StorageAdapterConfig<
	TAdapter extends Adapter = Adapter,
> extends StorageBaseConfig {
	/**
	 * Files SDK adapter used to construct QUESTPIE's direct `Files` instance.
	 *
	 * @example
	 * ```ts
	 * import { s3 } from "files-sdk/s3";
	 *
	 * storage: { adapter: s3({ bucket: "uploads" }) }
	 * ```
	 */
	adapter: TAdapter;
	location?: never;
}

/**
 * Storage configuration - local filesystem or Files SDK adapter.
 */
export type StorageConfig<TAdapter extends Adapter = Adapter> =
	| StorageLocalConfig
	| StorageAdapterConfig<TAdapter>;

export type StorageAdapterFromConfig<TStorage> =
	NonNullable<TStorage> extends { adapter: infer TAdapter extends Adapter }
		? TAdapter
		: Adapter;

export type StorageFromQuestpieConfig<TConfig> =
	IsAny<TConfig> extends true
		? any
		: Files<
				StorageAdapterFromConfig<
					TConfig extends { storage?: infer TStorage } ? TStorage : undefined
				>
			>;

export type DbCloseFn = () => void | Promise<void>;

export type DbSchemaInput = Record<string, unknown>;

export type PGliteClient = {
	query: (...args: unknown[]) => unknown;
	close?: (...args: unknown[]) => unknown;
	[key: string]: unknown;
};

export interface DbCreateContext<
	TSchema extends DbSchemaInput = DbSchemaInput,
> {
	/**
	 * Drizzle schema generated from registered collections, globals, and
	 * framework tables. Pass this into your Drizzle driver factory.
	 */
	schema: TSchema;
}

export type DbCreateResult<TDb extends AnyDrizzleClient = AnyDrizzleClient> =
	| TDb
	| {
			drizzle: TDb;
			/**
			 * Optional direct PostgreSQL connection string used by features that need
			 * a separate session-based connection, such as pg_notify realtime.
			 */
			connectionString?: string;
			/**
			 * Cleanup callback for the underlying driver/client.
			 */
			close?: DbCloseFn;
	  };

/**
 * Optional connection-pool tuning for the `db: { url }` variant. Applied to
 * whichever Postgres driver the runtime selects — Bun's native `bun:sql` on
 * Bun, `node-postgres` on Node. All timeouts are in MILLISECONDS; questpie
 * converts to each driver's native unit.
 *
 * Omit entirely to keep driver defaults (pool `max` 10, and — critically for
 * node-postgres — NO bounded acquire timeout, i.e. wait forever). On a shared
 * Postgres running near its connection cap, that "wait forever" is exactly how
 * a single request stalls long enough to trip an SSR stream lifetime cap. Set a
 * bounded `connectionTimeoutMs` so pool acquisition fails fast instead.
 */
export interface DbPoolConfig {
	/** Maximum connections in the pool. @default 10 (driver default) */
	max?: number;
	/**
	 * Max time to wait when acquiring/establishing a pooled connection before
	 * failing. Bounds the "server is at its connection cap" case so callers get
	 * a fast error instead of hanging.
	 * → Bun `connectionTimeout` (s), node-postgres `connectionTimeoutMillis` (ms).
	 * @default driver default (Bun 30000; node-postgres 0 = wait forever)
	 */
	connectionTimeoutMs?: number;
	/**
	 * Close idle connections after this long.
	 * → Bun `idleTimeout` (s), node-postgres `idleTimeoutMillis` (ms).
	 */
	idleTimeoutMs?: number;
	/**
	 * Recycle a connection after this long, even if healthy.
	 * → Bun `maxLifetime` (s), node-postgres `maxLifetimeSeconds` (s).
	 * @default 0 (no limit)
	 */
	maxLifetimeMs?: number;
	/**
	 * Disable server-side NAMED prepared statements. Required to route this pool
	 * through PgBouncer in transaction mode. Bun only — node-postgres does not
	 * create named prepared statements unless a query sets `name`.
	 * @default true
	 */
	prepare?: boolean;
}

export type DbConfig =
	| {
			url: string;
			/** Optional connection-pool tuning. Omit to use driver defaults. */
			pool?: DbPoolConfig;
	  }
	| {
			pglite: PGliteClient;
	  }
	| {
			/**
			 * Fully constructed Drizzle client. Use this when the surrounding
			 * runtime creates the driver, for example Cloudflare Hyperdrive,
			 * Neon, Vercel Postgres, or another HTTP/TCP-compatible adapter.
			 */
			drizzle: AnyDrizzleClient;
			connectionString?: string;
			close?: DbCloseFn;
	  }
	| {
			/**
			 * Lazily create the Drizzle client from the generated schema. This is
			 * the preferred option for Cloudflare Workers because bindings such as
			 * Hyperdrive are runtime-owned and should remain outside framework
			 * internals.
			 */
			create: (
				ctx: DbCreateContext,
			) => DbCreateResult | Promise<DbCreateResult>;
	  };

export type InferDbClientType<TDbConfig extends DbConfig> = TDbConfig extends {
	url: string;
}
	? "postgres"
	: TDbConfig extends { pglite: PGliteClient }
		? "pglite"
		: "custom";

/**
 * @deprecated Use InferDbClientType. Kept for source compatibility with the
 * historical misspelling.
 */
export type InferyDbClientType<TDbConfig extends DbConfig> =
	InferDbClientType<TDbConfig>;

export interface QuestpieConfig {
	app: {
		url: string;
	};

	db: DbConfig;

	/**
	 * Collections map - register collections as object with keys
	 * Can be Collection instances or CollectionBuilder instances
	 * Builders will be automatically built during registration
	 */
	collections: Record<string, AnyCollectionOrBuilder>;

	/**
	 * Globals map - register globals as object with keys
	 */
	globals?: Record<string, AnyGlobalOrBuilder>;

	/**
	 * Global localization settings
	 */
	locale?: LocaleConfig;

	/**
	 * Secret key for signing tokens, etc.
	 */
	secret?: string;

	/**
	 * Authentication configuration (Better Auth)
	 * Add any new plugins on overrides. Db
	 * part cannot be overridden here, as it is internally handled by the app instance.
	 * ```
	 */
	auth?: BetterAuthOptions;

	/**
	 * Storage configuration
	 */
	storage?: StorageConfig;

	/**
	 * Email configuration (Nodemailer + React Email)
	 */
	email?: MailerConfig;

	/**
	 * Queue configuration (pg-boss)
	 */
	queue?: BaseQueueConfig;

	/**
	 * Unified route handlers registered on the app instance.
	 * Automatically routed by `createFetchHandler` — no URL prefix needed.
	 *
	 * @see QUE-158 (Unified route() builder + URL flattening)
	 */
	routes?: Record<
		string,
		import("#questpie/server/routes/types.js").RouteDefinition
	>;

	/**
	 * Search adapter for full-text search
	 *
	 * Pass a SearchAdapter instance to enable search functionality.
	 * Default: PostgresSearchAdapter (FTS + trigram) if not specified.
	 *
	 * @example
	 * ```ts
	 * import { createPostgresSearchAdapter } from "questpie/adapters/postgres-search";
	 *
	 * config({
	 *   search: createPostgresSearchAdapter(),
	 *   db: { url: process.env.DATABASE_URL! },
	 *   app: { url: process.env.APP_URL! },
	 * })
	 * ```
	 */
	search?: SearchAdapter;

	/**
	 * @deprecated Use search adapter instead
	 */
	searchConfig?: SearchConfig;

	/**
	 * Realtime configuration (outbox + SSE/WS adapters)
	 */
	realtime?: RealtimeConfig;

	/**
	 * Logger configuration
	 */
	logger?: import("../modules/core/integrated/logger/types.js").LoggerConfig;

	/**
	 * KV store configuration
	 */
	kv?: import("../modules/core/integrated/kv/types.js").KVConfig;

	/**
	 * Executor configuration (sandboxed / trusted code execution).
	 * Unconfigured = disabled (`ctx.executor.run` throws a clear error).
	 */
	executor?: import("../modules/core/integrated/executor/types.js").ExecutorConfig;

	/**
	 * Migration configuration
	 */
	migrations?: {
		/**
		 * Directory where migrations are stored
		 * @default "./migrations"
		 */
		directory?: string;

		/**
		 * Manually defined migrations (optional)
		 * Usually migrations are auto-generated, but you can define custom ones here
		 * Or migrations from modules will be merged here
		 */
		migrations?: Migration[];
	};

	/**
	 * Seeds configuration
	 */
	seeds?: SeedsConfig;

	/**
	 * Automatically run migrations on startup.
	 * Use `await app.waitForInit()` to wait for completion.
	 * @default false
	 */
	autoMigrate?: boolean;

	/**
	 * Automatically run seeds on startup (after migrations if autoMigrate is also enabled).
	 * Use `await app.waitForInit()` to wait for completion.
	 *
	 * - `false`: Never auto-seed (default)
	 * - `"required"`: Only required seeds
	 * - `"dev"`: required + dev seeds
	 * - `"test"`: required + test seeds
	 * - `true`: All seed categories
	 * - `SeedCategory[]`: Custom combination
	 *
	 * @default false
	 */
	autoSeed?: boolean | SeedCategory | SeedCategory[];

	/**
	 * Default access control for all collections and globals.
	 * Applied when a collection/global doesn't define its own `.access()` rules.
	 *
	 * Set via `.defaultAccess()` on the builder (chainable, composable via modules).
	 * The `starterModule` sets this to require an authenticated session for all operations.
	 *
	 * **Resolution order for each CRUD operation:**
	 * 1. Collection/global's own `.access()` rule for that operation
	 * 2. This `defaultAccess` (from builder chain)
	 * 3. Framework fallback: require authenticated session (`!!session`)
	 *
	 * To make a resource publicly accessible, explicitly set the rule to `true`:
	 * ```ts
	 * .access({ read: true })  // on a specific collection
	 * // or
	 * .defaultAccess({ read: true })  // for all collections
	 * ```
	 */
	defaultAccess?: CollectionAccess;

	/**
	 * I18n translations configuration for backend error messages
	 */
	translations?: TranslationsConfig;

	/**
	 * Global lifecycle hooks that fire for ALL collections/globals.
	 * Registered via `.hooks()` on the builder.
	 */
	globalHooks?: import("./global-hooks-types.js").GlobalHooksState;

	/**
	 * Service definitions (from services/*.ts and module services).
	 * Keyed by service name. Resolved at runtime into service instances.
	 */
	services?: Record<
		string,
		import("#questpie/server/services/define-service.js").ServiceBuilder<any>
	>;

	/**
	 * Phantom type for tracking message keys.
	 * Not used at runtime - purely for type inference.
	 * @internal
	 */
	"~messageKeys"?: unknown;

	/**
	 * Phantom type for tracking request-context extensions resolved by
	 * `appConfig({ context })`. Not used at runtime - purely for type inference
	 * (e.g. `getContext<App>()` exposing resolver-derived keys).
	 * @internal
	 */
	"~contextExtensions"?: unknown;
}

/**
 * Utility types to extract info from a concrete QuestpieConfig
 */
export type GetCollections<T extends QuestpieConfig> = T["collections"];
export type GetGlobals<T extends QuestpieConfig> = NonNullable<T["globals"]>;
export type GetAuth<T extends QuestpieConfig> = T["auth"];
export type GetDbConfig<T extends QuestpieConfig> = T["db"];

/**
 * Extract message keys from a QuestpieConfig
 * Falls back to never if not specified
 */
export type GetMessageKeys<T extends QuestpieConfig> =
	T["~messageKeys"] extends infer TKeys
		? TKeys extends string
			? TKeys
			: never
		: never;

/**
 * @deprecated The `[key: string]: any` index signature is a type-lie.
 * Context extensions are inferred from the app config resolver instead —
 * see `InferContextExtensionsFromAppConfig` in `questpie/types`.
 */
export interface ContextExtensions {
	// To be extended by plugins or user config
	[key: string]: any;
}

// ============================================================================
// Context Extension System
// ============================================================================

/**
 * Parameters passed to the context resolver function.
 *
 * At runtime the resolver also receives the full system-mode service surface
 * (`collections`, `globals`, `logger`, `kv`, `queue`, `t`, user services).
 * Those extras are typed via the codegen-emitted
 * `Questpie.ContextResolverContext` global augmentation.
 *
 * `session` and `db` resolve lazily off the generated AppContext augmentation,
 * so resolvers are fully typed once codegen ran. Pre-codegen (library/module
 * compilation) they degrade to the loose fallback shapes.
 */
export interface ContextResolverParams {
	/** The incoming HTTP request */
	request: Request;
	/** The resolved session (may be null if unauthenticated) */
	session: ResolvedContextResolverBase extends { session: infer S }
		? S
		: { user: any; session: any } | null | undefined;
	/** Database client for queries */
	db: ResolvedContextResolverBase extends { db: infer D } ? D : any;
}

/**
 * Context resolver function type — `appConfig({ context })`.
 *
 * Runs once per HTTP request. The returned object travels with the request:
 * it is merged flat into the `RequestContext` and reaches access rules, hooks,
 * route handlers, field access, and `getContext()`.
 *
 * Collections/globals called inside the resolver run in system mode —
 * the resolver IS trusted derivation.
 *
 * @example
 * ```ts
 * // config/app.ts
 * export default appConfig({
 *   context: async ({ request, session, collections }) => {
 *     const tenantId = request.headers.get("x-tenant-id");
 *
 *     if (tenantId && session?.user) {
 *       const member = await collections.tenant_members.findOne({
 *         where: { tenant: tenantId, user: session.user.id },
 *       });
 *       if (!member) throw new Error("No access to this tenant");
 *     }
 *
 *     return { tenantId };
 *   },
 * });
 * ```
 */
export type ContextResolver<
	T extends Record<string, any> = Record<string, any>,
> = (
	params: ContextResolverParams & Questpie.ContextResolverContext,
) => Promise<T> | T;

/**
 * Validate a `appConfig({ context })` resolver: its return, once awaited and
 * stripped of `null`/`undefined`, must be a non-empty object. A resolver that
 * resolves to ONLY a primitive (`async () => "x"`) or ONLY `null`
 * (`async () => null`) is rejected — extensions can only be an object bundle.
 * The common `session ? { role } : null` shape passes (it has an object arm).
 *
 * Resolves to the original resolver type on success, or a branded
 * non-callable on failure so the `context` member stops type-checking.
 */
export type ValidateContextResolver<TResolver> = TResolver extends (
	...args: any[]
) => infer TResult
	? [NonNullable<Awaited<TResult>>] extends [never]
		? { "~invalidContextResolver": "resolver must return an object" }
		: NonNullable<Awaited<TResult>> extends Record<string, any>
			? TResolver
			: { "~invalidContextResolver": "resolver must return an object" }
	: TResolver;
