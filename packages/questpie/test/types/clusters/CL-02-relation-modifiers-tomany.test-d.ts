/**
 * CL-02 — Relation modifiers (.hasMany/.manyToMany/.multiple) never transition
 *         the field type-state; to-many is mistyped as a single FK `string`.
 *
 * ROOT CAUSE (proposal §3 CL-02, findings WR-1..4 / json-1 / json-2 / GWR-2 /
 * wnl-1 / wnl-2): `FieldTypeMethodsWrapped` (field-with-methods.ts:109-117)
 * re-maps EVERY type-specific method to `(...args) => FieldWithMethods<TState,…>`
 * preserving the ORIGINAL `TState`, and `RelationFieldMethods.hasMany/manyToMany/
 * multiple` all declare `: any`. So `.hasMany()`/`.manyToMany()`/`.multiple()`
 * keep the belongsTo `RelationFieldState` (relationKind:"one", data:string,
 * virtual:false). The correct `ToManyRelationFieldState`/`MultipleRelationFieldState`
 * are dead at the type level. Consequences:
 *   - base SELECT leaks a phantom `string | null` for virtual to-many (WR-2/json-1);
 *   - `.multiple()` types as `string | null` not `string[] | null` (json-2);
 *   - `with`-population yields a single object, not an array (WR-1/GWR-2);
 *   - `where` is cardinality-blind: to-one offers quantifiers/`count`, to-many
 *     offers `is`/`isNot`/no-op `count` (wnl-1/wnl-2);
 *   - to-one `with` silently accepts limit/offset/orderBy/_count (WR-3).
 *
 * TARGET (after fix — most assertions FAIL to compile NOW; that is the burndown):
 *   - hasMany/manyToMany field-state ≡ ToManyRelationFieldState (relationKind:"many",
 *     virtual:true, data:string[]); multiple() ≡ MultipleRelationFieldState
 *     (relationKind:"one", data:string[], NOT virtual);
 *   - virtual to-many ABSENT from base select (top-level AND nested in f.object);
 *   - multiple() selects as `string[] | null`;
 *   - to-many `with`-population is an ARRAY whose element is a typed row;
 *   - to-one where: `is`/`isNot` + FK shorthand, NO quantifiers, NO `count`;
 *   - to-many where: `some`/`none`/`every`, NO `count`, NO `is`/`isNot`;
 *   - to-one `with`-options reject `limit`/`_count`; to-many accept them;
 *   - globals get this for free (siteGlobal.partners m2m), via the same path;
 *   - self-referential to-one stays single, self-ref hasMany transitions.
 *
 * CONSTRUCTION NOTES (from the fixtures' HARD RULE §4.1, verified against source):
 *   - Collection field-state is read via `Collections["X"]["state"]["fieldDefinitions"]`
 *     — `CollectionBuilder.state` is `readonly` (public), the `infer-first-map.test-d.ts:84`
 *     pattern. We use `Collections["X"]` (a type) rather than `typeof xConst` so the file
 *     needs only type imports.
 *   - GLOBAL field-state is NOT read that way: `GlobalBuilder.state` is `private`
 *     (global-builder.ts:66), so `Globals["site"]["state"]` is a TS2341 ERROR that would
 *     break compilation. The global cardinality + population is therefore probed through
 *     the EXPORTED structural helpers `GlobalRelations` / `ResolveRelationsDeep` /
 *     `GlobalSelectFromApp` (mirroring config/integrated/questpie-api.ts:115 and the
 *     GWR-2 repro). These collapse to the relation fallback today (so the assertions are
 *     RED), without erroring.
 *   - All relation/with/where probes route through the MANUAL `App` shape (the real
 *     2-arg-helper consumer); the `Questpie<…>` class instance does NOT resolve relations
 *     through `AppCollections` (documented limitation, crud-deep-typesafety.test-d.ts:214).
 *
 * @see .private/typesafety-fix-proposal-2026-06-15.md §3 CL-02
 * @see modules/core/fields/relation.ts:46-97 — the three target FieldStates.
 */

import type {
	ApplyQuery,
	CollectionRelationsFromApp,
	CollectionSelect,
	FindOptions,
	Where,
} from "#questpie/server/collection/crud/types.js";
import type { GlobalGetOptions } from "#questpie/server/global/crud/types.js";
import type { GlobalSelectFromApp } from "#questpie/server/global/crud/types.js";
import type {
	MultipleRelationFieldState,
	RelationFieldState,
	ToManyRelationFieldState,
} from "#questpie/server/modules/core/fields/relation.js";
import type {
	ExtractRelationSelect,
	GlobalRelations,
	ResolveRelationsDeep,
} from "#questpie/shared/type-utils.js";

import type {
	Equal,
	ExactType,
	Expect,
	ExpectArray,
	ExpectNotArray,
	Extends,
	HasKey,
	IsArrayType,
	NoAny,
	NoNever,
	NoUnknown,
	Not,
	NotEmptyObject,
	UnionHasKey,
} from "../_assert.js";
import type { App, Collections, Globals } from "../_fixtures.js";

// ============================================================================
// SECTION 1 — Field-level state identity (the keystone).
//
// `.hasMany()`/`.manyToMany()`/`.multiple()` MUST transition the stored
// `FieldWithMethods<…>['_']` state. Reading the configured field straight off
// the (public) collection builder state is the most direct probe: no resolver,
// no app, no cardinality-blind downstream type. All FAIL today (state is still
// the belongsTo `RelationFieldState`).
// ============================================================================

type ArticleFields = Collections["articles"]["state"]["fieldDefinitions"];

// --- hasMany: articles.comments → ToManyRelationFieldState<"article_comments"> ---
type CommentsState = ArticleFields["comments"]["_"];
type _commentsKindMany = Expect<Equal<CommentsState["relationKind"], "many">>;
type _commentsVirtualTrue = Expect<Equal<CommentsState["virtual"], true>>;
type _commentsDataArray = Expect<Equal<CommentsState["data"], string[]>>;
// Full state identity — guards every member at once.
type _commentsStateExact = ExactType<
	CommentsState,
	ToManyRelationFieldState<"article_comments">
>;

// --- manyToMany: articles.categories → ToManyRelationFieldState<"categories"> ---
type CategoriesState = ArticleFields["categories"]["_"];
type _categoriesKindMany = Expect<Equal<CategoriesState["relationKind"], "many">>;
type _categoriesVirtualTrue = Expect<Equal<CategoriesState["virtual"], true>>;
type _categoriesDataArray = Expect<Equal<CategoriesState["data"], string[]>>;
type _categoriesStateExact = ExactType<
	CategoriesState,
	ToManyRelationFieldState<"categories">
>;

// --- multiple: articles.gallery → MultipleRelationFieldState<"media"> ---
// NOTE: multiple() is NOT virtual (it owns a real jsonb column), relationKind
// stays "one", but data becomes string[]. Distinct target state from to-many.
type GalleryState = ArticleFields["gallery"]["_"];
type _galleryDataArray = Expect<Equal<GalleryState["data"], string[]>>;
type _galleryKindOne = Expect<Equal<GalleryState["relationKind"], "one">>;
type _galleryStateExact = ExactType<
	GalleryState,
	MultipleRelationFieldState<"media">
>;

// --- Negative control: a genuine to-one stays the belongsTo state ---
// `articles.author` (.required().relationName()) must remain RelationFieldState:
// relationKind "one", data string. These PASS now and must KEEP passing — they
// prove the fix transitions only the modifier methods, not every relation, and
// that the state-preserving modifiers (relationName) do not reset the kind.
type AuthorState = ArticleFields["author"]["_"];
type _authorKindOne = Expect<Equal<AuthorState["relationKind"], "one">>;
type _authorDataString = Expect<Equal<AuthorState["data"], string>>;

// --- Chain-order guard (the two-param `RelationFieldMethods` fix, proposal STEP 2) ---
// articles.comments is `.hasMany({…, relationName})` — i.e. a to-many transition
// carrying a relationName in-config. categories.children is `.hasMany({ foreignKey,
// relationName })`. Both resulting states must STILL be to-many (the modifier must
// not reset relationKind back to "one"). categories.children is the explicit guard.
type ChildrenState =
	Collections["categories"]["state"]["fieldDefinitions"]["children"]["_"];
type _childrenKindMany = Expect<Equal<ChildrenState["relationKind"], "many">>;
type _childrenDataArray = Expect<Equal<ChildrenState["data"], string[]>>;
type _childrenStateExact = ExactType<
	ChildrenState,
	ToManyRelationFieldState<"categories">
>;

// --- Self-referential to-one stays single (categories.parent, tickets.parent) ---
type ParentState =
	Collections["categories"]["state"]["fieldDefinitions"]["parent"]["_"];
type _parentKindOne = Expect<Equal<ParentState["relationKind"], "one">>;
type _parentDataString = Expect<Equal<ParentState["data"], string>>;
type TicketParentState =
	Collections["tickets"]["state"]["fieldDefinitions"]["parent"]["_"];
type _ticketParentKindOne = Expect<
	Equal<TicketParentState["relationKind"], "one">
>;

// ============================================================================
// SECTION 2 — Base SELECT: virtual to-many must be ABSENT; multiple() = string[].
//
// (WR-2 / json-1 / json-2.) A virtual to-many (hasMany/manyToMany) has no FK
// column on this table, so V2FieldSelect must drop it to `never` (filtered out
// → key absent). multiple() owns a jsonb array column → `string[] | null`.
// Today both leak `string | null`.
// ============================================================================

type ArticleSel = CollectionSelect<Collections["articles"], App>;

// hasMany / manyToMany — virtual, no column → key must be ABSENT from base row.
type _commentsAbsent = Expect<Equal<HasKey<ArticleSel, "comments">, false>>;
type _categoriesAbsent = Expect<Equal<HasKey<ArticleSel, "categories">, false>>;

// multiple() — owns a column → present, and is `string[] | null` (NOT `string | null`).
type _galleryPresent = Expect<Equal<HasKey<ArticleSel, "gallery">, true>>;
type _gallerySelectArray = Expect<Equal<ArticleSel["gallery"], string[] | null>>;

// to-one belongsTo keeps its FK column as `string` (negative control — PASSES now).
type _authorFkString = Expect<Equal<ArticleSel["author"], string>>;

// self-ref: categories.children (hasMany) absent; categories.parent (to-one) present.
type CategorySel = CollectionSelect<Collections["categories"], App>;
type _childrenAbsent = Expect<Equal<HasKey<CategorySel, "children">, false>>;
type _catParentPresent = Expect<Equal<HasKey<CategorySel, "parent">, true>>;
type _catParentString = Expect<Equal<CategorySel["parent"], string | null>>;

// --- Nested in f.object (json-1/json-2): the object-shaping path must honor the
// same cardinality. articles.meta is an f.object with NO relation fields, so its
// keys are exactly the scalar/object members — a relation leak would add phantom
// keys. (The fixtures carry no relation-in-object; this guards the negative side
// — no phantom relation key bleeds into a stored object.) ---
type MetaSel = NonNullable<ArticleSel["meta"]>;
type _metaNotEmpty = Expect<NotEmptyObject<MetaSel>>;
type _metaNoCommentsLeak = Expect<Equal<HasKey<MetaSel, "comments">, false>>;
type _metaNoGalleryLeak = Expect<Equal<HasKey<MetaSel, "gallery">, false>>;
type _metaHasSeoTitle = Expect<HasKey<MetaSel, "seoTitle">>;

// ============================================================================
// SECTION 3 — `with`-population is an ARRAY for to-many (WR-1 / GWR-2).
//
// Resolve relations via the app-aware path and apply a `{ with: { rel: true } }`
// query. To-many must populate as `Elem[]`; to-one stays a single object.
// ============================================================================

type ArticleRelations = CollectionRelationsFromApp<Collections["articles"], App>;
type ArticleSelForApply = CollectionSelect<Collections["articles"], App>;

// --- hasMany comments → array of comment rows ---
type WithComments = ApplyQuery<
	ArticleSelForApply,
	ArticleRelations,
	{ with: { comments: true } }
>;
type CommentsPop = WithComments["comments"];
type _commentsPopArray = Expect<ExpectArray<CommentsPop>>;
type CommentElem = NonNullable<CommentsPop> extends readonly (infer E)[]
	? E
	: never;
type _commentElemHasContent = Expect<HasKey<CommentElem, "content">>;
type _commentElemNoAny = Expect<NoAny<CommentElem>>;
type _commentElemNoUnknown = Expect<NoUnknown<CommentElem>>;
type _commentElemNoNever = Expect<NoNever<CommentElem>>;

// --- manyToMany categories → array of category rows ---
type WithCategories = ApplyQuery<
	ArticleSelForApply,
	ArticleRelations,
	{ with: { categories: true } }
>;
type CategoriesPop = WithCategories["categories"];
type _categoriesPopArray = Expect<ExpectArray<CategoriesPop>>;
type CategoryElem = NonNullable<CategoriesPop> extends readonly (infer E)[]
	? E
	: never;
type _categoryElemHasName = Expect<HasKey<CategoryElem, "name">>;
type _categoryElemNameString = Expect<Equal<CategoryElem["name"], string>>;

// --- multiple gallery → array of media rows when populated (it is a relation too). ---
type WithGallery = ApplyQuery<
	ArticleSelForApply,
	ArticleRelations,
	{ with: { gallery: true } }
>;
type _galleryPopArray = Expect<ExpectArray<WithGallery["gallery"]>>;

// --- to-one author → single object (NOT an array): negative control, PASSES now. ---
type WithAuthor = ApplyQuery<
	ArticleSelForApply,
	ArticleRelations,
	{ with: { author: true } }
>;
type _authorPopNotArray = Expect<ExpectNotArray<WithAuthor["author"]>>;
type _authorPopHasName = Expect<HasKey<NonNullable<WithAuthor["author"]>, "name">>;

// --- Nested to-many: comments → author (depth 2), comments still an array. ---
type WithNestedComments = ApplyQuery<
	ArticleSelForApply,
	ArticleRelations,
	{ with: { comments: { with: { author: true } } } }
>;
type _nestedCommentsArray = Expect<ExpectArray<WithNestedComments["comments"]>>;
type NestedCommentElem =
	NonNullable<WithNestedComments["comments"]> extends readonly (infer E)[]
		? E
		: never;
type _nestedCommentHasAuthor = Expect<HasKey<NestedCommentElem, "author">>;

// ============================================================================
// SECTION 4 — WHERE cardinality (wnl-1 / wnl-2).
//
// to-one  → `is` / `isNot` + FK shorthand; NO `some`/`none`/`every`; NO `count`.
// to-many → `some` / `none` / `every`; NO `is`/`isNot`; NO `count` (the no-op
//           must be removed from the to-many where + toManyOps per STEP 4).
// The relation where arrives as a union (FK shorthand | operator object); the
// union-aware `UnionHasKey` answers "does THIS member carry K". A to-many whose
// quantifiers were removed would FAIL `_commentsWhereSome`; a to-one that still
// offered quantifiers would FAIL `_authorWhereNoSome`.
// ============================================================================

type ArticleWhere = Where<Collections["articles"], App>;

// --- to-many (hasMany) comments: quantifiers present, no `is`, no `count`. ---
type CommentsWhere = NonNullable<ArticleWhere["comments"]>;
type _commentsWhereSome = Expect<UnionHasKey<CommentsWhere, "some">>;
type _commentsWhereNone = Expect<UnionHasKey<CommentsWhere, "none">>;
type _commentsWhereEvery = Expect<UnionHasKey<CommentsWhere, "every">>;
type _commentsWhereNoIs = Expect<Not<UnionHasKey<CommentsWhere, "is">>>;
type _commentsWhereNoIsNot = Expect<Not<UnionHasKey<CommentsWhere, "isNot">>>;
type _commentsWhereNoCount = Expect<Not<UnionHasKey<CommentsWhere, "count">>>;

// --- to-many (manyToMany) categories: same quantifier contract. ---
type CategoriesWhere = NonNullable<ArticleWhere["categories"]>;
type _catWhereSome = Expect<UnionHasKey<CategoriesWhere, "some">>;
type _catWhereEvery = Expect<UnionHasKey<CategoriesWhere, "every">>;
type _catWhereNoIs = Expect<Not<UnionHasKey<CategoriesWhere, "is">>>;
type _catWhereNoCount = Expect<Not<UnionHasKey<CategoriesWhere, "count">>>;

// --- to-one author: `is`/`isNot` present, NO quantifiers, NO `count`. ---
// The to-one where is a 3-member union: bare FK `string` shorthand
// (`author: "id"`), the belongsToOps operator object (carrying `is`/`isNot`),
// and the bare target-where shorthand (`author: { name: … }`). All three are
// load-bearing (locked by CL-07 + crud-deep-typesafety + unified-api-types).
// `is`/`isNot` live ONLY on the operator-object member, so a plain distributive
// `UnionHasKey` collapses to `boolean`. The contract is "the union OFFERS the
// key" — i.e. at least one member carries it — which is exactly `true` being a
// possible result: `Extends<true, UnionHasKey<…>>`.
type AuthorWhere = NonNullable<ArticleWhere["author"]>;
type _authorWhereIs = Expect<Extends<true, UnionHasKey<AuthorWhere, "is">>>;
type _authorWhereIsNot = Expect<Extends<true, UnionHasKey<AuthorWhere, "isNot">>>;
type _authorWhereNoSome = Expect<Not<UnionHasKey<AuthorWhere, "some">>>;
type _authorWhereNoNone = Expect<Not<UnionHasKey<AuthorWhere, "none">>>;
type _authorWhereNoEvery = Expect<Not<UnionHasKey<AuthorWhere, "every">>>;
type _authorWhereNoCount = Expect<Not<UnionHasKey<AuthorWhere, "count">>>;

// --- Runtime-surface where probes (mirror existing crud-deep-typesafety style). ---
// Each @ts-expect-error is paired with a POSITIVE companion so an unrelated
// failure on the same line cannot silently mask the guarantee (kit rule 4).

// POSITIVE: to-many quantifier accepted.
const _whereCommentsSome: ArticleWhere = {
	comments: { some: { content: { contains: "great" } } },
};
void _whereCommentsSome;
// POSITIVE: to-one `is` accepted.
const _whereAuthorIs: ArticleWhere = {
	author: { is: { name: { contains: "Jane" } } },
};
void _whereAuthorIs;

// NEGATIVE (wnl-1): `some` is meaningless on a to-one relation. The value is an
// empty object so the ONLY thing that can error is the `some` key itself (no
// incidental value-shape error can "consume" the directive — kit rule 4).
const _whereAuthorSome: ArticleWhere = {
	// @ts-expect-error — to-one author must NOT accept the to-many quantifier `some`
	author: { some: {} },
};
void _whereAuthorSome;
// NEGATIVE (wnl-2): no-op `count` must be gone from the to-many where.
const _whereCommentsCount: ArticleWhere = {
	// @ts-expect-error — `count` is a removed no-op on a to-many where
	comments: { count: 3 },
};
void _whereCommentsCount;
// NEGATIVE (wnl-2): `count` must never appear on a to-one where either.
const _whereAuthorCount: ArticleWhere = {
	// @ts-expect-error — `count` is meaningless on a to-one where
	author: { count: 3 },
};
void _whereAuthorCount;

// ============================================================================
// SECTION 5 — `with`-options cardinality strictness (WR-3).
//
// to-one author: limit/offset/orderBy/_count are meaningless → must be rejected.
// to-many comments: those options are valid → must be accepted, and a `_count`
// on a to-many carries through to the populated result.
// ============================================================================

type ArticleFindOpts = FindOptions<Collections["articles"], App>;

// POSITIVE: to-many comments accepts where + limit + _count.
const _withCommentsOpts: ArticleFindOpts = {
	with: {
		comments: { where: { content: { contains: "x" } }, limit: 10, _count: true },
	},
};
void _withCommentsOpts;
// POSITIVE: to-one author plain boolean + columns.
const _withAuthorBool: ArticleFindOpts = {
	with: { author: { columns: { name: true } } },
};
void _withAuthorBool;

// NEGATIVE (WR-3): limit is meaningless on a to-one relation.
const _withAuthorLimit: ArticleFindOpts = {
	// @ts-expect-error — to-one author must NOT accept `limit`
	with: { author: { limit: 10 } },
};
void _withAuthorLimit;
// NEGATIVE (WR-3): _count is meaningless on a to-one relation.
const _withAuthorCount: ArticleFindOpts = {
	// @ts-expect-error — to-one author must NOT accept `_count`
	with: { author: { _count: true } },
};
void _withAuthorCount;

// --- to-many `_count` carries through to the populated result type. ---
type WithCommentsCount = ApplyQuery<
	ArticleSelForApply,
	ArticleRelations,
	{ with: { comments: { _count: true } } }
>;
type CommentsCountPop = WithCommentsCount["comments"];
type _commentsCountHasCount = Expect<UnionHasKey<CommentsCountPop, "_count">>;

// ============================================================================
// SECTION 6 — Globals get this for free (GWR-2).
//
// siteGlobal.partners is a manyToMany global relation; it routes through the
// IDENTICAL InferRelationsFromFieldDefs → ResolveRelationsDeep pipeline used by
// config/integrated/questpie-api.ts:115. Probed through the EXPORTED structural
// helpers (NOT `Globals["site"]["state"]`, which would TS2341-error on the
// private `state`). All currently RED for two reasons (private state → relation
// fallback AND no state transition); the targets are encoded regardless.
//
// Non-vacuity guard: `GlobalRelations` must surface the `partners`/`owner` keys
// (not collapse to a bare index signature) before the cardinality assertions can
// be meaningful — asserted first.
// ============================================================================

type SiteRelConfigs = GlobalRelations<Globals["site"]>;
type _siteRelHasPartners = Expect<HasKey<SiteRelConfigs, "partners">>;
type _siteRelHasOwner = Expect<HasKey<SiteRelConfigs, "owner">>;

// --- Global relation-config cardinality: m2m partners → type "many", owner "one". ---
type PartnersCfg = SiteRelConfigs["partners"];
type OwnerCfg = SiteRelConfigs["owner"];
type _partnersCfgMany = Expect<
	Equal<PartnersCfg extends { type: infer T } ? T : never, "many">
>;
type _ownerCfgOne = Expect<
	Equal<OwnerCfg extends { type: infer T } ? T : never, "one">
>;

// --- Global m2m `with`-population (resolved exactly as questpie-api.ts:115) → array. ---
// `ResolveRelationsDeep` yields the SAME `RelationShape`-wrapper map as the
// collection path (`CollectionRelationsFromApp`): a `{ partners: Wrapper[],
// owner: Wrapper }` registry that `ApplyQuery`/`GlobalGetOptions` flatten via
// `ExtractRelationSelect` (questpie-api.ts:115 → GlobalCRUD → ApplyQuery). The
// populated ROW is therefore `ExtractRelationSelect<Wrapper>` — reading the
// wrapper directly would expose `__select`/`__relations`, not the row. We probe
// the flattened select exactly as the consumer does.
type SiteRelations = ResolveRelationsDeep<SiteRelConfigs, Collections>;
type PartnersPop = SiteRelations["partners"];
type _partnersPopArray = Expect<ExpectArray<PartnersPop>>;
type PartnerElem = ExtractRelationSelect<
	NonNullable<PartnersPop> extends readonly (infer E)[] ? E : never
>;
type _partnerElemHasName = Expect<HasKey<PartnerElem, "name">>;
type _partnerElemNoAny = Expect<NoAny<PartnerElem>>;

// --- Global to-one owner → single object (negative control). ---
type OwnerPop = SiteRelations["owner"];
type _ownerPopNotArray = Expect<ExpectNotArray<OwnerPop>>;
type _ownerPopHasName = Expect<
	HasKey<ExtractRelationSelect<NonNullable<OwnerPop>>, "name">
>;

// --- Global base SELECT drops the virtual to-many `partners`; to-one `owner` stays. ---
type SiteDoc = GlobalSelectFromApp<Globals["site"], App>;
type _sitePartnersAbsent = Expect<Equal<HasKey<SiteDoc, "partners">, false>>;
type _siteOwnerPresent = Expect<Equal<HasKey<SiteDoc, "owner">, true>>;

// --- Global with-options strictness: to-one `owner` rejects `limit`; to-many accepts. ---
type SiteGetWith = NonNullable<
	GlobalGetOptions<SiteDoc, SiteRelations>["with"]
>;
// POSITIVE companion: to-one accepts columns; to-many accepts limit/_count.
const _gWithOwnerCols: SiteGetWith = { owner: { columns: { name: true } } };
void _gWithOwnerCols;
const _gWithPartnersLimit: SiteGetWith = {
	partners: { limit: 10, _count: true },
};
void _gWithPartnersLimit;
const _gWithOwnerLimit: SiteGetWith = {
	// @ts-expect-error — `limit` is meaningless on a global to-one relation (WR-3)
	owner: { limit: 10 },
};
void _gWithOwnerLimit;

// ============================================================================
// SECTION 7 — Cross-cardinality identity: the three relation states are DISTINCT.
//
// These nail that the fix does not collapse all relations to one shape — to-many,
// multiple(), and belongsTo each have a different state. They compile regardless
// of the leak (they assert the target states' mutual distinctness) and pin the
// invariant the field-state transition must preserve.
// ============================================================================

// hasMany state must DIFFER from the belongsTo base state.
type _commentsNotBelongsTo = Expect<
	Not<Equal<CommentsState, RelationFieldState<"article_comments">>>
>;
// multiple() (data: string[], kind "one") must DIFFER from to-many (kind "many", virtual).
type _multipleNotToMany = Expect<
	Not<
		Equal<MultipleRelationFieldState<"media">, ToManyRelationFieldState<"media">>
	>
>;
// multiple() (array data) must DIFFER from belongsTo (single FK).
type _multipleNotBelongsTo = Expect<
	Not<Equal<MultipleRelationFieldState<"media">, RelationFieldState<"media">>>
>;
// to-many target carries virtual:true; belongsTo carries virtual:false — a one-shot
// sanity anchor that the dropped-from-select signal (virtual) actually differs.
type _toManyVirtualAnchor = Expect<
	Equal<ToManyRelationFieldState["virtual"], true>
>;
type _belongsToVirtualAnchor = Expect<Equal<RelationFieldState["virtual"], false>>;

// Unused-import / array-helper touch so every imported symbol is referenced even
// if a future edit drops a section (keeps the file honest under noUnusedLocals).
type _isArrayHelperTouch = Expect<Equal<IsArrayType<string[]>, true>>;
