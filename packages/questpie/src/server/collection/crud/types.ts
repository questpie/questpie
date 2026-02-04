// crud/types.ts - Type definitions for CRUD operations (Drizzle RQB v2-like)

import type { SQL } from "drizzle-orm";
import type {
	CollectionOptions,
	InferRelationConfigsFromFields,
	RelationConfig,
	UploadOptions,
} from "#questpie/server/collection/builder/types.js";
import type { RequestContext } from "#questpie/server/config/context.js";
import type {
	FieldDefinitionsWithSystem,
	FieldSelect,
	FieldWhere,
} from "#questpie/server/fields/field-types.js";
import type {
	FieldDefinition,
	FieldDefinitionState,
} from "#questpie/server/fields/types.js";
import type {
	AnyCollectionOrBuilder,
	CollectionInsert as CollectionInsertFromInfer,
	CollectionRelations,
	CollectionSelect as CollectionSelectFromInfer,
	CollectionState,
	CollectionUpdate as CollectionUpdateFromInfer,
	ExtractRelationApp,
	ExtractRelationCollection,
	ExtractRelationInsert,
	ExtractRelationRelations,
	ExtractRelationSelect,
	GetCollection,
	Prettify,
	RelationShape,
} from "#questpie/shared/type-utils.js";

/**
 * File object for upload operations
 * Compatible with Web File API and framework adapters
 * Supports streaming for efficient large file uploads
 */
export interface UploadFile {
	/** Original filename */
	name: string;
	/** MIME type */
	type: string;
	/** Size in bytes */
	size: number;
	/** Get file contents as ArrayBuffer (fallback for non-streaming) */
	arrayBuffer: () => Promise<ArrayBuffer>;
	/**
	 * Get file contents as a ReadableStream (preferred for large files)
	 * When available, this is used instead of arrayBuffer for efficient streaming
	 */
	stream?: () => ReadableStream<Uint8Array>;
}

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
export interface WhereOperatorsLegacy<T> {
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
 * Helper type to detect if a type is `any`
 * Returns true only if T is the `any` type
 */
type IsAny<T> = 0 extends 1 & T ? true : false;

type IsCollectionLike<T> =
	IsAny<T> extends true
		? false
		: T extends AnyCollectionOrBuilder
			? true
			: false;

type AppCollections<TApp> = TApp extends { collections: infer TCollections }
	? TCollections extends Record<string, AnyCollectionOrBuilder>
		? TCollections
		: Record<string, AnyCollectionOrBuilder>
	: Record<string, AnyCollectionOrBuilder>;

type CollectionStateFor<TCollection> = CollectionState<TCollection>;

/**
 * Extract field definitions from a collection, with system fields auto-inserted.
 * System fields (id, createdAt, updatedAt, deletedAt, _title, upload fields)
 * are merged based on collection options — user-defined fields always win.
 */
type CollectionFieldDefinitions<TCollection> =
	CollectionStateFor<TCollection> extends {
		fieldDefinitions: infer TDefs;
		options: infer TOptions;
		upload: infer TUpload;
	}
		? TDefs extends Record<string, FieldDefinition<FieldDefinitionState>>
			? TOptions extends CollectionOptions
				? FieldDefinitionsWithSystem<
						TDefs,
						TOptions,
						TUpload extends UploadOptions ? TUpload : undefined
					>
				: FieldDefinitionsWithSystem<TDefs, {}, undefined>
			: TDefs
		: CollectionStateFor<TCollection> extends {
					fieldDefinitions: infer TDefs;
				}
			? TDefs
			: Record<string, never>;

type CollectionOutputExtensions<TCollection> =
	CollectionStateFor<TCollection> extends { output: infer TOutput }
		? TOutput extends Record<string, any>
			? TOutput
			: Record<never, never>
		: Record<never, never>;

/**
 * Try to infer RelationConfig map from field definitions.
 * Returns the inferred map if it has specific keys, else falls back to empty.
 */
type InferRelationsFromFieldDefs<TFieldDefs> =
	TFieldDefs extends Record<string, FieldDefinition<FieldDefinitionState>>
		? InferRelationConfigsFromFields<TFieldDefs> extends infer TInferred
			? TInferred extends Record<string, RelationConfig>
				? keyof TInferred extends never
					? Record<string, RelationConfig>
					: TInferred
				: Record<string, RelationConfig>
			: Record<string, RelationConfig>
		: Record<string, RelationConfig>;

/**
 * Check if a Record type has specific keys (not just an index signature or empty).
 */
type HasSpecificKeys<T extends Record<string, any>> = string extends keyof T
	? false
	: keyof T extends never
		? false
		: true;

/**
 * Extract relations from a collection.
 *
 * Priority:
 * 1. state.relations when it has specific keys (from legacy .relations() API)
 * 2. Inferred from state.fieldDefinitions (from .fields() API with f.relation())
 * 3. Fallback: empty Record<string, RelationConfig>
 *
 * This ensures the unified fields API (which puts relation info in fieldDefinitions
 * but NOT in state.relations) correctly resolves relation types for With/Where clauses.
 */
type CollectionRelationsFor<TCollection> =
	CollectionStateFor<TCollection> extends {
		relations: infer TRelations;
	}
		? TRelations extends Record<string, RelationConfig>
			? HasSpecificKeys<TRelations> extends true
				? TRelations
				: InferRelationsFromFieldDefs<CollectionFieldDefinitions<TCollection>>
			: InferRelationsFromFieldDefs<CollectionFieldDefinitions<TCollection>>
		: InferRelationsFromFieldDefs<CollectionFieldDefinitions<TCollection>>;

type HasFieldDefinitions<TDefs> =
	TDefs extends Record<string, FieldDefinition<FieldDefinitionState>>
		? keyof TDefs extends never
			? false
			: true
		: false;

type DecrementDepth<Depth extends unknown[]> = Depth extends [
	unknown,
	...infer Rest,
]
	? Rest
	: [];

type OperatorValue<TFn> = TFn extends (...args: any[]) => any
	? Parameters<TFn>[1]
	: never;

type OperatorKeysFromFieldDef<TFieldDef> =
	TFieldDef extends FieldDefinition<any>
		?
				| keyof ReturnType<TFieldDef["getOperators"]>["column"]
				| keyof ReturnType<TFieldDef["getOperators"]>["jsonb"]
		: never;

type OperatorValueFromFieldDef<TFieldDef, K> =
	TFieldDef extends FieldDefinition<any>
		?
				| (K extends keyof ReturnType<TFieldDef["getOperators"]>["column"]
						? OperatorValue<ReturnType<TFieldDef["getOperators"]>["column"][K]>
						: never)
				| (K extends keyof ReturnType<TFieldDef["getOperators"]>["jsonb"]
						? OperatorValue<ReturnType<TFieldDef["getOperators"]>["jsonb"][K]>
						: never)
		: never;

type FieldOperatorsFromFieldDef<TFieldDef> =
	TFieldDef extends FieldDefinition<any>
		? {
				[K in OperatorKeysFromFieldDef<TFieldDef>]?: OperatorValueFromFieldDef<
					TFieldDef,
					K
				>;
			}
		: Record<never, never>;

export type WhereOperators<T> =
	T extends FieldDefinition<any>
		? FieldOperatorsFromFieldDef<T>
		: WhereOperatorsLegacy<T>;

/**
 * Helper type to get value type from array or single relation
 */
type RelationValue<T> = T extends (infer U)[] ? U : T;

type RelationTargetNameFromConfig<TConfig> = TConfig extends {
	to: infer TTo;
}
	? TTo extends string
		? TTo
		: TTo extends () => { name: infer TName extends string }
			? TName
			: TTo extends Record<string, infer TValue>
				?
						| (TValue extends string
								? TValue
								: TValue extends () => {
											name: infer TObjectName extends string;
										}
									? TObjectName
									: never)
						| (keyof TTo & string)
				: never
	: never;

type InferRelationKindFromConfig<TConfig> = TConfig extends {
	morphName: string;
}
	? "many"
	: TConfig extends { hasMany: true }
		? TConfig extends { through: any }
			? "manyToMany"
			: "many"
		: "one";

type RelationSelectFromConfig<TConfig, TApp> =
	RelationTargetNameFromConfig<TConfig> extends infer TTarget
		? TTarget extends string
			? CollectionSelect<GetCollection<AppCollections<TApp>, TTarget>, TApp>
			: never
		: never;

type RelationSelectFromConfigWithKind<TConfig, TApp> =
	InferRelationKindFromConfig<TConfig> extends "many" | "manyToMany"
		? RelationSelectFromConfig<TConfig, TApp>[]
		: RelationSelectFromConfig<TConfig, TApp>;

type BlockNodeFromRegistry<TBlocks> = {
	id: string;
	type: Extract<keyof TBlocks, string>;
	children?: BlockNodeFromRegistry<TBlocks>[];
};

type BlockValuesFromDefinition<TBlock, TApp> = TBlock extends {
	state: { fields: infer TFields };
}
	? TFields extends Record<string, FieldDefinition<FieldDefinitionState>>
		? {
				[K in keyof TFields]: FieldSelect<TFields[K], TApp>;
			}
		: Record<string, unknown>
	: Record<string, unknown>;

type BlockValuesUnion<TBlocks, TApp> =
	TBlocks extends Record<string, any>
		? BlockValuesFromDefinition<TBlocks[keyof TBlocks], TApp>
		: Record<string, unknown>;

type BlocksDocumentBase = {
	_tree: Array<{ id: string; type: string; children?: any[] }>;
	_values: Record<string, Record<string, unknown>>;
	_data?: Record<string, Record<string, unknown>>;
};

type BlocksSelectFromRegistry<TBlocks, TApp> =
	TBlocks extends Record<string, any>
		? {
				_tree: BlockNodeFromRegistry<TBlocks>[];
				_values: Record<string, BlockValuesUnion<TBlocks, TApp>>;
				_data?: Record<string, Record<string, unknown>>;
			}
		: BlocksDocumentBase;

type BlocksSelectFromApp<TApp> = BlocksSelectFromRegistry<
	TApp extends { blocks?: infer TBlocks } ? TBlocks : undefined,
	TApp
>;

/**
 * Build CollectionSelect purely from field definitions (v2).
 *
 * Uses FieldSelect<TFieldDef, TApp> for each field:
 * - text/number/boolean/etc: TState["select"] (string, number, boolean, etc.)
 * - relation (belongsTo):    string (FK narrowed from config)
 * - relation (hasMany/m2m):  never (filtered out — no column on this table)
 * - blocks:                  BlocksSelectFromApp<TApp>
 *
 * System fields (id, createdAt, etc.) are included via AutoInsertedFields
 * merged into CollectionFieldDefinitions.
 *
 * No Drizzle $infer.select dependency.
 */
type CollectionSelectFromFieldDefinitions<TCollection, TApp> =
	CollectionFieldDefinitions<TCollection> extends infer TAllFields
		? TAllFields extends Record<string, FieldDefinition<FieldDefinitionState>>
			? Prettify<
					{
						[K in keyof TAllFields as FieldSelect<
							TAllFields[K],
							TApp
						> extends never
							? never
							: K]: TAllFields[K] extends FieldDefinition<infer TState>
							? TState extends FieldDefinitionState
								? TState["type"] extends "relation"
									? FieldSelect<TAllFields[K], TApp>
									: TState["type"] extends "blocks"
										? BlocksSelectFromApp<TApp>
										: TState["select"]
								: never
							: never;
					} & CollectionOutputExtensions<TCollection>
				>
			: CollectionSelectFromInfer<TCollection>
		: CollectionSelectFromInfer<TCollection>;

export type CollectionSelect<TCollection, TApp> =
	HasFieldDefinitions<CollectionFieldDefinitions<TCollection>> extends true
		? CollectionSelectFromFieldDefinitions<TCollection, TApp>
		: CollectionSelectFromInfer<TCollection>;

type ResolveCollectionRelationFromApp<
	TCollections extends Record<string, AnyCollectionOrBuilder>,
	TApp,
	C,
	Depth extends unknown[],
> = C extends keyof TCollections
	? RelationShape<
			CollectionSelect<GetCollection<TCollections, C>, TApp>,
			Depth extends []
				? never
				: ResolveRelationsDeepFromApp<
						CollectionRelations<GetCollection<TCollections, C>>,
						TApp,
						DecrementDepth<Depth>
					>,
			CollectionInsertFromInfer<GetCollection<TCollections, C>>,
			GetCollection<TCollections, C>,
			TApp
		>
	: RelationShape<any, never, any, unknown, unknown>;

type ResolveRelationsDeepFromApp<
	TRelations extends Record<string, RelationConfig>,
	TApp,
	Depth extends unknown[] = [1, 1, 1, 1, 1],
> = {
	[K in keyof TRelations]: TRelations[K] extends {
		type: "many" | "manyToMany";
		collection: infer C;
	}
		? ResolveCollectionRelationFromApp<AppCollections<TApp>, TApp, C, Depth>[]
		: TRelations[K] extends {
					type: "one";
					collection: infer C;
				}
			? ResolveCollectionRelationFromApp<AppCollections<TApp>, TApp, C, Depth>
			: never;
};

export type CollectionRelationsFromApp<TCollection, TApp> =
	ResolveRelationsDeepFromApp<CollectionRelationsFor<TCollection>, TApp>;

type RelationTargetCollectionFromConfig<TConfig, TApp> =
	RelationTargetNameFromConfig<TConfig> extends infer TTarget
		? TTarget extends string
			? GetCollection<AppCollections<TApp>, TTarget>
			: never
		: never;

type RelationWhereTarget<TConfig, TApp> = Where<
	RelationTargetCollectionFromConfig<TConfig, TApp>,
	TApp
>;

type RelationWhereInputFromConfig<TConfig, TApp> =
	InferRelationKindFromConfig<TConfig> extends "one"
		?
				| {
						is?: RelationWhereTarget<TConfig, TApp>;
						isNot?: RelationWhereTarget<TConfig, TApp>;
				  }
				| RelationWhereTarget<TConfig, TApp>
		:
				| {
						some?: RelationWhereTarget<TConfig, TApp>;
						none?: RelationWhereTarget<TConfig, TApp>;
						every?: RelationWhereTarget<TConfig, TApp>;
				  }
				| RelationWhereTarget<TConfig, TApp>;

type FieldWhereInputFromDefinition<TFieldDef, TApp> =
	TFieldDef extends FieldDefinition<infer TState>
		? TState extends FieldDefinitionState
			? TState["type"] extends "relation"
				?
						| RelationWhereInputFromConfig<TState["config"], TApp>
						| FieldWhere<TFieldDef, TApp>
						| FieldSelect<TFieldDef, TApp>
				: FieldSelect<TFieldDef, TApp> | FieldWhere<TFieldDef, TApp>
			: never
		: never;

type WhereFieldsFromDefinitions<
	TFieldDefs extends Record<string, FieldDefinition<FieldDefinitionState>>,
	TApp,
> = {
	[K in keyof TFieldDefs]?: FieldWhereInputFromDefinition<TFieldDefs[K], TApp>;
};

/**
 * Relation WHERE clause for filtering
 * Supports "some/none/every" for collections and "is/isNot" for single relations
 *
 * When TCollection is a collection-like type (not `unknown`), dispatches through
 * WhereFromCollection for field-definition-aware operators.
 * Falls back to WhereFromFields with plain TFields/TRelations otherwise.
 */
export type RelationFilter<
	TFields = any,
	TRelations = any,
	TCollection = unknown,
	TApp = unknown,
> = IsCollectionLike<TCollection> extends true
	?
			| Where<TCollection, TApp>
			| {
					some?: Where<TCollection, TApp>;
					none?: Where<TCollection, TApp>;
					every?: Where<TCollection, TApp>;
					is?: Where<TCollection, TApp>;
					isNot?: Where<TCollection, TApp>;
			  }
	:
			| Where<TFields, TRelations>
			| {
					some?: Where<TFields, TRelations>;
					none?: Where<TFields, TRelations>;
					every?: Where<TFields, TRelations>;
					is?: Where<TFields, TRelations>;
					isNot?: Where<TFields, TRelations>;
			  };

/**
 * Helper type for extracting relation fields for Where clause
 * Only creates relation filters when TRelations has specific keys (not index signature)
 */
type RelationWhereKeys<TFields, TRelations> =
	IsAny<TFields> extends true
		? keyof TRelations
		: Exclude<keyof TRelations, keyof TFields>;

type RelationWhereFields<TFields, TRelations> = [TRelations] extends [never]
	? {}
	: IsAny<TRelations> extends true
		? {} // When TRelations is `any`, don't create index signature
		: string extends keyof TRelations
			? {} // TRelations has index signature (e.g., Record<string, ...>), don't add relation fields
			: [TRelations] extends [Record<string, any>]
				? keyof TRelations extends never
					? {} // Empty relations object
					: {
							[K in RelationWhereKeys<TFields, TRelations>]?: RelationFilter<
								ExtractRelationSelect<RelationValue<TRelations[K]>>,
								ExtractRelationRelations<RelationValue<TRelations[K]>>,
								ExtractRelationCollection<RelationValue<TRelations[K]>>,
								ExtractRelationApp<RelationValue<TRelations[K]>>
							>;
						}
				: {};

/**
 * WHERE clause for filtering
 * Supports field conditions, logical operators, and relations
 */
type WhereFields<TFields, TRelations> = {
	[K in keyof TFields]?: K extends RelationKeys<TRelations>
		?
				| RelationFilter<
						ExtractRelationSelect<RelationValue<TRelations[K]>>,
						ExtractRelationRelations<RelationValue<TRelations[K]>>,
						ExtractRelationCollection<RelationValue<TRelations[K]>>,
						ExtractRelationApp<RelationValue<TRelations[K]>>
				  >
				| TFields[K]
				| WhereOperators<TFields[K]>
		: TFields[K] | WhereOperators<TFields[K]>;
};

type WhereFromFields<TFields = any, TRelations = any> = WhereFields<
	TFields,
	TRelations
> & {
	AND?: WhereFromFields<TFields, TRelations>[];
	OR?: WhereFromFields<TFields, TRelations>[];
	NOT?: WhereFromFields<TFields, TRelations>;
	// RAW allows custom SQL expressions
	RAW?: (table: any) => SQL;
} & RelationWhereFields<TFields, TRelations>;

type WhereFromCollection<TCollection, TApp> =
	CollectionFieldDefinitions<TCollection> extends infer TFieldDefs
		? TFieldDefs extends Record<string, FieldDefinition<FieldDefinitionState>>
			? HasFieldDefinitions<TFieldDefs> extends true
				? WhereFieldsFromDefinitions<TFieldDefs, TApp> & {
						AND?: Where<TCollection, TApp>[];
						OR?: Where<TCollection, TApp>[];
						NOT?: Where<TCollection, TApp>;
						RAW?: (table: any) => SQL;
					}
				: WhereFromFields<
						CollectionSelectFromInfer<TCollection>,
						CollectionRelationsFromApp<TCollection, TApp>
					>
			: WhereFromFields<
					CollectionSelectFromInfer<TCollection>,
					CollectionRelationsFromApp<TCollection, TApp>
				>
		: WhereFromFields<
				CollectionSelectFromInfer<TCollection>,
				CollectionRelationsFromApp<TCollection, TApp>
			>;

export type Where<
	TFieldsOrCollection = any,
	TRelationsOrApp = any,
> = IsCollectionLike<TFieldsOrCollection> extends true
	? WhereFromCollection<TFieldsOrCollection, TRelationsOrApp>
	: WhereFromFields<TFieldsOrCollection, TRelationsOrApp>;

/**
 * Columns selection for partial field selection
 *
 * Two modes:
 * 1. Inclusion mode: { field1: true, field2: true } - only include specified fields
 * 2. Omission mode: { field1: false, field2: false } - include all fields EXCEPT specified ones
 *
 * Notes:
 * - If any field is set to true, only fields with true are included (inclusion mode)
 * - If all fields are false, all fields except false ones are included (omission mode)
 * - To select all fields, simply omit the columns option entirely
 * - The 'id' field is always included regardless of selection
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

type RelationSelect<T> = ExtractRelationSelect<RelationValue<T>>;

type RelationRelations<T> = ExtractRelationRelations<RelationValue<T>>;

type RelationCollection<T> = ExtractRelationCollection<RelationValue<T>>;

type RelationApp<T> = ExtractRelationApp<RelationValue<T>>;

/**
 * WITH clause for including relations
 * Supports nested relations and sub-queries
 *
 * Each relation key can be:
 * - `true` to include all fields
 * - An object with typed `columns`, `where`, `orderBy`, and nested `with`
 *
 * The inner `where`, `columns`, and `orderBy` are typed against the target
 * relation's collection type when available (via __collection on RelationShape),
 * so field-definition-aware operators flow through.
 * Falls back to plain select types otherwise.
 *
 * @template TRelations - The resolved relations map (contains RelationShape entries)
 */
export type With<TRelations = any> = {
	[K in keyof TRelations]?: boolean | WithRelationOptions<TRelations[K]>;
};

/**
 * Options for a single relation inside a `with` clause.
 * Uses the __collection from RelationShape to dispatch through
 * the collection-aware Where/Columns path when available.
 */
type WithRelationOptions<TRelation> =
	IsCollectionLike<RelationCollection<TRelation>> extends true
		? {
				columns?: Columns<RelationSelect<TRelation>>;
				where?: Where<RelationCollection<TRelation>, RelationApp<TRelation>>;
				orderBy?: OrderBy<RelationSelect<TRelation>>;
				limit?: number;
				offset?: number;
				with?: With<RelationRelations<TRelation>>;
				_aggregate?: RelationAggregation<RelationSelect<TRelation>>;
				_count?: boolean;
			}
		: {
				columns?: Columns<RelationSelect<TRelation>>;
				where?: Where<RelationSelect<TRelation>, RelationRelations<TRelation>>;
				orderBy?: OrderBy<RelationSelect<TRelation>>;
				limit?: number;
				offset?: number;
				with?: With<RelationRelations<TRelation>>;
				_aggregate?: RelationAggregation<RelationSelect<TRelation>>;
				_count?: boolean;
			};

/**
 * Options for findMany query (Drizzle RQB v2-like)
 */
export interface FindManyOptionsBase<TFields = any, TRelations = any> {
	where?: Where<TFields, TRelations>;
	columns?: Columns<TFields>;
	with?: With<TRelations>;
	orderBy?: OrderBy<TFields>;
	limit?: number;
	offset?: number;
	extras?: Extras;
	/**
	 * Override locale for this request.
	 */
	locale?: string;
	/**
	 * Disable fallback to default locale when translation is missing.
	 */
	localeFallback?: boolean;
	/**
	 * Include soft-deleted records (only applies when softDelete is enabled)
	 */
	includeDeleted?: boolean;
}

export type FindManyOptions<
	TFields = any,
	TRelations = any,
> = FindManyOptionsBase<TFields, TRelations>;

export type FindOptions<TCollection, TApp> = Omit<
	FindManyOptionsBase<
		CollectionSelect<TCollection, TApp>,
		CollectionRelationsFromApp<TCollection, TApp>
	>,
	"where"
> & {
	where?: Where<TCollection, TApp>;
};

/**
 * Options for findOne query (Drizzle RQB v2-like)
 * Same as FindManyOptions but without limit/offset (always limit 1)
 */
export interface FindOneOptionsBase<TFields = any, TRelations = any> {
	where?: Where<TFields, TRelations>;
	columns?: Columns<TFields>;
	with?: With<TRelations>;
	orderBy?: OrderBy<TFields>;
	extras?: Extras;
	/**
	 * Override locale for this request.
	 */
	locale?: string;
	/**
	 * Disable fallback to default locale when translation is missing.
	 */
	localeFallback?: boolean;
	/**
	 * Include soft-deleted records (only applies when softDelete is enabled)
	 */
	includeDeleted?: boolean;
}

export type FindOneOptions<TCollection, TApp> = Omit<
	FindOneOptionsBase<
		CollectionSelect<TCollection, TApp>,
		CollectionRelationsFromApp<TCollection, TApp>
	>,
	"where"
> & {
	where?: Where<TCollection, TApp>;
};

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

type RelationKeys<TRelations> = [TRelations] extends [never]
	? never
	: [TRelations] extends [Record<string, any>]
		? keyof TRelations & string
		: never;

/**
 * Helper type for extracting relation mutation fields
 * Only creates relation mutations when TRelations has specific keys (not index signature)
 * Uses the same pattern as RelationWhereFields for consistency
 */
type RelationMutations<TRelations> = [TRelations] extends [never]
	? {}
	: IsAny<TRelations> extends true
		? {} // When TRelations is `any`, don't create index signature
		: string extends keyof TRelations
			? {} // TRelations has index signature (e.g., Record<string, ...>), don't add relation fields
			: [TRelations] extends [Record<string, any>]
				? keyof TRelations extends never
					? {} // No relations, return empty object
					: {
							[K in keyof TRelations]?: NestedRelationMutation<
								ExtractRelationInsert<RelationValue<TRelations[K]>>
							>;
						}
				: {}; // Not a record type or unknown, return empty object instead of permissive Record

// With unified field API, FK column key is the same as the relation field name
type RelationIdKey<TInsert, K extends string> = Extract<
	Extract<keyof TInsert, string>,
	K
>;

type RelationForeignKeys<TInsert, TRelations> =
	RelationKeys<TRelations> extends infer K
		? K extends string
			? RelationIdKey<TInsert, K>
			: never
		: never;

type OptionalKeys<T> = {
	[K in keyof T]-?: {} extends Pick<T, K> ? K : never;
}[keyof T];

type RequiredKeys<T> = Exclude<keyof T, OptionalKeys<T>>;

type IsRequiredKey<T, K extends keyof T> = K extends RequiredKeys<T>
	? true
	: false;

type OptionalizeKeys<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

type OptionalizeRelationForeignKeys<TInsert, TRelations> =
	RelationForeignKeys<TInsert, TRelations> extends keyof TInsert
		? OptionalizeKeys<TInsert, RelationForeignKeys<TInsert, TRelations>>
		: TInsert;

type UnionToIntersection<U> = (
	U extends any
		? (value: U) => void
		: never
) extends (value: infer I) => void
	? I
	: never;

type RequireRelationForMissingFk<TInsert, TRelations, TInput> = [
	TRelations,
] extends [never]
	? {} // Never type, nothing to require
	: IsAny<TRelations> extends true
		? {} // Any type, don't enforce anything
		: string extends keyof TRelations
			? {} // TRelations has index signature, don't enforce anything
			: [TRelations] extends [Record<string, any>]
				? keyof TRelations extends never
					? {} // No relations, nothing to require
					: RelationKeys<TRelations> extends infer K
						? K extends string
							? RelationIdKey<TInsert, K> extends never
								? {}
								: RelationIdKey<TInsert, K> extends keyof TInsert
									? IsRequiredKey<
											TInsert,
											RelationIdKey<TInsert, K>
										> extends true
										? RelationIdKey<TInsert, K> extends keyof TInput
											? {}
											: K extends keyof TRelations
												? K extends keyof RelationMutations<TRelations>
													? Required<Pick<RelationMutations<TRelations>, K>>
													: {}
												: {}
										: {}
									: {}
							: {}
						: {}
				: {};

type EnforceRelationForMissingFk<TInsert, TRelations, TInput> = [
	TRelations,
] extends [never]
	? {}
	: IsAny<TRelations> extends true
		? {} // Any type, don't enforce anything
		: string extends keyof TRelations
			? {} // TRelations has index signature, don't enforce anything
			: [TRelations] extends [Record<string, any>]
				? keyof TRelations extends never
					? {}
					: UnionToIntersection<
							RequireRelationForMissingFk<TInsert, TRelations, TInput>
						>
				: {};

/**
 * Create input with optional nested relations
 */
export type CreateInputBase<
	TInsert = any,
	TRelations = any,
> = OptionalizeRelationForeignKeys<TInsert, TRelations> &
	Omit<RelationMutations<TRelations>, keyof TInsert>;

export type CreateInputWithRelations<
	TInsert = any,
	TRelations = any,
	TInput extends CreateInputBase<TInsert, TRelations> = CreateInputBase<
		TInsert,
		TRelations
	>,
> = TInput & EnforceRelationForMissingFk<TInsert, TRelations, TInput>;

export type CreateInput<TInsert = any, TRelations = any> = CreateInputBase<
	TInsert,
	TRelations
>;

/**
 * Update input with optional nested relation mutations
 */
export type UpdateInput<TUpdate = any, TRelations = any> = Prettify<
	Partial<TUpdate> & RelationMutations<TRelations>
>;

/**
 * Extract ID type from select type (defaults to string for UUID)
 */
export type ExtractIdType<T> = T extends { id: infer I } ? I : string;

/**
 * Update single record params
 */
export interface UpdateParams<TUpdate = any, TRelations = any, TId = string> {
	id: TId;
	data: UpdateInput<TUpdate, TRelations>;
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
	data: UpdateInput<TUpdate, TRelations>;
}

/**
 * Delete single record params
 */
export interface DeleteParams<TId = string> {
	id: TId;
}

/**
 * Restore soft-deleted record params
 */
export interface RestoreParams<TId = string> {
	id: TId;
}

/**
 * Delete many records params
 */
export interface DeleteManyParams<TFields = any, TRelations = any> {
	where: Where<TFields, TRelations>;
}

export interface FindVersionsOptions<TId = string> {
	id: TId;
	limit?: number;
	offset?: number;
}

export interface RevertVersionOptions<TId = string> {
	id: TId;
	version?: number;
	versionId?: string;
}

export interface VersionRecord<TId = string> {
	id: TId;
	versionId: string;
	versionNumber: number;
	versionOperation: string;
	versionUserId: string | null;
	versionCreatedAt: Date;
	[key: string]: any;
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
export type SelectResult<TSelect, TQuery> = [TQuery] extends [never]
	? TSelect
	: TQuery extends { columns: Record<string, boolean> }
		? Pick<
				TSelect,
				| Extract<keyof TQuery["columns"], keyof TSelect>
				| ("id" extends keyof TSelect ? "id" : never)
			>
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
export type RelationResult<TRelations, TQuery> = [TQuery] extends [never]
	? {}
	: TQuery extends { with?: any }
		? TQuery["with"] extends Record<string, any>
			? {
					[K in keyof TQuery["with"]]: K extends keyof TRelations
						? TRelations[K] extends (infer S)[]
							? TQuery["with"][K] extends
									| { _count: true }
									| {
											_aggregate: any;
									  }
								? (TQuery["with"][K] extends { _count: true }
										? { _count: number }
										: Record<never, never>) &
										(TQuery["with"][K] extends { _aggregate: infer Agg }
											? Agg extends RelationAggregation
												? AggregationResult<Agg>
												: Record<never, never>
											: Record<never, never>)
								: ApplyQuery<
										RelationSelect<S>,
										RelationRelations<S>,
										TQuery["with"][K]
									>[]
							: ApplyQuery<
									RelationSelect<TRelations[K]>,
									RelationRelations<TRelations[K]>,
									TQuery["with"][K]
								>
						: never;
				}
			: Record<never, never>
		: Record<never, never>;

/**
 * Combined Result Type
 * Merges partial selection and included relations.
 *
 * Accepts any query-like object with optional `columns` and `with` fields.
 * The `where` field is not used for result type inference.
 */
export type ApplyQuery<
	TSelect,
	TRelations,
	TQuery extends Record<string, any> | undefined | boolean = undefined,
> = Prettify<
	TQuery extends undefined | true
		? TSelect
		: TQuery extends false
			? never
			: SelectResult<TSelect, TQuery> & RelationResult<TRelations, TQuery>
>;

/**
 * CRUD operations interface
 * Clear naming: find/findOne for reads, updateById/update for updates, deleteById/delete for deletes
 */
export interface CRUD<
	TSelect = any,
	TInsert = any,
	TUpdate = any,
	TRelations = any,
	TId = ExtractIdType<TSelect>,
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
	findOne<TQuery extends FindOneOptionsBase<TSelect, TRelations>>(
		options?: TQuery,
		context?: CRUDContext,
	): Promise<ApplyQuery<TSelect, TRelations, TQuery> | null>;

	/**
	 * Count records matching query
	 */
	count(
		options?: Pick<
			FindManyOptions<TSelect, TRelations>,
			"where" | "includeDeleted"
		>,
		context?: CRUDContext,
	): Promise<number>;

	/**
	 * Create a new record
	 */
	create<TInput extends CreateInputBase<TInsert, TRelations>>(
		input: CreateInputWithRelations<TInsert, TRelations, TInput>,
		context?: CRUDContext,
	): Promise<TSelect>;

	/**
	 * Update a single record by ID
	 */
	updateById(
		params: UpdateParams<TUpdate, TRelations, TId>,
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
		params: DeleteParams<TId>,
		context?: CRUDContext,
	): Promise<{ success: boolean }>;

	/**
	 * Restore a single soft-deleted record by ID
	 */
	restoreById(
		params: RestoreParams<TId>,
		context?: CRUDContext,
	): Promise<TSelect>;

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
		options: FindVersionsOptions<TId>,
		context?: CRUDContext,
	): Promise<VersionRecord<TId>[]>;

	/**
	 * Revert to a specific version
	 */
	revertToVersion(
		options: RevertVersionOptions<TId>,
		context?: CRUDContext,
	): Promise<TSelect>;

	/**
	 * Upload a single file
	 * Only available on collections configured with .upload()
	 *
	 * @example
	 * ```ts
	 * const asset = await cms.api.collections.media.upload(file, context);
	 * console.log(asset.url); // Typed URL
	 * ```
	 */
	upload?(
		file: UploadFile,
		context?: CRUDContext,
		/** Additional fields to set on the created record */
		additionalData?: Partial<TInsert>,
	): Promise<TSelect>;

	/**
	 * Upload multiple files
	 * Only available on collections configured with .upload()
	 *
	 * @example
	 * ```ts
	 * const assets = await cms.api.collections.media.uploadMany(files, context);
	 * ```
	 */
	uploadMany?(
		files: UploadFile[],
		context?: CRUDContext,
		/** Additional fields to set on each created record */
		additionalData?: Partial<TInsert>,
	): Promise<TSelect[]>;

	// Internal properties (not part of public API)
	"~internalState"?: any;
	"~internalRelatedTable"?: any;
	"~internalI18nTable"?: any;
}
