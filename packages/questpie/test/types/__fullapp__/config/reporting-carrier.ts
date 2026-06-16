/**
 * Full-app gate fixture — a `config`-carrier that references `AppContext`,
 * exactly like the admin module's real carrier (`WidgetFetchContext = AppContext`
 * at packages/admin/src/server/augmentation/dashboard.ts:22). This is the §1
 * cycle source: `AppContext → _AppContextExtensions → _MP<"config"> →
 * module.config → AppContext`.
 *
 * The Step-1 flat-explicit emission derives `_AppContextExtensions` from
 * `typeof _appConfig` (NOT a `config` fold over `typeof _modules`), so this
 * carrier never gets materialized and the gate stays acyclic. Re-introducing the
 * `_MP`/`UnionToIntersection` fuse for the extensions aggregate (the acceptance
 * probe) DOES materialize it → the cycle returns → the gate goes RED.
 */
import type { AppContext } from "#questpie/server/config/app-context.js";

/** Mirrors admin's `WidgetFetchContext = AppContext & {…}` carrier shape. */
export type ReportingWidgetContext = AppContext & {
	widgetId: string;
};

export type ReportingCarrierConfig = {
	loadWidget: (ctx: ReportingWidgetContext) => Promise<unknown>;
};

export const reportingCarrier: ReportingCarrierConfig = {
	loadWidget: async () => ({}),
};

export default reportingCarrier;
