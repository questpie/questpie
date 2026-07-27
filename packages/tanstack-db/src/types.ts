import type { Collection } from "@tanstack/db";
import type {
	ApplyQuery,
	CollectionRelations,
	CollectionSelectFromApp,
	FindManyOptions,
	GetCollection,
	QuestpieApp,
	QuestpieClient,
	ResolveRelationsDeep,
} from "questpie/client";

export type CollectionKeys<TApp extends QuestpieApp> = Extract<
	keyof QuestpieClient<TApp>["collections"],
	string
>;

export type CollectionSelectOf<
	TApp extends QuestpieApp,
	K extends CollectionKeys<TApp>,
> = CollectionSelectFromApp<
	GetCollection<TApp["collections"], K>,
	{ collections: TApp["collections"] }
>;

export type CollectionRelationsOf<
	TApp extends QuestpieApp,
	K extends CollectionKeys<TApp>,
> = ResolveRelationsDeep<
	CollectionRelations<GetCollection<TApp["collections"], K>>,
	TApp["collections"]
>;

export type FindOptionsOf<
	TApp extends QuestpieApp,
	K extends CollectionKeys<TApp>,
> = Pick<
	FindManyOptions<CollectionSelectOf<TApp, K>, CollectionRelationsOf<TApp, K>>,
	| "where"
	| "orderBy"
	| "limit"
	| "offset"
	| "search"
	| "locale"
	| "localeFallback"
	| "includeDeleted"
	| "stage"
>;

export type CollectionRowOf<
	TApp extends QuestpieApp,
	K extends CollectionKeys<TApp>,
> = ApplyQuery<
	CollectionSelectOf<TApp, K>,
	CollectionRelationsOf<TApp, K>,
	undefined
>;

export type IdOf<TRow> = TRow extends { id: infer TId }
	? Extract<TId, string>
	: never;

export type QuestpieCollections<TApp extends QuestpieApp> = {
	[K in CollectionKeys<TApp>]: Collection<
		CollectionRowOf<TApp, K>,
		IdOf<CollectionRowOf<TApp, K>>
	>;
};

export type QuestpieDb<TApp extends QuestpieApp> = {
	collections: QuestpieCollections<TApp>;
	destroy: () => void;
};
