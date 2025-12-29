// src/server/global/builder/types.ts
import type { PgTableWithColumns } from "drizzle-orm/pg-core";
import type { BuildColumn, SQL } from "drizzle-orm";
import type {
	CollectionVersioningOptions,
	RelationConfig,
	NonLocalizedFields,
	I18nFieldAccessor,
	InferTableWithColumns,
	RelationVariant,
} from "#questpie/cms/server/collection/builder/types";

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
	 * Optional override for the database table name.
	 * If not specified, the global name is used.
	 */
	tableName?: string;
	/**
	 * Versioning configuration
	 */
	versioning?: boolean | CollectionVersioningOptions;
}

/**
 * Context for hooks and access control
 */
export interface GlobalHookContext<TRow = any> {
	db: any;
	row?: TRow;
	input?: any;
	locale?: string;
	user?: any;
}

/**
 * Access control context
 */
export interface GlobalAccessContext<TRow = any> {
	user?: any;
	row?: TRow;
	input?: any;
	db: any;
}

/**
 * Hook function type
 */
export type GlobalHookFunction<TRow = any> = (
	ctx: GlobalHookContext<TRow>,
) => Promise<void> | void;

/**
 * Global lifecycle hooks
 */
export interface GlobalHooks<TRow = any> {
	beforeUpdate?: GlobalHookFunction<TRow>[] | GlobalHookFunction<TRow>;
	afterUpdate?: GlobalHookFunction<TRow>[] | GlobalHookFunction<TRow>;
	beforeRead?: GlobalHookFunction[] | GlobalHookFunction;
	afterRead?: GlobalHookFunction<TRow>[] | GlobalHookFunction<TRow>;
	// Shorthand: runs on update
	beforeChange?: GlobalHookFunction<TRow>[] | GlobalHookFunction<TRow>;
	afterChange?: GlobalHookFunction<TRow>[] | GlobalHookFunction<TRow>;
}

/**
 * Access control function can return:
 * - boolean: true (allow) or false (deny)
 * - string: role name to check
 */
export type GlobalAccessRule<TRow = any> =
	| boolean
	| string // Role name
	| ((ctx: GlobalAccessContext<TRow>) => boolean | Promise<boolean>);

/**
 * Field-level access control
 */
export interface GlobalFieldAccess<TRow = any> {
	read?: GlobalAccessRule<TRow>;
	write?: GlobalAccessRule<TRow>;
}

/**
 * Global access control configuration
 */
export interface GlobalAccess<TRow = any> {
	read?: GlobalAccessRule<TRow>;
	update?: GlobalAccessRule<TRow>;

	// Optional: field-level access
	fields?: Record<string, GlobalFieldAccess<TRow>>;
}

export type GlobalBuilderRelationFn<
	TState extends GlobalBuilderState,
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
 * Main builder state for Global
 */
export type GlobalBuilderState<
	TName extends string = string,
	TFields extends Record<string, any> = Record<string, any>,
	TLocalized extends readonly any[] = readonly any[],
	TVirtuals extends Record<string, SQL> = Record<string, SQL>,
	TRelations extends Record<string, RelationConfig> = Record<
		string,
		RelationConfig
	>,
	TOptions extends GlobalOptions = GlobalOptions,
	THooks extends GlobalHooks = GlobalHooks,
	TAccess extends GlobalAccess = GlobalAccess,
> = {
	name: TName;
	fields: TFields;
	localized: TLocalized;
	virtuals: TVirtuals;
	relations: TRelations;
	options: TOptions;
	hooks: THooks;
	access: TAccess;
};

/**
 * Default empty state for a new global
 */
export type EmptyGlobalState<TName extends string> = GlobalBuilderState<
	TName,
	{},
	[],
	{},
	{},
	{},
	{},
	{}
>;

/**
 * Any global builder state
 */
export type AnyGlobalState = GlobalBuilderState<
	string,
	any,
	any,
	any,
	any,
	any,
	any,
	any
>;

// Helper types for inference (similar to Collection)
export type InferGlobalColumnsFromFields<
	TName extends string,
	TFields extends Record<string, any>,
	TOptions extends GlobalOptions,
> = {
	[K in keyof TFields]: BuildColumn<TName, TFields[K], "pg">;
} & (TOptions["timestamps"] extends false
	? {}
	: ReturnType<
			typeof import("#questpie/cms/server/collection/builder/collection").Collection.timestampsCols
		>);

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
