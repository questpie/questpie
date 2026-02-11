import type {
	CollectionAccess,
	ExtractFieldsByLocation,
	InferTableWithColumns,
} from "#questpie/server/collection/builder/types.js";
import type {
	FieldDefinition,
	FieldDefinitionState,
} from "#questpie/server/fields/types.js";
import type { TranslationsConfig } from "#questpie/server/i18n/types.js";
import type {
	Collection,
	CollectionBuilder,
	Global,
	GlobalBuilder,
} from "#questpie/server/index.js";
import type {
	AnyCollectionOrBuilder,
	AnyGlobal,
	AnyGlobalBuilder,
	AnyGlobalOrBuilder,
	GetCollection,
	GetGlobal,
} from "#questpie/shared/type-utils.js";

// Local type definitions using new TState approach
// These types maintain backward compatibility while using the new field definition system
type NonLocalizedFields<
	TFields extends Record<string, any>,
	TLocalized extends ReadonlyArray<keyof TFields>,
> = TFields extends Record<string, FieldDefinition<FieldDefinitionState>>
	? ExtractFieldsByLocation<TFields, "main">
	: Omit<TFields, TLocalized[number]>;

type LocalizedFields<
	TFields extends Record<string, any>,
	TLocalized extends ReadonlyArray<keyof TFields>,
> = TFields extends Record<string, FieldDefinition<FieldDefinitionState>>
	? ExtractFieldsByLocation<TFields, "i18n">
	: Pick<TFields, TLocalized[number]>;

// Re-export for convenience (many files import from here)
export type {
	AnyCollectionOrBuilder,
	AnyGlobal,
	AnyGlobalBuilder,
	AnyGlobalOrBuilder,
	GetCollection,
	GetGlobal,
};

import type { PGlite } from "@electric-sql/pglite";
import type { BetterAuthOptions } from "better-auth";
import type { drizzle as drizzleBun } from "drizzle-orm/bun-sql";
import type { drizzle as drizzlePgLite } from "drizzle-orm/pglite";
import type { DriverContract } from "flydrive/types";
import type { MailerConfig } from "../integrated/mailer/index.js";
import type { QueueConfig as BaseQueueConfig } from "../integrated/queue/types.js";
import type { RealtimeConfig } from "../integrated/realtime/index.js";
import type {
	SearchAdapter,
	SearchConfig,
} from "../integrated/search/index.js";
import type { Migration } from "../migration/types.js";

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
				NonLocalizedFields<TState["fields"], TState["localized"]>,
				TState["title"],
				TState["options"]
			>
		: TCollections[K] extends CollectionBuilder<infer TState>
			? InferTableWithColumns<
					TState["name"],
					NonLocalizedFields<TState["fields"], TState["localized"]>,
					TState["title"],
					TState["options"]
				>
			: never;
} & {
	[K in keyof TCollections as TCollections[K] extends Collection<infer TState>
		? TState["localized"][number] extends string
			? `${TState["name"]}_i18n`
			: never
		: TCollections[K] extends CollectionBuilder<infer TState>
			? TState["localized"][number] extends string
				? `${TState["name"]}_i18n`
				: never
			: never]: TCollections[K] extends Collection<infer TState>
		? TState["localized"][number] extends string
			? InferTableWithColumns<
					TState["name"],
					LocalizedFields<TState["fields"], TState["localized"]>,
					TState["title"],
					TState["options"]
				>
			: never
		: TCollections[K] extends CollectionBuilder<infer TState>
			? TState["localized"][number] extends string
				? InferTableWithColumns<
						TState["name"],
						LocalizedFields<TState["fields"], TState["localized"]>,
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

export type DbClientType = "postgres" | "pglite";

export type DrizzleClientFromQuestpieConfig<TConfig extends QuestpieConfig> =
	ReturnType<
		InferyDbClientType<TConfig["db"]> extends "postgres"
			? typeof drizzleBun<
					DrizzleSchemaFromCollections<TConfig["collections"]> &
						DrizzleSchemaFromGlobals<
							TConfig["globals"] extends Record<string, AnyGlobalOrBuilder>
								? TConfig["globals"]
								: Record<string, never>
						>
				>
			: typeof drizzlePgLite<
					DrizzleSchemaFromCollections<TConfig["collections"]> &
						DrizzleSchemaFromGlobals<
							TConfig["globals"] extends Record<string, AnyGlobalOrBuilder>
								? TConfig["globals"]
								: Record<string, never>
						>
				>
	>;

export type AccessMode = "user" | "system";

export type StorageVisibility = "public" | "private";

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
	 * @default "/cms"
	 */
	basePath?: string;
}

/**
 * Local filesystem storage configuration.
 * CMS creates FSDriver and serves files at `/cms/storage/files/:key`.
 */
export interface StorageLocalConfig extends StorageBaseConfig {
	/**
	 * Directory path for local file storage.
	 * Can be relative (to cwd) or absolute path.
	 *
	 * @example "./uploads"
	 * @example "/var/data/cms-uploads"
	 * @default "./uploads"
	 */
	location?: string;
	driver?: never;
}

/**
 * Custom driver storage configuration (S3, R2, GCS, etc.).
 * Cloud providers serve files directly - no local file serving.
 */
export interface StorageDriverConfig extends StorageBaseConfig {
	/**
	 * Custom FlyDrive driver instance.
	 *
	 * @example
	 * ```ts
	 * import { S3Driver } from "flydrive/drivers/s3";
	 * storage: { driver: new S3Driver({ ... }) }
	 * ```
	 */
	driver: DriverContract;
	location?: never;
}

/**
 * Storage configuration - either local filesystem or custom driver.
 */
export type StorageConfig = StorageLocalConfig | StorageDriverConfig;

export type DbConfig =
	| {
			url: string;
	  }
	| {
			pglite: PGlite;
	  };

export type InferyDbClientType<TDbConfig extends DbConfig> = TDbConfig extends {
	url: string;
}
	? "postgres"
	: TDbConfig extends { pglite: PGlite }
		? "pglite"
		: never;

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
	 * part cannot be overridden here, as it is internally handled by the CMS instance.
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
	 * Search adapter for full-text search
	 *
	 * Pass a SearchAdapter instance to enable search functionality.
	 * Default: PostgresSearchAdapter (FTS + trigram) if not specified.
	 *
	 * @example
	 * ```ts
	 * import { createPostgresSearchAdapter } from "questpie/server";
	 *
	 * questpie({
	 *   search: createPostgresSearchAdapter(),
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
	logger?: import("../integrated/logger").LoggerConfig;

	/**
	 * KV store configuration
	 */
	kv?: import("../integrated/kv").KVConfig;

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
	 * Default access control for all collections and globals.
	 * Applied when collection/global doesn't define its own access rules.
	 *
	 * @example
	 * ```ts
	 * // Require authentication for all collections by default
	 * questpie({
	 *   defaultAccess: {
	 *     read: ({ session }) => !!session,
	 *     create: ({ session }) => !!session,
	 *     update: ({ session }) => !!session,
	 *     delete: ({ session }) => !!session,
	 *   }
	 * })
	 *
	 * // Admin-only by default
	 * questpie({
	 *   defaultAccess: {
	 *     read: ({ session }) => (session?.user as any)?.role === "admin",
	 *     create: ({ session }) => (session?.user as any)?.role === "admin",
	 *     update: ({ session }) => (session?.user as any)?.role === "admin",
	 *     delete: ({ session }) => (session?.user as any)?.role === "admin",
	 *   }
	 * })
	 * ```
	 */
	defaultAccess?: CollectionAccess;

	/**
	 * I18n translations configuration for backend error messages
	 */
	translations?: TranslationsConfig;

	/**
	 * Context resolver for extending request context.
	 * Called on each request to add custom properties (e.g., tenantId, propertyId).
	 * Defined via `.context()` on the builder.
	 */
	contextResolver?: ContextResolver;

	/**
	 * Phantom type for tracking message keys.
	 * Not used at runtime - purely for type inference.
	 * @internal
	 */
	"~messageKeys"?: unknown;
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

export interface ContextExtensions {
	// To be extended by plugins or user config
	[key: string]: any;
}

// ============================================================================
// Context Extension System
// ============================================================================

/**
 * Interface for extending request context via module augmentation.
 * Add custom properties that will be available in all access functions, hooks, etc.
 *
 * @example
 * ```ts
 * // In your app's types file
 * declare module 'questpie' {
 *   interface QuestpieContextExtension {
 *     tenantId: string | null
 *     propertyId: string | null
 *   }
 * }
 * ```
 */
export type QuestpieContextExtension = {};

/**
 * Parameters passed to the context resolver function.
 */
export interface ContextResolverParams {
	/** The incoming HTTP request */
	request: Request;
	/** The resolved session (may be null if unauthenticated) */
	session: { user: any; session: any } | null | undefined;
	/** Database client for queries */
	db: any;
}

/**
 * Context resolver function type.
 * Returns custom context properties that will be merged into RequestContext.
 *
 * @example
 * ```ts
 * .context(async ({ request, session, db }) => {
 *   const tenantId = request.headers.get('x-tenant-id')
 *
 *   if (tenantId && session?.user) {
 *     // Validate access
 *     const hasAccess = await db.query.tenantMembers.findFirst({
 *       where: and(
 *         eq(tenantMembers.tenantId, tenantId),
 *         eq(tenantMembers.userId, session.user.id)
 *       )
 *     })
 *     if (!hasAccess) {
 *       throw new Error('No access to this tenant')
 *     }
 *   }
 *
 *   return { tenantId }
 * })
 * ```
 */
export type ContextResolver<
	T extends Record<string, any> = Record<string, any>,
> = (params: ContextResolverParams) => Promise<T> | T;
