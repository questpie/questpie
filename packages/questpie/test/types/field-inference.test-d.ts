/**
 * Field inference contract — the refactor harness for `FieldWithMethods`.
 *
 * This file exists to make deep surgery on the field type layer SAFE. That type
 * is the hottest thing in the checker (5 of the top 8 `structuredTypeRelatedTo`
 * comparisons), so it will keep being restructured for performance, and the
 * failure mode of every such restructure is the same: the type collapses to
 * something cheap and permissive, tsc reports 0 errors, and field inference is
 * silently gone.
 *
 * THEREFORE: every positive assertion here MUST have an `@ts-expect-error` twin.
 * A positive assertion alone proves nothing — `const x: S["notNull"] = true`
 * passes happily when `S` is `any`. The twin is what fails loudly on a collapse,
 * because an `@ts-expect-error` over a line that stopped erroring is itself an
 * error. If you add a case here without a twin, you have added decoration.
 *
 * `Expect<Equal<…>>` is used alongside for exactness (literal `true` vs
 * `boolean`), since assignability alone would accept a widened state.
 *
 * The per-field-type cross product in section 5 is written as ONE parameterised
 * matrix rather than 15 copies of the same 26 blocks. Its twins are three:
 *   - per field, the SAME matrix fed a deliberately wrong `type`/`data` pair,
 *     under `@ts-expect-error` — proves that field's row discriminates;
 *   - once, the matrix fed a state collapsed to `any`;
 *   - once, the matrix fed a state widened to `boolean`/`string`/`unknown`.
 * The last two are the harness testing itself against the exact two shapes a
 * bad refactor produces. A matrix that cannot reject them is decoration too.
 *
 * Compile-time only — run with: bunx tsc --noEmit
 */

import { z } from "zod";

import type { FieldState } from "#questpie/server/fields/field-class-types.js";
import type { FieldWithMethods } from "#questpie/server/fields/field-with-methods.js";
import { stringOps } from "#questpie/server/fields/operators/builtin.js";
import { boolean } from "#questpie/server/modules/core/fields/boolean.js";
import { date } from "#questpie/server/modules/core/fields/date.js";
import { datetime } from "#questpie/server/modules/core/fields/datetime.js";
import { email } from "#questpie/server/modules/core/fields/email.js";
import { from } from "#questpie/server/modules/core/fields/from.js";
import { json } from "#questpie/server/modules/core/fields/json.js";
import { number } from "#questpie/server/modules/core/fields/number.js";
import { object } from "#questpie/server/modules/core/fields/object.js";
import { relation } from "#questpie/server/modules/core/fields/relation.js";
import { select } from "#questpie/server/modules/core/fields/select.js";
import { text } from "#questpie/server/modules/core/fields/text.js";
import { textarea } from "#questpie/server/modules/core/fields/textarea.js";
import { time } from "#questpie/server/modules/core/fields/time.js";
import { upload } from "#questpie/server/modules/core/fields/upload.js";
import { url } from "#questpie/server/modules/core/fields/url.js";
import type { I18nText } from "#questpie/shared/i18n/types.js";

import type { Equal, Expect, IsAny } from "./type-test-utils.js";

/** State of a built field — the phantom `_` the wrapper maps transition on. */
type StateOf<F> = F extends { readonly _: infer S } ? S : never;

/**
 * Read one property, through a conditional rather than an index signature.
 * `StateOf<F>` is a deferred conditional inside a generic body, which TS refuses
 * to index directly; this also gives the behaviour the twins need — a state that
 * collapsed to `any` yields `any`, and `Equal<any, …>` is `false`.
 */
type Prop<S, K extends PropertyKey> = S extends Record<K, infer V> ? V : never;
/** One key of a built field's state. */
type SK<F, K extends PropertyKey> = Prop<StateOf<F>, K>;
/** One Drizzle column marker — `NotNull<>` / `HasDefault<>` land in `column._`. */
type ColMark<F, K extends PropertyKey> = Prop<Prop<SK<F, "column">, "_">, K>;

/** Every element of a tuple of checks must be `true`. Forces the whole tuple. */
type AllTrue<T extends readonly boolean[]> = T[number] extends true
	? true
	: false;

/**
 * A branded operator set. `.operators()` must carry `TOps` through UN-ERASED —
 * routing it through a mapped `(...args: infer A)` would degrade the parameter
 * to the bare `OperatorSetDefinition` constraint and this brand would vanish.
 */
const brandedOps = { ...stringOps, brand: "custom" as const };

// ============================================================================
// 0. The state must never be `any` — every field type
//
// This is the single check that catches a total collapse. Everything below is
// meaningless if this fails.
// ============================================================================

type _NotAny = Expect<Equal<IsAny<StateOf<ReturnType<typeof text>>>, false>>;
type _NotAnyChained = Expect<
	Equal<IsAny<StateOf<ReturnType<typeof text>["required"]>>, false>
>;

// ============================================================================
// 1. Common transitions — each one, on a representative field
//
// Every block is: exact assertion, then the twin that must still error.
// ============================================================================

type S_required = StateOf<ReturnType<ReturnType<typeof text>["required"]>>;
type _Required = Expect<Equal<S_required["notNull"], true>>;
// @ts-expect-error `notNull` is the literal `true`, not `boolean`.
const _twinRequired: S_required["notNull"] = false as boolean;

type S_localized = StateOf<ReturnType<ReturnType<typeof text>["localized"]>>;
type _Localized = Expect<Equal<S_localized["localized"], true>>;
// @ts-expect-error `localized` is the literal `true`.
const _twinLocalized: S_localized["localized"] = false as boolean;

type S_default = StateOf<ReturnType<ReturnType<typeof text>["default"]>>;
type _Default = Expect<Equal<S_default["hasDefault"], true>>;
// @ts-expect-error `hasDefault` is the literal `true`.
const _twinDefault: S_default["hasDefault"] = false as boolean;

type S_array = StateOf<ReturnType<ReturnType<typeof text>["array"]>>;
type _Array = Expect<Equal<S_array["isArray"], true>>;
type _ArrayData = Expect<Equal<S_array["data"], string[]>>;
// @ts-expect-error `array()` lifts `data` to `string[]`, not `string`.
const _twinArray: S_array["data"] = "" as string;

type S_virtual = StateOf<ReturnType<ReturnType<typeof text>["virtual"]>>;
type _Virtual = Expect<Equal<S_virtual["virtual"], true>>;
type _VirtualCol = Expect<Equal<S_virtual["column"], null>>;
// @ts-expect-error `virtual()` pins `column` to `null`.
const _twinVirtual: S_virtual["column"] = {} as object;

type S_inputFalse = StateOf<ReturnType<ReturnType<typeof text>["inputFalse"]>>;
type _InputFalse = Expect<Equal<S_inputFalse["input"], false>>;
// @ts-expect-error `input` is the literal `false`.
const _twinInputFalse: S_inputFalse["input"] = true as boolean;

type S_inputOptional = StateOf<
	ReturnType<ReturnType<typeof text>["inputOptional"]>
>;
type _InputOptional = Expect<Equal<S_inputOptional["input"], "optional">>;
// @ts-expect-error `input` is the literal `"optional"`.
const _twinInputOptional: S_inputOptional["input"] = "" as string;

type S_inputTrue = StateOf<
	ReturnType<ReturnType<ReturnType<typeof text>["inputFalse"]>["inputTrue"]>
>;
type _InputTrue = Expect<Equal<S_inputTrue["input"], true>>;
// @ts-expect-error `inputTrue()` REPLACES `input` — it must not union with the
// earlier `false`, which is what a missing `Omit` would produce.
const _twinInputTrue: S_inputTrue["input"] = false as boolean;

type S_outputFalse = StateOf<
	ReturnType<ReturnType<typeof text>["outputFalse"]>
>;
type _OutputFalse = Expect<Equal<S_outputFalse["output"], false>>;
// @ts-expect-error `output` is the literal `false`.
const _twinOutputFalse: S_outputFalse["output"] = true as boolean;

// `.hooks()` / `.access()` / `.operators()` / `.drizzle()` widen state by
// INTERSECTION (`TState & { … }`) rather than by Omit, and their added keys are
// already optional on DefaultFieldState — so the resulting key type is not the
// argument's type and asserting on it would be asserting on the field
// definitions, not on the wrapper. What the WRAPPER owes is narrower and is
// what is checked here: prior state survives the link, and the link still
// returns something with the type-specific methods attached.
const hooked = text().required().hooks({}).access({});
type S_hooks = StateOf<typeof hooked>;
type _HooksKeepState = Expect<Equal<S_hooks["notNull"], true>>;
// @ts-expect-error `.hooks()` / `.access()` must not reset accumulated state.
const _twinHooks: S_hooks["notNull"] = false as boolean;
// …and the chain is still a text field afterwards.
hooked.pattern(/x/).trim();

const withDrizzle = text()
	.required()
	.drizzle((c) => c);
type S_drizzle = StateOf<typeof withDrizzle>;
type _DrizzleKeepState = Expect<Equal<S_drizzle["notNull"], true>>;
// @ts-expect-error `.drizzle()` must not reset accumulated state.
const _twinDrizzle: S_drizzle["notNull"] = false as boolean;
withDrizzle.lowercase();

// `.label()` / `.description()` must NOT disturb accumulated state.
type S_labelled = StateOf<
	ReturnType<ReturnType<ReturnType<typeof text>["required"]>["label"]>
>;
type _LabelKeepsRequired = Expect<Equal<S_labelled["notNull"], true>>;
// @ts-expect-error `.label()` preserves `notNull: true` from the earlier link.
const _twinLabelled: S_labelled["notNull"] = false as boolean;

// `.crdt()` is the one common method deliberately kept OUT of the mapped
// wrapper, because mapping erases its `const TConfig` to the constraint. The
// config must stay a readonly literal, not widen to `CrdtFieldConfig`.
const crdted = textarea().default("").required().crdt({ format: "text" });
type S_crdt = StateOf<typeof crdted>;
type _CrdtConst = Expect<Equal<S_crdt["crdt"], { readonly format: "text" }>>;
type _CrdtKeepState = Expect<Equal<S_crdt["notNull"], true>>;
// @ts-expect-error `crdt` keeps the LITERAL config — a widened `CrdtFieldConfig`
// would accept the set variant here.
const _twinCrdt: S_crdt["crdt"] = { format: "set", conflict: "add-wins" };
// …and `.crdt()` must not drop the type-specific methods either.
crdted.min(1);

// ============================================================================
// 2. Chain order — state accumulates across MULTIPLE common links
// ============================================================================

const chained = text().required().localized().inputOptional();
type S_chained = StateOf<typeof chained>;
type _ChainNotNull = Expect<Equal<S_chained["notNull"], true>>;
type _ChainLocalized = Expect<Equal<S_chained["localized"], true>>;
type _ChainInput = Expect<Equal<S_chained["input"], "optional">>;
// @ts-expect-error every earlier link must survive every later link.
const _twinChain: S_chained["notNull"] = false as boolean;

// ============================================================================
// 3. Type-specific methods survive common links — BOTH directions
//
// This is the invariant the wrapper exists for. `.pattern()` is declared
// `(): any` in TextMethods, so it also exercises the `_IsAny` short-circuit
// that must run BEFORE the state test — without it, `any` would poison the
// whole state through union distribution.
// ============================================================================

const specificAfterCommon = text().required().pattern(/x/);
type S_specificAfterCommon = StateOf<typeof specificAfterCommon>;
type _SpecificKeepsState = Expect<
	Equal<S_specificAfterCommon["notNull"], true>
>;
type _SpecificNotAny = Expect<Equal<IsAny<S_specificAfterCommon>, false>>;
// @ts-expect-error `.pattern()` is `(): any` — the short-circuit must stop it
// from poisoning state to `any`.
const _twinSpecific: S_specificAfterCommon["notNull"] = false as boolean;

const commonAfterSpecific = text().pattern(/x/).required();
type S_commonAfterSpecific = StateOf<typeof commonAfterSpecific>;
type _CommonAfterSpecific = Expect<
	Equal<S_commonAfterSpecific["notNull"], true>
>;
// @ts-expect-error a common method after a type-specific one still transitions.
const _twinCommonAfter: S_commonAfterSpecific["notNull"] = false as boolean;

// Type-specific methods must remain CALLABLE after a common link, and unknown
// ones must remain errors — a collapse to `any` would silently allow both.
text().required().trim().lowercase().localized().pattern(/x/);
number().required().min(1).max(10).localized();
// @ts-expect-error no such method — must still be an error after the merge.
text().required().thisMethodDoesNotExist();
// @ts-expect-error `.pattern()` belongs to text, not number.
number().required().pattern(/x/);

// ----------------------------------------------------------------------------
// 3b. The `(): any` short-circuit, on EVERY field type that declares one.
//
// Invariant 2 is per-`TMethods`, not per-field, and the eleven method-bearing
// builtins declare eleven separate `(): any` methods. Dropping the
// short-circuit poisons each of them independently, so each gets its own row.
//
// `upload().multiple()` vs `relation().multiple()` is the sharpest pair in the
// file: the SAME method name is `(): any` on one field (must PRESERVE state,
// invariant 2) and a declared transition on the other (must CHANGE state,
// invariant 3). A wrapper that handles only one of the two branches passes half
// of this pair.
// ----------------------------------------------------------------------------

const anyText = text().required().pattern(/x/);
const anyNumber = number().required().min(1);
const anyDate = date().required().autoNow();
const anyDatetime = datetime().required().autoNowUpdate();
const anyEmail = email().required().min(1);
const anyUrl = url().required().max(9);
const anyTextarea = textarea().required().min(1);
const anySelect = select([{ value: "a", label: "A" }] as const)
	.required()
	.enum("e");
const anyUpload = upload().required().multiple();
const anyRelation = relation("posts").required().relationName("r");
const anyFrom = from(undefined as unknown, z.object({ lat: z.number() }))
	.required()
	.type("geo");

/** A `(): any` method must leave state EXACTLY as it found it. */
type AnyMethodChecks<F, TData> = [
	Equal<IsAny<StateOf<F>>, false>,
	Equal<SK<F, "notNull">, true>,
	Equal<SK<F, "data">, TData>,
];

type _AnyText = Expect<AllTrue<AnyMethodChecks<typeof anyText, string>>>;
type _AnyNumber = Expect<AllTrue<AnyMethodChecks<typeof anyNumber, number>>>;
type _AnyDate = Expect<AllTrue<AnyMethodChecks<typeof anyDate, string>>>;
type _AnyDatetime = Expect<AllTrue<AnyMethodChecks<typeof anyDatetime, Date>>>;
type _AnyEmail = Expect<AllTrue<AnyMethodChecks<typeof anyEmail, string>>>;
type _AnyUrl = Expect<AllTrue<AnyMethodChecks<typeof anyUrl, string>>>;
type _AnyTextarea = Expect<
	AllTrue<AnyMethodChecks<typeof anyTextarea, string>>
>;
type _AnySelect = Expect<AllTrue<AnyMethodChecks<typeof anySelect, "a">>>;
type _AnyUpload = Expect<AllTrue<AnyMethodChecks<typeof anyUpload, string>>>;
type _AnyRelation = Expect<
	AllTrue<AnyMethodChecks<typeof anyRelation, string>>
>;
type _AnyFrom = Expect<
	AllTrue<AnyMethodChecks<typeof anyFrom, { lat: number }>>
>;

// The twins. Each stops erroring the moment its field state becomes `any`.
// @ts-expect-error text().pattern() must not poison state.
const _twinAnyText: StateOf<typeof anyText>["notNull"] = false as boolean;
// @ts-expect-error number().min() must not poison state.
const _twinAnyNumber: StateOf<typeof anyNumber>["notNull"] = false as boolean;
// @ts-expect-error date().autoNow() must not poison state.
const _twinAnyDate: StateOf<typeof anyDate>["notNull"] = false as boolean;
// @ts-expect-error datetime().autoNowUpdate() must not poison state.
const _twinAnyDatetime: StateOf<typeof anyDatetime>["notNull"] =
	false as boolean;
// @ts-expect-error email().min() must not poison state.
const _twinAnyEmail: StateOf<typeof anyEmail>["notNull"] = false as boolean;
// @ts-expect-error url().max() must not poison state.
const _twinAnyUrl: StateOf<typeof anyUrl>["notNull"] = false as boolean;
// @ts-expect-error textarea().min() must not poison state.
const _twinAnyTextarea: StateOf<typeof anyTextarea>["notNull"] =
	false as boolean;
// @ts-expect-error select().enum() must not poison state.
const _twinAnySelect: StateOf<typeof anySelect>["notNull"] = false as boolean;
// @ts-expect-error upload().multiple() is `(): any` — it PRESERVES state.
// NOTE: this asserts the INTENT, and cannot check it. Because the method is
// declared `(): any`, the runtime was free to disagree — and it did, spreading
// the type-only `f._` phantom instead of `f._state` and losing the whole state
// object while this line stayed green. The runtime half lives in
// test/fields/chain-preserves-state.test.ts; do not treat this as coverage.
const _twinAnyUpload: StateOf<typeof anyUpload>["data"] = [] as string[];
// @ts-expect-error relation().relationName() must not poison state.
const _twinAnyRelation: StateOf<typeof anyRelation>["notNull"] =
	false as boolean;
// @ts-expect-error from().type() must not poison state.
const _twinAnyFrom: StateOf<typeof anyFrom>["notNull"] = false as boolean;

// ============================================================================
// 4. Relation transitions — each one lands on a DIFFERENT state
//
// The wrapper probes the declared return through the phantom `_`; these are the
// only common-shaped methods that genuinely change the state type, so they are
// the sharpest test that the transition branch still fires.
// ============================================================================

const target = () => ({}) as never;

const hasMany = relation(target).hasMany({ foreignKey: "ownerId" });
type S_hasMany = StateOf<typeof hasMany>;
type _HasManyKind = Expect<Equal<S_hasMany["relationKind"], "many">>;
type _HasManyVirtual = Expect<Equal<S_hasMany["virtual"], true>>;
type _HasManyData = Expect<Equal<S_hasMany["data"], string[]>>;
// @ts-expect-error `.hasMany()` transitions to the literal `"many"`.
const _twinHasMany: S_hasMany["relationKind"] = "one" as string;

const manyToMany = relation(target).manyToMany({ through: "pivot" as never });
type S_manyToMany = StateOf<typeof manyToMany>;
type _M2MKind = Expect<Equal<S_manyToMany["relationKind"], "many">>;
type _M2MVirtual = Expect<Equal<S_manyToMany["virtual"], true>>;
type _M2MData = Expect<Equal<S_manyToMany["data"], string[]>>;
// @ts-expect-error `.manyToMany()` is virtual — the literal `true`.
const _twinM2M: S_manyToMany["virtual"] = false as boolean;

const multiple = relation(target).multiple();
type S_multiple = StateOf<typeof multiple>;
type _MultipleKind = Expect<Equal<S_multiple["relationKind"], "one">>;
type _MultipleData = Expect<Equal<S_multiple["data"], string[]>>;
// `.multiple()` owns a jsonb column — it is NOT virtual, unlike the two above.
// That distinction is exactly what a sloppy "all relations transition the same"
// refactor would erase.
type _MultipleNotVirtual = Expect<Equal<S_multiple["virtual"], false>>;
// @ts-expect-error `.multiple()` is not virtual.
const _twinMultiple: S_multiple["virtual"] = true as boolean;

// A relation transition must still compose with common methods afterwards.
type S_relThenCommon = StateOf<
	ReturnType<ReturnType<typeof relation<never>>["multiple"]>
>;
type _RelThenCommon = Expect<Equal<S_relThenCommon["relationKind"], "one">>;
// @ts-expect-error the transitioned state is preserved, not reset.
const _twinRelThenCommon: S_relThenCommon["relationKind"] = "many" as string;

// The three transitions declare an ABSOLUTE state, not one derived from
// `TState` — so they RESET anything accumulated before them, and preserve
// anything applied after them. Order is therefore observable, and pinning both
// directions is what stops a refactor from "helpfully" making the transitions
// state-preserving (which would silently change what `.required()` means).
const resetByTransition = relation("posts").required().multiple();
type S_resetByTransition = StateOf<typeof resetByTransition>;
type _TransitionResets = Expect<Equal<S_resetByTransition["notNull"], false>>;
// @ts-expect-error a transition after `.required()` resets `notNull` to `false`.
const _twinTransitionResets: S_resetByTransition["notNull"] = true as boolean;

const keptAfterTransition = relation("posts").multiple().required();
type S_keptAfterTransition = StateOf<typeof keptAfterTransition>;
type _TransitionKeeps = Expect<Equal<S_keptAfterTransition["notNull"], true>>;
type _TransitionKeepsData = Expect<
	Equal<S_keptAfterTransition["data"], string[]>
>;
// @ts-expect-error `.required()` after a transition still pins the literal.
const _twinTransitionKeeps: S_keptAfterTransition["notNull"] = false as boolean;

// Relation methods must survive their own transitions, and common methods must
// keep working on the transitioned state.
hasMany.relationName("r").onDelete("cascade");
manyToMany.relationName("r");
multiple.onDelete("cascade").onUpdate("cascade");
relation("posts").hasMany({ foreignKey: "f" }).localized().relationName("r");

type S_hasManyThenRequired = StateOf<ReturnType<typeof hasMany.required>>;
type _HasManyThenRequired = Expect<
	Equal<S_hasManyThenRequired["notNull"], true>
>;
type _HasManyKindSurvives = Expect<
	Equal<S_hasManyThenRequired["relationKind"], "many">
>;
// @ts-expect-error a common link after `.hasMany()` keeps the to-many state.
const _twinHasManyThenRequired: S_hasManyThenRequired["relationKind"] =
	"one" as string;

// ============================================================================
// 5. THE CROSS PRODUCT — every field type × every common transition
//
// One parameterised matrix, instantiated once per field type against a probe
// object of real builder chains. Written this way rather than as 15 copies of
// the same blocks because the cost that matters here is instantiation count,
// and because 15 hand-copied blocks drift.
//
// Read `TransitionMatrix` as the specification: each row is one thing the
// wrapper owes, for EVERY field type, no exceptions.
// ============================================================================

/**
 * The probe key set. Every field type's probe object must supply all of them —
 * a missing chain is a constraint violation on `TransitionMatrix`, not a
 * silently skipped row.
 */
type ProbeKeys =
	| "base"
	| "req"
	| "loc"
	| "def"
	| "arr"
	| "vir"
	| "inF"
	| "inO"
	| "inT"
	| "outF"
	| "lbl"
	| "hk"
	| "acc"
	| "ops"
	| "dz"
	| "zd"
	| "crd"
	| "misc";

type TransitionMatrix<P extends Record<ProbeKeys, unknown>, TType, TData> = [
	// identity of the freshly built field
	Equal<SK<P["base"], "type">, TType>,
	Equal<SK<P["base"], "data">, TData>,
	// state-CHANGING transitions
	Equal<SK<P["req"], "notNull">, true>,
	Equal<ColMark<P["req"], "notNull">, true>,
	Equal<SK<P["loc"], "localized">, true>,
	Equal<SK<P["def"], "hasDefault">, true>,
	Equal<ColMark<P["def"], "hasDefault">, true>,
	Equal<SK<P["arr"], "isArray">, true>,
	Equal<SK<P["arr"], "data">, TData[]>,
	Equal<SK<P["vir"], "virtual">, true>,
	Equal<SK<P["vir"], "column">, null>,
	Equal<SK<P["inF"], "input">, false>,
	Equal<SK<P["inO"], "input">, "optional">,
	Equal<SK<P["inT"], "input">, true>,
	Equal<SK<P["outF"], "output">, false>,
	// state-PRESERVING transitions: `.required()` came first in every one of
	// these chains, so `notNull` is the canary for "this link reset my state".
	Equal<SK<P["lbl"], "notNull">, true>,
	Equal<SK<P["hk"], "notNull">, true>,
	Equal<SK<P["acc"], "notNull">, true>,
	Equal<SK<P["ops"], "notNull">, true>,
	Equal<SK<P["dz"], "notNull">, true>,
	Equal<SK<P["zd"], "notNull">, true>,
	Equal<SK<P["crd"], "notNull">, true>,
	Equal<SK<P["misc"], "notNull">, true>,
	// `.operators()` must carry the operator set through un-erased…
	Equal<Prop<SK<P["ops"], "operators">, "brand">, "custom">,
	// …and `.crdt()` must carry its `const` config through un-widened.
	Equal<SK<P["crd"], "crdt">, { readonly format: "text" }>,
	// Identity escape hatches must not disturb the value type. `.drizzle()` is
	// column-only, so no field may widen here — not even select, whose `data`
	// (a literal union) is NARROWER than its column's declared
	// `PgVarcharBuilder<[string, ...string[]]>`. Re-deriving `data` from the
	// returned column is exactly what would widen it to `string`.
	Equal<SK<P["dz"], "data">, TData>,
	Equal<SK<P["zd"], "data">, TData>,
];

// ---- probe chains, one object per field type ----------------------------

const P_text = {
	base: text(),
	req: text().required(),
	loc: text().localized(),
	def: text().default("x"),
	arr: text().array(),
	vir: text().virtual(),
	inF: text().inputFalse(),
	inO: text().inputOptional(),
	inT: text().inputFalse().inputTrue(),
	outF: text().outputFalse(),
	lbl: text().required().label("l").description("d"),
	hk: text().required().hooks({}),
	acc: text().required().access({}),
	ops: text().required().operators(brandedOps),
	dz: text()
		.required()
		.drizzle((c) => c),
	zd: text()
		.required()
		.zod((s) => s),
	crd: text().required().crdt({ format: "text" }),
	misc: text()
		.required()
		.fromDb((v) => v)
		.toDb((v) => v)
		.minItems(1)
		.maxItems(2),
};

const P_number = {
	base: number(),
	req: number().required(),
	loc: number().localized(),
	def: number().default(1),
	arr: number().array(),
	vir: number().virtual(),
	inF: number().inputFalse(),
	inO: number().inputOptional(),
	inT: number().inputFalse().inputTrue(),
	outF: number().outputFalse(),
	lbl: number().required().label("l").description("d"),
	hk: number().required().hooks({}),
	acc: number().required().access({}),
	ops: number().required().operators(brandedOps),
	dz: number()
		.required()
		.drizzle((c) => c),
	zd: number()
		.required()
		.zod((s) => s),
	crd: number().required().crdt({ format: "text" }),
	misc: number()
		.required()
		.fromDb((v) => v)
		.toDb((v) => v)
		.minItems(1)
		.maxItems(2),
};

const P_boolean = {
	base: boolean(),
	req: boolean().required(),
	loc: boolean().localized(),
	def: boolean().default(true),
	arr: boolean().array(),
	vir: boolean().virtual(),
	inF: boolean().inputFalse(),
	inO: boolean().inputOptional(),
	inT: boolean().inputFalse().inputTrue(),
	outF: boolean().outputFalse(),
	lbl: boolean().required().label("l").description("d"),
	hk: boolean().required().hooks({}),
	acc: boolean().required().access({}),
	ops: boolean().required().operators(brandedOps),
	dz: boolean()
		.required()
		.drizzle((c) => c),
	zd: boolean()
		.required()
		.zod((s) => s),
	crd: boolean().required().crdt({ format: "text" }),
	misc: boolean()
		.required()
		.fromDb((v) => v)
		.toDb((v) => v)
		.minItems(1)
		.maxItems(2),
};

const P_textarea = {
	base: textarea(),
	req: textarea().required(),
	loc: textarea().localized(),
	def: textarea().default("x"),
	arr: textarea().array(),
	vir: textarea().virtual(),
	inF: textarea().inputFalse(),
	inO: textarea().inputOptional(),
	inT: textarea().inputFalse().inputTrue(),
	outF: textarea().outputFalse(),
	lbl: textarea().required().label("l").description("d"),
	hk: textarea().required().hooks({}),
	acc: textarea().required().access({}),
	ops: textarea().required().operators(brandedOps),
	dz: textarea()
		.required()
		.drizzle((c) => c),
	zd: textarea()
		.required()
		.zod((s) => s),
	crd: textarea().required().crdt({ format: "text" }),
	misc: textarea()
		.required()
		.fromDb((v) => v)
		.toDb((v) => v)
		.minItems(1)
		.maxItems(2),
};

const P_email = {
	base: email(),
	req: email().required(),
	loc: email().localized(),
	def: email().default("a@b.c"),
	arr: email().array(),
	vir: email().virtual(),
	inF: email().inputFalse(),
	inO: email().inputOptional(),
	inT: email().inputFalse().inputTrue(),
	outF: email().outputFalse(),
	lbl: email().required().label("l").description("d"),
	hk: email().required().hooks({}),
	acc: email().required().access({}),
	ops: email().required().operators(brandedOps),
	dz: email()
		.required()
		.drizzle((c) => c),
	zd: email()
		.required()
		.zod((s) => s),
	crd: email().required().crdt({ format: "text" }),
	misc: email()
		.required()
		.fromDb((v) => v)
		.toDb((v) => v)
		.minItems(1)
		.maxItems(2),
};

const P_url = {
	base: url(),
	req: url().required(),
	loc: url().localized(),
	def: url().default("https://x"),
	arr: url().array(),
	vir: url().virtual(),
	inF: url().inputFalse(),
	inO: url().inputOptional(),
	inT: url().inputFalse().inputTrue(),
	outF: url().outputFalse(),
	lbl: url().required().label("l").description("d"),
	hk: url().required().hooks({}),
	acc: url().required().access({}),
	ops: url().required().operators(brandedOps),
	dz: url()
		.required()
		.drizzle((c) => c),
	zd: url()
		.required()
		.zod((s) => s),
	crd: url().required().crdt({ format: "text" }),
	misc: url()
		.required()
		.fromDb((v) => v)
		.toDb((v) => v)
		.minItems(1)
		.maxItems(2),
};

const P_date = {
	base: date(),
	req: date().required(),
	loc: date().localized(),
	def: date().default("2020-01-01"),
	arr: date().array(),
	vir: date().virtual(),
	inF: date().inputFalse(),
	inO: date().inputOptional(),
	inT: date().inputFalse().inputTrue(),
	outF: date().outputFalse(),
	lbl: date().required().label("l").description("d"),
	hk: date().required().hooks({}),
	acc: date().required().access({}),
	ops: date().required().operators(brandedOps),
	dz: date()
		.required()
		.drizzle((c) => c),
	zd: date()
		.required()
		.zod((s) => s),
	crd: date().required().crdt({ format: "text" }),
	misc: date()
		.required()
		.fromDb((v) => v)
		.toDb((v) => v)
		.minItems(1)
		.maxItems(2),
};

const P_datetime = {
	base: datetime(),
	req: datetime().required(),
	loc: datetime().localized(),
	def: datetime().default(new Date()),
	arr: datetime().array(),
	vir: datetime().virtual(),
	inF: datetime().inputFalse(),
	inO: datetime().inputOptional(),
	inT: datetime().inputFalse().inputTrue(),
	outF: datetime().outputFalse(),
	lbl: datetime().required().label("l").description("d"),
	hk: datetime().required().hooks({}),
	acc: datetime().required().access({}),
	ops: datetime().required().operators(brandedOps),
	dz: datetime()
		.required()
		.drizzle((c) => c),
	zd: datetime()
		.required()
		.zod((s) => s),
	crd: datetime().required().crdt({ format: "text" }),
	misc: datetime()
		.required()
		.fromDb((v) => v)
		.toDb((v) => v)
		.minItems(1)
		.maxItems(2),
};

const P_time = {
	base: time(),
	req: time().required(),
	loc: time().localized(),
	def: time().default("10:00:00"),
	arr: time().array(),
	vir: time().virtual(),
	inF: time().inputFalse(),
	inO: time().inputOptional(),
	inT: time().inputFalse().inputTrue(),
	outF: time().outputFalse(),
	lbl: time().required().label("l").description("d"),
	hk: time().required().hooks({}),
	acc: time().required().access({}),
	ops: time().required().operators(brandedOps),
	dz: time()
		.required()
		.drizzle((c) => c),
	zd: time()
		.required()
		.zod((s) => s),
	crd: time().required().crdt({ format: "text" }),
	misc: time()
		.required()
		.fromDb((v) => v)
		.toDb((v) => v)
		.minItems(1)
		.maxItems(2),
};

const P_json = {
	base: json(),
	req: json().required(),
	loc: json().localized(),
	def: json().default({ a: 1 }),
	arr: json().array(),
	vir: json().virtual(),
	inF: json().inputFalse(),
	inO: json().inputOptional(),
	inT: json().inputFalse().inputTrue(),
	outF: json().outputFalse(),
	lbl: json().required().label("l").description("d"),
	hk: json().required().hooks({}),
	acc: json().required().access({}),
	ops: json().required().operators(brandedOps),
	dz: json()
		.required()
		.drizzle((c) => c),
	zd: json()
		.required()
		.zod((s) => s),
	crd: json().required().crdt({ format: "text" }),
	misc: json()
		.required()
		.fromDb((v) => v)
		.toDb((v) => v)
		.minItems(1)
		.maxItems(2),
};

const P_object = {
	base: object({ a: text() }),
	req: object({ a: text() }).required(),
	loc: object({ a: text() }).localized(),
	def: object({ a: text() }).default({ a: "x" }),
	arr: object({ a: text() }).array(),
	vir: object({ a: text() }).virtual(),
	inF: object({ a: text() }).inputFalse(),
	inO: object({ a: text() }).inputOptional(),
	inT: object({ a: text() }).inputFalse().inputTrue(),
	outF: object({ a: text() }).outputFalse(),
	lbl: object({ a: text() }).required().label("l").description("d"),
	hk: object({ a: text() }).required().hooks({}),
	acc: object({ a: text() }).required().access({}),
	ops: object({ a: text() }).required().operators(brandedOps),
	dz: object({ a: text() })
		.required()
		.drizzle((c) => c),
	zd: object({ a: text() })
		.required()
		.zod((s) => s),
	crd: object({ a: text() }).required().crdt({ format: "text" }),
	misc: object({ a: text() })
		.required()
		.fromDb((v) => v)
		.toDb((v) => v)
		.minItems(1)
		.maxItems(2),
};

const SEL = [{ value: "a", label: "A" }] as const;
const P_select = {
	base: select(SEL),
	req: select(SEL).required(),
	loc: select(SEL).localized(),
	def: select(SEL).default("a"),
	arr: select(SEL).array(),
	vir: select(SEL).virtual(),
	inF: select(SEL).inputFalse(),
	inO: select(SEL).inputOptional(),
	inT: select(SEL).inputFalse().inputTrue(),
	outF: select(SEL).outputFalse(),
	lbl: select(SEL).required().label("l").description("d"),
	hk: select(SEL).required().hooks({}),
	acc: select(SEL).required().access({}),
	ops: select(SEL).required().operators(brandedOps),
	dz: select(SEL)
		.required()
		.drizzle((c) => c),
	zd: select(SEL)
		.required()
		.zod((s) => s),
	crd: select(SEL).required().crdt({ format: "text" }),
	misc: select(SEL)
		.required()
		.fromDb((v) => v)
		.toDb((v) => v)
		.minItems(1)
		.maxItems(2),
};

const P_upload = {
	base: upload(),
	req: upload().required(),
	loc: upload().localized(),
	def: upload().default("id"),
	arr: upload().array(),
	vir: upload().virtual(),
	inF: upload().inputFalse(),
	inO: upload().inputOptional(),
	inT: upload().inputFalse().inputTrue(),
	outF: upload().outputFalse(),
	lbl: upload().required().label("l").description("d"),
	hk: upload().required().hooks({}),
	acc: upload().required().access({}),
	ops: upload().required().operators(brandedOps),
	dz: upload()
		.required()
		.drizzle((c) => c),
	zd: upload()
		.required()
		.zod((s) => s),
	crd: upload().required().crdt({ format: "text" }),
	misc: upload()
		.required()
		.fromDb((v) => v)
		.toDb((v) => v)
		.minItems(1)
		.maxItems(2),
};

const P_relation = {
	base: relation("posts"),
	req: relation("posts").required(),
	loc: relation("posts").localized(),
	def: relation("posts").default("id"),
	arr: relation("posts").array(),
	vir: relation("posts").virtual(),
	inF: relation("posts").inputFalse(),
	inO: relation("posts").inputOptional(),
	inT: relation("posts").inputFalse().inputTrue(),
	outF: relation("posts").outputFalse(),
	lbl: relation("posts").required().label("l").description("d"),
	hk: relation("posts").required().hooks({}),
	acc: relation("posts").required().access({}),
	ops: relation("posts").required().operators(brandedOps),
	dz: relation("posts")
		.required()
		.drizzle((c) => c),
	zd: relation("posts")
		.required()
		.zod((s) => s),
	crd: relation("posts").required().crdt({ format: "text" }),
	misc: relation("posts")
		.required()
		.fromDb((v) => v)
		.toDb((v) => v)
		.minItems(1)
		.maxItems(2),
};

const CUSTOM_SCHEMA = z.object({ lat: z.number() });
type CustomData = { lat: number };
const P_from = {
	base: from(undefined as unknown, CUSTOM_SCHEMA),
	req: from(undefined as unknown, CUSTOM_SCHEMA).required(),
	loc: from(undefined as unknown, CUSTOM_SCHEMA).localized(),
	def: from(undefined as unknown, CUSTOM_SCHEMA).default({ lat: 1 }),
	arr: from(undefined as unknown, CUSTOM_SCHEMA).array(),
	vir: from(undefined as unknown, CUSTOM_SCHEMA).virtual(),
	inF: from(undefined as unknown, CUSTOM_SCHEMA).inputFalse(),
	inO: from(undefined as unknown, CUSTOM_SCHEMA).inputOptional(),
	inT: from(undefined as unknown, CUSTOM_SCHEMA)
		.inputFalse()
		.inputTrue(),
	outF: from(undefined as unknown, CUSTOM_SCHEMA).outputFalse(),
	lbl: from(undefined as unknown, CUSTOM_SCHEMA)
		.required()
		.label("l")
		.description("d"),
	hk: from(undefined as unknown, CUSTOM_SCHEMA)
		.required()
		.hooks({}),
	acc: from(undefined as unknown, CUSTOM_SCHEMA)
		.required()
		.access({}),
	ops: from(undefined as unknown, CUSTOM_SCHEMA)
		.required()
		.operators(brandedOps),
	dz: from(undefined as unknown, CUSTOM_SCHEMA)
		.required()
		.drizzle((c) => c),
	zd: from(undefined as unknown, CUSTOM_SCHEMA)
		.required()
		.zod((s) => s),
	crd: from(undefined as unknown, CUSTOM_SCHEMA)
		.required()
		.crdt({ format: "text" }),
	misc: from(undefined as unknown, CUSTOM_SCHEMA)
		.required()
		.fromDb((v) => v)
		.toDb((v) => v)
		.minItems(1)
		.maxItems(2),
};

// ---- the matrix, once per field type, each with its wrong-type twin ------
//
// The twin feeds the SAME matrix a `type`/`data` pair the field does not have.
// If it stops erroring, that field's row has gone vacuous.

type _MText = Expect<AllTrue<TransitionMatrix<typeof P_text, "text", string>>>;
type _MTextNeg = Expect<
	// @ts-expect-error text is `"text"`/`string`, not `"number"`/`number`.
	AllTrue<TransitionMatrix<typeof P_text, "number", number>>
>;

type _MNumber = Expect<
	AllTrue<TransitionMatrix<typeof P_number, "number", number>>
>;
type _MNumberNeg = Expect<
	// @ts-expect-error number is `"number"`/`number`, not `"text"`/`string`.
	AllTrue<TransitionMatrix<typeof P_number, "text", string>>
>;

type _MBoolean = Expect<
	AllTrue<TransitionMatrix<typeof P_boolean, "boolean", boolean>>
>;
type _MBooleanNeg = Expect<
	// @ts-expect-error boolean is `"boolean"`/`boolean`, not `"text"`/`string`.
	AllTrue<TransitionMatrix<typeof P_boolean, "text", string>>
>;

type _MTextarea = Expect<
	AllTrue<TransitionMatrix<typeof P_textarea, "textarea", string>>
>;
type _MTextareaNeg = Expect<
	// @ts-expect-error textarea is `"textarea"`, not `"text"`.
	AllTrue<TransitionMatrix<typeof P_textarea, "text", string>>
>;

type _MEmail = Expect<
	AllTrue<TransitionMatrix<typeof P_email, "email", string>>
>;
type _MEmailNeg = Expect<
	// @ts-expect-error email is `"email"`, not `"text"`.
	AllTrue<TransitionMatrix<typeof P_email, "text", string>>
>;

type _MUrl = Expect<AllTrue<TransitionMatrix<typeof P_url, "url", string>>>;
// @ts-expect-error url is `"url"`, not `"text"`.
type _MUrlNeg = Expect<AllTrue<TransitionMatrix<typeof P_url, "text", string>>>;

type _MDate = Expect<AllTrue<TransitionMatrix<typeof P_date, "date", string>>>;
// @ts-expect-error date stores an ISO `string`, not a `Date`.
type _MDateNeg = Expect<AllTrue<TransitionMatrix<typeof P_date, "date", Date>>>;

type _MDatetime = Expect<
	AllTrue<TransitionMatrix<typeof P_datetime, "datetime", Date>>
>;
type _MDatetimeNeg = Expect<
	// @ts-expect-error datetime stores a `Date`, not a `string`.
	AllTrue<TransitionMatrix<typeof P_datetime, "datetime", string>>
>;

type _MTime = Expect<AllTrue<TransitionMatrix<typeof P_time, "time", string>>>;
type _MTimeNeg = Expect<
	// @ts-expect-error time is `"time"`, not `"datetime"`.
	AllTrue<TransitionMatrix<typeof P_time, "datetime", string>>
>;

type _MJson = Expect<
	AllTrue<TransitionMatrix<typeof P_json, "json", JsonData>>
>;
type JsonData = StateOf<typeof P_json.base>["data"];
type _MJsonNeg = Expect<
	// @ts-expect-error json's data is `JsonValue`, not `string`.
	AllTrue<TransitionMatrix<typeof P_json, "json", string>>
>;

type _MObject = Expect<
	AllTrue<TransitionMatrix<typeof P_object, "object", { a: string | null }>>
>;
type _MObjectNeg = Expect<
	// @ts-expect-error the nested text field is nullable — `{ a: string }` is wrong.
	AllTrue<TransitionMatrix<typeof P_object, "object", { a: string }>>
>;

type _MSelect = Expect<
	AllTrue<TransitionMatrix<typeof P_select, "select", "a">>
>;
type _MSelectNeg = Expect<
	// @ts-expect-error select keeps its options as a LITERAL union, not `string`.
	// This row is the one that catches `.drizzle()`/`.zod()` re-deriving `data`
	// from the varchar column and throwing the literals away.
	AllTrue<TransitionMatrix<typeof P_select, "select", string>>
>;

type _MUpload = Expect<
	AllTrue<TransitionMatrix<typeof P_upload, "upload", string>>
>;
type _MUploadNeg = Expect<
	// @ts-expect-error upload is `"upload"`, not `"relation"`.
	AllTrue<TransitionMatrix<typeof P_upload, "relation", string>>
>;

type _MRelation = Expect<
	AllTrue<TransitionMatrix<typeof P_relation, "relation", string>>
>;
type _MRelationNeg = Expect<
	// @ts-expect-error a belongsTo relation stores one id, not `string[]`.
	AllTrue<TransitionMatrix<typeof P_relation, "relation", string[]>>
>;

type _MFrom = Expect<
	AllTrue<TransitionMatrix<typeof P_from, "custom", CustomData>>
>;
type _MFromNeg = Expect<
	// @ts-expect-error `from()` takes its data from the supplied zod schema.
	AllTrue<TransitionMatrix<typeof P_from, "custom", unknown>>
>;

// ---- the harness testing itself ------------------------------------------
//
// Two fakes shaped like the two ways this type layer actually fails. The matrix
// must reject both. If either of these `@ts-expect-error`s goes unused, every
// row above is passing for free and this whole file is decoration.

/** Total collapse: `FieldWithMethods` degraded to something with `_: any`. */
declare const collapsedField: { readonly _: any };
const P_collapsed = {
	base: collapsedField,
	req: collapsedField,
	loc: collapsedField,
	def: collapsedField,
	arr: collapsedField,
	vir: collapsedField,
	inF: collapsedField,
	inO: collapsedField,
	inT: collapsedField,
	outF: collapsedField,
	lbl: collapsedField,
	hk: collapsedField,
	acc: collapsedField,
	ops: collapsedField,
	dz: collapsedField,
	zd: collapsedField,
	crd: collapsedField,
	misc: collapsedField,
};

/** Partial collapse: transitions still fire but every literal has widened. */
type WidenedState = {
	type: string;
	data: unknown;
	column: { _: { notNull: boolean; hasDefault: boolean } };
	notNull: boolean;
	hasDefault: boolean;
	localized: boolean;
	virtual: boolean;
	input: boolean | "optional";
	output: boolean;
	isArray: boolean;
	operators: { brand: string };
	crdt: { format: string };
};
declare const widenedField: { readonly _: WidenedState };
const P_widened = {
	base: widenedField,
	req: widenedField,
	loc: widenedField,
	def: widenedField,
	arr: widenedField,
	vir: widenedField,
	inF: widenedField,
	inO: widenedField,
	inT: widenedField,
	outF: widenedField,
	lbl: widenedField,
	hk: widenedField,
	acc: widenedField,
	ops: widenedField,
	dz: widenedField,
	zd: widenedField,
	crd: widenedField,
	misc: widenedField,
};

type _MatrixRejectsAny = Expect<
	// @ts-expect-error a state collapsed to `any` must fail the matrix.
	AllTrue<TransitionMatrix<typeof P_collapsed, "text", string>>
>;
type _MatrixRejectsWidened = Expect<
	// @ts-expect-error a state whose literals widened must fail the matrix.
	AllTrue<TransitionMatrix<typeof P_widened, "text", string>>
>;

// ---- type-specific methods, before AND after a common link ---------------
//
// Value-level, because "does this method still exist" is a call-site question
// and no type-level probe answers it faithfully: `ReturnType` over an
// intersection of signatures picks the LAST constituent, which is exactly the
// one that does NOT carry TMethods.

text().required().pattern(/x/).trim();
text().pattern(/x/).required().uppercase();
number().localized().min(1).max(2);
number().min(1).localized().max(2);
date().array().autoNow();
date().autoNow().array();
datetime().default(new Date()).autoNowUpdate();
datetime().autoNow().default(new Date());
email().virtual().min(1).max(9);
email().min(1).virtual().max(9);
url().inputOptional().min(1);
url().min(1).inputOptional();
textarea().outputFalse().min(1);
textarea().min(1).outputFalse();
select(SEL).label("l").enum("e");
select(SEL).enum("e").label("l");
upload().hooks({}).multiple();
upload().multiple().hooks({});
relation("posts").access({}).relationName("r");
relation("posts").relationName("r").access({});
from(undefined as unknown, CUSTOM_SCHEMA)
	.localized()
	.type("geo");
from(undefined as unknown, CUSTOM_SCHEMA)
	.type("geo")
	.localized();

// ============================================================================
// 6. Completeness gate — the part that survives an unasserted loosening
//
// Everything above asserts named properties, and that is exactly as strong as
// the list of properties someone remembered to name. Demonstrated, not assumed:
// dropping the `NotNull<>` wrapper from `required()`'s column type produces ZERO
// errors across the whole package — no assertion above mentions `column` on the
// required path, and the framework's own select/insert typing keys off
// `TState extends { notNull: true }` rather than the Drizzle column, so even the
// `create({})` checks in field-input-integrity.test-d.ts stay green. The
// loosening is real (it reaches `ctx.tables` and raw `ctx.db` usage) and it was
// invisible. (The `column` rows in `TransitionMatrix` now cover it for all
// fifteen field types; this section keeps the per-key detail.)
//
// So: pin the whole key surface, then assert every key. Loosening a key breaks
// that key's assertion; ADDING a state property breaks the `keyof` assertion and
// forces whoever added it to say what it should be. Neither can pass silently.
//
// The per-key detail stays on ONE canonical chain. The `keyof` pin, however, is
// per field type — the key surface genuinely differs (text carries
// `textStorage`, json/select carry `whereInput`, relation/upload carry
// `relationTo`/`relationKind`), and those extras are precisely the ones a
// generic wrapper is tempted to drop.
// ============================================================================

type S_canonical = StateOf<ReturnType<ReturnType<typeof text>["required"]>>;

type _CanonicalKeys = Expect<
	Equal<
		keyof S_canonical,
		| "type"
		| "data"
		| "column"
		| "notNull"
		| "hasDefault"
		| "localized"
		| "virtual"
		| "input"
		| "output"
		| "isArray"
		| "operators"
		| "textStorage"
	>
>;

type _CanonicalType = Expect<Equal<S_canonical["type"], "text">>;
type _CanonicalData = Expect<Equal<S_canonical["data"], string>>;
type _CanonicalNotNull = Expect<Equal<S_canonical["notNull"], true>>;
type _CanonicalHasDefault = Expect<Equal<S_canonical["hasDefault"], false>>;
type _CanonicalLocalized = Expect<Equal<S_canonical["localized"], false>>;
type _CanonicalVirtual = Expect<Equal<S_canonical["virtual"], false>>;
type _CanonicalInput = Expect<Equal<S_canonical["input"], true>>;
type _CanonicalOutput = Expect<Equal<S_canonical["output"], true>>;
type _CanonicalIsArray = Expect<Equal<S_canonical["isArray"], false>>;
type _CanonicalStorage = Expect<Equal<S_canonical["textStorage"], "text">>;
type _CanonicalOperators = Expect<
	Equal<IsAny<S_canonical["operators"]>, false>
>;

// The Drizzle column must still carry the notNull marker. This is the one the
// named assertions missed: nothing else in the suite reads `column`, and the
// framework API does not depend on it, so it can be dropped without a single
// test going red.
type _CanonicalColumnNotNull = Expect<
	Equal<S_canonical["column"]["_"]["notNull"], true>
>;

// …and `.default()` must mark the column as defaulted, for the same reason.
type S_defaulted = StateOf<ReturnType<ReturnType<typeof text>["default"]>>;
type _DefaultedColumn = Expect<
	Equal<S_defaulted["column"]["_"]["hasDefault"], true>
>;

// ---- the `keyof` pin, per field type -------------------------------------

/** The eleven keys every field state carries. */
type BaseStateKeys =
	| "type"
	| "data"
	| "column"
	| "notNull"
	| "hasDefault"
	| "localized"
	| "virtual"
	| "input"
	| "output"
	| "isArray"
	| "operators";

type KeysOf<F> = keyof StateOf<F>;

type _KBoolean = Expect<Equal<KeysOf<typeof P_boolean.base>, BaseStateKeys>>;
type _KDate = Expect<Equal<KeysOf<typeof P_date.base>, BaseStateKeys>>;
type _KDatetime = Expect<Equal<KeysOf<typeof P_datetime.base>, BaseStateKeys>>;
type _KEmail = Expect<Equal<KeysOf<typeof P_email.base>, BaseStateKeys>>;
type _KFrom = Expect<Equal<KeysOf<typeof P_from.base>, BaseStateKeys>>;
type _KNumber = Expect<Equal<KeysOf<typeof P_number.base>, BaseStateKeys>>;
type _KObject = Expect<Equal<KeysOf<typeof P_object.base>, BaseStateKeys>>;
type _KTextarea = Expect<Equal<KeysOf<typeof P_textarea.base>, BaseStateKeys>>;
type _KTime = Expect<Equal<KeysOf<typeof P_time.base>, BaseStateKeys>>;
type _KUrl = Expect<Equal<KeysOf<typeof P_url.base>, BaseStateKeys>>;

type _KText = Expect<
	Equal<KeysOf<typeof P_text.base>, BaseStateKeys | "textStorage">
>;
type _KJson = Expect<
	Equal<KeysOf<typeof P_json.base>, BaseStateKeys | "whereInput">
>;
type _KSelect = Expect<
	Equal<KeysOf<typeof P_select.base>, BaseStateKeys | "whereInput">
>;
type _KUpload = Expect<
	Equal<
		KeysOf<typeof P_upload.base>,
		BaseStateKeys | "relationTo" | "relationKind"
	>
>;
type _KRelation = Expect<
	Equal<
		KeysOf<typeof P_relation.base>,
		BaseStateKeys | "relationTo" | "relationKind"
	>
>;

// The three relation transitions land on their own states — pin those too.
type _KHasMany = Expect<
	Equal<KeysOf<typeof hasMany>, BaseStateKeys | "relationTo" | "relationKind">
>;
type _KManyToMany = Expect<
	Equal<
		KeysOf<typeof manyToMany>,
		BaseStateKeys | "relationTo" | "relationKind"
	>
>;
type _KMultiple = Expect<
	Equal<KeysOf<typeof multiple>, BaseStateKeys | "relationTo" | "relationKind">
>;

// `.array()` contributes `innerState`, and must not eat the per-type extras.
type _KArray = Expect<
	Equal<KeysOf<typeof P_text.arr>, BaseStateKeys | "textStorage" | "innerState">
>;

// Twins for the pins. `keyof` of a collapsed state is `string | number | symbol`
// and of a state that lost its extras is a strict subset — both stop this
// assignment from erroring.
// @ts-expect-error `textStorage` is part of text's key surface.
const _twinKText: KeysOf<typeof P_text.base> = "nope" as BaseStateKeys | "nope";
// @ts-expect-error `relationTo`/`relationKind` are part of relation's surface.
const _twinKRelation: KeysOf<typeof P_relation.base> = "nope" as
	| BaseStateKeys
	| "nope";
// @ts-expect-error `innerState` is part of an array state's surface.
const _twinKArray: KeysOf<typeof P_text.arr> = "nope" as BaseStateKeys | "nope";

// ============================================================================
// 7. Class-signature semantics — the path every field is now on
//
// These four common methods used to be declared TWICE: once on the `Field`
// class and once in the `FieldCommonMethods` mirror that drove the wrapper map.
// Where the two disagreed, whichever was reachable won, and that differed by
// field — a field WITHOUT type-specific methods (boolean/json/object/time)
// returned a bare `Field<…>` and took the CLASS signature, while a field WITH
// methods went through the map and took the MIRROR's. Nothing checked the two
// stayed in sync.
//
// The class signature is the one that survived, and there is now only one.
// These rows were deliberately written on the bare-`Field` fields, where it was
// already the live behaviour, so that when every field converged onto the class
// this section kept passing unchanged instead of being rewritten under
// pressure. It did.
// ============================================================================

// `.zod()` narrows `data` to the schema's output…
const zodNarrowed = json().zod(() => z.object({ theme: z.literal("dark") }));
type S_zodNarrowed = StateOf<typeof zodNarrowed>;
type _ZodNarrows = Expect<Equal<S_zodNarrowed["data"], { theme: "dark" }>>;
// @ts-expect-error `.zod()` replaced the value type — it is no longer JsonValue.
const _twinZodNarrowed: S_zodNarrowed["data"] = "x" as string;

// …but a schema-preserving refinement must leave `data` alone.
const zodIdentity = json().zod((s) => s);
type _ZodIdentity = Expect<
	Equal<StateOf<typeof zodIdentity>["data"], JsonData>
>;
// @ts-expect-error identity `.zod()` keeps `JsonValue`, it does not erase to any.
const _twinZodIdentity: StateOf<typeof zodIdentity>["data"] =
	Symbol() as symbol;

// `.$type<T>()` replaces `data` outright.
const typed = json().$type<{ x: 1 }>();
type _TypeOverride = Expect<Equal<StateOf<typeof typed>["data"], { x: 1 }>>;
// @ts-expect-error `$type<{x:1}>()` pins the literal shape.
const _twinTyped: StateOf<typeof typed>["data"] = { x: 2 };

// `.hooks()` keeps the argument's OWN type — the generic `H` must not be
// erased to its `FieldHooks<TState["data"]>` constraint.
const hooksGeneric = json().hooks({ beforeChange: (v) => v });
type S_hooksGeneric = StateOf<typeof hooksGeneric>;
type _HooksGeneric = Expect<
	Equal<
		S_hooksGeneric extends { hooks: infer H } ? H : never,
		{ beforeChange: (v: JsonData) => JsonData }
	>
>;
// @ts-expect-error `H` is the literal object type, not the wide FieldHooks.
const _twinHooksGeneric: S_hooksGeneric extends { hooks: infer H } ? H : never =
	{} as {};

// `.drizzle()` swaps the COLUMN and leaves the field's own value type alone
// (use `.$type<T>()` or `.zod()` to change `data`), while every marker already
// on the column survives the round trip.
const drizzleIdentity = json()
	.required()
	.drizzle((c) => c);
type _DrizzleIdentity = Expect<
	Equal<StateOf<typeof drizzleIdentity>["data"], JsonData>
>;
type _DrizzleKeepsColumn = Expect<
	Equal<StateOf<typeof drizzleIdentity>["column"]["_"]["notNull"], true>
>;
// @ts-expect-error identity `.drizzle()` must not erase the notNull marker.
const _twinDrizzleIdentity: StateOf<
	typeof drizzleIdentity
>["column"]["_"]["notNull"] = false as boolean;

// ============================================================================
// 7b. Intersection ORDER — a common method WINS a TMethods name collision
//
// Invariant 1. Nothing else in the repo pins it, and no builtin field type has
// a colliding key, so a reversed intersection lands silently.
//
// The collision must be declared on the SAME parameter type as the common
// method. That is the whole test: two signatures that BOTH accept the call, so
// intersection order is the only tiebreak. A collision on a DIFFERENT parameter
// type proves nothing — the two signatures then form an overload set, each call
// picks the only one that fits, and both orders behave identically. (Measured:
// with `label(x: number)` the reversed intersection is indistinguishable; with
// `label(l: I18nText)` it hijacks the state to "HIJACKED".)
//
// `Field<TState, TMethods>` comes FIRST in `FieldWithMethods`, so the class
// wins. Reverse it and BOTH lines below fire: the `Equal` goes red, and the
// twin stops erroring (TS2578).
// ============================================================================

type HijackedState = Omit<StateOf<ReturnType<typeof text>>, "type"> & {
	type: "HIJACKED";
};
declare const collided: FieldWithMethods<
	StateOf<ReturnType<typeof text>> & FieldState,
	{ label(l: I18nText): FieldWithMethods<HijackedState & FieldState, {}> }
>;
const _collisionOk = collided.label({ en: "from the common signature" });
type _CollisionCommonWins = Expect<
	Equal<SK<typeof _collisionOk, "type">, "text">
>;
// @ts-expect-error the class signature won — the TMethods return never applied.
const _twinCollision: SK<typeof _collisionOk, "type"> = "HIJACKED";

// A TMethods key that collides on the NAME but not the parameter type is a
// reachable overload, not an erased one. This is new: the old 27-key map
// produced ONE property per key and swallowed the type-specific signature
// outright. Recorded as a positive call — if someone restores erasure (e.g.
// `Exclude<keyof TMethods, keyof Field<…>>` in the map) this line goes red,
// which is the conversation worth having. Note the map still rewrites the
// declared return, so the call yields a field, not the literal.
declare const overloaded: FieldWithMethods<
	StateOf<ReturnType<typeof text>> & FieldState,
	{ label(x: number): "FROM_TMETHODS" }
>;
const _overloadReachable = overloaded.label(1);
type _OverloadKeepsState = Expect<
	Equal<SK<typeof _overloadReachable, "type">, "text">
>;
// @ts-expect-error the map re-wrapped the return — it is a field, not a literal.
const _twinOverload: "FROM_TMETHODS" = _overloadReachable;

// ============================================================================
// 8. Four common methods that USED to drop the type-specific methods
//
// `.$type()`, `.set()` and `.derive()` were declared on the class but missing
// from the `FieldCommonMethods` mirror that drove the wrapper map, so they fell
// through to a bare `Field<TState>` and lost TMethods. `.operators()` was in
// the mirror, but the mirror's erased parameter stopped accepting a concrete
// operator set, so that call fell through to the class signature too — same
// outcome. All four were pinned here as `@ts-expect-error`.
//
// Moving TMethods onto the class closed all four at once: there is no mirror
// left to fall out of. The four calls stay as POSITIVE assertions — a future
// refactor that reintroduces a second declaration site for these signatures
// makes them red again, which is the point.
//
// State survives all four, and that part was never a gap — a refactor that
// "fixes" the methods by resetting the state has traded one bug for a worse
// one, so the twins below still guard it.
// ============================================================================

text().required().operators(brandedOps).pattern(/x/);
text().required().$type<string>().pattern(/x/);
text().required().set("admin", {}).pattern(/x/);
text().required().derive({}).pattern(/x/);

// The state, by contrast, must survive all four — that part is NOT a gap, and
// a refactor that "fixes" the methods by resetting the state has traded one bug
// for a worse one.
const afterSet = text().required().set("admin", {});
const afterDerive = text().required().derive({});
const afterTypeOverride = text().required().$type<"a" | "b">();
type _SetKeepsState = Expect<Equal<StateOf<typeof afterSet>["notNull"], true>>;
type _DeriveKeepsState = Expect<
	Equal<StateOf<typeof afterDerive>["notNull"], true>
>;
type _TypeOverrideKeepsState = Expect<
	Equal<StateOf<typeof afterTypeOverride>["notNull"], true>
>;
type _TypeOverrideData = Expect<
	Equal<StateOf<typeof afterTypeOverride>["data"], "a" | "b">
>;
// @ts-expect-error `.set()` is state-transparent.
const _twinSet: StateOf<typeof afterSet>["notNull"] = false as boolean;
// @ts-expect-error `.derive()` is state-transparent.
const _twinDerive: StateOf<typeof afterDerive>["notNull"] = false as boolean;
// @ts-expect-error `.$type()` replaces only `data`, and with the literal union.
const _twinTypeOverride: StateOf<typeof afterTypeOverride>["data"] =
	"c" as string;

// ============================================================================
// 7. Codegen extension proxies must not truncate the chain
//
// Mirrors what packages/questpie/src/cli/codegen/factory-template.ts emits for
// a field extension (the admin module's `.admin()` / `.form()`). It is
// reproduced here rather than imported because the real augmentation only
// exists in a generated app, and this is the one place it can be guarded.
//
// The bug it guards: a ONE-parameter `interface Field` merges with the
// two-parameter class perfectly happily, no TS2428, examples at 0 errors — and
// every proxy then returns `Field<TState, {}>`, silently dropping the field
// type's own methods. It failed on call ORDER alone:
//   f.text().admin({}).pattern(/x/)   broken
//   f.text().pattern(/x/).admin({})   fine
// which is the kind of thing a user works around rather than reports.
// ============================================================================

declare module "#questpie/server/fields/field-class.js" {
	interface Field<TState extends FieldState = FieldState, TMethods = {}> {
		probeExt(config: unknown): FieldWithMethods<TState, TMethods>;
	}
}

const afterProxy = text().required().probeExt({}).pattern(/x/).trim();
type S_afterProxy = StateOf<typeof afterProxy>;
type _ProxyKeepsState = Expect<Equal<S_afterProxy["notNull"], true>>;
// @ts-expect-error the proxy must preserve accumulated state, not reset it.
const _twinProxy: S_afterProxy["notNull"] = false as boolean;

// …and in the other order, which worked even when the interface was wrong.
text().required().pattern(/x/).probeExt({});
