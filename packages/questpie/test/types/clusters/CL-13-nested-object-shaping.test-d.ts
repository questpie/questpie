/**
 * CL-13 — Nested `f.object()` select bypasses field-shaping; `f.json<T>()` self-defeating
 * =====================================================================================
 *
 * GOAL-TESTS (Phase 3a). These encode the CORRECT (target) types for the whole
 * CLASS this cluster fixes. MOST FAIL TO COMPILE TODAY — that is the burndown.
 * Phase 3b edits source to flip them green. Do NOT "fix" these by relaxing them.
 *
 * SOURCE OF THE BUGS (proposal §CL-13 + findings json-3/json-5/json-6):
 *
 *   Fix A (json-3, ROOT) — `InferObjectData` (object.ts:28-36) dispatches purely on
 *     `notNull` and never consults `output`/`virtual`/relationKind. It does NOT reuse
 *     `FieldSelect`/`V2FieldSelect`, so EVERY row-shaping rule that applies to
 *     top-level fields is bypassed for nested fields. An `outputFalse()` field LEAKS
 *     into the nested object select; a nested required `.array()` is shaped wrong; a
 *     nested virtual relation would leak its FK. Target: delegate per-field to
 *     `FieldSelect`, dropping `never` results (single-evaluation form per reviewer §2).
 *
 *   Fix A-extension (reviewer §1) — the PUBLIC `$infer` path leaks too:
 *     `ExtractOutputTypes` (collection.ts:154) routes through `FieldSelect` so a
 *     TOP-LEVEL `outputFalse()` IS dropped there — but the never-filter must be a
 *     first-class shared helper applied at BOTH the nested AND top-level sites. We
 *     assert the invariant directly: a top-level `outputFalse()` field is ABSENT
 *     from the public select (no lingering `never`-typed key).
 *
 *   Fix B (json-6) — `JsonValue` carries `| Record<string, unknown>`, a supertype of
 *     `{ [k:string]: JsonValue }`. So (a) deep index access collapses to `unknown`,
 *     and (b) non-serializable objects (`{ fn: () => void }`) satisfy `JsonValue`.
 *     Target: drop the `Record<string,unknown>` member.
 *
 *   Fix C (json-5) — `json()` / `f.from()` are non-generic; typed free-form JSON
 *     (unions, `Record<string,T>`, custom-column schemas) is unexpressible. Target:
 *     `json<T extends JsonValue = JsonValue>()` and `from<T>(col, ZodType<T>)`.
 *
 * HARD-RULE COMPLIANCE (kit §4.1):
 *   - Identity via `Equal`/`ExactType`, never bare `extends`.
 *   - `IsAny`/`IsUnknown` run on RAW values, never on `NonNullable<…>` (which
 *     collapses to `{}` and passes vacuously). Where a value is `T | null` we probe
 *     key-presence / `NoAny` on the raw union and only `NonNullable` the *object*
 *     once its non-nullness is independently asserted.
 *   - Per the reviewer's Fix-A/B/C note: NO `@ts-expect-error` brackets here — they
 *     mask unrelated failures. Every guarantee is a POSITIVE `Equal`.
 *   - The generic-factory targets (Fix C) are encoded WITHOUT calling `json<T>()` /
 *     `from<T>()` (that would be an illegal type-arg call and break file compilation
 *     today). Instead we pin the TARGET factory signature as a type and assert the
 *     CURRENT `typeof json` / `typeof from` `Equal`s it — RED while non-generic,
 *     green once the generic lands, and the file always compiles.
 */

import type {
	CollectionSelect as CollectionSelectFromApp,
	// public 2-arg field-def selector consumed via AppCollections<TApp>
} from "#questpie/server/collection/crud/types.js";
import type { CollectionSelect as PublicCollectionSelect } from "#questpie/server/collection/builder/collection.js";
import type { Field } from "#questpie/server/fields/field-class.js";
import { collection } from "#questpie/server/collection/builder/collection-builder.js";
import {
	from as fromFactory,
	json as jsonFactory,
	type JsonValue,
} from "#questpie/server/modules/core/fields/index.js";

import type {
	ArrayElement,
	Equal,
	ExactType,
	Expect,
	ExpectArray,
	HasKey,
	IsEmptyObject,
	NoAny,
	NoNever,
	NoUnknown,
} from "../_assert.js";

// `articles` is a runtime const (used via `typeof`); `App` is a type alias.
import { articles } from "../_fixtures.js";
import type { App } from "../_fixtures.js";

// ============================================================================
// FIX A (json-3) — nested `f.object()` select must obey field-shaping.
//
// `articles.meta` = f.object({ seoTitle, seoDescription, featured,
//   internalScore: f.number().outputFalse(), keywords: f.text().required().array() })
//
// Probe the nested object shape through BOTH select pipelines that flow through
// `InferObjectData`:
//   - the 2-arg field-def selector  CollectionSelectFromApp<typeof articles, App>
//   - the 1-arg public selector     PublicCollectionSelect<(typeof articles)["state"]>
// Both must agree, and both must shape nested fields the SAME way top-level fields
// are shaped.
// ============================================================================

type ArticleSelect_App = CollectionSelectFromApp<typeof articles, App>;
type ArticleSelect_Public = PublicCollectionSelect<(typeof articles)["state"]>;

// `meta` is an optional object field (notNull:false) → `Meta | null`. The object
// itself must not be `any`/`unknown`/`never` on the raw union.
type MetaApp = NonNullable<ArticleSelect_App["meta"]>;
type MetaPublic = NonNullable<ArticleSelect_Public["meta"]>;

// The nested object must resolve to a real shape, not collapse to `{}` / `any`.
type _metaApp_notAny = Expect<NoAny<ArticleSelect_App["meta"]>>;
type _metaPublic_notAny = Expect<NoAny<ArticleSelect_Public["meta"]>>;
type _metaApp_notUnknown = Expect<NoUnknown<ArticleSelect_App["meta"]>>;
type _metaPublic_notUnknown = Expect<NoUnknown<ArticleSelect_Public["meta"]>>;
type _metaApp_notEmpty = Expect<Equal<IsEmptyObject<MetaApp>, false>>;
type _metaPublic_notEmpty = Expect<Equal<IsEmptyObject<MetaPublic>, false>>;

// --- THE KEYSTONE: nested `outputFalse()` field must be DROPPED, exactly like a
//     top-level `output:false` field is. RED today (InferObjectData ignores
//     `output`, so `internalScore` LEAKS into the nested select). ---
type _internalScoreAbsent_App = Expect<
	Equal<HasKey<MetaApp, "internalScore">, false>
>;
type _internalScoreAbsent_Public = Expect<
	Equal<HasKey<MetaPublic, "internalScore">, false>
>;

// --- Kept (output:true) nested fields must survive with EXACT types. These are
//     positive controls — they should stay green before AND after the fix, proving
//     the never-filter drops only the right keys. ---
//     seoTitle: f.text(60)        (nullable, notNull:false) → string | null
//     seoDescription: textarea    (nullable)                → string | null
//     featured: boolean.default   (notNull:false)           → boolean | null
type _seoTitle_App = Expect<Equal<MetaApp["seoTitle"], string | null>>;
type _seoTitle_Public = Expect<Equal<MetaPublic["seoTitle"], string | null>>;
type _seoDesc_App = Expect<Equal<MetaApp["seoDescription"], string | null>>;
type _featured_App = Expect<Equal<MetaApp["featured"], boolean | null>>;

// Kept nested fields must be present + precise.
type _seoTitlePresent_App = Expect<Equal<HasKey<MetaApp, "seoTitle">, true>>;
type _keywordsPresent_App = Expect<Equal<HasKey<MetaApp, "keywords">, true>>;

// --- Nested array must be shaped by the SAME contract as a top-level field of the
//     IDENTICAL definition. `meta.keywords` and top-level `articles.tagList` are both
//     `f.text().required().array()`; once `InferObjectData` delegates to `FieldSelect`,
//     the nested value must be type-identical to the top-level one. This is the precise
//     CL-13 invariant ("nested obeys the top-level row-shaping contract") and is robust
//     to CL-08 fixing required-array nullability separately (both move together).
//     RED today: nested dispatch ignores the field's own state and keys only on the
//     OBJECT-field's notNull, so nested ≠ top-level. ---
type _keywordsParityWithTopLevel = ExactType<
	MetaApp["keywords"],
	ArticleSelect_App["tagList"]
>;
type _keywordsParity_Public = ExactType<MetaPublic["keywords"], MetaApp["keywords"]>;
// Element type + array-ness must survive regardless of nullability (catches a nested
// array degrading to a scalar / `any[]` / collapsing). The element is `string`.
type _keywordsIsArray = Expect<ExpectArray<MetaApp["keywords"]>>;
type _keywordsElement = ExactType<ArrayElement<NonNullable<MetaApp["keywords"]>>, string>;
type _keywords_notAny = Expect<NoAny<MetaApp["keywords"]>>;
type _keywords_notNever = Expect<NoNever<MetaApp["keywords"]>>;

// --- Nested element values must never be `any`/`unknown` (the `: unknown` fallback
//     arm of InferObjectData must be unreachable for real fields). ---
type _nestedSeo_notAny = Expect<NoAny<MetaApp["seoTitle"]>>;
type _nestedSeo_notUnknown = Expect<NoUnknown<MetaApp["seoTitle"]>>;
type _nestedFeatured_notUnknown = Expect<NoUnknown<MetaApp["featured"]>>;

// --- Cross-pipeline parity: the 2-arg and 1-arg selectors must produce the SAME
//     nested object shape (both route through InferObjectData; neither may diverge). ---
type _nestedParity = ExactType<MetaApp, MetaPublic>;

// ============================================================================
// FIX A-extension (reviewer §1) — TOP-LEVEL `output:false` must be absent from the
// PUBLIC `$infer`/select shape, with NO lingering `never`-typed key.
//
// The shared fixtures carry no top-level `outputFalse()` field (their only one is
// nested in `meta`). The kit therefore lacks a top-level-output-false shape — add a
// minimal LOCAL collection that exercises exactly this invariant. (Allowed: define a
// fixture only where the shared set lacks the needed shape.)
// ============================================================================

const withHidden = collection("with_hidden").fields(({ f }) => ({
	title: f.text(255).required(),
	// top-level output-only-false (server/write-only) field — must NOT appear in select
	secret: f.text().outputFalse(),
	// a kept control on the same collection
	visible: f.text().required(),
}));

type WithHiddenSelect = PublicCollectionSelect<(typeof withHidden)["state"]>;

// Top-level outputFalse → key fully absent (not present-as-never).
type _topSecretAbsent = Expect<
	Equal<HasKey<WithHiddenSelect, "secret">, false>
>;
// Kept field survives precisely.
type _topVisibleKept = Expect<Equal<WithHiddenSelect["visible"], string>>;
type _topVisiblePresent = Expect<Equal<HasKey<WithHiddenSelect, "visible">, true>>;
// The whole row must not collapse to `{}` from an over-eager never-filter.
type _withHidden_notEmpty = Expect<Equal<IsEmptyObject<WithHiddenSelect>, false>>;

// ============================================================================
// FIX B (json-6) — `JsonValue` must be a STRICT recursive JSON type.
//
// Drop the `| Record<string, unknown>` member so:
//   (b1) non-serializable objects are REJECTED, and
//   (b2) deep index access yields `JsonValue`, not `unknown`.
// ============================================================================

// (b1) A function-bearing object is NOT valid JSON → must not be assignable.
//      RED today: `{ fn } satisfies Record<string,unknown>` makes it assignable.
type _rejectsFn = Expect<
	Equal<{ fn: () => void } extends JsonValue ? true : false, false>
>;
type _rejectsSymbol = Expect<
	Equal<{ s: symbol } extends JsonValue ? true : false, false>
>;

// (b2) Index access on the OBJECT arm of `JsonValue` must yield `JsonValue`, not
//      `unknown`. We pull the object members out of the `JsonValue` union itself and
//      read a string index — TODAY that union is `{[k]:JsonValue} | Record<string,unknown>`,
//      so indexing collapses to `JsonValue | unknown` = `unknown` (RED). After Fix B the
//      union's object arm is only `{[k]:JsonValue}`, so indexing is `JsonValue` (GREEN).
type JsonObjectArm = Extract<JsonValue, Record<string, unknown>>;
type _deepReadIsJsonValue = ExactType<JsonObjectArm[string], JsonValue>;
type _deepRead_notUnknown = Expect<NoUnknown<JsonObjectArm[string]>>;

// Positive control: a plain serializable object MUST stay assignable to JsonValue.
type _acceptsPlain = Expect<
	Equal<{ a: number; b: string[] } extends JsonValue ? true : false, true>
>;
// Primitives + nested arrays still members.
type _acceptsArray = Expect<
	Equal<Array<{ n: number }> extends JsonValue ? true : false, true>
>;

// ============================================================================
// FIX C (json-5) — `f.json<T>()` and `f.from<T>()` must be generic.
//
// Each is encoded as: (1) a stable no-arg baseline control, plus (2) an instantiation
// expression `typeof factory<T>` that is a HARD compile error TODAY (the factory takes
// no type argument) and resolves to the narrowed `data` once the generic lands. The
// error + the paired `Equal` failure are the RED burndown; both clear at the fix.
// ============================================================================

// --- json<T>(): today `json` is non-generic — `data` is the fixed `JsonValue`. The
//     target is `json<T extends JsonValue = JsonValue>()` threading `T` into `data`.
//
//     The no-arg baseline must STAY `JsonValue` (positive control, stable across the
//     fix). The narrowing assertion is encoded the way the finding's regressionTest
//     specifies — `typeof jsonFactory<{ k: number }>` — which is a type error TODAY
//     (the factory takes no type argument) and resolves to `{ k: number }` once the
//     generic lands. That diagnostic IS the RED for json-5; it flips green at the fix
//     with zero risk of a hand-rolled state-shape mismatch leaving it permanently red. ---

/** What `f.json()` (no arg) resolves its `data` to. Must remain `JsonValue` (baseline). */
type JsonBaselineData = ReturnType<typeof jsonFactory> extends Field<infer S>
	? S extends { data: infer D }
		? D
		: never
	: never;
type _jsonBaseline = ExactType<JsonBaselineData, JsonValue>;
type _jsonBaseline_notUnknown = Expect<NoUnknown<JsonBaselineData>>;
type _jsonBaseline_notAny = Expect<NoAny<JsonBaselineData>>;

// Resolve the `data` of a (post-fix) `json<T>()` instance via the instantiation
// expression `typeof jsonFactory<T>`. RED today as a HARD error (TS2558 "Expected 0
// type arguments") on this very line — exactly the burndown signal; it clears the
// moment the generic lands. NO `@ts-expect-error` (a directive would invert the
// red→green direction: it would be unused today and become required after the fix).
type JsonNarrowedData = ReturnType<typeof jsonFactory<{ k: number }>> extends Field<
	infer S
>
	? S extends { data: infer D }
		? D
		: never
	: never;
// POSITIVE companion (kit rule 4): once the generic lands, the narrowed data is exactly
// `{ k: number }`. RED today (the line above errors; this resolves to the fixed default).
type _jsonNarrows = ExactType<JsonNarrowedData, { k: number }>;

// --- from<T>(): the documented escape hatch is hardcoded `data: unknown`. The typed
//     `from<T>(column, ZodType<T>)` overload must yield `data: T`. Same encoding:
//     no-arg baseline control + a `typeof fromFactory<T>` narrowing probe. ---

/** What `f.from(col)` resolves its `data` to today (`unknown`). */
type FromBaselineData = ReturnType<typeof fromFactory> extends {
	readonly _: infer S;
}
	? S extends { data: infer D }
		? D
		: never
	: never;
// Documents the current degraded state (`unknown`); positive control, stays informative.
type _fromBaseline_isUnknownToday = ExactType<FromBaselineData, unknown>;

// Resolve the `data` of a (post-fix) typed `from<T>(col, schema)` via `typeof fromFactory<T>`.
// RED today as a HARD error (TS2558) on this line; clears when `from<T>` lands. No directive
// (same red→green-direction reasoning as the json case above).
type FromNarrowedData = ReturnType<
	typeof fromFactory<{ lat: number; lng: number }>
> extends {
	readonly _: infer S;
}
	? S extends { data: infer D }
		? D
		: never
	: never;
// POSITIVE companion: a typed `from<{lat;lng}>` must yield `data: { lat; lng }`. RED today.
type _fromNarrows = ExactType<FromNarrowedData, { lat: number; lng: number }>;

// ============================================================================
// CROSS-CHECK — the json-3 nested fix and the json-6 JsonValue fix interact:
// once `InferObjectData` delegates to `FieldSelect`, a nested `f.json()` field
// inside an object must surface as `JsonValue | null` (strict), not `unknown`.
// `articles.config`/`articles.body` are TOP-LEVEL json — assert they are strict
// `JsonValue | null` on the select (today they are `JsonValue | null` already via
// FieldSelect, but the element type must be the TIGHTENED JsonValue post-Fix-B). ---
// ============================================================================

type _configIsJson = ExactType<ArticleSelect_App["config"], JsonValue | null>;
type _bodyIsJson = ExactType<ArticleSelect_App["body"], JsonValue | null>;
type _config_notUnknown = Expect<NoUnknown<NonNullable<ArticleSelect_App["config"]>>>;
type _config_notAny = Expect<NoAny<ArticleSelect_App["config"]>>;
