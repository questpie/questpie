/**
 * CL-12 — `RequestContext`'s `[key:string]: unknown` index signature defeats
 * excess-property checking on every CRUD `context` argument.
 *
 * ROOT CAUSE (proposal §3 CL-12, findings FGC-3 + ctx-06):
 *
 *   One type plays TWO roles. The loose ALS/wire storage shape
 *     `RequestContext = BaseRequestContext & { [key: string]: unknown }`  (context.ts:407-412)
 *   is ALSO the caller-facing CRUD ctx alias
 *     `CRUDContext = RequestContext`                                       (crud/types.ts:62)
 *   threaded as the 2nd positional arg of EVERY collection + global CRUD method
 *   (find/findOne/count/create/updateById/…; global get/update/…).
 *
 *   The `[key: string]: unknown` index signature suppresses TS2353 excess-property
 *   checking, so a typo'd `accesMode` / `stage` / `locale` / `localeFallback` at a
 *   CRUD call site COMPILES with no error and silently no-ops at runtime —
 *   `normalizeContext` then falls back to `accessMode: 'system'`, which
 *   short-circuits ALL access rules (FAIL-OPEN). It also makes ANY property access
 *   on a `CRUDContext`/`RequestContext` value yield `unknown` instead of an error.
 *
 * TARGET (after the fix — proposal's authoritative two-layer plan):
 *
 *   Layer 1 (this cluster's burndown): retarget `CRUDContext = BaseRequestContext`
 *   (the strict, index-sig-FREE base) — one line re-enables excess-prop checking at
 *   all ~17 call sites. `BaseRequestContext`'s declared members keep their precise
 *   types (`accessMode: AccessMode | undefined`, `stage`, `locale`, …); a typo'd or
 *   arbitrary excess key becomes a hard error; an undeclared key is no longer
 *   `unknown`. Also tighten `app.createContext()`'s INPUT (questpie.ts:961-971 has
 *   `[key: string]: any`, still fail-open). Globals are fixed FOR FREE — global CRUD
 *   imports `CRUDContext` directly.
 *
 *   Layer 1 deliberately KEEPS `db: any` (3 internal Drizzle-feeding consumers read
 *   `context.db` typed as `CRUDContext`); narrowing `db` is a SEPARATE Layer-2 PR.
 *   The `db`-not-any assertion below is therefore marked xfail-for-CL-12.
 *
 *   The loose `RequestContext` itself STAYS loose (it is the genuine heterogeneous
 *   ALS/wire shape) and `StoredContext` / `tryGetContext()` STAY tight — both are
 *   non-regression controls here, NOT burndown.
 *
 * MOST OF THESE FAIL TO COMPILE NOW. That is the burndown — Phase 3b flips them
 * green by retargeting `CRUDContext` to `BaseRequestContext` (Layer 1) and
 * tightening `createContext`'s input. The `RequestContext`-stays-loose and
 * `StoredContext`-stays-tight controls already pass and must KEEP passing.
 *
 * HARD-RULE compliance (proposal §4.1):
 *   - identity via `Equal`, never bare `extends`.
 *   - `@ts-expect-error` freshness probes are CALL sites (generic capture only
 *     fires at the call), each PAIRED with a positive companion so an unrelated
 *     failure on the same line cannot mask the guarantee.
 *   - boundaries probed with `IsUnknown` on the RAW value (never `NonNullable`).
 *   - CRUD signatures routed through the real `QuestpieApp` instance, never a raw
 *     builder (a raw builder hits a `never`-fallback and passes vacuously).
 */

import type {
	AssertUnknown,
	Equal,
	Expect,
	HasKey,
	IsUnknown,
	NoAny,
	NoUnknown,
} from "../_assert.js";
import type { App, QuestpieApp } from "../_fixtures.js";

import type {
	BaseRequestContext,
	RequestContext,
	StoredContext,
} from "#questpie/server/config/context.js";
import type { CRUDContext } from "#questpie/server/collection/crud/types.js";
import type { AccessMode } from "#questpie/server/config/types.js";

// ----------------------------------------------------------------------------
// Local helper: resolve key K on T, falling back to a sentinel when K is NOT a
// member — so the probe is meaningful BOTH today (index sig → K is a member →
// `unknown`) AND after the fix (no index sig → K absent → sentinel) WITHOUT
// triggering a raw TS2536 "cannot index" error post-fix. A typed result means
// "the index signature swallowed the key"; the literal sentinel means "key
// genuinely absent" (the target).
// ----------------------------------------------------------------------------
type IndexedOrAbsent<T, K extends string> = K extends keyof T
	? T[K]
	: "__qp_key_absent__";

// ============================================================================
// SECTION A — `CRUDContext` shape: no index signature, declared keys precise.
//
// The caller-facing ctx alias is the ONLY thing this cluster tightens. After the
// fix it equals the strict `BaseRequestContext`; today it equals the loose
// `RequestContext` (= `BaseRequestContext & { [key:string]: unknown }`).
// ============================================================================

/**
 * The keystone identity: post-fix `CRUDContext` is exactly `BaseRequestContext`.
 * FAILS today — `CRUDContext = RequestContext` carries the `[key:string]: unknown`
 * index signature, so it is NOT equal to the index-free base.
 */
type _ctxIsStrictBase = Expect<Equal<CRUDContext, BaseRequestContext>>;

/**
 * No phantom string index on the caller-facing ctx. `string extends keyof T` is
 * true exactly when T carries an index signature.
 * FAILS today (index sig present) — passes once `CRUDContext = BaseRequestContext`.
 */
type _ctxNoStringIndex = Expect<
	Equal<string extends keyof CRUDContext ? true : false, false>
>;

/**
 * A made-up key is NOT a member of the ctx. With the index signature gone,
 * `HasKey` returns false. FAILS today (index sig makes every key "present").
 */
type _ctxMadeUpKeyAbsent = Expect<
	Equal<HasKey<CRUDContext, "totally_made_up_key">, false>
>;

/** A typo of `accessMode` is likewise not a member. FAILS today. */
type _ctxTypoKeyAbsent = Expect<Equal<HasKey<CRUDContext, "accesMode">, false>>;

/**
 * Accessing an UNDECLARED key must NOT resolve to `unknown` (the index sig is what
 * makes it `unknown` today). `IndexedOrAbsent` keeps this safe post-fix: once the
 * index sig is gone the key is genuinely absent (sentinel), not a TS2536 error.
 * FAILS today — `[key:string]: unknown` makes `ctx['made_up']` = `unknown`.
 *
 * `NoUnknown` runs `IsUnknown` on the raw value (never `NonNullable`), per §4.1.
 */
type _ctxUndeclaredNotUnknown = Expect<NoUnknown<
	IndexedOrAbsent<CRUDContext, "made_up_key">
>>;

// ---- Declared members KEEP their precise types (positive controls) ----------
//
// These must hold AFTER the retarget (BaseRequestContext carries them) and guard
// against an over-aggressive fix that erases the well-known keys. `accessMode`
// being precise is the whole point — a typo no longer slips through, and the real
// key stays `AccessMode | undefined` (NOT widened to `string | unknown`).

/** `accessMode` stays the exact `AccessMode | undefined`. */
type _ctxAccessModePrecise = Expect<
	Equal<CRUDContext["accessMode"], AccessMode | undefined>
>;

/** `stage` stays `string | undefined` (the silently-swallowed workflow key). */
type _ctxStagePrecise = Expect<Equal<CRUDContext["stage"], string | undefined>>;

/** `locale` stays `string | undefined`. */
type _ctxLocalePrecise = Expect<Equal<CRUDContext["locale"], string | undefined>>;

/** `localeFallback` stays `boolean | undefined` (another swallowed access/i18n key). */
type _ctxLocaleFallbackPrecise = Expect<
	Equal<CRUDContext["localeFallback"], boolean | undefined>
>;

/** `session` stays the precise base-better-auth union, not widened to `unknown`. */
type _ctxSessionNotUnknown = Expect<NoUnknown<CRUDContext["session"]>>;

/**
 * LAYER 2 (separate PR) — `db` is no longer `any`. Layer 1 deliberately keeps
 * `db: any` because 3 internal Drizzle-feeding sites read `context.db` typed as
 * `CRUDContext`; narrowing `db` is explicitly out of scope for CL-12 (proposal
 * §CL-12 correction #1 — it would newly break `introspection.ts`/`access-control.ts`/
 * `shared/context.ts`). So this guarantee is RED-by-design after the Layer-1 fix.
 *
 * Encoded as the Layer-2 debt it is: a CONSUMED `@ts-expect-error`. `NoAny` runs
 * `IsAny` on the raw value (`0 extends 1 & T`), so `NoAny<CRUDContext["db"]>` is
 * `false` while `db: any`, and `Expect<false>` errors (TS2344) — the directive
 * consumes it. When Layer 2 narrows `db` off `any`, `NoAny` becomes `true`,
 * `Expect` stops erroring, and the now-UNUSED directive trips TS2578 — a loud
 * trip-wire demanding this be flipped back to a plain positive `Expect<NoAny<…>>`.
 */
// @ts-expect-error -- LAYER-2 DEBT: db is `any` by design in CL-12 Layer 1; flip to a plain positive Expect once db is narrowed (this directive then trips TS2578).
type _ctxDbNotAny = Expect<NoAny<CRUDContext["db"]>>;

// ============================================================================
// SECTION B — CRUD call-site excess-property checking (collections).
//
// The behavioral payload: a typo'd ctx key must ERROR at the actual CRUD call,
// and a valid ctx key must still COMPILE. `@ts-expect-error` only fires when the
// excess-prop check is back on; each is PAIRED with a positive companion.
//
// Routed through the REAL `QuestpieApp` instance (not a raw builder) so the ctx
// param is the genuine `CRUDContext` consumed in production.
// ============================================================================

declare const app: QuestpieApp;

async function _crudCtxCallSites() {
	const articles = app.collections.articles;

	// --- findOne ------------------------------------------------------------
	// POSITIVE: a valid declared ctx key compiles. Must ALWAYS pass.
	await articles.findOne({}, { accessMode: "user" });

	// BURNDOWN: typo of `accessMode` must ERROR (today: silently accepted).
	// @ts-expect-error -- typo'd `accesMode` is rejected once the index sig is gone.
	await articles.findOne({}, { accesMode: "system" });

	// BURNDOWN: an arbitrary excess key must ERROR.
	// @ts-expect-error -- arbitrary excess ctx key is rejected.
	await articles.findOne({}, { totallyMadeUpKey: 123 });

	// --- find ---------------------------------------------------------------
	// POSITIVE: valid `stage` compiles.
	await articles.find({}, { stage: "draft" });

	// BURNDOWN: typo of `stage` (workflow-stage selection footgun) must ERROR.
	// @ts-expect-error -- typo'd `staeg` is rejected.
	await articles.find({}, { staeg: "draft" });

	// --- create -------------------------------------------------------------
	// POSITIVE: valid `locale` ctx compiles on a write op.
	await articles.create(
		{ title: "t", slug: "s", author: "a1" } as never,
		{ locale: "en" },
	);

	// BURNDOWN: typo of `locale` must ERROR on the write path too.
	await articles.create(
		{ title: "t", slug: "s", author: "a1" } as never,
		// @ts-expect-error -- typo'd `locael` is rejected on create's ctx arg.
		{ locael: "en" },
	);

	// --- updateById (covers the class beyond read) --------------------------
	// POSITIVE: valid `localeFallback` ctx compiles.
	await articles.updateById(
		{ id: "1", data: {} as never },
		{ localeFallback: true },
	);

	// BURNDOWN: typo of `localeFallback` must ERROR.
	await articles.updateById(
		{ id: "1", data: {} as never },
		// @ts-expect-error -- typo'd `localFallback` is rejected.
		{ localFallback: true },
	);
}

// ============================================================================
// SECTION C — Globals get the fix FOR FREE (proposal correction #3).
//
// Global CRUD imports the SAME `CRUDContext` alias, so retargeting it tightens
// the global surface with zero extra edit. Probe a global's `get` (2nd positional
// ctx arg, same contract as collection `findOne`).
// ============================================================================

async function _globalCtxCallSites() {
	const site = app.globals.site;

	// POSITIVE: valid declared ctx key compiles on a global read.
	await site.get({}, { accessMode: "user" });

	// BURNDOWN: typo'd ctx key on a GLOBAL must ERROR (parity with collections).
	// @ts-expect-error -- typo'd `accesMode` rejected on global `get` ctx arg.
	await site.get({}, { accesMode: "system" });

	// POSITIVE: valid ctx on a global write (`update(data, context, options?)`).
	await site.update({ siteName: "x" } as never, { stage: "published" });

	// BURNDOWN: arbitrary excess ctx key on a global write must ERROR.
	// @ts-expect-error -- arbitrary excess key rejected on global `update` ctx arg.
	await site.update({ siteName: "x" } as never, { madeUpGlobalKey: 1 });
}

// ============================================================================
// SECTION D — `app.createContext()` INPUT is tightened (proposal correction #2).
//
// `createContext`'s param has `[key: string]: any` (questpie.ts:961-971), so a
// user calling `createContext({ accesMode: 'user' })` is STILL fail-open even
// after `CRUDContext` is fixed. The cluster's CLASS includes closing this entry
// point. `request?: Request` must remain a valid key.
// ============================================================================

type CreateContextInput = Parameters<QuestpieApp["createContext"]>[0];

/**
 * No phantom string index on the createContext INPUT. FAILS today
 * (`[key: string]: any`) — passes once the input is closed to known keys + `request`.
 */
type _createCtxNoStringIndex = Expect<
	Equal<string extends keyof NonNullable<CreateContextInput> ? true : false, false>
>;

/**
 * A typo'd key on the createContext input is NOT a member. FAILS today —
 * the `[key:string]: any` makes every key present (and `accesMode` resolves to `any`).
 */
type _createCtxTypoAbsent = Expect<
	Equal<HasKey<NonNullable<CreateContextInput>, "accesMode">, false>
>;

/** `request` stays a valid input key (proposal: "keep `request?: Request`"). */
type _createCtxKeepsRequest = Expect<
	HasKey<NonNullable<CreateContextInput>, "request">
>;

async function _createContextCallSites() {
	// POSITIVE: valid declared key compiles.
	await app.createContext({ accessMode: "user" });

	// POSITIVE: `request` still accepted.
	await app.createContext({ request: new Request("http://x") });

	// BURNDOWN: typo of `accessMode` must ERROR (else fail-open at the entry point).
	// @ts-expect-error -- typo'd `accesMode` rejected on createContext input.
	await app.createContext({ accesMode: "user" });
}

// ============================================================================
// SECTION E — NON-REGRESSION CONTROLS (these already pass; must STAY passing).
//
// The fix tightens ONLY the caller-facing `CRUDContext`. The wire/ALS shapes are
// intentionally loose/tight as-is — guard that the fix doesn't accidentally move
// them.
// ============================================================================

/**
 * `RequestContext` STAYS LOOSE — it is the genuine heterogeneous ALS/wire shape
 * (the index signature is deliberate there). A made-up key is still "present".
 * This already passes today and MUST keep passing (it is NOT the thing we fix).
 */
type _requestContextStaysLoose = Expect<
	HasKey<RequestContext, "totally_made_up_key">
>;

/** `RequestContext` still carries its string index signature (wire shape intact). */
type _requestContextKeepsIndex = Expect<
	Equal<string extends keyof RequestContext ? true : false, true>
>;

/**
 * On the loose `RequestContext`, an undeclared key IS `unknown` (by design — the
 * index sig). Confirms the two roles are genuinely distinct: `CRUDContext` tightens
 * while `RequestContext` keeps its `unknown` index. Already passes; must stay.
 */
type _requestContextUndeclaredIsUnknown = Expect<AssertUnknown<
	RequestContext["any_random_key"]
>>;

/**
 * `StoredContext` (returned by `tryGetContext()`) is ALREADY index-sig-free and
 * must STAY tight — it is a non-regression control, not burndown. A made-up key
 * is absent today and after the fix.
 */
type _storedContextStaysTight = Expect<
	Equal<HasKey<StoredContext, "totally_made_up_key">, false>
>;

/** `StoredContext` has no string index (tight wire-read shape). */
type _storedContextNoIndex = Expect<
	Equal<string extends keyof StoredContext ? true : false, false>
>;

/**
 * `BaseRequestContext` is — and must remain — index-sig-free (it is the retarget
 * destination). If this regressed, the whole Layer-1 fix would be undermined.
 */
type _baseRequestContextNoIndex = Expect<
	Equal<string extends keyof BaseRequestContext ? true : false, false>
>;

/**
 * Sanity (positive control, already GREEN): the strict base the CRUD args SHOULD
 * use does NOT make an undeclared key `unknown` (the divergence from
 * `RequestContext`). Pins the TARGET behavior `CRUDContext` must adopt; passes
 * today and after the fix regardless of the `CRUDContext` alias state.
 */
type _baseUndeclaredNotUnknown = Expect<
	Equal<IsUnknown<IndexedOrAbsent<BaseRequestContext, "made_up_key">>, false>
>;

// ============================================================================
// SECTION F — Per-method class coverage (the fix is at the alias, so it spans
// EVERY CRUD method, not just the ones probed above).
//
// Assert the ctx parameter type of a representative spread of collection + global
// methods all equal the strict base post-fix. FAILS today on each (all = the loose
// `RequestContext` via `CRUDContext`); passes uniformly after the one-line retarget.
// ============================================================================

type Articles = QuestpieApp["collections"]["articles"];
type SiteGlobal = QuestpieApp["globals"]["site"];

/** ctx param of `findOne` is the strict base. */
type _findOneCtx = Expect<
	Equal<NonNullable<Parameters<Articles["findOne"]>[1]>, BaseRequestContext>
>;

/** ctx param of `find` is the strict base. */
type _findCtx = Expect<
	Equal<NonNullable<Parameters<Articles["find"]>[1]>, BaseRequestContext>
>;

/** ctx param of `create` (write path) is the strict base. */
type _createCtx = Expect<
	Equal<NonNullable<Parameters<Articles["create"]>[1]>, BaseRequestContext>
>;

/** ctx param of `updateById` is the strict base. */
type _updateByIdCtx = Expect<
	Equal<NonNullable<Parameters<Articles["updateById"]>[1]>, BaseRequestContext>
>;

/** ctx param of `count` is the strict base. */
type _countCtx = Expect<
	Equal<NonNullable<Parameters<Articles["count"]>[1]>, BaseRequestContext>
>;

/** GLOBAL `get` ctx param is the strict base (parity, for free). */
type _globalGetCtx = Expect<
	Equal<NonNullable<Parameters<SiteGlobal["get"]>[1]>, BaseRequestContext>
>;

/** GLOBAL `update` ctx param (2nd positional) is the strict base. */
type _globalUpdateCtx = Expect<
	Equal<NonNullable<Parameters<SiteGlobal["update"]>[1]>, BaseRequestContext>
>;

// ============================================================================
// SECTION G — the two-roles SPLIT, and `App`-shape anchoring.
//
// The whole fix is "one type stops playing two roles": the wire/ALS
// `RequestContext` stays loose while the caller-facing `CRUDContext` becomes
// strict. So post-fix the two are NO LONGER identical. Today they are the same
// type (`CRUDContext = RequestContext`), so this is RED now / GREEN after — the
// single most direct encoding of the cluster's root fix.
// ============================================================================

/**
 * `CRUDContext` and `RequestContext` DIVERGE after the fix (strict caller-facing
 * vs loose wire). FAILS today — they are the same aliased type.
 */
type _ctxAndRequestContextDiverge = Expect<
	Equal<Equal<CRUDContext, RequestContext>, false>
>;

/**
 * The strict ctx must NOT carry the loose index signature that `RequestContext`
 * does. Restated against the two roles: `string extends keyof CRUDContext` flips
 * to false while it stays true for `RequestContext`. FAILS today.
 */
type _ctxDropsLooseIndexButRequestKeeps = Expect<
	Equal<
		[
			string extends keyof CRUDContext ? true : false,
			string extends keyof RequestContext ? true : false,
		],
		[false, true]
	>
>;

// ---- `App` (manual `{ collections, globals }` shape) anchoring --------------
// The 2-arg CRUD helpers consume `App`; anchor it so the import is load-bearing
// and the cluster's surface is pinned to the manual-composition shape too. These
// are structural controls (already GREEN) — `App`'s own keys are unaffected by
// the ctx fix; the ctx-arg burndown rides on `QuestpieApp` above.
type _appHasCollections = Expect<HasKey<App, "collections">>;
type _appHasGlobals = Expect<HasKey<App, "globals">>;
