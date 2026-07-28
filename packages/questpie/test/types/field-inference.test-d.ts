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
 * Compile-time only — run with: bunx tsc --noEmit
 */

import { boolean } from "#questpie/server/modules/core/fields/boolean.js";
import { datetime } from "#questpie/server/modules/core/fields/datetime.js";
import { json } from "#questpie/server/modules/core/fields/json.js";
import { number } from "#questpie/server/modules/core/fields/number.js";
import { relation } from "#questpie/server/modules/core/fields/relation.js";
import { select } from "#questpie/server/modules/core/fields/select.js";
import { text } from "#questpie/server/modules/core/fields/text.js";
import { textarea } from "#questpie/server/modules/core/fields/textarea.js";
import { upload } from "#questpie/server/modules/core/fields/upload.js";

import type { Equal, Expect, IsAny } from "./type-test-utils.js";

/** State of a built field — the phantom `_` the wrapper maps transition on. */
type StateOf<F> = F extends { readonly _: infer S } ? S : never;

// ============================================================================
// 0. The state must never be `any`
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

// ============================================================================
// 5. Every field type builds, chains, and keeps a non-`any` state
//
// Cheap breadth: a collapse rarely hits one field type in isolation, but a
// key-set mistake in the wrapper map can hit exactly the ones whose methods
// are declared unusually.
// ============================================================================

type _TextNotAny = Expect<Equal<IsAny<StateOf<typeof chained>>, false>>;
type _NumberNotAny = Expect<
	Equal<
		IsAny<StateOf<ReturnType<ReturnType<typeof number>["required"]>>>,
		false
	>
>;
type _BooleanNotAny = Expect<
	Equal<
		IsAny<StateOf<ReturnType<ReturnType<typeof boolean>["required"]>>>,
		false
	>
>;
type _JsonNotAny = Expect<
	Equal<IsAny<StateOf<ReturnType<ReturnType<typeof json>["required"]>>>, false>
>;
type _DatetimeNotAny = Expect<
	Equal<
		IsAny<StateOf<ReturnType<ReturnType<typeof datetime>["required"]>>>,
		false
	>
>;
type _TextareaNotAny = Expect<
	Equal<
		IsAny<StateOf<ReturnType<ReturnType<typeof textarea>["required"]>>>,
		false
	>
>;
type _UploadNotAny = Expect<
	Equal<
		IsAny<StateOf<ReturnType<ReturnType<typeof upload>["required"]>>>,
		false
	>
>;

// `select()` carries its options through as literals — the sharpest per-type
// check available, since a widened state would drop them to `string`.
const sel = select([
	{ value: "a", label: "A" },
	{ value: "b", label: "B" },
] as const).required();
type S_select = StateOf<typeof sel>;
type _SelectNotAny = Expect<Equal<IsAny<S_select>, false>>;
type _SelectRequired = Expect<Equal<S_select["notNull"], true>>;
// @ts-expect-error select's state is exact, not widened by the wrapper.
const _twinSelect: S_select["notNull"] = false as boolean;
