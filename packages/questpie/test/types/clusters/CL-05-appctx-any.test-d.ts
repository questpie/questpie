/**
 * CL-05 — App-level hook / access / context-resolver ctx typed all-`any`
 * (the `AppContextBase` cycle-break over-erases).
 *
 * ROOT CAUSE (proposal §3 CL-05): one real `TS2456` fear (the generated index
 * consumes `typeof config/app.ts`, so a hook/access rule whose param resolves
 * through the augmented `AppContext` re-enters the augmentation and collapses
 * it) caused FOUR degradations, all broader than necessary:
 *
 *   ctx-02  `appConfig({ hooks })` collection-hook ctx — `collections`/`db`/
 *           `session`/`queue` are ALL `any` (`GlobalCollectionHookContext` ∩
 *           `AppContextBase`, where every infra key is declared `: any`).
 *   ctx-03  `appConfig({ access })` default-rule ctx — `session`/`collections`/
 *           `db` are ALL `any` (`AppDefaultAccessRule` ctx ∩ `AppContextBase`).
 *   cyc-1   `InferContextExtensionsFromAppConfig` collapses a nullable/union
 *           resolver return `{ role } | null` to `{}` (non-distributive
 *           `Awaited<R> extends Record<string,any>` fails on the `null` arm),
 *           and async non-object returns are NOT rejected.
 *   cyc-4   `ContextResolverParams.session`/`db` route through the FULL
 *           augmented `AppContext` — a live `AppContext → extensions → typeof
 *           appConfig → ContextResolverParams → AppContext` loop, held intact
 *           only because the inference reads the resolver RETURN not its PARAM.
 *           The fix points them at a dedicated `Questpie.ContextResolverBase`
 *           seam so they no longer thread the cyclic edge → they become precise.
 *
 * TARGET (after the fix): the lazy augmented seams (`Questpie.AppHookContext {}`
 * / `Questpie.AppDefaultAccessContext {}` / `Questpie.ContextResolverBase`,
 * filled by codegen with the real infra members) make these ctx surfaces
 * PRECISE — `collections`/`db`/`session`/`queue` are concrete, NOT `any`. And
 * `InferContextExtensionsFromAppConfig` strips `null` BEFORE the `Record` test
 * so a union return keeps its object shape.
 *
 * cyc-5 is SPLIT OFF and governed by the reviewer override: do NOT make
 * `getContext`'s bundle non-optional globally (that lies in system mode).
 * Request-scoped precision belongs to the inference channel — see the cyc-5
 * section — and `getContext` stays optional/absent in system mode.
 *
 * MOST OF THESE FAIL TO COMPILE NOW. That is the burndown — Phase 3b flips them
 * green by replacing `AppContextBase`'s all-`any` seam with the lazy interfaces.
 *
 * NOTE: CL-05 probes the APP-LEVEL `appConfig(...)` surface, which is global /
 * augmentation-driven and does not consume the per-collection fixtures. We probe
 * the canonical config symbols directly (the stable target surface) AND mirror
 * the findings' exact `Parameters<typeof appConfig>[0]` chains. The `_fixtures`
 * `App` is imported for the resolver-params / getContext system-mode probes.
 */

import type {
	Equal,
	Expect,
	HasKey,
	IsAny,
	IsOptional,
	Not,
	NoAny,
} from "../_assert.js";
import type { App } from "../_fixtures.js";

import { appConfig } from "#questpie/server/config/factories.js";
import type {
	getContext,
	InferContextExtensionsFromAppConfig,
} from "#questpie/server/config/context.js";
import type {
	AppDefaultAccessRule,
	AppConfigInput,
} from "#questpie/server/config/module-types.js";
import type {
	GlobalCollectionHookContext,
	GlobalGlobalHookContext,
} from "#questpie/server/config/global-hooks-types.js";
import type { ContextResolverParams } from "#questpie/server/config/types.js";

// ============================================================================
// Extractors — pull the ctx parameter out of each app-level rule/hook surface.
//
// We extract from BOTH the canonical type symbols (stable target surface) and
// the live `Parameters<typeof appConfig>[0]` chains the findings used, so the
// fix is locked at the public seam AND at the actual `appConfig({...})` call.
// ============================================================================

/** ctx-02 — collection-hook ctx via the canonical hook-context type. */
type HookCtx = GlobalCollectionHookContext;

/** ctx-02 — collection-hook ctx via the exact `appConfig({ hooks })` chain. */
type AppHooksInput = NonNullable<Parameters<typeof appConfig>[0]["hooks"]>;
type AppCollHookCtx = Parameters<
	NonNullable<NonNullable<AppHooksInput["collections"]>["afterChange"]>
>[0];

/** ctx-02 — global-hook ctx (the `globals` half of `appConfig({ hooks })`). */
type GlobalHookCtx = GlobalGlobalHookContext;

/** ctx-03 — app default access-rule ctx via the canonical rule type. */
type DefAccessCtx = Parameters<Extract<AppDefaultAccessRule, (...a: any[]) => any>>[0];

/** ctx-03 — app default access-rule ctx via the exact `appConfig({ access })` chain. */
type AppAccessInput = NonNullable<Parameters<typeof appConfig>[0]["access"]>;
type AppCreateAccessCtx = Parameters<
	Extract<NonNullable<AppAccessInput["create"]>, (...a: any[]) => any>
>[0];

// ============================================================================
// ctx-02 — collection-hook ctx infra keys are PRECISE, not `any`.
//
// Today every probe is `any` (AppContextBase declares db/session/queue/
// collections/globals/... as `: any`). The fix makes them concrete.
// ============================================================================

// Canonical-symbol probes (FAIL now: each is `any`).
type _hook_collections_notAny = Expect<NoAny<HookCtx["collections"]>>;
type _hook_globals_notAny = Expect<NoAny<HookCtx["globals"]>>;
type _hook_db_notAny = Expect<NoAny<HookCtx["db"]>>;
type _hook_session_notAny = Expect<NoAny<HookCtx["session"]>>;
type _hook_queue_notAny = Expect<NoAny<HookCtx["queue"]>>;

// Exact-finding probes via `appConfig({ hooks })` (the ctx-02 regressionTest).
type _appHook_collections_notAny = Expect<Not<IsAny<AppCollHookCtx["collections"]>>>;
type _appHook_session_notAny = Expect<Not<IsAny<AppCollHookCtx["session"]>>>;
type _appHook_db_notAny = Expect<Not<IsAny<AppCollHookCtx["db"]>>>;
type _appHook_queue_notAny = Expect<Not<IsAny<AppCollHookCtx["queue"]>>>;

// Global-hook ctx shares the same `AppContextBase` erasure — same class.
type _globalHook_collections_notAny = Expect<NoAny<GlobalHookCtx["collections"]>>;
type _globalHook_db_notAny = Expect<NoAny<GlobalHookCtx["db"]>>;
type _globalHook_session_notAny = Expect<NoAny<GlobalHookCtx["session"]>>;

// Precise infra keys must be REACHABLE (the hook ctx must still carry them —
// guards an over-correction that drops the keys entirely instead of typing them).
type _hook_hasCollections = Expect<HasKey<HookCtx, "collections">>;
type _hook_hasDb = Expect<HasKey<HookCtx, "db">>;
type _hook_hasSession = Expect<HasKey<HookCtx, "session">>;

// Hook-specific fields stay intact alongside the now-precise infra (the seam
// swap must not disturb data/operation/onAfterCommit).
type _hook_keepsData = Expect<HasKey<HookCtx, "data">>;
type _hook_operation_exact = Expect<
	Equal<HookCtx["operation"], "create" | "update" | "delete">
>;

// ============================================================================
// ctx-03 — app default access-rule ctx infra keys are PRECISE, not `any`.
//
// Today `session`/`collections`/`db` are `any`, so `({ session }) => session.user.rOle`
// (typo) compiles silently. The fix makes the predicate ctx concrete.
// ============================================================================

// Canonical-symbol probes (FAIL now: each is `any`).
type _access_session_notAny = Expect<NoAny<DefAccessCtx["session"]>>;
type _access_collections_notAny = Expect<NoAny<DefAccessCtx["collections"]>>;
type _access_db_notAny = Expect<NoAny<DefAccessCtx["db"]>>;

// Exact-finding probes via `appConfig({ access })` (the ctx-03 regressionTest).
type _appAccess_session_notAny = Expect<Not<IsAny<AppCreateAccessCtx["session"]>>>;
type _appAccess_collections_notAny = Expect<Not<IsAny<AppCreateAccessCtx["collections"]>>>;
type _appAccess_db_notAny = Expect<Not<IsAny<AppCreateAccessCtx["db"]>>>;

// The access-rule extras (data/input/locale/request) survive the seam swap.
type _access_hasData = Expect<HasKey<DefAccessCtx, "data">>;
type _access_hasInput = Expect<HasKey<DefAccessCtx, "input">>;

// ============================================================================
// cyc-1 — context-resolver derived extensions: union return keeps its shape.
//
// `InferContextExtensionsFromAppConfig<{ context: async () => ({role}) | null }>`
// resolves to `{}` today (the `null` arm fails the non-distributive Record test).
// Target: `{ role: "user" }` — null is stripped BEFORE the Record gate.
// ============================================================================

// A resolver appConfig whose return is a `{ role } | null` UNION (the common
// "session? {role} : null" shape). Built as a real `appConfig({...})` call site
// so the inference runs over an actual capture.
const _cfgNullable = appConfig({
	context: async ({ session }) => (session ? { role: "user" as const } : null),
});
type NullableExt = InferContextExtensionsFromAppConfig<typeof _cfgNullable>;

// FAILS now: NullableExt collapses to `{}` (keys lost).
type _cyc1_unionKept = Expect<Equal<NullableExt, { role: "user" }>>;
// The `role` key must survive (not vanish into `{}`).
type _cyc1_hasRole = Expect<HasKey<NullableExt, "role">>;
type _cyc1_role_notAny = Expect<NoAny<NullableExt["role"]>>;

// A plain (non-nullable) object return must keep working — negative control,
// passes today AND after the fix (guards against an over-eager rewrite).
const _cfgPlain = appConfig({
	context: async () => ({ tenantId: "t1" }),
});
type PlainExt = InferContextExtensionsFromAppConfig<typeof _cfgPlain>;
type _cyc1_plainKept = Expect<Equal<PlainExt, { tenantId: string }>>;

// A primitive (non-object) return must yield `{}` — extensions can only be an
// object bundle (this arm stays `{}` before AND after; control that the rewrite
// did not turn the primitive arm into the value itself).
type StringExt = InferContextExtensionsFromAppConfig<{
	context: (params: any) => Promise<string>;
}>;
type _cyc1_primitiveIsEmpty = Expect<Equal<StringExt, {}>>;

// cyc-1 negative — async non-object resolver returns must be REJECTED at the
// `appConfig({...})` call site. Today the async branch escapes the
// `Record<string,any>` constraint, so this is accepted and the directive is
// UNUSED. After the fix the directive becomes USED (TS2578 → the bad return
// is a hard error). Paired with the positive `_cyc1_unionKept` above per kit
// rule 4. Real call sites (generic capture fires at the call) per kit rule 5.
const _cfgBadString = appConfig({
	// @ts-expect-error — async resolver returning a primitive must not type-check.
	context: async () => "just-a-string",
});
const _cfgBadNull = appConfig({
	// @ts-expect-error — async resolver returning `null`-only must not type-check.
	context: async () => null,
});

// ============================================================================
// cyc-4 — `ContextResolverParams.session`/`db` are PRECISE (off the cyclic edge).
//
// They route through the full augmented `AppContext` today (a latent re-cycle).
// The fix points them at `Questpie.ContextResolverBase`, so codegen fills them
// with real `session`/`db` and they stop being the loose `any`/fallback shape.
// ============================================================================

type _resolverParams_db_notAny = Expect<NoAny<ContextResolverParams["db"]>>;
type _resolverParams_session_notAny = Expect<NoAny<ContextResolverParams["session"]>>;

// The resolver params must still carry `request` (HTTP request is always there)
// and the session/db keys — guards against the seam dropping them.
type _resolverParams_hasRequest = Expect<HasKey<ContextResolverParams, "request">>;
type _resolverParams_hasDb = Expect<HasKey<ContextResolverParams, "db">>;
type _resolverParams_hasSession = Expect<HasKey<ContextResolverParams, "session">>;

// ============================================================================
// cyc-5 (reviewer-authoritative scope) — request-scoped precision lives in the
// inference channel, NOT in a global non-optional `getContext`.
//
// A resolver that ALWAYS returns a key must surface that key as REQUIRED in the
// inferred extensions (request-scoped consumers — access rules / hooks — see it
// as non-optional). The `Partial<>` wrap that optionalizes guaranteed keys is
// the cyc-5 looseness, but it lives in the generated `_AppContextExtensions`,
// downstream of THIS inference. So we assert the inference itself does not
// optionalize a guaranteed key.
// ============================================================================

const _cfgGuaranteed = appConfig({
	context: async ({ request }) => ({
		cityId: (request.headers.get("x-city") || null) as string | null,
	}),
});
type GuaranteedExt = InferContextExtensionsFromAppConfig<typeof _cfgGuaranteed>;

// The guaranteed key is REQUIRED (not optional) in the inferred bundle.
type _cyc5_cityId_required = Expect<Equal<IsOptional<GuaranteedExt, "cityId">, false>>;
// And it carries its real type, not `any`.
type _cyc5_cityId_exact = Expect<Equal<GuaranteedExt["cityId"], string | null>>;

// cyc-5 system-mode guard (reviewer override): `getContext` MUST NOT lie in
// system mode. For an app with no context resolver wired (`_fixtures` `App`),
// the extension bundle is empty/absent — `getContext<App>()` exposes only the
// infra keys, and no resolver-derived key is wrongly promised. Probing `App`
// (no `~contextExtensions`) the extensions contribute NO keys.
type SystemCtx = ReturnType<typeof getContext<App>>;
// `app`/`session`/`db` are the always-present infra keys getContext provides.
type _sys_hasApp = Expect<HasKey<SystemCtx, "app">>;
type _sys_hasSession = Expect<HasKey<SystemCtx, "session">>;
type _sys_hasDb = Expect<HasKey<SystemCtx, "db">>;
// No phantom resolver key is promised in system mode (App has no resolver):
// `cityId` must NOT appear on the system-mode context.
type _sys_noPhantomKey = Expect<Equal<HasKey<SystemCtx, "cityId">, false>>;

// ============================================================================
// Cross-cutting — the `AppConfigInput` surface stays usable (no over-erasure).
//
// `hooks`/`access`/`context` must remain optional members of the app config
// input; the seam swap is a TYPE change on the ctx params, not a restructure.
// ============================================================================

type _cfg_hasHooks = Expect<HasKey<AppConfigInput, "hooks">>;
type _cfg_hasAccess = Expect<HasKey<AppConfigInput, "access">>;
type _cfg_hasContext = Expect<HasKey<AppConfigInput, "context">>;
