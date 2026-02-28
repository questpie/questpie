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
import { join, relative, resolve } from "node:path";
import { discoverFiles } from "./discover.js";
import { generateFactoryTemplate } from "./factory-template.js";
import { generateModuleTemplate } from "./module-template.js";
import { generateTemplate } from "./template.js";
import type {
	CategoryDeclaration,
	CodegenContext,
	CodegenOptions,
	CodegenPlugin,
	CodegenResult,
	MultiTargetCodegenResult,
	ResolvedTarget,
} from "./types.js";

// ============================================================================
// Core codegen plugin (always prepended)
// ============================================================================

/**
 * Built-in core codegen plugin.
 *
 * Declares all core categories (collections, globals, jobs, functions, routes,
 * messages, services, emails, migrations, seeds) and core single files
 * (modules, locale, hooks, access, context).
 *
 * Also provides singleton factory functions for core config files.
 *
 * Always prepended to the plugin list in runCodegen().
 */
export function coreCodegenPlugin(): CodegenPlugin {
	return {
		name: "questpie-core",
		targets: {
			server: {
				root: ".",
				outputFile: "index.ts",
				categories: {
					collections: {
						dirs: ["collections"],
						prefix: "coll",
						registryKey: true,
						includeInAppState: true,
						extractFromModules: true,
					},
					globals: {
						dirs: ["globals"],
						prefix: "glob",
						registryKey: true,
						includeInAppState: true,
						extractFromModules: true,
					},
					jobs: {
						dirs: ["jobs"],
						prefix: "job",
						registryKey: true,
						includeInAppState: true,
						extractFromModules: true,
					},
					functions: {
						dirs: ["functions"],
						recursive: true,
						prefix: "fn",
						emit: "nested",
						keySeparator: ".",
						typeEmit: "functions",
						registryKey: true,
						includeInAppState: true,
						extractFromModules: true,
					},
					routes: {
						dirs: ["routes"],
						recursive: true,
						prefix: "route",
						keySeparator: "/",
						registryKey: true,
						includeInAppState: true,
						extractFromModules: true,
					},
					messages: {
						dirs: ["messages"],
						prefix: "msg",
						typeEmit: "messages",
						registryKey: false,
						includeInAppState: false,
						extractFromModules: false,
					},
					services: {
						dirs: ["services"],
						prefix: "svc",
						typeEmit: "services",
						extraTypeImports: [
							'import type { ServiceInstanceOf } from "questpie";',
						],
						registryKey: true,
						includeInAppState: true,
						extractFromModules: true,
						appContextEmit: "services",
					},
					emails: {
						dirs: ["emails"],
						prefix: "email",
						typeEmit: "emails",
						createAppKey: "emailTemplates",
						extraTypeImports: [
							'import type { MailerService } from "questpie";',
						],
						registryKey: "emails",
						includeInAppState: false,
						extractFromModules: false,
					},
					migrations: {
						dirs: ["migrations"],
						prefix: "mig",
						emit: "array",
						typeEmit: "none",
						registryKey: false,
						includeInAppState: false,
						extractFromModules: false,
					},
					seeds: {
						dirs: ["seeds"],
						prefix: "seed",
						emit: "array",
						typeEmit: "none",
						registryKey: false,
						includeInAppState: false,
						extractFromModules: false,
					},
				},
				discover: {
					modules: "modules.ts",
					fields: "fields.ts",
					locale: "locale.ts",
					hooks: "hooks.ts",
					defaultAccess: "access.ts",
					contextResolver: "context.ts",
				},
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
				callbackParams: {
					f: {
						proxyCode: "new Proxy({}, { get: (_, prop) => String(prop) })",
					},
				},
			},
		},
	};
}

// ============================================================================
// Target Graph Resolution
// ============================================================================

/**
 * Merge all plugin target contributions into a resolved target graph.
 *
 * Rules:
 * - Multiple plugins may contribute categories/discover/registries/transforms
 *   to the same target — contributions are merged.
 * - `root`, `outDir`, `outputFile` must be consistent across all contributors
 *   for the same target ID. Any conflict is a codegen error.
 * - Only one `generate` function is allowed per target.
 *
 * @see PLAN-PLUGIN-CONSISTENCY.md §5 (Codegen Orchestration Model)
 */
export function resolveTargetGraph(
	plugins: CodegenPlugin[],
): Map<string, ResolvedTarget> {
	const targets = new Map<string, ResolvedTarget>();

	for (const plugin of plugins) {
		for (const [targetId, contribution] of Object.entries(plugin.targets)) {
			let target = targets.get(targetId);

			if (!target) {
				// First contribution for this target — initialize
				target = {
					id: targetId,
					root: contribution.root,
					outDir: contribution.outDir ?? ".generated",
					outputFile: contribution.outputFile,
					categories: {},
					discover: {},
					registries: {
						collectionExtensions: {},
						globalExtensions: {},
						singletonFactories: {},
						moduleRegistries: {},
					},
					callbackParams: {},
					transforms: [],
				};
				targets.set(targetId, target);
			} else {
				// Validate consistency of root/outDir/outputFile
				if (contribution.root !== target.root) {
					throw new Error(
						`[codegen] Target "${targetId}" root conflict: ` +
							`plugin "${plugin.name}" declares root "${contribution.root}" ` +
							`but a previous plugin set root "${target.root}".`,
					);
				}
				if (
					contribution.outDir !== undefined &&
					contribution.outDir !== target.outDir
				) {
					throw new Error(
						`[codegen] Target "${targetId}" outDir conflict: ` +
							`plugin "${plugin.name}" declares outDir "${contribution.outDir}" ` +
							`but a previous plugin set outDir "${target.outDir}".`,
					);
				}
				if (contribution.outputFile !== target.outputFile) {
					throw new Error(
						`[codegen] Target "${targetId}" outputFile conflict: ` +
							`plugin "${plugin.name}" declares outputFile "${contribution.outputFile}" ` +
							`but a previous plugin set outputFile "${target.outputFile}".`,
					);
				}
			}

			// Merge categories
			if (contribution.categories) {
				Object.assign(target.categories, contribution.categories);
			}

			// Merge discover patterns
			if (contribution.discover) {
				Object.assign(target.discover, contribution.discover);
			}

			// Merge registries (deep per sub-key)
			if (contribution.registries) {
				const reg = contribution.registries;
				if (reg.collectionExtensions) {
					Object.assign(
						target.registries.collectionExtensions,
						reg.collectionExtensions,
					);
				}
				if (reg.globalExtensions) {
					Object.assign(
						target.registries.globalExtensions,
						reg.globalExtensions,
					);
				}
				if (reg.singletonFactories) {
					Object.assign(
						target.registries.singletonFactories,
						reg.singletonFactories,
					);
				}
				if (reg.moduleRegistries) {
					Object.assign(
						target.registries.moduleRegistries,
						reg.moduleRegistries,
					);
				}
			}

			// Merge callback params
			if (contribution.callbackParams) {
				Object.assign(target.callbackParams, contribution.callbackParams);
			}

			// Collect transform functions
			if (contribution.transform) {
				target.transforms.push(contribution.transform);
			}

			// Only one generator per target
			if (contribution.generate) {
				if (target.generate) {
					throw new Error(
						`[codegen] Target "${targetId}" has multiple generators. ` +
							`Plugin "${plugin.name}" provides a generator but one already exists.`,
					);
				}
				target.generate = contribution.generate;
			}
		}
	}

	return targets;
}

// ============================================================================
// Main codegen function
// ============================================================================

/**
 * Run codegen: resolve target graph, discover files, run transforms, generate output.
 *
 * When `options.module` is set, generates a `module.ts` file (static module
 * definition for npm packages). Otherwise generates `index.ts` (root app).
 *
 * @see RFC-MODULE-ARCHITECTURE §9.1 (Root App), §9.2 (Module)
 * @see PLAN-PLUGIN-CONSISTENCY.md §5 (Codegen Orchestration Model)
 */
export async function runCodegen(
	options: CodegenOptions,
): Promise<CodegenResult> {
	const { rootDir, configPath, outDir, dryRun } = options;

	// Always prepend core plugin
	const plugins = [coreCodegenPlugin(), ...(options.plugins ?? [])];

	// 1. Resolve target graph from all plugins
	const targetGraph = resolveTargetGraph(plugins);
	const targetId = options.targetId ?? "server";
	const target = targetGraph.get(targetId);

	if (!target) {
		const available = [...targetGraph.keys()].join(", ");
		throw new Error(
			`[codegen] Target "${targetId}" not found. Available targets: ${available || "(none)"}`,
		);
	}

	// 2. Discover files using the resolved target's categories and discover patterns
	const discovered = await discoverFiles(rootDir, outDir, {
		categories: target.categories,
		discover: target.discover,
	});

	// 2b. Warn about files with named exports (not default)
	const allFiles: import("./types.js").DiscoveredFile[] = [];
	for (const catMap of discovered.categories.values()) {
		for (const file of catMap.values()) {
			allFiles.push(file);
		}
	}
	if (discovered.auth) allFiles.push(discovered.auth);
	for (const singleFile of discovered.singles.values()) {
		allFiles.push(singleFile);
	}
	for (const file of allFiles) {
		if (file.exportType === "named") {
			console.warn(
				`⚠  ${file.source}: no default export found, using named export "${file.namedExportName}". ` +
					`Consider: export default ${file.namedExportName};`,
			);
		}
	}

	// 3. Build codegen context for transforms
	const extraImports: Array<{ name: string; path: string }> = [];
	const extraTypeDeclarations: string[] = [];
	const extraRuntimeCode: string[] = [];
	const extraEntities = new Map<string, string>();

	const ctx: CodegenContext = {
		categories: discovered.categories,
		auth: discovered.auth,
		singles: discovered.singles,
		spreads: discovered.spreads,
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

	// 4. Run all transforms from the resolved target (in plugin order)
	for (const transform of target.transforms) {
		transform(ctx);
	}

	// 4b. Rewrite self-package imports in module mode
	// When generating modules within a package, plugin transforms may add
	// imports referencing the package's own name (e.g. "@questpie/admin/server").
	// TypeScript resolves these via the "types" export condition to stale dist/
	// types. Rewrite to internal aliases (e.g. "#questpie/admin/server/index.js").
	if (options.module?.importRewriteMap) {
		const rewriteMap = options.module.importRewriteMap;
		for (const imp of extraImports) {
			for (const [from, to] of Object.entries(rewriteMap)) {
				if (imp.path === from || imp.path.startsWith(`${from}/`)) {
					const suffix = imp.path.slice(from.length);
					// Append /index.js for bare subpath imports (e.g. "/server" → "/server/index.js")
					const resolvedSuffix =
						suffix && !suffix.endsWith(".js") && !suffix.endsWith(".ts")
							? `${suffix}/index.js`
							: suffix;
					imp.path = `${to}${resolvedSuffix}`;
				}
			}
		}
	}

	// 5. Generate template — module or root app
	let code: string;
	let outputFile: string;

	if (options.module) {
		// Module mode: generate module.ts (static module definition)
		outputFile = options.module.outputFile ?? "module.ts";

		// Build category metadata map from the resolved target
		const categoryMeta = new Map<string, CategoryDeclaration>();
		for (const [name, decl] of Object.entries(target.categories)) {
			categoryMeta.set(name, decl);
		}

		code = generateModuleTemplate({
			moduleName: options.module.name,
			discovered,
			categoryMeta,
			extraImports: extraImports.length > 0 ? extraImports : undefined,
			extraTypeDeclarations:
				extraTypeDeclarations.length > 0 ? extraTypeDeclarations : undefined,
			extraModuleProperties:
				extraRuntimeCode.length > 0 ? extraRuntimeCode : undefined,
		});
	} else {
		// Root app mode: generate index.ts (app with createApp)
		outputFile = target.outputFile;
		const configImportPath = computeRelativeImport(outDir, configPath);
		code = generateTemplate({
			configImportPath,
			discovered,
			categories: target.categories,
			singletonFactories: target.registries.singletonFactories,
			extraImports: extraImports.length > 0 ? extraImports : undefined,
			extraTypeDeclarations:
				extraTypeDeclarations.length > 0 ? extraTypeDeclarations : undefined,
			extraRuntimeCode:
				extraRuntimeCode.length > 0 ? extraRuntimeCode : undefined,
			extraEntities: extraEntities.size > 0 ? extraEntities : undefined,
		});
	}

	// 6. Generate factories if target has registries (root app only)
	let factoriesCode: string | null = null;
	if (!options.module) {
		const hasModules = discovered.singles.has("modules");
		factoriesCode = generateFactoryTemplate({
			target,
			hasModules,
		});
	}

	// 7. Write output
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
		targetId,
		code,
		outputPath,
		discovered,
	};
}

// ============================================================================
// Multi-target orchestration
// ============================================================================

/**
 * Options for running multi-target codegen.
 *
 * Unlike `CodegenOptions`, this does NOT take a `targetId` — it processes
 * all resolved targets. Module mode is NOT supported here (use `runCodegen()`
 * directly for module codegen).
 */
export interface RunAllTargetsOptions {
	/** Absolute path to the server root (directory containing questpie.config.ts). */
	rootDir: string;
	/** Absolute path to the questpie.config.ts file. */
	configPath: string;
	/** Codegen plugins to run. */
	plugins?: CodegenPlugin[];
	/** If true, don't write files — just return the generated code. */
	dryRun?: boolean;
}

/**
 * Run codegen for ALL resolved targets.
 *
 * Resolves the target graph from plugins, then iterates each target:
 * - For targets with a custom `generate` function, calls it.
 * - For standard targets (no custom generator), uses the default template pipeline.
 *
 * Non-server targets resolve their `root` relative to `rootDir` (the server root).
 * e.g., `root: "../admin"` → `resolve(rootDir, "../admin")`.
 *
 * @see PLAN-PLUGIN-CONSISTENCY.md §5 (Codegen Orchestration Model)
 */
export async function runAllTargets(
	options: RunAllTargetsOptions,
): Promise<MultiTargetCodegenResult> {
	const { rootDir, configPath, plugins: userPlugins, dryRun } = options;

	// Always prepend core plugin
	const plugins = [coreCodegenPlugin(), ...(userPlugins ?? [])];
	const targetGraph = resolveTargetGraph(plugins);

	const results = new Map<string, CodegenResult>();
	const errors: Array<{ targetId: string; error: Error }> = [];

	for (const [targetId, target] of targetGraph) {
		try {
			// Resolve the target's root directory relative to the server root
			const targetRootDir = resolve(rootDir, target.root);
			const targetOutDir = join(targetRootDir, target.outDir);

			if (target.generate) {
				// Custom generator — run discovery, transforms, then the generator
				const discovered = await discoverFiles(targetRootDir, targetOutDir, {
					categories: target.categories,
					discover: target.discover,
				});

				// Build and run transforms
				const extraImports: Array<{ name: string; path: string }> = [];
				const extraTypeDeclarations: string[] = [];
				const extraRuntimeCode: string[] = [];
				const extraEntities = new Map<string, string>();

				const ctx: CodegenContext = {
					categories: discovered.categories,
					auth: discovered.auth,
					singles: discovered.singles,
					spreads: discovered.spreads,
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

				for (const transform of target.transforms) {
					transform(ctx);
				}

				// Run custom generator
				const output = await target.generate({
					target,
					discovered,
					extraImports,
					extraTypeDeclarations,
					extraRuntimeCode,
					extraEntities,
				});

				// Write output
				const outputPath = join(targetOutDir, target.outputFile);
				if (!dryRun) {
					await mkdir(targetOutDir, { recursive: true });
					await writeFile(outputPath, output.code, "utf-8");

					// Write additional files if provided
					if (output.additionalFiles) {
						for (const [relPath, content] of Object.entries(
							output.additionalFiles,
						)) {
							const absPath = join(targetOutDir, relPath);
							await writeFile(absPath, content, "utf-8");
						}
					}
				}

				results.set(targetId, {
					targetId,
					code: output.code,
					outputPath,
					discovered,
				});
			} else {
				// Standard target — use runCodegen() with the resolved target
				const result = await runCodegen({
					rootDir: targetRootDir,
					configPath,
					outDir: targetOutDir,
					plugins: userPlugins,
					dryRun,
					targetId,
				});
				results.set(targetId, result);
			}
		} catch (err) {
			errors.push({
				targetId,
				error: err instanceof Error ? err : new Error(String(err)),
			});
		}
	}

	return { targets: results, errors };
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
