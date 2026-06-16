/**
 * Full-app gate fixture — pulled modules.
 *
 * Pulls the real `starterModule` so the carriers are REAL: it ships the
 * `user`/`session`/`account` collections (real `Questpie.CollectionKeys` module
 * names — Invariant-3) and a `config.auth` carrier. Keeping a real module in the
 * graph is what makes `ExtractModulePropArr` / `_MPConfigSub` exercise the
 * acyclic folds against actual module category members.
 *
 * Also pulls a small fixture-local `reportingModule` that ships a `services`
 * member whose VALUE references the app `ctx` (§2.2 asymmetry). It is declared as
 * a plain typed object (the shape codegen actually emits — `services:
 * ReportingServices`), NOT via `module()` (whose `ServiceBuilder<any>` bound
 * erases the lifecycle/instance and the AppContext reach the probe needs). The
 * flat-explicit emission keeps services OFF a `typeof _modules` fold
 * (`_ModuleServices = {}`), so this stays acyclic — but it makes the acceptance
 * probe (a services-fold) genuinely cyclic, proving the gate catches the cycle.
 */
import type { ServiceBuilder } from "#questpie/server/services/define-service.js";
import starterModule from "#questpie/server/modules/starter/.generated/module.js";

import { reportingCarrier } from "./config/reporting-carrier.js";
import { reportingService } from "./services/reporting.js";

/** Named services type for the fixture module (mirrors `${Prefix}Services`). */
type ReportingServices = {
	reporting: typeof reportingService;
};

type ReportingModule = {
	name: "fixture-reporting";
	services: ReportingServices;
	/**
	 * A `config` carrier whose VALUE type references `AppContext` (mirrors the
	 * admin module's `config.admin.dashboard` → `WidgetFetchContext = AppContext`
	 * carrier). Materialized only by a `_MP<"config">` fold (the acceptance probe),
	 * never by the Step-1 user-derived extensions emission.
	 */
	config: { reporting: typeof reportingCarrier };
};

export const reportingModule: ReportingModule = {
	name: "fixture-reporting",
	services: { reporting: reportingService } satisfies Record<
		string,
		ServiceBuilder<any, any, any>
	>,
	config: { reporting: reportingCarrier },
};

export default [starterModule, reportingModule] as const;
