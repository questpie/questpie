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
 * member whose VALUE references the app `ctx` (§2.2 asymmetry). The flat-explicit
 * emission keeps services OFF a `typeof _modules` fold (`_ModuleServices = {}`),
 * so this stays acyclic — but it makes the acceptance probe (a services-fold)
 * genuinely cyclic, proving the gate now catches the regression.
 */
import { module } from "#questpie/server/config/create-app.js";
import starterModule from "#questpie/server/modules/starter/.generated/module.js";

import { reportingService } from "./services/reporting.js";

export const reportingModule = module({
	name: "fixture-reporting",
	services: { reporting: reportingService },
});

export default [starterModule, reportingModule] as const;
