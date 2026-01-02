// Centralized Type Utilities for QUESTPIE CMS
// This file consolidates all type inference helpers used by both server and client

import type {
	Collection,
	CollectionBuilder,
	GlobalBuilder,
	Global,
	FunctionDefinition,
} from "#questpie/cms/server";
import type { RelationConfig } from "#questpie/cms/server/collection/builder/types";
import type { SearchableConfig } from "#questpie/cms/server/integrated/search";

// ============================================================================
// Base Type Helpers
// ============================================================================

export type AnyCollectionOrBuilder = Collection<any> | CollectionBuilder<any>;
export type AnyCollection = Collection<any>;
export type AnyGlobal = Global<any>;
export type AnyGlobalBuilder = GlobalBuilder<any>;
export type AnyGlobalOrBuilder = AnyGlobal | AnyGlobalBuilder;

// ============================================================================
// Collection Type Inference (from $infer property)
// ============================================================================

/**
 * Extract the $infer property from a Collection or CollectionBuilder
 */
export type CollectionInfer<T> = T extends { $infer: infer Infer }
	? Infer
	: never;

/**
 * Extract the select type from a Collection or CollectionBuilder
 * @example type Post = CollectionSelect<typeof posts>
 */
export type CollectionSelect<T> =
	CollectionInfer<T> extends {
		select: infer Select;
	}
		? Select
		: never;

/**
 * Extract the insert type from a Collection or CollectionBuilder
 * @example type PostInsert = CollectionInsert<typeof posts>
 */
export type CollectionInsert<T> =
	CollectionInfer<T> extends {
		insert: infer Insert;
	}
		? Insert
		: never;

/**
 * Extract the update type from a Collection or CollectionBuilder
 * @example type PostUpdate = CollectionUpdate<typeof posts>
 */
export type CollectionUpdate<T> =
	CollectionInfer<T> extends {
		update: infer Update;
	}
		? Update
		: never;

/**
 * Extract the state from a Collection or CollectionBuilder
 */
export type CollectionState<T> = T extends { state: infer State }
	? State
	: never;

/**
 * Extract functions from a Collection or CollectionBuilder
 */
export type CollectionFunctions<T> =
	CollectionState<T> extends { functions: infer Functions }
		? Functions extends Record<string, FunctionDefinition>
			? Functions
			: Record<string, FunctionDefinition>
		: Record<string, FunctionDefinition>;

/**
 * Extract relations from a Collection or CollectionBuilder
 */
export type CollectionRelations<T> =
	CollectionState<T> extends {
		relations: infer Relations;
	}
		? Relations extends Record<string, RelationConfig>
			? Relations
			: Record<string, RelationConfig>
		: Record<string, RelationConfig>;

/**
 * Extract search metadata type from a Collection or CollectionBuilder
 */
export type CollectionSearchMetadata<T> =
	CollectionState<T> extends { searchable: SearchableConfig }
		? Record<string, any>
		: Record<string, any>;

// ============================================================================
// Global Type Inference (from $infer property)
// ============================================================================

/**
 * Extract the $infer property from a Global or GlobalBuilder
 */
export type GlobalInfer<T> = T extends { $infer: infer Infer } ? Infer : never;

/**
 * Extract the select type from a Global or GlobalBuilder
 * @example type Settings = GlobalSelect<typeof siteSettings>
 */
export type GlobalSelect<T> =
	GlobalInfer<T> extends { select: infer Select } ? Select : never;

/**
 * Extract the insert type from a Global or GlobalBuilder
 * @example type SettingsInsert = GlobalInsert<typeof siteSettings>
 */
export type GlobalInsert<T> =
	GlobalInfer<T> extends { insert: infer Insert } ? Insert : never;

/**
 * Extract the update type from a Global or GlobalBuilder
 * @example type SettingsUpdate = GlobalUpdate<typeof siteSettings>
 */
export type GlobalUpdate<T> =
	GlobalInfer<T> extends { update: infer Update } ? Update : never;

/**
 * Extract the state from a Global or GlobalBuilder
 */
export type GlobalState<T> = T extends { state: infer State } ? State : never;

/**
 * Extract functions from a Global or GlobalBuilder
 */
export type GlobalFunctions<T> =
	GlobalState<T> extends { functions: infer F }
		? F extends Record<string, FunctionDefinition>
			? F
			: Record<string, FunctionDefinition>
		: Record<string, FunctionDefinition>;

/**
 * Extract relations from a Global or GlobalBuilder
 */
export type GlobalRelations<T> =
	GlobalState<T> extends {
		relations: infer Relations;
	}
		? Relations extends Record<string, RelationConfig>
			? Relations
			: Record<string, RelationConfig>
		: Record<string, RelationConfig>;

// ============================================================================
// Collection Name Extraction & Lookup
// ============================================================================

/**
 * Extract all collection names from a collections object
 * @example type Names = CollectionNames<{ posts: typeof posts, pages: typeof pages }> // "posts" | "pages"
 */
export type CollectionNames<
	TCollections extends Record<string, AnyCollectionOrBuilder>,
> = keyof TCollections;

/**
 * Get a Collection by name from collections object
 * @example type Posts = GetCollection<{ posts: typeof posts, pages: typeof pages }, "posts">
 */
export type GetCollection<
	TCollections extends Record<string, AnyCollectionOrBuilder>,
	Name extends CollectionNames<TCollections>,
> = TCollections[Name] extends Collection<infer TState>
	? Collection<TState>
	: TCollections[Name] extends CollectionBuilder<infer TState>
		? Collection<TState>
		: never;

/**
 * Extract searchable collection names from a collections map
 */
export type SearchableCollectionNames<
	TCollections extends Record<string, AnyCollectionOrBuilder>,
> = {
	[K in CollectionNames<TCollections>]: CollectionState<
		GetCollection<TCollections, K>
	> extends { searchable: SearchableConfig }
		? K
		: never;
}[CollectionNames<TCollections>];

// ============================================================================
// Global Name Extraction & Lookup
// ============================================================================

/**
 * Extract all global names from a globals object
 * @example type Names = GlobalNames<{ siteSettings: typeof siteSettings, themeConfig: typeof themeConfig }> // "siteSettings" | "themeConfig"
 */
export type GlobalNames<TGlobals extends Record<string, AnyGlobalOrBuilder>> =
	keyof TGlobals;

/**
 * Get a Global by name from globals object
 * @example type Settings = GetGlobal<{ siteSettings: typeof siteSettings, themeConfig: typeof themeConfig }, "siteSettings">
 */
export type GetGlobal<
	TGlobals extends Record<string, AnyGlobalOrBuilder>,
	Name extends GlobalNames<TGlobals>,
> = TGlobals[Name] extends Global<infer TState>
	? Global<TState>
	: TGlobals[Name] extends GlobalBuilder<infer TState>
		? Global<TState>
		: never;

// ============================================================================
// Relation Resolution
// ============================================================================

/**
 * Resolve a collection select type by name
 */
type ResolveCollectionSelect<
	TCollections extends Record<string, AnyCollectionOrBuilder>,
	C,
> = C extends CollectionNames<TCollections>
	? CollectionSelect<GetCollection<TCollections, C>>
	: any;

type DecrementDepth<Depth extends unknown[]> =
	Depth extends [unknown, ...infer Rest] ? Rest : [];

export type RelationShape<TSelect, TRelations> = {
	__select: TSelect;
	__relations: TRelations;
};

export type ExtractRelationSelect<T> =
	T extends RelationShape<infer Select, any> ? Select : T;

export type ExtractRelationRelations<T> =
	T extends RelationShape<any, infer Relations> ? Relations : never;

type ResolveCollectionRelation<
	TCollections extends Record<string, AnyCollectionOrBuilder>,
	C,
	Depth extends unknown[],
> = C extends CollectionNames<TCollections>
	? RelationShape<
			CollectionSelect<GetCollection<TCollections, C>>,
			Depth extends []
				? never
				: ResolveRelationsDeep<
						CollectionRelations<GetCollection<TCollections, C>>,
						TCollections,
						DecrementDepth<Depth>
					>
		>
	: RelationShape<any, never>;

/**
 * Resolve all relations from a RelationConfig to actual types
 * Handles one-to-many, many-to-many, and one-to-one relations
 *
 * @example
 * type PostRelations = ResolveRelations<
 *   typeof posts.state.relations,
 *   { posts: typeof posts, comments: typeof comments, users: typeof users }
 * >
 * // => { author: User, comments: Comment[], tags: Tag[] }
 */
export type ResolveRelations<
	TRelations extends Record<string, RelationConfig>,
	TCollections extends Record<string, AnyCollectionOrBuilder>,
> = {
	[K in keyof TRelations]: TRelations[K] extends {
		type: "many" | "manyToMany";
		collection: infer C;
	}
		? ResolveCollectionSelect<TCollections, C>[]
		: TRelations[K] extends {
					type: "one";
					collection: infer C;
				}
			? ResolveCollectionSelect<TCollections, C>
			: never;
};

export type ResolveRelationsDeep<
	TRelations extends Record<string, RelationConfig>,
	TCollections extends Record<string, AnyCollectionOrBuilder>,
	Depth extends unknown[] = [1, 1, 1, 1, 1],
> = {
	[K in keyof TRelations]: TRelations[K] extends {
		type: "many" | "manyToMany";
		collection: infer C;
	}
		? ResolveCollectionRelation<TCollections, C, Depth>[]
		: TRelations[K] extends {
					type: "one";
					collection: infer C;
				}
			? ResolveCollectionRelation<TCollections, C, Depth>
			: never;
};
