/* oxlint-disable */
// FIXTURE L3 index.ts — runtime tail + public re-exports. Mirrors the
// machine-emitted multi-file split (Step 6): the ONLY file that runs createApp;
// imports `_AppQuestpie`/`AppSession`/`AppSessionUser` DOWN from context.gen.ts
// (L2) and the App* category types from entities.gen.ts (L1), and re-exports the
// public surface so the package root keeps resolving. The AppContext⇄config
// composition lives in context.gen.ts; the canary/fuse-probe is carried there.
//
// This is NOT machine-emitted: inside the `questpie` package the generated
// `questpie/...` import specifiers do not resolve (no self-symlink, no `questpie`
// paths alias), so this fixture is the design-blessed hand-written representative
// of the 4-file split. It composes a REAL `AppContext` over real carriers
// (appConfig context resolver + authConfig additionalFields/plugin + the pulled
// starterModule), so the DEFAULT package gate SEES the AppContext⇄config
// composition the module-only gate is blind to.

import { createApp } from "#questpie/server/config/create-app.js";
import { createContextFactory } from "#questpie/server/config/create-context-factory.js";
import type { AppDefinition } from "#questpie/server/config/module-types.js";
import type { CollectionSelect, GlobalSelect } from "#questpie/shared/type-utils.js";
import type { AccessContext, HookContext } from "#questpie/server/collection/builder/types.js";
import type { Where } from "#questpie/server/collection/crud/index.js";

// Side-effect import of names.gen.ts (L0) — it lives in the `.generated`
// dot-folder and is imported by nothing else, so without this its ambient
// `declare global` (module entity-name registry) never joins the program.
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

// ── Core Singles ───────────────────────────────────────────
import _appConfig from "../config/app.js";
import _authConfig from "../config/auth.js";

import type { AppCollections, AppGlobals } from "./entities.gen.js";
import type { _AppQuestpie, AppSession, AppSessionUser } from "./context.gen.js";

// Re-export the public type surface from the lower layers so the package root
// keeps resolving the App* category types (entities.gen) + session types
// (context.gen). Type-only star re-exports — no runtime require between layers.
export type * from "./entities.gen.js";
export type * from "./context.gen.js";

/**
 * Select/document type for a collection key — prefer over `Record<string, any>` for docs.
 */
export type CollectionDoc<K extends keyof AppCollections> = CollectionSelect<AppCollections[K]>;

/**
 * Typed `where` filter for a collection key — prefer over `Record<string, unknown>`
 * when building a `where` clause dynamically before a `find`/`findOne` call.
 */
export type CollectionWhere<K extends keyof AppCollections> = Where<AppCollections[K], AppConfig>;

/**
 * Select/document type for a global key.
 */
export type GlobalDoc<K extends keyof AppGlobals> = GlobalSelect<AppGlobals[K]>;

/** Access-rule ctx for shared helpers. `K` narrows `data` to that collection's row. */
export type AccessRuleContext<K extends keyof AppCollections | unknown = unknown> =
	AccessContext<K extends keyof AppCollections ? CollectionDoc<K> : unknown>;

/** Hook ctx for shared helpers. `K` narrows `data` to that collection's row. */
export type HookRuleContext<K extends keyof AppCollections | unknown = unknown> =
	HookContext<K extends keyof AppCollections ? CollectionDoc<K> : unknown>;

/**
 * Flat config type for client APIs.
 */
export type AppConfig = {
	collections: AppCollections;
	globals: AppGlobals;
	storage: (typeof _runtime)["storage"];
	auth: typeof _authConfig;
};

// ════════════════════════════════════════════════════════════
// RUNTIME — create the app instance
// ════════════════════════════════════════════════════════════

var _appPromise: Promise<unknown> | undefined;

_appPromise = createApp(
	({
		modules: _modules,
		collections: {
			articles: _coll_articles,
			categories: _coll_categories,
		},
		globals: {
			siteSettings: _glob_siteSettings,
		},
		services: {
			reporting: _svc_reporting,
		},
		config: {
			app: _appConfig,
			auth: _authConfig,
		},
	}) satisfies AppDefinition,
	_runtime,
);

export const app = (await _appPromise) as unknown as _AppQuestpie;

/** Fully typed QUESTPIE app instance. */
export type App = typeof app;

// ── createContext — typed context for scripts ──────────────
export async function createContext(
	options?: Parameters<ReturnType<typeof createContextFactory>>[0],
) {
	while (!_appPromise) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}

	return createContextFactory((await _appPromise) as _AppQuestpie)(options);
}
