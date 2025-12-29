// builder/types.ts
import type { Collection } from "#questpie/cms/server/collection/builder/collection";
import type { SearchableConfig } from "#questpie/cms/server/integrated/search";
import type {
	BuildColumns,
	BuildExtraConfigColumns,
	GetColumnData,
	SQL,
} from "drizzle-orm";
import type { PgColumn, PgTableWithColumns } from "drizzle-orm/pg-core";

/**
 * Versioning configuration
 */
export interface CollectionVersioningOptions {
	enabled: boolean;
	maxVersions?: number; // default: 50
}

/**
 * Options for collection configuration
 */
export interface CollectionOptions {
	/**
	 * Whether to automatically add `createdAt` and `updatedAt` timestamp fields.
	 * @default true
	 */
	timestamps?: boolean;
	/**
	 * Whether to enable soft deletion with a `deletedAt` timestamp field.
	 * @default false
	 */
	softDelete?: boolean;
	/**
	 * Optional override for the database table name.
	 * If not specified, the collection name is used.
	 */
	tableName?: string;
	/**
	 * Versioning configuration
	 */
	versioning?: boolean | CollectionVersioningOptions;
}

/**
 * Relation configuration
 */
export type RelationType = "one" | "many" | "manyToMany" | "polymorphic";

export interface RelationConfig {
	type: RelationType;
	collection: string;
	fields?: PgColumn[];
	references?: string[];
	relationName?: string; // For linking corresponding relations
	onDelete?: "cascade" | "set null" | "restrict" | "no action";
	onUpdate?: "cascade" | "set null" | "restrict" | "no action";
	// Many-to-Many specific fields
	through?: string; // Junction table collection name
	sourceKey?: string; // Primary key on source table (default: "id")
	sourceField?: string; // Foreign key column in junction table pointing to source
	targetKey?: string; // Primary key on target table (default: "id")
	targetField?: string; // Foreign key column in junction table pointing to target
	// Polymorphic specific fields
	typeField?: PgColumn; // Column storing the type/collection name
	idField?: PgColumn; // Column storing the ID
	collections?: Record<string, string>; // Map of type values to collection names
}

export type CollectionBuilderRelationFn<
	TState extends CollectionBuilderState,
	TNewRelations extends Record<string, RelationConfig>,
> = (
	ctx: {
		table: InferTableWithColumns<
			TState["name"],
			NonLocalizedFields<TState["fields"], TState["localized"]>,
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
	TNewVirtuals extends Record<string, SQL>,
> = (ctx: {
	table: InferTableWithColumns<
		TState["name"],
		NonLocalizedFields<TState["fields"], TState["localized"]>,
		undefined,
		TState["options"]
	>;
	i18n: I18nFieldAccessor<TState["fields"], TState["localized"]>;
	context: any;
}) => TNewVirtuals;

/**
 * Context for title callback
 */
export type CollectionBuilderTitleFn<
	TState extends CollectionBuilderState,
	TNewTitle extends SQL | undefined,
> = (ctx: {
	table: InferTableWithColumns<
		TState["name"],
		NonLocalizedFields<TState["fields"], TState["localized"]>,
		undefined,
		TState["options"]
	>;
	i18n: I18nFieldAccessor<TState["fields"], TState["localized"]>;
	context: any;
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
		InferColumnsFromFields<TState["fields"], TState["options"], TState["title"]>,
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
	polymorphic: (config: {
		typeField: PgColumn; // Column storing the collection name
		idField: PgColumn; // Column storing the ID
		collections: Record<string, string>; // Map of type values to collection names (e.g., { posts: "posts", products: "products" })
	}) => RelationConfig & { type: "polymorphic" };
}

/**
 * Context for hooks - receives full CMS access
 * @template TData - The record data type (created/updated/deleted)
 * @template TCMS - The CMS type for full type safety
 */
export interface HookContext<TData = any, TCMS = any> {
	/**
	 * The record data (created/updated record)
	 */
	data: TData;

	/**
	 * Original record (for update/delete operations)
	 */
	original?: TData;

	/**
	 * Current authenticated user (from request context)
	 */
	user?: any;

	/**
	 * Current locale
	 */
	locale?: string;

	/**
	 * Access mode (system or user)
	 */
	accessMode?: "user" | "system";

	/**
	 * Operation type
	 */
	operation: "create" | "update" | "delete" | "read";

	/**
	 * Full CMS instance - type-safe access to all services and collections
	 * Example: cms.queue.publish(...), cms.email.send(...), cms.logger.info(...)
	 */
	cms: TCMS;

	/**
	 * Database client (for advanced use cases)
	 */
	db?: any;

	/**
	 * Legacy input field (deprecated, use data instead)
	 * @deprecated Use data instead
	 */
	input?: any;

	/**
	 * Legacy row field (deprecated, use data instead)
	 * @deprecated Use data instead
	 */
	row?: TData;
}

/**
 * Access control context
 */
export interface AccessContext<TRow = any> {
	user?: any;
	row?: TRow;
	input?: any;
	db: any;
	context?: any;
}

/**
 * Hook function type
 * @template TData - The record data type
 * @template TCMS - The CMS type for full type safety
 */
export type HookFunction<TData = any, TCMS = any> = (
	ctx: HookContext<TData, TCMS>,
) => Promise<void> | void;

/**
 * Collection lifecycle hooks
 * Each hook type can have multiple functions (executed in order)
 * @template TRow - The record type
 * @template TCMS - The CMS type for full type safety in hooks
 */
export interface CollectionHooks<TRow = any, TCMS = any> {
	beforeCreate?: HookFunction<TRow, TCMS>[] | HookFunction<TRow, TCMS>;
	afterCreate?: HookFunction<TRow, TCMS>[] | HookFunction<TRow, TCMS>;
	beforeUpdate?: HookFunction<TRow, TCMS>[] | HookFunction<TRow, TCMS>;
	afterUpdate?: HookFunction<TRow, TCMS>[] | HookFunction<TRow, TCMS>;
	beforeDelete?: HookFunction<TRow, TCMS>[] | HookFunction<TRow, TCMS>;
	afterDelete?: HookFunction<TRow, TCMS>[] | HookFunction<TRow, TCMS>;
	beforeRead?: HookFunction<TRow, TCMS>[] | HookFunction<TRow, TCMS>;
	afterRead?: HookFunction<TRow, TCMS>[] | HookFunction<TRow, TCMS>;
	// Shorthand: runs on both create AND update
	beforeChange?: HookFunction<TRow, TCMS>[] | HookFunction<TRow, TCMS>;
	afterChange?: HookFunction<TRow, TCMS>[] | HookFunction<TRow, TCMS>;
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
 * - string: role name to check
 * - AccessWhere: query conditions to filter results (TYPE-SAFE!)
 */
export type AccessRule<TRow = any, TFields = any> =
	| boolean
	| string // Role name
	| ((
			ctx: AccessContext<TRow>,
	  ) =>
			| boolean
			| AccessWhere<TFields>
			| Promise<boolean | AccessWhere<TFields>>);

/**
 * Field-level access control
 */
export interface FieldAccess<TRow = any> {
	read?: AccessRule<TRow>;
	write?: AccessRule<TRow>;
}

/**
 * Collection access control configuration
 */
export interface CollectionAccess<TRow = any> {
	// Operation-level access
	// Can return boolean OR where conditions to filter results
	read?: AccessRule<TRow>;
	create?: AccessRule<TRow>;
	update?: AccessRule<TRow>;
	delete?: AccessRule<TRow>;

	// Optional: field-level access
	fields?: Record<string, FieldAccess<TRow>>;
}

/**
 * Main builder state that accumulates configuration through the chain
 * Using Drizzle-style single generic pattern for better type performance
 */
export type CollectionBuilderState<
	TName extends string = string,
	TFields extends Record<string, any> = Record<string, any>,
	TLocalized extends readonly any[] = readonly any[],
	TVirtuals extends Record<string, SQL> = Record<string, SQL>,
	TRelations extends Record<string, RelationConfig> = Record<
		string,
		RelationConfig
	>,
	TIndexes extends Record<string, any> = Record<string, any>,
	TTitle extends SQL | undefined = SQL | undefined,
	TOptions extends CollectionOptions = CollectionOptions,
	THooks extends CollectionHooks = CollectionHooks,
	TAccess extends CollectionAccess = CollectionAccess,
	TSearchable extends SearchableConfig | undefined =
		| SearchableConfig
		| undefined,
> = {
	name: TName;
	fields: TFields;
	localized: TLocalized;
	virtuals: TVirtuals;
	relations: TRelations;
	indexes: TIndexes;
	title: TTitle;
	options: TOptions;
	hooks: THooks;
	access: TAccess;
	searchable: TSearchable;
};

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
 */
export type EmptyCollectionState<TName extends string> = CollectionBuilderState<
	TName,
	{},
	[],
	{},
	{},
	{},
	undefined,
	{},
	{},
	{},
	undefined
>;

/**
 * Any collection builder state (for type constraints)
 */
export type AnyCollectionState = CollectionBuilderState<
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any
>;

/**
 * Extract non-localized fields from field definitions
 */
export type NonLocalizedFields<
	TFields extends Record<string, any>,
	TLocalized extends ReadonlyArray<keyof TFields>,
> = Omit<TFields, TLocalized[number]>;

/**
 * Extract localized fields from field definitions
 */
export type LocalizedFields<
	TFields extends Record<string, any>,
	TLocalized extends ReadonlyArray<keyof TFields>,
> = Pick<TFields, TLocalized[number]>;

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
	_TTitle extends SQL | undefined,
> = ReturnType<typeof Collection.pkCols> & {
	[K in keyof TFields]: TFields[K];
} & (TOptions["timestamps"] extends false
		? {}
		: ReturnType<typeof Collection.timestampsCols>) &
	(TOptions["softDelete"] extends true
		? ReturnType<typeof Collection.softDeleteCols>
		: {});

/**
 * Infer table type from fields (excluding localized fields)
 * This builds the Drizzle PgTable type progressively
 */
export type InferTableWithColumns<
	TName extends string,
	TFields extends Record<string, any>,
	TTitle extends SQL | undefined,
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
export type LocalizedTableName<TName extends string> = `${TName}_i18n`;
