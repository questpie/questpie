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
import type { FunctionsTree } from "#questpie/server/functions/types.js";
import type { TranslationsConfig } from "#questpie/server/i18n/types.js";
import type { KVConfig } from "#questpie/server/integrated/kv/index.js";
import type { LoggerConfig } from "#questpie/server/integrated/logger/index.js";
import type { MailerConfig } from "#questpie/server/integrated/mailer/index.js";
import type {
	JobDefinition,
	QueueAdapter,
} from "#questpie/server/integrated/queue/types.js";
import type { RealtimeConfig } from "#questpie/server/integrated/realtime/index.js";
import type { SearchAdapter } from "#questpie/server/integrated/search/index.js";
import type { Migration } from "#questpie/server/migration/types.js";
import type { Seed, SeedCategory } from "#questpie/server/seed/types.js";

// ============================================================================
// Module Definition — what module() accepts
// ============================================================================

/**
 * Module definition — a plain data object describing what a module contributes.
 * Created via `module({ ... })`. Modules are composed in `config({ modules: [...] })`.
 *
 * Admin-specific properties (listViews, editViews, components, blocks,
 * sidebar, dashboard, branding, adminLocale) are added via declaration
 * merging by `@questpie/admin`.
 *
 * @see RFC §13.5 (Module Shape)
 */
export interface ModuleDefinition {
	/** Unique module name (e.g. "questpie-starter", "questpie-admin"). */
	name: string;

	/** Dependency modules — resolved depth-first before this module. */
	modules?: ModuleDefinition[];

	/** Collections this module contributes. Later modules override by key. */
	collections?: Record<string, AnyCollectionOrBuilder>;

	/** Globals this module contributes. Later modules override by key. */
	globals?: Record<string, AnyGlobalOrBuilder>;

	/** Job definitions this module contributes. */
	jobs?: Record<string, JobDefinition<any, any>>;

	/** RPC function definitions this module contributes. */
	functions?: FunctionsTree<any>;

	/** Custom field types this module contributes (extends the `f` proxy). */
	fields?: Record<string, any>;

	/** Partial auth config — deep-merged with other modules and user config. */
	auth?: BetterAuthOptions | Record<string, any>;

	/** Migrations this module contributes — concatenated with others. */
	migrations?: Migration[];

	/** Seeds this module contributes — concatenated with others. */
	seeds?: Seed[];

	/**
	 * Backend messages keyed by locale.
	 * Deep-merged per locale — later modules override individual keys.
	 */
	messages?: Record<string, Record<string, string>>;

	/** Default access control. Last module with this set wins. */
	defaultAccess?: CollectionAccess;

	/**
	 * Global lifecycle hooks. Arrays are concatenated across modules.
	 */
	hooks?: GlobalHooksState;

	/** Codegen plugins — concatenated across modules. */
	plugins?: any[];

	/**
	 * Extensible — admin module augments this interface to add:
	 * listViews, editViews, components, blocks, sidebar, dashboard, branding, adminLocale.
	 */
	[key: string]: unknown;
}

// ============================================================================
// Config Input — what config() accepts
// ============================================================================

/**
 * Application configuration — the shape of `questpie.config.ts`.
 * Created via `config({ ... })`. Passed to `createApp()` along with
 * discovered entities from file convention (or hand-written).
 *
 * @see RFC §12 (config() Full API), §12.1 (Config Shape)
 */
export interface AppConfig {
	/** Modules to compose — order matters, later overrides earlier. */
	modules?: ModuleDefinition[];

	/** Application URL (required). */
	app: { url: string };

	/** Database connection (required). */
	db: DbConfig;

	/** Secret key for signing tokens. */
	secret?: string;

	/** Storage configuration. */
	storage?: StorageConfig;

	/** Email configuration with adapter. */
	email?: MailerConfig;

	/** Queue configuration with adapter. */
	queue?: { adapter: QueueAdapter };

	/** Search adapter for full-text search. */
	search?: SearchAdapter;

	/** Realtime configuration. */
	realtime?: RealtimeConfig;

	/** Logger configuration. */
	logger?: LoggerConfig;

	/** KV store configuration. */
	kv?: KVConfig;

	/** Auth configuration — deep-merged with module auth contributions. */
	auth?: BetterAuthOptions | Record<string, any>;

	/** Content localization. */
	locale?: LocaleConfig;

	/** Default access control (applied when entities don't define their own). */
	defaultAccess?: CollectionAccess;

	/** Global lifecycle hooks. */
	hooks?: GlobalHooksState;

	/** Context resolver for extending request context. */
	contextResolver?: ContextResolver;

	/** I18n translations config (backend messages). */
	translations?: TranslationsConfig;

	/** Auto-migrate on startup. */
	autoMigrate?: boolean;

	/** Auto-seed on startup. */
	autoSeed?: boolean | SeedCategory | SeedCategory[];

	/** User-level migrations (from project, not modules). */
	migrations?: Migration[];

	/** User-level seeds (from project, not modules). */
	seeds?: Seed[];

	/**
	 * Extensible — admin module augments this interface to add:
	 * adminLocale, branding, sidebar, dashboard.
	 */
	[key: string]: unknown;
}

// ============================================================================
// App Entities — what codegen discovers (second arg to createApp)
// ============================================================================

/**
 * Entities discovered by file convention or codegen.
 * Passed as the second argument to `createApp(config, entities)`.
 * User entities always override module contributions.
 *
 * @see RFC §15.1 (Complete .generated/index.ts Example)
 */
export interface AppEntities {
	/** Collections discovered from `collections/` directory. */
	collections?: Record<string, AnyCollectionOrBuilder>;

	/** Globals discovered from `globals/` directory. */
	globals?: Record<string, AnyGlobalOrBuilder>;

	/** Jobs discovered from `jobs/` directory. */
	jobs?: Record<string, JobDefinition<any, any>>;

	/** Functions discovered from `functions/` directory. */
	functions?: FunctionsTree<any>;

	/** Auth config from `auth.ts`. Deep-merged on top of module auth. */
	auth?: BetterAuthOptions | Record<string, any>;

	/**
	 * Messages from `messages/` directory, keyed by locale.
	 * Deep-merged on top of module messages.
	 */
	messages?: Record<string, Record<string, string>>;

	/** User-level migrations. */
	migrations?: Migration[];

	/** User-level seeds. */
	seeds?: Seed[];

	/**
	 * Extensible — admin module augments this interface to add:
	 * blocks.
	 */
	[key: string]: unknown;
}
