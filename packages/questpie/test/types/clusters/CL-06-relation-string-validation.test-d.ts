/**
 * CL-06 — `f.relation("typo")` accepts any string; module collections missing
 * from the names-only registry.
 *
 * SURFACE (proposal §3 CL-06, findings REL-STR-01/03/04/05/06):
 *   - `KnownCollectionKey` (config/app-context.ts:155-157) carries a `(string & {})`
 *     arm, so `string extends KnownCollectionKey` is TRUE → the relation generic
 *     constraint reduces to `string` and typos compile (failing only at RUNTIME as
 *     `__unresolved__`).
 *   - The same looseness flows into `manyToMany({ through })` (REL-STR-04), the
 *     polymorphic relation map keys+values (REL-STR-05), and lazy refs (REL-STR-06).
 *   - Module-contributed collections (auth `user`/`account`/`session`, admin, audit,
 *     workflows) are MISSING from `Questpie.CollectionKeys` (REL-STR-03) — module
 *     codegen never contributes its discovered names into the registry.
 *
 * TARGET (proposal Part B — authoritative):
 *   - A NEW `StrictCollectionKey` alias with **no `(string & {})` arm**:
 *       StrictCollectionKey =
 *         [keyof Questpie.CollectionKeys] extends [never]
 *           ? string                                        // pre-codegen escape hatch
 *           : keyof Questpie.CollectionKeys & string;       // FINITE union, typos rejected
 *   - `relation<TTo extends StrictCollectionKey>`, `manyToMany.through: StrictCollectionKey`,
 *     `JunctionTarget`, and the polymorphic map keys+values all retyped to it.
 *   - `KnownCollectionKey` (loose) kept ONLY for cosmetic autocomplete sites.
 *   - Module codegen contributes its discovered collection names into the merged
 *     `Questpie.CollectionKeys` so `relation("user")` validates AND autocompletes.
 *   - `StrictGlobalKey`/`StrictJobKey` are deliberately NOT added (globals have no
 *     `relation()` surface) — so this file does NOT assert them.
 *
 * WHY MOST OF THIS IS RED NOW:
 *   1. `StrictCollectionKey` does not exist yet — the import below is unresolved
 *      (the single highest-signal burndown line).
 *   2. The four relation surfaces still reference the loose `KnownCollectionKey`.
 *
 * REGISTRY ISOLATION (proposal §3 CL-06 caveat #2 — the hard rule for THIS file):
 *   Inside the `questpie` package build, `Questpie.CollectionKeys` is EMPTY (the
 *   starter module does not yet emit it). A populated-registry assertion and an
 *   empty-registry assertion CANNOT coexist in one tsc run. Therefore:
 *     - The empty-registry behavior is asserted directly against the REAL surface.
 *     - The populated-registry semantics (finiteness, typo rejection, module-name
 *       membership) are asserted via a LOCAL parameterized helper `SCK<R>` over a
 *       FAKE registry — exactly the strategy the caveat prescribes — and the REAL
 *       `StrictCollectionKey` is pinned to `SCK<Questpie.CollectionKeys>` so the
 *       production alias is bound to the target formula.
 */

// KnownCollectionKey (loose, exists) is the baseline; StrictCollectionKey is the
// TARGET export that does not exist yet — this import is RED until Part B lands.
import type {
	KnownCollectionKey,
	StrictCollectionKey,
} from "#questpie/server/config/app-context.js";
import type { Questpie } from "#questpie/server/config/questpie.js";
import { relation } from "#questpie/server/modules/core/fields/relation.js";
import type { RelationFieldMethods } from "#questpie/server/modules/core/fields/relation.js";

import type {
	Equal,
	Expect,
	HasKey,
	HasStringIndex,
	NoAny,
	NoStringIndex,
	NoUnknown,
	Not,
} from "../_assert.js";
// Fixtures: every f.relation("...") in the graph targets a real Collections key.
// `Collections` enumerates the in-package collection names that a populated
// `Questpie.CollectionKeys` would mirror.
import type { Collections } from "../_fixtures.js";

// ============================================================================
// §0  Local target-formula mirror + fake registries (registry-isolation strategy)
//
// `SCK<R>` is the EXACT body the production `StrictCollectionKey` must have:
// a finite union when the registry is populated, plain `string` when empty,
// and NEVER a `(string & {})` arm. We exercise the TARGET semantics over fake
// registries here, then pin the real export to `SCK<Questpie.CollectionKeys>`.
// ============================================================================

type SCK<R> = [keyof R] extends [never] ? string : keyof R & string;

/** A populated registry lens — what codegen emits for an app with these keys. */
interface FakeRegistry {
	toys: unknown;
	materials: unknown;
	machines: unknown;
}

/** A registry that also carries module-contributed keys (auth `user`). */
interface FakeRegistryWithModule {
	toys: unknown;
	user: unknown; // contributed by a module (REL-STR-03 target)
}

/** The empty registry — the questpie package's own build state. */
interface FakeRegistryEmpty {}

type StrictOver<R> = SCK<R>;

// ============================================================================
// §1  StrictCollectionKey — the keystone target alias
// ============================================================================

// --- Target formula semantics, proven over a populated fake registry. --------

// Populated → the EXACT finite literal union (NOT `string`, NOT `any`).
type _sck_populated_is_union = Expect<
	Equal<StrictOver<FakeRegistry>, "toys" | "materials" | "machines">
>;
type _sck_populated_not_any = Expect<NoAny<StrictOver<FakeRegistry>>>;
type _sck_populated_not_unknown = Expect<NoUnknown<StrictOver<FakeRegistry>>>;

// Populated → `string` must NOT be assignable to it (the whole point: typos fail).
// This is the inverse of the live `KnownCollectionKey` looseness asserted in §1b.
type _sck_populated_rejects_string = Expect<
	Equal<string extends StrictOver<FakeRegistry> ? true : false, false>
>;

// Populated → FINITE: no string index signature survived (no `(string & {})` arm).
type _sck_populated_finite = Expect<
	NoStringIndex<Record<StrictOver<FakeRegistry>, 0>>
>;

// Empty registry → plain `string` escape hatch (pre-codegen still compiles).
type _sck_empty_is_string = Expect<
	Equal<StrictOver<FakeRegistryEmpty>, string>
>;

// --- The REAL exported alias must equal the target formula over the real registry.
// RED: `StrictCollectionKey` does not exist yet (unresolved import above), and once
// it does it must be wired to exactly this body — not the loose `KnownCollectionKey`.
type _real_sck_matches_formula = Expect<
	Equal<StrictCollectionKey, SCK<Questpie.CollectionKeys>>
>;

// In the questpie package build the registry is empty, so the REAL alias must
// resolve to `string` (the fallback) — and must NOT be `any`/`unknown`.
type _real_sck_empty_build_is_string = Expect<
	Equal<StrictCollectionKey, string>
>;
type _real_sck_not_any = Expect<NoAny<StrictCollectionKey>>;
type _real_sck_not_unknown = Expect<NoUnknown<StrictCollectionKey>>;

// ============================================================================
// §1b  Baseline: the LIVE `KnownCollectionKey` is loose (documents the bug).
//
// `KnownCollectionKey` keeps its `(string & {})` arm for cosmetic autocomplete,
// so `string extends KnownCollectionKey` is TRUE both empty AND populated. The
// fix must NOT route the relation CONSTRAINT through this type. These assertions
// pin today's behavior so a future change to `KnownCollectionKey` is visible.
// ============================================================================

// Today (empty build) `KnownCollectionKey` reduces to `string & {}` → accepts all.
type _known_is_loose_now = Expect<
	Equal<string extends KnownCollectionKey ? true : false, true>
>;

// The strict alias and the loose alias must DIVERGE on the populated lens:
// strict rejects bare `string`, loose accepts it. (Encodes "they are different
// types and the constraint must use the strict one".)
type LooseOver<R> = [keyof R] extends [never]
	? string & {}
	: (keyof R & string) | (string & {});
type _strict_and_loose_diverge = Expect<
	Equal<
		[
			string extends StrictOver<FakeRegistry> ? true : false, // false
			string extends LooseOver<FakeRegistry> ? true : false, // true
		],
		[false, true]
	>
>;

// ============================================================================
// §2  relation() factory — its generic constraint must be StrictCollectionKey.
//
// The constraint is observable as the DEFAULT of the unbound generic: with no
// argument inferred, `TTo` falls back to its constraint, surfacing in the
// non-string (polymorphic) arm of the parameter. We assert the constraint type
// identity directly, and exercise typo rejection through a TARGET-shaped local
// mirror (`relStrict`) over the populated lens — the real factory can't reject a
// typo in the empty-registry build, so the burndown rides the identity assertion.
// ============================================================================

// The real factory's declared generic constraint, recovered from the parameter.
// `relation`'s param is `TTo | Exclude<RelationTarget, string>`; the string arm IS
// the constraint `TTo`. Today that constraint is `KnownCollectionKey & string`
// (≈ `string & {}` in this build); the target is `StrictCollectionKey`.
type RelParam = Parameters<typeof relation>[0];
type RelStringArm = Extract<RelParam, string>;

// TARGET: the string arm of relation()'s parameter is exactly StrictCollectionKey.
// RED now — it is `KnownCollectionKey & string` (the loose, `string & {}`-bearing form).
type _rel_constraint_is_strict = Expect<
	Equal<RelStringArm, StrictCollectionKey>
>;

// TARGET: that constraint must NOT admit bare `string` once the registry is
// populated. We can only state today's empty-build value here; the populated
// proof is the `relStrict` mirror below + the identity assertion above.
type _rel_string_arm_not_any = Expect<NoAny<RelStringArm>>;

// --- Typo rejection over a populated lens via the TARGET-shaped signature. ----
// `relStrict` mirrors exactly what `relation`'s signature becomes after Part B,
// so the @ts-expect-error directives are CONSUMED (TS2578-gated) precisely when
// the target is met. Paired with positive `Equal` companions per hard-rule #4.
declare function relStrict<TTo extends StrictOver<FakeRegistry>>(
	target: TTo,
): { relationTo: TTo };

const _relGood = relStrict("toys");
type _relGood_literal = Expect<Equal<typeof _relGood, { relationTo: "toys" }>>;

// @ts-expect-error — a typo'd collection name must be rejected by the strict constraint.
relStrict("toyzzzz_does_not_exist");
// @ts-expect-error — bare string is not a known key.
relStrict("" as string);

// ============================================================================
// §3  manyToMany({ through }) — junction name must be StrictCollectionKey (REL-STR-04)
// ============================================================================

// The real `through` parameter type, recovered from the exported method interface.
type M2MConfig = Parameters<RelationFieldMethods["manyToMany"]>[0];
type ThroughType = M2MConfig["through"];

// TARGET: `through` is StrictCollectionKey. RED now — it is `KnownCollectionKey`.
type _through_is_strict = Expect<Equal<ThroughType, StrictCollectionKey>>;
type _through_not_any = Expect<NoAny<ThroughType>>;
// TARGET: once populated, `through` must reject bare `string` (junction typo caught).
// Stated over the formula the target binds to:
type _through_rejects_string_when_populated = Expect<
	Equal<string extends SCK<FakeRegistry> ? true : false, false>
>;

// Typo rejection over the populated lens via a target-shaped mirror.
declare function m2mStrict(cfg: { through: StrictOver<FakeRegistry> }): void;
m2mStrict({ through: "materials" });
type _m2m_ok = Expect<
	Equal<
		Parameters<typeof m2mStrict>[0]["through"],
		"toys" | "materials" | "machines"
	>
>;
// @ts-expect-error — typo'd junction name must be rejected.
m2mStrict({ through: "junction_typo_does_not_exist" });

// ============================================================================
// §4  Polymorphic relation map — keys AND values strict & FINITE (REL-STR-05)
//
// The polymorphic arm is `{ [K in StrictCollectionKey]?: StrictCollectionKey | (()=>{name}) }`.
// Today it is keyed on `KnownCollectionKey`, which collapses to a string index
// signature (and, on .d.ts emit, to `Record<string, …>`). The target is a FINITE
// optional-key map. We recover the polymorphic arm from relation()'s parameter.
// ============================================================================

// Non-string, non-function arm of relation()'s parameter = the polymorphic map.
type PolyArm = Exclude<RelParam, string | ((...a: any[]) => any)>;

// `PolyArmOver<R>` reproduces EXACTLY the shape relation.ts gives the polymorphic
// arm (`{ [K in StrictCollectionKey]?: StrictCollectionKey | (() => {name}) }`),
// but parameterized over a registry lens so we can prove finiteness for the
// POPULATED case the package build cannot host (its real registry is empty →
// the real `PolyArm` is keyed on `string` here, by design). This is the
// registry-isolation strategy: the MECHANISM is proven over a fake registry; the
// REAL-surface finiteness on a populated app is proven in the example test
// (examples/toy-factory-backend/src/lib/relation-validation.test-d.ts).
type PolyArmOver<R> = {
	[K in StrictOver<R>]?: StrictOver<R> | (() => { name: string });
};

// MECHANISM (populated lens): the polymorphic map is FINITE — NO string index.
type _poly_keys_finite = Expect<NoStringIndex<PolyArmOver<FakeRegistry>>>;
// The real arm is never `any` regardless of registry population (empty → keyed on
// `string`, which is finite-key-free but still not `any`).
type _poly_not_any = Expect<NoAny<PolyArm>>;

// Typo rejection (keys AND values) over the populated lens via a target-shaped mirror.
type PolyTargetMap = {
	[K in StrictOver<FakeRegistry>]?:
		| StrictOver<FakeRegistry>
		| (() => { name: string });
};

// Finite by construction over the populated lens.
type _poly_target_finite = Expect<NoStringIndex<PolyTargetMap>>;

// A correct polymorphic value must satisfy the target map…
const _polyGood = {
	toys: "machines",
	materials: "toys",
} as const satisfies PolyTargetMap;
type _polyGood_ok = Expect<
	Equal<
		typeof _polyGood,
		{ readonly toys: "machines"; readonly materials: "toys" }
	>
>;

// …a typo KEY must NOT (REL-STR-05).
type _poly_bad_key_rejected = Expect<
	Equal<{ toyzzz_typo_key: "toys" } extends PolyTargetMap ? true : false, false>
>;
// …a typo VALUE must NOT.
type _poly_bad_value_rejected = Expect<
	Equal<
		{ toys: "machinezzz_typo_value" } extends PolyTargetMap ? true : false,
		false
	>
>;

// @ts-expect-error — typo'd polymorphic KEY rejected by the target map.
const _polyBadKey: PolyTargetMap = { toyzzz_typo_key: "toys" };
// @ts-expect-error — typo'd polymorphic VALUE rejected by the target map.
const _polyBadVal: PolyTargetMap = { toys: "machinezzz_typo_value" };

// ============================================================================
// §5  Module collections land in the merged registry (REL-STR-03)
//
// After Part A, module codegen contributes its discovered collection names into
// `Questpie.CollectionKeys`, so `relation("user")` validates and autocompletes.
// In the questpie package build the registry is EMPTY, so we prove the TARGET
// over a populated-with-module lens, and pin the real registry membership for an
// app that pulls modules (RED today: the registry omits module names entirely).
// ============================================================================

// TARGET: a module-contributed name resolves into the strict key union, so a
// cross-module `relation("user")` is a VALID strict key (not a typo).
type _module_user_is_strict_key = Expect<
	Equal<"user" extends SCK<FakeRegistryWithModule> ? true : false, true>
>;
// …and the strict union over that lens is exactly app-key ∪ module-key.
type _module_union_exact = Expect<
	Equal<SCK<FakeRegistryWithModule>, "toys" | "user">
>;

// SCOPED-mechanism membership (registry-isolation strategy — caveat #2): the
// questpie package build keeps `Questpie.CollectionKeys` EMPTY (pinned by
// `_real_sck_empty_build_is_string`), so a real-surface `HasKey<Questpie.
// CollectionKeys, …>` here is UNSATISFIABLE *in this build* and would contradict
// the empty-registry assertion. We therefore prove membership over `LocalReg` —
// the EXACT shape codegen emits for an app: every USER collection name (mirrored
// from the fixtures' `Collections` map) PLUS a representative MODULE collection
// name (`user`, REL-STR-03). The REAL populated-surface membership is proven in
// the example test (examples/toy-factory-backend/src/lib/relation-validation.
// test-d.ts), where codegen actually populates the registry.
type LocalReg = Record<keyof Collections & string, unknown> & {
	// module-contributed name (what index.ts's distributive `keyof` adds).
	user: unknown;
};

// Every in-package fixture collection name is a key of the populated registry.
type _registry_carries_fixture_names = Expect<
	HasKey<LocalReg, keyof Collections & string>
>;

// And a representative module collection name ("user") is a key once module
// codegen contributes it (REL-STR-03 directly).
type _registry_has_module_user = Expect<HasKey<LocalReg, "user">>;

// Anti-vacuity: `LocalReg` is the populated lens, so its strict key set is FINITE
// (no `(string & {})` arm leaked in) and rejects bare `string` — the same
// guarantee the real registry gives once codegen populates it per app.
type _localreg_strict_rejects_string = Expect<
	Equal<string extends SCK<LocalReg> ? true : false, false>
>;

// ============================================================================
// §6  Negative controls / anti-vacuity guards.
//
// Ensure the strict union is genuinely FINITE (the `(string & {})` arm is gone),
// not merely "compiles". These would PASS vacuously if `StrictCollectionKey`
// silently stayed loose, so they harden the suite per hard-rule §4.1.
// ============================================================================

// The loose `KnownCollectionKey` DOES carry a string index over a populated lens
// (the bug); the strict formula does NOT. Direct contrast, no `any` hiding.
type _loose_has_index = Expect<
	HasStringIndex<Record<LooseOver<FakeRegistry>, 0>>
>;
type _strict_no_index = Expect<
	Not<HasStringIndex<Record<StrictOver<FakeRegistry>, 0>>>
>;

// The real exported strict alias, recovered through the formula, is never `never`
// (an over-eager `& string` intersection that wiped the union would be a regression).
type _real_sck_not_never = Expect<
	Not<Equal<[StrictCollectionKey] extends [never] ? true : false, true>>
>;
