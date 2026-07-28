/**
 * FieldWithMethods — type-level wrapper that preserves type-specific methods.
 *
 * When a field type defines methods (e.g., text has .pattern(), .trim()),
 * these methods must survive common operations like .required(), .label(), etc.
 *
 * FieldWithMethods wraps the common method return types to re-attach TMethods,
 * ensuring the full method set is always available regardless of chain order.
 *
 * Proven in QUE-247 PoC: tsdown .d.ts emit preserves these mapped types.
 *
 * @module
 */

import type { SQL } from "drizzle-orm";
import type { HasDefault, NotNull } from "drizzle-orm/column-builder";
import type { ZodType } from "zod";

import type { I18nText } from "#questpie/shared/i18n/types.js";

import type {
	ArrayFieldState,
	CrdtFieldConfig,
	FieldState,
} from "./field-class-types.js";
import type { Field } from "./field-class.js";
import type { OperatorSetDefinition } from "./operators/types.js";
import type { FieldAccess, FieldHooks, ReferentialAction } from "./types.js";

// ============================================================================
// FieldCommonMethods — source of truth for common method signatures
// ============================================================================

/**
 * Explicit interface describing every common method on Field.
 * The Field class implements these; FieldWithMethods maps over them.
 *
 * Exported so consumers can declaration-merge additional common methods in;
 * the wrapper map re-wraps whatever they add. Note this is NOT how `.admin()`
 * and `.form()` work — those are codegen-emitted extension proxies over
 * `Field.set()` and never touch this interface.
 */
export interface FieldCommonMethods<TState extends FieldState> {
	required(): Field<
		Omit<TState, "notNull" | "column"> & {
			notNull: true;
			column: NotNull<TState["column"]>;
		}
	>;
	default(value: TState["data"] | (() => TState["data"]) | SQL): Field<
		Omit<TState, "hasDefault" | "column"> & {
			hasDefault: true;
			column: HasDefault<TState["column"]>;
		}
	>;
	label(l: I18nText): Field<TState & { label: I18nText }>;
	description(d: I18nText): Field<TState & { description: I18nText }>;
	localized(): Field<Omit<TState, "localized"> & { localized: true }>;
	inputFalse(): Field<Omit<TState, "input"> & { input: false }>;
	inputOptional(): Field<Omit<TState, "input"> & { input: "optional" }>;
	inputTrue(): Field<Omit<TState, "input"> & { input: true }>;
	outputFalse(): Field<Omit<TState, "output"> & { output: false }>;
	virtual(
		expr?: SQL,
	): Field<
		Omit<TState, "virtual" | "column"> & { virtual: true; column: null }
	>;
	hooks<H extends FieldHooks<TState["data"]>>(
		h: H,
	): Field<TState & { hooks: H }>;
	access(a: FieldAccess): Field<TState & { access: FieldAccess }>;
	array(): Field<ArrayFieldState<TState>>;
	operators<TOps extends OperatorSetDefinition>(
		ops: TOps,
	): Field<TState & { operators: TOps }>;
	drizzle<TNewCol>(
		fn: (col: TState["column"]) => TNewCol,
	): Field<TState & { column: TNewCol }>;
	zod(fn: (schema: ZodType) => ZodType): Field<TState>;
	fromDb(fn: (value: unknown) => unknown): Field<TState>;
	toDb(fn: (value: unknown) => unknown): Field<TState>;
	minItems(n: number): Field<TState>;
	maxItems(n: number): Field<TState>;
}

// ============================================================================
// FieldWithMethods — mapped wrapper type
// ============================================================================

/** Local any-detector — keep this file self-contained (no cross-module import). */
type _IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * ONE map over BOTH key sets. This was two separate maps
 * (`FieldCommonMethodsWrapped` + `FieldTypeMethodsWrapped`) until 2026-07-29;
 * merging them is worth roughly a fifth of the whole typecheck and is not a
 * cosmetic tidy-up. Measured on `examples/tanstack-barbershop` (4,580 files),
 * same machine, back to back:
 *
 *   instantiations  8,802,197 → 6,666,633   (−24.3%)
 *   types           1,569,880 → 1,220,332   (−22.3%)
 *   memory              3,145 → 2,481 MB    (−21.1%)
 *   check time          21.08 → 17.22 s     (−18.3%)
 *
 * Why it pays: `FieldWithMethods` is re-instantiated at EVERY link of every
 * field-builder chain, and `structuredTypeRelatedTo` dominates the trace
 * (2.8 M ms cumulative, ~3× everything else combined) with `FieldWithMethods`
 * comparisons in 5 of the top 8. Relating two intersections walks each target
 * constituent separately, so dropping a constituent removes a full property
 * walk from every one of those comparisons.
 *
 * Two earlier directions were tried and did NOT work — do not re-litigate them:
 *   - A nominal `interface FieldWithMethods extends …` fails with 212 errors:
 *     TS2320 (interface extends requires IDENTICAL members, but the whole
 *     mechanism here is that declaration order resolves the conflicts) and
 *     TS2312 (a mapped type over a generic `TMethods` has no statically known
 *     members and cannot be extended at all).
 *   - Hand-writing the wrapped methods instead of mapping would freeze the key
 *     set. `FieldCommonMethods` is exported as public API precisely so a
 *     consumer can declaration-merge into it, and the map is what re-wraps
 *     whatever they add. (Nothing in this repo does so today — `.admin()` and
 *     `.form()` are codegen-emitted extension proxies over `Field.set()`, NOT
 *     augmentations of this interface. The comment on `FieldCommonMethods`
 *     claiming otherwise predates the extension registry.)
 *
 * INVARIANTS — all four survive the merge and must survive any future edit:
 *
 * 1. Common keys WIN over `TMethods` keys. The intersection this replaced
 *    resolved calls by declaration order with the common map first; the
 *    `K extends keyof FieldCommonMethods<TState>` branch is what preserves it.
 * 2. The `_IsAny<Ret>` short-circuit MUST come BEFORE the state test.
 *    `any extends { _: infer R } ? A : B` evaluates to the UNION `A | B`, so a
 *    `(): any` method (text().pattern(), relation().relationName()) would
 *    otherwise poison the field state to `any`.
 * 3. The transition is probed via the phantom `_`, not `Field<infer R>`.
 *    Field's methods reference `TState` contravariantly, which defeats `infer`
 *    on the class itself; `Field<R>` and `FieldWithMethods<R,_>` both expose
 *    `readonly _: R`.
 * 4. `in out` on both parameters. The annotations exist so the checker never
 *    has to compute variance structurally for a recursive type — removing them
 *    cost ~40% in instantiations when this was last measured.
 */
type FieldAllMethodsWrapped<
	in out TState extends FieldState,
	in out TMethods,
> = {
	[K in
		| keyof FieldCommonMethods<TState>
		| keyof TMethods]: K extends keyof FieldCommonMethods<TState>
		? // Common methods: re-wrap so TMethods survives the chain.
			FieldCommonMethods<TState>[K] extends (
				...args: infer A
			) => Field<infer R extends FieldState>
			? (...args: A) => FieldWithMethods<R, TMethods>
			: FieldCommonMethods<TState>[K]
		: K extends keyof TMethods
			? // Type-specific methods: honour each method's DECLARED return.
				// `Field<R>` / `FieldWithMethods<R,_>` transitions to R (relation
				// `.hasMany()` → ToManyRelationFieldState); everything else keeps
				// the current TState.
				TMethods[K] extends (...args: infer A) => infer Ret
				? _IsAny<Ret> extends true
					? (...args: A) => FieldWithMethods<TState, TMethods>
					: Ret extends { readonly _: infer R extends FieldState }
						? (...args: A) => FieldWithMethods<R, TMethods>
						: (...args: A) => FieldWithMethods<TState, TMethods>
				: TMethods[K]
			: never;
};

/**
 * `crdt()` stays OUT of the map above. Routing it through the wrapper would
 * force its signature through `(...args: infer A)`, and inferring a signature
 * erases the `const` type parameter to its constraint — `crdt({ … })` would
 * widen from the literal config to `CrdtFieldConfig`.
 */
type CrdtFieldMethodWrapped<TState extends FieldState, TMethods> = {
	crdt<const TConfig extends CrdtFieldConfig>(
		config: TConfig,
	): FieldWithMethods<TState & { crdt: TConfig }, TMethods>;
};

/**
 * Field plus its type-specific methods, preserved across every common-method
 * chain. `FieldAllMethodsWrapped` supplies the re-wrapped methods; `Field
 * <TState>` supplies the runtime accessors (getType, toColumn, …).
 *
 * @template TState - Accumulated type state
 * @template TMethods - Type-specific methods interface (e.g., TextMethods)
 */
export type FieldWithMethods<TState extends FieldState, TMethods> =
	// Method override maps must come BEFORE Field<TState> in the intersection.
	// TypeScript resolves method calls on intersections using the FIRST matching
	// overload, so placing the override maps first ensures the re-wrapped return
	// types are used rather than Field<TState>'s own return types.
	CrdtFieldMethodWrapped<TState, TMethods> &
		FieldAllMethodsWrapped<TState, TMethods> &
		Field<TState>;
