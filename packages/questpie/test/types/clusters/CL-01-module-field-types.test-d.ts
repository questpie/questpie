/**
 * CL-01 — Module-contributed field types (richText / blocks / json / object)
 *         degrade to `unknown` / `any` / `{}` in EVERY select & input shape.
 *
 * ROOT (from typesafety-fix-proposal-2026-06-15.md §CL-01):
 *   - Root A: codegen emits `_AllFieldTypes = Questpie.FieldTypesMap` (builtins
 *     only) instead of `typeof _rawFieldDefs` (builtins + module fields), so
 *     `f.richText`/`f.blocks` resolve to `any`; the stored field def loses its
 *     `_` phantom; `FieldSelect<any>` / `ExtractInputType<FieldState>` clamp the
 *     field's `data` to `unknown` in find/findOne/create/update — server AND
 *     client (FI-1, FI-2, CR-1, crudin-1, clsdk-richtext-unknown).
 *   - Root B: `~fieldTypes?: Record<string, any>` lets a missing/typo'd field
 *     key resolve to `any` with no TS2339 (FI-3). Fix = `~fieldTypes?: unknown`,
 *     so the phantom map has NO string index and `f.notAField` is a hard error.
 *
 * TARGET (after-fix) this file encodes:
 *   1. A module field-STATE carried by `Field<TState>` resolves to its concrete
 *      `data` through `FieldSelect` / `ExtractSelectType` / `ExtractInputType`
 *      (the exact leak sites: field-types.ts:77, field-class-types.ts:255/275).
 *   2. When a field def degrades to the codegen `any`/bare-`FieldState` shape
 *      (the live bug), it MUST NOT silently become `unknown` — these are the
 *      RED assertions whose count is the burndown.
 *   3. The in-package json/object stand-ins (`articles.body/config/meta`) stay
 *      concrete (NOT `unknown`/`any`/`{}`) through the real CRUD pipeline and
 *      through the public `app.collections.X` surface — server == client.
 *   4. The `~fieldTypes` phantom carries NO string index, and a typo'd field
 *      key is a hard error (Root B / FI-3).
 *
 * THESE ARE GOAL TESTS: most assertions FAIL to compile today (the types are
 * degraded). Phase 3b flips them green by editing source. Do NOT "fix" them here.
 *
 * NOTE on richText/blocks: the real `f.richText()`/`f.blocks()` factories live
 * in @questpie/admin, which the `questpie` package cannot import. The fixtures
 * expose `RichTextLikeState`/`BlocksLikeState` (shape-mirrored phantom states)
 * wrapped in `Field<…>` here, so we probe the SAME resolution chain that the
 * generated barbershop app hits — at the field layer, the leak is identical.
 */

import type {
	CollectionInsert,
	CollectionSelect as CollectionSelectFromState,
	CollectionUpdate,
} from "#questpie/server/collection/builder/collection.js";
import type { EmptyCollectionState } from "#questpie/server/collection/builder/types.js";
import type { BuiltinFields } from "#questpie/server/fields/builder.js";
import { Field } from "#questpie/server/fields/field-class.js";
import type {
	ExtractInputType,
	ExtractSelectType,
	FieldState,
} from "#questpie/server/fields/field-class-types.js";
import type { FieldSelect } from "#questpie/server/fields/field-types.js";
import type { JsonValue } from "#questpie/server/modules/core/fields/json.js";

import type {
	Equal,
	Expect,
	HasKey,
	IsAny,
	IsUnknown,
	NoAny,
	NoNever,
	NoStringIndex,
	NotEmptyObject,
	NoUnknown,
} from "../_assert.js";
import type {
	articles,
	BlocksDocumentLike,
	BlocksLikeState,
	QuestpieApp,
	RichTextLikeState,
	TipTapDocumentLike,
} from "../_fixtures.js";

// ===========================================================================
// 0. Sanity — the fixture phantom states are concrete (NOT degraded). If these
//    fail, the fixture itself drifted and every assertion below is meaningless.
// ===========================================================================

type _rtDataConcrete = Expect<NoAny<RichTextLikeState["data"]>>;
type _rtDataIsDoc = Expect<Equal<RichTextLikeState["data"], TipTapDocumentLike>>;
type _blDataConcrete = Expect<NoAny<BlocksLikeState["data"]>>;
type _blDataIsDoc = Expect<Equal<BlocksLikeState["data"], BlocksDocumentLike>>;

// A module field's state, the way it is STORED after `.fields()` — a
// `Field<TState>` whose phantom `_` carries the real state. This is exactly the
// dispatch shape `FieldSelect` / `ExtractInputType` consume.
type RichTextDef = Field<RichTextLikeState>;
type BlocksDef = Field<BlocksLikeState>;

// ===========================================================================
// 1. CLASS: field-RESOLUTION preserves a module field's data type.
//
//    These assert the contract `FieldSelect`/`ExtractSelectType`/
//    `ExtractInputType` MUST uphold for ANY module-contributed field — the
//    whole class CL-01 fixes, not just richText. With a correctly-phantomed
//    `Field<state>` the resolvers already hold; that is the *target*, pinned so
//    a future regression that re-erases module fields at the resolver is caught.
// ===========================================================================

// --- SELECT (output row) — nullable field ⇒ `data | null`, never unknown/any.
type RtSelect = FieldSelect<RichTextDef>;
type _rtSelNotUnknown = Expect<NoUnknown<RtSelect>>;
type _rtSelNotAny = Expect<NoAny<RtSelect>>;
type _rtSelNotEmpty = Expect<NotEmptyObject<NonNullable<RtSelect>>>;
type _rtSelExact = Expect<Equal<RtSelect, TipTapDocumentLike | null>>;

type BlSelect = FieldSelect<BlocksDef>;
type _blSelNotUnknown = Expect<NoUnknown<BlSelect>>;
type _blSelExact = Expect<Equal<BlSelect, BlocksDocumentLike | null>>;

// --- ExtractSelectType reads the same state directly (used by globals too).
type _rtExtractSel = Expect<
	Equal<ExtractSelectType<RichTextLikeState>, TipTapDocumentLike | null>
>;
type _blExtractSel = Expect<
	Equal<ExtractSelectType<BlocksLikeState>, BlocksDocumentLike | null>
>;

// --- INPUT (create/update) — nullable+no-default ⇒ `data | null | undefined`.
type RtInput = ExtractInputType<RichTextLikeState>;
type _rtInNotUnknown = Expect<NoUnknown<RtInput>>;
type _rtInNotAny = Expect<NoAny<RtInput>>;
type _rtInExact = Expect<
	Equal<RtInput, TipTapDocumentLike | null | undefined>
>;

type BlInput = ExtractInputType<BlocksLikeState>;
type _blInNotUnknown = Expect<NoUnknown<BlInput>>;
type _blInExact = Expect<
	Equal<BlInput, BlocksDocumentLike | null | undefined>
>;

// ===========================================================================
// 2. THE LIVE BUG — codegen degradation path (FI-1/FI-2/CR-1/crudin-1).
//
//    When `f.richText`/`f.blocks` are absent from the field-type map they
//    resolve to `any`, the field def becomes `Field<any>` (or loses the phantom
//    entirely), and the resolvers clamp data to `unknown`. We assert the FIXED
//    behavior: a degraded module-field def must NOT collapse select/input to
//    `unknown` or `any`. These FAIL today (that is the burndown).
// ===========================================================================

// A def whose state is `any` — the shape produced when `f.<moduleField>` is
// missing from the map (FI-1: `IsAny<f.richText> === true`). The fix routes the
// field type from `typeof _rawFieldDefs`, so this case should never arise; we
// encode the post-fix invariant: such a def is NOT an information-free leak.
type DegradedAnyDef = Field<any>;
// FAILS today: FieldSelect<Field<any>> resolves to `any`.
type _degAnySelNotAny = Expect<NoAny<FieldSelect<DegradedAnyDef>>>;
// FAILS today: ExtractInputType<any-state> → `any`.
type _degAnyInNotAny = Expect<NoAny<ExtractInputType<any>>>;

// A def whose phantom `_` is the BARE `FieldState` (data: unknown) — the shape
// when the module factory's precise state did not survive the registry boundary
// (CR-1: "the richText field def carries NO `_` phantom"). The fix keeps the
// concrete state; post-fix neither select nor input is `unknown`.
type DegradedBareDef = Field<FieldState>;
// FAILS today: bare FieldState has data: unknown ⇒ select is `unknown | null`.
type _degBareSelNotUnknown = Expect<NoUnknown<NonNullable<FieldSelect<DegradedBareDef>>>>;
// FAILS today: ExtractInputType<FieldState> → `unknown | null | undefined`.
type _degBareInNotUnknown = Expect<NoUnknown<
	Exclude<ExtractInputType<FieldState>, null | undefined>
>>;

// ===========================================================================
// 3. IN-PACKAGE STAND-INS through the REAL CRUD pipeline.
//
//    `articles.body`/`articles.config` (f.json) and `articles.meta` (f.object)
//    are the reachable analogues of richText/blocks. They exercise the full
//    CollectionSelect/Insert/Update + `app.collections.articles` surface — the
//    same chain that yields `unknown` for richText in the generated app.
// ===========================================================================

type ArticlesState = (typeof articles)["state"];

type ArtSelect = CollectionSelectFromState<ArticlesState>;
type ArtInsert = CollectionInsert<ArticlesState>;
type ArtUpdate = CollectionUpdate<ArticlesState>;

// --- json field (`body`) — SELECT: `JsonValue | null`, not unknown/any/{}.
type BodySel = ArtSelect["body"];
type _bodySelNotUnknown = Expect<NoUnknown<BodySel>>;
type _bodySelNotAny = Expect<NoAny<BodySel>>;
type _bodySelExact = Expect<Equal<BodySel, JsonValue | null>>;

// --- json field (`config`) — INPUT (create) stays JsonValue, not unknown.
type ConfigIn = ArtInsert extends { config?: infer C } ? C : never;
type _configInNotUnknown = Expect<NoUnknown<ConfigIn>>;
type _configInNotAny = Expect<NoAny<ConfigIn>>;
type _configInIsJson = Expect<Equal<ConfigIn, JsonValue>>;

// --- object field (`meta`) — SELECT: a concrete shaped object, NOT unknown/{}.
type MetaSel = NonNullable<ArtSelect["meta"]>;
type _metaSelNotUnknown = Expect<NoUnknown<MetaSel>>;
type _metaSelNotEmpty = Expect<NotEmptyObject<MetaSel>>;
type _metaSelHasKey = Expect<HasKey<MetaSel, "seoTitle">>;
// nested-field shaping (json-3 class): the nested required array survives.
type _metaKeywords = Expect<Equal<MetaSel["keywords"], string[]>>;
// output-false field is dropped from the row (NOT present as unknown).
type _metaNoInternalScore = Expect<Equal<HasKey<MetaSel, "internalScore">, false>>;

// --- object field (`meta`) — INPUT survives shaping, not unknown/any.
type MetaIn = ArtInsert extends { meta?: infer M } ? M : never;
type _metaInNotUnknown = Expect<NoUnknown<MetaIn>>;
type _metaInNotAny = Expect<NoAny<MetaIn>>;

// --- UPDATE shape mirrors INSERT (Partial) — object/json stay concrete.
type ConfigUpd = ArtUpdate extends { config?: infer C } ? C : never;
type _configUpdNotUnknown = Expect<NoUnknown<ConfigUpd>>;
type _configUpdNotAny = Expect<NoAny<ConfigUpd>>;

// ===========================================================================
// 4. PUBLIC SURFACE — `app.collections.articles` find/findOne/create.
//
//    The findings probe the real `App["collections"][X]` CRUD methods; mirror
//    that so the fix is verified at the user-facing boundary (clsdk parity:
//    server == client output for these field types).
// ===========================================================================

type ArticlesAPI = QuestpieApp["collections"]["articles"];

type FindRow = Awaited<ReturnType<ArticlesAPI["find"]>>["docs"][number];
type _apiBodyNotUnknown = Expect<NoUnknown<FindRow["body"]>>;
type _apiBodyNotAny = Expect<NoAny<FindRow["body"]>>;
type _apiBodyExact = Expect<Equal<FindRow["body"], JsonValue | null>>;

type _apiMetaNotUnknown = Expect<NoUnknown<NonNullable<FindRow["meta"]>>>;
type _apiMetaNotEmpty = Expect<NotEmptyObject<NonNullable<FindRow["meta"]>>>;

type FindOneRow = NonNullable<Awaited<ReturnType<ArticlesAPI["findOne"]>>>;
type _apiFindOneBodyNotUnknown = Expect<NoUnknown<FindOneRow["body"]>>;

type CreateArg = Parameters<ArticlesAPI["create"]>[0];
type CreateBodyIn = CreateArg extends { body?: infer B } ? B : never;
type _apiCreateBodyNotUnknown = Expect<NoUnknown<CreateBodyIn>>;
type _apiCreateBodyNotAny = Expect<NoAny<CreateBodyIn>>;

// ===========================================================================
// 5. Root B — `~fieldTypes` carries NO string index; typo'd key is an error.
//
//    `~fieldTypes?: Record<string, any>` ⇒ `string extends keyof map` is true,
//    so a typo'd field resolves to `any`. Fix = `unknown`, which intersects
//    away the string index. NoStringIndex FAILS today (RED).
// ===========================================================================

// The phantom field-type map a freshly-created collection carries. With the
// `Record<string, any>` default this has a string index (the bug).
type EmptyFT = NonNullable<EmptyCollectionState<"x">["~fieldTypes"]>;
// FAILS today: `string extends keyof Record<string, any>` is true.
type _noPhantomIndex = Expect<NoStringIndex<EmptyFT>>;

// With the builtin map there is also no string index AND `richText` is genuinely
// absent (so a typo on it can't masquerade as a real key).
type _builtinNoIndex = Expect<NoStringIndex<BuiltinFields>>;
type _richTextAbsentFromBuiltins = Expect<
	Equal<HasKey<BuiltinFields, "richText">, false>
>;

// FI-3 — accessing a non-existent field key on the `.fields()` callback `f`
// must be a hard error, not silent `any`. `f` is `BuiltinFields` for a direct
// `collection()`; a missing key currently resolves to `any` with no TS2339.
//
// Paired positive control: a REAL builtin key resolves to a precise factory.
declare const f: BuiltinFields;
type _jsonIsReal = Expect<NoAny<(typeof f)["json"]>>;
// @ts-expect-error — `notARealField` does not exist on the field map (Root B).
type _typoArm = (typeof f)["notARealField"];

// ===========================================================================
// 6. NEGATIVE CONTROL — builtins must stay precise (the fix must not over-widen).
//    If these fail, the fix broke scalar fields — a hard regression.
// ===========================================================================

type _titleStaysString = Expect<Equal<ArtSelect["title"], string>>;
type _slugStaysString = Expect<Equal<ArtSelect["slug"], string>>;
// json input on a builtin is never `any`/`never` either (it is the control for
// "module-field fix didn't disturb the builtin json path").
type _configInNoNever = Expect<NoNever<ConfigIn>>;
type _bodySelNoNever = Expect<NoNever<NonNullable<BodySel>>>;

// Guard against unused-import elision in some toolchains.
export type __CL01_KEEP = [
	Field<FieldState>,
	IsAny<unknown>,
	IsUnknown<unknown>,
];
