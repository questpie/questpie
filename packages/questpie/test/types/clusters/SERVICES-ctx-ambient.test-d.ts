/**
 * SERVICES-ctx-ambient — the §2.2 service-create-context fixpoint + its fix.
 *
 * ROOT CAUSE: `ServiceCreateContext` (the ctx of `service().create(ctx)`) used
 * to read `services` from `_AppDefaultServices` — the namespace-filtered WHOLE
 * fold `{ [K in keyof ServiceDefinitionsInNamespace<Defs,"services">]:
 * ServiceInstanceOf<Defs[K]> }`. A service whose INFERRED instance reads
 * `ctx.services` at create-time made computing that fold depend on the very
 * service being captured (its `typeof` is in-flight), so the fold re-entered →
 * TS2456 alias-circularity that degraded the WHOLE `ctx.services`.
 *
 * FIX (codegen, root template): `ServiceCreateContext.services` reads the by-name
 * ambient `Questpie.Services` interface, which extends the FLAT seam
 * `_AppServicesSeam = { [K in keyof _AppServiceDefinitions]:
 * ServiceInstanceOf<_AppServiceDefinitions[K]> }`. Keyed over the LITERAL
 * `keyof _AppServiceDefinitions` (read from the definitions object STRUCTURE, no
 * member-type resolution → acyclic even mid-capture) and indexed PER-KEY, so
 * cross/self reads resolve independently. The OUTER `AppContext.services` keeps
 * the whole-fold `_AppDefaultServices` (off the cyclic edge — not a create
 * position).
 *
 * This file is compiled by tsconfig.pending.json (NOT the __fullapp__ fixture).
 * It probes (a) the PRE-CODEGEN ambient `Questpie.Services` seam contract and
 * (b) a SELF-CONTAINED model of the fold↔seam difference — the whole-fold form
 * RED-control vs the flat per-key seam GREEN — using the REAL `ServiceInstanceOf`
 * and the REAL `ServiceInstancesInNamespace`/`ServiceDefinitionsInNamespace`. The
 * fullapp fixture (test/types/__fullapp__/service-ctx-cycle.test-d.ts) is the
 * REAL composed-app RED→GREEN proof.
 */

import type { Equal, Expect, HasKey, NoAny } from "../_assert.js";

import type { ServiceInstanceOf } from "#questpie/server/services/define-service.js";
import type {
	ServiceInstancesInNamespace,
	ServiceDefinitionsInNamespace,
} from "#questpie/server/config/codegen-type-utils.js";

// ============================================================================
// (a) PRE-CODEGEN ambient seam contract.
//
// `Questpie.Services` exists (app-context.ts seam) and is EMPTY pre-codegen,
// with NO index signature — so it is NOT `any` and carries no `string` index
// (an unknown service key must be a compile error once codegen fills it, never a
// silent `any`). This is the same acyclic-seam shape as FieldTypesMap.
// ============================================================================

type _servicesSeamNoAny = Expect<NoAny<Questpie.Services>>;
// No string index signature (finite key set, like FieldTypesMap / CollectionKeys).
type _servicesSeamNoStringIndex = Expect<
	Equal<string extends keyof Questpie.Services ? true : false, false>
>;

// ============================================================================
// (b) SELF-CONTAINED model — the fold↔seam difference, with the REAL utils.
//
// Two services: `analytics`'s INFERRED instance EAGER-reads `ctx.services.reporting`
// (cross) at create-time; `reporting` is independent. `ctx` is typed by whichever
// seam we plug in. We compare:
//   _DefaultFold  = ServiceInstancesInNamespace<Defs,"services">   (the OLD whole fold)
//   _FlatSeam     = { [K in keyof Defs]: ServiceInstanceOf<Defs[K]> }  (the FIX seam)
// and assert the FLAT seam keeps the cross instance precise.
// ============================================================================

// The create-ctx the SEAM provides — only the `services` surface matters here.
// Modeled as plain `{ create }` defs (NOT `service()`, whose `ctx` is fixed to
// `ServiceCreateContext`) so we can plug the seam-typed ctx AND so
// `ServiceInstanceOf` takes its `{ create: (...) => infer I }` branch — the
// fold-time RE-inference path that exercises the create-time read.
const analyticsModel = {
	create: (ctx: SeamCtx) => ({
		// EAGER cross-read — forces `ctx.services.reporting`'s type immediately.
		crossRef: ctx.services.reporting,
		label: "analytics" as const,
	}),
};
const reportingModel = {
	create: () => ({
		countArticles() {
			return 0;
		},
	}),
};

interface SeamCtx {
	services: _FlatSeam;
}

type _Defs = {
	analytics: typeof analyticsModel;
	reporting: typeof reportingModel;
};

// The FIX seam — flat, keyed over the LITERAL `keyof _Defs` (acyclic), per-key.
type _FlatSeam = {
	[K in keyof _Defs]: ServiceInstanceOf<_Defs[K]>;
};

// The OLD whole-fold (namespace-filtered) — kept for the OUTER-context surface.
type _DefaultFold = ServiceInstancesInNamespace<_Defs, "services">;

// Both services land in the DEFAULT namespace (no `.namespace()` call) — the
// filtered definition set carries both keys.
type _DefaultDefs = ServiceDefinitionsInNamespace<_Defs, "services">;
type _defaultHasAnalytics = Expect<HasKey<_DefaultDefs, "analytics">>;
type _defaultHasReporting = Expect<HasKey<_DefaultDefs, "reporting">>;

// The flat seam resolves the cross instance PRECISELY (NoAny + carries the
// reporting method) — the eager `crossRef` read did NOT degrade it.
type _analyticsInstance = ServiceInstanceOf<typeof analyticsModel>;
type _crossRef = _analyticsInstance["crossRef"];
type _crossRefNotAny = Expect<NoAny<_crossRef>>;
type _crossRefHasMethod = Expect<HasKey<_crossRef, "countArticles">>;
// The plain instance member survives.
type _labelExact = Expect<Equal<_analyticsInstance["label"], "analytics">>;

// The flat seam and the whole-fold agree on the resolved DEFAULT instances
// (same members) — the fix is a CYCLE-SAFE re-spelling of the same surface for
// the create-context, not a different shape.
type _seamReportingNotAny = Expect<NoAny<_FlatSeam["reporting"]>>;
type _foldReportingNotAny = Expect<NoAny<_DefaultFold["reporting"]>>;
type _seamFoldReportingSame = Expect<
	Equal<_FlatSeam["reporting"], _DefaultFold["reporting"]>
>;

export type { SeamCtx, _Defs, _FlatSeam, _DefaultFold, _analyticsInstance };
