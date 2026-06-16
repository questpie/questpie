/**
 * Type-Safety Regression — Assertion Kit
 *
 * Phase 3a framework. Built on the existing `type-test-utils.ts` kit (re-exported
 * below) and extended with the identity guards the 14 root-cause clusters lean on.
 *
 * USAGE — assert type IDENTITY, not "it compiles":
 *
 *   type _ = ExactType<Doc["title"], string>;          // bidirectional Equal
 *   type _ = NoAny<Doc["content"]>;                     // T is not `any`
 *   type _ = NoUnknown<GlobalUpd["socialLinks"]>;       // T is not `unknown`
 *   type _ = NotEmptyObject<RelationSelect>;            // T did not collapse to {}
 *   type _ = Expect<Equal<IsReadonly<Doc, "id">, true>>;// id is readonly
 *
 * HARD RULES (from the proposal §4.1 — the clusters' reviews learned these the hard way):
 *
 *   1. Use `Equal`, never bare `extends`, for identity. `extends` accepts widening
 *      and silently passes `any`.
 *   2. Run `IsAny`/`IsUnknown` on the RAW value, NEVER on `NonNullable<…>` —
 *      `NonNullable<unknown>` collapses to `{}` and the guard passes vacuously.
 *   3. For `never`/`any` boundaries use `IsNever`/`IsAny`, NOT `Equal<_, never>` —
 *      `Equal` is any-sensitive and fragile when the intermediate is literally `any`.
 *   4. Pair every `@ts-expect-error` with a POSITIVE `Equal` companion so an
 *      unrelated failure on the same line can't mask the guarantee. `@ts-expect-error`
 *      only fires when the tsconfig reports unused-directive (TS2578) as an error.
 *   5. `@ts-expect-error` freshness tests must be CALL sites (generic-parameter
 *      capture only fires at the call), not assignments to `Parameters<…>[0]`.
 *   6. Route multi-entity / "real id type" fixtures through `GetCollection` /
 *      `GetGlobal` / a built `Global`, never raw builders — a raw builder hits a
 *      `never`-fallback and passes the assertion vacuously.
 */

// ============================================================================
// Re-export the existing base kit verbatim — single import surface for tests.
// ============================================================================

export type {
	And,
	ArrayElement,
	AssertFalse,
	AssertTrue,
	Debug,
	DeepPrettify,
	Equal,
	Expect,
	Extends,
	HasKey,
	IsAny,
	IsArray,
	IsFunction,
	IsLiteral,
	IsNever,
	IsNullable,
	IsObject,
	IsUnknown,
	KeyCount,
	Not,
	OptionalKeys,
	Or,
	Prettify,
	RequiredKeys,
	SameKeys,
	UnwrapReturn,
	IsOptional,
	IsRequired,
} from "./type-test-utils.js";

import type {
	Equal,
	IsAny,
	IsNever,
	IsUnknown,
} from "./type-test-utils.js";

// ============================================================================
// ExactType — bidirectional identity, named for intent at degradation sites.
// ============================================================================

/**
 * Bidirectional structural identity. Alias of `Equal` — use it at the exact
 * spots a type degraded so the assertion reads as "this is EXACTLY T, nothing
 * widened". `Equal` already catches `any` and distinguishes `readonly`.
 *
 * @example type _ = ExactType<GlobalUpd["alertType"], "info" | "warning" | "emergency">;
 */
export type ExactType<A, B> = Equal<A, B>;

// ============================================================================
// Composite "did not silently degrade" guards.
//
// These resolve to a BOOLEAN (`true` when the guarantee holds, `false` when it
// is violated) — they must NOT embed `Expect<…>` internally, because a guard
// like `Expect<Equal<IsAny<T>, false>>` is evaluated EAGERLY against the open
// generic `T` (where `IsAny<T>` widens to `boolean`) and so errors at its own
// DEFINITION rather than at the call site. Instead, wrap them at the call site:
//
//   type _ = Expect<NoAny<Doc["content"]>>;   // fires iff content is `any`
//
// The direct-conditional form (not `Equal<…, false>`) also dodges `Equal`'s
// known fragility when comparing a *computed* boolean against a literal.
// ============================================================================

/** True iff T is NOT `any`. Wrap in `Expect<…>`; fails when T degraded to `any`. */
export type NoAny<T> = IsAny<T> extends true ? false : true;

/** True iff T is NOT `unknown`. Wrap in `Expect<…>`; fails when T degraded to `unknown`. */
export type NoUnknown<T> = IsUnknown<T> extends true ? false : true;

/** True iff T is NOT `never`. Wrap in `Expect<…>`; fails when T degraded to `never`. */
export type NoNever<T> = IsNever<T> extends true ? false : true;

// ============================================================================
// Empty-object detection — the _MP<K>→{} and tsdown `.d.ts` collapse failure mode.
//
// `{}` (the empty-object type) is structurally satisfied by almost everything,
// so `Equal<T, {}>` is unreliable. `keyof T extends never` is the robust signal
// that T degenerated to `{}` / `Record<never, never>`.
// ============================================================================

/** True iff T has no keys (i.e. T collapsed to `{}` / `Record<never, never>`). */
export type IsEmptyObject<T> = keyof T extends never ? true : false;

/**
 * True iff T is NOT the empty object. Wrap in `Expect<…>`; fails when a
 * relation/object select collapsed to `{}` (the classic `_MP<K>` /
 * declaration-emit collapse).
 *
 * @example type _ = Expect<NotEmptyObject<ExtractRelationSelect<R["author"]>>>;
 */
export type NotEmptyObject<T> = IsEmptyObject<T> extends true ? false : true;

// ============================================================================
// readonly-identity (CL-10) — a key is readonly iff stripping the modifier
// changes the type. `Equal` distinguishes readonly, so this is exact.
// ============================================================================

/**
 * True iff key K of T is `readonly`.
 *
 * Pair with `Expect<Equal<IsReadonly<Doc, "id">, true>>` for output rows and
 * `Expect<Equal<IsReadonly<WriteDoc, "slug">, false>>` for mutable write-staging
 * objects (the CL-10 `HookContext.data` guard).
 */
export type IsReadonly<T, K extends keyof T> =
	Equal<{ [P in K]: T[P] }, { -readonly [P in K]: T[P] }> extends true
		? false
		: true;

/** True iff EVERY key of T is `readonly`. */
export type IsAllReadonly<T> = Equal<T, { readonly [K in keyof T]: T[K] }>;

/** True iff EVERY key of T is mutable (no `readonly` modifiers). */
export type IsAllMutable<T> = Equal<T, { -readonly [K in keyof T]: T[K] }>;

// ============================================================================
// Union-aware helpers (CL-02 / CL-07 — where operators arrive as
// `FieldSelect | FieldWhere` unions and as branded operator objects).
// ============================================================================

/**
 * Union-aware key presence. Distributes over a union U, so it answers
 * "does key K exist on this member of the union" per member.
 *
 * @example type _ = Expect<UnionHasKey<ToManyWhere, "some">>; // quantifier present
 */
export type UnionHasKey<U, K extends PropertyKey> = U extends any
	? K extends keyof U
		? true
		: false
	: never;

/**
 * Object-member extractor — isolate the operator object out of a
 * `FieldSelect | FieldWhere` union so `Extract`/key probes are unambiguous.
 */
export type Ops<W> = Extract<NonNullable<W>, object>;

// ============================================================================
// Convenience boundary guards used across clusters.
// ============================================================================

/** True iff T is exactly `never`. Wrap in `Expect<…>` (loud `never`-fallback boundaries, CL-04/CL-14). */
export type AssertNever<T> = IsNever<T> extends true ? true : false;

/** True iff T is exactly `any`. Wrap in `Expect<…>` (rarely useful — usually you want `NoAny`). */
export type AssertAny<T> = IsAny<T> extends true ? true : false;

/** True iff T is exactly `unknown`. Wrap in `Expect<…>` (CL-09 output-only / erased path → `unknown`, not `any`). */
export type AssertUnknown<T> = IsUnknown<T> extends true ? true : false;

/** True iff T is a tuple/array (element-aware; CL-02 to-many `with`-population is an array). */
export type IsArrayType<T> = NonNullable<T> extends readonly any[] ? true : false;

/** True iff T is an array. Wrap in `Expect<…>` (CL-02 to-many `with` result). */
export type ExpectArray<T> = IsArrayType<T> extends true ? true : false;

/** True iff T is NOT an array. Wrap in `Expect<…>` (CL-02 to-one `with` result stays single). */
export type ExpectNotArray<T> = IsArrayType<T> extends true ? false : true;

/** True iff string is assignable to keyof T (i.e. T carries an index signature). */
export type HasStringIndex<T> = string extends keyof T ? true : false;

/**
 * True iff T has NO string index signature. Wrap in `Expect<…>` — the
 * CL-01/CL-03 "no phantom `~fieldTypes` index" guard and the CL-06 "registry is
 * finite, not `string`" guard.
 */
export type NoStringIndex<T> = HasStringIndex<T> extends true ? false : true;
