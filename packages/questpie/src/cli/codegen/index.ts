/**
 * Codegen Orchestrator
 *
 * Main entry point for running codegen. Coordinates:
 * 1. File discovery
 * 2. Plugin execution
 * 3. Template generation (root app or module)
 * 4. File writing
 *
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import {
	CRDT_MANIFEST_FILENAME,
	validateCrdtManifestArtifact,
} from "#questpie/server/modules/core/integrated/crdt/manifest.js";

import { validateChannelWirePattern } from "./channel-pattern.js";
import { discoverFiles } from "./discover.js";
import { generateClientEnvModules } from "./env-client-template.js";
import { generateFactoryTemplate } from "./factory-template.js";
import { loadModuleFactoryArguments } from "./module-metadata.js";
import { generateModuleTemplate } from "./module-template.js";
import { generateTemplate } from "./template.js";
import type {
	CategoryDeclaration,
	CodegenContext,
	CodegenOptions,
	CodegenPlugin,
	CodegenResult,
	CodegenTargetContribution,
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
 * Always prepended to the plugin list in runCodegen(), and the owner of the
 * `server` target: it decides where that target writes, whatever else is
 * plugged in.
 */
export function coreCodegenPlugin(): CodegenPlugin {
	return {
		name: "questpie-core",
		targets: {
			server: {
				owner: true,
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
					channels: {
						dirs: ["channels"],
						prefix: "channel",
						factoryFunctions: ["channel"],
						factoryKeyStrategy: "export-or-filename",
						factoryArgument: {
							label: "wire pattern",
							requireLiteral: true,
							unique: true,
							validate: validateChannelWirePattern,
						},
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
					env: "env.ts",
					envClient: "env.client.ts",
					fields: { pattern: "fields.ts", registryKey: "~fieldTypes" },
					authConfig: { pattern: "config/auth.ts", configKey: "auth" },
					appConfig: { pattern: "config/app.ts", configKey: "app" },
				},
				registries: {
					singletonFactories: {
						appConfig: {
							configType: "AppConfigInput",
							imports: [{ name: "AppConfigInput", from: "questpie/types" }],
						},
						authConfig: {
							configType: "AuthConfig",
							imports: [{ name: "AuthConfig", from: "questpie/types" }],
						},
					},
				},
				callbackParams: {
					f: {
						factory: "createFieldNameProxy",
						from: "questpie/builders",
					},
				},
				scaffolds: {
					collection: {
						dir: "collections",
						description: "Collection definition",
						template: ({ kebab, camel }) =>
							`import { collection } from "#questpie/factories";\n\nexport const ${camel} = collection("${kebab}")\n\t.fields(({ f }) => ({\n\t\ttitle: f.text(255).label("Title").required(),\n\t}))\n\t.title(({ f }) => f.title);\n`,
					},
					channel: {
						dir: "channels",
						description: "Realtime channel definition",
						template: ({ kebab }) =>
							`import { channel } from "questpie/channels";\n\nexport default channel("${kebab}")\n\t.events({});\n`,
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
							`import { job } from "questpie/services";\nimport { z } from "zod";\n\nexport default job({\n\tname: "${kebab}",\n\tschema: z.object({}),\n\thandler: async () => {},\n});\n`,
					},
					service: {
						dir: "services",
						description: "Service definition",
						template: ({ camel }) =>
							`import { service } from "questpie/services";\n\nexport const ${camel}Service = service()\n\t.lifecycle("singleton")\n\t.create(() => {\n\t\treturn {};\n\t});\n`,
					},
					email: {
						dir: "emails",
						extension: ".tsx",
						description: "Email template",
						template: ({ kebab, title }) =>
							`import { email } from "questpie/services";\nimport { z } from "zod";\n\nexport default email({\n\tname: "${kebab}",\n\tschema: z.object({}),\n\thandler: async () => ({\n\t\tsubject: "${title}",\n\t\thtml: "<div>${title}</div>",\n\t}),\n});\n`,
					},
					route: {
						dir: "routes",
						description: "API route",
						template: () =>
							`import { route } from "questpie/services";\nimport { z } from "zod";\n\nexport default route()\n\t.post()\n\t.schema(z.object({}))\n\t.handler(async () => {\n\t\treturn {};\n\t});\n`,
					},
					seed: {
						dir: "seeds",
						description: "Database seed",
						template: ({ camel }) =>
							`import { seed } from "questpie/services";\n\nexport default seed({\n\tid: "${camel}",\n\tdescription: "TODO: describe what this seed does",\n\tcategory: "dev",\n\tasync run({ collections, globals, log }) {\n\t\tlog("Running ${camel} seed...");\n\t},\n});\n`,
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
							return `import { migration } from "questpie/services";\nimport { sql } from "drizzle-orm";\n\nexport default migration({\n\tid: "${camel}${timestamp}",\n\tasync up({ db }) {\n\t\t// TODO: implement migration\n\t},\n\tasync down({ db }) {\n\t\t// TODO: implement rollback\n\t},\n});\n`;
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
 * Every target has one owner. The owner alone decides `root`, `outDir`,
 * `outputFile`, `moduleRoot` and `generate`, so plugin order cannot change
 * where a target writes. Every other plugin contributes categories, discover
 * patterns, registries, callback params, transforms and scaffolds, which are
 * merged in plugin order.
 *
 * A contributor that is not the owner may still restate an owned field, but
 * only with the owner's exact value. A different value is an error rather than
 * a silent loss.
 */
export function resolveTargetGraph(
	plugins: CodegenPlugin[],
): Map<string, ResolvedTarget> {
	const targets = new Map<string, ResolvedTarget>();
	const owners = resolveTargetOwners(plugins);

	for (const [targetId, owner] of owners) {
		if (owner.contribution.root === undefined) {
			throw new Error(
				`[codegen] Target "${targetId}" has no root. ` +
					`Its owner, plugin "${owner.pluginName}", must declare one.`,
			);
		}
		if (owner.contribution.outputFile === undefined) {
			throw new Error(
				`[codegen] Target "${targetId}" has no outputFile. ` +
					`Its owner, plugin "${owner.pluginName}", must declare one.`,
			);
		}
		targets.set(targetId, {
			id: targetId,
			owner: owner.pluginName,
			root: owner.contribution.root,
			outDir: owner.contribution.outDir ?? ".generated",
			outputFile: owner.contribution.outputFile,
			moduleRoot: owner.contribution.moduleRoot,
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
			generate: owner.contribution.generate,
		});
	}

	for (const plugin of plugins) {
		for (const [targetId, contribution] of Object.entries(plugin.targets)) {
			// Every target id in `plugin.targets` was collected by
			// resolveTargetOwners(), so both of these always resolve.
			const target = targets.get(targetId) as ResolvedTarget;
			const owner = owners.get(targetId) as TargetOwner;

			if (contribution !== owner.contribution) {
				assertOwnedFieldMatches(target, plugin.name, "root", contribution.root);
				assertOwnedFieldMatches(
					target,
					plugin.name,
					"outDir",
					contribution.outDir,
				);
				assertOwnedFieldMatches(
					target,
					plugin.name,
					"outputFile",
					contribution.outputFile,
				);
				assertOwnedFieldMatches(
					target,
					plugin.name,
					"moduleRoot",
					contribution.moduleRoot,
				);
				if (contribution.generate) {
					throw new Error(
						`[codegen] Target "${targetId}" is owned by plugin "${target.owner}", ` +
							`so plugin "${plugin.name}" cannot provide a generator for it.`,
					);
				}
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
		}
	}

	assertDistinctOutputDirs(targets);

	return targets;
}

interface TargetOwner {
	pluginName: string;
	contribution: CodegenTargetContribution;
}

/**
 * Pick the owner of every target named by any plugin.
 *
 * A target claimed with `owner: true` belongs to that plugin. A target with a
 * single contributor owns itself, which keeps one-plugin targets free of
 * ceremony. Anything else is ambiguous and has to be spelled out.
 */
function resolveTargetOwners(
	plugins: CodegenPlugin[],
): Map<string, TargetOwner> {
	const contributors = new Map<string, TargetOwner[]>();
	const claimed = new Map<string, TargetOwner[]>();

	for (const plugin of plugins) {
		for (const [targetId, contribution] of Object.entries(plugin.targets)) {
			const entry = { pluginName: plugin.name, contribution };
			const all = contributors.get(targetId) ?? [];
			all.push(entry);
			contributors.set(targetId, all);
			if (contribution.owner) {
				const claims = claimed.get(targetId) ?? [];
				claims.push(entry);
				claimed.set(targetId, claims);
			}
		}
	}

	const owners = new Map<string, TargetOwner>();
	for (const [targetId, all] of contributors) {
		const claims = claimed.get(targetId) ?? [];
		if (claims.length > 1) {
			const names = claims.map((c) => `"${c.pluginName}"`).join(", ");
			throw new Error(
				`[codegen] Target "${targetId}" is claimed by more than one owner: ${names}. ` +
					`Exactly one plugin may declare owner: true.`,
			);
		}
		if (claims.length === 1) {
			owners.set(targetId, claims[0] as TargetOwner);
			continue;
		}
		if (all.length > 1) {
			const names = all.map((c) => `"${c.pluginName}"`).join(", ");
			throw new Error(
				`[codegen] Target "${targetId}" has no owner but several contributors: ${names}. ` +
					`Add owner: true to the plugin that decides where this target writes.`,
			);
		}
		owners.set(targetId, all[0] as TargetOwner);
	}

	return owners;
}

/**
 * Reject a non-owner that declares an owned field with a different value.
 *
 * Restating the owner's value is allowed and does nothing. Declaring another
 * one used to depend on which plugin ran first, so it is now an error.
 */
function assertOwnedFieldMatches(
	target: ResolvedTarget,
	pluginName: string,
	field: "root" | "outDir" | "outputFile" | "moduleRoot",
	value: string | undefined,
): void {
	if (value === undefined || value === target[field]) return;
	throw new Error(
		`[codegen] Target "${target.id}" is owned by plugin "${target.owner}", ` +
			`which set ${field} "${target[field]}". Plugin "${pluginName}" declares ` +
			`${field} "${value}". Drop it. Only the owner decides where a target writes.`,
	);
}

/**
 * Reject two targets that would write into the same directory.
 *
 * A run recreates its output directory before writing, so the second target
 * would erase the first one's files. Catching it here means the config fails
 * before anything is deleted.
 *
 * Package mode builds its own output directory from the module directory and
 * `moduleRoot`, so two targets can still collide there. Detecting that belongs
 * with the code that builds those paths, in cli/commands/codegen.ts.
 */
function assertDistinctOutputDirs(targets: Map<string, ResolvedTarget>): void {
	const claimedBy = new Map<string, string>();
	for (const [targetId, target] of targets) {
		const dir = join(target.root, target.outDir);
		const alreadyThere = claimedBy.get(dir);
		if (alreadyThere !== undefined) {
			throw new Error(
				`[codegen] Targets "${alreadyThere}" and "${targetId}" both write to "${dir}". ` +
					`A target recreates its output directory on every run, so one would erase the other. ` +
					`Give them different roots or a different outDir.`,
			);
		}
		claimedBy.set(dir, targetId);
	}
}

// ============================================================================
// Main codegen function
// ============================================================================

/**
 * Run codegen: resolve target graph, discover files, run transforms, generate output.
 *
 * Output comes from the target's own `generate` function when it has one, and
 * from the built-in templates otherwise. When `options.module` is set the
 * output is a package module (`module.ts`); otherwise it is the app itself
 * (the target's `outputFile`, plus `factories.ts` for template targets).
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
	const externalFactoryArguments = await loadModuleFactoryArguments(rootDir);
	const discovered = await discoverFiles(rootDir, outDir, {
		categories: target.categories,
		discover: target.discover,
		externalFactoryArguments,
	});

	// 2b. Warn about files with named exports (not default)
	// Skip warnings for categories with factoryFunctions — named exports are expected there.
	// Skip them entirely for a target with its own generator: the default export
	// convention is the built-in templates' convention, not every target's.
	const factoryCategories = new Set<string>();
	for (const [catName, decl] of Object.entries(target.categories)) {
		if (decl.factoryFunctions && decl.factoryFunctions.length > 0) {
			factoryCategories.add(catName);
		}
	}

	if (!target.generate) {
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
	}

	// Route collision check removed — all routes (auth, search, realtime, etc.)
	// are now core module route definitions, not reserved HTTP adapter prefixes.
	// The trie-based matcher handles priority: literal > param > wildcard.

	// 3. Build codegen context for transforms
	const extraImports: Array<{ name: string; path: string }> = [];
	const extraTypeDeclarations: string[] = [];
	const extraRuntimeCode: string[] = [];
	const extraEntities = new Map<string, string>();
	if (!options.module && targetId === "server") {
		const manifestPath = join(rootDir, CRDT_MANIFEST_FILENAME);
		try {
			const artifact = validateCrdtManifestArtifact(
				JSON.parse(await readFile(manifestPath, "utf8")),
			);
			extraEntities.set("crdtManifest", JSON.stringify(artifact));
		} catch (error) {
			if (
				!error ||
				typeof error !== "object" ||
				!("code" in error) ||
				error.code !== "ENOENT"
			) {
				throw error;
			}
		}
	}

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

	// 5. Generate output: the target's own generator, or a built-in template
	let code: string;
	let outputFile: string;

	// Every file written below carries this in its header, so resolve it once.
	// Files from one run sit in one directory, and two of them naming different
	// commands is how a reader ends up running the one that fails.
	const regenerateCommand = await resolveRegenerateCommand(configPath);

	// Track additional files to write (e.g. registries.ts for module augmentations)
	let moduleRegistriesCode: string | null = null;

	// Files written next to the primary output: the root-app layer files
	// (names.gen.ts/entities.gen.ts/context.gen.ts), or whatever a target
	// generator returned as additionalFiles.
	let extraOutputFiles: Array<{ name: string; code: string }> = [];

	if (target.generate) {
		// A target that brings its own generator uses it in both modes. In module
		// mode the generator is told the module name, because what it has to emit
		// there is a module definition rather than the app-level output.
		outputFile = options.module
			? (options.module.outputFile ?? "module.ts")
			: target.outputFile;
		const output = await target.generate({
			target,
			discovered,
			regenerateCommand,
			extraImports,
			extraTypeDeclarations,
			extraRuntimeCode,
			extraEntities,
			module: options.module ? { name: options.module.name } : undefined,
		});
		code = output.code;
		extraOutputFiles = Object.entries(output.additionalFiles ?? {}).map(
			([name, content]) => ({ name, code: content }),
		);
	} else if (options.module) {
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
			regenerateCommand,
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
		const appInstanceId = await resolveGeneratedAppInstanceId(
			rootDir,
			configPath,
		);
		const tpl = generateTemplate({
			configImportPath,
			regenerateCommand,
			appInstanceId,
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
		code = tpl.code;
		extraOutputFiles = tpl.extraFiles;
	}

	// 6. Always generate factories.ts for root app mode
	// Even with zero extensions, factories.ts exports collection()/global()
	// so users always import from #questpie/factories (stable import path).
	// A target with its own generator owns its whole output, so it gets none.
	let factoriesCode: string | null = null;
	if (!options.module && !target.generate) {
		const hasModules = discovered.singles.has("modules");
		// Check if user has a fields.ts singleton for custom field types
		const userFieldsFile = discovered.singles.get("fields");
		factoriesCode = generateFactoryTemplate({
			target,
			hasModules,
			regenerateCommand,
			userFieldsImportPath: userFieldsFile?.importPath,
			discoveredCategories: discovered.categories,
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
	for (const f of extraOutputFiles) {
		filesToWrite.push({ path: join(outDir, f.name), code: f.code });
	}

	// Client env modules — one per consumer declared in env.client.ts.
	// Root app mode only (module-contributed env is a separate concern).
	if (!options.module && !target.generate) {
		const envClientFile = discovered.singles.get("envClient");
		if (envClientFile) {
			const clientEnvModules = await generateClientEnvModules(
				envClientFile,
				regenerateCommand,
			);
			for (const mod of clientEnvModules) {
				filesToWrite.push({
					path: join(outDir, mod.fileName),
					code: mod.code,
				});
			}
		}
	}

	// Every path is known before anything is written. Two files claiming one
	// path would leave whichever came last, so say so instead.
	const claimedPaths = new Set<string>();
	for (const file of filesToWrite) {
		if (claimedPaths.has(file.path)) {
			throw new Error(
				`[codegen] Target "${targetId}" produced "${file.path}" twice. ` +
					`This is a codegen bug: two generated files claim the same path.`,
			);
		}
		claimedPaths.add(file.path);
		validateGeneratedSyntax(file.code, file.path);
	}

	// 8. Write output
	if (!dryRun) {
		await writeGeneratedFiles(outDir, filesToWrite);
	}

	return {
		targetId,
		code,
		outputPath,
		discovered,
	};
}

/**
 * Build the command that regenerates a file, for its header comment.
 *
 * `-c` is resolved against the working directory, and the working directory
 * for codegen is the package root, so the config path is printed relative to
 * the nearest package.json. That also keeps the header identical no matter
 * where the run was launched from, which matters because generated files are
 * committed. A config at the CLI default location needs no flag at all.
 */
async function resolveRegenerateCommand(configPath: string): Promise<string> {
	const absoluteConfigPath = resolve(configPath);
	const configDir = dirname(absoluteConfigPath);
	let packageRoot = configDir;
	let directory = configDir;
	while (true) {
		try {
			await stat(join(directory, "package.json"));
			packageRoot = directory;
			break;
		} catch {
			// Keep walking up; programmatic codegen may run outside a package.
		}
		const parent = dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
	const relativeConfigPath = normalizeIdentityPath(
		relative(packageRoot, absoluteConfigPath),
	);
	if (relativeConfigPath === "questpie.config.ts") return "questpie generate";
	return `questpie generate -c ${relativeConfigPath}`;
}

async function resolveGeneratedAppInstanceId(
	rootDir: string,
	configPath: string,
): Promise<string> {
	let directory = resolve(rootDir);
	while (true) {
		try {
			const packageJson = JSON.parse(
				await readFile(join(directory, "package.json"), "utf8"),
			) as { name?: unknown };
			if (typeof packageJson.name === "string" && packageJson.name.length > 0) {
				return [
					packageJson.name,
					normalizeIdentityPath(relative(directory, rootDir)) || ".",
					normalizeIdentityPath(relative(directory, configPath)),
				].join(":");
			}
		} catch {
			// Continue to the parent; programmatic codegen may start below it.
		}
		const parent = dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
	return `questpie:${normalizeIdentityPath(relative(rootDir, configPath))}`;
}

function normalizeIdentityPath(path: string): string {
	return path.replaceAll("\\", "/");
}

/**
 * Write via temp file + rename so a concurrent or killed run can never leave
 * a truncated/interleaved .generated file behind (rename is atomic within
 * the same directory).
 */
async function atomicWriteFile(path: string, code: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tmpPath = `${path}.${process.pid}.tmp`;
	await writeFile(tmpPath, code, "utf-8");
	await rename(tmpPath, path);
}

/**
 * A codegen target owns its output directory. Recreate it on every non-dry run
 * so files from removed conventions (for example env.client.* modules) cannot
 * remain visible after regeneration.
 */
async function writeGeneratedFiles(
	outDir: string,
	files: Array<{ path: string; code: string }>,
): Promise<void> {
	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });
	for (const file of files) {
		await atomicWriteFile(file.path, file.code);
	}
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
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
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
 * Every target goes through `runCodegen()`, including the ones that bring their
 * own generator. One code path means a target cannot quietly lose a feature by
 * running somewhere else.
 *
 * Non-server targets resolve their `root` relative to `rootDir` (the server root).
 * e.g., `root: "../admin"` → `resolve(rootDir, "../admin")`.
 *
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
			const result = await runCodegen({
				rootDir: targetRootDir,
				configPath,
				outDir: join(targetRootDir, target.outDir),
				plugins: userPlugins,
				dryRun,
				targetId,
			});
			results.set(targetId, result);
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
