// crud/types.ts - Type definitions for CRUD operations (Drizzle RQB v2-like)

import type { SQL } from "drizzle-orm";

import type {
	CollectionOptions,
	InferRelationConfigsFromFields,
	RelationConfig,
	UploadOptions,
} from "#questpie/server/collection/builder/types.js";
import type {
	BaseRequestContext,
	RequestContext,
} from "#questpie/server/config/context.js";
import type { FieldState } from "#questpie/server/fields/field-class-types.js";
import type {
	FieldDefinitionsWithSystem,
	FieldSelect,
	FieldWhere,
} from "#questpie/server/fields/field-types.js";
import type { CollectionWherePlaceholder } from "#questpie/server/fields/types.js";
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
	RelationDepth,
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
	arrayBuffer?: () => Promise<ArrayBuffer>;
	/**
	 * Get file contents as a ReadableStream (preferred for large files)
	 * When available, this is used instead of arrayBuffer for efficient streaming
	 */
	stream?: () => ReadableStream<Uint8Array>;
}

/**
 * Context passed to CRUD operations.
 *
 * Caller-facing alias targeting the strict, index-signature-FREE
 * {@link BaseRequestContext} (NOT the loose ALS/wire {@link RequestContext}),
 * so excess-property checking is back on at every CRUD call site: a typo'd
 * `accessMode`/`stage`/`locale` is a compile error instead of silently
 * no-op'ing (which falls back to `accessMode: 'system'` — fail-open).
 *
 * @default accessMode: 'system' - API is backend-only by default
 */
export type CRUDContext = BaseRequestContext;

/**
 * WHERE clause operators for type-safe filtering
 * These match Drizzle's RQB v2 operators
 */
export interface WhereOperatorsLegacy<T> {
	eq?: T;
	ne?: T;
	/** Alias for `ne`; `not: null` maps to SQL `IS NOT NULL`. */
	not?: T | null;
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

type AnyFieldDefinition =
	| { readonly _: FieldState }
	| { $types: any; toColumn: any };

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
	: TApp extends { config: { collections: infer TCollections } }
		? TCollections extends Record<string, AnyCollectionOrBuilder>
			? TCollections
			: Record<string, AnyCollectionOrBuilder>
		: Record<string, AnyCollectionOrBuilder>;

type CollectionStateFor<TCollection> = CollectionState<TCollection>;

/** Cached: extract raw field definitions from collection state. */
type RawFieldDefs<TCollection> =
	CollectionStateFor<TCollection> extends { fieldDefinitions: infer D }
		? D
		: Record<string, never>;

/** Cached: extract options from collection state. */
type RawOptions<TCollection> =
	CollectionStateFor<TCollection> extends {
		options: infer O extends CollectionOptions;
	}
		? O
		: {};

/** Cached: extract upload config from collection state. */
type RawUpload<TCollection> =
	CollectionStateFor<TCollection> extends {
		upload: infer U extends UploadOptions;
	}
		? U
		: undefined;

/**
 * Extract field definitions from a collection, with system fields auto-inserted.
 * Composes cached RawFieldDefs/RawOptions/RawUpload — 1 conditional instead of 6.
 */
type CollectionFieldDefinitions<TCollection> =
	RawFieldDefs<TCollection> extends infer TDefs extends Record<
		string,
		AnyFieldDefinition
	>
		? FieldDefinitionsWithSystem<
				TDefs,
				RawOptions<TCollection>,
				RawUpload<TCollection>
			>
		: RawFieldDefs<TCollection>;

type CollectionOutputExtensions<TCollection> =
	CollectionStateFor<TCollection> extends { output: infer TOutput }
		? TOutput extends Record<string, any>
			? TOutput
			: Record<never, never>
		: Record<never, never>;

/**
 * Try to infer RelationConfig map from field definitions.
 * Returns the inferred map when field definitions are introspectable —
 * including the EMPTY map for collections with no relation fields, so
 * relation machinery stays inert (`create({})` keeps required-field checks
 * instead of optionalizing every key through a broad Record fallback).
 * Falls back to the permissive Record only when defs can't be introspected.
 */
type InferRelationsFromFieldDefs<TFieldDefs> =
	TFieldDefs extends Record<string, AnyFieldDefinition>
		? InferRelationConfigsFromFields<TFieldDefs> extends infer TInferred
			? TInferred extends Record<string, RelationConfig>
				? TInferred
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
	// Guard: reject Record<string, never> — `never` extends anything,
	// so a generic fallback type would incorrectly pass the constraint.
	[TDefs] extends [Record<string, never>]
		? false
		: TDefs extends Record<string, AnyFieldDefinition>
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

type DefaultWhereDepth = [1, 1, 1, 1];

type OperatorValue<TFn> = TFn extends (...args: any[]) => any
	? Parameters<TFn>[1]
	: never;

type OperatorKeysFromFieldDef<TFieldDef> = TFieldDef extends {
	getOperators: () => any;
}
	?
			| keyof ReturnType<TFieldDef["getOperators"]>["column"]
			| keyof ReturnType<TFieldDef["getOperators"]>["jsonb"]
	: never;

type OperatorValueFromFieldDef<TFieldDef, TOpKey> = TFieldDef extends {
	getOperators: () => any;
}
	?
			| (TOpKey extends keyof ReturnType<TFieldDef["getOperators"]>["column"]
					? OperatorValue<
							ReturnType<TFieldDef["getOperators"]>["column"][TOpKey]
						>
					: never)
			| (TOpKey extends keyof ReturnType<TFieldDef["getOperators"]>["jsonb"]
					? OperatorValue<
							ReturnType<TFieldDef["getOperators"]>["jsonb"][TOpKey]
						>
					: never)
	: never;

type FieldOperatorsFromFieldDef<TFieldDef> = TFieldDef extends {
	getOperators: () => any;
}
	? {
			[K in OperatorKeysFromFieldDef<TFieldDef>]?: OperatorValueFromFieldDef<
				TFieldDef,
				K
			>;
		}
	: Record<never, never>;

export type WhereOperators<T> = T extends { getOperators: () => any }
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
	? TFields extends Record<string, AnyFieldDefinition>
		? {
				[K in keyof TFields]: FieldSelect<TFields[K], TApp>;
			}
		: Record<string, {}>
	: Record<string, {}>;

type BlockValuesUnion<TBlocks, TApp> =
	TBlocks extends Record<string, any>
		? BlockValuesFromDefinition<TBlocks[keyof TBlocks], TApp>
		: Record<string, {}>;

type BlocksDocumentBase = {
	_tree: Array<{ id: string; type: string; children?: any[] }>;
	_values: Record<string, Record<string, {}>>;
	_data?: Record<string, Record<string, {}>>;
};

type BlocksSelectFromRegistry<TBlocks, TApp> =
	TBlocks extends Record<string, any>
		? {
				_tree: BlockNodeFromRegistry<TBlocks>[];
				_values: Record<string, BlockValuesUnion<TBlocks, TApp>>;
				_data?: Record<string, Record<string, {}>>;
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
		? TAllFields extends Record<string, AnyFieldDefinition>
			? Prettify<
					{
						[K in keyof TAllFields as FieldSelect<
							TAllFields[K],
							TApp
						> extends never
							? never
							: K]: FieldSelect<TAllFields[K], TApp>;
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
	: // Not-found arm is LOUD `never` (CL-04): this is the resolver the live CRUD
		// `with` uses, so an omitted target (e.g. a module collection missing from a
		// job/workflow ctx map) makes the populated relation `never` and surfaces,
		// rather than degrading to a silent `any`.
		RelationShape<never, never, never, unknown, unknown>;

type ResolveRelationsDeepFromApp<
	TRelations extends Record<string, RelationConfig>,
	TApp,
	// Shared relation-recursion cap (CL-14, STEP B) — same constant the legacy
	// `ResolveRelationsDeep` uses, so the two cycle-breakers can't drift again.
	Depth extends unknown[] = RelationDepth,
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

/**
 * Resolve CollectionWherePlaceholder brands in a where operator map.
 *
 * FieldWhere produces `{ some?: CollectionWherePlaceholder; eq?: string; ... }`.
 * This type walks each property: if the value extends CollectionWherePlaceholder,
 * replace it with `Where<TargetCollection, TApp>`. Otherwise pass through.
 *
 * The field's operators are the source of truth for WHAT operators exist.
 * This type resolves the cross-collection types they couldn't express.
 */
type ResolveWherePlaceholders<
	TWhereShape,
	TConfig,
	TApp,
	Depth extends unknown[] = DefaultWhereDepth,
> = {
	[K in keyof TWhereShape]?: NonNullable<
		TWhereShape[K]
	> extends CollectionWherePlaceholder
		? Depth extends []
			? never
			: WhereFromCollection<
					RelationTargetCollectionFromConfig<TConfig, TApp>,
					TApp,
					DecrementDepth<Depth>
				>
		: TWhereShape[K];
};

type RelationWhereFromTarget<
	TTo extends string,
	TApp,
	Depth extends unknown[],
> = Depth extends []
	? never
	: WhereFromCollection<
			GetCollection<AppCollections<TApp>, TTo>,
			TApp,
			DecrementDepth<Depth>
		>;

/**
 * To-many quantifiers (some/none/every) for relation fields.
 *
 * Added ONLY for to-many relations (relationKind:"many"), gated in
 * V2RelationWhereResolved. Values are fully typed against the target
 * collection's where. `count` is intentionally absent — no `COUNT(*)` clause
 * exists yet, so it was a runtime no-op (removed from toManyOps too).
 */
type RelationQuantifierWhere<
	TTo extends string,
	TApp,
	Depth extends unknown[],
> = {
	some?: RelationWhereFromTarget<TTo, TApp, Depth>;
	none?: RelationWhereFromTarget<TTo, TApp, Depth>;
	every?: RelationWhereFromTarget<TTo, TApp, Depth>;
};

/**
 * Build the complete where input type for a single field definition.
 *
 * For ALL fields: union of FieldWhere (operators) and FieldSelect (direct value).
 * For relation fields: CollectionWherePlaceholder in FieldWhere is resolved to
 * Where<TargetCollection, TApp>. Also includes a shorthand form where the user
 * can pass the target's Where directly (without a quantifier key), plus
 * to-many quantifiers (see RelationQuantifierWhere).
 *
 * No field types are special-cased — the field's operators drive everything.
 */
type V2RelationWhereResolved<
	TFieldDef,
	TState,
	TApp,
	Depth extends unknown[],
> = TState extends {
	relationTo: infer TTo extends string;
}
	? TState extends { relationKind: "many" }
		?
				// to-many: ONLY quantifiers (some/none/every). No bare FK value and no
				// bare target-where shorthand — those are single-row concepts. Both
				// the resolved FieldWhere (toManyOps) and the typed quantifier arm
				// expose the same quantifier keys, so the where is cardinality-uniform.
				| ResolveWherePlaceholdersV2<
						FieldWhere<TFieldDef, TApp>,
						TTo,
						TApp,
						Depth
				  >
				| RelationQuantifierWhere<TTo, TApp, Depth>
		: // to-one: `is`/`isNot` (belongsToOps) + FK value + target-where shorthand.
				| FieldSelect<TFieldDef, TApp>
				| ResolveWherePlaceholdersV2<
						FieldWhere<TFieldDef, TApp>,
						TTo,
						TApp,
						Depth
				  >
				| RelationWhereFromTarget<TTo, TApp, Depth>
	: FieldSelect<TFieldDef, TApp> | FieldWhere<TFieldDef, TApp>;

type ResolveWherePlaceholdersV2<
	TWhereShape,
	TTo extends string,
	TApp,
	Depth extends unknown[],
> = {
	[K in keyof TWhereShape]?: NonNullable<
		TWhereShape[K]
	> extends CollectionWherePlaceholder
		? RelationWhereFromTarget<TTo, TApp, Depth>
		: TWhereShape[K];
};

type FieldWhereInputFromDefinition<
	TFieldDef,
	TApp,
	Depth extends unknown[],
> = TFieldDef extends { readonly _: infer TState extends { type: string } } // V2: Field<TState> dispatch via phantom _
	? TState extends { type: "relation" | "upload" }
		? V2RelationWhereResolved<TFieldDef, TState, TApp, Depth>
		:
				// The bare-value shorthand (`{ status: "x" }`) keeps only the NON-object
				// members of the select type, so the operator object (FieldWhere) is the
				// SOLE `object` member of this union. An object-typed direct value
				// (`number[]`/`Date`/typed-json) would otherwise be indistinguishable from
				// the operator object under `Extract<…, object>`, polluting operator key
				// probes (WO-3). The operator object always carries `eq`, so dropping the
				// object shorthand loses no real filtering capability.
				| Exclude<FieldSelect<TFieldDef, TApp>, object>
				| FieldWhere<TFieldDef, TApp>
	: never;

type WhereFieldsFromDefinitions<
	TFieldDefs extends Record<string, AnyFieldDefinition>,
	TApp,
	Depth extends unknown[],
> = {
	// `-readonly`: field defs are frozen (readonly keys); a homomorphic map would
	// propagate that, making the WHERE *input* readonly and breaking the
	// `const where = {…}; where.field = …` dynamic-build pattern. Strip it.
	-readonly [K in keyof TFieldDefs]?: FieldWhereInputFromDefinition<
		TFieldDefs[K],
		TApp,
		Depth
	>;
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
	Depth extends unknown[] = DefaultWhereDepth,
> = Depth extends []
	? {} // depth exhausted — stop recursion
	: IsCollectionLike<TCollection> extends true
		?
				| WhereFromCollection<TCollection, TApp, DecrementDepth<Depth>>
				| {
						some?: WhereFromCollection<
							TCollection,
							TApp,
							DecrementDepth<Depth>
						>;
						none?: WhereFromCollection<
							TCollection,
							TApp,
							DecrementDepth<Depth>
						>;
						every?: WhereFromCollection<
							TCollection,
							TApp,
							DecrementDepth<Depth>
						>;
						is?: WhereFromCollection<TCollection, TApp, DecrementDepth<Depth>>;
						isNot?: WhereFromCollection<
							TCollection,
							TApp,
							DecrementDepth<Depth>
						>;
				  }
		:
				| WhereFromFields<TFields, TRelations>
				| {
						some?: WhereFromFields<TFields, TRelations>;
						none?: WhereFromFields<TFields, TRelations>;
						every?: WhereFromFields<TFields, TRelations>;
						is?: WhereFromFields<TFields, TRelations>;
						isNot?: WhereFromFields<TFields, TRelations>;
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
		? {}
		: string extends keyof TRelations
			? {}
			: [TRelations] extends [Record<string, any>]
				? keyof TRelations extends never
					? {}
					: {
							[K in RelationWhereKeys<TFields, TRelations>]?: RelationFilter<
								ExtractRelationSelect<RelationValue<TRelations[K]>>,
								ExtractRelationRelations<RelationValue<TRelations[K]>>,
								ExtractRelationCollection<RelationValue<TRelations[K]>>,
								ExtractRelationApp<RelationValue<TRelations[K]>>
							>;
						}
				: {};

export type RawWhereContext = {
	/** Aliased i18n table for the active locale (when localization is enabled) */
	i18nCurrentTable?: any;
	/** Aliased i18n fallback table (when locale fallback is enabled) */
	i18nFallbackTable?: any;
};

export type RawWhereArgs = RawWhereContext & {
	/** Active base table for the current query */
	table: any;
};

export type RawWhereOperator = (args: RawWhereArgs) => SQL;

/**
 * WHERE clause for filtering
 * Supports field conditions, logical operators, and relations
 */
type WhereFields<in out TFields, in out TRelations> = {
	// `-readonly`: see WhereFieldsFromDefinitions — keep the WHERE input mutable.
	-readonly [K in keyof TFields]?: K extends RelationKeys<TRelations>
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
	RAW?: RawWhereOperator;
} & RelationWhereFields<TFields, TRelations>;

type ResolvedFieldDefs<TCollection> = CollectionFieldDefinitions<TCollection>;

type WhereFromCollectionFallback<TCollection, TApp> = WhereFromFields<
	CollectionSelectFromInfer<TCollection>,
	CollectionRelationsFromApp<TCollection, TApp>
>;

type WhereFromCollection<
	TCollection,
	TApp,
	Depth extends unknown[] = DefaultWhereDepth,
> =
	HasFieldDefinitions<ResolvedFieldDefs<TCollection>> extends true
		? WhereFieldsFromDefinitions<
				Extract<
					ResolvedFieldDefs<TCollection>,
					Record<string, AnyFieldDefinition>
				>,
				TApp,
				Depth
			> & {
				AND?: WhereFromCollection<TCollection, TApp, Depth>[];
				OR?: WhereFromCollection<TCollection, TApp, Depth>[];
				NOT?: WhereFromCollection<TCollection, TApp, Depth>;
				RAW?: RawWhereOperator;
			}
		: WhereFromCollectionFallback<TCollection, TApp>;

export type Where<TFieldsOrCollection = any, TRelationsOrApp = any> =
	IsCollectionLike<TFieldsOrCollection> extends true
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
 * - Array syntax: [{ field1: 'desc' }, { field2: 'asc' }]
 * - Function syntax: (table, { asc, desc }) => [asc(table.id), desc(table.name)]
 *
 * Array syntax and object syntax both support multi-field sorting.
 * The order of fields in the object/array determines sort priority.
 * First field = primary sort, second field = secondary sort, etc.
 */
export type OrderBy<TFields = any> =
	| {
			[K in keyof TFields]?: OrderByDirection;
	  }
	| Array<{
			[K in keyof TFields]?: OrderByDirection;
	  }>
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
export type With<in out TRelations = any> = {
	[K in keyof TRelations]?: boolean | WithRelationOptions<TRelations[K]>;
};

/**
 * Options for a single relation inside a `with` clause.
 * Uses the __collection from RelationShape to dispatch through
 * the collection-aware Where/Columns path when available.
 */
// `where` value: collection-aware when the relation carries a __collection,
// else field-based. Shared by both cardinalities.
type RelationWithWhere<TRelation> =
	IsCollectionLike<RelationCollection<TRelation>> extends true
		? WhereFromCollection<
				RelationCollection<TRelation>,
				RelationApp<TRelation>,
				[1]
			>
		: WhereFromFields<RelationSelect<TRelation>, RelationRelations<TRelation>>;

type WithRelationOptionsToMany<TRelation> = {
	columns?: Columns<RelationSelect<TRelation>>;
	where?: RelationWithWhere<TRelation>;
	orderBy?: OrderBy<RelationSelect<TRelation>>;
	limit?: number;
	offset?: number;
	with?: With<RelationRelations<TRelation>>;
	_aggregate?: RelationAggregation<RelationSelect<TRelation>>;
	_count?: boolean;
};

type WithRelationOptions<TRelation> =
	// `any` (the generic `With` default used by runtime generators) must NOT
	// distribute to the restricted to-one shape — it would drop `_count`/
	// `_aggregate` from every relation. Keep the full option set for `any`.
	IsAny<TRelation> extends true
		? WithRelationOptionsToMany<TRelation>
		: TRelation extends readonly any[]
			? // to-many: list options (limit/offset/orderBy/aggregate/count) are valid.
				WithRelationOptionsToMany<TRelation>
			: // to-one: a single row — list/aggregate options are meaningless (WR-3).
				{
					columns?: Columns<RelationSelect<TRelation>>;
					where?: RelationWithWhere<TRelation>;
					with?: With<RelationRelations<TRelation>>;
				};

/**
 * Options for findMany query (Drizzle RQB v2-like)
 */
export interface FindManyOptionsBase<
	in out TFields = any,
	in out TRelations = any,
> {
	where?: Where<TFields, TRelations>;
	columns?: Columns<TFields>;
	with?: With<TRelations>;
	orderBy?: OrderBy<TFields>;
	limit?: number;
	offset?: number;
	extras?: Extras;
	/**
	 * Full-text search against the _title expression.
	 * Performs case-insensitive ILIKE matching.
	 */
	search?: string;
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
	/**
	 * Workflow stage to read from.
	 */
	stage?: string;
	/**
	 * Group results by a top-level field. When enabled, limit/offset paginate
	 * groups, and the returned result includes group metadata with whole-result
	 * counts for each group on the current page.
	 */
	groupBy?: (keyof TFields & string) | GroupByOptions<keyof TFields & string>;
}

export interface GroupByOptions<TField extends string = string> {
	field: TField;
	order?: "asc" | "desc";
}

export type FindManyOptions<
	TFields = any,
	TRelations = any,
> = FindManyOptionsBase<TFields, TRelations>;

/** Shared base props for collection-aware find — avoids Omit on FindManyOptionsBase which would eagerly instantiate Where<TFields,TRelations> */
type FindOptionsShared<TSelect, TRelations> = {
	columns?: Columns<TSelect>;
	with?: With<TRelations>;
	orderBy?: OrderBy<TSelect>;
	limit?: number;
	offset?: number;
	extras?: Extras;
	search?: string;
	locale?: string;
	localeFallback?: boolean;
	includeDeleted?: boolean;
	stage?: string;
	groupBy?: (keyof TSelect & string) | GroupByOptions<keyof TSelect & string>;
};

export type FindOptions<TCollection, TApp> = FindOptionsShared<
	CollectionSelect<TCollection, TApp>,
	CollectionRelationsFromApp<TCollection, TApp>
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
	 * Full-text search against the _title expression.
	 * Performs case-insensitive ILIKE matching.
	 */
	search?: string;
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
	/**
	 * Workflow stage to read from.
	 */
	stage?: string;
}

export type FindOneOptions<TCollection, TApp> = Omit<
	FindOptionsShared<
		CollectionSelect<TCollection, TApp>,
		CollectionRelationsFromApp<TCollection, TApp>
	>,
	"limit" | "offset"
> & {
	where?: Where<TCollection, TApp>;
};

/**
 * Nested relation operations for create/update
 */
export interface NestedRelationConnect<TId = string> {
	id: TId; // Connect to existing record by ID
}

export interface NestedRelationCreate<TInsert = any> {
	data: TInsert; // Create new record
}

export interface NestedRelationConnectOrCreate<TInsert = any, TId = string> {
	where: { id: TId } | Partial<TInsert>; // Check if exists by ID or any unique field(s)
	create: TInsert; // Create if doesn't exist
}

/**
 * Nested relation mutation options
 *
 * `TId` threads the TARGET collection's real primary-key type (via
 * `ExtractIdType<ExtractRelationSelect<…>>`) so a numeric-PK target's nested
 * `connect.id` / `connectOrCreate.where.id` / `set` element is `number`, not a
 * hardcoded `string` (CL-11 sub-fix crudin-3).
 */
export type NestedRelationMutation<TInsert = any, TId = string> = {
	connect?: NestedRelationConnect<TId> | NestedRelationConnect<TId>[]; // Link existing record(s)
	create?: TInsert | TInsert[]; // Create new record(s)
	connectOrCreate?:
		| NestedRelationConnectOrCreate<TInsert, TId>
		| NestedRelationConnectOrCreate<TInsert, TId>[]; // Create if doesn't exist
	set?: TId[] | { id: TId }[]; // Replace all related records (M:N set operation)
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
								ExtractRelationInsert<RelationValue<TRelations[K]>>,
								ExtractIdType<
									ExtractRelationSelect<RelationValue<TRelations[K]>>
								>
							>;
						}
				: {}; // Not a record type or unknown, return empty object instead of permissive Record

// With unified field API, FK column key is the same as the relation field name
type RelationIdKey<TInsert, TKey extends string> = Extract<
	Extract<keyof TInsert, string>,
	TKey
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

type IsRequiredKey<T, TK extends keyof T> =
	TK extends RequiredKeys<T> ? true : false;

type OptionalizeKeys<T, TK extends keyof T> = Omit<T, TK> &
	Partial<Pick<T, TK>>;

type OptionalizeRelationForeignKeys<TInsert, TRelations> =
	RelationForeignKeys<TInsert, TRelations> extends keyof TInsert
		? OptionalizeKeys<TInsert, RelationForeignKeys<TInsert, TRelations>>
		: TInsert;

type UnionToIntersection<U> = (
	U extends any ? (value: U) => void : never
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
 * For FK fields that overlap with relation names (belongsTo),
 * widen the type to accept either the raw FK value or a nested mutation.
 */
type WidenFkFieldsForMutations<TInsert, TRelations> = {
	[K in RelationForeignKeys<TInsert, TRelations>]?: K extends keyof TInsert
		? K extends keyof RelationMutations<TRelations>
			?
					| TInsert[K]
					| (RelationMutations<TRelations> & Record<string, unknown>)[K]
			: TInsert[K]
		: never;
};

/**
 * Create input with optional nested relations
 *
 * For belongsTo fields (FK on this table), accepts either:
 * - The raw FK string: `author: "some-id"`
 * - A nested mutation:  `author: { connect: { id: "some-id" } }`
 *
 * For hasMany/M:N fields (no FK on this table), accepts mutations only:
 * - `tags: { connect: [...], create: [...], set: [...] }`
 */
export type CreateInputBase<TInsert = any, TRelations = any> = Omit<
	OptionalizeRelationForeignKeys<TInsert, TRelations>,
	RelationForeignKeys<TInsert, TRelations>
> &
	WidenFkFieldsForMutations<TInsert, TRelations> &
	Omit<RelationMutations<TRelations>, keyof TInsert>;

/**
 * Freshness guard (`Exact`): forbid any key present on the captured input
 * `TInput` that is NOT part of the legal shape `TShape`, by intersecting a
 * `Record<excessKeys, never>`. Because `create`/`update` capture the literal as
 * a generic `TInput extends …Base`, plain excess-property checks are bypassed —
 * this restores them at the CALL site (CL-11 sub-fix A).
 *
 * The `Record<Exclude<…>, never>` form (required `never` props on the excess
 * keys only) is load-bearing: the `{ [K in Exclude<…>]?: never }` mapped form
 * collapses the VALID keys to `never` under generic inference. Top-level only —
 * nested relation-mutation create payloads remain a known gap (the
 * `TInsert | TInsert[]` union disables freshness one level down).
 */
type ForbidExcessKeys<TInput, TShape> = Record<
	Exclude<keyof TInput, keyof TShape>,
	never
>;

/**
 * Freshness for the NESTED relation-mutation `create` / `connectOrCreate.create`
 * payloads. Recurses one level — for each relation key `K` whose captured value
 * carries a single-object `create`, forbid keys not on the target's raw insert
 * model (`ExtractRelationInsert<…>`). Only the single-object arm is guarded; the
 * `TInsert[]` array arm is a known gap (excess checks are disabled inside a union
 * the same way they are at the top level for `TInsert | TInsert[]`). Object/json
 * FIELD values are NOT relation keys, so they are never recursed into.
 */
type ForbidExcessNestedCreate<TInput, TRelations> = [TRelations] extends [never]
	? {}
	: IsAny<TRelations> extends true
		? {}
		: string extends keyof TRelations
			? {}
			: {
					[K in Extract<keyof TInput, keyof TRelations>]?: TInput[K] extends {
						create: infer C;
					}
						? C extends readonly any[]
							? TInput[K] // array arm — known gap, pass through
							: {
									create: C &
										Record<
											Exclude<
												keyof C,
												keyof ExtractRelationInsert<
													RelationValue<TRelations[K]>
												>
											>,
											never
										>;
								}
						: TInput[K] extends {
									connectOrCreate: { create: infer CC };
							  }
							? CC extends readonly any[]
								? TInput[K]
								: {
										connectOrCreate: {
											create: CC &
												Record<
													Exclude<
														keyof CC,
														keyof ExtractRelationInsert<
															RelationValue<TRelations[K]>
														>
													>,
													never
												>;
										};
									}
							: TInput[K];
				};

export type CreateInputWithRelations<
	TInsert = any,
	TRelations = any,
	TInput extends CreateInputBase<TInsert, TRelations> = CreateInputBase<
		TInsert,
		TRelations
	>,
> = TInput &
	EnforceRelationForMissingFk<TInsert, TRelations, TInput> &
	ForbidExcessKeys<TInput, CreateInputBase<TInsert, TRelations>> &
	ForbidExcessNestedCreate<TInput, TRelations>;

export type CreateInput<TInsert = any, TRelations = any> = CreateInputBase<
	TInsert,
	TRelations
>;

/**
 * For update fields that overlap with relation names,
 * widen the type to accept either the raw value or a nested mutation.
 * Fields NOT overlapping with relations are passed through as-is.
 */
type WidenUpdateFieldsForMutations<TUpdate, TRelations> = {
	[K in keyof TUpdate]?: K extends keyof RelationMutations<TRelations>
		? TUpdate[K] | (RelationMutations<TRelations> & Record<string, unknown>)[K]
		: TUpdate[K];
};

/**
 * Update input with optional nested relation mutations
 */
export type UpdateInput<TUpdate = any, TRelations = any> = Prettify<
	WidenUpdateFieldsForMutations<TUpdate, TRelations> &
		Omit<RelationMutations<TRelations>, keyof TUpdate>
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
	in out TUpdate = any,
	in out TFields = any,
	in out TRelations = any,
> {
	where: Where<TFields, TRelations>;
	data: UpdateInput<TUpdate, TRelations>;
}

/**
 * Update multiple records with distinct data per record.
 */
export interface UpdateBatchParams<
	in out TUpdate = any,
	in out TRelations = any,
	TId = string,
> {
	updates: Array<{
		id: TId;
		data: UpdateInput<TUpdate, TRelations>;
	}>;
}

/**
 * Delete single record params
 */
export interface DeleteParams<TId = string> {
	id: TId;
}

/**
 * Permanently purge one already soft-deleted record.
 */
export interface PurgeParams<TId = string> {
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
export interface DeleteManyParams<
	in out TFields = any,
	in out TRelations = any,
> {
	where: Where<TFields, TRelations>;
}

/**
 * Bounded server-side row lock request.
 *
 * Locks are only meaningful inside an active QUESTPIE transaction and are
 * acquired in deterministic id order. The operation returns ids rather than
 * raw rows so callers perform subsequent reads through the normal collection
 * access and hook pipeline.
 */
export interface LockManyParams<TId = string> {
	ids: readonly TId[];
}

/**
 * Params for transitioning a record to a different workflow stage.
 * No data mutation — only stage change + version snapshot.
 */
export interface TransitionStageParams<TId = string> {
	/** Record ID to transition */
	id: TId;
	/** Target workflow stage name */
	stage: string;
	/** If set to a future date, schedule the transition instead of executing immediately */
	scheduledAt?: Date;
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
	/** Workflow stage at the time this version was created (only present when workflow is enabled). */
	versionStage?: string | null;
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
	groupBy?: never;
	groups?: never;
	totalGroups?: never;
}

export interface GroupedPaginatedResult<T, TValue = unknown> extends Omit<
	PaginatedResult<T>,
	"groupBy" | "groups" | "totalGroups"
> {
	groupBy: { field: string; order: "asc" | "desc" };
	groups: Array<{
		key: string;
		value: TValue;
		count: number;
		docs: T[];
	}>;
	totalGroups: number;
}

type GroupFieldFromQuery<TQuery> = TQuery extends { groupBy: infer TGroupBy }
	? TGroupBy extends string
		? TGroupBy
		: TGroupBy extends { field: infer TField }
			? TField
			: never
	: never;

type GroupValueFromQuery<TSelect, TQuery> =
	Extract<
		GroupFieldFromQuery<TQuery>,
		keyof TSelect
	> extends infer TField extends keyof TSelect
		? TSelect[TField]
		: unknown;

/** Keys of a columns map explicitly set to `true`. */
type TrueKeys<C> = {
	[K in keyof C]-?: C[K] extends true ? K : never;
}[keyof C];

/** Keys of a columns map explicitly set to `false`. */
type FalseKeys<C> = {
	[K in keyof C]-?: C[K] extends false ? K : never;
}[keyof C];

/**
 * Type Helper for Partial Selection
 * Mirrors the runtime `columns` semantics:
 * - any key `true` → inclusion mode: only true keys (plus pinned `id`)
 * - all keys `false` → omission mode: every field EXCEPT the false keys
 *   (`id` is always included regardless of selection)
 * - non-literal booleans (dynamic queries) → full select
 */
export type SelectResult<TSelect, TQuery> = [TQuery] extends [never]
	? TSelect
	: TQuery extends { columns: infer C extends Record<string, boolean> }
		? [TrueKeys<C>] extends [never]
			? Omit<TSelect, Exclude<FalseKeys<C>, "id">>
			: Pick<
					TSelect,
					| (TrueKeys<C> & keyof TSelect)
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
			? { _min: { [K in keyof TAgg["_min"]]: number } }
			: {}) &
		(TAgg["_max"] extends object
			? { _max: { [K in keyof TAgg["_max"]]: number } }
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
 * Extract keys loaded via `with` clause.
 * Used to omit FK columns from base select when the relation is being loaded,
 * so the resolved relation type replaces the FK type instead of intersecting.
 *
 * Requires an actually-present `with` key (non-optional pattern): when TQuery
 * is the unfilled generic CONSTRAINT (no-arg calls, ReturnType<> of the
 * generic method), the optional `with?: With<TRelations>` member must NOT
 * cause every relation key to be omitted from the base select.
 */
type WithKeys<TQuery> = TQuery extends { with: infer W }
	? W extends Record<string, any>
		? keyof W & string
		: never
	: never;

/**
 * Combined Result Type
 * Merges partial selection and included relations.
 *
 * When a relation is loaded via `with`, its FK column is omitted from the base
 * select so the resolved relation type cleanly replaces it. For example,
 * `avatar: string` (FK) is replaced by `avatar: { id, key, filename, ... }`.
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
			: Omit<SelectResult<TSelect, TQuery>, WithKeys<TQuery>> &
					RelationResult<TRelations, TQuery>
>;

export type FindResult<
	TSelect,
	TRelations,
	TQuery extends Record<string, any> | undefined | boolean,
> = [GroupFieldFromQuery<TQuery>] extends [never]
	? PaginatedResult<ApplyQuery<TSelect, TRelations, TQuery>>
	: GroupedPaginatedResult<
			ApplyQuery<TSelect, TRelations, TQuery>,
			GroupValueFromQuery<TSelect, TQuery>
		>;

/**
 * CRUD operations interface
 *
 * One vocabulary across server and client:
 * - by id: `updateById` / `deleteById` / `restoreById`
 * - bulk by where: `updateMany` / `deleteMany` (claim-checked — see method docs)
 * - per-record batch: `updateBatch`
 *
 * `update`/`delete` are deprecated aliases of the bulk operations (the same
 * names mean by-id on the client SDK); they will be removed in v4.
 */
export interface CRUD<
	in out TSelect = any,
	in out TInsert = any,
	in out TUpdate = any,
	in out TRelations = any,
	TId = ExtractIdType<TSelect>,
> {
	/**
	 * Find many records (paginated)
	 * Returns type-safe result based on columns and with options
	 */
	find<TQuery extends FindManyOptions<TSelect, TRelations>>(
		options?: TQuery,
		context?: CRUDContext,
	): Promise<FindResult<TSelect, TRelations, TQuery>>;

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
	 * Lock a bounded set of accessible rows for the active transaction.
	 * Server-only: callers must wrap the aggregate command in `withTransaction`.
	 */
	lockMany(params: LockManyParams<TId>, context?: CRUDContext): Promise<TId[]>;

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
	 *
	 * Atomic conditional update (claim-checked): inside the write transaction
	 * the matched rows are locked and `where` is re-evaluated, so a row is
	 * only written if it STILL matches at write time. The returned array
	 * contains exactly the rows that were written ("winners") — `[]` means
	 * nothing matched at write time, e.g. you lost a concurrent claim:
	 *
	 * ```ts
	 * const claimed = await collections.event_members.updateMany(
	 *   { where: { id, user: { isNull: true } }, data: { user: userId } },
	 *   { accessMode: "system" },
	 * );
	 * if (claimed.length === 0) {
	 *   // lost the race — observable, not silent
	 * }
	 * ```
	 */
	updateMany(
		params: UpdateManyParams<TUpdate, TSelect, TRelations>,
		context?: CRUDContext,
	): Promise<TSelect[]>;

	/**
	 * @deprecated Ambiguous across surfaces — server `update` is bulk while
	 * the client SDK `update` is by-id. Use {@link CRUD.updateMany} (bulk) or
	 * {@link CRUD.updateById} (single). Will be removed in v4.
	 */
	update(
		params: UpdateManyParams<TUpdate, TSelect, TRelations>,
		context?: CRUDContext,
	): Promise<TSelect[]>;

	/**
	 * Update multiple records with distinct data per record.
	 * Runs each update through the normal update pipeline in one transaction.
	 */
	updateBatch(
		params: UpdateBatchParams<TUpdate, TRelations, TId>,
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
	 * Permanently remove an already soft-deleted record.
	 *
	 * Purge has distinct access and hook lifecycles. Delete authority never
	 * grants purge authority. Collections without soft delete reject this
	 * operation at runtime.
	 */
	purgeById(
		params: PurgeParams<TId>,
		context?: CRUDContext,
	): Promise<{ success: true }>;

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
	 *
	 * Claim-checked like {@link CRUD.updateMany}: rows are locked and `where`
	 * is re-evaluated inside the transaction — `count` reports exactly the
	 * rows that still matched at delete time.
	 */
	deleteMany(
		params: DeleteManyParams<TSelect, TRelations>,
		context?: CRUDContext,
	): Promise<{ success: boolean; count: number }>;

	/**
	 * @deprecated Ambiguous across surfaces — server `delete` is bulk while
	 * the client SDK `delete` is by-id. Use {@link CRUD.deleteMany} (bulk) or
	 * {@link CRUD.deleteById} (single). Will be removed in v4.
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
	 * Transition a record to a different workflow stage.
	 * Only available on collections with workflow enabled.
	 * No data mutation — creates a version snapshot at the target stage.
	 */
	transitionStage(
		params: TransitionStageParams<TId>,
		context?: CRUDContext,
	): Promise<TSelect>;

	/**
	 * Upload a single file
	 * Only available on collections configured with .upload()
	 *
	 * @example
	 * ```ts
	 * const asset = await app.collections.media.upload(file, context);
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
	 * const assets = await app.collections.media.uploadMany(files, context);
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
