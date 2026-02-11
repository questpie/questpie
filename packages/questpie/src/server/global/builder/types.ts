// src/server/global/builder/types.ts

import type { BuildColumn, SQL } from "drizzle-orm";
import type { PgTableWithColumns } from "drizzle-orm/pg-core";
import type { Collection } from "#questpie/exports/index.js";
import type {
	CollectionVersioningOptions,
	ExtractFieldsByLocation,
	I18nFieldAccessor,
	InferTableWithColumns,
	RelationConfig,
	RelationVariant,
} from "#questpie/server/collection/builder/types.js";
import type { BaseRequestContext } from "#questpie/server/config/context.js";
// Note: any, any, and any are deprecated.
// Users should use getApp<AppCMS>(), getDb<AppCMS>(), and getSession<AppCMS>() instead.
import type {
	AccessMode,
	QuestpieContextExtension,
} from "#questpie/server/config/types.js";
import type { FieldDefinitionAccess } from "#questpie/server/fields/types.js";
import type { FunctionDefinition } from "#questpie/server/functions/types.js";

/**
 * Scope resolver function type for globals.
 * Returns a scope ID based on the request context.
 */
export type GlobalScopeResolver = (
	ctx: BaseRequestContext & QuestpieContextExtension,
) => string | null | undefined;

/**
 * Options for global configuration
 */
export interface GlobalOptions {
	/**
	 * Whether to automatically add `createdAt` and `updatedAt` timestamp fields.
	 * @default true
	 */
	timestamps?: boolean;
	/**
	 * Versioning configuration
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
	 *   .fields((f) => ({
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
	 *   .fields((f) => ({
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
 * @template TApp - The CMS app type (defaults to any)
 *
 * @example
 * ```ts
 * import { getApp } from "questpie";
 * import type { AppCMS } from "./cms";
 *
 * .hooks({
 *   afterUpdate: async ({ app, data }) => {
 *     const cms = getApp<AppCMS>(app);
 *     await cms.kv.set('settings-cache', data);
 *   }
 * })
 * ```
 */
export interface GlobalHookContext<TData = any, TApp = any> {
	/** The global data */
	data: TData;
	/** Input data for update operations */
	input?: any;
	/** CMS instance - use getApp<AppCMS>(app) for type-safe access */
	app: TApp;
	/**
	 * Auth session (user + session) from Better Auth.
	 * Use getSession<AppCMS>(session) for type-safe access.
	 * - undefined = session not resolved
	 * - null = explicitly unauthenticated
	 * - object = authenticated
	 */
	session?: any | null;
	/** Current locale */
	locale?: string;
	/** Access mode */
	accessMode?: AccessMode;
	/** Database client - use getDb<AppCMS>(db) for type-safe access */
	db: any;
}

/**
 * Access control context for global operations.
 *
 * @template TData - The global data type
 * @template TApp - The CMS app type (defaults to any)
 */
export interface GlobalAccessContext<TData = any, TApp = any> {
	/** CMS instance - use getApp<AppCMS>(app) for type-safe access */
	app: TApp;
	/**
	 * Auth session (user + session) from Better Auth.
	 * Use getSession<AppCMS>(session) for type-safe access.
	 * - undefined = session not resolved
	 * - null = explicitly unauthenticated
	 * - object = authenticated
	 */
	session?: any | null;
	/** The global data */
	data?: TData;
	/** Input data for update */
	input?: any;
	/** Database client - use getDb<AppCMS>(db) for type-safe access */
	db: any;
	/** Current locale */
	locale?: string;
}

/**
 * Hook function type
 * @template TRow - The global data type
 * @template TApp - The CMS app type
 */
export type GlobalHookFunction<TRow = any, TApp = any> = (
	ctx: GlobalHookContext<TRow, TApp>,
) => Promise<void> | void;

/**
 * Global lifecycle hooks
 * @template TRow - The global data type
 * @template TApp - The CMS app type
 */
export interface GlobalHooks<TRow = any, TApp = any> {
	beforeUpdate?:
		| GlobalHookFunction<TRow, TApp>[]
		| GlobalHookFunction<TRow, TApp>;
	afterUpdate?:
		| GlobalHookFunction<TRow, TApp>[]
		| GlobalHookFunction<TRow, TApp>;
	beforeRead?: GlobalHookFunction<any, TApp>[] | GlobalHookFunction<any, TApp>;
	afterRead?: GlobalHookFunction<TRow, TApp>[] | GlobalHookFunction<TRow, TApp>;
	// Shorthand: runs on update
	beforeChange?:
		| GlobalHookFunction<TRow, TApp>[]
		| GlobalHookFunction<TRow, TApp>;
	afterChange?:
		| GlobalHookFunction<TRow, TApp>[]
		| GlobalHookFunction<TRow, TApp>;
}

/**
 * Access control function can return:
 * - boolean: true (allow) or false (deny)
 */
export type GlobalAccessRule<TRow = any, TApp = any> =
	| boolean
	| ((ctx: GlobalAccessContext<TRow, TApp>) => boolean | Promise<boolean>);

/**
 * Global access control configuration
 */
export interface GlobalAccess<TRow = any, TApp = any> {
	read?: GlobalAccessRule<TRow, TApp>;
	update?: GlobalAccessRule<TRow, TApp>;
	/**
	 * Field-scoped access rules.
	 * Source-of-truth for per-field authorization in globals.
	 */
	fields?: Record<string, Pick<FieldDefinitionAccess, "read" | "update">>;
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
	hooks: GlobalHooks;
	access: GlobalAccess;
	functions: Record<string, FunctionDefinition>;
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
	/**
	 * Phantom type for QuestpieBuilder reference.
	 * Used to access field types registered via q.fields().
	 */
	"~questpieApp"?: any;
	/**
	 * Phantom type for field types available in .fields((f) => ...).
	 * Extracted from ~questpieApp at compile time for type inference.
	 */
	"~fieldTypes"?: Record<string, any>;
}

/**
 * Extract field types from QuestpieBuilder.
 * QuestpieBuilder<TState> has `$state: TState` declared property for type extraction.
 */
type ExtractFieldTypesFromApp<TQuestpieApp> = TQuestpieApp extends {
	$state: { fields: infer TFields };
}
	? TFields
	: undefined;

/**
 * Default empty state for a new global
 *
 * @param TName - Global name
 * @param TQuestpieApp - Reference to QuestpieBuilder instance
 * @param TFieldTypes - Field types available in .fields((f) => ...)
 */
export type EmptyGlobalState<
	TName extends string,
	TQuestpieApp = undefined,
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
	functions: {};
	fieldDefinitions: undefined;
	"~questpieApp": TQuestpieApp;
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
