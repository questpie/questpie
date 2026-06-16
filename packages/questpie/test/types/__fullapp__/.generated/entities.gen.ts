/* oxlint-disable */
// FIXTURE L1 entities.gen.ts — flat category maps + AppServices. Mirrors the
// machine-emitted split: imports the `_modules` value + service/registry
// type-utils, NEVER AppContext/_AppQuestpie. The `_ModuleServices = {}` carrier
// stays FLAT (gen-time-enumerated `reporting` below — never a fold over
// `typeof _modules`, which would cycle via ServiceCreateContext → AppContext).
// Side-effect import of names.gen.ts loads the ambient module-name registry.
import "./names.gen.js";

// ── Runtime ────────────────────────────────────────────────
import _runtime from "../questpie.config.js";

// ── Modules ────────────────────────────────────────────────
import _modules from "../modules.js";

// ── Collections ────────────────────────────────────────────
import { articles as _coll_articles } from "../collections/articles.js";
import { categories as _coll_categories } from "../collections/categories.js";

// ── Globals ────────────────────────────────────────────────
import { siteSettings as _glob_siteSettings } from "../globals/site-settings.js";

// ── Services (gen-time-resolved FLAT — never a fold over typeof _modules) ──
import { reportingService as _svc_reporting } from "../services/reporting.js";

import type {
	ExtractModuleProp,
	ExtractModulePropArr,
	ExtractModulePropArrOverride,
	ServiceCustomNamespaceInstances,
	ServiceInstancesInNamespace,
	ServiceTopLevelInstances,
} from "#questpie/server/config/codegen-type-utils.js";
import type { ServiceInstanceOf } from "#questpie/server/services/define-service.js";

// ════════════════════════════════════════════════════════════
// TYPES — composed from typeof references (zero inference cost)
// ════════════════════════════════════════════════════════════

export type _ModuleCollections = ExtractModulePropArrOverride<typeof _modules, "collections">;
export type _ModuleGlobals = ExtractModulePropArr<typeof _modules, "globals">;
export type _ModuleJobs = ExtractModulePropArr<typeof _modules, "jobs">;
export type _ModuleServices = {};
// Registry category extraction from modules
export type _Registry_Collections = ExtractModulePropArrOverride<typeof _modules, "collections">;
export type _Registry_Globals = ExtractModulePropArr<typeof _modules, "globals">;
export type _Registry_Jobs = ExtractModulePropArr<typeof _modules, "jobs">;
export type _Registry_Services = {};
export type _Registry_Emails = ExtractModulePropArr<typeof _modules, "emails">;
export type _Registry_FieldTypes = ExtractModulePropArr<typeof _modules, "fieldTypes">;
export type _Registry_Views = ExtractModulePropArr<typeof _modules, "views">;
export type _Registry_Components = ExtractModulePropArr<typeof _modules, "components">;
export type _Registry_Blocks = ExtractModulePropArr<typeof _modules, "blocks">;

// Recursive module property extraction (for fields contributed at each level)
export type _AllModuleFields = ExtractModuleProp<{ modules: typeof _modules }, "fields">;

/** All collections in the app (modules + user, user overrides) */
export type AppCollections = _ModuleCollections & {
	articles: typeof _coll_articles;
	categories: typeof _coll_categories;
};

/** All globals in the app (modules + user, user overrides) */
export type AppGlobals = _ModuleGlobals & {
	siteSettings: typeof _glob_siteSettings;
};

/** All jobs in the app (modules + user, user overrides) */
export type AppJobs = _ModuleJobs;

/**
 * All service definitions in the app. `_ModuleServices` is the gen-time FLAT
 * literal `{}` (the contributing module's services are enumerated DIRECTLY by
 * name below — never folded over `typeof _modules`, which would cycle via
 * ServiceCreateContext → AppContext, §2.2).
 */
type _AppServiceDefinitions = _ModuleServices & {
	reporting: typeof _svc_reporting;
};

/** All services in the app as resolved service instances. */
export type AppServices = {
	[K in keyof _AppServiceDefinitions]: ServiceInstanceOf<_AppServiceDefinitions[K]>;
};
export type _AppDefaultServices = ServiceInstancesInNamespace<_AppServiceDefinitions, "services">;
export type _AppTopLevelServices = ServiceTopLevelInstances<_AppServiceDefinitions>;
export type _AppCustomServiceNamespaces = ServiceCustomNamespaceInstances<_AppServiceDefinitions>;

/** All email templates in the app — use with email.sendTemplate() */
export type AppEmailTemplates = {};
