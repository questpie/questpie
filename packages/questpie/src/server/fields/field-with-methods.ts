/**
 * FieldWithMethods — type-level wrapper that preserves type-specific methods.
 *
 * When a field type defines methods (e.g., text has .pattern(), .trim()),
 * these methods must survive common operations like .required(), .label(), etc.
 *
 * The ~22 COMMON methods used to be re-wrapped here too. They are now declared
 * with their real return types on the `Field` class itself, so all this file
 * still owes is re-attaching `TMethods` to the type-specific methods.
 *
 * Proven in QUE-247 PoC: tsdown .d.ts emit preserves these mapped types.
 *
 * @module
 */

import type { FieldState } from "./field-class-types.js";
import type { Field } from "./field-class.js";

// ============================================================================
// FieldWithMethods — mapped wrapper type
// ============================================================================

/** Local any-detector — keep this file self-contained (no cross-module import). */
type _IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * MEASURED HISTORY — this file has been the single hottest thing in the
 * checker, and both wins came from REMOVING constituents, not from tuning.
 *
 * Two maps (`FieldCommonMethodsWrapped` + `FieldTypeMethodsWrapped`) merged
 * into one, 2026-07-29, on `examples/tanstack-barbershop` (4,580 files):
 *
 *   instantiations  8,802,197 → 6,666,633   (−24.3%)
 *   types           1,569,880 → 1,220,332   (−22.3%)
 *   memory              3,145 → 2,481 MB    (−21.1%)
 *   check time          21.08 → 17.22 s     (−18.3%)
 *
 * Then the 27-key common map deleted outright (Lever B) by giving `Field` a
 * second type parameter, so the class declares its own correct return types.
 * The old map's only job was rewriting return types the class could have
 * declared itself, and building its member table forced ~22 `Omit<TState,…>`
 * computations at EVERY link of EVERY builder chain even when one method was
 * called. `CrdtFieldMethodWrapped` went with it — it existed as a separate
 * intersection constituent ONLY because mapping erased its `const TConfig`,
 * and on a class declaration `const` survives. Same example, same machine:
 *
 *   instantiations  6,668,339 → 3,499,885   (−47.5%)
 *   types           1,220,506 →   997,331   (−18.3%)
 *   check time          16.45 → 14.42 s     (−12.3%)
 *   memory              2,478 → 2,552 MB    (+3.0%)
 *
 * Memory is the honest outlier: peak heap did NOT follow instantiations down,
 * so do not sell this change on memory. Instantiations roughly halve on all
 * four budget targets (−47.5% to −56.0%).
 *
 * Why removal is what pays: `FieldWithMethods` is re-instantiated at EVERY
 * link of every field-builder chain, and `structuredTypeRelatedTo` dominates
 * the trace (2.8 M ms cumulative, ~3× everything else combined) with
 * `FieldWithMethods` comparisons in 5 of the top 8. Relating two intersections
 * walks each target constituent separately, so dropping a constituent removes
 * a full property walk from every one of those comparisons.
 *
 * Two earlier directions were tried and did NOT work — do not re-litigate them:
 *   - A nominal `interface FieldWithMethods extends …` fails with 212 errors:
 *     TS2320 (interface extends requires IDENTICAL members, but the whole
 *     mechanism here is that declaration order resolves the conflicts) and
 *     TS2312 (a mapped type over a generic `TMethods` has no statically known
 *     members and cannot be extended at all).
 *   - Hand-writing the wrapped methods instead of mapping would freeze the key
 *     set — field modules declare their methods without knowing `TMethods`.
 */

/**
 * Map over `TMethods` ONLY. This map cannot follow the common methods onto the
 * class: field modules declare `pattern(): any` and `hasMany(): Field<R>`
 * without knowing `TMethods`, so something must re-attach it.
 *
 * INVARIANTS:
 * 1. Common keys WIN over colliding `TMethods` keys — now by intersection
 *    ORDER: `Field<TState, TMethods>` comes FIRST in `FieldWithMethods`, and TS
 *    resolves a call on an intersection through the first matching signature.
 *    The old map had to PRECEDE `Field<TState>` to override it; the class is
 *    now correct, so the order inverts. Same invariant, reversed mechanism.
 *    Pinned by `field-inference.test-d.ts` §7b — nothing else detects a
 *    reversal, because no builtin field type has a colliding key.
 * 2. The `_IsAny<Ret>` short-circuit MUST come BEFORE the state test.
 *    `any extends { _: infer R } ? A : B` evaluates to the UNION `A | B`, so a
 *    `(): any` method (text().pattern(), relation().relationName()) would
 *    otherwise poison the field state to `any`.
 * 3. The transition is probed via the phantom `_`, not `Field<infer R>`.
 *    Field's methods reference `TState` contravariantly, which defeats `infer`
 *    on the class itself; `Field<R>` and `FieldWithMethods<R,_>` both expose
 *    `readonly _: R`.
 * 4. Variance is DECLARED, never inferred, on both parameters and in both
 *    places (here and on the class). `out TState`: measured — bare leaves TS
 *    structurally recursing `inputFalse() → FWM<Omit<Omit<Omit<…>>>>` and
 *    `_clone` fails TS2322; `in out TState` additionally breaks
 *    `Field<BooleanFieldState>` → `Field<FieldState>`, i.e. the constraint on
 *    every collection's `fields()` (110 errors). `in out TMethods`: forced —
 *    `keyof TMethods` here makes it invariant, and `out` is TS2636 at the class
 *    declaration. This alias must also stay a plain mapped type: wrapping it in
 *    a conditional is TS2637 and would forfeit the annotations entirely.
 *
 *    The annotations ON THIS ALIAS are worth ~2%, and it is `in out TMethods`
 *    that earns it. Barbershop instantiations, all three swept after the flip:
 *    `out`/`in out` 3,499,885 · bare/bare 3,565,270 (+1.9%) ·
 *    `out`/bare 3,565,227 (+1.9%). Same ordering on all four budget targets.
 *    Dropping them costs; do not "simplify" them away.
 */
type FieldTypeMethodsWrapped<out TState extends FieldState, in out TMethods> = {
	[K in keyof TMethods]: TMethods[K] extends (...args: infer A) => infer Ret
		? _IsAny<Ret> extends true
			? (...args: A) => FieldWithMethods<TState, TMethods>
			: Ret extends { readonly _: infer R extends FieldState }
				? (...args: A) => FieldWithMethods<R, TMethods>
				: (...args: A) => FieldWithMethods<TState, TMethods>
		: TMethods[K];
};

/**
 * Field plus its type-specific methods, preserved across every chain link.
 *
 * `Field<TState, TMethods>` comes FIRST: it now carries the correct return
 * types itself, so it must win a colliding `TMethods` key (invariant 1). Do not
 * reorder — before Lever B the maps had to come first, and the comment saying
 * so was load-bearing in exactly the opposite direction.
 *
 * @template TState - Accumulated type state
 * @template TMethods - Type-specific methods interface (e.g., TextMethods)
 */
export type FieldWithMethods<TState extends FieldState, TMethods> = Field<
	TState,
	TMethods
> &
	FieldTypeMethodsWrapped<TState, TMethods>;

/**
 * @deprecated Use `Field<TState, TMethods>` directly.
 *
 * Until 3.18 this was a hand-maintained interface mirroring the class's ~22
 * common method signatures, and the mapped wrapper read it to rewrite their
 * return types. The class now declares those returns itself, so the mirror is
 * gone — nothing checked the two stayed in sync and they had already drifted on
 * `.drizzle()` and `.operators()`.
 *
 * Kept as an alias so the removal is not a breaking change for anyone who
 * imported it. To ADD common methods, declare a `fieldType()` with `methods`;
 * declaration-merging into this alias does nothing.
 */
export type FieldCommonMethods<
	TState extends FieldState,
	TMethods = {},
> = Field<TState, TMethods>;
