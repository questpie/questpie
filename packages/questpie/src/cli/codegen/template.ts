/**
 * Template Generation
 *
 * Generates the `.generated/index.ts` file content from discovered files.
 * The generated file:
 * 1. Imports the runtime config, modules, and all discovered entities
 * 2. Emits type interfaces using typeof references (zero inference cost)
 * 3. Calls createApp(definition, runtime) to create the app instance
 * 4. Exports the app instance and composed types
 *
 * All category-specific behavior (imports, types, runtime emission) is driven
 * by CategoryDeclaration metadata from plugins. Categories without explicit
 * metadata get sensible defaults matching the standard record pattern.
 *
 * @see RFC-MODULE-ARCHITECTURE §9.1 (Root App — .generated/index.ts)
 */

import {
	categoryRecordEntry,
	categoryTypeEntry,
	importStatement,
	safeKey,
	sortedValues,
} from "./category-emit.js";
import type {
	CategoryDeclaration,
	DiscoveredFile,
	DiscoverPattern,
	DiscoveryResult,
	SingletonFactory,
} from "./types.js";

// ============================================================================
// Template generation
// ============================================================================

export interface TemplateOptions {
	/** Path to questpie.config.ts relative to .generated directory. */
	configImportPath: string;
	/** Discovery result with all found files. */
	discovered: DiscoveryResult;
	/** Merged category declarations from the resolved target. */
	categories?: Record<string, CategoryDeclaration>;
	/** Merged singleton factories from the resolved target (for re-export names). */
	singletonFactories?: Record<string, SingletonFactory>;
	/** Additional imports from plugins. */
	extraImports?: Array<{ name: string; path: string }>;
	/** Additional type declarations from plugins. */
	extraTypeDeclarations?: string[];
	/** Additional runtime code from plugins. */
	extraRuntimeCode?: string[];
	/** Additional entity keys to pass to createApp (from plugins). */
	extraEntities?: Map<string, string>;
	/** Discover patterns from the resolved target (for ~-prefixed registryKey handling). */
	discoverPatterns?: Record<string, DiscoverPattern>;
}

/**
 * Result of generating the root-app template — the `index.ts` content (`code`)
 * plus the layer files (`names.gen.ts`/`entities.gen.ts`/`context.gen.ts`) that
 * `index.ts` re-exports. Each extra file is written next to `index.ts` in outDir.
 *
 * The split enforces a STRICT one-way import header L3→L2→L1→L0 so the
 * AppContext⇄config cycle is impossible by construction (L1 never imports L2,
 * where `_AppQuestpie`/`_AppContextExtensions` live).
 */
export interface TemplateResult {
	/** The `index.ts` content (runtime tail + public re-exports). */
	code: string;
	/** Layer files written next to index.ts (bare filename + content). */
	extraFiles: Array<{ name: string; code: string }>;
}

// Layer file names — emitted next to index.ts in outDir.
const L0_FILE = "names.gen.ts";
const L1_FILE = "entities.gen.ts";
const L2_FILE = "context.gen.ts";

/**
 * Generate the .generated/index.ts file content + layer files.
 *
 * @see RFC-MODULE-ARCHITECTURE §9.1 (Root App — .generated/index.ts)
 */
export function generateTemplate(options: TemplateOptions): TemplateResult {
	// FOUR layer buffers — every push is routed to the buffer matching the layer
	// (see layerMap in the Step-6 plan). `lines` is re-pointed at the active
	// buffer as emission moves between layers; l3 becomes `index.ts`.
	const l0: string[] = []; // names.gen.ts — module entity-NAME key registries
	const l1: string[] = []; // entities.gen.ts — flat category maps + AppServices
	const l2: string[] = []; // context.gen.ts — the ONLY AppContext builder
	const l3: string[] = []; // index.ts — runtime tail + public re-exports
	let lines: string[] = l3;
	const {
		configImportPath,
		discovered,
		categories,
		singletonFactories,
		extraImports,
		extraTypeDeclarations,
		extraRuntimeCode,
		extraEntities,
		discoverPatterns,
	} = options;

	// Build category declarations map from the resolved target
	const allDecls = collectCategoryDeclarations(categories);
	const declaredCatNames = new Set(allDecls.keys());

	// modules.ts is required — new architecture only
	const modulesFile = discovered.singles.get("modules") ?? null;
	if (!modulesFile) {
		throw new Error(
			"[questpie] modules.ts is required. Create a modules.ts file in your questpie server directory.\n" +
				"See: https://questpie.com/docs/modules",
		);
	}

	const envFile = discovered.singles.get("env") ?? null;
	const coreSingles = getCategorizedSingles(discovered.singles, allDecls);

	// Workflows plugin present → the generated contexts expose a typed
	// `workflows` client keyed by AppWorkflows (name + schema preserved).
	// AppWorkflows (the keyed map) is emitted in L1; the WorkflowClient<…> wrapper
	// is consumed only by the L2 AppContext/JobHandler/Workflow contexts. Declared
	// up-front because the L1→L2 cross-import set below gates on it.
	const hasWorkflows = allDecls.has("workflows");

	// ── Shared VALUE import preamble ──────────────────────────────────────
	// Every `typeof X` reference requires `X` imported as a VALUE in that file.
	// L1/L2/L3 all consume `typeof` references over modules + categories + config
	// singles, so each gets the SAME value preamble (one code path → no drift).
	// Unused value imports are harmless (the .gen.ts files are type-only checked,
	// noUnusedLocals is off). `createApp` + plugin value imports are emitted
	// separately into the layer that actually runs/consumes them.
	const pushValueImports = (buf: string[]): void => {
		// Import env FIRST — env.ts validates at module evaluation, so importing
		// it before the runtime config guarantees env validation fails boot before
		// runtimeConfig() resolution, adapters, auth, and db init.
		if (envFile) {
			buf.push("// ── Env (validated before everything else) ─────────────────");
			buf.push(importStatement(envFile));
			buf.push("");
		}

		buf.push("// ── Runtime ────────────────────────────────────────────────");
		buf.push(`import _runtime from "${configImportPath}";`);
		buf.push("");

		buf.push("// ── Modules ────────────────────────────────────────────────");
		buf.push(importStatement(modulesFile));
		buf.push("");

		// Declared categories (plugin.categories), in plugin declaration order.
		for (const [catName, fileMap] of discovered.categories) {
			if (!declaredCatNames.has(catName)) continue;
			if (fileMap.size === 0) continue;
			buf.push(sectionComment(capitalize(catName)));
			for (const file of sortedValues(fileMap)) {
				buf.push(importStatement(file));
			}
			buf.push("");
		}

		if (coreSingles.core.length > 0) {
			buf.push("// ── Core Singles ───────────────────────────────────────────");
			for (const file of coreSingles.core) {
				buf.push(importStatement(file));
			}
			buf.push("");
		}

		if (coreSingles.plugin.length > 0) {
			buf.push("// ── Plugin Singles ─────────────────────────────────────────");
			for (const file of coreSingles.plugin) {
				buf.push(importStatement(file));
			}
			buf.push("");
		}

		for (const [stateKey, files] of discovered.spreads) {
			if (files.length > 0) {
				buf.push(
					`// ── ${capitalize(stateKey)} (spread) ─────────────────────────────────────────`,
				);
				for (const file of files) {
					buf.push(importStatement(file));
				}
				buf.push("");
			}
		}

		// Undeclared categories (plugin.discover directory patterns, e.g. blocks).
		for (const [catName, fileMap] of discovered.categories) {
			if (declaredCatNames.has(catName)) continue;
			if (fileMap.size === 0) continue;
			buf.push(sectionComment(capitalize(catName)));
			for (const file of sortedValues(fileMap)) {
				buf.push(importStatement(file));
			}
			buf.push("");
		}
	};

	const genHeader = (buf: string[]): void => {
		buf.push("/* oxlint-disable */");
		buf.push("// AUTO-GENERATED by questpie codegen — DO NOT EDIT");
		buf.push("// Regenerate with: questpie generate");
		buf.push("");
	};

	// ── L0 names.gen.ts — leaf, imports ONLY `typeof _modules` ────────────
	genHeader(l0);
	l0.push("// ── Modules ────────────────────────────────────────────────");
	l0.push(importStatement(modulesFile));
	l0.push("");

	// Flags that gate which cross-layer named types L1 actually emits → so L2/L3
	// import EXACTLY what exists (a stale name = TS2305 under bundler resolution).
	const hasMessagesCat =
		(discovered.categories.get("messages")?.size ?? 0) > 0;
	const hasEmailsCat = (discovered.categories.get("emails")?.size ?? 0) > 0;
	const hasServicesCat = discovered.categories.has("services");
	// `_ModuleCollections` feeds L2's `_JobHandlerCollections` literal (the module
	// half of the job-handler collections map).
	const l1ToL2 = ["AppCollections", "AppGlobals", "AppJobs", "_ModuleCollections"];
	if (hasServicesCat) {
		l1ToL2.push(
			"_AppDefaultServices",
			"_AppTopLevelServices",
			"_AppCustomServiceNamespaces",
		);
	}
	if (hasEmailsCat) l1ToL2.push("AppEmailTemplates");
	if (hasMessagesCat) l1ToL2.push("AppMessageKeys");
	if (hasWorkflows) l1ToL2.push("AppWorkflows");
	// The central `Registry` interface (L2 composition declare global) reads the
	// `_Registry_*` / `_AllModule*` aliases that entities.gen.ts (L1) exports.
	for (const [catName, decl] of allDecls) {
		if (!decl.registryKey) continue;
		l1ToL2.push(`_Registry_${capitalize(catName)}`);
	}
	for (const { singleName } of collectTildeRegistryKeys(
		discoverPatterns,
		discovered.singles,
	)) {
		l1ToL2.push(`_AllModule${capitalize(singleName)}`);
	}
	const jsImport = (file: string) => `./${file.replace(/\.ts$/, ".js")}`;

	// ── L1 entities.gen.ts — value preamble + category extra type imports ──
	genHeader(l1);
	// Side-effect import of names.gen.ts (L0) — loads the ambient module-name key
	// registry alongside the type layer. Downward edge L1→L0 (allowed); names.gen
	// is dot-folder-globbed-out so it only joins the program via this import.
	l1.push(`import "${jsImport(L0_FILE)}";`);
	pushValueImports(l1);
	l1.push(
		'import type { RouteParamsFromKey, RouteWithParams } from "questpie/types";',
	);
	// Category-declared extra type imports (e.g. ServiceInstanceOf, WorkflowClient)
	// feed the App* / AppServices interfaces — all of which live in L1.
	for (const [catName, fileMap] of discovered.categories) {
		if (fileMap.size === 0) continue;
		const decl = allDecls.get(catName);
		if (decl?.extraTypeImports) {
			for (const imp of decl.extraTypeImports) {
				l1.push(imp);
			}
		}
	}
	l1.push("");

	// ── L2 context.gen.ts — value preamble + entities.gen names + type-utils ──
	genHeader(l2);
	pushValueImports(l2);
	l2.push(
		`import type { ${l1ToL2.join(", ")} } from "${jsImport(L1_FILE)}";`,
	);
	l2.push(
		'import type { AnyCollectionOrBuilder, AnyGlobalOrBuilder, CollectionAPI, DrizzleClientFromQuestpieConfig, InferContextExtensionsFromAppConfig, InferSessionFromAuthConfig, MailerService, Questpie, QuestpieConfig, QueueClient, QueueJobType, ServiceInstancesInNamespace, TablesFromConfig, z } from "questpie/types";',
	);
	if (extraImports && extraImports.length > 0) {
		l2.push("// ── Plugin Imports ─────────────────────────────────────────");
		for (const imp of extraImports) {
			l2.push(`import ${imp.name} from "${imp.path}";`);
		}
	}
	l2.push("");

	// ── L3 index.ts — createApp + value preamble + lower-layer named types ──
	genHeader(l3);
	l3.push('import { createApp, createContextFactory } from "questpie/app";');
	// Side-effect import of names.gen.ts — it lives in the `.generated` dot-folder
	// (NOT matched by `src/**/*.ts` globs) and is imported by nothing else, so
	// without this its ambient `declare global` (the MODULE entity-name half of
	// CollectionKeys/GlobalKeys/JobKeys) never joins the program and cross-module
	// `relation("user")` strict keys regress. A side-effect import is never elided.
	l3.push(`import "${jsImport(L0_FILE)}";`);
	l3.push(
		'import type { AccessContext, AppDefinition, CollectionSelect, GlobalSelect, HookContext } from "questpie/types";',
	);
	// CollectionDoc/GlobalDoc/AppConfig/createContext read these from L1; the
	// runtime `as _AppQuestpie` cast + AppSession re-exports read from L2.
	const l3FromL1 = ["AppCollections", "AppGlobals", "AppRoutes"];
	l3.push(`import type { ${l3FromL1.join(", ")} } from "${jsImport(L1_FILE)}";`);
	l3.push(
		`import type { _AppQuestpie, AppSession, AppSessionUser } from "${jsImport(L2_FILE)}";`,
	);
	l3.push("");
	pushValueImports(l3);

	// Extra plugin imports (consumed by extraEntities / extraRuntimeCode runtime).
	if (extraImports && extraImports.length > 0) {
		l3.push("// ── Plugin Imports ─────────────────────────────────────────");
		for (const imp of extraImports) {
			l3.push(`import ${imp.name} from "${imp.path}";`);
		}
		l3.push("");
	}

	// ════════════════════════════════════════════════════════════
	// TYPES — composed from typeof references (zero inference cost)
	// ════════════════════════════════════════════════════════════
	// Type bodies are routed into the L0/L1/L2 buffers below; `lines` is
	// re-pointed per layer (most type bodies land in L1/L2).

	lines = l1;
	lines.push("// ════════════════════════════════════════════════════════════");
	lines.push(
		"// TYPES — composed from typeof references (zero inference cost)",
	);
	lines.push("// ════════════════════════════════════════════════════════════");
	lines.push("");

	// L1 type-utils — feed `_Module*` / `_Registry_*` / `_AllModule*` / AppServices.
	lines.push(
		'import type { ExtractModulePropArr, ExtractModulePropArrOverride, ServiceCustomNamespaceInstances, ServiceInstanceOf, ServiceInstancesInNamespace, ServiceTopLevelInstances } from "questpie/types";',
	);
	// The WorkflowClient<…> wrapper is consumed only by the L2 AppContext/
	// JobHandler/Workflow contexts (`hasWorkflows` declared up-front above).
	if (hasWorkflows) {
		l2.push(
			'import type { WorkflowClient } from "@questpie/workflows/server";',
		);
	}
	lines.push(
		'type _RouteDefinitionWithoutHandler<T> = T extends { mode: "raw" } ? Omit<T, "handler"> & { handler: (args: unknown) => Response | Promise<Response> } : Omit<T, "handler"> & { handler: (args: unknown) => unknown | Promise<unknown> };',
	);
	// Module category extraction is done via `ExtractModulePropArr` — a recursive,
	// member-only fold over the module tuple (recurses sub-modules, projects only
	// the requested member). It replaces the old `_MP`/`UnionToIntersection` fuse:
	// `UnionToIntersection` forced eager whole-union materialization, which dragged
	// the cyclic config/services carrier members through AppContext (TS2456). The
	// recursive fold walks modules one at a time and never materializes a sibling
	// carrier member, so the SAFE categories (collections/globals/jobs/routes/
	// views/components/blocks) stay acyclic. The CARRIERS (config-extensions, auth,
	// services) are derived separately below — never via this fold.
	const appConfigFile = discovered.singles.get("appConfig");
	const authConfigFile = discovered.singles.get("authConfig");
	const authFile = authConfigFile ?? discovered.singles.get("auth");

	// ── L2 carriers begin — `_MPConfigSub` / extensions / auth / session ──
	// These reach AppContext composition and so live in context.gen.ts (L2),
	// never in entities.gen.ts (L1). L1 must not import L2 → the cycle is
	// impossible by construction.
	lines = l2;
	// `_MPConfigSub` — a POSITIONAL fold over the module tuple that extracts a
	// SINGLE `config[K]` member per declaration via a structural key check. It
	// never instantiates a sibling config member (e.g. `config.admin`), so it is
	// acyclic for `K = "auth"` (BetterAuth options never reach AppContext). It is
	// the single mechanism used for the `config.auth` carrier below AND for the
	// session-dedicated auth config.
	lines.push(
		"type _MPConfigSub<A extends readonly any[], K extends string> = A extends readonly [infer H, ...infer T extends readonly any[]] ? (H extends { config: infer C } ? (C extends Record<K, infer V> ? V : {}) : {}) & _MPConfigSub<T, K> : {};",
	);

	// ── config.app extensions — USER-DERIVED, acyclic ────────────────────
	// `_AppContextExtensions` is the FORMER head of the AppContext⇄config cycle:
	// it fed `_AppQuestpieConfig["~contextExtensions"]` and, via the old
	// `_ModuleConfig extends { app }` arm, routed through `_MP<"config"> →
	// UnionToIntersection`, which materialised the admin module's cyclic
	// `config.admin` (`appConfig` with AppContext-typed resolvers → TS2456). We
	// derive the extensions from `typeof <appConfig>` ALONE (a user file):
	// `InferContextExtensionsFromAppConfig` reads the resolver RETURN shape, never
	// `typeof app`, so the cyclic config carrier is never instantiated. The
	// `~contextExtensions` config edge is KEPT (precise — Invariant 1), its SOURCE
	// is now acyclic.
	if (appConfigFile) {
		lines.push(`type _AppAppConfig = typeof ${appConfigFile.varName};`);
	} else {
		lines.push("type _AppAppConfig = {};");
	}
	lines.push(
		"type _AppContextExtensions = Partial<InferContextExtensionsFromAppConfig<_AppAppConfig>>;",
	);

	// ── config.auth — POSITIONAL fold, acyclic ───────────────────────────
	// `_AppAuthConfig` feeds `_AppQuestpieConfig.auth`. Extracting `config.auth`
	// via `_MPConfigSub` (above) materialises ONLY `config["auth"]` (BetterAuth
	// opts, no AppContext) — never the sibling `config.admin`. The old whole-
	// config `_ModuleConfig extends { auth }` arm cycled through `_MP<"config">`;
	// the positional fold does not.
	if (authFile) {
		lines.push(
			`type _AppAuthConfig = _MPConfigSub<typeof ${modulesFile.varName}, "auth"> & typeof ${authFile.varName};`,
		);
	} else {
		lines.push(
			`type _AppAuthConfig = _MPConfigSub<typeof ${modulesFile.varName}, "auth">;`,
		);
	}
	// Session is derived from the SAME acyclic auth config. additionalFields +
	// plugin user/session fields survive the `&` intersection (Invariant 2).
	lines.push("type _AppSessionAuthConfig = _AppAuthConfig;");
	lines.push(
		"type _AppSession = NonNullable<InferSessionFromAuthConfig<_AppSessionAuthConfig>> | null;",
	);
	lines.push("");

	// ── L1 flat category maps resume — `_Module*` / `_Registry_*` ──────────
	lines = l1;
	// ── _Module* type extraction for categories ──────────────────
	// SAFE categories use the recursive member-only `ExtractModulePropArr` fold
	// (acyclic — the members carry no AppContext back-reference). The `services`
	// category is the ONE carrier whose member VALUES reach AppContext (a service's
	// `create(ctx: ServiceCreateContext)` → AppContext); ANY fold over the module
	// `services` member re-introduces the cycle (verified). It is emitted FLAT from
	// gen-time knowledge instead — `{}` when no module ships services (the case for
	// all current modules: admin/audit/starter emit `Record<never,never>`; core's
	// CoreServices are framework infrastructure surfaced via _AppInfraContext, not
	// the user module array). `moduleCategoryType()` centralises this rule.
	//
	// The `collections` category uses the OVERRIDE fold instead of the additive `&`
	// one: a module may both NEST a sub-module shipping `collections.user` AND
	// re-declare `collections.user` via `collection("user").merge(sub.collections.user)`
	// (the admin module re-declaring starter's user). Intersecting the two full
	// `Collection<A> & Collection<B>` instantiations collapses the value to `never`
	// (nullable-table member drift detonates the object), poisoning
	// `CollectionInsert`/`CollectionSelect` → `never`/`{}`. `ExtractModulePropArrOverride`
	// makes the most-derived (outer) re-declaration shadow the nested base instead.
	const moduleCategoryType = (catName: string): string =>
		catName === "services"
			? "{}"
			: catName === "collections"
				? `ExtractModulePropArrOverride<typeof ${modulesFile.varName}, "${catName}">`
				: `ExtractModulePropArr<typeof ${modulesFile.varName}, "${catName}">`;
	// Exported — `_ModuleCollections` feeds the L2 `_JobHandlerCollections`
	// literal (imported DOWN from entities.gen.ts). The rest are exported
	// uniformly (harmless) so any future L2 reference resolves.
	for (const [catName, fileMap] of discovered.categories) {
		const decl = allDecls.get(catName);
		const shouldExtract = decl ? decl.extractFromModules !== false : true;
		if (!shouldExtract) continue;

		const moduleTypeName = deriveModuleTypeName(catName);
		lines.push(`export type ${moduleTypeName} = ${moduleCategoryType(catName)};`);
	}
	// Also extract spread keys (sidebar, dashboard, etc.) from modules
	for (const [stateKey] of discovered.spreads) {
		const moduleTypeName = deriveModuleTypeName(stateKey);
		lines.push(`export type ${moduleTypeName} = ${moduleCategoryType(stateKey)};`);
	}

	// ── Registry categories — extracted from modules (recursive fold) ──────────
	// ALL categories with registryKey are extracted and merged here centrally.
	// Modules MUST NOT augment Registry — multiple modules declaring the same
	// key causes TS2717. The root template is the single source of truth. Uses the
	// same `moduleCategoryType()` rule (flat `{}` for the services carrier).
	{
		const registryCatNames: Array<{ catName: string; regKey: string }> = [];
		for (const [catName, decl] of allDecls) {
			if (!decl.registryKey) continue;
			const regKey =
				typeof decl.registryKey === "string" ? decl.registryKey : catName;
			registryCatNames.push({ catName, regKey });
		}

		if (registryCatNames.length > 0) {
			lines.push("// Registry category extraction from modules");
			for (const { catName } of registryCatNames) {
				const typeName = `_Registry_${capitalize(catName)}`;
				// Exported — the central `Registry` interface (composition declare
				// global) lives in L2 and imports these down from L1.
				lines.push(`export type ${typeName} = ${moduleCategoryType(catName)};`);
			}
			lines.push("");
		}
	}

	// ── ~-prefixed registryKey extraction from modules ───────────────
	// Recursively extracts properties from modules + sub-modules.
	// Unlike _MP<> (top-level only), this recurses into sub-modules because
	// each module contributes its own field types (not merged into parent).
	{
		const tildeKeys = collectTildeRegistryKeys(
			discoverPatterns,
			discovered.singles,
		);
		if (tildeKeys.length > 0) {
			lines.push(
				"// Recursive module property extraction (for fields contributed at each level)",
			);
			lines.push('import type { ExtractModuleProp } from "questpie/types";');
			lines.push("");

			for (const { singleName, registryKey } of tildeKeys) {
				const userFile = discovered.singles.get(singleName);
				const typeName = `_AllModule${capitalize(singleName)}`;
				// Exported — consumed by the L2 `Registry` interface (`~fieldTypes`).
				if (userFile) {
					lines.push(
						`export type ${typeName} = ExtractModuleProp<{ modules: typeof ${modulesFile.varName} }, "${singleName}"> & typeof ${userFile.varName};`,
					);
				} else {
					lines.push(
						`export type ${typeName} = ExtractModuleProp<{ modules: typeof ${modulesFile.varName} }, "${singleName}">;`,
					);
				}
			}
		}
	}
	lines.push("");

	// ── Augment factory registries with user-defined files ────────────
	// User-defined views, components, and fields augment the same
	// Questpie.*Registry interfaces that modules populate. This provides
	// autocomplete on v.*, c.*, f.* for BOTH module and user entities.
	// These augmentations use direct typeof references — NOT _MP<> — to
	// avoid circular dependencies.
	{
		const factoryRegistryAugmentations: string[] = [];
		const factoryTypeAliases: string[] = [];

		// Categories with recordPlaceholder (views, components) — user files
		for (const [catName, decl] of allDecls) {
			if (!decl.recordPlaceholder) continue;
			const fileMap = discovered.categories.get(catName);
			if (!fileMap || fileMap.size === 0) continue;

			const cap = capitalize(catName);
			const interfaceName = `${cap}Registry`;

			// Build inline type with user file entries
			const entries = sortedValues(fileMap)
				.map((f) => `${safeKey(f.key)}: typeof ${f.varName}`)
				.join("; ");
			factoryRegistryAugmentations.push(
				`\t\tinterface ${interfaceName} { ${entries}; }`,
			);
		}

		// User fields.ts → FieldTypesMap
		// NOTE: We use a type alias instead of inline `extends typeof _fields`
		// because some bundlers (rolldown/tsdown) cannot parse that syntax.
		{
			const tildeKeys = collectTildeRegistryKeys(
				discoverPatterns,
				discovered.singles,
			);
			for (const { singleName } of tildeKeys) {
				if (singleName !== "fields") continue;
				const userFile = discovered.singles.get(singleName);
				if (userFile) {
					const aliasName = `_UserFieldTypes`;
					factoryTypeAliases.push(
						`type ${aliasName} = typeof ${userFile.varName};`,
					);
					factoryRegistryAugmentations.push(
						`\t\tinterface FieldTypesMap extends ${aliasName} {}`,
					);
				}
			}
		}

		if (factoryRegistryAugmentations.length > 0) {
			lines.push("// Augment factory registries with user-defined files");

			// Emit type aliases before declare global (bundler compatibility)
			for (const alias of factoryTypeAliases) {
				lines.push(alias);
			}

			lines.push("declare global {");
			lines.push("\tnamespace Questpie {");
			for (const aug of factoryRegistryAugmentations) {
				lines.push(aug);
			}
			lines.push("\t}");
			lines.push("}");
			lines.push("");
		}
	}

	// ── App* type interfaces for each category ───────────────────
	for (const [catName, fileMap] of discovered.categories) {
		const decl = allDecls.get(catName);
		const typeEmit = decl?.typeEmit ?? "standard";
		const appTypeName = deriveAppTypeName(catName, decl);
		const moduleTypeName = deriveModuleTypeName(catName);

		switch (typeEmit) {
			case "standard": {
				if (catName === "routes") {
					emitRouteTypeInterface(lines, appTypeName, moduleTypeName, fileMap);
				} else {
					emitTypeInterface(
						lines,
						appTypeName,
						moduleTypeName,
						fileMap,
						decl,
						catName,
					);
				}
				break;
			}
			case "services": {
				const hasUser = fileMap.size > 0;
				lines.push(
					"/** All service definitions in the app (modules + user, user overrides). */",
				);
				if (hasUser) {
					lines.push(`type _AppServiceDefinitions = ${moduleTypeName} & {`);
					for (const file of sortedValues(fileMap)) {
						lines.push(`\t${safeKey(file.key)}: typeof ${file.varName};`);
					}
					lines.push("};");
				} else {
					lines.push(`type _AppServiceDefinitions = ${moduleTypeName};`);
				}
				lines.push("");
				lines.push(
					"/** All services in the app as resolved service instances. */",
				);
				lines.push(`export type ${appTypeName} = {`);
				lines.push(
					"\t[K in keyof _AppServiceDefinitions]: ServiceInstanceOf<_AppServiceDefinitions[K]>;",
				);
				lines.push("};");
				// Exported so context.gen.ts (L2) can import the resolved service
				// surfaces (AppContext / _AppInfraContext / ContextResolverContext).
				lines.push(
					'export type _AppDefaultServices = ServiceInstancesInNamespace<_AppServiceDefinitions, "services">;',
				);
				lines.push(
					"export type _AppTopLevelServices = ServiceTopLevelInstances<_AppServiceDefinitions>;",
				);
				lines.push(
					"export type _AppCustomServiceNamespaces = ServiceCustomNamespaceInstances<_AppServiceDefinitions>;",
				);
				lines.push("");
				break;
			}
			case "emails": {
				const hasFiles = fileMap.size > 0;
				lines.push(
					"/** All email templates in the app — use with email.sendTemplate() */",
				);
				if (hasFiles) {
					lines.push(`export type ${appTypeName} = {`);
					for (const file of sortedValues(fileMap)) {
						lines.push(`\t${safeKey(file.key)}: typeof ${file.varName};`);
					}
					lines.push("};");
				} else {
					lines.push(`export type ${appTypeName} = Record<string, never>;`);
				}
				lines.push("");
				break;
			}
			case "messages": {
				if (fileMap.size > 0) {
					lines.push(
						"/** Message keys — union of all keys from all locales */",
					);
					const msgParts = sortedValues(fileMap).map(
						(f) => `keyof typeof ${f.varName}`,
					);
					lines.push(`export type AppMessageKeys = ${msgParts.join(" | ")};`);
					lines.push("");
				}
				break;
			}
			case "none": {
				// No type emitted (migrations, seeds)
				break;
			}
		}
	}

	// ── L2 context build begins — extraTypeDecls + execution-context locals +
	// the `_AppQuestpie*` chain + `_AppInfraContext` + the composition declare
	// global. Lives in context.gen.ts (imports L1, never imported by L1). ──
	lines = l2;
	// Extra type declarations from plugins (context-adjacent → L2, which imports
	// the L1 maps these may reference).
	if (extraTypeDeclarations && extraTypeDeclarations.length > 0) {
		for (const decl of extraTypeDeclarations) {
			lines.push(decl);
		}
		lines.push("");
	}

	// ── AppContext augmentation — auto-types ALL handlers ──────
	{
		const emailsCat = discovered.categories.get("emails");
		const hasEmails = emailsCat && emailsCat.size > 0;
		const emailsTypeName = deriveAppTypeName("emails", allDecls.get("emails"));

		const messagesCat = discovered.categories.get("messages");
		const hasMessages = messagesCat && messagesCat.size > 0;

		const servicesCat = discovered.categories.get("services");
		const hasServices = !!servicesCat;

		// Skip App['api']['collections'] class getter indirection — map directly over AppCollections
		lines.push(
			"type _CollectionsAPI = { [K in keyof AppCollections]: CollectionAPI<AppCollections[K], AppCollections> };",
		);
		// Job handler collections mirror AppCollections (= _ModuleCollections &
		// local literal map), so module collections are reachable inside a job/
		// workflow handler (cga-1/cga-2/CL-04). The LOCAL half must stay an EXPLICIT
		// literal of the local collection imports — routing the local keys through
		// AppCollections creates a type cycle when a job file is part of the module
		// graph: JobHandlerContext -> AppCollections -> modules.ts -> the job file
		// being checked (tsc silently collapses the mapped type, TS2339). But
		// _ModuleCollections is `typeof _modules` (external packages), NOT on the
		// user job-file path, so intersecting it restores module collections without
		// re-introducing that cycle.
		const localCollections = sortedValues(
			discovered.categories.get("collections") ?? new Map(),
		).filter((file) => !file.isBundle);
		if (localCollections.length > 0) {
			lines.push("type _JobHandlerCollections = _ModuleCollections & {");
			for (const file of localCollections) {
				lines.push(`\t${safeKey(file.key)}: typeof ${file.varName};`);
			}
			lines.push("};");
			lines.push("type _JobHandlerCollectionsAPI = {");
			for (const file of localCollections) {
				lines.push(
					`\t${safeKey(file.key)}: CollectionAPI<typeof ${file.varName}, _JobHandlerCollections>;`,
				);
			}
			lines.push("};");
		} else {
			lines.push("type _JobHandlerCollections = AppCollections;");
			lines.push("type _JobHandlerCollectionsAPI = _CollectionsAPI;");
		}
		const localJobs = sortedValues(
			discovered.categories.get("jobs") ?? new Map(),
		).filter((file) => !file.isBundle);
		lines.push(
			"type _ExecutionContextJob<T> = T extends { name: infer TName extends string; schema: z.ZodSchema<infer TPayload> } ? QueueJobType<TPayload, TName> : never;",
		);
		if (localJobs.length > 0) {
			lines.push("type _ExecutionContextJobs = {");
			for (const file of localJobs) {
				lines.push(
					`\t${safeKey(file.key)}: _ExecutionContextJob<typeof ${file.varName}>;`,
				);
			}
			lines.push("};");
		} else {
			lines.push("type _ExecutionContextJobs = {};");
		}
		const localServices = sortedValues(
			discovered.categories.get("services") ?? new Map(),
		).filter((file) => !file.isBundle);
		if (localServices.length > 0) {
			lines.push("type _ExecutionContextServiceDefinitions = {");
			for (const file of localServices) {
				lines.push(`\t${safeKey(file.key)}: typeof ${file.varName};`);
			}
			lines.push("};");
		} else {
			lines.push("type _ExecutionContextServiceDefinitions = {};");
		}
		lines.push(
			'type _ExecutionContextDefaultServices = ServiceInstancesInNamespace<_ExecutionContextServiceDefinitions, "services">;',
		);
		lines.push(
			"type _AppCollectionDefinitions = AppCollections & Record<string, AnyCollectionOrBuilder>;",
		);
		lines.push(
			"type _AppGlobalDefinitions = AppGlobals & Record<string, AnyGlobalOrBuilder>;",
		);
		lines.push(
			'type _AppQuestpieConfig = Omit<QuestpieConfig, "app" | "db" | "collections" | "globals" | "auth" | "~contextExtensions"> & {',
		);
		lines.push('\tapp: (typeof _runtime)["app"];');
		lines.push('\tdb: (typeof _runtime)["db"];');
		lines.push("\tcollections: _AppCollectionDefinitions;");
		lines.push("\tglobals: _AppGlobalDefinitions;");
		lines.push("\tauth: _AppAuthConfig;");
		lines.push('\tstorage: (typeof _runtime)["storage"];');
		lines.push('\t"~contextExtensions": _AppContextExtensions;');
		lines.push("};");
		lines.push("type _AppQuestpieBase = Questpie<_AppQuestpieConfig>;");
		lines.push(
			"type _AppDb = DrizzleClientFromQuestpieConfig<_AppQuestpieConfig>;",
		);
		lines.push('type _AppGlobalsAPI = _AppQuestpieBase["globals"];');
		lines.push('type _AppStorage = _AppQuestpieBase["storage"];');
		lines.push("type _AppTables = TablesFromConfig<_AppQuestpieConfig>;");
		if (envFile) {
			// Exported — index.ts (L3) imports `_AppQuestpie` DOWN for the runtime
			// `as _AppQuestpie` cast + createContext. L3 never reaches it upward.
			lines.push(
				'export type _AppQuestpie = Omit<_AppQuestpieBase, "collections" | "globals" | "env"> & {',
			);
			lines.push("\tcollections: _CollectionsAPI;");
			lines.push("\tglobals: _AppGlobalsAPI;");
			lines.push(`\tenv: typeof ${envFile.varName};`);
			lines.push("};");
		} else {
			lines.push(
				'export type _AppQuestpie = Omit<_AppQuestpieBase, "collections" | "globals"> & {',
			);
			lines.push("\tcollections: _CollectionsAPI;");
			lines.push("\tglobals: _AppGlobalsAPI;");
			lines.push("};");
		}
		lines.push("");

		lines.push(
			"// ── AppContext augmentation — auto-types ALL handlers ──────",
		);
		// _AppInfraContext = the full infra surface WITHOUT _AppContextExtensions.
		// Shared by AppContext (via _AppCoreContext) AND the app-level hook/access
		// ctx seams (AppHookContext/AppDefaultAccessContext). Excluding the
		// extensions keeps those seams OFF the cyclic edge
		// (AppContext → extensions → typeof appConfig → AppHookContext → ...).
		lines.push("type _AppInfraContext = {");
		lines.push("\t// Infrastructure");
		lines.push("\tapp: _AppQuestpie;");
		lines.push("\tdb: _AppDb;");
		if (hasEmails) {
			lines.push(`\temail: MailerService<${emailsTypeName}>;`);
		} else {
			lines.push('\temail: _AppQuestpie["email"];');
		}
		lines.push("\tqueue: QueueClient<AppJobs>;");
		lines.push("\tstorage: _AppStorage;");
		lines.push('\tkv: _AppQuestpie["kv"];');
		lines.push('\tlogger: _AppQuestpie["logger"];');
		lines.push('\tsearch: _AppQuestpie["search"];');
		lines.push('\trealtime: _AppQuestpie["realtime"];');
		lines.push("");
		lines.push("\t// Entity APIs");
		lines.push("\tcollections: _CollectionsAPI;");
		lines.push("\tglobals: _AppGlobalsAPI;");
		lines.push("\ttables: _AppTables;");
		lines.push("");
		lines.push("\t// Request-scoped");
		lines.push("\tsession: _AppSession;");
		if (hasMessages) {
			lines.push(
				"\tt: (key: AppMessageKeys | (string & {}), params?: Record<string, unknown>, locale?: string) => string;",
			);
		} else {
			lines.push(
				"\tt: (key: string, params?: Record<string, unknown>, locale?: string) => string;",
			);
		}
		if (hasServices) {
			lines.push("");
			lines.push("\t// User services");
			lines.push("\tservices: _AppDefaultServices;");
		}
		lines.push("} & _AppCustomServiceNamespaces;");
		lines.push("type _AppCoreContext = _AppContextExtensions & _AppInfraContext;");
		lines.push("");

		// ── Module entity-name key sets (distributive `keyof`, UnionToIntersection-free) ──
		// One alias per names-only registry category. Each is the UNION of every
		// module's `keyof <category>` — computed by distributing over the module
		// tuple union and unioning the per-module key sets, so it does NOT route
		// through `_MP`/`UnionToIntersection` (which collapses to the wide floor
		// under workspace/dist resolution and would drop the module names). These
		// feed the CollectionKeys/GlobalKeys/JobKeys augmentation in L0's OWN
		// `declare global` (names.gen.ts). `& string` keeps the key set to strings.
		// These are NAME registries (leaf) — emitted into l0, not l2, so they carry
		// no AppContext reach.
		const keyRegistryModuleNames: Array<{
			interfaceName: string;
			keysTypeName: string;
		}> = [];
		{
			const keyRegistryCats: Array<{ interfaceName: string; catName: string }> = [
				{ interfaceName: "CollectionKeys", catName: "collections" },
				{ interfaceName: "GlobalKeys", catName: "globals" },
				{ interfaceName: "JobKeys", catName: "jobs" },
			];
			l0.push(
				"// ── Module entity-name key sets (distributive `keyof`) ─────",
			);
			for (const { interfaceName, catName } of keyRegistryCats) {
				if (!discovered.categories.has(catName)) continue;
				const decl = allDecls.get(catName);
				const shouldExtract = decl ? decl.extractFromModules !== false : true;
				if (!shouldExtract) continue;
				const keysTypeName = `_Module${capitalize(catName)}KeyNames`;
				l0.push(
					`type ${keysTypeName} = (typeof ${modulesFile.varName})[number] extends infer M ? M extends { ${catName}: infer C } ? keyof C & string : never : never;`,
				);
				keyRegistryModuleNames.push({ interfaceName, keysTypeName });
			}
			// L0's own `declare global` augments the names-only key registries with
			// the MODULE entity names. factories.ts contributes the USER literals;
			// ambient merge composes both halves across files.
			l0.push("");
			l0.push("declare global {");
			l0.push("\tnamespace Questpie {");
			for (const { interfaceName, keysTypeName } of keyRegistryModuleNames) {
				l0.push(
					`\t\tinterface ${interfaceName} extends Record<${keysTypeName}, unknown> {}`,
				);
			}
			l0.push("\t}");
			l0.push("}");
			l0.push("");
		}

		lines.push("declare global {");
		lines.push("\tnamespace Questpie {");
		if (hasServices && hasWorkflows) {
			// Redeclare `workflows` with the AppWorkflows-keyed client. The
			// service-inferred member from _AppTopLevelServices is the blind
			// `WorkflowClient<Record<string, WorkflowDefinition>>` — the
			// redeclaration restores key + payload checking on trigger().
			lines.push(
				"\t\tinterface AppContext extends _AppCoreContext, _AppTopLevelServices {",
			);
			lines.push("\t\t\tworkflows: WorkflowClient<AppWorkflows>;");
			lines.push("\t\t}");
		} else if (hasServices) {
			lines.push(
				"\t\tinterface AppContext extends _AppCoreContext, _AppTopLevelServices {}",
			);
		} else {
			lines.push("\t\tinterface AppContext extends _AppCoreContext {}");
		}
		lines.push("");
		// Execution contexts (jobs, workflows) are emitted as plain interfaces
		// with lazy members referencing the app-level aliases. Interface-member
		// laziness keeps this safe even when a job/workflow file is part of the
		// module graph (the historical collapse was specific to routing the
		// `collections` MAPPED type through AppCollections — collections stays
		// the literal local map below).
		const emitNonRecursiveContext = (name: string) => {
			lines.push(`\t\tinterface ${name} {`);
			lines.push("\t\t\t// Infrastructure");
			lines.push("\t\t\tdb: _AppDb;");
			if (hasEmails) {
				lines.push(`\t\t\temail: MailerService<${emailsTypeName}>;`);
			} else {
				lines.push('\t\t\temail: _AppQuestpie["email"];');
			}
			lines.push("\t\t\tqueue: QueueClient<_ExecutionContextJobs>;");
			lines.push("\t\t\tstorage: _AppStorage;");
			lines.push('\t\t\tkv: _AppQuestpie["kv"];');
			lines.push('\t\t\tlogger: _AppQuestpie["logger"];');
			lines.push('\t\t\tsearch: _AppQuestpie["search"];');
			lines.push('\t\t\trealtime: _AppQuestpie["realtime"];');
			lines.push("");
			lines.push("\t\t\t// Entity APIs");
			lines.push("\t\t\tcollections: _JobHandlerCollectionsAPI;");
			lines.push("\t\t\tglobals: _AppGlobalsAPI;");
			lines.push("\t\t\ttables: _AppTables;");
			lines.push("");
			lines.push("\t\t\t// Request-scoped");
			lines.push("\t\t\tsession: _AppSession;");
			if (hasMessages) {
				lines.push(
					"\t\t\tt: (key: AppMessageKeys | (string & {}), params?: Record<string, unknown>, locale?: string) => string;",
				);
			} else {
				lines.push(
					"\t\t\tt: (key: string, params?: Record<string, unknown>, locale?: string) => string;",
				);
			}
			lines.push("");
			if (hasWorkflows) {
				lines.push(
					"\t\t\t// Workflows client — typed by AppWorkflows (name + schema preserved)",
				);
				lines.push("\t\t\tworkflows: WorkflowClient<AppWorkflows>;");
				lines.push("");
			} else if (
				hasServices &&
				(name === "WorkflowContext" || name === "JobHandlerContext")
			) {
				lines.push("			// Top-level services (namespace: null)");
				lines.push(
					"			workflows?: _AppTopLevelServices extends { workflows: infer W } ? W : never;",
				);
				lines.push("");
			}
			lines.push("\t\t\t// User services");
			lines.push("\t\t\tservices: _ExecutionContextDefaultServices;");
			lines.push("\t\t}");
		};
		emitNonRecursiveContext("JobHandlerContext");
		lines.push("");
		emitNonRecursiveContext("WorkflowContext");
		lines.push("");
		lines.push("\t\tinterface ServiceCreateContext extends _AppCoreContext {}");
		lines.push(
			"\t\t// Names-only marker — the `ServiceCreateContext` fallback conditional",
		);
		lines.push(
			"\t\t// probes THIS interface's keys instead of the real one (whose base",
		);
		lines.push(
			"\t\t// resolves through module service definitions and would cycle).",
		);
		lines.push(
			"\t\tinterface ServiceCreateContextGenerated { generated: unknown }",
		);
		lines.push("");
		lines.push(
			"\t\t// Typed service surface for appConfig({ context }) resolvers.",
		);
		lines.push(
			"\t\t// Excludes _AppContextExtensions — the resolver produces them.",
		);
		lines.push("\t\tinterface ContextResolverContext {");
		lines.push("\t\t\tcollections: _CollectionsAPI;");
		lines.push("\t\t\tglobals: _AppGlobalsAPI;");
		lines.push('\t\t\tlogger: _AppQuestpie["logger"];');
		lines.push('\t\t\tkv: _AppQuestpie["kv"];');
		lines.push("\t\t\tqueue: QueueClient<AppJobs>;");
		if (hasMessages) {
			lines.push(
				"\t\t\tt: (key: AppMessageKeys | (string & {}), params?: Record<string, unknown>, locale?: string) => string;",
			);
		} else {
			lines.push(
				"\t\t\tt: (key: string, params?: Record<string, unknown>, locale?: string) => string;",
			);
		}
		if (hasServices) {
			lines.push("\t\t\tservices: _AppDefaultServices;");
		}
		lines.push("\t\t}");
		lines.push("");
		lines.push(
			"\t\t// App-level hook / default-access ctx infra seams (CL-05).",
		);
		lines.push(
			"\t\t// Filled with the real infra MINUS _AppContextExtensions, so the",
		);
		lines.push(
			"\t\t// app-level hooks/access predicates get precise db/session/",
		);
		lines.push(
			"\t\t// collections/globals/queue WITHOUT re-entering the extensions cycle.",
		);
		lines.push("\t\tinterface AppHookContext extends _AppInfraContext {}");
		lines.push(
			"\t\tinterface AppDefaultAccessContext extends _AppInfraContext {}",
		);
		lines.push("");
		lines.push(
			"\t\t// appConfig({ context }) resolver session/db — off the cyclic edge.",
		);
		lines.push("\t\tinterface ContextResolverBase {");
		lines.push("\t\t\tsession: _AppSession;");
		lines.push("\t\t\tdb: _AppDb;");
		lines.push("\t\t}");

		// NOTE: the MODULE entity-name contribution into CollectionKeys/GlobalKeys/
		// JobKeys (the `_Module*KeyNames` distributive-keyof + augmentation) lives in
		// names.gen.ts (L0) — a leaf names-only registry with no AppContext reach.
		// factories.ts contributes the USER literals; ambient merge composes both.

		// Registry — ALL registryKey categories + ~-prefixed singles augmented centrally.
		// This is the SINGLE place that augments Registry. Modules never augment it.
		{
			const registryEntries = new Map<string, string[]>();
			const addRegistryEntry = (key: string, typeName: string) => {
				const entries = registryEntries.get(key) ?? [];
				if (!entries.includes(typeName)) entries.push(typeName);
				registryEntries.set(key, entries);
			};

			// Category registryKeys (views, components, blocks, listViews, etc.)
			for (const [catName, decl] of allDecls) {
				if (!decl.registryKey) continue;
				const regKey =
					typeof decl.registryKey === "string" ? decl.registryKey : catName;
				const typeName = `_Registry_${capitalize(catName)}`;
				addRegistryEntry(regKey, typeName);
			}

			// ~-prefixed registryKeys from singles (e.g. ~fieldTypes)
			const tildeKeys = collectTildeRegistryKeys(
				discoverPatterns,
				discovered.singles,
			);
			for (const { singleName, registryKey } of tildeKeys) {
				const typeName = `_AllModule${capitalize(singleName)}`;
				addRegistryEntry(registryKey, typeName);
			}

			if (registryEntries.size > 0) {
				lines.push("");
				lines.push("\t\tinterface Registry {");
				for (const [registryKey, typeNames] of registryEntries) {
					lines.push(
						`\t\t\t${safeKey(registryKey)}: ${typeNames.join(" & ")};`,
					);
				}
				lines.push("\t\t}");
			}
		}

		lines.push("\t}");
		lines.push("}");
		lines.push("");
	}

	// ── AppSession / AppSessionUser re-exports — L2 owns `_AppSession`. ────
	// L3 imports these DOWN from context.gen.ts (it never reaches `_AppSession`).
	l2.push(
		"/** Resolved auth session for this app (`{ user, session } | null`). */",
	);
	l2.push("export type AppSession = _AppSession;");
	l2.push("");
	l2.push("/** Authenticated user shape from the app session. */");
	l2.push('export type AppSessionUser = NonNullable<_AppSession>["user"];');
	l2.push("");

	// ── L3 public surface begins — CollectionDoc/GlobalDoc + access/hook ctx +
	// AppConfig + runtime. index.ts imports AppCollections/AppGlobals/AppRoutes
	// from L1 and _AppQuestpie/AppSession/AppSessionUser from L2. ──
	lines = l3;
	// Re-export the public type surface from the lower layers so `#questpie`
	// keeps resolving the App* category types (entities.gen) + session/route/
	// block types (context.gen) off the package root (index.ts). Type-only star
	// re-exports — no runtime require is emitted between the .gen.ts files.
	lines.push(`export type * from "${jsImport(L1_FILE)}";`);
	lines.push(`export type * from "${jsImport(L2_FILE)}";`);
	lines.push("");
	lines.push("/**");
	lines.push(
		" * Select/document type for a collection key — prefer over `Record<string, any>` for docs.",
	);
	lines.push(" */");
	lines.push(
		"export type CollectionDoc<K extends keyof AppCollections> = CollectionSelect<AppCollections[K]>;",
	);
	lines.push("");
	lines.push("/**");
	lines.push(" * Select/document type for a global key.");
	lines.push(" */");
	lines.push(
		"export type GlobalDoc<K extends keyof AppGlobals> = GlobalSelect<AppGlobals[K]>;",
	);
	lines.push("");
	lines.push("/**");
	lines.push(
		" * Access-rule ctx for shared helpers. `K` narrows `data` to that collection's row.",
	);
	lines.push(" *");
	lines.push(" * CYCLE RULE: import these only from files NOT imported by a collection");
	lines.push(" * (routes, services, jobs, scripts). Helpers imported by collections take");
	lines.push(' * the package-level `AccessContext` from "questpie" instead — see the');
	lines.push(" * type-inference reference.");
	lines.push(" *");
	lines.push(" * @example");
	lines.push(" * ```ts");
	lines.push(
		' * export async function isOwner(ctx: AccessRuleContext<"posts">) {',
	);
	lines.push(
		" *   return ctx.data?.authorId === ctx.session?.user.id; // ctx.collections typed",
	);
	lines.push(" * }");
	lines.push(" * ```");
	lines.push(" */");
	lines.push(
		"export type AccessRuleContext<K extends keyof AppCollections | unknown = unknown> =",
	);
	lines.push(
		"\tAccessContext<K extends keyof AppCollections ? CollectionDoc<K> : unknown>;",
	);
	lines.push("");
	lines.push("/**");
	lines.push(
		" * Hook ctx for shared helpers. `K` narrows `data` to that collection's row.",
	);
	lines.push(" * Same cycle rule as `AccessRuleContext`.");
	lines.push(" */");
	lines.push(
		"export type HookRuleContext<K extends keyof AppCollections | unknown = unknown> =",
	);
	lines.push(
		"\tHookContext<K extends keyof AppCollections ? CollectionDoc<K> : unknown>;",
	);
	lines.push("");

	// AppConfig — flat type for client APIs (createClient<AppConfig>(), createAdminAuthClient<AppConfig>())
	lines.push("/**");
	lines.push(" * Flat config type for client APIs.");
	lines.push(
		" * Use with `createClient<AppConfig>()` and `createAdminAuthClient<AppConfig>()`.",
	);
	lines.push(
		" * For handler context, use `AppContext` (auto-typed via module augmentation).",
	);
	lines.push(" */");
	// NOTE: no `& Record<string, …>` intersections here — they widen `keyof`
	// to `string`, so phantom collection/global keys compile on the client
	// (`createClient<AppConfig>().collections.nope`). Module category maps are
	// emitted as type aliases (implicit index signatures), so the plain
	// aggregates already satisfy the SDK's `QuestpieApp` constraint.
	lines.push("export type AppConfig = {");
	lines.push("\tcollections: AppCollections;");
	lines.push("\tglobals: AppGlobals;");
	lines.push("\troutes: AppRoutes;");
	lines.push('\tstorage: (typeof _runtime)["storage"];');
	if (authFile) {
		lines.push(`\tauth: typeof ${authFile.varName};`);
	}
	lines.push("};");
	lines.push("");

	// ════════════════════════════════════════════════════════════
	// RUNTIME — create the app instance
	// ════════════════════════════════════════════════════════════

	lines.push("// ════════════════════════════════════════════════════════════");
	lines.push("// RUNTIME — create the app instance");
	lines.push("// ════════════════════════════════════════════════════════════");
	lines.push("");

	emitNewArchitectureRuntime(lines, discovered, allDecls, extraEntities);

	lines.push("/** Fully typed QUESTPIE app instance. */");
	lines.push("export type App = typeof app;");
	lines.push("");

	// createContext() — typed context factory for scripts/standalone usage
	lines.push("// ── createContext — typed context for scripts ──────────────");
	lines.push("/**");
	lines.push(
		" * Create a typed AppContext for use in scripts, tests, or standalone code.",
	);
	lines.push(
		" * Resolves all services and provides flat access to infrastructure.",
	);
	lines.push(" *");
	lines.push(" * @example");
	lines.push(" * ```ts");
	lines.push(' * import { createContext } from "#questpie";');
	lines.push(" *");
	lines.push(" * const ctx = await createContext();");
	lines.push(" * const posts = await ctx.collections.posts.find({});");
	lines.push(" * ```");
	lines.push(" */");
	lines.push("export async function createContext(");
	lines.push(
		"\toptions?: Parameters<ReturnType<typeof createContextFactory>>[0],",
	);
	lines.push(") {");
	lines.push("\twhile (!_appPromise) {");
	lines.push("\t\tawait new Promise((resolve) => setTimeout(resolve, 0));");
	lines.push("\t}");
	lines.push("");
	lines.push(
		"\treturn createContextFactory((await _appPromise) as _AppQuestpie)(options);",
	);
	lines.push("}");
	lines.push("");

	// Factories are available via #questpie/factories (separate entry to avoid circular deps)
	lines.push(
		"// Factories: import { collection, global, ... } from '#questpie/factories';",
	);
	lines.push("");

	// Extra runtime code from plugins
	if (extraRuntimeCode && extraRuntimeCode.length > 0) {
		for (const code of extraRuntimeCode) {
			lines.push(code);
		}
		lines.push("");
	}

	return {
		code: l3.join("\n"),
		extraFiles: [
			{ name: L0_FILE, code: l0.join("\n") },
			{ name: L1_FILE, code: l1.join("\n") },
			{ name: L2_FILE, code: l2.join("\n") },
		],
	};
}

// ============================================================================
// Runtime emission — new architecture
// ============================================================================

/**
 * Emit the createApp(definition, _runtime) call for new architecture.
 * Iterates over all discovered categories using CategoryDeclaration metadata
 * to determine how each category should be emitted (record, nested, array).
 *
 * @see RFC-MODULE-ARCHITECTURE §9.1
 */
function emitNewArchitectureRuntime(
	lines: string[],
	discovered: DiscoveryResult,
	allDecls: Map<string, CategoryDeclaration>,
	extraEntities?: Map<string, string>,
): void {
	const modulesFile = discovered.singles.get("modules");
	if (!modulesFile) {
		throw new Error("emitNewArchitectureRuntime called without modules.ts");
	}
	const envFile = discovered.singles.get("env") ?? null;
	const coreSingles = getCategorizedSingles(discovered.singles, allDecls);

	lines.push("var _appPromise: Promise<unknown> | undefined;");
	lines.push("");
	lines.push("_appPromise = createApp(");
	lines.push("\t({");

	// Modules — preserve the concrete exported module types directly.
	lines.push(`\t\tmodules: ${modulesFile.varName},`);

	// Validated env (from env.ts) — stored on the instance as app.env.
	if (envFile) {
		lines.push(`\t\tenv: ${envFile.varName},`);
	}

	// ── Emit all categories ──────────────────────────────────────
	for (const [catName, fileMap] of discovered.categories) {
		if (fileMap.size === 0) continue;

		const decl = allDecls.get(catName);
		const emitMode = decl?.emit ?? "record";
		const createAppKey = decl?.createAppKey ?? catName;

		switch (emitMode) {
			case "record": {
				lines.push(`\t\t${safeKey(createAppKey)}: {`);
				for (const file of sortedValues(fileMap)) {
					lines.push(`\t\t\t${categoryRecordEntry(file, decl)},`);
				}
				lines.push("\t\t},");
				break;
			}
			case "array": {
				const vars = sortedValues(fileMap)
					.map((f) => f.varName)
					.join(", ");
				lines.push(`\t\t${safeKey(createAppKey)}: [${vars}],`);
				break;
			}
		}
	}

	// Separate config-bucket singles from plain singles
	const allSingles = [...coreSingles.core, ...coreSingles.plugin];
	const configEntries: Array<{ configKey: string; file: DiscoveredFile }> = [];
	const plainSingles: DiscoveredFile[] = [];

	for (const file of allSingles) {
		if (file.configKey) {
			configEntries.push({ configKey: file.configKey, file });
		} else if (file.key !== "modules") {
			plainSingles.push(file);
		}
	}

	// Emit config bucket — each config file = one key
	if (configEntries.length > 0) {
		lines.push("\t\tconfig: {");
		for (const { configKey, file } of configEntries) {
			lines.push(`\t\t\t${safeKey(configKey)}: ${file.varName},`);
		}
		lines.push("\t\t},");
	}

	// Plain singles (fields, etc.) — NOT config files
	for (const file of plainSingles) {
		lines.push(`\t\t${safeKey(file.key)}: ${file.varName},`);
	}

	// Spread singles (sidebar, dashboard — mergeStrategy: "spread")
	// NOTE: With the config bucket, spreads from features should flow into
	// the config bucket too. For now, keep spread emission for backward compat.
	for (const [stateKey, files] of discovered.spreads) {
		if (files.length > 0) {
			const spread = files.map((f) => `...(${f.varName} ?? [])`).join(", ");
			lines.push(`\t\t${safeKey(stateKey)}: [${spread}],`);
		}
	}

	// Extra entities from plugins
	if (extraEntities) {
		for (const [key, value] of extraEntities) {
			lines.push(`\t\t${safeKey(key)}: ${value},`);
		}
	}

	lines.push("\t}) satisfies AppDefinition,");
	lines.push("\t_runtime,");
	lines.push(");");
	lines.push("");
	lines.push(
		"export const app = (await _appPromise) as unknown as _AppQuestpie;",
	);
	lines.push("");
	if (envFile) {
		lines.push("/** Validated app environment (from env.ts). */");
		lines.push(`export const env = ${envFile.varName};`);
		lines.push("");
	}
}

// ============================================================================
// Category metadata helpers
// ============================================================================

/**
 * Build a Map of category declarations from the resolved target's merged categories.
 */
function collectCategoryDeclarations(
	categories?: Record<string, CategoryDeclaration>,
): Map<string, CategoryDeclaration> {
	const result = new Map<string, CategoryDeclaration>();
	if (!categories) return result;
	for (const [name, decl] of Object.entries(categories)) {
		result.set(name, decl);
	}
	return result;
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Derive the App type name for a category.
 * Uses createAppKey if set, otherwise uses the category name.
 * e.g., "collections" → "AppCollections", "emails" (createAppKey: "emailTemplates") → "AppEmailTemplates"
 */
function deriveAppTypeName(
	catName: string,
	decl?: CategoryDeclaration,
): string {
	const key = decl?.createAppKey ?? catName;
	return `App${capitalize(key)}`;
}

/**
 * Derive the _Module type name for a category.
 * e.g., "collections" → "_ModuleCollections"
 */
function deriveModuleTypeName(catName: string): string {
	return `_Module${capitalize(catName)}`;
}

/**
 * Generate a section comment with consistent formatting.
 */
function sectionComment(label: string): string {
	const base = `// ── ${label} `;
	const dashes = "─".repeat(Math.max(0, 62 - base.length));
	return base + dashes;
}

// ============================================================================
// Singles categorization
// ============================================================================

/**
 * Well-known core single file keys.
 * Determined from corePlugin().discover patterns.
 * Used to separate "Core Singles" from "Plugin Singles" in generated comments.
 */
function getCoreSingleKeys(
	allDecls: Map<string, CategoryDeclaration>,
): Set<string> {
	// Core singles are those discovered by any plugin that also declares categories.
	// In practice, this is the core plugin which declares modules, locale, hooks, etc.
	// We use a simple heuristic: keys that match well-known core patterns.
	return new Set(["modules", "authConfig", "appConfig"]);
}

interface CategorizedSingles {
	/** Core singles (locale, hooks, access, context) — NOT modules. */
	core: DiscoveredFile[];
	/** Plugin-discovered singles (sidebar, dashboard, branding, adminLocale, etc.). */
	plugin: DiscoveredFile[];
}

/**
 * Categorize singles into core (always available) and plugin-discovered.
 * Excludes "modules" since that's handled separately.
 */
function getCategorizedSingles(
	singles: Map<string, DiscoveredFile>,
	allDecls: Map<string, CategoryDeclaration>,
): CategorizedSingles {
	const coreSingleKeys = getCoreSingleKeys(allDecls);
	const core: DiscoveredFile[] = [];
	const plugin: DiscoveredFile[] = [];

	for (const [key, file] of singles) {
		if (key === "modules") continue; // handled separately
		if (key === "plugin") continue; // codegen-only, not passed to createApp
		if (key === "env") continue; // imported first + emitted explicitly
		if (key === "envClient") continue; // consumed by client env emission only
		if (coreSingleKeys.has(key)) {
			core.push(file);
		} else {
			plugin.push(file);
		}
	}

	// Sort for deterministic output
	core.sort((a, b) => a.key.localeCompare(b.key));
	plugin.sort((a, b) => a.key.localeCompare(b.key));

	return { core, plugin };
}

// ============================================================================
// Type interface emission helper
// ============================================================================

/**
 * Emit a type interface or type alias for a category (collections, globals, etc.).
 * When user has entities, emits `export type X = _ModuleX & { ... }`.
 * Otherwise emits `export type X = _ModuleX;`.
 */
function emitTypeInterface(
	lines: string[],
	typeName: string,
	moduleTypeName: string,
	fileMap: Map<string, DiscoveredFile>,
	decl: CategoryDeclaration | undefined,
	catName: string,
): void {
	const label = typeName.replace(/^App/, "").toLowerCase();
	const hasUser = fileMap.size > 0;
	lines.push(`/** All ${label} in the app (modules + user, user overrides) */`);
	if (hasUser) {
		if (decl?.keyFromProperty) {
			lines.push(`export type ${typeName} = ${moduleTypeName}`);
			const files = sortedValues(fileMap);
			for (const [index, file] of files.entries()) {
				const suffix = index === files.length - 1 ? ";" : "";
				lines.push(
					`	& { ${categoryTypeEntry(file, decl, catName)} }${suffix}`,
				);
			}
		} else {
			lines.push(`export type ${typeName} = ${moduleTypeName} & {`);
			for (const file of sortedValues(fileMap)) {
				lines.push(`\t${categoryTypeEntry(file, decl, catName)};`);
			}
			lines.push("};");
		}
	} else {
		lines.push(`export type ${typeName} = ${moduleTypeName};`);
	}
	lines.push("");
}

/**
 * Emit a routes type interface that preserves exact params on generated keys.
 */
function emitRouteTypeInterface(
	lines: string[],
	typeName: string,
	moduleTypeName: string,
	fileMap: Map<string, DiscoveredFile>,
): void {
	const hasUser = fileMap.size > 0;
	lines.push("/** All routes in the app (modules + user, user overrides) */");
	if (hasUser) {
		lines.push(`export type ${typeName} = ${moduleTypeName} & {`);
		for (const file of sortedValues(fileMap)) {
			lines.push(
				`\t${safeKey(file.key)}: RouteWithParams<_RouteDefinitionWithoutHandler<typeof ${file.varName}>, RouteParamsFromKey<${JSON.stringify(file.key)}>>;`,
			);
		}
		lines.push("};");
	} else {
		lines.push(`export type ${typeName} = ${moduleTypeName};`);
	}
	lines.push("");
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Collect singleton discover patterns with ~-prefixed registryKeys.
 * These need centralized augmentation in the root template (not per-module)
 * to avoid TypeScript merge conflicts when multiple modules contribute.
 */
function collectTildeRegistryKeys(
	discoverPatterns: Record<string, DiscoverPattern> | undefined,
	singles: Map<string, DiscoveredFile>,
): Array<{ singleName: string; registryKey: string }> {
	if (!discoverPatterns) return [];
	const result: Array<{ singleName: string; registryKey: string }> = [];
	for (const [name, pattern] of Object.entries(discoverPatterns)) {
		if (typeof pattern !== "object" || !pattern.registryKey) continue;
		if (!pattern.registryKey.startsWith("~")) continue;
		// Only include if at least modules exist (which provide the fields).
		// The user may also have a fields.ts — handled by the type emission.
		result.push({ singleName: name, registryKey: pattern.registryKey });
	}
	return result.sort((a, b) => a.singleName.localeCompare(b.singleName));
}
