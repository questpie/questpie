/**
 * CL-14 — Duplicated relation recursion-breakers; mismatched depth caps;
 *         `GetCollection` → never.
 *
 * GOAL-TEST FILE (Phase 3a). Encodes the CORRECT (post-fix) target types for
 * the whole CL-14 class. MOST ASSERTIONS FAIL TO COMPILE NOW — that is the
 * intended burndown. Phase 3b edits source to flip them green.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ROOT CAUSE (proposal §CL-14, findings cyc-2 / cyc-7 / DIST-003):
 *
 *   Two parallel relation cycle-breakers were never unified:
 *     • `ResolveRelationsDeepFromApp` — app-aware, default Depth `[1,1,1]`
 *       (crud/types.ts:420). Server COLLECTIONS use this (depth-3).
 *     • `ResolveRelationsDeep`        — NOT app-aware, default Depth `[1,1,1,1,1]`
 *       (shared/type-utils.ts:483). GLOBALS + ALL client/tanstack use this
 *       (depth-5, and it DROPS `TApp` — so relation-target rows lose the
 *       field-definition-aware select: json/object/select/blocks degrade).
 *
 *   Consequences:
 *     - cyc-7: collection cap (3) ≠ global cap (5) — a silent, undocumented
 *       split with two different exhaustion behaviors.
 *     - cyc-2: the leaf relation at the exhausted boundary degrades (the
 *       surviving base-select FK column survives via `WithKeys`).
 *     - DIST-003: `GetCollection<App['collections'], K>` is handed the CRUD-API
 *       map (`CollectionAPI` objects), NOT the raw definitions map, so it fails
 *       its `Record<string, AnyCollectionOrBuilder>` constraint and yields
 *       `never`.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * AUTHORITATIVE FIX (proposal §CL-14 — reviewer overrides win; STEP C DROPPED):
 *
 *   STEP A (unify): the app-aware resolver becomes the single source of truth;
 *     the shared duplicate is deleted; globals + client re-point onto it (add
 *     `GlobalRelationsFromApp`; switch questpie-api.ts:115). → globals + client
 *     get field-definition-aware select inside `with` (the parity win).
 *   STEP B (single depth policy): ONE exported depth constant; converge the cap
 *     DOWN to the current server value `[1,1,1]` (globals/client drop 5→3).
 *   STEP D (GetCollection/DIST-003): do NOT loosen the constraint. The mismatch
 *     stays a BARE `never` (loud — a branded object would break its own
 *     `IsNever` test). Consumers redirect to `GetCollection<AppCollections, K>`
 *     / `CollectionDoc<…>` (the raw-definitions map).
 *   STEP C — DROPPED. The two sentinels are byte-identical (`Depth extends []
 *     ? never`) and the boundary is already loud; no branded marker.
 *
 *   Therefore the post-fix invariants this file asserts:
 *     1. Depth parity — collection cap == self-relating-global cap.
 *     2. Globals field-def parity on a relation TARGET — a json/object/select
 *        field on a relation-loaded target resolves IDENTICALLY whether reached
 *        through the global (shared) resolver or the collection (app-aware) one.
 *     3. Shallow case unchanged — depths 1..3 fully loaded (objects, not FK
 *        strings / never); guards the fix against lowering the cap below 3.
 *     4. Same sentinel across resolvers — both exhaust to bare `never`.
 *     5. DIST-003 — `GetCollection(QuestpieApp['collections'])` is LOUD
 *        (constraint error + `never`); the raw-map path is HEALTHY.
 *
 * @see .private/typesafety-fix-proposal-2026-06-15.md §CL-14
 * @see crud-deep-typesafety.test-d.ts — the ApplyQuery construction pattern.
 */

import type {
	ApplyQuery,
	CollectionRelationsFromApp,
	CollectionSelect as CollectionSelectFromApp,
} from "#questpie/server/collection/crud/types.js";
import type {
	CollectionDoc,
	CollectionRelations,
	ExtractRelationRelations,
	ExtractRelationSelect,
	GetCollection,
	GlobalRelations,
	ResolveRelationsDeep,
} from "#questpie/shared/type-utils.js";

import type {
	Equal,
	Expect,
	HasKey,
	IsNever,
	NoNever,
	NotEmptyObject,
} from "../_assert.js";
import type {
	App,
	articleComments,
	articles,
	categories,
	Collections,
	QuestpieApp,
	siteGlobal,
	treeGlobal,
} from "../_fixtures.js";

// ============================================================================
// §0 — Local drill helpers (NOT fixtures; pure type-level projections over the
// imported fixture symbols + the two resolver families under test).
//
// `RowOf`/`NextOf` mirror how `RelationResult` reads a `RelationShape`: they
// drill one `with` level by reading the shape's `__select` (the loaded row) and
// `__relations` (the next level's relation map), exactly as the CRUD result
// types do. We never construct collections here.
// ============================================================================

/** The loaded row of a resolved relation slot (the `__select` of its shape). */
type RowOf<TShape> = ExtractRelationSelect<TShape>;
/** The next-level relation map of a resolved relation slot. */
type NextOf<TShape> = ExtractRelationRelations<TShape>;

// --- COLLECTION path (app-aware: CollectionRelationsFromApp, default [1,1,1]) ---
//
// Each `CatParentLn_Col` is the relation SHAPE for `parent` at nesting level n.
// `NextOf<shape>` is that shape's `__relations` MAP (the next level's relations);
// `RowOf<shape>` is its loaded `__select` row. The EXHAUSTION SENTINEL is
// `NextOf<deepestShape>` — it becomes a bare `never` only when the shape was
// created at the empty Depth `[]` (one level BELOW the populated `[]`-Depth map).
type CatRelsCol = CollectionRelationsFromApp<typeof categories, App>;
type CatParentL1_Col = CatRelsCol["parent"]; // shape @ Depth [1,1,1]
type CatParentL2_Col = NextOf<CatParentL1_Col>["parent"]; // shape @ Depth [1,1]
type CatParentL3_Col = NextOf<CatParentL2_Col>["parent"]; // shape @ Depth [1]
type CatParentL4_Col = NextOf<CatParentL3_Col>["parent"]; // shape @ Depth [] → __relations = never
type CatRowL1_Col = RowOf<CatParentL1_Col>;
type CatRowL2_Col = RowOf<CatParentL2_Col>;
type CatRowL3_Col = RowOf<CatParentL3_Col>;

// --- GLOBAL/legacy path (shared, NOT app-aware: ResolveRelationsDeep, [1,1,1,1,1]) ---
// This is precisely what GlobalAPI runs (questpie-api.ts:115) for ANY relation
// map: ResolveRelationsDeep<GlobalRelations<…>, Collections>. It resolves a
// RelationConfig map against the collections map with NO TApp, capping at 5.
type CatRelsGlobalStyle = ResolveRelationsDeep<
	CollectionRelations<typeof categories>,
	Collections
>;
type CatParentL1_Glob = CatRelsGlobalStyle["parent"]; // shape @ Depth [1,1,1,1,1]
type CatParentL2_Glob = NextOf<CatParentL1_Glob>["parent"]; // @ [1,1,1,1]
type CatParentL3_Glob = NextOf<CatParentL2_Glob>["parent"]; // @ [1,1,1]
type CatParentL4_Glob = NextOf<CatParentL3_Glob>["parent"]; // @ [1,1]
type CatParentL5_Glob = NextOf<CatParentL4_Glob>["parent"]; // @ [1]
type CatParentL6_Glob = NextOf<CatParentL5_Glob>["parent"]; // @ [] → __relations = never

// ============================================================================
// §1 — DEPTH PARITY (proposal regression test #1; finding cyc-7).
//
// TARGET: the collection cap and the self-relating-global cap are the SAME N.
// NOW: collections exhaust at level 4 (Depth `[1,1,1]`) while the global/legacy
// resolver keeps resolving through level 6 (Depth `[1,1,1,1,1]`). The post-fix
// invariant is "both exhaust at the SAME level (the converged `[1,1,1]`)", so
// these comparisons FAIL NOW and hold after STEP A/B converge globals DOWN.
//
// The exhaustion sentinel is read as `NextOf<the level-4 shape>` — bare `never`
// for collections today, still a LIVE map for the global resolver today.
// ============================================================================

// Collection sentinel: the level-4 shape's relations are exhausted to `never`
// today (shape created at empty Depth). Holds now AND must stay post-fix.
type ColSentinel = NextOf<CatParentL4_Col>;
type _collectionCappedAt3 = Expect<IsNever<ColSentinel>>;

// Global sentinel AT THE SAME LEVEL (level 4): post-convergence the global
// resolver must ALSO be exhausted here. NOW it is still a populated relations
// map (cap 5, four more navigable levels) → `IsNever` FAILS now, holds post-fix.
type GlobSentinelAtL4 = NextOf<CatParentL4_Glob>;
type _globalCappedAt3_L4 = Expect<IsNever<GlobSentinelAtL4>>;

// PARITY: the two resolvers reach the SAME state at level 4. NOW: `never`
// (collection) vs a live map (global) → NOT equal. Post-fix → both `never`.
type _depthParityL4 = Expect<Equal<ColSentinel, GlobSentinelAtL4>>;

// And there is NO navigable level beyond the unified cap on the global side:
// level-5 and level-6 parent shapes must NOT exist post-convergence. NOW both
// resolve (cap 5) → these FAIL now and hold post-fix. (Loud over-depth guard.)
type _globalNoLevel5 = Expect<IsNever<CatParentL5_Glob>>;
type _globalNoLevel6 = Expect<IsNever<CatParentL6_Glob>>;

// ============================================================================
// §2 — GLOBALS FIELD-DEF PARITY ON A RELATION TARGET
//      (proposal regression test #4 — the weakest-specified, MUST be
//       non-vacuous: assert a field type on a relation TARGET reached via the
//       global/legacy resolver equals the same field reached via the app-aware
//       collection resolver). Findings cyc-7 + STEP A.
//
// The divergence lives in the SELECTOR: GlobalAPI's relation resolution uses
// the 1-arg shared `CollectionSelect<T>` (Drizzle `$infer`-based, TApp-blind),
// while collections use the 2-arg app-aware `CollectionSelect<T, TApp>`
// (FieldSelect-based — knows json schema, object nesting, select unions).
//
// We reach a json/object/select-bearing target (`articles`) through a relation
// on `articleComments` (`article → articles`) on BOTH resolver families, and
// assert the loaded `articles` ROW is identical. NON-VACUOUS: `articles` has
// `body` (json), `meta` (object), `status` (select-union).
// ============================================================================

// article_comments.article → articles, resolved by each family at level 1.
type AcRels_Col = CollectionRelationsFromApp<typeof articleComments, App>;
type AcRels_Glob = ResolveRelationsDeep<
	CollectionRelations<typeof articleComments>,
	Collections
>;
type LoadedArticle_Col = RowOf<AcRels_Col["article"]>; // app-aware row
type LoadedArticle_Glob = RowOf<AcRels_Glob["article"]>; // TApp-blind row

// PARITY (whole row): the relation-target row must be identical across families.
// NOW the two selectors diverge on json/object/select → FAILS. Post-fix
// (STEP A: globals/client use the app-aware resolver) → equal.
type _relTargetRowParity = Expect<Equal<LoadedArticle_Glob, LoadedArticle_Col>>;

// PARITY (the field-level "rich" probes — these pin WHICH field degrades, so a
// future partial fix can't pass §2 vacuously):
type _relTargetBodyParity = Expect<
	Equal<LoadedArticle_Glob["body"], LoadedArticle_Col["body"]>
>;
type _relTargetMetaParity = Expect<
	Equal<LoadedArticle_Glob["meta"], LoadedArticle_Col["meta"]>
>;
type _relTargetStatusParity = Expect<
	Equal<LoadedArticle_Glob["status"], LoadedArticle_Col["status"]>
>;

// The CORRECT (app-aware) relation-target `status` is the PRECISE literal
// union, not a widened `string`. This anchors the §2 parity to the correct
// side, so the parity assertions above cannot be satisfied by degrading BOTH
// families to the same loose type. (The standalone 1-arg-vs-2-arg selector
// unification is CL-10's; CL-14's STEP A only re-points the RELATION resolver,
// so we assert on the relation-TARGET selector, the app-aware ground truth.)
type ArticleSelect_AppAware = CollectionSelectFromApp<typeof articles, App>;
type _appAwareStatusIsUnion = Expect<
	Equal<
		ArticleSelect_AppAware["status"],
		"draft" | "review" | "published" | null
	>
>;

// And the relation-target's `status`, reached via the GLOBAL/legacy resolver,
// must ALSO be that precise union post-fix. NOW it's the TApp-blind shape → FAILS.
type _relTargetGlobalStatusIsUnion = Expect<
	Equal<LoadedArticle_Glob["status"], "draft" | "review" | "published" | null>
>;

// Self-relating GLOBAL end-to-end (treeGlobal.root → categories), exercising the
// real `GlobalRelations` extractor through the resolver GlobalAPI uses today.
// The loaded `categories` row reached from the global must match the row reached
// from a collection that relates to categories (articleCategories.category, but
// categories has no rich field; we assert the relation map is at least populated
// + carries `name`, proving the global resolver did resolve a real target — a
// guard against the global path collapsing the target to `{}`/`never`).
type TreeRels_Glob = ResolveRelationsDeep<
	GlobalRelations<typeof treeGlobal>,
	Collections
>;
type TreeRootRow = RowOf<TreeRels_Glob["root"]>;
type _treeRootResolvesObject = Expect<NotEmptyObject<TreeRootRow>>;
type _treeRootHasName = Expect<Equal<HasKey<TreeRootRow, "name">, true>>;
type _treeRootNotNever = Expect<NoNever<TreeRootRow>>;

// siteGlobal.partners (global m2m → authors): the global-side loaded target must
// also be a populated object (parity guard; the to-many resolves to a shape[]).
type SiteRels_Glob = ResolveRelationsDeep<
	GlobalRelations<typeof siteGlobal>,
	Collections
>;
type SitePartnerArr = SiteRels_Glob["partners"];
type SitePartnerRow = SitePartnerArr extends readonly (infer S)[]
	? RowOf<S>
	: never;
type _sitePartnerResolvesObject = Expect<NotEmptyObject<SitePartnerRow>>;
type _sitePartnerHasName = Expect<Equal<HasKey<SitePartnerRow, "name">, true>>;

// ============================================================================
// §3 — SHALLOW CASE UNCHANGED (proposal regression test #2; finding cyc-2).
//
// TARGET: depths 1..3 are FULLY loaded — each level's relation-target row is a
// populated OBJECT (NOT the FK string, NOT `never`, NOT `{}`). A 3-level `with`
// compiles and yields nested objects. These guard the unified resolver against
// dropping the cap below the converged value (3). They PASS now AND post-fix.
// ============================================================================

// Level 1..3 loaded rows are populated objects with the self-ref shape.
type _l1IsObject = Expect<NotEmptyObject<CatRowL1_Col>>;
type _l1HasName = Expect<Equal<HasKey<CatRowL1_Col, "name">, true>>;
type _l1NameString = Expect<Equal<CatRowL1_Col["name"], string>>;

type _l2IsObject = Expect<NotEmptyObject<CatRowL2_Col>>;
type _l2HasName = Expect<Equal<HasKey<CatRowL2_Col, "name">, true>>;
type _l2NotNever = Expect<NoNever<CatRowL2_Col>>;

type _l3IsObject = Expect<NotEmptyObject<CatRowL3_Col>>;
type _l3HasName = Expect<Equal<HasKey<CatRowL3_Col, "name">, true>>;
type _l3NotNever = Expect<NoNever<CatRowL3_Col>>;

// End-to-end via the REAL CRUD return type (ApplyQuery), mirroring the existing
// crud-deep-typesafety pattern. A 3-level self-referential `with` must produce
// nested objects at every requested level. (Drilling done with HasKey, which is
// `never`-safe — a degraded FK-string leaf has no `name` key and FAILS loudly.)
type CatSelect = CollectionSelectFromApp<typeof categories, App>;
type CatRelations = CollectionRelationsFromApp<typeof categories, App>;
type Cat3DeepWith = ApplyQuery<
	CatSelect,
	CatRelations,
	{ with: { parent: { with: { parent: { with: { parent: true } } } } } }
>;
// L1 parent is an object with `name`.
type _w1HasParent = Expect<Equal<HasKey<Cat3DeepWith, "parent">, true>>;
type _w1ParentHasName = Expect<
	Equal<HasKey<Cat3DeepWith["parent"], "name">, true>
>;
// L2 parent (parent.parent) is an object with `name`.
type _w2ParentHasParent = Expect<
	Equal<HasKey<Cat3DeepWith["parent"], "parent">, true>
>;
type _w2ParentHasName = Expect<
	Equal<HasKey<Cat3DeepWith["parent"]["parent"], "name">, true>
>;
// L3 parent (parent.parent.parent) must be a populated object — the deepest
// requested level of a 3-level `with`, which loads fully at the converged cap
// `[1,1,1]`. FLOOR GUARD: holds now AND post-fix; FAILS only if a future change
// drops the cap below 3 (the cyc-2 degradation would then bite shallower).
type _w3ParentHasParent = Expect<
	Equal<HasKey<Cat3DeepWith["parent"]["parent"], "parent">, true>
>;
type _w3LeafHasName = Expect<
	Equal<HasKey<Cat3DeepWith["parent"]["parent"]["parent"], "name">, true>
>;
type _w3LeafNotString = Expect<
	Equal<Cat3DeepWith["parent"]["parent"]["parent"] extends string ? true : false, false>
>;
type _w3LeafNotNever = Expect<NoNever<Cat3DeepWith["parent"]["parent"]["parent"]>>;

// ============================================================================
// §4 — SAME SENTINEL ACROSS RESOLVERS (proposal regression test #3; STEP C
// dropped → both sentinels must remain byte-identical bare `never`).
//
// At the exhausted boundary BOTH resolver families set the relation map to a
// bare `never` (NOT a branded `__DepthExhausted` object). These pin "the
// sentinel is `never` and is the SAME on both sides" — guarding against STEP C
// accidentally being re-introduced (a branded object would break this).
// ============================================================================

// Each family's TRUE exhaustion sentinel (collection @ level 4, global @ its own
// boundary, level 6 today). Both are a bare `never` — these HOLD now and must
// stay (they guard against STEP C re-introducing a branded marker).
type GlobSentinel = NextOf<CatParentL6_Glob>;
type _colSentinelIsNever = Expect<IsNever<ColSentinel>>;
type _globSentinelIsNever = Expect<IsNever<GlobSentinel>>;

// Both families' exhaustion sentinel are the SAME type (bare `never`). Locks
// "one sentinel, not two divergent ones" (cyc-7's duplicated-breaker theme).
type _sentinelsEqual = Expect<Equal<ColSentinel, GlobSentinel>>;

// Neither sentinel is a branded object — a `{ __depthExhausted: … }` brand
// would give it a key and FAIL these. Encodes "STEP C stays DROPPED".
type _colSentinelNotBranded = Expect<
	Equal<HasKey<ColSentinel, "__depthExhausted">, false>
>;
type _globSentinelNotBranded = Expect<
	Equal<HasKey<GlobSentinel, "__depthExhausted">, false>
>;

// ============================================================================
// §5 — GetCollection / DIST-003 (proposal regression test #5; STEP D).
//
// `QuestpieApp['collections']` is the CRUD-API map (`{ [K]: CollectionAPI<…> }`)
// — NOT the raw definitions map. Feeding it to `GetCollection` is a category
// mismatch: it violates the `Record<string, AnyCollectionOrBuilder>` constraint
// (TS2344) AND yields `never`. TARGET: keep it LOUD (bare `never` + constraint
// error); redirect consumers to the raw-map path, which must stay HEALTHY.
// ============================================================================

// The CRUD-API map shape (what `app.collections` actually is at the type level).
type ApiMap = QuestpieApp["collections"];

// LOUD — part 1 (the constraint violation): handing the CollectionAPI map to
// `GetCollection` MUST be rejected (TS2344 — `ApiMap` is not
// `Record<string, AnyCollectionOrBuilder>`). STEP D keeps this constraint
// INTACT (does NOT loosen it). The directive must sit on the line IMMEDIATELY
// above the offending instantiation (no comment line between), and §4.1 wants a
// POSITIVE companion — supplied as `_apiMapNeverPositive` immediately below.
// @ts-expect-error — ApiMap is the CollectionAPI map, not the raw definitions map.
type ApiMapGetArticles = GetCollection<ApiMap, "articles">;

// LOUD — part 2 (the bare `never` result): the mismatch resolves to a bare
// `never` (NOT a branded object — a brand would break this very `IsNever`, the
// reason STEP D keeps it bare). `IsNever`, per §4.1, not `Equal<_, never>`.
// This holds NOW and must stay after the fix.
type _apiMapNeverPositive = Expect<IsNever<ApiMapGetArticles>>;

// HEALTHY (the supported path the fix redirects consumers to): the RAW
// definitions map (`Collections` — `{ [K]: typeof builder }`) satisfies the
// constraint and resolves to a real `Collection`. These must HOLD (no error).
type RawGetArticles = GetCollection<Collections, "articles">;
type _rawNotNever = Expect<NoNever<RawGetArticles>>;
// A real built Collection exposes its state — probe a stable structural key.
type _rawIsCollectionShape = Expect<Equal<HasKey<RawGetArticles, "state">, true>>;

// And `CollectionDoc` over the raw map yields the row (the documented redirect
// target): it must carry `id` + `title`, NOT collapse to `never`/`{}`.
type ArticleDoc = CollectionDoc<Collections, "articles">;
type _docNotNever = Expect<NoNever<ArticleDoc>>;
type _docNotEmpty = Expect<NotEmptyObject<ArticleDoc>>;
type _docHasId = Expect<Equal<HasKey<ArticleDoc, "id">, true>>;
type _docHasTitle = Expect<Equal<HasKey<ArticleDoc, "title">, true>>;

// ============================================================================
// §6 — Suppress "declared but never used" for the pure type-aliases above.
// Every `_*` assertion alias is referenced here so the file is self-contained
// and the ONLY diagnostics it can emit are the intended assertion failures.
// ============================================================================

export type _CL14_AssertionsTouched = [
	// §1 depth parity
	_depthParityL4,
	_globalCappedAt3_L4,
	_globalNoLevel5,
	_globalNoLevel6,
	_collectionCappedAt3,
	// §2 globals field-def parity on a relation target
	_relTargetRowParity,
	_relTargetBodyParity,
	_relTargetMetaParity,
	_relTargetStatusParity,
	_appAwareStatusIsUnion,
	_relTargetGlobalStatusIsUnion,
	_treeRootResolvesObject,
	_treeRootHasName,
	_treeRootNotNever,
	_sitePartnerResolvesObject,
	_sitePartnerHasName,
	// §3 shallow case unchanged
	_l1IsObject,
	_l1HasName,
	_l1NameString,
	_l2IsObject,
	_l2HasName,
	_l2NotNever,
	_l3IsObject,
	_l3HasName,
	_l3NotNever,
	_w1HasParent,
	_w1ParentHasName,
	_w2ParentHasParent,
	_w2ParentHasName,
	_w3ParentHasParent,
	_w3LeafHasName,
	_w3LeafNotString,
	_w3LeafNotNever,
	// §4 same sentinel
	_colSentinelIsNever,
	_globSentinelIsNever,
	_sentinelsEqual,
	_colSentinelNotBranded,
	_globSentinelNotBranded,
	// §5 GetCollection / DIST-003
	_apiMapNeverPositive,
	_rawNotNever,
	_rawIsCollectionShape,
	_docNotNever,
	_docNotEmpty,
	_docHasId,
	_docHasTitle,
];
