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
	ProjectionError,
	ResolvedTarget,
} from "./types.js";

// ============================================================================
// Core codegen plugin (always prepended)
// ============================================================================

/**
 * Built-in core codegen plugin.
 *
 * Declares all core categories (collections, globals, jobs, routes,
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
						factoryFunctions: ["collection"],
						registryKey: true,
						includeInAppState: true,
						extractFromModules: true,
					},
					globals: {
						dirs: ["globals"],
						prefix: "glob",
						factoryFunctions: ["global"],
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
					routes: {
						dirs: ["routes", "functions"],
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
					fieldTypes: {
						dirs: ["fields"],
						prefix: "ftype",
						factoryFunctions: ["fieldType"],
						registryKey: "~fieldTypes",
						includeInAppState: false,
						extractFromModules: true,
					},
				},
				discover: {
					modules: "modules.ts",
					plugin: "plugin.ts",
					fields: { pattern: "fields.ts", registryKey: "~fieldTypes" },
					authConfig: { pattern: "config/auth.ts", configKey: "auth" },
					appConfig: { pattern: "config/app.ts", configKey: "app" },
				},
				registries: {
					singletonFactories: {
						appConfig: {
							configType: "AppConfigInput",
							imports: [{ name: "AppConfigInput", from: "questpie" }],
						},
						authConfig: {
							configType: "AuthConfig",
							imports: [{ name: "AuthConfig", from: "questpie" }],
						},
					},
				},
				callbackParams: {
					f: {
						factory: "createFieldNameProxy",
						from: "questpie",
					},
				},
				scaffolds: {
					collection: {
						dir: "collections",
						description: "Collection definition",
						template: ({ kebab, camel }) =>
							`import { collection } from "#questpie/factories";\n\nexport const ${camel} = collection("${kebab}")\n\t.fields(({ f }) => ({\n\t\ttitle: f.text(255).label("Title").required(),\n\t}))\n\t.title(({ f }) => f.title);\n`,
					},
					global: {
						dir: "globals",
						description: "Global definition",
						template: ({ kebab, camel }) =>
							`import { global } from "#questpie/factories";\n\nexport const ${camel} = global("${kebab}")\n\t.fields(({ f }) => ({\n\t\ttitle: f.text(255).label("Title").required(),\n\t}));\n`,
					},
					job: {
						dir: "jobs",
						description: "Background job",
						template: ({ kebab }) =>
							`import { job } from "questpie";\nimport { z } from "zod";\n\nexport default job({\n\tname: "${kebab}",\n\tschema: z.object({}),\n\thandler: async () => {},\n});\n`,
					},
					service: {
						dir: "services",
						description: "Service definition",
						template: ({ camel }) =>
							`import { service } from "questpie";\n\nexport const ${camel}Service = service()\n\t.lifecycle("singleton")\n\t.create(() => {\n\t\treturn {};\n\t});\n`,
					},
					email: {
						dir: "emails",
						extension: ".tsx",
						description: "Email template",
						template: ({ kebab, title }) =>
							`import { email } from "questpie";\nimport { z } from "zod";\n\nexport default email({\n\tname: "${kebab}",\n\tschema: z.object({}),\n\thandler: async () => ({\n\t\tsubject: "${title}",\n\t\thtml: "<div>${title}</div>",\n\t}),\n});\n`,
					},
					route: {
						dir: "routes",
						description: "API route",
						template: () =>
							`import { route } from "questpie";\nimport { z } from "zod";\n\nexport default route()\n\t.post()\n\t.schema(z.object({}))\n\t.handler(async () => {\n\t\treturn {};\n\t});\n`,
					},
					seed: {
						dir: "seeds",
						description: "Database seed",
						template: ({ camel }) =>
							`import { seed } from "questpie";\n\nexport default seed({\n\tid: "${camel}",\n\tdescription: "TODO: describe what this seed does",\n\tcategory: "dev",\n\tasync run({ collections, globals, createContext, log }) {\n\t\tlog("Running ${camel} seed...");\n\t},\n});\n`,
					},
					migration: {
						dir: "migrations",
						description: "Database migration",
						template: ({ camel }) => {
							const timestamp = new Date()
								.toISOString()
								.replace(/[-:]/g, "")
								.replace(/\..+/, "")
								.slice(0, 15);
							return `import { migration } from "questpie";\nimport { sql } from "drizzle-orm";\n\nexport default migration({\n\tid: "${camel}${timestamp}",\n\tasync up({ db }) {\n\t\t// TODO: implement migration\n\t},\n\tasync down({ db }) {\n\t\t// TODO: implement rollback\n\t},\n});\n`;
						},
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
						fieldExtensions: {},
						singletonFactories: {},
						builderFactories: {},
					},
					callbackParams: {},
					transforms: [],
					scaffolds: {},
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

			// Validate/store moduleRoot
			if (contribution.moduleRoot !== undefined) {
				if (
					target.moduleRoot !== undefined &&
					contribution.moduleRoot !== target.moduleRoot
				) {
					throw new Error(
						`[codegen] Target "${targetId}" moduleRoot conflict: ` +
							`plugin "${plugin.name}" declares moduleRoot "${contribution.moduleRoot}" ` +
							`but a previous plugin set moduleRoot "${target.moduleRoot}".`,
					);
				}
				target.moduleRoot = contribution.moduleRoot;
			}

			// Merge categories (deep per category key — arrays are concatenated)
			if (contribution.categories) {
				for (const [catKey, catDecl] of Object.entries(
					contribution.categories,
				)) {
					const existing = target.categories[catKey];
					if (existing) {
						// Collect array fields before Object.assign overwrites them
						const prevFactoryImports = existing.factoryImports;
						// Shallow merge scalar/object properties
						Object.assign(existing, catDecl);
						// Concatenate array properties
						if (catDecl.factoryImports && prevFactoryImports) {
							existing.factoryImports = [
								...prevFactoryImports,
								...catDecl.factoryImports,
							];
						}
					} else {
						target.categories[catKey] = catDecl;
					}
				}
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
				if (reg.fieldExtensions) {
					Object.assign(target.registries.fieldExtensions, reg.fieldExtensions);
				}
				if (reg.singletonFactories) {
					Object.assign(
						target.registries.singletonFactories,
						reg.singletonFactories,
					);
				}
				if (reg.builderFactories) {
					Object.assign(
						target.registries.builderFactories,
						reg.builderFactories,
					);
				}
			}

			// Merge callback params
			if (contribution.callbackParams) {
				Object.assign(target.callbackParams, contribution.callbackParams);
			}

			// Merge scaffolds
			if (contribution.scaffolds) {
				Object.assign(target.scaffolds, contribution.scaffolds);
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
	// Skip warnings for categories with factoryFunctions — named exports are expected there.
	const factoryCategories = new Set<string>();
	for (const [catName, decl] of Object.entries(target.categories)) {
		if (decl.factoryFunctions && decl.factoryFunctions.length > 0) {
			factoryCategories.add(catName);
		}
	}

	for (const [catName, catMap] of discovered.categories) {
		if (factoryCategories.has(catName)) continue;
		for (const file of catMap.values()) {
			if (file.exportType === "named") {
				console.warn(
					`⚠  ${file.source}: no default export found, using named export "${file.namedExportName}". ` +
						`Consider: export default ${file.namedExportName};`,
				);
			}
		}
	}
	for (const singleFile of discovered.singles.values()) {
		if (singleFile.exportType === "named") {
			console.warn(
				`⚠  ${singleFile.source}: no default export found, using named export "${singleFile.namedExportName}". ` +
					`Consider: export default ${singleFile.namedExportName};`,
			);
		}
	}

	// Route collision check removed — all routes (auth, search, realtime, etc.)
	// are now core module route definitions, not reserved HTTP adapter prefixes.
	// The trie-based matcher handles priority: literal > param > wildcard.

	// 3. Build codegen context for transforms
	const extraImports: Array<{ name: string; path: string }> = [];
	const extraTypeDeclarations: string[] = [];
	const extraRuntimeCode: string[] = [];
	const extraEntities = new Map<string, string>();

	const ctx: CodegenContext = {
		categories: discovered.categories,
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
							? `${suffix}.js`
							: suffix;
					imp.path = `${to}${resolvedSuffix}`;
				}
			}
		}
	}

	// 5. Generate template — module or root app
	let code: string;
	let outputFile: string;

	// Track additional files to write (e.g. registries.ts for module augmentations)
	let moduleRegistriesCode: string | null = null;

	if (options.module) {
		// Module mode: generate module.ts (static module definition)
		outputFile = options.module.outputFile ?? "module.ts";

		// Build category metadata map from the resolved target
		const categoryMeta = new Map<string, CategoryDeclaration>();
		for (const [name, decl] of Object.entries(target.categories)) {
			categoryMeta.set(name, decl);
		}

		const result = generateModuleTemplate({
			moduleName: options.module.name,
			discovered,
			categoryMeta,
			discoverPatterns: target.discover,
			extraImports: extraImports.length > 0 ? extraImports : undefined,
			extraTypeDeclarations:
				extraTypeDeclarations.length > 0 ? extraTypeDeclarations : undefined,
			extraModuleProperties:
				extraRuntimeCode.length > 0 ? extraRuntimeCode : undefined,
		});
		code = result.code;
		moduleRegistriesCode = result.registriesCode;
	} else {
		// Root app mode: generate index.ts (app with createApp)
		outputFile = target.outputFile;
		const configImportPath = computeRelativeImport(outDir, configPath);
		code = generateTemplate({
			configImportPath,
			discovered,
			categories: target.categories,
			singletonFactories: target.registries.singletonFactories,
			discoverPatterns: target.discover,
			extraImports: extraImports.length > 0 ? extraImports : undefined,
			extraTypeDeclarations:
				extraTypeDeclarations.length > 0 ? extraTypeDeclarations : undefined,
			extraRuntimeCode:
				extraRuntimeCode.length > 0 ? extraRuntimeCode : undefined,
			extraEntities: extraEntities.size > 0 ? extraEntities : undefined,
		});
	}

	// 6. Always generate factories.ts for root app mode
	// Even with zero extensions, factories.ts exports collection()/global()
	// so users always import from #questpie/factories (stable import path).
	let factoriesCode: string | null = null;
	if (!options.module) {
		const hasModules = discovered.singles.has("modules");
		// Check if user has a fields.ts singleton for custom field types
		const userFieldsFile = discovered.singles.get("fields");
		factoriesCode = generateFactoryTemplate({
			target,
			hasModules,
			userFieldsImportPath: userFieldsFile?.importPath,
		});
	}

	// 7. Validate generated code syntax before writing
	// Catches stray lines, unclosed brackets, and other template bugs early.
	const filesToWrite: Array<{ path: string; code: string }> = [];
	const outputPath = join(outDir, outputFile);
	filesToWrite.push({ path: outputPath, code });
	if (moduleRegistriesCode) {
		filesToWrite.push({
			path: join(outDir, "registries.ts"),
			code: moduleRegistriesCode,
		});
	}
	if (factoriesCode) {
		filesToWrite.push({
			path: join(outDir, "factories.ts"),
			code: factoriesCode,
		});
	}

	for (const file of filesToWrite) {
		validateGeneratedSyntax(file.code, file.path);
	}

	// 8. Write output
	if (!dryRun) {
		await mkdir(outDir, { recursive: true });
		for (const file of filesToWrite) {
			await writeFile(file.path, file.code, "utf-8");
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
// Syntax validation
// ============================================================================

/**
 * Validate that generated TypeScript code is syntactically valid.
 *
 * Uses Bun's transpiler to parse the code. If parsing fails, throws a
 * descriptive error with the offending line — much easier to debug than
 * a runtime Vite/rolldown parse error in the browser.
 *
 * This catches template bugs like stray lines outside expressions,
 * unclosed brackets, duplicate declarations, etc.
 */
function validateGeneratedSyntax(code: string, filePath: string): void {
	try {
		const transpiler = new Bun.Transpiler({ loader: "ts" });
		transpiler.transformSync(code);
	} catch (err: any) {
		const msg = err?.message ?? String(err);
		const relPath = relative(process.cwd(), filePath);
		throw new Error(
			`[codegen] Generated code has syntax errors in ${relPath}:\n${msg}\n\n` +
				`This is a codegen bug — the template produced invalid TypeScript.`,
			{ cause: err },
		);
	}
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

				// Validate & write output
				const outputPath = join(targetOutDir, target.outputFile);
				validateGeneratedSyntax(output.code, outputPath);
				if (output.additionalFiles) {
					for (const [relPath, content] of Object.entries(
						output.additionalFiles,
					)) {
						validateGeneratedSyntax(content, join(targetOutDir, relPath));
					}
				}

				if (!dryRun) {
					await mkdir(targetOutDir, { recursive: true });
					await writeFile(outputPath, output.code, "utf-8");

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

	// Run cross-target validators from all plugins
	const validationErrors: ProjectionError[] = [];
	for (const plugin of plugins) {
		if (!plugin.validators) continue;
		for (const validator of plugin.validators) {
			const pluginErrors = validator(results);
			validationErrors.push(...pluginErrors);
		}
	}

	return { targets: results, errors, validationErrors };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Compute a relative import path between two absolute paths,
 * stripping the .ts extension.
 */
function computeRelativeImport(fromDir: string, toFile: string): string {
	let rel = relative(fromDir, toFile).replaceAll("\\", "/");
	// Remove .ts extension
	rel = rel.replace(/\.(ts|tsx|mts|mjs|js|jsx)$/, "");
	if (!rel.startsWith(".")) {
		rel = `./${rel}`;
	}
	return rel;
}
