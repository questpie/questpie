// crud/types.ts - Type definitions for CRUD operations (Drizzle RQB v2-like)

import type { SQL } from "drizzle-orm";
import type { RequestContext } from "#questpie/cms/server/config/context";

/**
 * Context passed to CRUD operations
 * Extends RequestContext with CRUD-specific options
 * @default accessMode: 'system' - CMS API is backend-only by default
 */
export type CRUDContext = RequestContext;

/**
 * WHERE clause operators for type-safe filtering
 * These match Drizzle's RQB v2 operators
 */
export interface WhereOperators<T> {
	eq?: T;
	ne?: T;
	gt?: T extends Date ? Date | string : T extends number | string ? T : never;
	gte?: T extends Date ? Date | string : T extends number | string ? T : never;
	lt?: T extends Date ? Date | string : T extends number | string ? T : never;
	lte?: T extends Date ? Date | string : T extends number | string ? T : never;
	in?: T[];
	notIn?: T[];
	like?: T extends string ? string : never;
	ilike?: T extends string ? string : never;
	notLike?: T extends string ? string : never;
	notIlike?: T extends string ? string : never;
	contains?: T extends string ? string : never;
	startsWith?: T extends string ? string : never;
	endsWith?: T extends string ? string : never;
	isNull?: boolean;
	isNotNull?: boolean;
	arrayOverlaps?: T extends any[] ? T : never;
	arrayContained?: T extends any[] ? T : never;
	arrayContains?: T extends any[] ? T : never;
}

/**
 * Relation WHERE clause for filtering
 * Supports "some/none/every" for collections and "is/isNot" for single relations
 */
export type RelationFilter<TFields = any, TRelations = any> =
	| Where<TFields, TRelations>
	| {
			some?: Where<TFields, TRelations>;
			none?: Where<TFields, TRelations>;
			every?: Where<TFields, TRelations>;
			is?: Where<TFields, TRelations>;
			isNot?: Where<TFields, TRelations>;
	  };

/**
 * WHERE clause for filtering
 * Supports field conditions, logical operators, and relations
 */
export type Where<TFields = any, TRelations = any> = {
	[K in keyof TFields]?: TFields[K] | WhereOperators<TFields[K]>;
} & {
	AND?: Where<TFields, TRelations>[];
	OR?: Where<TFields, TRelations>[];
	NOT?: Where<TFields, TRelations>;
	// RAW allows custom SQL expressions
	RAW?: (table: any) => SQL;
} & (TRelations extends Record<string, any>
		? {
				[K in keyof TRelations]?: RelationFilter<any, any>;
			}
		: {});

/**
 * Columns selection for partial field selection
 * - true: include field
 * - false: exclude field (ignored if any true is present)
 */
export type Columns<TFields = any> = {
	[K in keyof TFields]?: boolean;
};

/**
 * Order by direction
 */
export type OrderByDirection = "asc" | "desc";

/**
 * Order by clause
 * - Object syntax: { field: 'asc' | 'desc' }
 * - Function syntax: (table, { asc, desc }) => [asc(table.id), desc(table.name)]
 */
export type OrderBy<TFields = any> =
	| {
			[K in keyof TFields]?: OrderByDirection;
	  }
	| ((
			table: any,
			helpers: { asc: (col: any) => SQL; desc: (col: any) => SQL },
	  ) => SQL[]);

/**
 * Extras for custom SQL fields
 * - Object syntax: { field: sql`...` }
 * - Function syntax: (table, { sql }) => ({ field: sql`...` })
 */
export type Extras<_TResult = any> =
	| Record<string, SQL>
	| ((table: any, helpers: { sql: any }) => Record<string, SQL>);

/**
 * Aggregation options for relations
 */
export interface RelationAggregation<TFields = any> {
	_count?: boolean; // Count related records
	_sum?: {
		[K in keyof TFields]?: boolean; // Sum numeric fields
	};
	_avg?: {
		[K in keyof TFields]?: boolean; // Average numeric fields
	};
	_min?: {
		[K in keyof TFields]?: boolean; // Minimum value
	};
	_max?: {
		[K in keyof TFields]?: boolean; // Maximum value
	};
}

/**
 * WITH clause for including relations
 * Supports nested relations and sub-queries
 */
export type With<TRelations = any> = {
	[K in keyof TRelations]?:
		| boolean
		| {
				columns?: Columns;
				where?: Where;
				orderBy?: OrderBy;
				limit?: number;
				offset?: number;
				with?: With;
				// Aggregation: if specified, returns aggregate data instead of full records
				_aggregate?: RelationAggregation;
				// Shorthand for just count
				_count?: boolean;
		  };
};

/**
 * Options for findMany query (Drizzle RQB v2-like)
 */
export interface FindManyOptions<TFields = any, TRelations = any> {
	where?: Where<TFields, TRelations>;
	columns?: Columns<TFields>;
	with?: With<TRelations>;
	orderBy?: OrderBy<TFields>;
	limit?: number;
	offset?: number;
	extras?: Extras;
}

/**
 * Options for findFirst query (Drizzle RQB v2-like)
 * Same as FindManyOptions but without limit/offset (always limit 1)
 */
export interface FindFirstOptions<TFields = any, TRelations = any> {
	where?: Where<TFields, TRelations>;
	columns?: Columns<TFields>;
	with?: With<TRelations>;
	orderBy?: OrderBy<TFields>;
	extras?: Extras;
}

/**
 * Nested relation operations for create/update
 */
export interface NestedRelationConnect {
	id: string; // Connect to existing record by ID
}

export interface NestedRelationCreate<TInsert = any> {
	data: TInsert; // Create new record
}

export interface NestedRelationConnectOrCreate<TInsert = any> {
	where: { id: string }; // Check if exists
	create: TInsert; // Create if doesn't exist
}

/**
 * Nested relation mutation options
 */
export type NestedRelationMutation<TInsert = any> = {
	connect?: NestedRelationConnect | NestedRelationConnect[]; // Link existing record(s)
	create?: TInsert | TInsert[]; // Create new record(s)
	connectOrCreate?:
		| NestedRelationConnectOrCreate<TInsert>
		| NestedRelationConnectOrCreate<TInsert>[]; // Create if doesn't exist
};

/**
 * Create input with optional nested relations
 */
export type CreateInput<TInsert = any, TRelations = any> = TInsert & {
	[K in keyof TRelations]?: NestedRelationMutation<any>;
};

/**
 * Update single record params
 */
export interface UpdateParams<TUpdate = any> {
	id: string; // UUID
	data: Partial<TUpdate>;
}

/**
 * Update many records params
 */
export interface UpdateManyParams<
	TUpdate = any,
	TFields = any,
	TRelations = any,
> {
	where: Where<TFields, TRelations>;
	data: Partial<TUpdate>;
}

/**
 * Delete single record params
 */
export interface DeleteParams {
	id: string; // UUID
}

/**
 * Delete many records params
 */
export interface DeleteManyParams<TFields = any, TRelations = any> {
	where: Where<TFields, TRelations>;
}

export interface FindVersionsOptions {
	id: string;
	limit?: number;
	offset?: number;
}

export interface FindVersionOptions {
	id: string;
	version: number;
}

export interface RevertVersionOptions {
	id: string;
	version: number;
}

export interface VersionRecord {
	id: string;
	parentId: string;
	version: number;
	operation: string;
	data: any;
	userId: string | null;
	createdAt: Date;
}

export interface PaginatedResult<T> {
	docs: T[];
	totalDocs: number;
	limit: number;
	totalPages: number;
	page: number;
	pagingCounter: number;
	hasPrevPage: boolean;
	hasNextPage: boolean;
	prevPage: number | null;
	nextPage: number | null;
}

/**
 * Type Helper for Partial Selection
 * Picks fields based on 'columns' option. Always includes 'id'.
 */
export type SelectResult<
	TSelect,
	TQuery extends { columns?: any },
> = TQuery["columns"] extends Record<string, boolean>
	? Pick<TSelect, Extract<keyof TQuery["columns"], keyof TSelect> | "id">
	: TSelect;

/**
 * Helper type for Aggregation Result
 */
export type AggregationResult<TAgg extends RelationAggregation> =
	(TAgg["_count"] extends true ? { _count: number } : {}) &
		(TAgg["_sum"] extends object
			? { _sum: { [K in keyof TAgg["_sum"]]: number } }
			: {}) &
		(TAgg["_avg"] extends object
			? { _avg: { [K in keyof TAgg["_avg"]]: number } }
			: {}) &
		(TAgg["_min"] extends object
			? { _min: { [K in keyof TAgg["_min"]]: any } }
			: {}) &
		(TAgg["_max"] extends object
			? { _max: { [K in keyof TAgg["_max"]]: any } }
			: {});

/**
 * Type Helper for Relations Inclusion
 * Adds keys based on 'with' option.
 * Uses the inferred relation types from TRelations.
 * Handles Array vs Single relations and Aggregations.
 */
export type RelationResult<
	TRelations,
	TQuery extends { with?: any },
> = TQuery["with"] extends Record<string, any>
	? {
			[K in keyof TQuery["with"]]: K extends keyof TRelations
				? TRelations[K] extends (infer S)[]
					? TQuery["with"][K] extends { _count: true } | { _aggregate: any }
						? (TQuery["with"][K] extends { _count: true }
								? { _count: number }
								: {}) &
								(TQuery["with"][K] extends { _aggregate: infer Agg }
									? Agg extends RelationAggregation
										? AggregationResult<Agg>
										: {}
									: {})
						: ApplyQuery<S, any, TQuery["with"][K]>[]
					: ApplyQuery<TRelations[K], any, TQuery["with"][K]>
				: never;
		}
	: {};

/**
 * Combined Result Type
 * Merges partial selection and included relations.
 */
export type ApplyQuery<
	TSelect,
	TRelations,
	TQuery extends FindManyOptions<TSelect, TRelations> | undefined,
> = TQuery extends undefined
	? TSelect
	: SelectResult<TSelect, NonNullable<TQuery>> &
			RelationResult<TRelations, NonNullable<TQuery>>;

/**
 * CRUD operations interface
 * Clear naming: find/findOne for reads, updateById/update for updates, deleteById/delete for deletes
 */
export interface CRUD<
	TSelect = any,
	TInsert = any,
	TUpdate = any,
	TRelations = any,
> {
	/**
	 * Find many records (paginated)
	 * Returns type-safe result based on columns and with options
	 */
	find<TQuery extends FindManyOptions<TSelect, TRelations>>(
		options?: TQuery,
		context?: CRUDContext,
	): Promise<PaginatedResult<ApplyQuery<TSelect, TRelations, TQuery>>>;

	/**
	 * Find single record matching query
	 * Returns type-safe result based on columns and with options
	 */
	findOne<TQuery extends FindFirstOptions<TSelect, TRelations>>(
		options?: TQuery,
		context?: CRUDContext,
	): Promise<ApplyQuery<TSelect, TRelations, TQuery> | null>;

	/**
	 * Count records matching query
	 */
	count(
		options?: Pick<FindManyOptions<TSelect, TRelations>, "where">,
		context?: CRUDContext,
	): Promise<number>;

	/**
	 * Create a new record
	 */
	create(input: CreateInput<TInsert>, context?: CRUDContext): Promise<TSelect>;

	/**
	 * Update a single record by ID
	 */
	updateById(
		params: UpdateParams<TUpdate>,
		context?: CRUDContext,
	): Promise<TSelect>;

	/**
	 * Update multiple records matching where clause
	 * Uses batched SQL operation for efficiency
	 */
	update(
		params: UpdateManyParams<TUpdate, TSelect, TRelations>,
		context?: CRUDContext,
	): Promise<TSelect[]>;

	/**
	 * Delete a single record by ID (supports soft delete)
	 */
	deleteById(
		params: DeleteParams,
		context?: CRUDContext,
	): Promise<{ success: boolean }>;

	/**
	 * Delete multiple records matching where clause
	 * Uses batched SQL operation for efficiency
	 */
	delete(
		params: DeleteManyParams<TSelect, TRelations>,
		context?: CRUDContext,
	): Promise<{ success: boolean; count: number }>;

	/**
	 * Find versions of a record
	 */
	findVersions(
		options: FindVersionsOptions,
		context?: CRUDContext,
	): Promise<VersionRecord[]>;

	/**
	 * Revert to a specific version
	 */
	revertToVersion(
		options: RevertVersionOptions,
		context?: CRUDContext,
	): Promise<TSelect>;

	// Backwards compatibility aliases
	findMany?: <TQuery extends FindManyOptions<TSelect, TRelations>>(
		options?: TQuery,
		context?: CRUDContext,
	) => Promise<PaginatedResult<ApplyQuery<TSelect, TRelations, TQuery>>>;
	findFirst?: <TQuery extends FindFirstOptions<TSelect, TRelations>>(
		options?: TQuery,
		context?: CRUDContext,
	) => Promise<ApplyQuery<TSelect, TRelations, TQuery> | null>;
	updateMany?: (
		params: UpdateManyParams<TUpdate, TSelect, TRelations>,
		context?: CRUDContext,
	) => Promise<TSelect[]>;
	deleteMany?: (
		params: DeleteManyParams<TSelect, TRelations>,
		context?: CRUDContext,
	) => Promise<{ success: boolean; count: number }>;

	// Internal properties (not part of public API)
	__internalState?: any;
	__internalRelatedTable?: any;
	__internalI18nTable?: any;
}
