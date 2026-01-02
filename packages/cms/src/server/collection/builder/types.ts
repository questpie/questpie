// builder/types.ts
import type { Collection } from "#questpie/cms/server/collection/builder/collection";
import type { SearchableConfig } from "#questpie/cms/server/integrated/search";
import type { FunctionDefinition } from "#questpie/cms/server/functions/types";
import type { AccessMode } from "#questpie/cms/server/config/types";
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
	 * Versioning configuration
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
	accessMode?: AccessMode;

	/**
	 * Operation type
	 */
	operation: "create" | "update" | "delete" | "read";

	/**
	 * Full CMS instance - type-safe access to all services and collections
	 * Example: cms.queue["job-name"].publish(...), cms.email.send(...), cms.logger.info(...)
	 * For ergonomic typing without generic params, use getCMSFromContext().
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

export type CollectionFunctionsMap = Record<string, FunctionDefinition>;

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
	fields: Record<string, any>; // Allow any Drizzle column type
	localized: readonly any[];
	virtuals: Record<string, SQL>;
	relations: Record<string, RelationConfig>;
	indexes: Record<string, any>;
	title: SQL | undefined;
	options: CollectionOptions;
	hooks: CollectionHooks;
	access: CollectionAccess;
	functions: CollectionFunctionsMap;
	searchable: SearchableConfig | undefined;
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
export type ExtractFunctions<TState extends CollectionBuilderState> =
	TState["functions"];

/**
 * Default empty state for a new collection
 */
export type EmptyCollectionState<TName extends string> =
	CollectionBuilderState & {
		name: TName;
		fields: {};
		localized: [];
		virtuals: {};
		relations: {};
		indexes: {};
		title: undefined;
		options: {};
		hooks: {};
		access: {};
		functions: {};
		searchable: undefined;
	};

/**
 * Any collection builder state (for type constraints)
 */
export type AnyCollectionState = CollectionBuilderState;

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

export type InferVersionColumnFromFields<
	// TName extends string,
	TFields extends Record<string, any>,
	_TTitle extends SQL | undefined,
> = ReturnType<typeof Collection.versionCols> & {
	[K in keyof TFields]: TFields[K];
};
export type InferI18nVersionColumnFromFields<
	// TName extends string,
	TFields extends Record<string, any>,
	_TTitle extends SQL | undefined,
> = ReturnType<typeof Collection.i18nVersionCols> & {
	[K in keyof TFields]: TFields[K];
};

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

export type InferI18nTableWithColumns<
	TName extends string,
	TFields extends Record<string, any>,
	TTitle extends SQL | undefined,
> = PgTableWithColumns<{
	name: LocalizedTableName<TName>;
	schema: undefined;
	columns: BuildColumns<
		LocalizedTableName<TName>,
		InferColumnsFromFields<TFields, {}, TTitle>,
		"pg"
	>;
	dialect: "pg";
}>;

export type InferVersionedTableWithColumns<
	TName extends string,
	TFields extends Record<string, any>,
	TTitle extends SQL | undefined,
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
	TTitle extends SQL | undefined,
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
