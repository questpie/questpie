/**
 * CL-08 — `.array()` hardcodes `notNull:false` / `hasDefault:false`; required
 * arrays select as `T[] | null` and are wrongly OPTIONAL on INSERT.
 *
 * ROOT CAUSE (proposal §3 CL-08 + §CL-08 detail): `ArrayFieldState<TInner>`
 * dropped `notNull`/`hasDefault` from its `Omit` carry-over list AND pinned both
 * to `false`. Because all three extractors (`ExtractSelectType`,
 * `ExtractInputType`, and through them `InferCollectionSelect/Insert`) read these
 * straight off the field state, EVERY array field — regardless of `.required()`
 * or `.default()` — was forced nullable in SELECT and optional+nullable in INSERT
 * while the underlying jsonb column is emitted `NOT NULL` at runtime. The member
 * findings:
 *
 *   arr-required-select-nullable  required array selects `T[] | null` (should `T[]`).
 *   arr-required-insert-optional  required no-default array is OPTIONAL+nullable in
 *                                 INSERT (TS won't flag the missing required field).
 *   arr-default-stripped          `hasDefault:false` is forced, so even a defaulted
 *                                 array stays nullable / mis-typed.
 *   arr-order-dependent-nullability  `f.x().required().array()` ⇒ `T[] | null` but
 *                                 `f.x().array().required()` ⇒ `T[]` — identical
 *                                 runtime, divergent types. Must be order-independent.
 *
 * TARGET (after the 2-line `ArrayFieldState` fix — `TInner["notNull"]` /
 * `TInner["hasDefault"]` flow through):
 *   - required array (no default)  SELECT `T[]`              INSERT required, non-null `T[]`.
 *   - defaulted array              SELECT `T[]`              INSERT optional, non-null.
 *   - optional array (control)     SELECT `T[] | null`       INSERT optional+nullable.
 *   - scalar control (`tickets.subject`) stays `string` (the fix must not touch scalars).
 *
 * GLOBALS (proposal §CL-08 caveat 1 + 2 — the DE-SCOPED, still-RED debt): global
 * SELECT routes through `InferGlobalSelect = InferSelectModel<TTable> & {…}` and
 * INSERT/UPDATE through `InferGlobalInsert/Update = (Partial)<InferInsertModel<TTable>>`
 * — PURE Drizzle; the field-def extractors are NEVER reached. So this edit has
 * ZERO effect on global *write* input. We assert the TARGET (`featureFlags`:
 * SELECT `string[]`, INSERT/UPDATE required-non-null `string[]`) so the gap is
 * RECORDED as burndown rather than papered over with `any` (caveat 2). These
 * globals-write assertions are expected RED until CL-03 rewrites
 * `InferGlobalInsert/Update` to mirror the collection field-def path.
 *
 * MOST OF THESE FAIL TO COMPILE NOW. That is the burndown — Phase 3b flips them
 * green (collection side via the `ArrayFieldState` edit, global-write side via CL-03).
 *
 * NOTE on construction: the cluster-wide CLASS includes orderings the shared
 * `_fixtures.ts` does not carry (`.array().required()` and `.default([...]).array()`).
 * Per the kit rule, locally-built fields are constructed ONLY for those missing
 * shapes via the real `collection()` factory; every other probe uses the imported
 * fixtures and the public 1-arg `CollectionSelect/Insert/Update` and
 * `GlobalSelect/Insert/Update` helpers (the exact surface the findings reference).
 */

import type { Equal, Expect, ExpectArray, NoAny, NoNever } from "../_assert.js";
import { articles, siteGlobal, tickets } from "../_fixtures.js";

import { collection } from "#questpie/server/collection/builder/collection-builder.js";
import type {
	CollectionInsert,
	CollectionSelect,
	CollectionUpdate,
	GlobalInsert,
	GlobalSelect,
	GlobalUpdate,
} from "#questpie/shared/type-utils.js";

// Cross-check the underlying field-state extractors directly so the failure is
// pinned to the `ArrayFieldState` carry-over, not only to the downstream
// collection/global composition.
import type {
	ExtractInputType,
	ExtractSelectType,
	FieldState,
} from "#questpie/server/fields/field-class-types.js";

// ============================================================================
// Resolved fixture I/O shapes (1-arg public helpers — the findings' surface).
// ============================================================================

type ArticlesSelect = CollectionSelect<typeof articles>;
type ArticlesInsert = CollectionInsert<typeof articles>;
type ArticlesUpdate = CollectionUpdate<typeof articles>;

type TicketsSelect = CollectionSelect<typeof tickets>;
type TicketsInsert = CollectionInsert<typeof tickets>;

type SiteSelect = GlobalSelect<typeof siteGlobal>;
type SiteInsert = GlobalInsert<typeof siteGlobal>;
type SiteUpdate = GlobalUpdate<typeof siteGlobal>;

// ============================================================================
// CL-08.A — REQUIRED array: SELECT is `T[]`, never `T[] | null`.
// (arr-required-select-nullable)
//
// `articles.tagList = f.text().required().array()` and
// `tickets.scores   = f.number().required().array()`.
// ============================================================================

// Element types must not degrade and the select is a genuine array.
type _tagListNoAny = Expect<NoAny<ArticlesSelect["tagList"]>>;
type _tagListNoNever = Expect<NoNever<ArticlesSelect["tagList"]>>;
type _tagListIsArray = Expect<ExpectArray<ArticlesSelect["tagList"]>>;

// EXACT target: required string array selects as `string[]` (NOT `string[] | null`).
type _tagListSelectExact = Expect<Equal<ArticlesSelect["tagList"], string[]>>;
// And it is NOT the degraded nullable form.
type _tagListSelectNotNullable = Expect<
	Equal<Equal<ArticlesSelect["tagList"], string[] | null>, false>
>;

// Same class, numeric element + numeric-PK collection — proves it is not
// string-specific (covers the `number[]` arm of the cluster).
type _scoresNoAny = Expect<NoAny<TicketsSelect["scores"]>>;
type _scoresSelectExact = Expect<Equal<TicketsSelect["scores"], number[]>>;
type _scoresSelectNotNullable = Expect<
	Equal<Equal<TicketsSelect["scores"], number[] | null>, false>
>;

// ============================================================================
// CL-08.B — REQUIRED no-default array: INSERT is REQUIRED and non-null `T[]`.
// (arr-required-insert-optional — "TypeScript won't flag the missing field")
// ============================================================================

// The key must be REQUIRED — `undefined` must NOT be assignable to it.
type _tagListInsertRequired = Expect<
	Equal<undefined extends ArticlesInsert["tagList"] ? true : false, false>
>;
// EXACT target: required, non-null `string[]` (no `| null`, no `| undefined`).
type _tagListInsertExact = Expect<Equal<ArticlesInsert["tagList"], string[]>>;

// Numeric mirror (matches the `codes: f.number().required().array()` finding shape).
type _scoresInsertRequired = Expect<
	Equal<undefined extends TicketsInsert["scores"] ? true : false, false>
>;
type _scoresInsertExact = Expect<Equal<TicketsInsert["scores"], number[]>>;

// ============================================================================
// CL-08.C — DEFAULTED array: INSERT is OPTIONAL but still non-null `T[]`.
//
// `articles.defTags = f.text().array().default(["new"])`. With the fix the
// field carries `hasDefault:true`, so it is OPTIONAL on insert. The array
// payload itself must remain `string[]` (not widened away).
// ============================================================================

// Optional on insert (a default exists) — `undefined` IS accepted.
type _defTagsInsertOptional = Expect<
	Equal<undefined extends ArticlesInsert["defTags"] ? true : false, true>
>;
// The supplied value, once present, is a `string[]` (default does not widen it).
type _defTagsInsertElem = Expect<
	Equal<Exclude<ArticlesInsert["defTags"], undefined | null>, string[]>
>;

// ============================================================================
// CL-08.D — OPTIONAL array CONTROL: SELECT stays `T[] | null`, INSERT optional.
//
// `articles.optTags = f.text().array()` (no `.required()`, no `.default()`).
// The fix must NOT over-correct optional arrays into non-null.
// ============================================================================

type _optTagsSelectExact = Expect<Equal<ArticlesSelect["optTags"], string[] | null>>;
type _optTagsInsertOptional = Expect<
	Equal<undefined extends ArticlesInsert["optTags"] ? true : false, true>
>;

// ============================================================================
// CL-08.E — SCALAR CONTROL: the fix is array-scoped; scalars are untouched.
// (proposal "scalar control (`I2['qty'] = number`)")
// ============================================================================

type _subjectSelectScalar = Expect<Equal<TicketsSelect["subject"], string>>;
type _subjectInsertScalar = Expect<Equal<TicketsInsert["subject"], string>>;
// A required scalar is also required on insert — proves the required-detection
// is not array-only.
type _subjectInsertRequired = Expect<
	Equal<undefined extends TicketsInsert["subject"] ? true : false, false>
>;

// ============================================================================
// CL-08.F — ORDER-INDEPENDENCE + `.default()`-before-`.array()`.
// (arr-order-dependent-nullability + caveat 3)
//
// These exact orderings are NOT in `_fixtures.ts`, so build the minimal probe
// collection locally with the real factory (only the missing shapes).
// ============================================================================

const orderProbe = collection("order_probe").fields(({ f }) => ({
	// required THEN array  vs  array THEN required — identical runtime semantics.
	reqThenArr: f.text().required().array(),
	arrThenReq: f.text().array().required(),
	// default BEFORE array — the inner default should surface `hasDefault:true`
	// on the wrapped array state (caveat 3: `.default([...]).array()` ordering).
	defThenArr: f.text().default("x").array(),
}));

type OrderSelect = CollectionSelect<typeof orderProbe>;
type OrderInsert = CollectionInsert<typeof orderProbe>;

// Order-independence: both required orderings produce the SAME type, and it is
// the non-null `string[]` (not `string[] | null`).
type _orderSelectSame = Expect<Equal<OrderSelect["reqThenArr"], OrderSelect["arrThenReq"]>>;
type _orderSelectNonNull = Expect<Equal<OrderSelect["reqThenArr"], string[]>>;
type _orderArrThenReqNonNull = Expect<Equal<OrderSelect["arrThenReq"], string[]>>;

// Both required orderings are REQUIRED on insert, identically.
type _orderInsertReqThenArr = Expect<
	Equal<undefined extends OrderInsert["reqThenArr"] ? true : false, false>
>;
type _orderInsertArrThenReq = Expect<
	Equal<undefined extends OrderInsert["arrThenReq"] ? true : false, false>
>;

// `.default()`-before-`.array()` carries the default through the array wrap, so
// the field is OPTIONAL on insert (caveat 3 control).
type _defThenArrInsertOptional = Expect<
	Equal<undefined extends OrderInsert["defThenArr"] ? true : false, true>
>;

// ============================================================================
// CL-08.G — Field-state extractor pinpoint (the actual `ArrayFieldState` seam).
//
// Drive `ExtractSelectType` / `ExtractInputType` over the literal field state of
// the imported array fields so a failure localizes to the state carry-over, not
// just the downstream collection composition.
// ============================================================================

type StateOf<F> = F extends { readonly _: infer S extends FieldState } ? S : never;

// `.fields()` stores the raw `Field<TState>` defs under `state.fieldDefinitions`
// (NOT `state.fields`, which holds the column-extracted shapes, and there is no
// top-level `fields` on the builder). Resolve the literal field state from there
// so a failure pins to the `ArrayFieldState` carry-over — not a wrong path.
type FieldDefs = (typeof articles)["state"]["fieldDefinitions"];

type TagListState = StateOf<FieldDefs["tagList"]>;
type DefTagsState = StateOf<FieldDefs["defTags"]>;
type OptTagsState = StateOf<FieldDefs["optTags"]>;

// The required array's state must carry `notNull: true` (NOT the hardcoded false).
type _tagListStateNotNull = Expect<
	Equal<TagListState extends { notNull: true } ? true : false, true>
>;
// The defaulted array's state must carry `hasDefault: true` (NOT hardcoded false).
type _defTagsStateHasDefault = Expect<
	Equal<DefTagsState extends { hasDefault: true } ? true : false, true>
>;

// Extractors over those states yield the corrected I/O directly.
type _tagListExtractSelect = Expect<Equal<ExtractSelectType<TagListState>, string[]>>;
type _tagListExtractInput = Expect<Equal<ExtractInputType<TagListState>, string[]>>;
// Optional-array control through the extractor: select stays nullable.
type _optTagsExtractSelect = Expect<
	Equal<ExtractSelectType<OptTagsState>, string[] | null>
>;

// ============================================================================
// CL-08.H — GLOBALS: SELECT target (caveat 1 — Drizzle path; record the gap).
//
// `siteGlobal.featureFlags = f.text().required().array()`. TARGET: SELECT
// `string[]`. RED until the global table/SELECT honors the field-def NOT NULL.
// ============================================================================

type _featureFlagsSelectNoAny = Expect<NoAny<SiteSelect["featureFlags"]>>;
type _featureFlagsSelectNoNever = Expect<NoNever<SiteSelect["featureFlags"]>>;
type _featureFlagsSelectExact = Expect<Equal<SiteSelect["featureFlags"], string[]>>;

// ============================================================================
// CL-08.I — GLOBALS WRITE: INSERT/UPDATE target (caveat 1+2 — DE-SCOPED, RED).
//
// Pure-Drizzle `InferGlobalInsert/Update` never reaches `ExtractInputType`, so a
// required global array is mis-typed on the write side. We assert the TARGET so
// the debt is on the burndown (NOT stubbed with `any`). Expected RED until CL-03.
// ============================================================================

// A required, no-default global array must be REQUIRED on insert.
type _featureFlagsInsertRequired = Expect<
	Equal<undefined extends SiteInsert["featureFlags"] ? true : false, false>
>;
// EXACT write target: non-null `string[]`.
type _featureFlagsInsertExact = Expect<Equal<SiteInsert["featureFlags"], string[]>>;
type _featureFlagsInsertNoAny = Expect<NoAny<SiteInsert["featureFlags"]>>;

// UPDATE is `Partial`, so the key is optional — but, once present, its value
// must be the precise non-null `string[]`, not `unknown` / widened.
type _featureFlagsUpdateNoAny = Expect<NoAny<SiteUpdate["featureFlags"]>>;
type _featureFlagsUpdateElem = Expect<
	Equal<Exclude<SiteUpdate["featureFlags"], undefined>, string[]>
>;

// ============================================================================
// CL-08.J — `articles` end-to-end `$infer` $update parity for a required array.
//
// UPDATE is `Partial`, so `tagList` is optional there; but the value type must
// remain the corrected non-null `string[]` (the array correction must not be
// lost on the update path).
// ============================================================================

type _articlesUpdateTagListNoAny = Expect<NoAny<ArticlesUpdate["tagList"]>>;
type _articlesUpdateTagListElem = Expect<
	Equal<Exclude<ArticlesUpdate["tagList"], undefined>, string[]>
>;
