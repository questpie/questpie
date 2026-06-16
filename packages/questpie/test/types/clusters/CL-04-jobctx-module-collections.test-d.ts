/**
 * CL-04 — Codegen omits module collections from job/workflow ctx; the silent
 * `any` not-found fallback in the relation resolvers HIDES the omission.
 *
 * ROOT CAUSE (proposal §3 CL-04). Two coordinated defects that MUST ship atomically:
 *
 *   Part A (codegen seam).  The generated `_JobHandlerCollections` is a hardcoded
 *     literal of ONLY the local (user) collections — it hand-omits `_ModuleCollections`
 *     to dodge a `JobHandlerContext → AppCollections → typeof _modules → the job file`
 *     cycle. But module collections come from EXTERNAL packages (`typeof _modules`)
 *     and are NOT on the user job-file path, so dropping them is broader than the
 *     cycle requires. Net effect: inside a job/workflow handler, `ctx.collections.user`
 *     (an adminModule collection) does not exist, while `app.collections.user` does
 *     (cga-1, cga-2, ctx-01, ctx-04, ctx-05, CR-3). The fix makes the job-ctx
 *     collection map module-inclusive — ideally `_JobHandlerCollections = AppCollections`
 *     (the reviewer's PRIMARY alternative: structural identity with `AppContext`).
 *
 *   Part B (flip silent fallback to loud).  Three not-found arms return `any` today
 *     — `ResolveCollectionSelect` (type-utils.ts:393 `: any`), `ResolveCollectionRelation`
 *     (type-utils.ts:453 `RelationShape<any, never, ...>`), and the app-aware
 *     `ResolveCollectionRelationFromApp` (crud/types.ts:418, same fallback). When a
 *     relation's target collection is absent from the map handed to the resolver,
 *     the relation field becomes `any` with NO compiler error (cga-3, FGC-1). This
 *     is the EXACT mechanism that hides Part A: a `with`-relation pointing at a
 *     module collection inside a job handler resolves through `any` instead of
 *     surfacing the missing key. The fix turns each fallback `never` /
 *     `RelationShape<never, …>` so a missing/typo'd/omitted target is LOUD.
 *
 * TARGET (after the fix):
 *   - The job/workflow collection map is module-inclusive — structurally equal to
 *     the app-level collections surface (`QuestpieApp["collections"]`).
 *   - Every not-found relation arm resolves to `never` (loud), never `any` (silent),
 *     while a PRESENT relation over the COMPLETE map stays a precise real row.
 *
 * MOST OF THESE FAIL TO COMPILE NOW (the fallbacks are `any` today; `IsNever`
 * returns `false` so the `Expect<…true>` fails). That is the burndown — Phase 3b
 * flips them green by (A) regenerating the job-ctx map module-inclusively and
 * (B) replacing the three `any` fallbacks with `never`.
 *
 * SCOPE NOTE (proposal CL-04 caveat #4 + cga-1 regression note). The DEFINITIVE
 * Part-A assertion is `HasKey<Questpie.JobHandlerContext['collections'], 'user'>`
 * against the REAL committed GENERATED index — the `JobHandlerContext`/
 * `WorkflowContext` namespace interfaces are EMPTY augmentation seams in source
 * (app-context.ts:35-36, queue/types.ts:19) and are filled only by codegen, so
 * they are NOT reachable from this in-package manual `App` fixture. That generated
 * assertion lives in a generated-app `.test-d.ts`. Here we encode the same CLASS
 * from the fixture-reachable surfaces: (1) Part B's silent-`any` resolver mechanism
 * that HIDES the omission, probed exhaustively per resolver path, and (2) the
 * app-level collections parity invariant the fix unifies the job-ctx map onto.
 *
 * HARD RULES applied (proposal §4.1 + CL-04 blocking caveats):
 *   - Caveat #1: every relation-config fixture is `references`-complete (the
 *     resolvers won't instantiate over a `RelationConfig` missing `references`,
 *     so an incomplete fixture would never exercise the fallback at all).
 *   - Caveat #2: NON-deep (`ResolveRelations`) and deep (`ResolveRelationsDeep` /
 *     `CollectionRelationsFromApp`) paths get SEPARATE per-path assertions, and we
 *     use `IsNever`, NEVER `Equal<_, never>` — the pre-fix value is literally `any`
 *     and `Equal` is any-sensitive.
 *   - Run `IsAny`/`IsNever` on the RAW resolved value (never `NonNullable<…>`).
 *   - "never must not over-fire": every loud-fallback probe is paired with a
 *     positive control over the COMPLETE map that must stay a real row.
 */

import type {
	Equal,
	Expect,
	HasKey,
	IsAny,
	IsNever,
	IsEmptyObject,
	Not,
	NoAny,
} from "../_assert.js";
import type {
	App,
	Collections,
	QuestpieApp,
} from "../_fixtures.js";

import type {
	CollectionRelations,
	CollectionSelect as CollectionSelectOneArg,
	ExtractRelationSelect,
	GetCollection,
	ResolveRelations,
	ResolveRelationsDeep,
} from "#questpie/shared/type-utils.js";
import type { CollectionRelationsFromApp } from "#questpie/server/collection/crud/types.js";
import type { RelationConfig } from "#questpie/server/collection/builder/types.js";

// ============================================================================
// §0  Relation-config fixtures — `references`-complete (CL-04 caveat #1).
//
// The resolvers gate on `TRelations extends Record<string, RelationConfig>` and
// `RelationConfig` REQUIRES `type`, `collection`, and `references: string[]`
// (builder/types.ts:174-198). A fixture missing `references` is NOT a valid
// `RelationConfig`, so the resolver constraint rejects it and the fallback under
// test is never reached. Every config below carries `type` + `collection` +
// `field` + `references`.
// ============================================================================

/** A to-one relation whose target IS present in `Collections` (positive control). */
type RelToPresentOne = {
	author: {
		type: "one";
		collection: "authors";
		field: "author";
		references: ["id"];
	};
};

/** A to-many relation whose target IS present in `Collections` (positive control). */
type RelToPresentMany = {
	comments: {
		type: "many";
		collection: "article_comments";
		field: "article";
		references: ["id"];
	};
};

/** A to-one relation whose target is ABSENT from the map — exercises the fallback. */
type RelToMissingOne = {
	author: {
		type: "one";
		collection: "ghost_users";
		field: "author";
		references: ["id"];
	};
};

/** A to-many relation whose target is ABSENT from the map — exercises the fallback. */
type RelToMissingMany = {
	comments: {
		type: "many";
		collection: "ghost_comments";
		field: "article";
		references: ["id"];
	};
};

// `satisfies` is not available at the type level; this confirms (at the point the
// resolvers consume them) that the fixtures ARE valid `RelationConfig` maps, so
// the assertions below truly exercise the resolver body and not the constraint
// rejection path.
type _cfgValidPresentOne = Expect<
	Equal<RelToPresentOne extends Record<string, RelationConfig> ? true : false, true>
>;
type _cfgValidMissingOne = Expect<
	Equal<RelToMissingOne extends Record<string, RelationConfig> ? true : false, true>
>;
type _cfgValidMissingMany = Expect<
	Equal<RelToMissingMany extends Record<string, RelationConfig> ? true : false, true>
>;

// ============================================================================
// §1  Part B — NON-deep path (`ResolveRelations` → `ResolveCollectionSelect`).
//
// type-utils.ts:393 — `C extends keyof TCollections ? CollectionSelect<…> : any`.
// A to-one over a missing target resolves to `any`; a to-many to `any[]`. After
// the fix the not-found arm is `never` (and `never[]`).
//
// We probe the RAW resolved value with `IsNever` (caveat #2 — pre-fix it is `any`,
// so `Equal<_, never>` would be unreliable). Positive control: the SAME shape over
// the COMPLETE `Collections` map must stay a precise real row carrying `name`.
// ============================================================================

// --- to-one, missing target → must be `never` (today `any`) ----------------
type RR_MissingOne = ResolveRelations<RelToMissingOne, Collections>;
type RR_MissingOne_Author = RR_MissingOne["author"];

/** FAILS today: the to-one missing-target arm is `any`, not `never`. */
type _b1_missingOne_isNever = Expect<IsNever<RR_MissingOne_Author>>;
/** FAILS today: `any` is, by definition, `any` — the loud fix makes this hold. */
type _b1_missingOne_notAny = Expect<NoAny<RR_MissingOne_Author>>;

// --- to-one, present target → positive control (must be a real row) --------
type RR_PresentOne = ResolveRelations<RelToPresentOne, Collections>;
type RR_PresentOne_Author = RR_PresentOne["author"];

/** PASSES now and after: a present to-one stays a precise row. */
type _b1_presentOne_notNever = Expect<Equal<IsNever<RR_PresentOne_Author>, false>>;
type _b1_presentOne_notAny = Expect<NoAny<RR_PresentOne_Author>>;
type _b1_presentOne_hasName = Expect<HasKey<RR_PresentOne_Author, "name">>;

// --- to-many, missing target → element must be `never` (today `any`) -------
type RR_MissingMany = ResolveRelations<RelToMissingMany, Collections>;
type RR_MissingMany_El = RR_MissingMany["comments"][number];

/** FAILS today: the to-many missing-target element is `any`, not `never`. */
type _b1_missingMany_elIsNever = Expect<IsNever<RR_MissingMany_El>>;
type _b1_missingMany_elNotAny = Expect<NoAny<RR_MissingMany_El>>;

// --- to-many, present target → positive control (array of real rows) -------
type RR_PresentMany = ResolveRelations<RelToPresentMany, Collections>;
type RR_PresentMany_El = RR_PresentMany["comments"][number];

/** PASSES now and after: a present to-many stays an array of precise rows. */
type _b1_presentMany_elNotNever = Expect<Equal<IsNever<RR_PresentMany_El>, false>>;
type _b1_presentMany_elNotAny = Expect<NoAny<RR_PresentMany_El>>;
type _b1_presentMany_elHasContent = Expect<HasKey<RR_PresentMany_El, "content">>;

// ============================================================================
// §2  Part B — DEEP path (`ResolveRelationsDeep` → `ResolveCollectionRelation`).
//
// type-utils.ts:453 — the not-found arm is `RelationShape<any, never, any, …>`,
// so `ExtractRelationSelect<…>` of the fallback is `any` today. After the fix the
// arm is `RelationShape<never, …>` and the extracted select is `never`. This is a
// DIFFERENT resolver from §1 (caveat #2 — assert it independently).
// ============================================================================

// --- deep to-one, missing target → extracted select must be `never` --------
type RRD_MissingOne = ResolveRelationsDeep<RelToMissingOne, Collections>;
type RRD_MissingOne_Sel = ExtractRelationSelect<RRD_MissingOne["author"]>;

/** FAILS today: deep to-one missing-target select is `any`, not `never`. */
type _b2_deepMissingOne_isNever = Expect<IsNever<RRD_MissingOne_Sel>>;
type _b2_deepMissingOne_notAny = Expect<NoAny<RRD_MissingOne_Sel>>;

// --- deep to-many, missing target → extracted element select must be `never`
type RRD_MissingMany = ResolveRelationsDeep<RelToMissingMany, Collections>;
type RRD_MissingMany_Sel = ExtractRelationSelect<RRD_MissingMany["comments"][number]>;

/** FAILS today: deep to-many missing-target element select is `any`, not `never`. */
type _b2_deepMissingMany_isNever = Expect<IsNever<RRD_MissingMany_Sel>>;
type _b2_deepMissingMany_notAny = Expect<NoAny<RRD_MissingMany_Sel>>;

// --- deep, present target → positive control (real select, not never) ------
type RRD_PresentOne = ResolveRelationsDeep<RelToPresentOne, Collections>;
type RRD_PresentOne_Sel = ExtractRelationSelect<RRD_PresentOne["author"]>;

/** PASSES now and after: a present deep to-one yields a real select with `name`. */
type _b2_deepPresentOne_notNever = Expect<Equal<IsNever<RRD_PresentOne_Sel>, false>>;
type _b2_deepPresentOne_notAny = Expect<NoAny<RRD_PresentOne_Sel>>;
type _b2_deepPresentOne_hasName = Expect<HasKey<RRD_PresentOne_Sel, "name">>;

// ============================================================================
// §3  Part B — the END-TO-END mechanism that HIDES Part A (FGC-1).
//
// FGC-1's exact reproduction: take a real collection's relation configs, resolve
// them deep once over the COMPLETE map (control → real row) and once over a map
// with the relation TARGET omitted (the omission → silent `any` today, loud
// `never` after). `articles.author → authors`; omitting `authors` from the map
// models the job-ctx omission of a module collection.
// ============================================================================

type ArticleRelCfgs = CollectionRelations<GetCollection<Collections, "articles">>;

/** Collections map with the `authors` target OMITTED (models the job-ctx omission). */
type CollectionsSansAuthors = Omit<Collections, "authors">;

// --- control: full map → `author` resolves to a real row (NOT any/never) ---
type FGC1_Control = ResolveRelationsDeep<ArticleRelCfgs, Collections>;
type FGC1_Control_AuthorSel = ExtractRelationSelect<FGC1_Control["author"]>;

/** PASSES now and after: with the complete map the relation is a precise row. */
type _b3_control_notAny = Expect<NoAny<FGC1_Control_AuthorSel>>;
type _b3_control_notNever = Expect<Equal<IsNever<FGC1_Control_AuthorSel>, false>>;
type _b3_control_hasName = Expect<HasKey<FGC1_Control_AuthorSel, "name">>;

// --- the leak: target omitted → silent `any` today, must become `never` ----
type FGC1_Missing = ResolveRelationsDeep<ArticleRelCfgs, CollectionsSansAuthors>;
type FGC1_Missing_AuthorSel = ExtractRelationSelect<FGC1_Missing["author"]>;

/** FAILS today: omitting the target degrades the relation to `any`, silently. */
type _b3_missing_notAny = Expect<NoAny<FGC1_Missing_AuthorSel>>;
/** FAILS today: the loud fix makes the omitted-target select `never`. */
type _b3_missing_isNever = Expect<IsNever<FGC1_Missing_AuthorSel>>;

// ============================================================================
// §4  Part B — APP-AWARE deep path (`CollectionRelationsFromApp`, crud/types.ts:418).
//
// This is the resolver the live CRUD `with` actually uses, and the one a job
// handler hits when populating a relation that points at an omitted (module)
// collection. Its not-found arm is the SAME `RelationShape<any, never, …>`. We
// thread an `App` whose `collections` map OMITS the relation target — modelling
// exactly the job-ctx map that drops `_ModuleCollections`.
// ============================================================================

/** `App` whose collections map omits the `authors` relation target. */
type AppSansAuthors = {
	collections: Omit<Collections, "authors">;
	globals: App["globals"];
};

// --- control: full App → `articles.author` is a real populated relation ----
type CRFA_Control = CollectionRelationsFromApp<
	GetCollection<Collections, "articles">,
	App
>;
type CRFA_Control_AuthorSel = ExtractRelationSelect<CRFA_Control["author"]>;

/** PASSES now and after: the app-aware deep path over a complete App is precise. */
type _b4_control_notAny = Expect<NoAny<CRFA_Control_AuthorSel>>;
type _b4_control_notNever = Expect<Equal<IsNever<CRFA_Control_AuthorSel>, false>>;
type _b4_control_hasName = Expect<HasKey<CRFA_Control_AuthorSel, "name">>;

// --- the leak: App with the target omitted → silent `any`, must be `never` -
type CRFA_Missing = CollectionRelationsFromApp<
	GetCollection<Collections, "articles">,
	AppSansAuthors
>;
type CRFA_Missing_AuthorSel = ExtractRelationSelect<CRFA_Missing["author"]>;

/** FAILS today: the app-aware path silently degrades the omitted target to `any`. */
type _b4_missing_notAny = Expect<NoAny<CRFA_Missing_AuthorSel>>;
/** FAILS today: the loud fix makes the omitted-target select `never`. */
type _b4_missing_isNever = Expect<IsNever<CRFA_Missing_AuthorSel>>;

// ============================================================================
// §5  Part B — the USER-HALF-NOT-COLLAPSED negative control (CL-04 caveat #4).
//
// All the omission probes assert the MISSING target goes loud. We must also prove
// the fix does NOT collapse the surviving half: with one target omitted, OTHER
// relations whose targets ARE still present must keep resolving to real rows
// (this is the original TS2339 / `{}` collapse mode the omission could mask).
//
// `articles.comments → article_comments` survives when only `authors` is omitted.
// ============================================================================

type FGC1_Missing_CommentsSel = ExtractRelationSelect<
	FGC1_Missing["comments"][number]
>;

/** PASSES now and after: a SURVIVING relation is unaffected by an unrelated omission. */
type _b5_survivor_notAny = Expect<NoAny<FGC1_Missing_CommentsSel>>;
type _b5_survivor_notNever = Expect<
	Equal<IsNever<FGC1_Missing_CommentsSel>, false>
>;
type _b5_survivor_notEmpty = Expect<
	Equal<IsEmptyObject<FGC1_Missing_CommentsSel>, false>
>;
type _b5_survivor_hasContent = Expect<HasKey<FGC1_Missing_CommentsSel, "content">>;

// ============================================================================
// §6  Part A surrogate — app-level collections parity the job-ctx map unifies onto.
//
// The DEFINITIVE Part-A check (`HasKey<Questpie.JobHandlerContext['collections'],
// 'user'>` over the generated index) is out of reach from this manual fixture (see
// the header SCOPE NOTE). What IS reachable is the surface the fix targets: the
// reviewer's PRIMARY alternative is `_JobHandlerCollections = AppCollections`, i.e.
// the job-ctx collection map becomes STRUCTURALLY IDENTICAL to the app-level map
// (`QuestpieApp["collections"]`). We pin that app-level map here so the parity
// target is encoded and regression-proof: it must be module-/fixture-inclusive,
// carry every collection key, and never carry a phantom string index.
//
// These PASS today (the app-level surface is already module-inclusive — that is
// the asymmetry cga-2 names: globals/tables are inclusive while job-ctx collections
// are not). Pairing them with §1-§5 makes the cluster's intent unambiguous: bring
// the job-ctx collection map up to THIS surface, with the loud fallback so any gap
// is visible rather than swallowed as `any`.
// ============================================================================

type AppCollectionsSurface = QuestpieApp["collections"];

/** The app-level collections surface is not degraded to `any`. */
type _a1_surface_notAny = Expect<NoAny<AppCollectionsSurface>>;
/** It carries every fixture collection key (the set the job-ctx map must match). */
type _a1_hasAuthors = Expect<HasKey<AppCollectionsSurface, "authors">>;
type _a1_hasArticles = Expect<HasKey<AppCollectionsSurface, "articles">>;
type _a1_hasTickets = Expect<HasKey<AppCollectionsSurface, "tickets">>;
type _a1_hasArticleComments = Expect<
	HasKey<AppCollectionsSurface, "article_comments">
>;
/** It has NO phantom string index — the key set is finite/exact. */
type _a1_noStringIndex = Expect<
	Equal<string extends keyof AppCollectionsSurface ? true : false, false>
>;

/**
 * Structural-parity SHAPE the fix establishes: the job-ctx collection-key set
 * must equal the app-level collection-key set. We encode the invariant against a
 * known-complete reference (`Collections`) so Phase 3b can lift `JobHandlerContext`
 * onto the same key set. `keyof QuestpieApp["collections"]` already equals
 * `keyof Collections`; this guards that the app-level surface (the target) does not
 * itself silently lose keys.
 */
type _a2_appKeysEqualCollections = Expect<
	Equal<keyof AppCollectionsSurface, keyof Collections>
>;

// ============================================================================
// §7  Part B — typo'd relation target (the same leak via a user typo, cga-3/FGC-1).
//
// The fallback also fires for a plain typo (`collection: "authorz"`). After the
// fix this is `never` (loud), surfacing the typo; today it is silently `any`. A
// to-one CLIENT-SDK row resolution (`CollectionSelectOneArg`) is included to show
// the leak is not specific to one resolver entry-point.
// ============================================================================

type RelTypo = {
	author: {
		type: "one";
		collection: "authorz"; // typo of "authors"
		field: "author";
		references: ["id"];
	};
};

type RR_Typo = ResolveRelations<RelTypo, Collections>;
type RR_Typo_Author = RR_Typo["author"];

/** FAILS today: a typo'd relation target degrades to `any` with no error. */
type _b7_typo_notAny = Expect<NoAny<RR_Typo_Author>>;
/** FAILS today: the loud fix surfaces the typo as `never`. */
type _b7_typo_isNever = Expect<IsNever<RR_Typo_Author>>;

// Sanity: the 1-arg client-side select of a REAL collection is a precise row
// (proves the typo `never` above is the fallback firing, not a broken control).
type ClientArticleRow = CollectionSelectOneArg<
	GetCollection<Collections, "articles">
>;
type _b7_clientRow_notAny = Expect<NoAny<ClientArticleRow>>;
type _b7_clientRow_hasTitle = Expect<HasKey<ClientArticleRow, "title">>;
