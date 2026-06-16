/**
 * Full-app gate fixture — the CYCLE-TRIGGER service (§2.2 fixpoint).
 *
 * Defined via `service({ create: (ctx) => … })` (the REAL user shape — a
 * captured `ServiceBuilder`, exactly what codegen folds as `typeof
 * analyticsService`). Its INFERRED instance reads `ctx.services` AT CREATE-TIME,
 * cross AND self:
 *
 *   crossRef  → ctx.services.reporting          (CROSS, EAGER property)
 *   peek()    → ctx.services.analytics          (SELF, deferred method)
 *
 * The EAGER `crossRef` property is the trigger: computing the inferred instance
 * requires `ctx.services.reporting`'s type immediately, which (before the fix)
 * reads `ServiceCreateContext.services = _AppDefaultServices` — the WHOLE
 * namespace-filtered fold — WHILE that fold is being computed. With the real
 * AppContext depth (`_AppQuestpie` app type, config-derived extensions) TS
 * cannot resolve it and degrades the WHOLE `ctx.services` (TS2456
 * alias-circularity on `_AppInfraContext`/`_AppCoreContext`, TS2310 on
 * `ServiceCreateContext`). The `peek()` self-read additionally exercises that the
 * fix keeps SELF reachable.
 *
 * AFTER the fix: `ServiceCreateContext.services` reads the by-name
 * `Questpie.Services` interface, which extends the FLAT per-key
 * `_AppServicesSeam` (each instance resolved off the already-computed `keyof
 * _AppDefaultServices` key set, NOT the whole fold). Cross/self reads resolve
 * independently → the cycle is broken and the instances stay precise.
 *
 * (A pure deferred-method cross/self read — see services/reporting.ts — does NOT
 * trip the cycle; TS defers method-return inference. The EAGER property is the
 * minimal reproducer of the create-time fold dependency.)
 *
 * Runtime is already lazy (access-time proxy) — this is a PURE-TYPE trigger.
 */
import { service } from "#questpie/server/services/define-service.js";

export const analyticsService = service({
	create: (ctx) => ({
		/**
		 * CROSS reference as an EAGER PROPERTY — reads ctx.services.<other> while
		 * the instance shape is being formed (forces the fold; the trigger).
		 */
		crossRef: ctx.services.reporting,
		/** SELF reference as a deferred method — reads ctx.services.<thisService>. */
		peek() {
			return ctx.services.analytics;
		},
		/** A plain instance member so the inferred shape is non-trivial. */
		label: "analytics" as const,
	}),
});

export default analyticsService;
