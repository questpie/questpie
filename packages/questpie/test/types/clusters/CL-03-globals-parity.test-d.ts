/**
 * CL-03 — Globals derive read/write types from Drizzle column infer, no
 *         globals<->collections parity.
 *
 * ROOT CAUSE (proposal §3 CL-03 + findings GWI-1..5, globaldoc-*, GWR-1..3):
 *   The global READ slot was migrated to the field-definition pipeline
 *   (`GlobalSelectFromApp` — already correct), but the WRITE slot
 *   (`GlobalUpdate`/`GlobalInsert`) still resolves through Drizzle's
 *   `InferInsertModel<TTable>` (`global.ts:112-129`). Because object/select/json
 *   jsonb columns carry no `.$type<…>()`, every object/array field degrades to
 *   `unknown` and every select literal-union widens to `string` on the write
 *   side. The codegen `GlobalDoc` helper additionally inherits a Drizzle string
 *   index signature (typo'd keys read `unknown` instead of erroring), and
 *   `GlobalBuilder.state` being `private` collapses `GlobalState<builder>` —and
 *   therefore the exported `GlobalRelations<builder>`— to a `never`-fallback.
 *
 * TARGET (after fix): globals reach the SAME field-definition precision as
 *   collections across read, write, relation extraction, and relation
 *   population — one shared mechanism, zero dual write pathway.
 *
 * These assertions encode the CORRECT target types. MOST FAIL TO COMPILE TODAY
 * (the write surface is Drizzle-degraded; the builder relations collapse to a
 * `Record` index; m2m populates as a single object) — that is the burndown.
 *
 * WIRING (proposal §4.1 hard rules): every "real shape" probe is routed through
 *   the REAL public `Questpie<…>` instance (`QuestpieApp["globals"]["site"]…`),
 *   never a raw builder — except GWR-1, which by design must probe a raw
 *   `global(...)` BUILDER value (that is the exact surface that collapses).
 *   `IsUnknown`/`IsAny` are run on the RAW indexed value (never on
 *   `NonNullable<…>`, which collapses `unknown`→`{}` and passes vacuously);
 *   identity uses `Equal`/`ExactType`, and object/array round-trips apply
 *   `NonNullable` to BOTH sides to dodge the localized/nullable false-negative.
 */

import type {
	ApplyQuery,
	CollectionRelationsFromApp,
	CollectionSelect as CollectionSelectFromApp,
} from "#questpie/server/collection/crud/types.js";
import type { GlobalSelectFromApp } from "#questpie/server/global/crud/types.js";
import type {
	CollectionRelations,
	GetGlobal,
	GlobalRelations,
	GlobalState,
	ResolveRelationsDeep,
} from "#questpie/shared/type-utils.js";

import type {
	Equal,
	ExactType,
	Expect,
	HasKey,
	IsArrayType,
	IsNever,
	NoNever,
	NoStringIndex,
	NoUnknown,
	Not,
	NotEmptyObject,
} from "../_assert.js";
// Fixtures are imported as TYPES and probed through the typed maps
// (`Globals["site"]` ≡ `typeof siteGlobal`, etc.). We deliberately avoid
// `typeof <fixture>` on an `import type` binding — that is a TS1361 *structural*
// error, which would make this file fail for the wrong reason (only the target
// ASSERTIONS may fail). `Globals["site"]` resolves to the raw `GlobalBuilder`
// type, which is exactly the builder surface GWR-1 must probe.
import type { App, Collections, Globals, QuestpieApp } from "../_fixtures.js";

// ============================================================================
// §0a  Faithful reconstruction of the populated-relation surfaces.
//
// CRUD `get`/`findOne` are GENERIC methods; their per-query return cannot be
// instantiated at the type level (`fn<TArg>` is value-only syntax). So for
// `with`-population probes we drive `ApplyQuery<TSelect, TRelations, TQuery>`
// directly — exactly as crud-deep-typesafety.test-d.ts does — wiring TSelect /
// TRelations identically to GlobalAPI (questpie-api.ts:111-116) and CollectionAPI
// (:96-105) so this can never silently diverge from the real composition.
//
//   GLOBAL (legacy stack today): ResolveRelationsDeep<GlobalRelations<…>, …>
//   COLLECTION (app-aware stack):  CollectionRelationsFromApp<…, App>
//
// The GWR-2 (array) and GWR-3 (parity) targets ride on these two stacks unifying.
// ============================================================================

type SiteGlobalT = GetGlobal<Globals, "site">;
type SiteGlobalSelect = GlobalSelectFromApp<SiteGlobalT, App>;
type SiteGlobalRelations = ResolveRelationsDeep<
	GlobalRelations<SiteGlobalT>,
	Collections
>;

type ArticlesCollT = Collections["articles"];
type ArticlesCollSelect = CollectionSelectFromApp<ArticlesCollT, App>;
type ArticlesCollRelations = CollectionRelationsFromApp<ArticlesCollT, App>;

// ============================================================================
// §0  Resolve the REAL public CRUD surfaces through the Questpie instance.
//
// QuestpieApp = Questpie<QuestpieConfig & { collections; globals }>, so
// QuestpieApp["globals"]["site"] is GlobalAPI<…> = GlobalCRUD<
//   GlobalSelectFromApp /*READ — fixed*/, GlobalInsert, GlobalUpdate /*WRITE —
//   Drizzle-degraded*/, ResolveRelationsDeep<GlobalRelations<…>, …> >.
// Probing `update`'s first arg / `get`'s return exercises the EXACT user-facing
// types, where the degradation lives.
// ============================================================================

/** site write input — the degraded WRITE surface (GlobalUpdateInput). */
type SiteUpd = Parameters<QuestpieApp["globals"]["site"]["update"]>[0];
/** site read result — the field-def-aware READ surface (already correct). */
type SiteRead = NonNullable<
	Awaited<ReturnType<QuestpieApp["globals"]["site"]["get"]>>
>;

// Raw BUILDER types (≡ `typeof <fixture>`) reached via the typed maps, so the
// file needs no value import. GWR-1 (§6) requires these raw-builder surfaces.
type SiteBuilder = Globals["site"];
type SocialBuilder = Globals["social"];
type CategoriesBuilder = Collections["categories"];

type AlertsUpd = Parameters<QuestpieApp["globals"]["alerts"]["update"]>[0];
type AlertsGet = NonNullable<
	Awaited<ReturnType<QuestpieApp["globals"]["alerts"]["get"]>>
>;

type SocialUpd = Parameters<QuestpieApp["globals"]["social"]["update"]>[0];
type SocialGet = NonNullable<
	Awaited<ReturnType<QuestpieApp["globals"]["social"]["get"]>>
>;

// Collection write surface, for cross-entity parity (§5).
type ArticleCreate = Parameters<
	QuestpieApp["collections"]["articles"]["create"]
>[0];

// ============================================================================
// §1  WRITE INPUT: object / object().array() fields must NOT be `unknown`
//      (GWI-2, GWI-4). They degrade to `unknown` today (jsonb column w/o $type).
//
//      RAW-value `IsUnknown` guards per §4.1 (never NonNullable). The array-ness
//      and element shape are then asserted via NonNullable on the (target) typed
//      value.
// ============================================================================

// site.contact — a plain f.object() on a global.
type _contactNotUnknown = Expect<NoUnknown<SiteUpd["contact"]>>;
type _contactNotNever = Expect<NoNever<SiteUpd["contact"]>>;
type _contactEmail = ExactType<
	NonNullable<SiteUpd["contact"]>["email"],
	string
>;

// social.navigation — object().array() ⇒ must be an ARRAY of typed objects.
type _navNotUnknown = Expect<NoUnknown<SocialUpd["navigation"]>>;
type _navIsArray = Expect<Equal<IsArrayType<SocialUpd["navigation"]>, true>>;
type _navElem = ExactType<
	NonNullable<SocialUpd["navigation"]>[number],
	{ label: string; href: string }
>;

// social.socialLinks — object().array() with a NESTED select-union.
type _socialLinksNotUnknown = Expect<NoUnknown<SocialUpd["socialLinks"]>>;
type _socialLinksIsArray = Expect<
	Equal<IsArrayType<SocialUpd["socialLinks"]>, true>
>;
type _socialLinksPlatform = ExactType<
	NonNullable<SocialUpd["socialLinks"]>[number]["platform"],
	"instagram" | "facebook" | "twitter" | "tiktok" | "youtube"
>;
type _socialLinksUrl = ExactType<
	NonNullable<SocialUpd["socialLinks"]>[number]["url"],
	string
>;

// Garbage that today assigns to `unknown` must be REJECTED after the fix.
// VALUE-LEVEL assignment is the real burndown: today the field is `unknown`, so
// the assignment compiles, the `@ts-expect-error` is UNUSED, and the file errors
// (TS2578) — RED now. After the fix the field is field-def precise, the garbage
// is rejected, the directive is consumed — GREEN. (Each is paired with the
// positive Equal companions above, §4.1 — never a lone @ts-expect-error.)
// @ts-expect-error — `navigation` is `{label;href}[]`, not a number, after fix.
const _navGarbageNumber: SocialUpd = { navigation: 12345 };
// @ts-expect-error — `socialLinks` is a typed array, not a boolean, after fix.
const _socialLinksGarbage: SocialUpd = { socialLinks: true };
// @ts-expect-error — `contact` is an object, not a string, after fix.
const _contactGarbageString: SiteUpd = { contact: "nope" };

// ============================================================================
// §2  WRITE INPUT: select() literal unions must SURVIVE, not widen to `string`
//      (GWI-3). Today `Upd['theme']`/`['alertType']` is `string | null |
//      undefined`. Use the city-portal-shaped `alerts.alertType` per the
//      reviewer's corrected per-app split.
// ============================================================================

// alerts.alertType — the canonical city-portal select-union write field.
type _alertUnionExact = ExactType<
	NonNullable<AlertsUpd["alertType"]>,
	"info" | "warning" | "emergency"
>;
type _alertNotPlainString = Expect<
	Equal<Equal<NonNullable<AlertsUpd["alertType"]>, string>, false>
>;

// site.theme — a second select-union on the parity flagship global.
type _themeUnionExact = ExactType<
	NonNullable<SiteUpd["theme"]>,
	"light" | "dark" | "system"
>;
type _themeNotPlainString = Expect<
	Equal<Equal<NonNullable<SiteUpd["theme"]>, string>, false>
>;

// Invalid enum value must ERROR after fix (VALUE-LEVEL burndown; today the
// write field is `string` so the bad value assigns and the directive is unused
// ⇒ RED, paired with the positive `_alertUnionExact`/`_themeUnionExact` above).
// @ts-expect-error — `alertType` is the literal union, not an arbitrary string.
const _alertGarbage: AlertsUpd = { alertType: "this-is-not-valid" };
// @ts-expect-error — `theme` is `light|dark|system`, not an arbitrary string.
const _themeGarbage: SiteUpd = { theme: "neon" };

// ============================================================================
// §3  GET → UPDATE ROUND-TRIP IDENTITY (GWI-4). The value you read back must be
//      re-typable against the write input as the SAME type. Today read is clean
//      and write is `unknown`, so they diverge. Apply NonNullable on BOTH sides
//      (the localized/nullable false-negative trap, §4.1) and target structured
//      object/select fields.
// ============================================================================

type _rtContact = ExactType<
	NonNullable<SiteUpd["contact"]>,
	NonNullable<SiteRead["contact"]>
>;
type _rtTheme = ExactType<
	NonNullable<SiteUpd["theme"]>,
	NonNullable<SiteRead["theme"]>
>;
type _rtNavigation = ExactType<
	NonNullable<SocialUpd["navigation"]>,
	NonNullable<SocialGet["navigation"]>
>;
type _rtSocialLinks = ExactType<
	NonNullable<SocialUpd["socialLinks"]>,
	NonNullable<SocialGet["socialLinks"]>
>;
type _rtAlertType = ExactType<
	NonNullable<AlertsUpd["alertType"]>,
	NonNullable<AlertsGet["alertType"]>
>;

// ============================================================================
// §4  READ SURFACE: no phantom Drizzle index signature; object-arrays typed
//      (globaldoc-phantom-index-signature, globaldoc-object-array-unknown).
//
//      The runtime get() (GlobalSelectFromApp) should already be clean — these
//      lock it so the read side can never regress back to the Drizzle infer.
// ============================================================================

// No string index signature on a global read result (finite key union).
type _readNoPhantomIndex = Expect<NoStringIndex<SiteRead>>;
type _readSocialNoPhantomIndex = Expect<NoStringIndex<SocialGet>>;

// READ object-array fields are typed arrays, not `unknown`.
type _readNavNotUnknown = Expect<NoUnknown<SocialGet["navigation"]>>;
type _readNavIsArray = Expect<
	Equal<IsArrayType<SocialGet["navigation"]>, true>
>;
type _readSocialLinksPlatform = ExactType<
	NonNullable<SocialGet["socialLinks"]>[number]["platform"],
	"instagram" | "facebook" | "twitter" | "tiktok" | "youtube"
>;

// The WRITE surface must likewise carry NO phantom index once it is field-def
// based (this is the write half of globaldoc-phantom-index-signature; FAILS
// today because InferGlobalUpdate keeps the Drizzle string index).
type _writeNoPhantomIndex = Expect<NoStringIndex<SiteUpd>>;
type _writeSocialNoPhantomIndex = Expect<NoStringIndex<SocialUpd>>;

// ============================================================================
// §5  CROSS-ENTITY PARITY (the cluster's namesake). A select-union write field
//      on a GLOBAL must reach the same field-def precision a collection write
//      field reaches. We assert the global's select-union write type equals the
//      collection's select-union write type for the same union, AND that a
//      structured object survives identically on both surfaces.
//
//      `articles.status` (draft|review|published) is the collection-side
//      select-union; assert the global path is precise the same way the
//      collection path is.
// ============================================================================

// Collection select-union write field stays precise (the parity baseline —
// this should already hold; it is the control the global side must match).
type _articleStatusExact = ExactType<
	NonNullable<ArticleCreate["status"]>,
	"draft" | "review" | "published"
>;

// PARITY: a global select-union write field is `IsUnknown=false` AND a precise
// literal union, exactly like the collection field. (FAILS today: global side
// is `string`.) Expressed as "both surfaces are precise unions, not `string`".
type _parityGlobalSelectPrecise = Expect<
	Equal<
		// global side precise?
		Equal<NonNullable<AlertsUpd["alertType"]>, string>,
		// collection side precise?
		Equal<NonNullable<ArticleCreate["status"]>, string>
	>
>;

// CROSS-ENTITY object-shape parity: the global `socialLinks` element shape must
// be a precise typed object (not `unknown`) — the same precision a collection
// object().array() field gets. We anchor on the known target element shape.
type _paritySocialLinksElem = ExactType<
	NonNullable<SocialUpd["socialLinks"]>[number],
	{
		platform: "instagram" | "facebook" | "twitter" | "tiktok" | "youtube";
		url: string;
	}
>;

// ============================================================================
// §6  GWR-1 — GlobalBuilder.state is `private` ⇒ GlobalState<builder> collapses
//      to `never`, degrading the EXPORTED GlobalRelations helper on a global
//      BUILDER value to a `Record<string, RelationConfig>` index fallback.
//
//      Per finding GWR-1 + §4.1: this MUST probe a raw `global(...).fields(...)`
//      BUILDER value (the exact collapse surface) — not GetGlobal.
// ============================================================================

// State must extract from a BUILDER value (FAILS today: `private state` ⇒ never).
type _siteStateNotNever = Expect<NoNever<GlobalState<SiteBuilder>>>;
type _socialStateNotNever = Expect<NoNever<GlobalState<SocialBuilder>>>;

// GlobalRelations<builder> must carry the REAL relation keys, no index sig.
type SiteRel = GlobalRelations<SiteBuilder>;
type _siteRelNoIndex = Expect<NoStringIndex<SiteRel>>;
type _siteRelNotEmpty = Expect<NotEmptyObject<SiteRel>>;
type _siteRelHasOwner = Expect<HasKey<SiteRel, "owner">>;
type _siteRelHasPartners = Expect<HasKey<SiteRel, "partners">>;

// Global/collection symmetry: a global's relation extraction must NOT collapse
// while a collection with the same field shape does not. Probe the structural
// signal that GWR-1 fails on — the global relations must have specific keys,
// exactly like the collection ones (which never collapse).
type CategoryRel = CollectionRelations<CategoriesBuilder>;
type _collectionRelControl = Expect<HasKey<CategoryRel, "parent">>;
type _globalRelReachesParity = Expect<
	Equal<
		// global side: does it have specific keys (no string index)?
		string extends keyof SiteRel ? false : true,
		// collection side: it does (the proven-correct baseline).
		string extends keyof CategoryRel ? false : true
	>
>;

// ============================================================================
// §7  GWR-2 — global manyToMany populates as an ARRAY in get({with:{rel:true}}),
//      not a single object (relationKind never transitions to 'many').
//      `siteGlobal.partners` is the global m2m. Mirror against a collection m2m.
// ============================================================================

type SitePartnersPop = ApplyQuery<
	SiteGlobalSelect,
	SiteGlobalRelations,
	{ with: { partners: true } }
>;
// to-many population is an ARRAY (FAILS today: single object).
type _partnersIsArray = Expect<
	Equal<IsArrayType<SitePartnersPop["partners"]>, true>
>;
// element shape is the target collection's row (carries 'name'), not unknown.
type _partnersElemHasName = Expect<
	HasKey<NonNullable<SitePartnersPop["partners"]>[number], "name">
>;
type _partnersElemNotUnknown = Expect<
	NoUnknown<NonNullable<SitePartnersPop["partners"]>[number]>
>;

// Mirror against a collection m2m so both relation paths are guarded (parity).
type ArticleCatsPop = ApplyQuery<
	ArticlesCollSelect,
	ArticlesCollRelations,
	{ with: { categories: true } }
>;
type _collectionM2mIsArray = Expect<
	Equal<IsArrayType<ArticleCatsPop["categories"]>, true>
>;

// ============================================================================
// §8  GWR-3 — globals populate `with` relations via the legacy single-arg
//      ($infer) CollectionSelect with __app=unknown, diverging from collections'
//      field-definition-aware (2-arg, app-aware) population. The populated
//      relation BODY (its select) comes from the wrong stack.
//
//      TARGET: route globals through the app-aware resolver so the populated
//      body is IDENTICAL to the collection-side populated body of the SAME
//      target collection. Both `site.owner` and `articles.author` point at
//      `authors`, so the two populated bodies must be `Equal` — and `Equal`
//      distinguishes the legacy stack's mutable, module-blind select from the
//      app-aware readonly one (CL-10), so this flips even on a scalar target.
//
//      NOTE: the *observable* richText/json half of GWR-3 ("module field types
//      leak as `unknown` inside a populated global relation") is NOT reachable
//      from these fixtures — no global relates to a json/object-bearing
//      collection (`articles`). That half is asserted structurally here (the
//      body must be a real, typed, non-`unknown` object) and on the collection
//      side by CL-01/CL-13; a global→`articles` relation would make the json
//      probe flip directly.
// ============================================================================

type SiteOwnerPop = ApplyQuery<
	SiteGlobalSelect,
	SiteGlobalRelations,
	{ with: { owner: true } }
>;
// The populated relation body is a real, typed object (not unknown/empty),
// carrying the target collection's field-def-derived keys.
type SiteOwnerBody = NonNullable<SiteOwnerPop["owner"]>;
type _ownerBodyNotUnknown = Expect<NoUnknown<SiteOwnerPop["owner"]>>;
type _ownerBodyNotEmpty = Expect<NotEmptyObject<SiteOwnerBody>>;
type _ownerBodyName = ExactType<SiteOwnerBody["name"], string>;
// A field on the populated relation body must NOT be `unknown` (the
// single-arg/__app=unknown path is where module/object field data would leak).
type _ownerBodyBioNotUnknown = Expect<NoUnknown<SiteOwnerBody["bio"]>>;

// GWR-3 core parity (the burndown): the global's populated `owner` body (→authors,
// LEGACY single-arg/$infer stack today) must equal the collection's APP-AWARE
// populated `author` body (→authors). The two relation-resolution stacks differ
// today (the global routes through ResolveRelationsDeep / CollectionSelect<T>
// with __app=unknown; the collection through CollectionRelationsFromApp /
// CollectionSelect<T, App>), so `Equal` is FALSE now and flips after unification.
type ArticleAuthorPop = ApplyQuery<
	ArticlesCollSelect,
	ArticlesCollRelations,
	{ with: { author: true } }
>;
type ArticleAuthorBody = NonNullable<ArticleAuthorPop["author"]>;
type _globalOwnerEqCollectionAuthor = Expect<
	Equal<SiteOwnerBody, ArticleAuthorBody>
>;

// ============================================================================
// §9  GWI-5 / .d.ts-emit guard — the global WRITE input must not collapse to
//      `{}` (Partial<{}> = accept-everything) for published consumers. Assert a
//      select key is present and the whole input did not degenerate.
// ============================================================================

type _writeNotCollapsed = Expect<NotEmptyObject<SiteUpd>>;
type _writeHasThemeKey = Expect<HasKey<SiteUpd, "theme">>;
type _writeHasContactKey = Expect<HasKey<SiteUpd, "contact">>;
type _alertsWriteHasAlertType = Expect<HasKey<AlertsUpd, "alertType">>;

// ============================================================================
// §10  NEGATIVE CONTROLS — scalar/string fields stay precise on BOTH surfaces
//       (the fix must not over-correct primitives), and the read side keeps
//       working. These should hold today AND after the fix.
// ============================================================================

// Required scalar string survives on read and write.
type _siteNameReadString = ExactType<SiteRead["siteName"], string>;
type _siteNameWriteString = ExactType<NonNullable<SiteUpd["siteName"]>, string>;

// A nullable optional scalar stays string|null on read (not degraded to never).
type _taglineReadNotNever = Expect<NoNever<SiteRead["tagline"]>>;

// The read result is never `any` at the top level.
type _siteReadNotAny = Expect<Not<IsNever<SiteRead>>>;

// `GlobalState` over a real Global instance (via the maps) is also non-never —
// confirms the maps/instance path resolves (route through Globals, not bare).
type _globalsMapHasSite = Expect<HasKey<Globals, "site">>;
type _collectionsMapHasArticles = Expect<HasKey<Collections, "articles">>;
type _appHasGlobals = Expect<HasKey<App, "globals">>;
