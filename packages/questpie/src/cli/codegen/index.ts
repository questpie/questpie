/**
 * Codegen Orchestrator
 *
 * Main entry point for running codegen. Coordinates:
 * 1. File discovery
 * 2. Plugin execution
 * 3. Template generation (root app or module)
 * 4. File writing
 *
 * @see RFC-MODULE-ARCHITECTURE §9 (Generated Code)
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { discoverFiles } from "./discover.js";
import { generateFactoryTemplate } from "./factory-template.js";
import { generateModuleTemplate } from "./module-template.js";
import { generateTemplate } from "./template.js";
import type {
	CodegenContext,
	CodegenOptions,
	CodegenPlugin,
	CodegenResult,
	SingletonFactory,
} from "./types.js";

// ============================================================================
// Core codegen plugin (always prepended)
// ============================================================================

/**
 * Built-in core codegen plugin.
 * Provides singleton factory functions for core config files:
 * locale.ts, hooks.ts, access.ts, context.ts.
 *
 * Always prepended to the plugin list in runCodegen().
 */
export function coreCodegenPlugin(): CodegenPlugin {
	return {
		name: "questpie-core",
		registries: {
			singletonFactories: {
				locale: {
					configType: "LocaleConfig",
					imports: [{ name: "LocaleConfig", from: "questpie" }],
				},
				hooks: {
					configType: "GlobalHooksInput",
					imports: [{ name: "GlobalHooksInput", from: "questpie" }],
				},
				access: {
					configType: "CollectionAccess",
					imports: [{ name: "CollectionAccess", from: "questpie" }],
				},
				context: {
					configType: "ContextResolver",
					imports: [{ name: "ContextResolver", from: "questpie" }],
				},
			},
		},
	};
}

// ============================================================================
// Admin codegen plugin (built-in)
// ============================================================================

/**
 * Built-in admin codegen plugin.
 * Discovers blocks/, sidebar.ts, dashboard.ts, branding.ts, admin-locale.ts
 * when the admin module is used.
 *
 * @see RFC-MODULE-ARCHITECTURE §8.2 (npm Package — Admin)
 */
export function adminCodegenPlugin(): CodegenPlugin {
	return {
		name: "questpie-admin",
		discover: {
			blocks: "blocks/*.ts",
			sidebar: "sidebar.ts",
			dashboard: "dashboard.ts",
			branding: "branding.ts",
			adminLocale: "admin-locale.ts",
		},
		registries: {
			moduleRegistries: {
				listViews: {
					placeholder: "$LIST_VIEW_NAMES",
					registryKey: "listViews",
				},
				editViews: {
					placeholder: "$EDIT_VIEW_NAMES",
					registryKey: "editViews",
				},
				components: {
					placeholder: "$COMPONENT_NAMES",
					registryKey: "components",
				},
			},
			collectionExtensions: {
				admin: {
					stateKey: "admin",
					imports: [
						{ name: "AdminCollectionConfig", from: "@questpie/admin/server" },
						{ name: "AdminConfigContext", from: "@questpie/admin/server" },
						{ name: "createComponentProxy", from: "@questpie/admin/server" },
					],
					configType:
						"AdminCollectionConfig | ((ctx: AdminConfigContext<$COMPONENT_NAMES>) => AdminCollectionConfig)",
					isCallback: true,
					callbackContextParams: ["c"],
				},
				list: {
					stateKey: "adminList",
					imports: [
						{ name: "ListViewConfig", from: "@questpie/admin/server" },
						{
							name: "ListViewConfigContext",
							from: "@questpie/admin/server",
						},
						{ name: "createViewProxy", from: "@questpie/admin/server" },
						{ name: "createFieldProxy", from: "@questpie/admin/server" },
						{ name: "createActionProxy", from: "@questpie/admin/server" },
					],
					configType:
						"(ctx: ListViewConfigContext<TState extends { fieldDefinitions: infer F extends Record<string, any> } ? F : Record<string, any>, $LIST_VIEW_NAMES>) => ListViewConfig",
					isCallback: true,
					callbackContextParams: ["v", "f", "a"],
				},
				form: {
					stateKey: "adminForm",
					imports: [
						{ name: "FormViewConfig", from: "@questpie/admin/server" },
						{
							name: "FormViewConfigContext",
							from: "@questpie/admin/server",
						},
					],
					configType:
						"(ctx: FormViewConfigContext<TState extends { fieldDefinitions: infer F extends Record<string, any> } ? F : Record<string, any>, $EDIT_VIEW_NAMES>) => FormViewConfig",
					isCallback: true,
					callbackContextParams: ["v", "f"],
				},
				preview: {
					stateKey: "adminPreview",
					imports: [
						{ name: "PreviewConfig", from: "@questpie/admin/server" },
					],
					configType: "PreviewConfig",
				},
				actions: {
					stateKey: "adminActions",
					imports: [
						{ name: "ServerActionsConfig", from: "@questpie/admin/server" },
						{
							name: "ActionsConfigContext",
							from: "@questpie/admin/server",
						},
					],
					configType:
						"(ctx: ActionsConfigContext<Record<string, unknown>, $COMPONENT_NAMES>) => ServerActionsConfig",
					isCallback: true,
					callbackContextParams: ["a", "c", "f"],
				},
			},
			globalExtensions: {
				admin: {
					stateKey: "admin",
					imports: [
						{ name: "AdminGlobalConfig", from: "@questpie/admin/server" },
						{ name: "AdminConfigContext", from: "@questpie/admin/server" },
					],
					configType:
						"AdminGlobalConfig | ((ctx: AdminConfigContext<$COMPONENT_NAMES>) => AdminGlobalConfig)",
					isCallback: true,
					callbackContextParams: ["c"],
				},
				form: {
					stateKey: "adminForm",
					imports: [
						{ name: "FormViewConfig", from: "@questpie/admin/server" },
						{
							name: "FormViewConfigContext",
							from: "@questpie/admin/server",
						},
					],
					configType:
						"(ctx: FormViewConfigContext<TState extends { fieldDefinitions: infer F extends Record<string, any> } ? F : Record<string, any>, $EDIT_VIEW_NAMES>) => FormViewConfig",
					isCallback: true,
					callbackContextParams: ["v", "f"],
				},
			},
			singletonFactories: {
				branding: {
					configType: "ServerBrandingConfig",
					imports: [
						{ name: "ServerBrandingConfig", from: "@questpie/admin/server" },
					],
				},
				adminLocale: {
					configType: "AdminLocaleConfig",
					imports: [
						{ name: "AdminLocaleConfig", from: "@questpie/admin/server" },
					],
				},
				sidebar: {
					configType: "SidebarContribution",
					imports: [
						{ name: "SidebarContribution", from: "@questpie/admin/server" },
					],
					isCallback: true,
				},
				dashboard: {
					configType: "DashboardContribution",
					imports: [
						{ name: "DashboardContribution", from: "@questpie/admin/server" },
					],
					isCallback: true,
				},
			},
		},
	};
}

// ============================================================================
// Main codegen function
// ============================================================================

/**
 * Run codegen: discover files, run plugins, generate template, write output.
 *
 * When `options.module` is set, generates a `module.ts` file (static module
 * definition for npm packages). Otherwise generates `index.ts` (root app).
 *
 * @see RFC-MODULE-ARCHITECTURE §9.1 (Root App), §9.2 (Module)
 */
export async function runCodegen(
	options: CodegenOptions,
): Promise<CodegenResult> {
	const { rootDir, configPath, outDir, dryRun } = options;
	// Always prepend core plugin for singleton factories (locale, hooks, access, context)
	const plugins = [coreCodegenPlugin(), ...(options.plugins ?? [])];

	// 1. Discover files
	const discovered = await discoverFiles(rootDir, outDir, plugins);

	// 1b. Warn about files with named exports (not default)
	const allFiles = [
		...discovered.collections.values(),
		...discovered.globals.values(),
		...discovered.jobs.values(),
		...discovered.functions.values(),
		...discovered.routes.values(),
		...discovered.messages.values(),
		...discovered.services.values(),
	];
	if (discovered.auth) allFiles.push(discovered.auth);
	// Include singles in warnings
	for (const singleFile of discovered.singles.values()) {
		allFiles.push(singleFile);
	}
	for (const customMap of discovered.custom.values()) {
		allFiles.push(...customMap.values());
	}
	for (const file of allFiles) {
		if (file.exportType === "named") {
			console.warn(
				`⚠  ${file.source}: no default export found, using named export "${file.namedExportName}". ` +
					`Consider: export default ${file.namedExportName};`,
			);
		}
	}

	// 2. Build codegen context for plugins
	const extraImports: Array<{ name: string; path: string }> = [];
	const extraTypeDeclarations: string[] = [];
	const extraRuntimeCode: string[] = [];
	const extraEntities = new Map<string, string>();

	const ctx: CodegenContext = {
		collections: discovered.collections,
		globals: discovered.globals,
		jobs: discovered.jobs,
		functions: discovered.functions,
		routes: discovered.routes,
		messages: discovered.messages,
		services: discovered.services,
		auth: discovered.auth,
		custom: discovered.custom,
		singles: discovered.singles,
		addImport(name, path) {
			extraImports.push({ name, path });
		},
		addTypeDeclaration(code) {
			extraTypeDeclarations.push(code);
		},
		addRuntimeCode(code) {
			extraRuntimeCode.push(code);
		},
		set(key, value) {
			extraEntities.set(key, value);
		},
	};

	// 3. Run plugin transforms
	for (const plugin of plugins) {
		if (plugin.transform) {
			plugin.transform(ctx);
		}
	}

	// 4. Generate template — module or root app
	let code: string;
	let outputFile: string;

	if (options.module) {
		// Module mode: generate module.ts (static module definition)
		outputFile = options.module.outputFile ?? "module.ts";
		code = generateModuleTemplate({
			moduleName: options.module.name,
			discovered,
			extraImports: extraImports.length > 0 ? extraImports : undefined,
			extraTypeDeclarations:
				extraTypeDeclarations.length > 0 ? extraTypeDeclarations : undefined,
			extraModuleProperties:
				extraRuntimeCode.length > 0 ? extraRuntimeCode : undefined,
		});
	} else {
		// Root app mode: generate index.ts (app with createApp)
		outputFile = "index.ts";
		const configImportPath = computeRelativeImport(outDir, configPath);
		code = generateTemplate({
			configImportPath,
			discovered,
			plugins,
			extraImports: extraImports.length > 0 ? extraImports : undefined,
			extraTypeDeclarations:
				extraTypeDeclarations.length > 0 ? extraTypeDeclarations : undefined,
			extraRuntimeCode:
				extraRuntimeCode.length > 0 ? extraRuntimeCode : undefined,
			extraEntities: extraEntities.size > 0 ? extraEntities : undefined,
		});
	}

	// 5. Generate factories if plugins declare registries (root app only)
	let factoriesCode: string | null = null;
	if (!options.module) {
		const hasModules = discovered.singles.has("modules");
		factoriesCode = generateFactoryTemplate({
			plugins,
			hasModules,
		});
	}

	// 6. Write output
	const outputPath = join(outDir, outputFile);
	if (!dryRun) {
		await mkdir(outDir, { recursive: true });
		await writeFile(outputPath, code, "utf-8");

		// Write factories.ts if generated
		if (factoriesCode) {
			const factoriesPath = join(outDir, "factories.ts");
			await writeFile(factoriesPath, factoriesCode, "utf-8");
		}
	}

	return {
		code,
		outputPath,
		discovered,
	};
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Compute a relative import path between two absolute paths,
 * stripping the .ts extension.
 */
function computeRelativeImport(fromDir: string, toFile: string): string {
	let rel = relative(fromDir, toFile);
	// Remove .ts extension
	rel = rel.replace(/\.(ts|tsx|mts|mjs|js|jsx)$/, "");
	if (!rel.startsWith(".")) {
		rel = `./${rel}`;
	}
	return rel;
}
