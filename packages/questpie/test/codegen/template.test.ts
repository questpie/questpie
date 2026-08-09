/**
 * Tests: codegen template generation
 *
 * Covers:
 * 1. `generateTemplate` — throws without modules.ts
 * 2. Minimal template (just modules.ts) — correct structure emitted
 * 3. Collections, globals, jobs — object syntax in createApp
 * 4. Migrations, seeds — flat array syntax in createApp
 * 5. Named vs default import generation
 * 6. Services — ServiceInstanceOf import
 * 7. Emails — MailerService import
 * 8. Routes — flat record with slash-separated keys
 */
import { describe, expect, it } from "bun:test";

import { generateFactoryTemplate } from "../../src/cli/codegen/factory-template.js";
import {
	coreCodegenPlugin,
	resolveTargetGraph,
	runAllTargets,
	runCodegen,
} from "../../src/cli/codegen/index.js";
import { generateTemplate as _generateTemplate } from "../../src/cli/codegen/template.js";

// Step-6 multi-file split: generateTemplate now returns
// `{ code, extraFiles }` (index.ts + names.gen.ts/entities.gen.ts/
// context.gen.ts). These tests assert on the FULL emitted type surface, so the
// shim concatenates index.ts + every layer file back into one string — the same
// content the pre-split single index.ts contained.
function generateTemplate(
	opts: Parameters<typeof _generateTemplate>[0],
): string {
	const { code, extraFiles } = _generateTemplate(opts);
	return [code, ...extraFiles.map((f) => f.code)].join("\n");
}

import type {
	CategoryDeclaration,
	CodegenPlugin,
	CodegenResult,
	CrossTargetValidator,
	DiscoveredFile,
	DiscoveryResult,
	SingletonFactory,
} from "../../src/cli/codegen/types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Resolve the "server" target from the core plugin (and optional extras). */
function serverTarget(extraPlugins: CodegenPlugin[] = []) {
	const graph = resolveTargetGraph([coreCodegenPlugin(), ...extraPlugins]);
	return graph.get("server")!;
}

/** Get merged categories from the resolved server target. */
function coreCategories(): Record<string, CategoryDeclaration> {
	return serverTarget().categories;
}

/** Get merged singleton factories from the resolved server target. */
function coreSingletonFactories(): Record<string, SingletonFactory> {
	return serverTarget().registries.singletonFactories;
}

function makeFile(
	key: string,
	opts: {
		varName?: string;
		importPath?: string;
		exportType?: "default" | "named" | "unknown";
		namedExportName?: string;
		source?: string;
	} = {},
): DiscoveredFile {
	return {
		absolutePath: `/root/${key}.ts`,
		key,
		varName: opts.varName ?? `_test_${key.replace(/\./g, "_")}`,
		importPath: opts.importPath ?? `../${key}`,
		exportType: opts.exportType ?? "default",
		namedExportName: opts.namedExportName,
		source: opts.source ?? `${key}.ts`,
	};
}

function makeModulesFile(): DiscoveredFile {
	return makeFile("modules", {
		varName: "_modules",
		importPath: "../modules",
		exportType: "default",
	});
}

/** Helper to create an empty DiscoveryResult with optional pre-initialized categories */
function emptyResult(categoryNames: string[] = []): DiscoveryResult {
	const categories = new Map<string, Map<string, DiscoveredFile>>();
	for (const name of categoryNames) {
		categories.set(name, new Map());
	}
	return {
		categories,
		singles: new Map(),
		spreads: new Map(),
	};
}

/**
 * Minimal result with modules.ts as a single.
 * Pre-initializes core category maps so tests can add files to them.
 */
function minimalResult(): DiscoveryResult {
	const result = emptyResult([
		"collections",
		"channels",
		"globals",
		"jobs",
		"routes",
		"messages",
		"services",
		"emails",
		"migrations",
		"seeds",
	]);
	result.singles.set("modules", makeModulesFile());
	return result;
}

/** Helper to get or create a category map */
function cat(
	result: DiscoveryResult,
	name: string,
): Map<string, DiscoveredFile> {
	let map = result.categories.get(name);
	if (!map) {
		map = new Map();
		result.categories.set(name, map);
	}
	return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error cases
// ─────────────────────────────────────────────────────────────────────────────

describe("generateTemplate — error cases", () => {
	it("throws when modules.ts is missing", () => {
		expect(() =>
			generateTemplate({
				configImportPath: "../questpie.config",
				discovered: emptyResult(),
			}),
		).toThrow(/modules\.ts is required/);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Minimal template
// ─────────────────────────────────────────────────────────────────────────────

describe("generateTemplate — minimal (modules.ts only)", () => {
	let code: string;

	code = generateTemplate({
		configImportPath: "../questpie.config",
		appInstanceId: "example:src/questpie/server",
		discovered: minimalResult(),
		categories: coreCategories(),
		singletonFactories: coreSingletonFactories(),
	});

	it("emits auto-generated header", () => {
		expect(code).toContain("AUTO-GENERATED by questpie codegen");
		expect(code).toContain("DO NOT EDIT");
	});

	it("imports singleton and fresh-app runtimes from questpie/app", () => {
		expect(code).toContain("acquireGeneratedApp, createContextFactory");
		expect(code).toContain('import { createApp } from "questpie/app"');
		expect(code).toContain('from "questpie/app"');
	});

	it("emits a singleton-free app-factory entrypoint", () => {
		const result = _generateTemplate({
			configImportPath: "../questpie.config",
			appInstanceId: "example:src/questpie/server",
			discovered: minimalResult(),
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});
		const factory = result.extraFiles.find(
			(file) => file.name === "app-factory.ts",
		);

		expect(factory).toBeDefined();
		expect(factory!.code).toContain(
			"export const createAppForRuntime = (async (runtime: RuntimeConfig)",
		);
		expect(factory!.code).not.toContain("acquireGeneratedApp");
		expect(factory!.code).not.toContain(
			'import _runtime from "../questpie.config"',
		);
		expect(result.code).toContain(
			'export { createAppForRuntime } from "./app-factory";',
		);
	});

	it("imports runtime config", () => {
		expect(code).toContain('import _runtime from "../questpie.config"');
	});

	it("imports modules file", () => {
		expect(code).toContain('import _modules from "../modules"');
	});

	it("imports zod types through questpie public types", () => {
		expect(code).toContain('TablesFromConfig, z } from "questpie/types";');
		expect(code).not.toContain('from "zod"');
	});

	it("collapses empty module prop categories to empty objects", () => {
		// _MP<K>/_MPRaw<K> were replaced by the validated ordered category fold.
		// For a minimal app
		// with NO module contributions these resolve to {} per category. The
		// `services` carrier is emitted as a literal {} (it cannot be folded —
		// its member values reach AppContext and re-introduce the cycle).
		expect(code).not.toContain("type _MP<");
		expect(code).not.toContain("_MPRaw<");
		expect(code).toContain(
			'export type _ModuleCollections = CodegenResolvedModulePropArr<typeof _modules, "collections">;',
		);
		expect(code).toContain(
			'export type _ModuleGlobals = CodegenResolvedModulePropArr<typeof _modules, "globals">;',
		);
		expect(code).toContain(
			'export type _ModuleJobs = CodegenResolvedModulePropArr<typeof _modules, "jobs">;',
		);
		expect(code).toContain("export type _ModuleServices = {};");
	});

	it("emits AppCollections type alias (no user collections)", () => {
		expect(code).toContain("export type AppCollections = _ModuleCollections;");
	});

	it("emits CollectionDoc helper from AppCollections", () => {
		expect(code).toContain(
			"export type CollectionDoc<K extends keyof AppCollections> = CollectionSelect<AppCollections[K]>;",
		);
	});

	it("emits CollectionWhere helper from AppCollections", () => {
		expect(code).toContain(
			"export type CollectionWhere<K extends keyof AppCollections> = Where<AppCollections[K], AppConfig>;",
		);
	});

	it("emits AppGlobals type alias (no user globals)", () => {
		expect(code).toContain("export type AppGlobals = _ModuleGlobals;");
	});

	it("emits channels in the app and client config types", () => {
		expect(code).toContain("export type AppChannels = _ModuleChannels;");
		expect(code).toContain("\tchannels: AppChannels;");
		expect(code).toContain("\tchannels: Channels<AppChannels>;");
		expect(code).toContain(
			'Omit<QuestpieConfig, "app" | "db" | "collections" | "channels"',
		);
	});

	it("emits AppJobs type alias (no user jobs)", () => {
		expect(code).toContain("export type AppJobs = _ModuleJobs;");
	});

	it("emits AppRoutes type alias (no user routes)", () => {
		expect(code).toContain("export type AppRoutes = _ModuleRoutes;");
	});

	it("emits declare global augmentation for AppContext", () => {
		expect(code).toContain("declare global {");
		expect(code).toContain("namespace Questpie {");
		expect(code).toContain("interface AppContext");
		expect(code).toContain("collections: _CollectionsAPI;");
	});

	it("emits AppConfig type without key-poisoning Record intersections", () => {
		expect(code).toContain("export type AppConfig = {");
		expect(code).toContain("\tcollections: AppCollections;");
		expect(code).toContain("\tglobals: AppGlobals;");
		// `& Record<string, …>` widens keyof to string — phantom collection
		// keys would silently compile on createClient<AppConfig>().
		expect(code).not.toContain(
			"collections: AppCollections & Record<string, AnyCollectionOrBuilder>;",
		);
		expect(code).toContain('storage: (typeof _runtime)["storage"];');
	});

	it("emits createApp call with modules", () => {
		expect(code).toContain(
			'acquireGeneratedApp("example:src/questpie/server", () => createAppForRuntime(_runtime))',
		);
		expect(code).toContain(
			"export const app = (await _appPromise) as unknown as _AppQuestpie;",
		);
		expect(code).toContain("modules: _modules,");
		expect(code).not.toContain("ModuleDefinition[]");
	});

	it("exports a typed fresh-app factory over the generated definition", () => {
		expect(code).toContain("const _appDefinition = ({");
		expect(code).toContain(
			"export const createAppForRuntime = (async (runtime: RuntimeConfig)",
		);
		expect(code).toContain("createApp(_appDefinition, runtime)");
		expect(code).toContain('readonly "~types"?: { session: AppSession };');
		expect(code).not.toContain("createAppForRuntime = acquireGeneratedApp");
	});

	it("shares one app instance across duplicated server bundle chunks", () => {
		expect(code).toContain(
			'acquireGeneratedApp("example:src/questpie/server", () => createAppForRuntime(_runtime))',
		);
		expect(code).toContain("var _appPromise = _appLease.promise;");
		expect(code).toContain("await _appLease.shutdown();");
		expect(code).toContain("_hot?.dispose(() => _appLease.release());");
		expect(code).not.toContain("_runtime.app.url");
	});

	it("derives session from auth config instead of typeof app", () => {
		expect(code).toContain("type _AppSession =");
		expect(code).toContain("InferSessionFromAuthConfig<_AppSessionAuthConfig>");
		expect(code).toContain("session: _AppSession;");
		expect(code).not.toContain("(typeof app)['auth']");
	});

	it("derives AppContext infrastructure and globals outside typeof app", () => {
		// _ModuleConfig was removed: with no appConfig single the app-config base
		// collapses to a literal {} (module-level app config now flows through the
		// flat _MPConfigSub fold, not a _ModuleConfig extends-arm).
		expect(code).toContain("type _AppAppConfig = {};");
		expect(code).toContain(
			"type _AppContextExtensions = Partial<InferContextExtensionsFromAppConfig<_AppAppConfig>>;",
		);
		expect(code).toContain(
			"type _AppCollectionDefinitions = AppCollections & Record<string, AnyCollectionOrBuilder>;",
		);
		expect(code).toContain(
			"type _AppGlobalDefinitions = AppGlobals & Record<string, AnyGlobalOrBuilder>;",
		);
		expect(code).toContain(
			"type _AppQuestpieBase = Questpie<_AppQuestpieConfig>;",
		);
		expect(code).toContain(
			'type _AppQuestpie = Omit<_AppQuestpieBase, "collections" | "globals">',
		);
		expect(code).toContain("type _AppQuestpieConfig = Omit<QuestpieConfig");
		expect(
			code.match(/storage: \(typeof _runtime\)\["storage"\];/g)?.length,
		).toBe(2);
		expect(code).toContain(
			"type _AppDb = DrizzleClientFromQuestpieConfig<_AppQuestpieConfig>;",
		);
		expect(code).toContain(
			'type _AppGlobalsAPI = _AppQuestpieBase["globals"];',
		);
		expect(code).toContain(
			"type _AppTables = TablesFromConfig<_AppQuestpieConfig>;",
		);
		expect(code).toContain("db: _AppDb;");
		expect(code).toContain('email: _AppQuestpie["email"];');
		expect(code).toContain("storage: _AppStorage;");
		expect(code).not.toContain("storage: unknown;");
		expect(code).toContain('kv: _AppQuestpie["kv"];');
		expect(code).toContain('logger: _AppQuestpie["logger"];');
		expect(code).toContain('search: _AppQuestpie["search"];');
		expect(code).toContain('realtime: _AppQuestpie["realtime"];');
		expect(code).toContain("globals: _AppGlobalsAPI;");
		expect(code).toContain("tables: _AppTables;");
		expect(code).not.toContain("(typeof app)['db']");
		expect(code).not.toContain("(typeof app)['email']");
		expect(code).not.toContain("(typeof app)['storage']");
		expect(code).not.toContain("(typeof app)['kv']");
		expect(code).not.toContain("(typeof app)['logger']");
		expect(code).not.toContain("(typeof app)['search']");
		expect(code).not.toContain("(typeof app)['realtime']");
		expect(code).not.toContain("(typeof app)['globals']");
		expect(code).not.toContain("(typeof app)['tables']");
	});

	it("extends AppContext with inferred app config context extensions", () => {
		expect(code).toContain(
			"interface AppContext extends _AppCoreContext, _AppTopLevelServices {",
		);
	});

	it("emits ContextResolverContext and the ~contextExtensions config phantom", () => {
		// Typed service surface for appConfig({ context }) resolvers
		expect(code).toContain("interface ContextResolverContext {");
		// Reuses computed aliases, excludes _AppContextExtensions (no self-reference)
		const resolverBlock = code.slice(
			code.indexOf("interface ContextResolverContext {"),
		);
		const resolverInterface = resolverBlock.slice(
			0,
			resolverBlock.indexOf("}"),
		);
		expect(resolverInterface).toContain("collections: _CollectionsAPI;");
		expect(resolverInterface).toContain("globals: _AppGlobalsAPI;");
		expect(resolverInterface).toContain("queue: QueueClient<AppJobs>;");
		expect(resolverInterface).not.toContain("_AppContextExtensions");

		// Phantom on the generated config powers getContext<App>() inference
		expect(code).toContain('"~contextExtensions": _AppContextExtensions;');
		expect(code).toContain('| "~contextExtensions">');
	});

	it("emits createContext helper", () => {
		expect(code).toContain("export async function createContext(");
		expect(code).toContain("return createContextFactory(app)(options);");
	});

	it("emits factory comment", () => {
		expect(code).toContain("Factories:");
	});

	it("does not emit migrations section when no migrations", () => {
		expect(code).not.toContain("migrations:");
	});

	it("does not emit seeds section when no seeds", () => {
		expect(code).not.toContain("seeds:");
	});
});

describe("generateFactoryTemplate — builder module augmentation", () => {
	it("augments questpie/builders with matching builder state constraints", () => {
		const target = serverTarget([
			{
				name: "test-builder-extensions",
				targets: {
					server: {
						root: ".",
						outputFile: "index.ts",
						registries: {
							collectionExtensions: {
								admin: {
									stateKey: "admin",
									configType: "AdminCollectionConfig<TState>",
									imports: [
										{
											name: "AdminCollectionConfig",
											from: "@questpie/admin/server",
										},
									],
								},
							},
							globalExtensions: {
								admin: {
									stateKey: "admin",
									configType: "AdminGlobalConfig<TState>",
									imports: [
										{
											name: "AdminGlobalConfig",
											from: "@questpie/admin/server",
										},
									],
								},
							},
							fieldExtensions: {
								admin: {
									stateKey: "admin",
									configType: "AdminFieldConfig<TState>",
									imports: [
										{
											name: "AdminFieldConfig",
											from: "@questpie/admin/server",
										},
									],
								},
							},
						},
					},
				},
			},
		]);

		const code = generateFactoryTemplate({
			target,
			hasModules: true,
		});

		expect(code).toContain('declare module "questpie/builders" {');
		expect(code).not.toContain('declare module "questpie" {');
		expect(code).toContain("type CollectionBuilderState");
		expect(code).toContain("type GlobalBuilderState");
		expect(code).toContain("type FieldState");
		// The augmentation's type parameter list must be IDENTICAL to the class
		// (name + constraint) — a renamed param (TState$1) breaks declaration
		// merging (TS2428) and makes the merged symbol two-generic (TS2314).
		expect(code).toContain(
			"interface CollectionBuilder<TState extends CollectionBuilderState>",
		);
		expect(code).not.toContain("TState$1");
		expect(code).toContain(
			"admin(config: AdminCollectionConfig<TState>): CollectionBuilder<TState>;",
		);
		expect(code).toContain(
			"interface GlobalBuilder<TState extends GlobalBuilderState>",
		);
		// TWO parameters. A one-parameter interface merges with the two-parameter
		// class without any TS error, so nothing here would go red — but every
		// merged proxy would then return `Field<TState, {}>` and silently drop
		// the field type's own methods.
		expect(code).toContain(
			"interface Field<TState extends FieldState = FieldState, TMethods = {}>",
		);
		// …and the proxies must hand the methods back, not truncate the chain.
		expect(code).toContain("): FieldWithMethods<TState, TMethods>;");
	});
});

describe("generateTemplate — registry dedupe", () => {
	it("emits ~fieldTypes exactly once when category and singleton both contribute", () => {
		const result = minimalResult();
		result.categories.set(
			"fieldTypes",
			new Map([
				[
					"color",
					makeFile("color", {
						varName: "_ftype_color",
						importPath: "../fields/color",
						exportType: "named",
						namedExportName: "colorField",
					}),
				],
			]),
		);
		result.singles.set(
			"fields",
			makeFile("fields", {
				varName: "_fields",
				importPath: "../fields",
			}),
		);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
			discoverPatterns: serverTarget().discover,
		});

		const fieldTypeLines = code
			.split("\n")
			.filter((line) => line.includes('"~fieldTypes":'));
		expect(fieldTypeLines).toEqual([
			'\t\t\t"~fieldTypes": _Registry_FieldTypes & _AllModuleFields;',
		]);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Collections
// ─────────────────────────────────────────────────────────────────────────────

describe("generateTemplate — collections", () => {
	it("emits named import for named export collection", () => {
		const result = minimalResult();
		cat(result, "collections").set(
			"posts",
			makeFile("posts", {
				varName: "_coll_posts",
				importPath: "../collections/posts",
				exportType: "named",
				namedExportName: "posts",
			}),
		);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		expect(code).toContain(
			'import { posts as _coll_posts } from "../collections/posts"',
		);
	});

	it("emits default import for default export collection", () => {
		const result = minimalResult();
		cat(result, "collections").set(
			"posts",
			makeFile("posts", {
				varName: "_coll_posts",
				importPath: "../collections/posts",
				exportType: "default",
			}),
		);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		expect(code).toContain('import _coll_posts from "../collections/posts"');
	});

	it("emits collections object in createApp", () => {
		const result = minimalResult();
		cat(result, "collections").set(
			"posts",
			makeFile("posts", {
				varName: "_coll_posts",
				exportType: "named",
				namedExportName: "posts",
			}),
		);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		expect(code).toContain("collections: {");
		expect(code).toContain("posts: _coll_posts,");
	});

	it("emits AppCollections type override when user collections exist", () => {
		const result = minimalResult();
		cat(result, "collections").set(
			"posts",
			makeFile("posts", {
				varName: "_coll_posts",
				exportType: "named",
				namedExportName: "posts",
			}),
		);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		// `collections` OVERRIDE-folds (not `&`-intersects) so a user app can
		// re-declare a module-contributed collection without detonating it to `never`.
		expect(code).toContain(
			"export type AppCollections = Override<_ModuleCollections, {",
		);
		expect(code).toContain("posts: typeof _coll_posts;");
	});

	// REGRESSION GUARD — do NOT "simplify" this back into one mapped type over
	// `_JobHandlerCollections`. That form is what shipped in #167 and it made
	// `collections.<local>` unresolvable (TS2339) inside any job handler that
	// returns a value, in any app whose collection hooks bind `queue`.
	// `resolveMappedTypeMembers` evaluates the template against an EMPTY member
	// table; the template reaches `AppJobs` → `typeof _job_*` → return-type
	// inference → `collections.<local>` against that empty table. The
	// intersection form is resolved by `getPropertyOfType` walking constituents,
	// which finds the local key without evaluating the mapped half at all.
	it("emits job handler collection APIs as module-mapped ∩ explicit local", () => {
		const result = minimalResult();
		cat(result, "collections").set(
			"posts",
			makeFile("posts", {
				varName: "_coll_posts",
				exportType: "named",
				namedExportName: "posts",
			}),
		);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		// Module collections stay mapped — they come from `typeof _modules`, not
		// from the user job path, so they never re-enter the empty window.
		expect(code).toContain(
			"type _JobHandlerCollectionsAPI = { [K in keyof _ModuleCollections]: CollectionAPI<_ModuleCollections[K], _JobHandlerCollections> } & {",
		);
		// Local collections must be explicit members. This assertion is the whole
		// point of the test — see the comment above it.
		expect(code).toContain(
			"posts: CollectionAPI<typeof _coll_posts, _JobHandlerCollections>;",
		);
		expect(code).not.toContain(
			"[K in keyof _JobHandlerCollections]: CollectionAPI<_JobHandlerCollections[K]",
		);
	});

	it("emits multiple collections sorted alphabetically", () => {
		const result = minimalResult();
		cat(result, "collections").set(
			"users",
			makeFile("users", {
				varName: "_coll_users",
				exportType: "named",
				namedExportName: "users",
			}),
		);
		cat(result, "collections").set(
			"posts",
			makeFile("posts", {
				varName: "_coll_posts",
				exportType: "named",
				namedExportName: "posts",
			}),
		);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		const postsIdx = code.indexOf("posts: _coll_posts,");
		const usersIdx = code.indexOf("users: _coll_users,");
		expect(postsIdx).toBeLessThan(usersIdx);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Globals
// ─────────────────────────────────────────────────────────────────────────────

describe("generateTemplate — globals", () => {
	it("emits globals object in createApp", () => {
		const result = minimalResult();
		cat(result, "globals").set(
			"siteSettings",
			makeFile("siteSettings", {
				varName: "_glob_siteSettings",
				exportType: "named",
				namedExportName: "siteSettings",
			}),
		);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		expect(code).toContain("globals: {");
		expect(code).toContain("siteSettings: _glob_siteSettings,");
		expect(code).toContain(
			"export type AppGlobals = Override<_ModuleGlobals, {",
		);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Migrations — flat array
// ─────────────────────────────────────────────────────────────────────────────

describe("generateTemplate — migrations", () => {
	it("emits migrations as flat array in createApp", () => {
		const result = minimalResult();
		cat(result, "migrations").set(
			"001Init",
			makeFile("001Init", { varName: "_mig_001Init", exportType: "default" }),
		);
		cat(result, "migrations").set(
			"002AddUsers",
			makeFile("002AddUsers", {
				varName: "_mig_002AddUsers",
				exportType: "default",
			}),
		);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		// Flat array (sorted alphabetically by key: 001Init < 002AddUsers)
		expect(code).toContain("migrations: [_mig_001Init, _mig_002AddUsers],");
	});

	it("emits migration imports", () => {
		const result = minimalResult();
		cat(result, "migrations").set(
			"001Init",
			makeFile("001Init", {
				varName: "_mig_001Init",
				importPath: "../migrations/001-init",
				exportType: "default",
			}),
		);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		expect(code).toContain('import _mig_001Init from "../migrations/001-init"');
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Seeds — flat array
// ─────────────────────────────────────────────────────────────────────────────

describe("generateTemplate — seeds", () => {
	it("emits seeds as flat array in createApp", () => {
		const result = minimalResult();
		cat(result, "seeds").set(
			"demoData",
			makeFile("demoData", {
				varName: "_seed_demoData",
				exportType: "default",
			}),
		);
		cat(result, "seeds").set(
			"siteSettings",
			makeFile("siteSettings", {
				varName: "_seed_siteSettings",
				exportType: "default",
			}),
		);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		// Flat array (sorted: demoData < siteSettings)
		expect(code).toContain("seeds: [_seed_demoData, _seed_siteSettings],");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Services
// ─────────────────────────────────────────────────────────────────────────────

describe("generateTemplate — services", () => {
	it("imports ServiceInstanceOf type utility", () => {
		const result = minimalResult();
		cat(result, "services").set(
			"stripe",
			makeFile("stripe", {
				varName: "_svc_stripe",
				exportType: "named",
				namedExportName: "stripe",
			}),
		);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		expect(code).toContain("ServiceInstanceOf");
	});

	it("emits services in AppServices type", () => {
		const result = minimalResult();
		cat(result, "services").set(
			"stripe",
			makeFile("stripe", {
				varName: "_svc_stripe",
				exportType: "named",
				namedExportName: "stripe",
			}),
		);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		expect(code).toContain(
			"type _AppServiceDefinitions = Override<_ModuleServices, {",
		);
		expect(code).toContain("stripe: typeof _svc_stripe;");
		expect(code).toContain(
			"[K in keyof _AppServiceDefinitions]: ServiceInstanceOf<_AppServiceDefinitions[K]>;",
		);
	});

	it("emits namespace-aware service context helpers", () => {
		const result = minimalResult();
		cat(result, "services").set(
			"stripe",
			makeFile("stripe", {
				varName: "_svc_stripe",
				exportType: "named",
				namedExportName: "stripe",
			}),
		);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		expect(code).toContain(
			"type _AppTopLevelServices = ServiceTopLevelInstances<_AppServiceDefinitions>;",
		);
		expect(code).toContain(
			"type _AppCustomServiceNamespaces = ServiceCustomNamespaceInstances<_AppServiceDefinitions>;",
		);
		expect(code).toContain(
			"interface AppContext extends _AppCoreContext, _AppTopLevelServices {",
		);
		// OUTER AppContext keeps the namespace-filtered whole-fold (unchanged).
		expect(code).toContain("services: _AppDefaultServices;");

		// §2.2 cycle break — ServiceCreateContext is DECOUPLED from the inline
		// service folds. It reads `services` from the by-name `Questpie.Services`
		// interface (extends the FLAT, definition-keyed `_AppServicesSeam`) via
		// `_ServiceCreateInfra`, rebuilt off the fold-free `_AppInfraRecord`. A
		// service whose inferred instance eager-reads `ctx.services` no longer
		// forces the whole fold while the fold is being computed (TS2456).
		expect(code).toContain(
			"export type _AppServicesSeam = { [K in keyof _AppServiceDefinitions]: ServiceInstanceOf<_AppServiceDefinitions[K]> };",
		);
		expect(code).toContain("type _AppInfraRecord = {");
		expect(code).toContain(
			"type _AppInfraContext = _AppInfraRecord & _AppCustomServiceNamespaces;",
		);
		expect(code).toContain(
			'type _ServiceCreateInfra = Omit<_AppInfraRecord, "services"> & { services: Questpie.Services };',
		);
		expect(code).toContain("interface Services extends _AppServicesSeam {}");
		expect(code).toContain(
			"interface ServiceCreateContext extends _AppContextExtensions, _ServiceCreateInfra {}",
		);
		// The OLD inline-fold base must be GONE (the cyclic edge).
		expect(code).not.toContain(
			"interface ServiceCreateContext extends _AppCoreContext {}",
		);
	});

	it("guards workflows service access without indexed conditional access", () => {
		const result = minimalResult();
		cat(result, "services").set(
			"stripe",
			makeFile("stripe", {
				varName: "_svc_stripe",
				exportType: "named",
				namedExportName: "stripe",
			}),
		);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		expect(code).toContain(
			"workflows?: _AppTopLevelServices extends { workflows: infer W } ? W : never;",
		);
		expect(code).not.toContain(
			'"workflows" extends keyof _AppTopLevelServices ? _AppTopLevelServices["workflows"] : never',
		);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Emails
// ─────────────────────────────────────────────────────────────────────────────

describe("generateTemplate — emails", () => {
	it("emits MailerService import and typed email contexts", () => {
		const result = minimalResult();
		cat(result, "emails").set(
			"welcome",
			makeFile("welcome", { varName: "_email_welcome", exportType: "default" }),
		);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		expect(code).toContain("MailerService, Principal, Questpie");
		expect(code.match(/\bMailerService\b/g)?.length).toBe(4);
	});

	it("emits email: MailerService<AppEmailTemplates> in AppContext", () => {
		const result = minimalResult();
		cat(result, "emails").set(
			"welcome",
			makeFile("welcome", { varName: "_email_welcome", exportType: "default" }),
		);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		expect(code).toContain("email: MailerService<AppEmailTemplates>;");
	});

	it("emits emailTemplates object in createApp", () => {
		const result = minimalResult();
		cat(result, "emails").set(
			"welcome",
			makeFile("welcome", { varName: "_email_welcome", exportType: "default" }),
		);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		expect(code).toContain("emailTemplates: {");
		expect(code).toContain("welcome: _email_welcome,");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Routes — flat record with slash-separated keys
// ─────────────────────────────────────────────────────────────────────────────

describe("generateTemplate — routes (flat record)", () => {
	it("emits AppRoutes entries with params inferred from route keys", () => {
		const result = minimalResult();
		cat(result, "routes").set(
			"apps/[appId]/install",
			makeFile("apps/[appId]/install", {
				varName: "_route_apps_appId_install",
				exportType: "default",
			}),
		);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		expect(code).toContain("type AppRoutes = Override<_ModuleRoutes, {");
		expect(code).toContain(
			'"apps/[appId]/install": RouteWithParams<_RouteDefinitionWithoutHandler<typeof _route_apps_appId_install>, RouteParamsFromKey<"apps/[appId]/install">>;',
		);
	});

	it("emits flat route as direct key", () => {
		const result = minimalResult();
		cat(result, "routes").set(
			"ping",
			makeFile("ping", { varName: "_route_ping", exportType: "default" }),
		);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		expect(code).toContain("routes: {");
		expect(code).toContain("ping: _route_ping,");
	});

	it("emits slash-separated route key as quoted string key", () => {
		const result = minimalResult();
		cat(result, "routes").set(
			"admin/stats",
			makeFile("admin/stats", {
				varName: "_route_admin_stats",
				exportType: "default",
			}),
		);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		expect(code).toContain("routes: {");
		expect(code).toContain('"admin/stats": _route_admin_stats,');
	});

	it("emits multiple routes as flat record entries", () => {
		const result = minimalResult();
		cat(result, "routes").set(
			"admin/stats",
			makeFile("admin/stats", {
				varName: "_route_admin_stats",
				exportType: "default",
			}),
		);
		cat(result, "routes").set(
			"admin/users",
			makeFile("admin/users", {
				varName: "_route_admin_users",
				exportType: "default",
			}),
		);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		expect(code).toContain('"admin/stats": _route_admin_stats,');
		expect(code).toContain('"admin/users": _route_admin_users,');
	});
});

describe("generateTemplate — app config context", () => {
	it("derives app context extensions from config/app.ts", () => {
		const result = minimalResult();
		result.singles.set(
			"appConfig",
			makeFile("appConfig", {
				varName: "_appConfig",
				importPath: "../config/app",
				exportType: "default",
			}),
		);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		expect(code).toContain("type _AppAppConfig = typeof _appConfig;");
		expect(code).toContain(
			"type _AppContextExtensions = Partial<InferContextExtensionsFromAppConfig<_AppAppConfig>>;",
		);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────────────

describe("generateTemplate — auth", () => {
	it("emits auth import and includes it in createApp and AppConfig", () => {
		const result = minimalResult();
		result.singles.set(
			"auth",
			makeFile("auth", {
				varName: "_auth",
				importPath: "../auth",
				exportType: "default",
			}),
		);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		expect(code).toContain('import _auth from "../auth"');
		expect(code).toContain("auth: _auth,");
		expect(code).toContain("auth: AppAuthConfig;");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Plugin singles (sidebar, dashboard, branding)
// ─────────────────────────────────────────────────────────────────────────────

describe("generateTemplate — plugin singles", () => {
	it("emits plugin singles in createApp", () => {
		const result = minimalResult();
		result.singles.set(
			"sidebar",
			makeFile("sidebar", {
				varName: "_sidebar",
				importPath: "../sidebar",
				exportType: "default",
			}),
		);
		result.singles.set(
			"branding",
			makeFile("branding", {
				varName: "_branding",
				importPath: "../branding",
				exportType: "default",
			}),
		);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		expect(code).toContain('import _sidebar from "../sidebar"');
		expect(code).toContain("sidebar: _sidebar,");
		expect(code).toContain("branding: _branding,");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Core singles (locale, hooks, access)
// ─────────────────────────────────────────────────────────────────────────────

describe("generateTemplate — core singles", () => {
	it("emits locale single in createApp", () => {
		const result = minimalResult();
		result.singles.set(
			"locale",
			makeFile("locale", {
				varName: "_locale",
				importPath: "../locale",
				exportType: "default",
			}),
		);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		expect(code).toContain("locale: _locale,");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Spreads (mergeStrategy: "spread")
// ─────────────────────────────────────────────────────────────────────────────

describe("generateTemplate — spreads", () => {
	function makeSpreadResult(files: DiscoveredFile[]): DiscoveryResult {
		const result = minimalResult();
		result.spreads.set("sidebar", files);
		return result;
	}

	it("imports all spread files", () => {
		const result = makeSpreadResult([
			makeFile("sidebar", {
				varName: "_sidebar_root",
				importPath: "../sidebar",
				exportType: "default",
			}),
			makeFile("sidebar", {
				varName: "_sidebar_admin",
				importPath: "../features/admin/sidebar",
				exportType: "default",
			}),
		]);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		expect(code).toContain('import _sidebar_root from "../sidebar"');
		expect(code).toContain(
			'import _sidebar_admin from "../features/admin/sidebar"',
		);
	});

	it("emits spread array in createApp", () => {
		const result = makeSpreadResult([
			makeFile("sidebar", { varName: "_sidebar_root", exportType: "default" }),
			makeFile("sidebar", { varName: "_sidebar_admin", exportType: "default" }),
		]);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		expect(code).toContain(
			"sidebar: [...(_sidebar_root ?? []), ...(_sidebar_admin ?? [])],",
		);
	});

	it("emits a single-item spread array when only root file exists", () => {
		const result = makeSpreadResult([
			makeFile("sidebar", { varName: "_sidebar_root", exportType: "default" }),
		]);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		expect(code).toContain("sidebar: [...(_sidebar_root ?? [])],");
	});

	it("emits _Module<Key> type for module contributions", () => {
		const result = makeSpreadResult([
			makeFile("sidebar", { varName: "_sidebar_root", exportType: "default" }),
		]);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		// Spread values concatenate at runtime, so they retain the additive fold
		// rather than the record-category last-wins fold.
		expect(code).toContain(
			'export type _ModuleSidebar = ExtractModulePropArr<typeof _modules, "sidebar">;',
		);
		expect(code).not.toContain('_MP<"sidebar">');
	});

	it("does not put spread keys into singles or plugin singles section", () => {
		const result = makeSpreadResult([
			makeFile("sidebar", { varName: "_sidebar_root", exportType: "default" }),
		]);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		// Spread singles should not appear as plain singles.
		expect(code).not.toContain("sidebar: _sidebar_root,");
	});

	it("emits spread section label in imports", () => {
		const result = makeSpreadResult([
			makeFile("sidebar", { varName: "_sidebar_root", exportType: "default" }),
		]);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		expect(code).toContain("Sidebar (spread)");
	});

	it("supports multiple spread keys", () => {
		const result = minimalResult();
		result.spreads.set("sidebar", [
			makeFile("sidebar", { varName: "_sidebar_root", exportType: "default" }),
		]);
		result.spreads.set("dashboard", [
			makeFile("dashboard", {
				varName: "_dashboard_root",
				exportType: "default",
			}),
			makeFile("dashboard", {
				varName: "_dashboard_admin",
				exportType: "default",
			}),
		]);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		expect(code).toContain("sidebar: [...(_sidebar_root ?? [])],");
		expect(code).toContain(
			"dashboard: [...(_dashboard_root ?? []), ...(_dashboard_admin ?? [])],",
		);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Plugin factory re-exports
// ─────────────────────────────────────────────────────────────────────────────

describe("generateTemplate — factory re-exports", () => {
	it("includes factory comment in output", () => {
		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: minimalResult(),
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
		});

		// Factory re-exports are now emitted as a comment
		expect(code).toContain("Factories:");
		expect(code).toContain("collection");
		expect(code).toContain("global");
	});

	it("generates valid code with plugin singleton factories", () => {
		const adminPlugin: CodegenPlugin = {
			name: "admin",
			targets: {
				server: {
					root: ".",
					outputFile: "index.ts",
					registries: {
						singletonFactories: {
							branding: {
								configType: "BrandingConfig",
								imports: [],
							},
						},
					},
				},
			},
		};
		const target = serverTarget([adminPlugin]);

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: minimalResult(),
			categories: target.categories,
			singletonFactories: target.registries.singletonFactories,
		});

		// Template still generates valid output
		expect(code).toContain("createApp");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Multi-target (runAllTargets)
// ─────────────────────────────────────────────────────────────────────────────

describe("runAllTargets", () => {
	it("generates the server target by default (single target)", async () => {
		const { mkdtemp, writeFile, mkdir } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");

		// Create a temp directory with a minimal setup
		const dir = await mkdtemp(join(tmpdir(), "codegen-multi-"));
		const configPath = join(dir, "questpie.config.ts");
		await writeFile(
			configPath,
			'export default { app: { url: "http://localhost" }, db: { url: "sqlite://:memory:" } };',
		);
		// Create a modules.ts
		await writeFile(join(dir, "modules.ts"), "export default [];");

		const result = await runAllTargets({
			rootDir: dir,
			configPath,
			plugins: [],
		});

		expect(result.targets.size).toBe(1);
		expect(result.targets.has("server")).toBe(true);
		expect(result.errors.length).toBe(0);

		const serverResult = result.targets.get("server")!;
		expect(serverResult.targetId).toBe("server");
		expect(serverResult.code).toContain("createApp");
		expect(serverResult.outputPath).toContain(".generated");
	});

	it("runs custom generator for non-default targets", async () => {
		const { mkdtemp, writeFile } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");

		const dir = await mkdtemp(join(tmpdir(), "codegen-custom-"));
		const configPath = join(dir, "questpie.config.ts");
		await writeFile(
			configPath,
			'export default { app: { url: "http://localhost" }, db: { url: "sqlite://:memory:" } };',
		);
		await writeFile(join(dir, "modules.ts"), "export default [];");

		// Create a plugin with a custom target that has a generator
		const customPlugin: CodegenPlugin = {
			name: "test-custom",
			targets: {
				"custom-target": {
					root: ".",
					// Its own directory. Sharing .generated with the server target
					// would mean one erases the other.
					outDir: ".generated-custom",
					outputFile: "custom.ts",
					generate: async ({ target, discovered }) => {
						return {
							code: `// Custom target: ${target.id}\n// Categories: ${discovered.categories.size}\nexport const custom = true;\n`,
						};
					},
				},
			},
		};

		const result = await runAllTargets({
			rootDir: dir,
			configPath,
			plugins: [customPlugin],
		});

		expect(result.targets.size).toBe(2);
		expect(result.targets.has("server")).toBe(true);
		expect(result.targets.has("custom-target")).toBe(true);
		expect(result.errors.length).toBe(0);

		const customResult = result.targets.get("custom-target")!;
		expect(customResult.targetId).toBe("custom-target");
		expect(customResult.code).toContain("Custom target: custom-target");
		expect(customResult.code).toContain("export const custom = true;");
	});

	it("runs the target generator in module mode too", async () => {
		const { mkdtemp, writeFile } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");

		const dir = await mkdtemp(join(tmpdir(), "codegen-custom-module-"));
		const configPath = join(dir, "questpie.config.ts");
		await writeFile(configPath, "export default {};");

		let sawModuleName: string | undefined;
		const customPlugin: CodegenPlugin = {
			name: "test-custom",
			targets: {
				"custom-target": {
					root: ".",
					outDir: ".generated-custom",
					outputFile: "custom.ts",
					generate: ({ module }) => {
						sawModuleName = module?.name;
						return { code: `export const name = "${module?.name}";\n` };
					},
				},
			},
		};

		const result = await runCodegen({
			rootDir: dir,
			configPath,
			outDir: join(dir, ".generated-custom"),
			plugins: [customPlugin],
			targetId: "custom-target",
			module: { name: "questpie-custom" },
			dryRun: true,
		});

		expect(sawModuleName).toBe("questpie-custom");
		expect(result.code).toContain('export const name = "questpie-custom";');
		// A module is written as module.ts, not as the target's app output file.
		expect(result.outputPath.endsWith("module.ts")).toBe(true);
	});

	it("names the config file in the regenerate header", async () => {
		const { mkdtemp, writeFile, mkdir } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");

		const dir = await mkdtemp(join(tmpdir(), "codegen-header-"));
		await writeFile(join(dir, "package.json"), '{ "name": "header-fixture" }');
		const serverDir = join(dir, "server");
		await mkdir(serverDir, { recursive: true });
		const configPath = join(serverDir, "questpie.config.ts");
		await writeFile(
			configPath,
			'export default { app: { url: "http://localhost" }, db: { url: "sqlite://:memory:" } };',
		);
		await writeFile(join(serverDir, "modules.ts"), "export default [];");

		const result = await runAllTargets({
			rootDir: serverDir,
			configPath,
			plugins: [],
			dryRun: true,
		});

		expect(result.targets.get("server")!.code).toContain(
			"// Regenerate with: questpie generate -c server/questpie.config.ts",
		);
	});

	it("reports errors per target without failing other targets", async () => {
		const { mkdtemp, writeFile } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");

		const dir = await mkdtemp(join(tmpdir(), "codegen-err-"));
		const configPath = join(dir, "questpie.config.ts");
		await writeFile(
			configPath,
			'export default { app: { url: "http://localhost" }, db: { url: "sqlite://:memory:" } };',
		);
		await writeFile(join(dir, "modules.ts"), "export default [];");

		// Plugin with a target that throws during generation
		const failingPlugin: CodegenPlugin = {
			name: "test-failing",
			targets: {
				"failing-target": {
					root: ".",
					outDir: ".generated-fail",
					outputFile: "fail.ts",
					generate: async () => {
						throw new Error("Intentional test failure");
					},
				},
			},
		};

		const result = await runAllTargets({
			rootDir: dir,
			configPath,
			plugins: [failingPlugin],
		});

		// Server should succeed, failing-target should error
		expect(result.targets.has("server")).toBe(true);
		expect(result.targets.has("failing-target")).toBe(false);
		expect(result.errors.length).toBe(1);
		expect(result.errors[0].targetId).toBe("failing-target");
		expect(result.errors[0].error.message).toBe("Intentional test failure");
	});

	it("generates admin-client target with discovered blocks", async () => {
		const { mkdtemp, writeFile, mkdir } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");

		// Create temp dir simulating project layout:
		// server/ — server root
		// admin/  — admin client root (sibling)
		const dir = await mkdtemp(join(tmpdir(), "codegen-admin-client-"));
		const serverDir = join(dir, "server");
		const adminDir = join(dir, "admin");
		await mkdir(serverDir, { recursive: true });
		await mkdir(join(adminDir, "blocks"), { recursive: true });

		// Create server config + modules
		const configPath = join(serverDir, "questpie.config.ts");
		await writeFile(
			configPath,
			'export default { app: { url: "http://localhost" }, db: { url: "sqlite://:memory:" } };',
		);
		await writeFile(join(serverDir, "modules.ts"), "export default [];");

		// Create a block renderer in admin/blocks/
		await writeFile(
			join(adminDir, "blocks", "hero.tsx"),
			"export default function HeroBlock() { return null; }",
		);
		await writeFile(
			join(adminDir, "blocks", "cta.tsx"),
			"export default function CTABlock() { return null; }",
		);

		// Plugin that mimics the admin-client target structure
		const adminClientPlugin: CodegenPlugin = {
			name: "test-admin-client",
			targets: {
				"admin-client": {
					root: "../admin",
					outputFile: "client.ts",
					categories: {
						blocks: {
							dirs: ["blocks"],
							prefix: "block",
							registryKey: false,
							includeInAppState: false,
							extractFromModules: false,
						},
					},
					generate: async ({ target, discovered }) => {
						const blocks = discovered.categories.get("blocks");
						const lines = [
							"// Generated admin client config",
							'import { coreAdminModule } from "@questpie/admin/client";',
							"",
						];

						if (blocks && blocks.size > 0) {
							for (const file of blocks.values()) {
								lines.push(`import ${file.varName} from "${file.importPath}";`);
							}
							lines.push("");

							const entries = [...blocks.values()]
								.sort((a, b) => a.key.localeCompare(b.key))
								.map((f) => `\t${JSON.stringify(f.key)}: ${f.varName},`);
							lines.push("const _admin = coreAdminModule.blocks({");
							lines.push(...entries);
							lines.push("});");
						} else {
							lines.push("const _admin = coreAdminModule;");
						}

						lines.push("");
						lines.push("export default _admin;");
						lines.push("");

						return { code: lines.join("\n") };
					},
				},
			},
		};

		const result = await runAllTargets({
			rootDir: serverDir,
			configPath,
			plugins: [adminClientPlugin],
		});

		expect(result.targets.size).toBe(2);
		expect(result.targets.has("server")).toBe(true);
		expect(result.targets.has("admin-client")).toBe(true);
		expect(result.errors.length).toBe(0);

		const adminResult = result.targets.get("admin-client")!;
		expect(adminResult.targetId).toBe("admin-client");
		expect(adminResult.code).toContain("coreAdminModule");
		expect(adminResult.code).toContain('"cta"');
		expect(adminResult.code).toContain('"hero"');
		expect(adminResult.outputPath).toContain("admin");
		expect(adminResult.outputPath).toContain(".generated");
		expect(adminResult.outputPath).toContain("client.ts");
	});

	it("returns empty validationErrors when no validators registered", async () => {
		const { mkdtemp, writeFile } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");

		const dir = await mkdtemp(join(tmpdir(), "codegen-noval-"));
		const configPath = join(dir, "questpie.config.ts");
		await writeFile(
			configPath,
			'export default { app: { url: "http://localhost" }, db: { url: "sqlite://:memory:" } };',
		);
		await writeFile(join(dir, "modules.ts"), "export default [];");

		const result = await runAllTargets({
			rootDir: dir,
			configPath,
			plugins: [],
		});

		expect(result.validationErrors).toEqual([]);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Cross-target projection validators
// ─────────────────────────────────────────────────────────────────────────────

describe("cross-target projection validators", () => {
	/**
	 * Helper: create a minimal CodegenResult with specified category files.
	 */
	function makeFakeResult(
		targetId: string,
		categories: Record<string, string[]>,
	): CodegenResult {
		const catMap = new Map<string, Map<string, DiscoveredFile>>();
		for (const [catName, keys] of Object.entries(categories)) {
			const fileMap = new Map<string, DiscoveredFile>();
			for (const key of keys) {
				fileMap.set(
					key,
					makeFile(key, {
						varName: `_${catName}_${key}`,
						importPath: `../${catName}/${key}`,
						exportType: "default",
					}),
				);
			}
			catMap.set(catName, fileMap);
		}

		return {
			targetId,
			code: "// fake",
			outputPath: `/fake/.generated/${targetId}.ts`,
			discovered: {
				categories: catMap,
				singles: new Map(),
				spreads: new Map(),
			},
		};
	}

	/**
	 * Simple projection validator for testing — checks that server "blocks"
	 * keys all exist in admin-client "blocks" keys.
	 */
	const testBlocksValidator: CrossTargetValidator = (targets) => {
		const server = targets.get("server");
		const client = targets.get("admin-client");
		if (!server || !client) return [];

		const errors: import("../../src/cli/codegen/types.js").ProjectionError[] =
			[];
		const serverBlocks = server.discovered.categories.get("blocks");
		const clientBlocks = client.discovered.categories.get("blocks");

		if (!serverBlocks) return [];
		const clientKeys = new Set(clientBlocks?.keys() ?? []);

		for (const [key, file] of serverBlocks) {
			if (!clientKeys.has(key)) {
				errors.push({
					severity: "error",
					category: "blocks",
					key,
					sourceTarget: "server",
					consumerTarget: "admin-client",
					message: `Server block "${key}" has no admin client renderer. Create admin/blocks/${key}.tsx`,
				});
			}
		}
		return errors;
	};

	it("reports no errors when server and client blocks match", async () => {
		const { mkdtemp, writeFile, mkdir } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");

		const dir = await mkdtemp(join(tmpdir(), "codegen-proj-ok-"));
		const serverDir = join(dir, "server");
		const adminDir = join(dir, "admin");
		await mkdir(join(serverDir, "blocks"), { recursive: true });
		await mkdir(join(adminDir, "blocks"), { recursive: true });

		const configPath = join(serverDir, "questpie.config.ts");
		await writeFile(
			configPath,
			'export default { app: { url: "http://localhost" }, db: { url: "sqlite://:memory:" } };',
		);
		await writeFile(join(serverDir, "modules.ts"), "export default [];");

		// Both server and client have "hero" block
		await writeFile(
			join(serverDir, "blocks", "hero.ts"),
			"export default { name: 'hero' };",
		);
		await writeFile(
			join(adminDir, "blocks", "hero.tsx"),
			"export default function HeroBlock() { return null; }",
		);

		const plugin: CodegenPlugin = {
			name: "test-proj",
			validators: [testBlocksValidator],
			targets: {
				server: {
					root: ".",
					outputFile: "index.ts",
					discover: {
						blocks: "blocks/*.ts",
					},
				},
				"admin-client": {
					root: "../admin",
					outputFile: "client.ts",
					categories: {
						blocks: {
							dirs: ["blocks"],
							prefix: "block",
							registryKey: false,
							includeInAppState: false,
							extractFromModules: false,
						},
					},
					generate: async () => ({ code: "// ok" }),
				},
			},
		};

		const result = await runAllTargets({
			rootDir: serverDir,
			configPath,
			plugins: [plugin],
		});

		expect(result.validationErrors).toEqual([]);
	});

	it("reports errors when server blocks have no admin client counterpart", async () => {
		const { mkdtemp, writeFile, mkdir } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");

		const dir = await mkdtemp(join(tmpdir(), "codegen-proj-fail-"));
		const serverDir = join(dir, "server");
		const adminDir = join(dir, "admin");
		await mkdir(join(serverDir, "blocks"), { recursive: true });
		await mkdir(join(adminDir, "blocks"), { recursive: true });

		const configPath = join(serverDir, "questpie.config.ts");
		await writeFile(
			configPath,
			'export default { app: { url: "http://localhost" }, db: { url: "sqlite://:memory:" } };',
		);
		await writeFile(join(serverDir, "modules.ts"), "export default [];");

		// Server has "hero" and "gallery" blocks, client only has "hero"
		await writeFile(
			join(serverDir, "blocks", "hero.ts"),
			"export default { name: 'hero' };",
		);
		await writeFile(
			join(serverDir, "blocks", "gallery.ts"),
			"export default { name: 'gallery' };",
		);
		await writeFile(
			join(adminDir, "blocks", "hero.tsx"),
			"export default function HeroBlock() { return null; }",
		);

		const plugin: CodegenPlugin = {
			name: "test-proj-fail",
			validators: [testBlocksValidator],
			targets: {
				server: {
					root: ".",
					outputFile: "index.ts",
					discover: {
						blocks: "blocks/*.ts",
					},
				},
				"admin-client": {
					root: "../admin",
					outputFile: "client.ts",
					categories: {
						blocks: {
							dirs: ["blocks"],
							prefix: "block",
							registryKey: false,
							includeInAppState: false,
							extractFromModules: false,
						},
					},
					generate: async () => ({ code: "// ok" }),
				},
			},
		};

		const result = await runAllTargets({
			rootDir: serverDir,
			configPath,
			plugins: [plugin],
		});

		expect(result.validationErrors.length).toBe(1);
		expect(result.validationErrors[0].severity).toBe("error");
		expect(result.validationErrors[0].category).toBe("blocks");
		expect(result.validationErrors[0].key).toBe("gallery");
		expect(result.validationErrors[0].sourceTarget).toBe("server");
		expect(result.validationErrors[0].consumerTarget).toBe("admin-client");
		expect(result.validationErrors[0].message).toContain("gallery");
	});

	it("reports multiple validation errors from multiple categories", async () => {
		const { mkdtemp, writeFile, mkdir } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");

		const dir = await mkdtemp(join(tmpdir(), "codegen-proj-multi-"));
		const serverDir = join(dir, "server");
		const adminDir = join(dir, "admin");
		await mkdir(join(serverDir, "blocks"), { recursive: true });
		await mkdir(join(serverDir, "components"), { recursive: true });
		await mkdir(join(adminDir, "blocks"), { recursive: true });
		// Note: no admin/components/ directory

		const configPath = join(serverDir, "questpie.config.ts");
		await writeFile(
			configPath,
			'export default { app: { url: "http://localhost" }, db: { url: "sqlite://:memory:" } };',
		);
		await writeFile(join(serverDir, "modules.ts"), "export default [];");

		// Server has blocks and components, client has neither
		await writeFile(
			join(serverDir, "blocks", "hero.ts"),
			"export default { name: 'hero' };",
		);
		await writeFile(
			join(serverDir, "components", "rating.ts"),
			"export default { name: 'rating' };",
		);

		// Validator for both blocks and components
		const multiValidator: CrossTargetValidator = (targets) => {
			const server = targets.get("server");
			const client = targets.get("admin-client");
			if (!server || !client) return [];

			const errors: import("../../src/cli/codegen/types.js").ProjectionError[] =
				[];
			for (const cat of ["blocks", "components"]) {
				const serverFiles = server.discovered.categories.get(cat);
				const clientFiles = client.discovered.categories.get(cat);
				if (!serverFiles) continue;
				const clientKeys = new Set(clientFiles?.keys() ?? []);
				for (const [key] of serverFiles) {
					if (!clientKeys.has(key)) {
						errors.push({
							severity: "error",
							category: cat,
							key,
							sourceTarget: "server",
							consumerTarget: "admin-client",
							message: `Missing ${cat}/${key}`,
						});
					}
				}
			}
			return errors;
		};

		const plugin: CodegenPlugin = {
			name: "test-multi-val",
			validators: [multiValidator],
			targets: {
				server: {
					root: ".",
					outputFile: "index.ts",
					discover: {
						blocks: "blocks/*.ts",
						components: "components/*.ts",
					},
				},
				"admin-client": {
					root: "../admin",
					outputFile: "client.ts",
					categories: {
						blocks: {
							dirs: ["blocks"],
							prefix: "block",
							registryKey: false,
							includeInAppState: false,
							extractFromModules: false,
						},
						components: {
							dirs: ["components"],
							prefix: "comp",
							registryKey: false,
							includeInAppState: false,
							extractFromModules: false,
						},
					},
					generate: async () => ({ code: "// ok" }),
				},
			},
		};

		const result = await runAllTargets({
			rootDir: serverDir,
			configPath,
			plugins: [plugin],
		});

		expect(result.validationErrors.length).toBe(2);
		const blockErr = result.validationErrors.find(
			(e) => e.category === "blocks",
		);
		const compErr = result.validationErrors.find(
			(e) => e.category === "components",
		);
		expect(blockErr).toBeDefined();
		expect(blockErr!.key).toBe("hero");
		expect(compErr).toBeDefined();
		expect(compErr!.key).toBe("rating");
	});

	it("skips validation when one target is missing", async () => {
		const { mkdtemp, writeFile, mkdir } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");

		const dir = await mkdtemp(join(tmpdir(), "codegen-proj-skip-"));
		const configPath = join(dir, "questpie.config.ts");
		await writeFile(
			configPath,
			'export default { app: { url: "http://localhost" }, db: { url: "sqlite://:memory:" } };',
		);
		await writeFile(join(dir, "modules.ts"), "export default [];");

		// Validator that checks server + admin-client, but admin-client target doesn't exist
		const skippedValidator: CrossTargetValidator = (targets) => {
			const server = targets.get("server");
			const client = targets.get("admin-client");
			if (!server || !client) return [];
			return [
				{
					severity: "error",
					category: "test",
					key: "should-not-appear",
					sourceTarget: "server",
					consumerTarget: "admin-client",
					message: "This should never be reached",
				},
			];
		};

		const plugin: CodegenPlugin = {
			name: "test-skip",
			validators: [skippedValidator],
			targets: {},
		};

		const result = await runAllTargets({
			rootDir: dir,
			configPath,
			plugins: [plugin],
		});

		// No admin-client target → validator returns [] → no validation errors
		expect(result.validationErrors).toEqual([]);
	});

	it("aggregates validators from multiple plugins", async () => {
		const { mkdtemp, writeFile, mkdir } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");

		const dir = await mkdtemp(join(tmpdir(), "codegen-proj-agg-"));
		const configPath = join(dir, "questpie.config.ts");
		await writeFile(
			configPath,
			'export default { app: { url: "http://localhost" }, db: { url: "sqlite://:memory:" } };',
		);
		await writeFile(join(dir, "modules.ts"), "export default [];");

		// Two plugins each with a validator that returns one error
		const plugin1: CodegenPlugin = {
			name: "plugin-1",
			validators: [
				() => [
					{
						severity: "error" as const,
						category: "test1",
						key: "a",
						sourceTarget: "server",
						consumerTarget: "other",
						message: "Error from plugin 1",
					},
				],
			],
			targets: {},
		};

		const plugin2: CodegenPlugin = {
			name: "plugin-2",
			validators: [
				() => [
					{
						severity: "warning" as const,
						category: "test2",
						key: "b",
						sourceTarget: "server",
						consumerTarget: "other",
						message: "Warning from plugin 2",
					},
				],
			],
			targets: {},
		};

		const result = await runAllTargets({
			rootDir: dir,
			configPath,
			plugins: [plugin1, plugin2],
		});

		expect(result.validationErrors.length).toBe(2);
		expect(result.validationErrors[0].category).toBe("test1");
		expect(result.validationErrors[0].severity).toBe("error");
		expect(result.validationErrors[1].category).toBe("test2");
		expect(result.validationErrors[1].severity).toBe("warning");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. resolveTargetGraph — conflict detection
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveTargetGraph — target ownership", () => {
	it("takes root and outputFile from the owner whatever the plugin order", () => {
		const owner: CodegenPlugin = {
			name: "plugin-a",
			targets: {
				"my-target": { owner: true, root: "./src", outputFile: "index.ts" },
			},
		};
		const contributor: CodegenPlugin = {
			name: "plugin-b",
			targets: { "my-target": { discover: { branding: "branding.ts" } } },
		};

		for (const plugins of [
			[owner, contributor],
			[contributor, owner],
		]) {
			const target = resolveTargetGraph(plugins).get("my-target")!;
			expect(target.owner).toBe("plugin-a");
			expect(target.root).toBe("./src");
			expect(target.outputFile).toBe("index.ts");
			expect(target.discover.branding).toBe("branding.ts");
		}
	});

	it("throws when two plugins claim the same target", () => {
		const plugin1: CodegenPlugin = {
			name: "plugin-a",
			targets: {
				"my-target": { owner: true, root: ".", outputFile: "index.ts" },
			},
		};
		const plugin2: CodegenPlugin = {
			name: "plugin-b",
			targets: {
				"my-target": { owner: true, root: ".", outputFile: "index.ts" },
			},
		};

		expect(() => resolveTargetGraph([plugin1, plugin2])).toThrow(
			/more than one owner/,
		);
	});

	it("throws when several plugins contribute to an unowned target", () => {
		const plugin1: CodegenPlugin = {
			name: "plugin-a",
			targets: { "my-target": { root: ".", outputFile: "index.ts" } },
		};
		const plugin2: CodegenPlugin = {
			name: "plugin-b",
			targets: { "my-target": { root: ".", outputFile: "index.ts" } },
		};

		expect(() => resolveTargetGraph([plugin1, plugin2])).toThrow(/no owner/);
	});

	it("throws on a root that disagrees with the owner", () => {
		const plugin1: CodegenPlugin = {
			name: "plugin-a",
			targets: {
				"my-target": { owner: true, root: "./src", outputFile: "index.ts" },
			},
		};
		const plugin2: CodegenPlugin = {
			name: "plugin-b",
			targets: { "my-target": { root: "./lib" } },
		};

		expect(() => resolveTargetGraph([plugin1, plugin2])).toThrow(
			/Only the owner decides/,
		);
		expect(() => resolveTargetGraph([plugin1, plugin2])).toThrow(
			/Plugin "plugin-b"/,
		);
	});

	it("throws on an outDir that disagrees with the owner", () => {
		const plugin1: CodegenPlugin = {
			name: "plugin-a",
			targets: {
				"my-target": {
					owner: true,
					root: ".",
					outDir: ".generated",
					outputFile: "index.ts",
				},
			},
		};
		const plugin2: CodegenPlugin = {
			name: "plugin-b",
			targets: { "my-target": { outDir: ".codegen" } },
		};

		expect(() => resolveTargetGraph([plugin1, plugin2])).toThrow(
			/Only the owner decides/,
		);
		expect(() => resolveTargetGraph([plugin1, plugin2])).toThrow(
			/Plugin "plugin-b"/,
		);
	});

	it("throws on an outputFile that disagrees with the owner", () => {
		const plugin1: CodegenPlugin = {
			name: "plugin-a",
			targets: {
				"my-target": { owner: true, root: ".", outputFile: "index.ts" },
			},
		};
		const plugin2: CodegenPlugin = {
			name: "plugin-b",
			targets: { "my-target": { outputFile: "main.ts" } },
		};

		expect(() => resolveTargetGraph([plugin1, plugin2])).toThrow(
			/Only the owner decides/,
		);
		expect(() => resolveTargetGraph([plugin1, plugin2])).toThrow(
			/Plugin "plugin-b"/,
		);
	});

	it("throws when a plugin that is not the owner provides a generator", () => {
		const plugin1: CodegenPlugin = {
			name: "plugin-a",
			targets: {
				"my-target": {
					owner: true,
					root: ".",
					outputFile: "index.ts",
					generate: async () => ({ code: "// a" }),
				},
			},
		};
		const plugin2: CodegenPlugin = {
			name: "plugin-b",
			targets: { "my-target": { generate: async () => ({ code: "// b" }) } },
		};

		expect(() => resolveTargetGraph([plugin1, plugin2])).toThrow(
			/cannot provide a generator/,
		);
		expect(() => resolveTargetGraph([plugin1, plugin2])).toThrow(
			/plugin "plugin-b"/,
		);
	});

	it("throws when two targets write to the same directory", () => {
		const plugin: CodegenPlugin = {
			name: "plugin-a",
			targets: {
				one: { root: ".", outputFile: "one.ts" },
				two: { root: ".", outputFile: "two.ts" },
			},
		};

		expect(() => resolveTargetGraph([plugin])).toThrow(
			/both write to "\.generated"/,
		);
	});

	it("allows compatible contributions from two plugins to the same target", () => {
		const plugin1: CodegenPlugin = {
			name: "plugin-a",
			targets: {
				"my-target": {
					owner: true,
					root: ".",
					outputFile: "index.ts",
					categories: {
						blocks: {
							dirs: ["blocks"],
							prefix: "block",
							registryKey: false,
							includeInAppState: false,
							extractFromModules: false,
						},
					},
				},
			},
		};
		const plugin2: CodegenPlugin = {
			name: "plugin-b",
			targets: {
				"my-target": {
					root: ".",
					outputFile: "index.ts",
					categories: {
						views: {
							dirs: ["views"],
							prefix: "view",
							registryKey: false,
							includeInAppState: false,
							extractFromModules: false,
						},
					},
					discover: {
						branding: "branding.ts",
					},
				},
			},
		};

		const graph = resolveTargetGraph([plugin1, plugin2]);
		const target = graph.get("my-target")!;

		expect(target).toBeDefined();
		expect(target.categories.blocks).toBeDefined();
		expect(target.categories.views).toBeDefined();
		expect(target.discover.branding).toBe("branding.ts");
	});

	it("allows omitting outDir (defaults to .generated)", () => {
		const plugin1: CodegenPlugin = {
			name: "plugin-a",
			targets: {
				"my-target": {
					owner: true,
					root: ".",
					outputFile: "index.ts",
					// no outDir — defaults to .generated
				},
			},
		};
		const plugin2: CodegenPlugin = {
			name: "plugin-b",
			targets: {
				"my-target": {
					// a contributor leaves the output shape to the owner
				},
			},
		};

		const graph = resolveTargetGraph([plugin1, plugin2]);
		expect(graph.get("my-target")!.outDir).toBe(".generated");
	});

	it("merges transforms from multiple plugins in order", () => {
		const order: string[] = [];

		const plugin1: CodegenPlugin = {
			name: "plugin-a",
			targets: {
				"my-target": {
					owner: true,
					root: ".",
					outputFile: "index.ts",
					transform: () => {
						order.push("a");
					},
				},
			},
		};
		const plugin2: CodegenPlugin = {
			name: "plugin-b",
			targets: {
				"my-target": {
					transform: () => {
						order.push("b");
					},
				},
			},
		};

		const graph = resolveTargetGraph([plugin1, plugin2]);
		const target = graph.get("my-target")!;

		expect(target.transforms.length).toBe(2);
		// Execute transforms to verify order
		for (const t of target.transforms) {
			t({} as any);
		}
		expect(order).toEqual(["a", "b"]);
	});

	it("creates separate targets for different target IDs", () => {
		const plugin: CodegenPlugin = {
			name: "multi-target",
			targets: {
				server: {
					root: ".",
					outputFile: "index.ts",
				},
				"admin-client": {
					root: "../admin",
					outputFile: "client.ts",
				},
			},
		};

		const graph = resolveTargetGraph([plugin]);
		expect(graph.size).toBe(2);
		expect(graph.get("server")!.root).toBe(".");
		expect(graph.get("admin-client")!.root).toBe("../admin");
	});
});
