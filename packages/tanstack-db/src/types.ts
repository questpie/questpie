import type { Collection } from "@tanstack/db";
import type {
	ApplyQuery,
	CollectionRelations,
	CollectionSelect,
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
> = CollectionSelect<GetCollection<TApp["collections"], K>>;

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
> = FindManyOptions<CollectionSelectOf<TApp, K>, CollectionRelationsOf<TApp, K>>;

export type CollectionRowOf<
	TApp extends QuestpieApp,
	K extends CollectionKeys<TApp>,
> = ApplyQuery<
	CollectionSelectOf<TApp, K>,
	CollectionRelationsOf<TApp, K>,
	undefined
>;

export type IdOf<TRow> = TRow extends { id: infer TId }
	? Extract<TId, string | number>
	: never;

export type QuestpieCollections<TApp extends QuestpieApp> = {
	[K in CollectionKeys<TApp>]: Collection<
		CollectionRowOf<TApp, K>,
		IdOf<CollectionRowOf<TApp, K>>
	>;
};

export type QuestpieDb<TApp extends QuestpieApp> = {
	collections: QuestpieCollections<TApp>;
};
