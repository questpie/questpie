import type { UploadOptions } from "#questpie/server/collection/builder/index.js";
import type {
	ApplyQuery,
	CollectionRelationsFromApp,
	CollectionSelectFromApp,
	CRUD,
	CRUDContext,
	FindOneOptions,
	FindOptions,
	PaginatedResult,
} from "#questpie/server/collection/crud/index.js";
import type { Questpie } from "#questpie/server/config/questpie.js";
import type { QuestpieConfig } from "#questpie/server/config/types.js";
import type {
	GlobalCRUD,
	GlobalSelectFromApp,
} from "#questpie/server/global/crud/index.js";
import type {
	AnyCollectionOrBuilder,
	CollectionInsert,
	CollectionState,
	CollectionUpdate,
	GetCollection,
	GetGlobal,
	GlobalInsert,
	GlobalRelations,
	GlobalUpdate,
	ResolveRelationsDeep,
} from "#questpie/shared/type-utils.js";

type UploadMethods<TSelect, TInsert> = {
	upload: NonNullable<CRUD<TSelect, TInsert, any, any>["upload"]>;
	uploadMany: NonNullable<CRUD<TSelect, TInsert, any, any>["uploadMany"]>;
};

type CollectionHasUpload<TCollection> =
	CollectionState<TCollection> extends { upload: infer TUpload }
		? TUpload extends UploadOptions
			? true
			: false
		: false;

/**
 * Build an app-like context from TCollections for field-definition resolution.
 * This allows nested relation Where/With to resolve through WhereFromCollection.
 */
type AppFromCollections<
	TCollections extends Record<string, AnyCollectionOrBuilder>,
> = { collections: TCollections };

/**
 * Collection-aware CRUD that uses FindOptions/FindOneOptions typed against
 * the collection + TApp context for field-definition-aware operator types.
 *
 * This ensures that:
 * - Where clauses use FieldOperatorsFromFieldDef (not WhereOperatorsLegacy)
 * - Nested relation Where flows through WhereFromCollection
 * - With clauses get typed where/columns/orderBy from field definitions
 */
type CollectionCRUD<
	TCollection,
	TCollections extends Record<string, AnyCollectionOrBuilder>,
	TApp = AppFromCollections<TCollections>,
	TSelect = CollectionSelectFromApp<TCollection, TApp>,
	TRelations = CollectionRelationsFromApp<TCollection, TApp>,
> = Omit<
	CRUD<
		TSelect,
		CollectionInsert<TCollection>,
		CollectionUpdate<TCollection>,
		TRelations
	>,
	"find" | "findOne" | "count"
> & {
	find<TQuery extends FindOptions<TCollection, TApp>>(
		options?: TQuery,
		context?: CRUDContext,
	): Promise<PaginatedResult<ApplyQuery<TSelect, TRelations, TQuery>>>;

	findOne<TQuery extends FindOneOptions<TCollection, TApp>>(
		options?: TQuery,
		context?: CRUDContext,
	): Promise<ApplyQuery<TSelect, TRelations, TQuery> | null>;

	count(
		options?: Pick<FindOptions<TCollection, TApp>, "where" | "includeDeleted">,
		context?: CRUDContext,
	): Promise<number>;
};

type CollectionAPI<
	TCollection,
	TCollections extends Record<string, AnyCollectionOrBuilder>,
> = Omit<CollectionCRUD<TCollection, TCollections>, "upload" | "uploadMany"> &
	(CollectionHasUpload<TCollection> extends true
		? UploadMethods<
				CollectionSelectFromApp<TCollection, AppFromCollections<TCollections>>,
				CollectionInsert<TCollection>
			>
		: {});

type GlobalAPI<
	TGlobal,
	TCollections extends Record<string, AnyCollectionOrBuilder>,
	TApp = AppFromCollections<TCollections>,
> = GlobalCRUD<
	GlobalSelectFromApp<TGlobal, TApp>,
	GlobalInsert<TGlobal>,
	GlobalUpdate<TGlobal>,
	ResolveRelationsDeep<GlobalRelations<TGlobal>, TCollections>
>;

export type QuestpieApi<TConfig extends QuestpieConfig = QuestpieConfig> =
	QuestpieAPI<TConfig>;

export class QuestpieAPI<TConfig extends QuestpieConfig = QuestpieConfig> {
	constructor(private readonly app: Questpie<TConfig>) {}

	/**
	 * Access collections CRUD operations
	 * @example
	 * await app.api.collections.users.create({ email: '...' }, context)
	 * await app.api.collections.posts.find({ where: { status: 'published' } })
	 */
	public get collections(): {
		[K in keyof TConfig["collections"]]: CollectionAPI<
			GetCollection<TConfig["collections"], K>,
			TConfig["collections"]
		>;
	} {
		const collectionsProxy = {};
		const collectionsObj = this.app.getCollections();

		for (const [name, collection] of Object.entries(collectionsObj)) {
			Object.defineProperty(collectionsProxy, name, {
				get: () => {
					return collection.generateCRUD(this.app.db, this.app) as any;
				},
				enumerable: true,
			});
		}

		return collectionsProxy as {
			[K in keyof TConfig["collections"]]: CollectionAPI<
				GetCollection<TConfig["collections"], K>,
				TConfig["collections"]
			>;
		};
	}

	public get globals(): {
		[K in keyof NonNullable<TConfig["globals"]>]: GlobalAPI<
			GetGlobal<NonNullable<TConfig["globals"]>, K>,
			TConfig["collections"]
		>;
	} {
		const globalsProxy = {};
		const globalsObj = this.app.getGlobals();

		for (const [name, global] of Object.entries(globalsObj)) {
			Object.defineProperty(globalsProxy, name, {
				get: () => {
					return global.generateCRUD(this.app.db, this.app) as any;
				},
				enumerable: true,
			});
		}

		return globalsProxy as {
			[K in keyof NonNullable<TConfig["globals"]>]: GlobalAPI<
				GetGlobal<NonNullable<TConfig["globals"]>, K>,
				TConfig["collections"]
			>;
		};
	}
}
