// src/server/global/builder/types.ts

import type { BuildColumn, SQL } from "drizzle-orm";
import type { PgTableWithColumns } from "drizzle-orm/pg-core";

import type { Collection } from "#questpie/server/collection/builder/collection.js";
import type {
	CollectionVersioningOptions,
	ExtractFieldsByLocation,
	FieldAccess,
	I18nFieldAccessor,
	InferTableWithColumns,
	RelationConfig,
	RelationVariant,
} from "#questpie/server/collection/builder/types.js";
import type { AppContext } from "#questpie/server/config/app-context.js";
import type { BaseRequestContext } from "#questpie/server/config/context.js";
import type { AccessMode } from "#questpie/server/config/types.js";
import type { CrdtOwnerCapability } from "#questpie/server/modules/core/integrated/crdt/capability.js";

/**
 * Scope resolver function type for globals.
 * Returns a scope ID based on the request context.
 */
export type GlobalScopeResolver = (
	ctx: BaseRequestContext,
) => string | null | undefined;

/**
 * Options for global configuration
 */
export interface GlobalOptions {
	/**
	 * Realtime sharing policy. Cross-session sharing is disabled unless this
	 * resolver returns the same deterministic key for equivalent outputs.
	 */
	realtime?: {
		accessCacheKey?: (
			context: AppContext,
		) => string | null | undefined | Promise<string | null | undefined>;
	};
	/**
	 * Postgres schema name to place this global's tables in.
	 *
	 * When unset (default), tables live in the `public` schema. When set,
	 * main/i18n/versions/i18n_versions tables are created via
	 * `pgSchema(name).table(...)`, and migrations emit
	 * `CREATE SCHEMA IF NOT EXISTS "name"` before the first table lands there.
	 *
	 * @example
	 * ```ts
	 * global("site-settings").options({ schema: "web" })
	 * ```
	 */
	schema?: string;
	/**
	 * Whether to automatically add `createdAt` and `updatedAt` timestamp fields.
	 * @default true
	 */
	timestamps?: boolean;
	/**
	 * Versioning configuration.
	 *
	 * - `true` — enable versioning with defaults
	 * - `CollectionVersioningOptions` — configure maxVersions and/or workflow
	 *
	 * Workflow (publishing stages) is nested under versioning.
	 *
	 * @example
	 * ```ts
	 * .options({ versioning: true })
	 * .options({ versioning: { workflow: true } })
	 * ```
	 */
	versioning?: boolean | CollectionVersioningOptions;
	/**
	 * Scope resolver for multi-tenant globals.
	 * When provided, each scope gets its own instance of the global.
	 *
	 * The resolver receives the request context (including custom extensions
	 * from `.context()` on builder) and returns the scope ID.
	 *
	 * @example
	 * ```ts
	 * // Per-tenant settings
	 * const tenantSettings = qb
	 *   .global('tenant_settings')
	 *   .options({
	 *     scoped: (ctx) => ctx.tenantId  // From context extension
	 *   })
	 *   .fields(({ f }) => ({
	 *     welcomeMessage: f.text(),
	 *     theme: f.select({ options: ['light', 'dark'] })
	 *   }))
	 *
	 * // Per-property settings (multi-property management)
	 * const propertySettings = qb
	 *   .global('property_settings')
	 *   .options({
	 *     scoped: (ctx) => ctx.propertyId
	 *   })
	 *   .fields(({ f }) => ({
	 *     checkInTime: f.text({ default: '14:00' }),
	 *     checkOutTime: f.text({ default: '11:00' })
	 *   }))
	 * ```
	 */
	scoped?: GlobalScopeResolver;
}

/**
 * Context for global hooks.
 *
 * @template TData - The global data type
 *
 * @example
 * ```ts
 * .hooks({
 *   afterUpdate: async ({ data, kv }) => {
 *     await kv.set('settings-cache', data);
 *   }
 * })
 * ```
 */
export type GlobalHookContext<TData = any> = AppContext & {
	/** The global data */
	data: TData;
	/** Input data for update operations */
	input?: unknown;
	/** Current locale */
	locale?: string;
	/** Access mode */
	accessMode?: AccessMode;
};

/**
 * Access control context for global operations.
 *
 * @template TData - The global data type
 * @template TInput - The input data type (update: the patch)
 */
export type GlobalAccessContext<TData = any, TInput = unknown> = AppContext & {
	/** The global data (update: the existing record, or undefined on first write) */
	data?: TData;
	/** Input data for update */
	input?: TInput;
	/** Current locale */
	locale?: string;
};

/**
 * Hook function type
 * @template TRow - The global data type
 */
export type GlobalHookFunction<TRow = any> = (
	ctx: GlobalHookContext<TRow>,
) => Promise<void> | void;

/**
 * Global lifecycle hooks
 * @template TRow - The global data type
 */
export interface GlobalHooks<TRow = any> {
	beforeUpdate?: GlobalHookFunction<TRow>[] | GlobalHookFunction<TRow>;
	afterUpdate?: GlobalHookFunction<TRow>[] | GlobalHookFunction<TRow>;
	beforeRead?: GlobalHookFunction<any>[] | GlobalHookFunction<any>;
	afterRead?: GlobalHookFunction<TRow>[] | GlobalHookFunction<TRow>;
	// Shorthand: runs on update
	beforeChange?: GlobalHookFunction<TRow>[] | GlobalHookFunction<TRow>;
	afterChange?: GlobalHookFunction<TRow>[] | GlobalHookFunction<TRow>;
	/**
	 * Runs before a workflow stage transition.
	 * Throw to abort the transition.
	 */
	beforeTransition?: GlobalTransitionHook<TRow>[] | GlobalTransitionHook<TRow>;
	/**
	 * Runs after a workflow stage transition.
	 */
	afterTransition?: GlobalTransitionHook<TRow>[] | GlobalTransitionHook<TRow>;
}

/**
 * Context passed to global workflow transition hooks.
 */
export type GlobalTransitionHookContext<TData = any> = AppContext & {
	/** Global record being transitioned */
	data: TData;
	/** Stage the global is transitioning from */
	fromStage: string;
	/** Stage the global is transitioning to */
	toStage: string;
	/** Current locale */
	locale?: string;
	/** Current access mode */
	accessMode?: AccessMode;
};

/**
 * Hook function for global workflow stage transitions.
 */
export type GlobalTransitionHook<TData = any> = (
	ctx: GlobalTransitionHookContext<TData>,
) => Promise<void> | void;

/**
 * Access control function can return:
 * - boolean: true (allow) or false (deny)
 */
export type GlobalAccessRule<TRow = any, TInput = unknown> =
	| boolean
	| ((ctx: GlobalAccessContext<TRow, TInput>) => boolean | Promise<boolean>);

/**
 * Global access control configuration.
 *
 * Per-operation contexts:
 * - `read` — `data` is not loaded
 * - `update` — `data` is the existing record (undefined on first write),
 *   `input` is the patch
 */
export interface GlobalAccess<TRow = any, TUpdate = any> {
	read?: GlobalAccessRule<TRow>;
	update?: GlobalAccessRule<TRow, TUpdate>;
	/**
	 * Access rule for workflow stage transitions.
	 * Falls back to `update` if not specified.
	 */
	transition?: GlobalAccessRule<TRow>;
	/**
	 * Access rule for schema/meta introspection
	 * (`GET /globals/:name/{schema,meta}`).
	 *
	 * Resolution: `introspect` → `defaultAccess.introspect` → visible iff at
	 * least one operation (read/update) is allowed for the current user.
	 */
	introspect?: GlobalAccessRule<TRow>;
	/**
	 * Field-scoped access rules.
	 * Source-of-truth for per-field authorization in globals.
	 */
	fields?: Record<string, Pick<FieldAccess<TRow>, "read" | "update">>;
}

export type GlobalBuilderRelationFn<
	TState extends GlobalBuilderState,
	TNewRelations extends Record<string, RelationConfig>,
> = (
	ctx: {
		table: InferTableWithColumns<
			TState["name"],
			TState["fieldDefinitions"] extends Record<string, any>
				? ExtractFieldsByLocation<TState["fieldDefinitions"], "main">
				: Omit<TState["fields"], TState["localized"][number]>,
			undefined,
			TState["options"]
		>;
		i18n: I18nFieldAccessor<TState["fields"], TState["localized"]>;
	} & RelationVariant,
) => TNewRelations;

/**
 * Main builder state for Global
 */
/**
 * Global builder state - simplified interface
 * Type inference happens from builder usage, not from explicit generics
 */
/**
 * Validation schemas for a global
 */
export interface GlobalValidationSchemas {
	/** Schema for update operations */
	updateSchema: import("zod").ZodTypeAny;
}

export interface GlobalBuilderState {
	name: string;
	fields: Record<string, any>;
	localized: readonly any[];
	virtuals: Record<string, SQL>;
	relations: Record<string, RelationConfig>;
	options: GlobalOptions;
	/**
	 * Lifecycle hooks — stored as Record<string, any> to avoid
	 * circular type references through AppContext.
	 */
	hooks: Record<string, any>;
	/**
	 * Access control — stored as Record<string, any> to avoid
	 * circular type references through AppContext.
	 */
	access: Record<string, any>;
	/**
	 * Validation schemas for the global.
	 * Auto-generated if not explicitly provided.
	 */
	validation?: GlobalValidationSchemas;
	/**
	 * Field definitions when using Field Builder.
	 * undefined when using raw Drizzle columns.
	 */
	fieldDefinitions: Record<string, any> | undefined;
	/** Explicit owner-level collaborative aggregate capability. */
	collaborative: CrdtOwnerCapability<any> | undefined;
	/**
	 * Phantom type for field types available in .fields(({ f }) => ...).
	 * Set directly via EmptyGlobalState generic parameter.
	 *
	 * `unknown` (not `Record<string, any>`) so the phantom map carries NO string
	 * index: `unknown & TFieldTypes` collapses to `TFieldTypes`, making a missing/
	 * typo'd field key on the `.fields()` callback a hard error instead of `any`.
	 */
	"~fieldTypes"?: unknown;
}

/**
 * Default empty state for a new global
 *
 * @param TName - Global name
 * @param TFieldTypes - Field types available in .fields(({ f }) => ...)
 */
export type EmptyGlobalState<
	TName extends string,
	_TDeprecated = undefined,
	TFieldTypes extends Record<string, any> | undefined = undefined,
> = GlobalBuilderState & {
	name: TName;
	fields: {};
	localized: [];
	virtuals: {};
	relations: {};
	options: {};
	hooks: {};
	access: {};
	fieldDefinitions: undefined;
	collaborative: undefined;
	"~fieldTypes": TFieldTypes;
};

/**
 * Any global builder state
 */
export type AnyGlobalState = GlobalBuilderState;

// Helper types for inference (similar to Collection)
export type InferGlobalColumnsFromFields<
	TName extends string,
	TFields extends Record<string, any>,
	TOptions extends GlobalOptions,
> = {
	[K in keyof TFields]: BuildColumn<TName, TFields[K], "pg">;
} & (TOptions["timestamps"] extends false
	? {}
	: ReturnType<typeof Collection.timestampsCols>);

export type InferGlobalTableWithColumns<
	TName extends string,
	TFields extends Record<string, any>,
	TOptions extends GlobalOptions,
> = PgTableWithColumns<{
	name: TName;
	schema: undefined;
	columns: InferGlobalColumnsFromFields<TName, TFields, TOptions>;
	dialect: "pg";
}>;
