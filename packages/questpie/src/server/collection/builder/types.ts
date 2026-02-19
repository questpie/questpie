// builder/types.ts

import type {
	BuildColumns,
	BuildExtraConfigColumns,
	GetColumnData,
	SQL,
} from "drizzle-orm";
import type { PgColumn, PgTableWithColumns } from "drizzle-orm/pg-core";
import type { Collection } from "#questpie/server/collection/builder/collection.js";
import type { ValidationSchemas } from "#questpie/server/collection/builder/validation-helpers.js";
// Note: any types are intentional for composition flexibility.
// Users should use typedApp<App>(), typedDb<App>(), and typedSession<App>() for type-safe access.
import type { AccessMode } from "#questpie/server/config/types.js";
import type {
	FieldDefinition,
	FieldDefinitionAccess,
	FieldDefinitionState,
	FieldLocation,
} from "#questpie/server/fields/types.js";
import type { SearchableConfig } from "#questpie/server/integrated/search/index.js";

/**
 * Title expression type - field name (key from fields or virtuals)
 */
export type TitleExpression = string;

/**
 * Versioning configuration.
 *
 * When `workflow` is set, versioning is automatically enabled — the `enabled`
 * field defaults to `true` unless explicitly set to `false`.
 */
export interface CollectionVersioningOptions {
	enabled?: boolean;
	maxVersions?: number; // default: 50
	/**
	 * Publishing workflow configuration.
	 * Workflow uses the versions table for stage snapshots, so it lives
	 * under versioning to make the dependency explicit in the type system.
	 *
	 * - `true` — default stages: ["draft", "published"]
	 * - `WorkflowOptions` — custom stages, transitions, initial stage
	 */
	workflow?: boolean | WorkflowOptions;
}

/**
 * Workflow stage definition.
 *
 * `transitions` defines explicit allowed next stages. If omitted, transitions
 * are unrestricted (any configured stage can be targeted).
 */
export interface WorkflowStageOptions {
	label?: string;
	description?: string;
	transitions?: readonly string[];
}

/**
 * Workflow configuration for collections/globals.
 *
 * Supports either:
 * - `string[]` stage shorthand: ["draft", "review", "published"]
 * - keyed object: { draft: { ... }, review: { transitions: [...] } }
 */
export interface WorkflowOptions {
	stages?: readonly string[] | Record<string, WorkflowStageOptions>;
	/**
	 * Stage used on create when no explicit stage is passed.
	 * Defaults to the first configured stage.
	 */
	initialStage?: string;
}

/**
 * Upload configuration for collections that handle file uploads
 * When configured, the collection automatically:
 * - Adds upload fields (key, filename, mimeType, size, visibility)
 * - Extends output type with { url: string } for typed URL access
 * - Adds afterRead hook for URL generation based on visibility
 * - Enables upload() and uploadMany() CRUD methods
 * - Registers HTTP routes: POST /:collection/upload, GET /:collection/files/:key
 */
export interface UploadOptions {
	/**
	 * Default visibility for uploaded files
	 * - "public": Files are accessible without authentication
	 * - "private": Files require signed URLs with token
	 * @default "public"
	 */
	visibility?: "public" | "private";
	/**
	 * Maximum file size in bytes
	 * @example 10_000_000 // 10MB
	 */
	maxSize?: number;
	/**
	 * Allowed MIME types (supports wildcards)
	 * @example ["image/*", "application/pdf"]
	 */
	allowedTypes?: string[];
}

/**
 * Options for collection configuration
 */
export interface CollectionOptions {
	/**
	 * Whether to automatically add `createdAt` and `updatedAt` timestamp fields
	 * @default true
	 */
	timestamps?: boolean;
	/**
	 * Whether to enable soft deletion with a `deletedAt` timestamp field.
	 * @default false
	 */
	softDelete?: boolean;
	/**
	 * Versioning configuration.
	 *
	 * - `true` — enable versioning with defaults
	 * - `CollectionVersioningOptions` — configure maxVersions and/or workflow
	 *
	 * Workflow (publishing stages) is nested under versioning because it
	 * requires versioning — stage transitions create version snapshots.
	 *
	 * @example
	 * ```ts
	 * // Versioning only
	 * .options({ versioning: true })
	 *
	 * // Versioning + default workflow (draft → published)
	 * .options({ versioning: { workflow: true } })
	 *
	 * // Full config
	 * .options({
	 *   versioning: {
	 *     maxVersions: 100,
	 *     workflow: {
	 *       stages: ["draft", "review", "published"],
	 *       initialStage: "draft",
	 *     },
	 *   },
	 * })
	 * ```
	 */
	versioning?: boolean | CollectionVersioningOptions;
}

/**
 * Relation configuration
 */
export type RelationType = "one" | "many" | "manyToMany";

export interface RelationConfig {
	type: RelationType;
	collection: string;
	fields?: PgColumn[];
	references: string[];
	relationName?: string; // For linking corresponding relations
	onDelete?: "cascade" | "set null" | "restrict" | "no action";
	onUpdate?: "cascade" | "set null" | "restrict" | "no action";
	// Many-to-Many specific fields
	through?: string; // Junction table collection name
	sourceKey?: string; // Primary key on source table (default: "id")
	sourceField?: string; // Foreign key column in junction table pointing to source
	targetKey?: string; // Primary key on target table (default: "id")
	targetField?: string; // Foreign key column in junction table pointing to target
}

type InferRelationTargetName<TTarget> = TTarget extends string
	? TTarget
	: TTarget extends () => { name: infer TName extends string }
		? TName
		: TTarget extends Record<string, any>
			? Extract<keyof TTarget, string>
			: string;

type InferRelationTypeFromConfig<TConfig> = TConfig extends {
	morphName: string;
}
	? "many"
	: TConfig extends { hasMany: true }
		? TConfig extends { through: any }
			? "manyToMany"
			: "many"
		: "one";

/** Infer upload relation type: through → manyToMany, else one */
type InferUploadRelationType<TConfig> = TConfig extends { through: string }
	? "manyToMany"
	: "one";

/** Infer upload target collection: config.to or default "assets" */
type InferUploadTargetCollection<TConfig> = TConfig extends {
	to: infer TTo extends string;
}
	? TTo
	: "assets";

export type InferRelationConfigsFromFields<
	TFields extends Record<string, FieldDefinition<FieldDefinitionState>>,
> = {
	[K in keyof TFields as TFields[K] extends FieldDefinition<infer TState>
		? TState["type"] extends "relation" | "upload"
			? K
			: never
		: never]: TFields[K] extends FieldDefinition<infer TState>
		? TState["type"] extends "relation"
			? RelationConfig & {
					type: InferRelationTypeFromConfig<TState["config"]>;
					collection: InferRelationTargetName<TState["config"]["to"]>;
				}
			: TState["type"] extends "upload"
				? RelationConfig & {
						type: InferUploadRelationType<TState["config"]>;
						collection: InferUploadTargetCollection<TState["config"]>;
					}
				: never
		: never;
};

/**
 * Extract fields for relations context.
 * For field definitions, uses ExtractFieldsByLocation.
 * For raw Drizzle columns, passes through as-is.
 */
type FieldsForRelationsContext<TFields extends Record<string, any>> =
	TFields extends Record<string, FieldDefinition<FieldDefinitionState>>
		? ExtractFieldsByLocation<TFields, "main">
		: TFields;

export type CollectionBuilderRelationFn<
	TState extends CollectionBuilderState,
	TNewRelations extends Record<string, RelationConfig>,
> = (
	ctx: {
		table: InferTableWithColumns<
			TState["name"],
			FieldsForRelationsContext<TState["fields"]>,
			undefined,
			TState["options"]
		>;
		i18n: I18nFieldAccessor<TState["fields"], TState["localized"]>;
	} & RelationVariant,
) => TNewRelations;

/**
 * Context for virtuals callback
 */
export type CollectionBuilderVirtualsFn<
	TState extends CollectionBuilderState,
	TNewVirtuals extends Record<string, SQL> | undefined,
> = (ctx: {
	table: InferTableWithColumns<
		TState["name"],
		ExtractFieldsByLocation<TState["fields"], "main">,
		undefined,
		TState["options"]
	>;
	i18n: I18nFieldAccessor<TState["fields"], TState["localized"]>;
	context: any;
}) => TNewVirtuals;

/**
 * Proxy type for title field selection
 * Accessing any key returns that key as a string
 */
export type TitleFieldProxy<
	TFields extends Record<string, any>,
	TVirtuals extends Record<string, any> | undefined,
> = {
	[K in keyof TFields]: K & string;
} & (TVirtuals extends Record<string, any>
	? { [K in keyof TVirtuals]: K & string }
	: {});

/**
 * Context for title callback
 * Receives a field proxy where accessing any field returns its name as string
 */
export type CollectionBuilderTitleFn<
	TState extends CollectionBuilderState,
	TNewTitle extends TitleExpression | undefined,
> = (ctx: {
	f: TitleFieldProxy<TState["fields"], TState["virtuals"]>;
}) => TNewTitle;

/**
 * Context for indexes callback
 */
export type CollectionBuilderIndexesFn<
	TState extends CollectionBuilderState,
	TNewIndexes extends Record<string, any>,
> = (ctx: {
	table: BuildExtraConfigColumns<
		TState["name"],
		InferColumnsFromFields<
			TState["fields"],
			TState["options"],
			TState["title"]
		>,
		"pg"
	>;
}) => TNewIndexes;

/**
 * Helper types for relation definition callback
 */
export interface RelationVariant {
	one: <C extends string>(
		collection: C,
		config: { fields: PgColumn[]; references: string[]; relationName?: string },
	) => RelationConfig & { type: "one"; collection: C };
	many: <C extends string>(
		collection: C,
		config?: {
			relationName?: string;
			onDelete?: "cascade" | "set null" | "restrict" | "no action";
			onUpdate?: "cascade" | "set null" | "restrict" | "no action";
		},
	) => RelationConfig & { type: "many"; collection: C };
	manyToMany: <C extends string>(
		collection: C,
		config: {
			through: string; // Junction table collection name
			sourceKey?: string; // Default: "id"
			sourceField: string; // FK in junction pointing to source
			targetKey?: string; // Default: "id"
			targetField: string; // FK in junction pointing to target
			onDelete?: "cascade" | "set null" | "restrict" | "no action";
			onUpdate?: "cascade" | "set null" | "restrict" | "no action";
		},
	) => RelationConfig & { type: "manyToMany"; collection: C };
}

/**
 * Base context for hooks - receives full app access via `app`.
 *
 * @template TData - The record data type (created/updated/deleted)
 * @template TOriginal - The original record type (for update/delete operations), use `never` if not available
 * @template TOperation - The operation type
 * @template TApp - The app app type (defaults to any)
 *
 * @example
 * ```ts
 * import { typedApp, typedDb, typedSession } from "questpie";
 * import type { App } from "./questpie";
 *
 * .hooks({
 *   afterChange: async ({ data, app, db, session }) => {
 *     const app = typedApp<App>(app);
 *     const database = typedDb<App>(db);
 *     const sess = typedSession<App>(session);
 *
 *     // ✅ Fully typed access
 *     await app.queue.notify.publish({ id: data.id });
 *     await database.insert(auditLog).values({ ... });
 *   }
 * })
 * ```
 */
export interface HookContext<
	TData = any,
	TOriginal = any,
	TOperation extends "create" | "update" | "delete" | "read" =
		| "create"
		| "update"
		| "delete"
		| "read",
	TApp = any,
> {
	/**
	 * The record data (created/updated record)
	 */
	data: TData;

	/**
	 * Original record (only available for update operations in afterChange/afterRead hooks)
	 */
	original: TOriginal extends never ? never : TOriginal | undefined;

	/**
	 * app instance - use typedApp<App>(app) for type-safe access.
	 *
	 * @example
	 * ```ts
	 * const app = typedApp<App>(app);
	 * app.queue.jobName.publish(...);
	 * app.email.send(...);
	 * ```
	 */
	app: TApp;

	/**
	 * Auth session (user + session) from Better Auth.
	 * - undefined = session not resolved
	 * - null = explicitly unauthenticated
	 * - object = authenticated
	 *
	 * Use typedSession<App>(session) for type-safe access.
	 *
	 * @example
	 * ```ts
	 * const sess = typedSession<App>(session);
	 * if (sess?.user.role === 'admin') { ... }
	 * ```
	 */
	session?: any | null;

	/**
	 * Current locale
	 */
	locale?: string;

	/**
	 * Access mode (system or user)
	 */
	accessMode?: AccessMode;

	/**
	 * Operation type (specific to hook)
	 */
	operation: TOperation;

	/**
	 * Database client (may be transaction).
	 * Use typedDb<App>(db) for type-safe Drizzle operations.
	 *
	 * @example
	 * ```ts
	 * const database = typedDb<App>(db);
	 * await database.insert(table).values({ ... });
	 * ```
	 */
	db: any;
}

/**
 * Access control context for collection operations.
 *
 * @template TData - The record data type
 * @template TApp - The app app type (defaults to any)
 *
 * @example
 * ```ts
 * import { typedSession } from "questpie";
 * import type { App } from "./questpie";
 *
 * .access({
 *   read: ({ session, data }) => {
 *     const sess = typedSession<App>(session);
 *     return data.userId === sess?.user.id || sess?.user.role === 'admin'
 *   }
 * })
 * ```
 */
export interface AccessContext<TData = any, TApp = any> {
	/** app instance - use typedApp<App>(app) for type-safe access */
	app: TApp;
	/**
	 * Auth session (user + session) from Better Auth.
	 * Use typedSession<App>(session) for type-safe access.
	 * - undefined = session not resolved
	 * - null = explicitly unauthenticated
	 * - object = authenticated
	 */
	session?: any | null;
	/** The record being accessed (for read/update/delete) */
	data?: TData;
	/** Input data (for create/update) */
	input?: any;
	/** Database client - use typedDb<App>(db) for type-safe access */
	db: any;
	/** Current locale */
	locale?: string;
}

/**
 * Hook function type
 * Receives full app context with specific operation type
 *
 * @template TData - The record data type
 * @template TOriginal - The original record type (for update/delete operations)
 * @template TOperation - The operation type
 * @template TApp - The app app type
 */
export type HookFunction<
	TData = any,
	TOriginal = any,
	TOperation extends "create" | "update" | "delete" | "read" =
		| "create"
		| "update"
		| "delete"
		| "read",
	TApp = any,
> = (
	ctx: HookContext<TData, TOriginal, TOperation, TApp>,
) => Promise<void> | void;

/**
 * BeforeOperation hook - runs before any operation
 * @property data - Input data (TInsert for create, TUpdate for update, TSelect for read/delete)
 * @property original - Not available
 * @property operation - "create" | "update" | "delete" | "read"
 */
export type BeforeOperationHook<
	TSelect = any,
	TInsert = any,
	TUpdate = any,
	TApp = any,
> = HookFunction<
	TInsert | TUpdate | TSelect,
	never,
	"create" | "update" | "delete" | "read",
	TApp
>;

/**
 * BeforeValidate hook - runs before validation on create/update
 * @property data - Mutable input data (TInsert on create, TUpdate on update)
 * @property original - Not available
 * @property operation - "create" | "update"
 * @remarks Use this to transform/normalize input before validation
 */
export type BeforeValidateHook<
	_TSelect = any,
	TInsert = any,
	TUpdate = any,
	TApp = any,
> = HookFunction<TInsert | TUpdate, never, "create" | "update", TApp>;

/**
 * BeforeChange hook - runs before create/update (after validation)
 * @property data - Validated input data (TInsert on create, TUpdate on update)
 * @property original - Not available
 * @property operation - "create" | "update"
 * @remarks Use this for business logic, slug generation, complex validation
 */
export type BeforeChangeHook<
	_TSelect = any,
	TInsert = any,
	TUpdate = any,
	TApp = any,
> = HookFunction<TInsert | TUpdate, never, "create" | "update", TApp>;

/**
 * AfterChange hook - runs after create/update operations
 * @property data - Complete record (TSelect)
 * @property original - Original record (TSelect) - only available on update operations
 * @property operation - "create" | "update"
 * @remarks Use this for notifications, webhooks, syncing to external services
 */
export type AfterChangeHook<TSelect = any, TApp = any> = HookFunction<
	TSelect,
	TSelect | undefined,
	"create" | "update",
	TApp
>;

/**
 * BeforeRead hook - runs before read operations
 * @property data - Query context/options (implementation specific)
 * @property original - Not available
 * @property operation - "read"
 * @remarks Use this to modify query options or add filters
 */
export type BeforeReadHook<TSelect = any, TApp = any> = HookFunction<
	TSelect,
	never,
	"read",
	TApp
>;

/**
 * AfterRead hook - runs after any operation that returns data
 * @property data - Complete record (TSelect)
 * @property original - Original record (TSelect) - only available on update operations
 * @property operation - "create" | "update" | "delete" | "read"
 * @remarks Use this to transform output, add computed fields, format data
 */
export type AfterReadHook<TSelect = any, TApp = any> = HookFunction<
	TSelect,
	TSelect | undefined,
	"create" | "update" | "delete" | "read",
	TApp
>;

/**
 * BeforeDelete hook - runs before delete operations
 * @property data - Record to be deleted (TSelect)
 * @property original - Not available
 * @property operation - "delete"
 * @remarks Use this to prevent deletion, cascade deletes, create backups
 */
export type BeforeDeleteHook<TSelect = any, TApp = any> = HookFunction<
	TSelect,
	never,
	"delete",
	TApp
>;

/**
 * AfterDelete hook - runs after delete operations
 * @property data - Deleted record (TSelect)
 * @property original - Not available
 * @property operation - "delete"
 * @remarks Use this for cleanup, logging, notifying users
 */
export type AfterDeleteHook<TSelect = any, TApp = any> = HookFunction<
	TSelect,
	never,
	"delete",
	TApp
>;

/**
 * Context passed to workflow transition hooks.
 * Includes the stage transition info alongside standard hook fields.
 */
export interface TransitionHookContext<TData = any, TApp = any> {
	/** Record being transitioned */
	data: TData;
	/** Stage the record is transitioning from */
	fromStage: string;
	/** Stage the record is transitioning to */
	toStage: string;
	/** app instance - use typedApp<App>(app) for type-safe access */
	app: TApp;
	/** Auth session */
	session?: any | null;
	/** Current locale */
	locale?: string;
	/** Database client (may be transaction) */
	db: any;
}

/**
 * Hook function for workflow stage transitions.
 * Throw to abort the transition in beforeTransition.
 */
export type TransitionHook<TData = any, TApp = any> = (
	ctx: TransitionHookContext<TData, TApp>,
) => Promise<void> | void;

/**
 * Collection lifecycle hooks
 * Each hook type can have multiple functions (executed in order)
 *
 * Hook execution order:
 * - Create: beforeOperation → beforeValidate → beforeChange → [DB INSERT] → afterChange → afterRead
 * - Update: beforeOperation → beforeValidate → beforeChange → [DB UPDATE] → afterChange → afterRead
 * - Delete: beforeOperation → beforeDelete → [DB DELETE] → afterDelete → afterRead
 * - Read: beforeOperation → beforeRead → [DB SELECT] → afterRead
 *
 * @template TSelect - The complete record type (after read)
 * @template TInsert - The insert data type
 * @template TUpdate - The update data type
 * @template TApp - The app app type
 */
export interface CollectionHooks<
	TSelect = any,
	TInsert = any,
	TUpdate = any,
	TApp = any,
> {
	/**
	 * Runs before any operation (create/update/delete/read)
	 *
	 * **Available fields:**
	 * - `data`: Input data (type depends on operation)
	 * - `original`: Not available
	 * - `operation`: "create" | "update" | "delete" | "read"
	 * - `app`: app instance
	 *
	 * **Use cases:** logging, rate limiting, early validation
	 */
	beforeOperation?:
		| BeforeOperationHook<TSelect, TInsert, TUpdate, TApp>[]
		| BeforeOperationHook<TSelect, TInsert, TUpdate, TApp>;

	/**
	 * Runs before validation on create/update operations
	 *
	 * **Available fields:**
	 * - `data`: Mutable input data (TInsert on create, TUpdate on update)
	 * - `original`: Not available
	 * - `operation`: "create" | "update"
	 * - `app`: app instance
	 *
	 * **Use cases:** transforming input, setting defaults, normalizing data
	 *
	 * @example
	 * ```ts
	 * beforeValidate: ({ data, operation }) => {
	 *   if (operation === 'create' && !data.slug) {
	 *     data.slug = slugify(data.title);
	 *   }
	 * }
	 * ```
	 */
	beforeValidate?:
		| BeforeValidateHook<TSelect, TInsert, TUpdate, TApp>[]
		| BeforeValidateHook<TSelect, TInsert, TUpdate, TApp>;

	/**
	 * Runs before create/update operations (after validation)
	 *
	 * **Available fields:**
	 * - `data`: Validated input data (TInsert on create, TUpdate on update)
	 * - `original`: Not available
	 * - `operation`: "create" | "update"
	 * - `app`: app instance
	 *
	 * **Use cases:** business logic, complex validation, derived fields
	 *
	 * @example
	 * ```ts
	 * beforeChange: ({ data, operation, app }) => {
	 *   if (operation === 'create') {
	 *     data.createdBy = app.context.user?.id;
	 *   }
	 * }
	 * ```
	 */
	beforeChange?:
		| BeforeChangeHook<TSelect, TInsert, TUpdate, TApp>[]
		| BeforeChangeHook<TSelect, TInsert, TUpdate, TApp>;

	/**
	 * Runs after create/update operations
	 *
	 * **Available fields:**
	 * - `data`: Complete record (TSelect)
	 * - `original`: Original record (TSelect) - **only on update**
	 * - `operation`: "create" | "update"
	 * - `app`: app instance
	 *
	 * **Use cases:** notifications, webhooks, syncing to external services
	 *
	 * @example
	 * ```ts
	 * afterChange: async ({ data, original, operation, app }) => {
	 *   if (operation === 'update' && original) {
	 *     if (data.status !== original.status) {
	 *       await app.queue.statusChange.publish({ id: data.id });
	 *     }
	 *   }
	 * }
	 * ```
	 */
	afterChange?:
		| AfterChangeHook<TSelect, TApp>[]
		| AfterChangeHook<TSelect, TApp>;

	/**
	 * Runs before read operations
	 *
	 * **Available fields:**
	 * - `data`: Query context/options
	 * - `original`: Not available
	 * - `operation`: "read"
	 * - `app`: app instance
	 *
	 * **Use cases:** modifying query options, adding filters
	 */
	beforeRead?: BeforeReadHook<TSelect, TApp>[] | BeforeReadHook<TSelect, TApp>;

	/**
	 * Runs after any operation that returns data
	 *
	 * **Available fields:**
	 * - `data`: Complete record (TSelect)
	 * - `original`: Original record (TSelect) - **only on update**
	 * - `operation`: "create" | "update" | "delete" | "read"
	 * - `app`: app instance
	 *
	 * **Use cases:** transforming output, adding computed fields, formatting
	 *
	 * @example
	 * ```ts
	 * afterRead: ({ data }) => {
	 *   // Add computed field
	 *   data.displayName = `${data.firstName} ${data.lastName}`;
	 * }
	 * ```
	 */
	afterRead?: AfterReadHook<TSelect, TApp>[] | AfterReadHook<TSelect, TApp>;

	/**
	 * Runs before delete operations
	 *
	 * **Available fields:**
	 * - `data`: Record to be deleted (TSelect)
	 * - `original`: Not available
	 * - `operation`: "delete"
	 * - `app`: app instance
	 *
	 * **Use cases:** preventing deletion, cascading deletes, creating backups
	 *
	 * @example
	 * ```ts
	 * beforeDelete: async ({ data, app }) => {
	 *   // Prevent deletion if has active relations
	 *   const hasOrders = await app.db.select().from(orders)
	 *     .where(eq(orders.userId, data.id));
	 *   if (hasOrders.length > 0) {
	 *     throw new Error('Cannot delete user with active orders');
	 *   }
	 * }
	 * ```
	 */
	beforeDelete?:
		| BeforeDeleteHook<TSelect, TApp>[]
		| BeforeDeleteHook<TSelect, TApp>;

	/**
	 * Runs after delete operations
	 *
	 * **Available fields:**
	 * - `data`: Deleted record (TSelect)
	 * - `original`: Not available
	 * - `operation`: "delete"
	 * - `app`: app instance
	 *
	 * **Use cases:** cleanup, logging, notifying users
	 *
	 * @example
	 * ```ts
	 * afterDelete: async ({ data, app }) => {
	 *   await app.queue.userDeleted.publish({ userId: data.id });
	 * }
	 * ```
	 */
	afterDelete?:
		| AfterDeleteHook<TSelect, TApp>[]
		| AfterDeleteHook<TSelect, TApp>;

	/**
	 * Runs before a workflow stage transition (transitionStage).
	 * Throw to abort the transition.
	 *
	 * **Context:** `data` (record), `fromStage`, `toStage`, `app`, `db`
	 */
	beforeTransition?:
		| TransitionHook<TSelect, TApp>[]
		| TransitionHook<TSelect, TApp>;

	/**
	 * Runs after a workflow stage transition (transitionStage).
	 *
	 * **Context:** `data` (record), `fromStage`, `toStage`, `app`, `db`
	 */
	afterTransition?:
		| TransitionHook<TSelect, TApp>[]
		| TransitionHook<TSelect, TApp>;
}

/**
 * WHERE clause for filtering results based on access
 * Generic version - will be typed based on collection fields
 */
export type AccessWhere<TFields = any> =
	TFields extends Record<string, any>
		? {
				[K in keyof TFields]?: any; // Will be properly typed in implementation
			} & {
				AND?: AccessWhere<TFields>[];
				OR?: AccessWhere<TFields>[];
				NOT?: AccessWhere<TFields>;
			}
		: Record<string, any>;

/**
 * Access control function can return:
 * - boolean: true (allow all) or false (deny all)
 * - AccessWhere: query conditions to filter results (TYPE-SAFE!)
 */
export type AccessRule<TRow = any, TFields = any, TApp = any> =
	| boolean
	| ((
			ctx: AccessContext<TRow, TApp>,
	  ) =>
			| boolean
			| AccessWhere<TFields>
			| Promise<boolean | AccessWhere<TFields>>);

/**
 * Field-level access control
 */
export interface FieldAccess<TRow = any, TApp = any> {
	read?: AccessRule<TRow, any, TApp>;
	create?: AccessRule<TRow, any, TApp>;
	update?: AccessRule<TRow, any, TApp>;
}

/**
 * Collection access control configuration
 */
export interface CollectionAccess<TRow = any, TApp = any> {
	// Operation-level access
	// Can return boolean OR where conditions to filter results
	read?: AccessRule<TRow, any, TApp>;
	create?: AccessRule<TRow, any, TApp>;
	update?: AccessRule<TRow, any, TApp>;
	delete?: AccessRule<TRow, any, TApp>;
	/**
	 * Access rule for workflow stage transitions.
	 * Falls back to `update` if not specified.
	 */
	transition?: AccessRule<TRow, any, TApp>;

	/**
	 * Field-scoped access rules.
	 *
	 * This is the source-of-truth for per-field authorization.
	 * Field-level access in field config is deprecated and removed from runtime.
	 */
	fields?: Record<string, FieldDefinitionAccess | FieldAccess<TRow, TApp>>;
}

// ============================================================================
// Form Builder Types (for .form() with typed reactive behaviors)
// ============================================================================

/**
 * Context for form reactive handlers.
 * Provides typed access to form data for conditions.
 */
export interface FormReactiveContext<TData = Record<string, any>> {
	/** Current form data - typed based on collection fields */
	data: TData;
	/** Sibling data (for fields inside arrays/objects) */
	sibling: Record<string, any>;
	/** Server context (db, session, etc.) */
	ctx: {
		db: any;
		user?: any;
		locale?: string;
	};
}

/**
 * Reactive handler function for form conditions.
 * Returns the computed value or condition result.
 */
export type FormReactiveHandler<TData, TReturn> = (
	ctx: FormReactiveContext<TData>,
) => TReturn | Promise<TReturn>;

/**
 * Reactive config with handler and optional explicit deps.
 */
export type FormReactiveConfig<TData, TReturn> =
	| FormReactiveHandler<TData, TReturn>
	| {
			handler: FormReactiveHandler<TData, TReturn>;
			deps?: string[] | ((ctx: FormReactiveContext<TData>) => any[]);
			debounce?: number;
	  };

/**
 * Form field entry with optional reactive behaviors.
 * Can be a simple field name or object with field + reactive config.
 *
 * @example Simple field
 * ```ts
 * f.name
 * ```
 *
 * @example Field with compute
 * ```ts
 * {
 *   field: f.slug,
 *   compute: {
 *     handler: ({ data }) => slugify(data.title),
 *     deps: ({ data }) => [data.title],
 *     debounce: 300,
 *   }
 * }
 * ```
 *
 * @example Field with hidden condition
 * ```ts
 * {
 *   field: f.cancellationReason,
 *   hidden: ({ data }) => data.status !== "cancelled"
 * }
 * ```
 */
export type FormFieldEntry<TData = any> =
	| string
	| {
			/** Field name (use f.fieldName) */
			field: string;
			/** Hide field conditionally */
			hidden?: FormReactiveConfig<TData, boolean>;
			/** Make field read-only conditionally */
			readOnly?: FormReactiveConfig<TData, boolean>;
			/** Disable field conditionally */
			disabled?: FormReactiveConfig<TData, boolean>;
			/** Auto-compute field value */
			compute?: FormReactiveConfig<TData, any>;
	  };

/**
 * Form section definition.
 */
export interface FormSection<TData = any> {
	label?: string | Record<string, string>;
	description?: string | Record<string, string>;
	fields: FormFieldEntry<TData>[];
	collapsible?: boolean;
	defaultCollapsed?: boolean;
}

/**
 * Form tab definition.
 */
export interface FormTab<TData = any> {
	label: string | Record<string, string>;
	icon?: { type: string; props?: Record<string, unknown> };
	sections: FormSection<TData>[];
}

/**
 * Form view configuration.
 * Used by .form() method on collection builder.
 */
export interface FormConfig<TData = any> {
	/** View type override */
	view?: string;
	/** Simple list of fields */
	fields?: FormFieldEntry<TData>[];
	/** Organized sections */
	sections?: FormSection<TData>[];
	/** Tabbed layout */
	tabs?: FormTab<TData>[];
}

/**
 * Proxy for field names in form builder.
 * Accessing f.fieldName returns the field name as string.
 */
export type FormFieldProxy<TFields extends Record<string, any>> = {
	[K in keyof TFields]: K & string;
};

/**
 * Context passed to .form() callback.
 */
export interface FormBuilderContext<TState extends CollectionBuilderState> {
	/** Field name proxy - f.fieldName returns "fieldName" */
	f: FormFieldProxy<TState["fields"]>;
}

/**
 * Main builder state that accumulates configuration through the chain
 * Using Drizzle-style single generic pattern for better type performance
 */
/**
 * Collection builder state - simplified interface
 * Type inference happens from builder usage, not from explicit generics
 */
export interface CollectionBuilderState {
	name: string;
	/** Drizzle columns extracted from field definitions */
	fields: Record<string, any>;
	/**
	 * Localized field names (computed from fieldDefinitions).
	 * Fields with `state.location === "i18n"` are considered localized.
	 */
	localized: readonly string[];
	virtuals: Record<string, SQL> | undefined;
	relations: Record<string, RelationConfig>;
	indexes: Record<string, any>;
	title: TitleExpression | undefined;
	options: CollectionOptions;
	hooks: CollectionHooks<any, any, any>;
	access: CollectionAccess;
	/**
	 * Search indexing configuration.
	 * - undefined: auto-index with defaults (title + auto-generated content)
	 * - false: explicitly disable indexing
	 * - SearchableConfig: custom indexing configuration
	 */
	searchable: SearchableConfig | false | undefined;
	validation: ValidationSchemas | undefined;
	/**
	 * Output type extensions - fields that are computed/populated in hooks
	 * but should appear in the select type. These are type-only and don't
	 * create database columns.
	 */
	output: Record<string, any> | undefined;
	/**
	 * Upload configuration - when set, enables file upload functionality
	 * for this collection including CRUD methods and HTTP routes.
	 */
	upload: UploadOptions | undefined;
	/**
	 * Field definitions from Field Builder.
	 * Stores the FieldDefinition objects for validation, introspection, and localization.
	 */
	fieldDefinitions: Record<string, FieldDefinition<FieldDefinitionState>>;
	/**
	 * Phantom type for QuestpieBuilder reference.
	 * Used to access field types registered via q.fields().
	 */
	"~questpieApp"?: any;
	/**
	 * Phantom type for field types available in .fields((f) => ...).
	 * Extracted from ~questpieApp at compile time for type inference.
	 * This is set directly rather than computed to avoid complex type inference.
	 */
	"~fieldTypes"?: Record<string, any>;
}

/**
 * Type helpers for extracting parts of the state
 */
export type ExtractName<TState extends CollectionBuilderState> = TState["name"];
export type ExtractFields<TState extends CollectionBuilderState> =
	TState["fields"];
export type ExtractLocalized<TState extends CollectionBuilderState> =
	TState["localized"];
export type ExtractVirtuals<TState extends CollectionBuilderState> =
	TState["virtuals"];
export type ExtractRelations<TState extends CollectionBuilderState> =
	TState["relations"];
export type ExtractIndexes<TState extends CollectionBuilderState> =
	TState["indexes"];
export type ExtractTitle<TState extends CollectionBuilderState> =
	TState["title"];
export type ExtractOptions<TState extends CollectionBuilderState> =
	TState["options"];
export type ExtractHooks<TState extends CollectionBuilderState> =
	TState["hooks"];
export type ExtractAccess<TState extends CollectionBuilderState> =
	TState["access"];

/**
 * Default empty state for a new collection
 *
 * @param TName - Collection name
 * @param TQuestpieApp - Reference to QuestpieBuilder instance (for accessing app config)
 * @param TFieldTypes - Field types available in .fields((f) => ...), passed directly to avoid type extraction issues
 */
export type EmptyCollectionState<
	TName extends string,
	TQuestpieApp = undefined,
	TFieldTypes extends Record<string, any> = Record<string, any>,
> = CollectionBuilderState & {
	name: TName;
	fields: {};
	localized: [];
	virtuals: undefined;
	relations: {};
	indexes: {};
	title: undefined;
	options: {};
	hooks: CollectionHooks<any, any, any>;
	access: {};
	searchable: undefined;
	validation: undefined;
	output: undefined;
	upload: undefined;
	fieldDefinitions: {};
	"~questpieApp": TQuestpieApp;
	"~fieldTypes": TFieldTypes;
};

/**
 * Any collection builder state (for type constraints)
 */
export type AnyCollectionState = CollectionBuilderState;

/**
 * Extract fields by location from TState-based field definitions.
 * New approach using FieldDefinition state.location property.
 */
export type ExtractFieldsByLocation<
	TFields extends Record<string, FieldDefinition<FieldDefinitionState>>,
	TLocation extends FieldLocation,
> = {
	[K in keyof TFields as TFields[K] extends FieldDefinition<infer TState>
		? TState extends FieldDefinitionState
			? TState["location"] extends TLocation
				? K
				: never
			: never
		: never]: TFields[K] extends FieldDefinition<infer TState>
		? TState extends FieldDefinitionState
			? TState["column"] extends null
				? never // Skip fields without columns (virtual, relations)
				: TState["column"]
			: never
		: never;
};

/**
 * Helper type to create i18n access object with SQL expressions
 * Maps each localized field to a SQL expression
 */
export type I18nFieldAccessor<
	TFields extends Record<string, any>,
	TLocalized extends ReadonlyArray<keyof TFields>,
> = {
	[K in TLocalized[number]]: SQL<GetColumnData<TFields[K]>>;
};

/**
 * Infer SQL result type from SQL<T>
 */
export type InferSQLType<T extends SQL> = T extends SQL<infer R> ? R : unknown;

export type InferColumnsFromFields<
	// TName extends string,
	TFields extends Record<string, any>,
	TOptions extends CollectionOptions,
	_TTitle extends TitleExpression | undefined,
> = ("id" extends keyof TFields
	? {} // User defined their own ID field, don't add default
	: ReturnType<typeof Collection.pkCols>) & {
	[K in keyof TFields]: TFields[K];
} & (TOptions["timestamps"] extends false
		? {}
		: ReturnType<typeof Collection.timestampsCols>) &
	(TOptions["softDelete"] extends true
		? ReturnType<typeof Collection.softDeleteCols>
		: {});

export type InferVersionColumnFromFields<
	// TName extends string,
	TFields extends Record<string, any>,
	_TTitle extends TitleExpression | undefined,
> = ReturnType<typeof Collection.versionCols> & {
	[K in keyof TFields]: TFields[K];
};
export type InferI18nVersionColumnFromFields<
	// TName extends string,
	TFields extends Record<string, any>,
	_TTitle extends TitleExpression | undefined,
> = ReturnType<typeof Collection.i18nVersionCols> & {
	[K in keyof TFields]: TFields[K];
};

// ============================================================================
// TState-based Column Inference (New Approach)
// ============================================================================

/**
 * Infer main table columns from TState-based field definitions.
 * Extracts only fields with location: "main" and non-null columns.
 */
export type InferMainColumnsFromFields<
	TFields extends Record<string, FieldDefinition<FieldDefinitionState>>,
	TOptions extends CollectionOptions,
	TUpload extends UploadOptions | undefined = undefined,
> = ("id" extends keyof ExtractFieldsByLocation<TFields, "main">
	? {} // User defined their own ID field, don't add default
	: ReturnType<typeof Collection.pkCols>) &
	ExtractFieldsByLocation<TFields, "main"> &
	(TOptions["timestamps"] extends false
		? {}
		: ReturnType<typeof Collection.timestampsCols>) &
	(TOptions["softDelete"] extends true
		? ReturnType<typeof Collection.softDeleteCols>
		: {}) &
	(TUpload extends UploadOptions
		? ReturnType<typeof Collection.uploadCols>
		: {});

/**
 * Infer i18n table columns from TState-based field definitions.
 * Extracts only fields with location: "i18n" and non-null columns.
 */
export type InferI18nColumnsFromFields<
	TFields extends Record<string, FieldDefinition<FieldDefinitionState>>,
> = ReturnType<typeof Collection.i18nCols> &
	ExtractFieldsByLocation<TFields, "i18n">;

/**
 * Infer main table type from TState-based field definitions.
 */
export type InferMainTableWithColumns<
	TName extends string,
	TFields extends Record<string, FieldDefinition<FieldDefinitionState>>,
	TOptions extends CollectionOptions,
	TUpload extends UploadOptions | undefined = undefined,
> = PgTableWithColumns<{
	name: TName;
	schema: undefined;
	columns: BuildColumns<
		TName,
		InferMainColumnsFromFields<TFields, TOptions, TUpload>,
		"pg"
	>;
	dialect: "pg";
}>;

/**
 * Infer i18n table type from TState-based field definitions.
 */
export type InferI18nTableWithColumns<
	TName extends string,
	TFields extends Record<string, FieldDefinition<FieldDefinitionState>>,
> = PgTableWithColumns<{
	name: LocalizedTableName<TName>;
	schema: undefined;
	columns: BuildColumns<
		LocalizedTableName<TName>,
		InferI18nColumnsFromFields<TFields>,
		"pg"
	>;
	dialect: "pg";
}>;

export type LocalizedTableName<TName extends string> = `${TName}_i18n`;
export type VersionedTableName<TName extends string> = `${TName}_versions`;
export type I18nVersionedTableName<TName extends string> =
	`${TName}_i18n_versions`;

/**
 * Infer table type from fields (excluding localized fields)
 * This builds the Drizzle PgTable type progressively
 */
export type InferTableWithColumns<
	TName extends string,
	TFields extends Record<string, any>,
	TTitle extends TitleExpression | undefined,
	TOptions extends CollectionOptions,
> = PgTableWithColumns<{
	name: TName;
	schema: undefined;
	columns: BuildColumns<
		TName,
		InferColumnsFromFields<TFields, TOptions, TTitle>,
		"pg"
	>;
	dialect: "pg";
}>;

export type InferVersionedTableWithColumns<
	TName extends string,
	TFields extends Record<string, any>,
	TTitle extends TitleExpression | undefined,
> = PgTableWithColumns<{
	name: VersionedTableName<TName>;
	schema: undefined;
	columns: BuildColumns<
		VersionedTableName<TName>,
		InferVersionColumnFromFields<TFields, TTitle>,
		"pg"
	>;
	dialect: "pg";
}>;

export type InferI18nVersionedTableWithColumns<
	TName extends string,
	TFields extends Record<string, any>,
	TTitle extends TitleExpression | undefined,
> = PgTableWithColumns<{
	name: I18nVersionedTableName<TName>;
	schema: undefined;
	columns: BuildColumns<
		I18nVersionedTableName<TName>,
		InferI18nVersionColumnFromFields<TFields, TTitle>,
		"pg"
	>;
	dialect: "pg";
}>;
