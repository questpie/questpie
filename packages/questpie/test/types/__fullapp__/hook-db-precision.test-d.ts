import "./.generated/factories.js";
import type {
	GlobalCollectionHookContext,
	GlobalGlobalHookContext,
} from "#questpie/server/config/global-hooks-types.js";

import type { Equal, Expect, HasKey, IsAny } from "../type-test-utils.js";

type CollectionHookDbQuery = GlobalCollectionHookContext["db"]["query"];

type _collectionDbMatchesGeneratedContext = Expect<
	Equal<GlobalCollectionHookContext["db"], Questpie.AppHookContext["db"]>
>;
type _globalDbMatchesGeneratedContext = Expect<
	Equal<GlobalGlobalHookContext["db"], Questpie.AppHookContext["db"]>
>;
type _collectionQueryNotAny = Expect<
	Equal<IsAny<CollectionHookDbQuery>, false>
>;
type _collectionQueryHasArticles = Expect<
	HasKey<CollectionHookDbQuery, "articles">
>;
