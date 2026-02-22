import type { BetterAuthOptions } from "better-auth";
import type { CollectionAccess } from "#questpie/server/collection/builder/types.js";
import type { GlobalHooksState } from "#questpie/server/config/global-hooks-types.js";
import type {
	AnyCollectionOrBuilder,
	AnyGlobalOrBuilder,
	ContextResolver,
	DbConfig,
	LocaleConfig,
	StorageConfig,
} from "#questpie/server/config/types.js";
import type { TranslationsConfig } from "#questpie/server/i18n/types.js";
import type { KVConfig } from "#questpie/server/integrated/kv/index.js";
import type { LoggerConfig } from "#questpie/server/integrated/logger/index.js";
import type {
	EmailTemplateDefinition,
	MailerConfig,
} from "#questpie/server/integrated/mailer/index.js";
import type {
	JobDefinition,
	QueueAdapter,
} from "#questpie/server/integrated/queue/types.js";
import type { RealtimeConfig } from "#questpie/server/integrated/realtime/index.js";
import type { SearchAdapter } from "#questpie/server/integrated/search/index.js";
import type { Migration } from "#questpie/server/migration/types.js";
import type { Seed, SeedCategory } from "#questpie/server/seed/types.js";

export type BuilderCollectionsMap = Record<string, AnyCollectionOrBuilder>;
export type BuilderGlobalsMap = Record<string, AnyGlobalOrBuilder>;
export type BuilderJobsMap = Record<string, JobDefinition<any, any>>;
export type BuilderEmailTemplatesMap = Record<
	string,
	EmailTemplateDefinition<any, any>
>;
export type BuilderFieldsMap = Record<string, any>; // Field factory functions
export type BuilderMapValues<TMap extends Record<PropertyKey, any>> =
	TMap[keyof TMap];
export type EmptyBuilderMap = Record<never, never>;

/**
 * Builder state - definition-time configuration (type-inferrable)
 * Only includes things that affect type inference
 */
export interface QuestpieBuilderState<
	TName extends string = string,
	TCollections extends BuilderCollectionsMap = BuilderCollectionsMap,
	TGlobals extends BuilderGlobalsMap = BuilderGlobalsMap,
	TJobs extends BuilderJobsMap = BuilderJobsMap,
	TEmailTemplates extends BuilderEmailTemplatesMap = BuilderEmailTemplatesMap,
	TAuth extends BetterAuthOptions | Record<never, never> = Record<never, never>,
	TMessageKeys extends string = never,
	TBuilderFields extends BuilderFieldsMap = BuilderFieldsMap,
> {
	name: TName;
	collections: TCollections;
	globals: TGlobals;
	jobs: TJobs;
	emailTemplates: TEmailTemplates;

	/**
	 * Registered field types for the Field Builder system.
	 * Used when defining collections with `.fields((f) => ({ ... }))`.
	 */
	fields: TBuilderFields;

	// Type-inferrable configurations (affect types)
	auth: TAuth;
	locale?: LocaleConfig;

	// Migrations from modules
	migrations?: Migration[];

	// Seeds from modules
	seeds?: Seed[];

	// I18n translations for backend messages
	translations?: TranslationsConfig;

	/**
	 * Context resolver for extending request context.
	 * Called on each request to add custom properties (e.g., tenantId, propertyId).
	 */
	contextResolver?: ContextResolver;

	/**
	 * Global lifecycle hooks that fire for ALL collections/globals.
	 * Registered via `.hooks()` on the builder.
	 */
	globalHooks?: GlobalHooksState;

	/**
	 * Default access control for all collections and globals.
	 * Applied when a collection/global doesn't define its own `.access()` rules.
	 *
	 * Set via `.defaultAccess()` on the builder. When composed via `.use()`,
	 * the consuming builder's `defaultAccess` takes precedence (last wins).
	 *
	 * **Resolution order for each CRUD operation:**
	 * 1. Collection/global's own `.access()` rule for that operation
	 * 2. This `defaultAccess` (from builder chain / module)
	 * 3. Framework fallback: require authenticated session (`!!session`)
	 *
	 * The `starterModule` sets this to require an authenticated session for all operations.
	 */
	defaultAccess?: CollectionAccess;

	/**
	 * Phantom type for tracking message keys through the builder chain.
	 * Not used at runtime - purely for type inference.
	 */
	"~messageKeys"?: TMessageKeys;
}

/**
 * Runtime configuration - provided at .build() time
 * This is what requires environment variables and runtime values
 */
export interface QuestpieRuntimeConfig<TDbConfig extends DbConfig = DbConfig> {
	/**
	 * Application settings
	 */
	app: {
		url: string;
	};

	/**
	 * Database connection
	 */
	db: TDbConfig;

	/**
	 * Secret key for signing tokens, etc.
	 */
	secret?: string;

	/**
	 * Storage configuration (driver, etc.)
	 */
	storage?: StorageConfig;

	/**
	 * Email adapter configuration (SMTP, console, etc.)
	 */
	email?: Pick<MailerConfig, "adapter" | "defaults">;

	/**
	 * Queue adapter configuration
	 */
	queue?: {
		adapter: QueueAdapter;
	};

	/**
	 * Search adapter
	 * @example createPostgresSearchAdapter()
	 */
	search?: SearchAdapter;

	/**
	 * Realtime adapter configuration
	 */
	realtime?: RealtimeConfig;

	/**
	 * Logger configuration
	 */
	logger?: LoggerConfig;

	/**
	 * KV adapter configuration
	 */
	kv?: KVConfig;

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
	 * - `SeedCategory[]`: Custom combination (e.g., `["required", "dev"]`)
	 *
	 * @default false
	 */
	autoSeed?: boolean | SeedCategory | SeedCategory[];

	/**
	 * Database migrations
	 */
	migrations?: Migration[];

	/**
	 * Database seeds
	 */
	seeds?: Seed[];
}

/**
 * Initial builder state with core collections
 * Core collections (assets, auth tables) are always included
 */
export type EmptyNamedBuilderState<TName extends string> = QuestpieBuilderState<
	TName,
	EmptyBuilderMap,
	EmptyBuilderMap,
	EmptyBuilderMap,
	EmptyBuilderMap,
	Record<never, never>,
	never, // No message keys initially
	EmptyBuilderMap // No fields initially
> & {
	auth: {};
	locale: undefined;
	defaultAccess: undefined;
	migrations: undefined;
	seeds: undefined;
	contextResolver: undefined;
	globalHooks: undefined;
	"~messageKeys": never;
	fields: {};
};

export type EmptyBuilderState = EmptyNamedBuilderState<"">;

/**
 * Extract message keys from a builder state
 */
export type ExtractMessageKeys<TState extends QuestpieBuilderState> =
	TState["~messageKeys"] extends infer TKeys
		? TKeys extends string
			? TKeys
			: never
		: never;
