/**
 * CRUD Deep Type Safety Tests
 *
 * Comprehensive compile-time tests covering:
 * - Many-to-many relations (with junction table)
 * - Nested with result types (ApplyQuery depth)
 * - Columns + With interaction in result types
 * - Object/Array field type inference
 * - Select (enum) field types
 * - Boolean field operators
 * - Aggregation result types (_count, _sum, _avg)
 * - Create input: FK optionalization, required relation enforcement
 * - Update input: nested relation mutations
 * - Circular relation depth handling
 *
 * IMPORTANT: Uses $inferApp as TApp to test the REAL public API surface.
 * If tests fail here, it means the type system has real bugs that users would hit.
 *
 * Run with: bunx tsc --noEmit
 */

import type {
	ApplyQuery,
	CollectionRelationsFromApp,
	CollectionSelect as CollectionSelectFromApp,
	CreateInput,
	CreateInputBase,
	FindOptions,
	UpdateInput,
	Where as WhereType,
} from "#questpie/server/collection/crud/types.js";
import { defaultFields } from "#questpie/server/fields/builtin/defaults.js";
import { questpie } from "#questpie/server/index.js";
import type {
	ExtractRelationRelations,
	ExtractRelationSelect,
} from "#questpie/shared/type-utils.js";
import type {
	Equal,
	Expect,
	Extends,
	HasKey,
	IsNullable,
	Not,
	OptionalKeys,
	RequiredKeys,
} from "./type-test-utils.js";

// ============================================================================
// Test Fixtures — rich collection graph with diverse field types
// ============================================================================

const q = questpie({ name: "deep-test" }).fields(defaultFields);

const authors = q
	.collection("authors")
	.fields((f) => ({
		name: f.text({ required: true, maxLength: 100 }),
		email: f.text({ required: true }),
		bio: f.textarea({ localized: true }),
		active: f.boolean({ default: true }),
	}))
	.options({ timestamps: true });

const categories = q.collection("categories").fields((f) => ({
	name: f.text({ required: true, maxLength: 100 }),
	slug: f.text({ required: true }),
	description: f.textarea(),
}));

const articles = q
	.collection("articles")
	.fields((f) => ({
		title: f.text({ required: true, maxLength: 255 }),
		content: f.textarea({ localized: true }),
		slug: f.text({ required: true }),
		views: f.number({ default: 0 }),
		rating: f.number(),
		published: f.boolean({ default: false }),
		status: f.select({
			options: [
				{ value: "draft", label: "Draft" },
				{ value: "review", label: "In Review" },
				{ value: "published", label: "Published" },
			] as const,
		}),
		metadata: f.object({
			fields: {
				seoTitle: f.text({ maxLength: 60 }),
				seoDescription: f.textarea({ maxLength: 160 }),
				featured: f.boolean({ default: false }),
			},
		}),
		tagList: f.array({
			of: f.text({ required: true }),
		}),
		author: f.relation({
			to: "authors",
			required: true,
			relationName: "articleAuthor",
		}),
		categories: f.relation({
			to: "categories",
			hasMany: true,
			through: "article_categories",
			sourceField: "article",
			targetField: "category",
		}),
		comments: f.relation({
			to: "article_comments",
			hasMany: true,
			foreignKey: "article",
			relationName: "article",
		}),
		publishedAt: f.datetime(),
	}))
	.options({ softDelete: true, versioning: true });

const articleComments = q.collection("article_comments").fields((f) => ({
	content: f.textarea({ required: true }),
	article: f.relation({
		to: "articles",
		required: true,
		relationName: "article",
	}),
	author: f.relation({
		to: "authors",
		required: true,
		relationName: "commentAuthor",
	}),
}));

const articleCategories = q.collection("article_categories").fields((f) => ({
	article: f.relation({
		to: "articles",
		required: true,
		onDelete: "cascade",
	}),
	category: f.relation({
		to: "categories",
		required: true,
		onDelete: "cascade",
	}),
}));

const media = q
	.collection("media")
	.fields((f) => ({
		alt: f.text({ maxLength: 255 }),
		caption: f.textarea({ localized: true }),
	}))
	.upload({ visibility: "public" });

const testModule = q.collections({
	authors,
	categories,
	articles,
	article_comments: articleComments,
	article_categories: articleCategories,
	media,
});

// ============================================================================
// TApp: test BOTH approaches to surface real bugs
// ============================================================================

// Approach A: $inferApp — the real public API type users get
type TAppFromInfer = typeof testModule.$inferApp;

// Approach B: { collections: TCollections } — the manual workaround
type TCollections = typeof testModule.state.collections;
type TAppManual = { collections: TCollections };

// ============================================================================
// BUG TEST: $inferApp vs manual TApp — are they equivalent?
// ============================================================================

// Using $inferApp, CollectionSelect should still resolve fields correctly.
// If these fail, it means $inferApp doesn't work with the type helpers
// and users hitting this in practice would get broken types.

type ArticleSelect_Infer = CollectionSelectFromApp<
	typeof articles,
	TAppFromInfer
>;
type ArticleSelect_Manual = CollectionSelectFromApp<
	typeof articles,
	TAppManual
>;

// --- These should both have the same basic field types ---
type _inferHasTitle = Expect<Equal<HasKey<ArticleSelect_Infer, "title">, true>>;
type _manualHasTitle = Expect<
	Equal<HasKey<ArticleSelect_Manual, "title">, true>
>;
type _inferTitleIsString = Expect<Equal<ArticleSelect_Infer["title"], string>>;
type _manualTitleIsString = Expect<
	Equal<ArticleSelect_Manual["title"], string>
>;

// --- hasMany should NOT be in select ---
// BUG INDICATOR: if _inferCategoriesAbsent fails, $inferApp breaks manyToMany filtering
type _inferCategoriesAbsent = Expect<
	Equal<HasKey<ArticleSelect_Infer, "categories">, false>
>;
type _manualCategoriesAbsent = Expect<
	Equal<HasKey<ArticleSelect_Manual, "categories">, false>
>;
type _inferCommentsAbsent = Expect<
	Equal<HasKey<ArticleSelect_Infer, "comments">, false>
>;
type _manualCommentsAbsent = Expect<
	Equal<HasKey<ArticleSelect_Manual, "comments">, false>
>;

// --- Object field should resolve nested shape ---
// BUG INDICATOR: if metadata resolves to {} & {} instead of typed object
type MetadataInfer = NonNullable<ArticleSelect_Infer["metadata"]>;
type MetadataManual = NonNullable<ArticleSelect_Manual["metadata"]>;
type _inferMetadataHasSeoTitle = Expect<HasKey<MetadataInfer, "seoTitle">>;
type _manualMetadataHasSeoTitle = Expect<HasKey<MetadataManual, "seoTitle">>;
type _inferMetadataHasFeatured = Expect<HasKey<MetadataInfer, "featured">>;
type _manualMetadataHasFeatured = Expect<HasKey<MetadataManual, "featured">>;

// ============================================================================
// BUG TEST: Relations resolution with $inferApp
// ============================================================================

type ArticleRelations_Infer = CollectionRelationsFromApp<
	typeof articles,
	TAppFromInfer
>;
type ArticleRelations_Manual = CollectionRelationsFromApp<
	typeof articles,
	TAppManual
>;

// --- Author relation: extract select, check for concrete fields ---
type AuthorRelSelect_Infer = ExtractRelationSelect<
	ArticleRelations_Infer["author"]
>;
type AuthorRelSelect_Manual = ExtractRelationSelect<
	ArticleRelations_Manual["author"]
>;

// BUG INDICATOR: if $inferApp author select doesn't have "name", relation resolution is broken
type _inferAuthorRelHasName = Expect<
	Equal<HasKey<AuthorRelSelect_Infer, "name">, true>
>;
type _manualAuthorRelHasName = Expect<
	Equal<HasKey<AuthorRelSelect_Manual, "name">, true>
>;
type _inferAuthorRelNameString = Expect<
	Extends<AuthorRelSelect_Infer["name"], string>
>;
type _manualAuthorRelNameString = Expect<
	Extends<AuthorRelSelect_Manual["name"], string>
>;
type _inferAuthorRelNameNotUnknown = Expect<
	Not<Equal<AuthorRelSelect_Infer["name"], unknown>>
>;

// --- Depth 2: comments → author ---
type CommentsRelElement_Infer =
	ArticleRelations_Infer["comments"] extends (infer U)[] ? U : never;
type CommentsRelRelations_Infer =
	ExtractRelationRelations<CommentsRelElement_Infer>;
type CommentsAuthorSelect_Infer = ExtractRelationSelect<
	CommentsRelRelations_Infer["author"]
>;

type CommentsRelElement_Manual =
	ArticleRelations_Manual["comments"] extends (infer U)[] ? U : never;
type CommentsRelRelations_Manual =
	ExtractRelationRelations<CommentsRelElement_Manual>;
type CommentsAuthorSelect_Manual = ExtractRelationSelect<
	CommentsRelRelations_Manual["author"]
>;

// BUG INDICATOR: depth 2 author should still have concrete fields
type _inferDepth2AuthorHasName = Expect<
	Equal<HasKey<CommentsAuthorSelect_Infer, "name">, true>
>;
type _manualDepth2AuthorHasName = Expect<
	Equal<HasKey<CommentsAuthorSelect_Manual, "name">, true>
>;
type _inferDepth2AuthorNameString = Expect<
	Extends<CommentsAuthorSelect_Infer["name"], string>
>;

// ============================================================================
// BUG TEST: Nested Where with $inferApp
// ============================================================================

type ArticleWhere_Infer = WhereType<typeof articles, TAppFromInfer>;
type ArticleWhere_Manual = WhereType<typeof articles, TAppManual>;

// --- BelongsTo: author.is.{name} — should accept nested field where ---
// BUG INDICATOR: if $inferApp nested where doesn't know author fields
const _inferWhereAuthorIs: ArticleWhere_Infer = {
	author: { is: { name: { contains: "Jane" } } },
};
const _manualWhereAuthorIs: ArticleWhere_Manual = {
	author: { is: { name: { contains: "Jane" } } },
};

// --- BelongsTo: author.isNot ---
const _inferWhereAuthorIsNot: ArticleWhere_Infer = {
	author: { isNot: { active: { eq: false } } },
};
const _manualWhereAuthorIsNot: ArticleWhere_Manual = {
	author: { isNot: { active: { eq: false } } },
};

// --- BelongsTo: author direct shorthand (= .is) ---
const _inferWhereAuthorDirect: ArticleWhere_Infer = {
	author: { name: "Jane" },
};
const _manualWhereAuthorDirect: ArticleWhere_Manual = {
	author: { name: "Jane" },
};

// --- HasMany: comments.some ---
const _inferWhereCommentsSome: ArticleWhere_Infer = {
	comments: { some: { content: { contains: "great" } } },
};
const _manualWhereCommentsSome: ArticleWhere_Manual = {
	comments: { some: { content: { contains: "great" } } },
};

// --- HasMany: comments.none ---
const _inferWhereCommentsNone: ArticleWhere_Infer = {
	comments: { none: { content: { contains: "spam" } } },
};

// --- HasMany: comments.every ---
const _inferWhereCommentsEvery: ArticleWhere_Infer = {
	comments: { every: { content: { contains: "approved" } } },
};

// --- ManyToMany: categories.some ---
const _inferWhereCatSome: ArticleWhere_Infer = {
	categories: { some: { name: "TypeScript" } },
};
const _manualWhereCatSome: ArticleWhere_Manual = {
	categories: { some: { name: "TypeScript" } },
};

// --- ManyToMany: categories.none ---
const _inferWhereCatNone: ArticleWhere_Infer = {
	categories: { none: { slug: "deprecated" } },
};

// --- ManyToMany: categories.every ---
const _inferWhereCatEvery: ArticleWhere_Infer = {
	categories: { every: { name: { contains: "tech" } } },
};

// --- Deep nesting: comments → author (2 levels) ---
const _inferWhereNestedCommentAuthor: ArticleWhere_Infer = {
	comments: {
		some: {
			author: { is: { email: { endsWith: "@example.com" } } },
		},
	},
};

// --- Deep nesting: comments → article (circular, 2 levels) ---
const _inferWhereCircular: ArticleWhere_Infer = {
	comments: {
		some: {
			article: {
				is: { title: { like: "%featured%" } },
			},
		},
	},
};

// --- Complex combined where ---
const _inferWhereComplex: ArticleWhere_Infer = {
	AND: [
		{ title: { contains: "typescript" } },
		{ views: { gt: 100 } },
		{
			OR: [
				{ author: { is: { name: "Jane" } } },
				{ author: { is: { name: "John" } } },
			],
		},
		{ categories: { some: { slug: "programming" } } },
		{ comments: { none: { content: { contains: "spam" } } } },
	],
	NOT: {
		published: false,
	},
};

// --- Boolean field operators ---
const _inferWhereBool: ArticleWhere_Infer = { published: { eq: true } };

// --- Datetime field operators ---
const _inferWhereDatetime: ArticleWhere_Infer = {
	publishedAt: { gt: new Date("2024-01-01") },
};
const _inferWhereDatetimeStr: ArticleWhere_Infer = {
	publishedAt: { lte: "2024-12-31" },
};

// --- Number field operators ---
const _inferWhereNumber: ArticleWhere_Infer = { views: { gt: 1000 } };
const _inferWhereNumberIn: ArticleWhere_Infer = {
	views: { in: [100, 200, 300] },
};
const _inferWhereNumberRange: ArticleWhere_Infer = {
	views: { gte: 100, lte: 500 },
};

// --- String field operators ---
const _inferWhereString: ArticleWhere_Infer = {
	title: { contains: "hello" },
};
const _inferWhereStringStart: ArticleWhere_Infer = {
	title: { startsWith: "Breaking" },
};

// --- FK direct value ---
const _inferWhereFK: ArticleWhere_Infer = { author: "some-uuid" };
const _inferWhereFKEq: ArticleWhere_Infer = { author: { eq: "some-uuid" } };

// ============================================================================
// BUG TEST: Comments Where — testing reverse nested
// ============================================================================

type CommentWhere_Infer = WhereType<typeof articleComments, TAppFromInfer>;
type CommentWhere_Manual = WhereType<typeof articleComments, TAppManual>;

// --- BelongsTo to article ---
const _inferCommentWhereArticle: CommentWhere_Infer = {
	article: { is: { title: { like: "%featured%" } } },
};
const _manualCommentWhereArticle: CommentWhere_Manual = {
	article: { is: { title: { like: "%featured%" } } },
};

// --- Nested: article → categories (manyToMany, 2 levels from comments) ---
const _inferCommentWhereArticleCat: CommentWhere_Infer = {
	article: {
		is: {
			categories: { some: { name: "Tech" } },
		},
	},
};

// --- Nested: article → author (2 levels from comments) ---
const _inferCommentWhereArticleAuthor: CommentWhere_Infer = {
	article: {
		is: {
			author: { is: { email: { endsWith: "@admin.com" } } },
		},
	},
};

// --- AND/OR at nested level ---
const _inferCommentWhereNestedLogic: CommentWhere_Infer = {
	AND: [
		{ content: { contains: "important" } },
		{
			article: {
				is: {
					OR: [{ views: { gt: 1000 } }, { published: { eq: true } }],
				},
			},
		},
	],
};

// ============================================================================
// BUG TEST: With clause — nested with options
// ============================================================================

type ArticleFindOpts_Infer = FindOptions<typeof articles, TAppFromInfer>;
type ArticleFindOpts_Manual = FindOptions<typeof articles, TAppManual>;

type ArticleWith_Infer = NonNullable<ArticleFindOpts_Infer["with"]>;
type ArticleWith_Manual = NonNullable<ArticleFindOpts_Manual["with"]>;

// --- Available relation keys ---
type _inferWithHasAuthor = Expect<
	Equal<HasKey<ArticleWith_Infer, "author">, true>
>;
type _inferWithHasComments = Expect<
	Equal<HasKey<ArticleWith_Infer, "comments">, true>
>;
type _inferWithHasCategories = Expect<
	Equal<HasKey<ArticleWith_Infer, "categories">, true>
>;

// --- Nested with: comments → author ---
const _inferWithNested: ArticleFindOpts_Infer = {
	with: {
		comments: {
			where: { content: { contains: "approved" } },
			with: {
				author: true,
			},
			limit: 10,
			orderBy: { createdAt: "desc" },
		},
	},
};

// --- ManyToMany with options ---
const _inferWithCatFiltered: ArticleFindOpts_Infer = {
	with: {
		categories: {
			where: { name: { contains: "tech" } },
			columns: { name: true, slug: true },
			limit: 5,
		},
	},
};

// --- All relations at once ---
const _inferWithAll: ArticleFindOpts_Infer = {
	with: {
		author: true,
		comments: {
			with: { author: true },
			limit: 20,
		},
		categories: true,
	},
};

// --- Inner with type for comments should have author and article ---
type CommentsWithOpts_Infer = Exclude<
	NonNullable<ArticleWith_Infer["comments"]>,
	boolean
>;
type CommentsInnerWith_Infer = NonNullable<CommentsWithOpts_Infer["with"]>;
type _inferInnerWithHasAuthor = Expect<
	Equal<HasKey<CommentsInnerWith_Infer, "author">, true>
>;
type _inferInnerWithHasArticle = Expect<
	Equal<HasKey<CommentsInnerWith_Infer, "article">, true>
>;

// ============================================================================
// BUG TEST: ApplyQuery — result type inference
// ============================================================================

type ARelations = CollectionRelationsFromApp<typeof articles, TAppManual>;
type ASelect = CollectionSelectFromApp<typeof articles, TAppManual>;

// --- Basic: no query → plain select ---
type ArticleBasicResult = ApplyQuery<ASelect, ARelations, undefined>;
type _basicHasId = Expect<Equal<HasKey<ArticleBasicResult, "id">, true>>;
type _basicHasTitle = Expect<Equal<HasKey<ArticleBasicResult, "title">, true>>;
type _basicHasAuthorFK = Expect<Equal<ArticleBasicResult["author"], string>>;

// --- With author: true → FK replaced by resolved author ---
type WithAuthorResult = ApplyQuery<
	ASelect,
	ARelations,
	{ with: { author: true } }
>;
type AuthorInResult = WithAuthorResult["author"];
type _authorResultHasName = Expect<Equal<HasKey<AuthorInResult, "name">, true>>;
type _authorResultHasEmail = Expect<
	Equal<HasKey<AuthorInResult, "email">, true>
>;
type _authorResultNameString = Expect<Equal<AuthorInResult["name"], string>>;
// FK string should be REPLACED by resolved object, not kept
type _authorResultNotString = Expect<
	Not<Equal<WithAuthorResult["author"], string>>
>;

// --- With comments: true → adds Comment[] ---
type WithCommentsResult = ApplyQuery<
	ASelect,
	ARelations,
	{ with: { comments: true } }
>;
type CommentsArr = WithCommentsResult["comments"];
type _commentsIsArray = Expect<
	Equal<CommentsArr extends any[] ? true : false, true>
>;
type CommentInResult = CommentsArr extends (infer U)[] ? U : never;
type _commentHasContent = Expect<
	Equal<HasKey<CommentInResult, "content">, true>
>;

// --- With categories: true → adds Category[] (manyToMany) ---
type WithCatsResult = ApplyQuery<
	ASelect,
	ARelations,
	{ with: { categories: true } }
>;
type CatsArr = WithCatsResult["categories"];
type _catsIsArray = Expect<Equal<CatsArr extends any[] ? true : false, true>>;
type CatInResult = CatsArr extends (infer U)[] ? U : never;
type _catHasName = Expect<Equal<HasKey<CatInResult, "name">, true>>;
type _catNameString = Expect<Equal<CatInResult["name"], string>>;

// --- Nested with: comments → author ---
type WithNestedResult = ApplyQuery<
	ASelect,
	ARelations,
	{ with: { comments: { with: { author: true } } } }
>;
type NestedCommentsArr = WithNestedResult["comments"];
type NestedComment = NestedCommentsArr extends (infer U)[] ? U : never;
type _nestedCommentHasContent = Expect<
	Equal<HasKey<NestedComment, "content">, true>
>;
type _nestedCommentHasAuthor = Expect<
	Equal<HasKey<NestedComment, "author">, true>
>;
type NestedCommentAuthor = NestedComment["author"];
type _nestedAuthorHasName = Expect<
	Equal<HasKey<NestedCommentAuthor, "name">, true>
>;
type _nestedAuthorNameString = Expect<
	Equal<NestedCommentAuthor["name"], string>
>;

// --- Columns selection ---
type WithColumnsResult = ApplyQuery<
	ASelect,
	ARelations,
	{ columns: { title: true; slug: true } }
>;
type _columnsHasTitle = Expect<Equal<HasKey<WithColumnsResult, "title">, true>>;
type _columnsHasSlug = Expect<Equal<HasKey<WithColumnsResult, "slug">, true>>;
type _columnsHasId = Expect<Equal<HasKey<WithColumnsResult, "id">, true>>; // id always

// --- Columns + With ---
type ColumnsWithResult = ApplyQuery<
	ASelect,
	ARelations,
	{ columns: { title: true; views: true }; with: { author: true } }
>;
type _colWithHasTitle = Expect<Equal<HasKey<ColumnsWithResult, "title">, true>>;
type _colWithHasViews = Expect<Equal<HasKey<ColumnsWithResult, "views">, true>>;
type _colWithHasAuthor = Expect<
	Equal<HasKey<ColumnsWithResult, "author">, true>
>;
type _colWithAuthorHasName = Expect<
	Equal<HasKey<ColumnsWithResult["author"], "name">, true>
>;

// --- Aggregation: _count ---
type AggCountResult = ApplyQuery<
	ASelect,
	ARelations,
	{ with: { comments: { _count: true } } }
>;
type CommentsAgg = AggCountResult["comments"];
type _aggCountHasCount = Expect<Equal<HasKey<CommentsAgg, "_count">, true>>;
type _aggCountIsNumber = Expect<Equal<CommentsAgg["_count"], number>>;

// ============================================================================
// BUG TEST: Negative type tests
// ============================================================================

type AWhere = WhereType<typeof articles, TAppManual>;

// Text field should NOT accept numeric operator gt
// @ts-expect-error - gt is not valid for text fields
const _badTitleGt: AWhere = { title: { gt: 100 } };

// Datetime field should NOT accept contains
const _badDateContains: AWhere = {
	// @ts-expect-error - contains is not valid for datetime fields
	publishedAt: { contains: "2024" },
};

// ============================================================================
// BUG TEST: Create Input types
// ============================================================================

type ArticleInsert = typeof articles.$infer.insert;
type ArticleCreateInput = CreateInput<ArticleInsert, ARelations>;

// --- Required fields ---
type ArticleCreateRequired = RequiredKeys<ArticleCreateInput>;
type _createTitleRequired = Expect<Extends<"title", ArticleCreateRequired>>;
type _createSlugRequired = Expect<Extends<"slug", ArticleCreateRequired>>;

// --- Fields with defaults should be optional ---
type ArticleCreateOptional = OptionalKeys<ArticleCreateInput>;
type _createViewsOptional = Expect<Extends<"views", ArticleCreateOptional>>;
type _createPublishedOptional = Expect<
	Extends<"published", ArticleCreateOptional>
>;
type _createIdOptional = Expect<Extends<"id", ArticleCreateOptional>>;

// --- FK for required belongsTo should be optional (can use nested mutation) ---
type _createAuthorFKOptional = Expect<Extends<"author", ArticleCreateOptional>>;

// --- Nullable fields should be optional ---
type _createContentOptional = Expect<Extends<"content", ArticleCreateOptional>>;
type _createRatingOptional = Expect<Extends<"rating", ArticleCreateOptional>>;

// ============================================================================
// BUG TEST: Update Input types
// ============================================================================

type ArticleUpdate = typeof articles.$infer.update;
type ArticleUpdateInput = UpdateInput<ArticleUpdate, ARelations>;

type ArticleUpdateOptional = OptionalKeys<ArticleUpdateInput>;
type _updateTitleOptional = Expect<Extends<"title", ArticleUpdateOptional>>;
type _updateSlugOptional = Expect<Extends<"slug", ArticleUpdateOptional>>;
type _updateAuthorOptional = Expect<Extends<"author", ArticleUpdateOptional>>;

// ============================================================================
// BUG TEST: Author Where — boolean operators
// ============================================================================

type AuthorWhere_Infer = WhereType<typeof authors, TAppFromInfer>;

const _inferAuthorActive: AuthorWhere_Infer = { active: { eq: true } };
const _inferAuthorInactive: AuthorWhere_Infer = { active: { eq: false } };
const _inferAuthorIsNull: AuthorWhere_Infer = { active: { isNull: false } };
const _inferAuthorIsNotNull: AuthorWhere_Infer = {
	active: { isNotNull: true },
};

// ============================================================================
// BUG TEST: Media Select — upload collection
// ============================================================================

type MediaSelect = CollectionSelectFromApp<typeof media, TAppManual>;
type _mediaHasKey = Expect<Equal<HasKey<MediaSelect, "key">, true>>;
type _mediaHasFilename = Expect<Equal<HasKey<MediaSelect, "filename">, true>>;
type _mediaKeyString = Expect<Equal<MediaSelect["key"], string>>;
type _mediaSizeNumber = Expect<Equal<MediaSelect["size"], number>>;
type _mediaAltNullable = Expect<Equal<MediaSelect["alt"], string | null>>;

// ============================================================================
// BUG TEST: Full query scenario with $inferApp
// ============================================================================

const _inferFullQuery: ArticleFindOpts_Infer = {
	where: {
		AND: [
			{ title: { contains: "typescript" } },
			{ views: { gte: 10 } },
			{ published: { eq: true } },
			{ categories: { some: { slug: "programming" } } },
			{ comments: { none: { content: { contains: "spam" } } } },
			{ author: { is: { active: { eq: true } } } },
		],
		NOT: {
			deletedAt: { isNotNull: true },
		},
	},
	columns: {
		id: true,
		title: true,
		slug: true,
		views: true,
		publishedAt: true,
	},
	with: {
		author: true,
		comments: {
			where: { content: { contains: "approved" } },
			with: { author: true },
			limit: 10,
			orderBy: { createdAt: "desc" },
		},
		categories: {
			columns: { name: true, slug: true },
		},
	},
	orderBy: { createdAt: "desc" },
	limit: 20,
	offset: 0,
	locale: "en",
	localeFallback: true,
	includeDeleted: false,
};

// ============================================================================
// BUG TEST: CRUD via $inferApp — the real API surface
// ============================================================================

type CmsApp = typeof testModule.$inferApp;
type ArticleCRUD = CmsApp["api"]["collections"]["articles"];

// --- find() returns PaginatedResult ---
type ArticleFindReturn = Awaited<ReturnType<ArticleCRUD["find"]>>;
type _findHasDocs = Expect<Equal<HasKey<ArticleFindReturn, "docs">, true>>;
type _findHasTotalDocs = Expect<
	Equal<HasKey<ArticleFindReturn, "totalDocs">, true>
>;

// --- findOne() returns record | null ---
type ArticleFindOneReturn = Awaited<ReturnType<ArticleCRUD["findOne"]>>;
type _findOneNullable = Expect<IsNullable<ArticleFindOneReturn>>;

// --- count() returns number ---
type ArticleCountReturn = Awaited<ReturnType<ArticleCRUD["count"]>>;
type _countIsNumber = Expect<Equal<ArticleCountReturn, number>>;

// --- deleteById() returns { success: boolean } ---
type ArticleDeleteReturn = Awaited<ReturnType<ArticleCRUD["deleteById"]>>;
type _deleteHasSuccess = Expect<
	Equal<HasKey<ArticleDeleteReturn, "success">, true>
>;

// ============================================================================
// Edge cases
// ============================================================================

// --- Empty where ---
const _emptyWhere: ArticleWhere_Infer = {};

// --- Nested NOT ---
const _whereNestedNot: ArticleWhere_Infer = {
	NOT: {
		AND: [{ title: { contains: "draft" } }, { published: false }],
	},
};

// --- Double NOT ---
const _whereDoubleNot: ArticleWhere_Infer = {
	NOT: {
		NOT: { title: "kept" },
	},
};

// --- Mixed AND + OR + NOT ---
const _whereMixedLogic: ArticleWhere_Infer = {
	AND: [
		{
			OR: [{ title: { startsWith: "A" } }, { title: { startsWith: "B" } }],
		},
		{
			NOT: { published: false },
		},
	],
	OR: [{ views: { gt: 100 } }, { categories: { some: { name: "Featured" } } }],
};
