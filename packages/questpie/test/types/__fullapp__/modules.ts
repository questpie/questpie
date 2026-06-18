import starterModule from "#questpie/server/modules/starter/.generated/module.js";
/**
 * Full-app gate fixture — pulled modules.
 *
 * Pulls the real `starterModule` so the carriers are REAL: it ships the
 * `user`/`session`/`account` collections (real `Questpie.CollectionKeys` module
 * names — Invariant-3) and a `config.auth` carrier. Keeping a real module in the
 * graph is what makes `ExtractModulePropArr` / `_MPConfigSub` exercise the
 * acyclic folds against actual module category members.
 *
 * The top-level `adminModule` mirrors the REAL admin module's shape — it BOTH
 * nests `starterModule` (`modules: [starterModule]`) AND re-declares the `user`
 * collection via `collection("user").merge(starterModule.collections.user)`. That
 * same-key, cross-module-nesting re-declaration is the EXACT shape that detonated
 * the additive `ExtractModulePropArr` collections fold into `never` (the create()
 * never/{} bug): `_ModuleCollections["user"] = Collection<Starter> & Collection<Admin>`
 * ⇒ `never` ⇒ `CollectionInsert` `never` / CRUD select `{}`. The fold now uses
 * `ExtractModulePropArrOverride` (override, not intersect) so the most-derived
 * admin re-declaration shadows the nested starter one. The remaining starter
 * collections are passed through by reference (mirrors admin re-declaring the full
 * starter set directly) so the names-only `Questpie.CollectionKeys` registry — which
 * reads top-level `keyof module.collections` — keeps every module collection name.
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

import { adminUser } from "./collections/admin-user.js";
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

/**
 * Admin-style module: nests starter AND re-declares `user` (merge), passing the
 * remaining starter collections through by reference. Mirrors the real admin
 * module that triggered the create() never/{} bug.
 */
type AdminCollections = {
	user: typeof adminUser;
	account: typeof starterModule.collections.account;
	apikey: typeof starterModule.collections.apikey;
	assets: typeof starterModule.collections.assets;
	session: typeof starterModule.collections.session;
	verification: typeof starterModule.collections.verification;
};

type AdminModule = {
	name: "fixture-admin";
	modules: readonly [typeof starterModule];
	collections: AdminCollections;
};

export const adminModule: AdminModule = {
	name: "fixture-admin",
	modules: [starterModule] as const,
	collections: {
		user: adminUser,
		account: starterModule.collections.account,
		apikey: starterModule.collections.apikey,
		assets: starterModule.collections.assets,
		session: starterModule.collections.session,
		verification: starterModule.collections.verification,
	},
};

export default [adminModule, reportingModule] as const;
