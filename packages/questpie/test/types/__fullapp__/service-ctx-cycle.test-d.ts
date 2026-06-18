/**
 * Full-app gate — SERVICE-CTX CYCLE probe (§2.2 fixpoint).
 *
 * The fixture's `analyticsService` (services/analytics.ts) has an INFERRED-return
 * `create((ctx) => …)` that reads `ctx.services` at create-time: an EAGER
 * property `crossRef: ctx.services.reporting` (cross) and a method `peek()`
 * returning `ctx.services.analytics` (self). The eager cross-property forces TS
 * to compute `ctx.services.reporting`'s type WHILE the services fold is being
 * computed: `_AppDefaultServices` (the namespace-filtered fold) →
 * `ServiceInstanceOf<typeof analyticsService>` → `ServiceCreateContext.services`
 * → (pre-fix) `_AppDefaultServices` again.
 *
 * BEFORE the fix (`ServiceCreateContext.services = _AppDefaultServices`, the
 * whole atomic fold): with the real AppContext depth TS cannot resolve the
 * fixpoint and degrades the WHOLE `ctx.services` — TS2456 alias-circularity on
 * `_AppInfraContext`/`_AppCoreContext` and TS2310 on `ServiceCreateContext`,
 * poisoning the cross/self reads inside the service AND the composed
 * `AppServices`/`_AppDefaultServices`.
 *
 * AFTER the fix: `ServiceCreateContext.services` reads the by-name
 * `Questpie.Services` interface, which extends the FLAT per-key
 * `_AppServicesSeam` (each instance resolved off the already-computed `keyof
 * _AppDefaultServices` key set, NOT the whole fold), so cross/self reads resolve
 * independently and the instances stay precise. The OUTER `AppContext.services`
 * still uses the whole-fold `_AppDefaultServices` (unchanged) — it is not a
 * service-create position.
 *
 * These assert IDENTITY (NoAny + bogus-key error) against:
 *   (a) the composed `AppServices` / `_AppDefaultServices` (the fold itself), and
 *   (b) the `ctx.services` surface as seen INSIDE the inferred-return service.
 */
import "./.generated/factories.js";
import type { AppServices } from "./.generated/index.js";

import { analyticsService } from "./services/analytics.js";
import { reportingService } from "./services/reporting.js";

import type { Equal, Expect, HasKey } from "../type-test-utils.js";
import type { NoAny } from "../_assert.js";

// ── (a) The composed services fold resolves (no TS2456 degradation) ─────────
// AppServices must carry BOTH the inferred-return cycle-trigger (`analytics`)
// and the cross-referenced (`reporting`) instance, each precise (not `any`).
type _servicesHasAnalytics = Expect<HasKey<AppServices, "analytics">>;
type _servicesHasReporting = Expect<HasKey<AppServices, "reporting">>;
type _analyticsNotAny = Expect<NoAny<AppServices["analytics"]>>;
type _reportingNotAny = Expect<NoAny<AppServices["reporting"]>>;

// The inferred-return instance members survive the fold (not poisoned to `any`).
type _analyticsInstance = AppServices["analytics"];
type _analyticsHasCrossRef = Expect<HasKey<_analyticsInstance, "crossRef">>;
type _analyticsHasPeek = Expect<HasKey<_analyticsInstance, "peek">>;
type _analyticsLabelExact = Expect<Equal<_analyticsInstance["label"], "analytics">>;
// The eager cross-property `crossRef` is the REAL reporting instance, not `any`.
type _analyticsCrossRefNotAny = Expect<NoAny<_analyticsInstance["crossRef"]>>;
type _analyticsCrossRefHasMethod = Expect<
	HasKey<_analyticsInstance["crossRef"], "countArticles">
>;

// ── (b) Inside the service: ctx.services.<other> is the REAL instance ───────
// Extract the create-ctx the fixture's service actually sees.
type AnalyticsCreateCtx = Parameters<
	NonNullable<(typeof analyticsService)["state"]["create"]>
>[0];

// ctx.services must be a real object (NOT an error/`any`), with precise members.
type _ctxServicesNotAny = Expect<NoAny<AnalyticsCreateCtx["services"]>>;
type _ctxServicesHasReporting = Expect<
	HasKey<AnalyticsCreateCtx["services"], "reporting">
>;
type _ctxServicesHasAnalytics = Expect<
	HasKey<AnalyticsCreateCtx["services"], "analytics">
>;

// ctx.services.reporting (cross) is the REAL instance — NoAny + carries its
// method (would be `any`/error under the degraded TS2538 ctx.services).
type _ctxReportingNotAny = Expect<NoAny<AnalyticsCreateCtx["services"]["reporting"]>>;
type _ctxReportingHasMethod = Expect<
	HasKey<AnalyticsCreateCtx["services"]["reporting"], "countArticles">
>;

// ctx.services.analytics (self) is the REAL instance — NoAny + carries `peek`.
type _ctxAnalyticsNotAny = Expect<NoAny<AnalyticsCreateCtx["services"]["analytics"]>>;
type _ctxAnalyticsHasPeek = Expect<
	HasKey<AnalyticsCreateCtx["services"]["analytics"], "peek">
>;

// BOGUS-KEY guard — an unknown service key must be an error, NOT silent `any`
// (the ambient `Questpie.Services` interface has NO index signature). Paired
// positive companion above (_ctxServicesHasReporting) per assert-kit rule 4.
type _ctxServicesNoBogus = Expect<
	Equal<HasKey<AnalyticsCreateCtx["services"], "zzz_not_a_service">, false>
>;

// ── (c) The OUTER AppContext.services is UNCHANGED + STILL typed ─────────────
// The fix LEAVES `AppContext.services = _AppDefaultServices` (the whole fold) —
// AppContext / hook / job / route ctx is NOT a service-create position. It must
// remain the real default-namespace instances (not `any`, real members), proving
// the decoupling did not break the outer context.
type _outerServices = Questpie.AppContext["services"];
type _outerServicesNotAny = Expect<NoAny<_outerServices>>;
type _outerHasReporting = Expect<HasKey<_outerServices, "reporting">>;
type _outerHasAnalytics = Expect<HasKey<_outerServices, "analytics">>;
type _outerReportingNotAny = Expect<NoAny<_outerServices["reporting"]>>;
type _outerReportingHasMethod = Expect<
	HasKey<_outerServices["reporting"], "countArticles">
>;

export type { AppServices, AnalyticsCreateCtx };
