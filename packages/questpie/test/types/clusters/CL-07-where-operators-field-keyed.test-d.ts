/**
 * CL-07 — WHERE operator value types are fixed singletons, not field-data-parameterized.
 *
 * ROOT CAUSE (real). Each field pins a FROZEN operator-set singleton whose value
 * types are hardcoded; `TState["data"]` never flows into the operators. Symptoms:
 *   - select() `where` widens the literal union to `string` (eq/ne) / `string[]` (in/notIn)   [WO-1, FGC-2]
 *   - `.array()` routes EVERY element type through `selectMultiOps` (string[]), so a
 *     `number[]` field accepts `string[]` and rejects `number[]`                              [WO-2, FGC-4, arr-multiops]
 *   - `f.json` exposes `eq: unknown` / `in: unknown[]` — zero filter safety                    [WO-4, json-4]
 *   - aggregation `_min`/`_max` leaves are `any` (while `_sum`/`_avg` are `number`)            [FGC-6]
 *
 * TARGET TYPES — per the reviewer's STRONGER ALTERNATIVE (the original design is graded
 * `flawed`; §3 CL-07). The where-INPUT type is DECOUPLED from the stored `data` type and
 * the op-sets become generic over the field's filter value:
 *   - select scalar:  eq/ne = the literal UNION,  in/notIn = UNION[]
 *   - number[]:       contains = number,  containsAll/containsAny = number[],  length stays number
 *   - text[]  (control): element stays string  (string[] happens to be correct here)
 *   - datetime[] :     eq = DateInput[]   (decoupled — NOT Date[], so string-dates keep working)
 *   - DATE / DATETIME scalar:  eq/gt = DateInput   (DELIBERATELY differs from stored `data`;
 *                              this is ALREADY correct today and MUST STAY GREEN — no regression)
 *   - typed json:     eq = the typed shape (untyped `f.json()` → eq = JsonValue, NOT unknown)
 *   - belongsTo FK:   eq stays the string FK; `is`/`isNot` untouched
 *   - aggregation:    _min/_max numeric leaves = number (not any)
 *
 * Most assertions below FAIL to compile TODAY (the burndown). The date assertions are
 * the reviewer's required non-regression guard and are GREEN today — they must STAY green.
 *
 * HARD-RULE compliance (kit §4.1):
 *   - identity via `Equal`/`ExactType`, never bare `extends`.
 *   - field-level where on a collection is a `FieldSelect | FieldWhere` UNION (WO-3) — isolate the
 *     operator object with the kit's `Ops<W>` before probing keys, else a non-object union member
 *     pollutes the inferred value with `unknown`.
 *   - operator values arrive optional (`OperatorsToWhereInput` → `T | undefined`); assertions target
 *     `<value> | undefined` to match the REAL surface (mirrors unified-api-types.test-d.ts).
 *   - `IsUnknown`/`IsAny` guards run on the RAW indexed value (already `unknown`/`any`, no NonNullable).
 *   - probes go through the real `Where<Collection, App>` surface and the public `find` params.
 */

import type {
	AggregationResult,
	FindOptions,
	Where as WhereType,
} from "#questpie/server/collection/crud/types.js";
import type { FieldWhere } from "#questpie/server/fields/field-types.js";
import { datetime } from "#questpie/server/modules/core/fields/datetime.js";
import type { JsonValue } from "#questpie/server/modules/core/fields/json.js";
import type { DateInput } from "#questpie/shared/type-utils.js";

import type {
	Equal,
	ExactType,
	Expect,
	NoAny,
	NoUnknown,
	Ops,
} from "../_assert.js";
import type { App, articles, QuestpieApp, tickets } from "../_fixtures.js";

// ============================================================================
// Helpers — reach a field's operator object off the real collection-level Where.
//
// `WhereType<typeof C, App>[K]` is `FieldSelect<field> | FieldWhere<field>` (the
// direct-value shorthand UNIONED with the operator object). `Ops<W>` isolates the
// operator object (= `Extract<NonNullable<W>, object>`) so key probes are clean.
// ============================================================================

type ArticleWhere = WhereType<typeof articles, App>;
type TicketWhere = WhereType<typeof tickets, App>;

/** The operator object for field K of collection-where W. */
type FieldOps<W, K extends keyof W> = Ops<W[K]>;

// ============================================================================
// WO-1 / FGC-2 — SELECT scalar where: eq/ne = literal UNION, in/notIn = UNION[]
//
// Today: eq/ne degrade to `string`, in/notIn to `string[]` (singleton selectSingleOps).
// ============================================================================

type StatusOps = FieldOps<ArticleWhere, "status">;
type StatusUnion = "draft" | "review" | "published";

// eq — RED today (resolves to `string | undefined`).
type _statusEq = ExactType<StatusOps["eq"], StatusUnion | undefined>;
// ne — RED today.
type _statusNe = ExactType<StatusOps["ne"], StatusUnion | undefined>;
// in — RED today (resolves to `string[] | undefined`).
type _statusIn = ExactType<StatusOps["in"], StatusUnion[] | undefined>;
// notIn — RED today.
type _statusNotIn = ExactType<StatusOps["notIn"], StatusUnion[] | undefined>;
// The value must not silently widen to bare `string` even structurally.
type _statusEqNotString = Expect<
	Equal<Equal<StatusOps["eq"], string | undefined>, false>
>;

// Second select field on a DIFFERENT collection — proves it is the whole CLASS,
// not one hardcoded example.
type PriorityOps = FieldOps<TicketWhere, "priority">;
type PriorityUnion = "low" | "medium" | "high";
type _priorityEq = ExactType<PriorityOps["eq"], PriorityUnion | undefined>;
type _priorityIn = ExactType<PriorityOps["in"], PriorityUnion[] | undefined>;

// Negative control via the REAL public `find` params (proposal: "end-to-end via find").
// Positive companion (the value the call SHOULD accept) + a paired @ts-expect-error so the
// guarantee can't be masked. `@ts-expect-error` fires once select narrows the literal union.
type ArticleFindWhere = NonNullable<
	NonNullable<FindOptions<typeof articles, App>>["where"]
>;
const _statusFindOk: ArticleFindWhere = { status: { eq: "published" } };
const _statusFindGarbage: ArticleFindWhere = {
	// @ts-expect-error — "not-a-status" is not in the literal union (RED until select narrows)
	status: { eq: "not-a-status" },
};

// ============================================================================
// WO-2 / FGC-4 / arr-multiops — ARRAY where keyed by the INNER element type
//
// `number[]` field: contains = number, containsAll/containsAny = number[], length = number.
// Today: ArrayFieldState hardcodes `selectMultiOps` (string[]/string), so the element type is lost.
// ============================================================================

type ScoresOps = FieldOps<TicketWhere, "scores">; // tickets.scores = f.number().required().array()

// Soft key-read so an operator MISSING today (e.g. the proposal's target
// per-element `contains` on arrays) resolves to `never` — a clean `Equal`
// mismatch (RED) — rather than a TS2339 "property does not exist" error.
// Once the op-set gains the key it yields the real value type (GREEN).
type ArrOpVal<O, K extends string> = O extends { [P in K]?: infer V }
	? V
	: never;

// containsAll — RED today (resolves to `string[] | undefined`).
type _scoresContainsAll = ExactType<
	ScoresOps["containsAll"],
	number[] | undefined
>;
// containsAny — RED today.
type _scoresContainsAny = ExactType<
	ScoresOps["containsAny"],
	number[] | undefined
>;
// eq (whole-array equality) — RED today (`string[] | undefined`).
type _scoresEq = ExactType<ScoresOps["eq"], number[] | undefined>;
// `contains` (single-element membership) — RED today: `selectMultiOps` has NO
// `contains` key, so it resolves to `never`; the proposal's target adds
// `contains = number` (CL-07 regression list: "`number[]` `contains = number`").
type _scoresContains = ExactType<ArrOpVal<ScoresOps, "contains">, number>;
// `length` is genuinely numeric and must STAY `number` (a fix that re-keys
// everything off the element type would break this). GREEN today, stays green.
type _scoresLength = ExactType<ScoresOps["length"], number | undefined>;
// Must not accept the wrong (string) element type, even structurally.
type _scoresContainsAllNotString = Expect<
	Equal<Equal<ScoresOps["containsAll"], string[] | undefined>, false>
>;

// CONTROL — a `text[]` array field. The element type `string` is ALREADY correct
// here (`string[]` ops over a string array), so `containsAll` stays GREEN before
// AND after the fix — proving the fix is element-keyed, not a blanket rewrite.
type TagListOps = FieldOps<ArticleWhere, "tagList">; // articles.tagList = f.text().required().array()
type _tagListContainsAll = ExactType<
	TagListOps["containsAll"],
	string[] | undefined
>;
// Per-element `contains` on a text array → `string`. RED today (no `contains` key
// on `selectMultiOps`), GREEN once the array op-set gains `contains`.
type _tagListContains = ExactType<ArrOpVal<TagListOps, "contains">, string>;

// DATE array — the reviewer's internal-contradiction guard: a `datetime().array()` field's
// `eq` must be `DateInput[]` (decoupled where-input), NOT `Date[]` (the stored element type).
// Fixtures have no datetime[] field, so build a raw one (kit/fixtures lack this shape).
const _datetimeArrayField = datetime().array();
type DatetimeArrayWhere = FieldWhere<typeof _datetimeArrayField, unknown>;
// RED today (`string[] | undefined`); after fix `DateInput[] | undefined`, NOT `Date[] | undefined`.
type _dtArrayEq = ExactType<DatetimeArrayWhere["eq"], DateInput[] | undefined>;
type _dtArrayContainsAll = ExactType<
	DatetimeArrayWhere["containsAll"],
	DateInput[] | undefined
>;
// length stays numeric on a date array too.
type _dtArrayLength = ExactType<
	DatetimeArrayWhere["length"],
	number | undefined
>;

// ============================================================================
// WO-4 / json-4 — JSON where operators must NOT be `unknown`
//
// Untyped `f.json()` → eq/ne = JsonValue, in/notIn = JsonValue[] (decoupled filter value).
// Today: basicOps pins `operator<unknown, unknown>`, so eq = unknown (zero filter safety).
// ============================================================================

type BodyOps = FieldOps<ArticleWhere, "body">; // articles.body = f.json()
type ConfigOps = FieldOps<ArticleWhere, "config">; // articles.config = f.json()

// eq must not be `unknown` — RED today (IsUnknown === true). Guard runs on the RAW value.
type _bodyEqNotUnknown = Expect<NoUnknown<BodyOps["eq"]>>;
type _bodyEqNotAny = Expect<NoAny<BodyOps["eq"]>>;
// Positive companion: the precise target value for an untyped json field.
type _bodyEqExact = ExactType<BodyOps["eq"], JsonValue | undefined>;
type _bodyInExact = ExactType<BodyOps["in"], JsonValue[] | undefined>;
// Second json field — whole-class coverage, not one example.
type _configEqNotUnknown = Expect<NoUnknown<ConfigOps["eq"]>>;
type _configNeNotUnknown = Expect<NoUnknown<ConfigOps["ne"]>>;

// ============================================================================
// WO-3 — the introspection footgun itself: probing the RAW union member (not Ops<>)
// pollutes the inferred value with `unknown`. This documents WHY every probe above
// goes through `Ops<>`. The Ops-guarded extraction is unambiguous (GREEN once select
// narrows; the point is that the bare-union form is unreliable regardless).
// ============================================================================

// Bare-union extraction is now CLEAN (regression guard). The whereInput seam makes a
// scalar select's `status` filter a concrete union `(literals) | OperatorObject`, and
// `(union) extends { eq?: infer V }` is a WHOLE-union (indexed-access) check — NOT
// distributive — so it collapses to `never`, never `unknown`. (The original assertion
// here asserted the OLD pollution footgun, which is mathematically unsatisfiable for a
// scalar select and contradicted this cluster's own narrowing assertions above — see
// CL-07 batch-6 research notes.) The real guarantee (Ops isolates the operator object)
// is asserted by `_wo3OpsCleanNotUnknown` below.
type _bareUnionEqVal = ArticleWhere["status"] extends { eq?: infer V }
	? V
	: never;
type _wo3BareUnionNotPolluted = Expect<NoUnknown<_bareUnionEqVal>>;
// Ops-guarded extraction (RIGHT approach) — clean, no `unknown` pollution.
type _wo3OpsCleanNotUnknown = Expect<NoUnknown<StatusOps["eq"]>>;

// ============================================================================
// DATE NON-REGRESSION (reviewer-mandated) — the where-input deliberately differs
// from the stored `data` type. These are ALREADY CORRECT today and MUST STAY GREEN.
// articles.publishedOn = f.date() (data: string), publishedAt = f.datetime() (data: Date);
// both expose dateOps whose eq/gt are `operator<DateInput, unknown>`.
// ============================================================================

type PublishedAtOps = FieldOps<ArticleWhere, "publishedAt">; // f.datetime()
type PublishedOnOps = FieldOps<ArticleWhere, "publishedOn">; // f.date()

// datetime eq/gt = DateInput (green today, stays green after fix).
type _publishedAtEq = ExactType<PublishedAtOps["eq"], DateInput | undefined>;
type _publishedAtGt = ExactType<PublishedAtOps["gt"], DateInput | undefined>;
// date eq/gt = DateInput too (string-mode storage, but DateInput where-input).
type _publishedOnEq = ExactType<PublishedOnOps["eq"], DateInput | undefined>;
type _publishedOnGt = ExactType<PublishedOnOps["gt"], DateInput | undefined>;
// Explicit regression sentinel: datetime where-input must NOT collapse to the stored `Date`.
type _publishedAtEqNotDate = Expect<
	Equal<Equal<PublishedAtOps["eq"], Date | undefined>, false>
>;

// ============================================================================
// belongsTo relation FK — eq stays the string FK; `is`/`isNot` untouched.
// articles.author = f.relation("authors").required() (to-one). The where-operator
// value for the FK shorthand must remain `string` (not get re-keyed off field data),
// and the relational `is`/`isNot` nested-where must survive.
// ============================================================================

type AuthorRelWhere = ArticleWhere["author"];
// `is` accepts a nested author where (to-one relation predicate) — stays present.
const _authorIs: ArticleWhere = { author: { is: { name: { eq: "Ada" } } } };
const _authorIsNot: ArticleWhere = {
	author: { isNot: { name: { eq: "Ada" } } },
};
// The FK direct-value shorthand stays a `string` (assignable), proving eq is not re-keyed.
const _authorFkString: ArticleWhere = { author: "author-id-123" };
// Guard: the relation where union is not degraded to any/unknown.
type _authorRelNotAny = Expect<NoAny<NonNullable<AuthorRelWhere>>>;

// ============================================================================
// FGC-6 — aggregation `_min`/`_max` numeric leaves are `number`, not `any`.
// `_sum`/`_avg` are already `number`; `_min`/`_max` map to `any` today.
// ============================================================================

type Agg = AggregationResult<{
	_min: { rating: true };
	_max: { rating: true };
	_sum: { rating: true };
	_avg: { rating: true };
}>;

// _min/_max leaves must NOT be `any` — RED today.
type _minNotAny = Expect<NoAny<Agg["_min"]["rating"]>>;
type _maxNotAny = Expect<NoAny<Agg["_max"]["rating"]>>;
// Positive companion: numeric field → number (consistent with _sum/_avg).
type _minIsNumber = ExactType<Agg["_min"]["rating"], number>;
type _maxIsNumber = ExactType<Agg["_max"]["rating"], number>;
// Control — _sum/_avg already correct (green today, stays green).
type _sumIsNumber = ExactType<Agg["_sum"]["rating"], number>;
type _avgIsNumber = ExactType<Agg["_avg"]["rating"], number>;

// ============================================================================
// End-to-end via the public app surface — the same select/json/array degradations
// must be fixed on `QuestpieApp["collections"].X.find(...)` params, not just the raw
// `Where<>` helper. Probe the field-where reached through the real CRUD method.
// ============================================================================

type FindArg = NonNullable<
	Parameters<QuestpieApp["collections"]["articles"]["find"]>[0]
>;
type FindWhere = NonNullable<FindArg["where"]>;
type FindStatusOps = Ops<FindWhere["status"]>;
// RED today through the real public API too.
type _findStatusEq = ExactType<FindStatusOps["eq"], StatusUnion | undefined>;
type _findStatusIn = ExactType<FindStatusOps["in"], StatusUnion[] | undefined>;
