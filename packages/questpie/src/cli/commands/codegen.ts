/**
 * Codegen CLI Commands
 *
 * `questpie generate` — one-shot codegen
 * `questpie dev` — watch mode, regenerate on file add/remove
 *
 * @see RFC §16 (CLI Commands), §16.1 (Watch Mode Granularity)
 */

import { watch } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
	coreCodegenPlugin,
	resolveTargetGraph,
	runAllTargets,
	runCodegen,
} from "../codegen/index.js";
import { extractPluginsFromModules } from "../codegen/extract-plugins.js";
import type {
	CodegenPlugin,
	MultiTargetCodegenResult,
} from "../codegen/types.js";
import { isPackageConfig, type PackageConfig } from "../config.js";

// ============================================================================
// generate command
// ============================================================================

export interface GenerateOptions {
	/** Path to questpie.config.ts (relative to cwd). */
	configPath: string;
	/** Dry run — show output without writing. */
	dryRun?: boolean;
	/** Verbose output. */
	verbose?: boolean;
}

/**
 * Resolve the entity root directory from a config file path.
 *
 * When `questpie.config.ts` lives at the project root and re-exports from
 * a deeper server directory, codegen must follow the re-export to find entities.
 *
 * Supports two patterns:
 *   1. `export { default } from "./src/questpie/server/questpie.config"` — re-export
 *   2. Direct config (config file IS the entity root) — current behavior
 *
 * @returns { configPath, rootDir } — resolved inner config path and entity root dir
 */
export async function resolveEntityRoot(
	configPath: string,
): Promise<{ configPath: string; rootDir: string }> {
	let content: string;
	try {
		content = await readFile(configPath, "utf-8");
	} catch {
		return { configPath, rootDir: dirname(configPath) };
	}

	// Detect re-export pattern: export { default } from "..."
	const reExportMatch = content.match(
		/^\s*export\s*\{\s*default\s*\}\s*from\s*["']([^"']+)["']/m,
	);
	if (!reExportMatch) {
		return { configPath, rootDir: dirname(configPath) };
	}

	// Resolve the inner config path
	const innerRaw = resolve(dirname(configPath), reExportMatch[1]);
	// Try with and without .ts extension
	for (const candidate of [innerRaw, `${innerRaw}.ts`, `${innerRaw}.mts`]) {
		try {
			await stat(candidate);
			return { configPath: candidate, rootDir: dirname(candidate) };
		} catch {
			// try next
		}
	}

	// Re-export target not found — fall back to config dir
	return { configPath, rootDir: dirname(configPath) };
}

/**
 * Result of loading a questpie.config.ts for codegen.
 */
interface ConfigLoadResult {
	plugins: CodegenPlugin[];
	/** When set, codegen runs in module mode (generates module.ts instead of index.ts). */
	module?: { name: string; outputFile?: string };
	/** When set, config is a PackageConfig — orchestrate multi-module codegen. */
	packageConfig?: PackageConfig;
}

/**
 * Load codegen config from questpie.config.ts.
 *
 * Supports three config shapes:
 * - **Root app config**: `runtimeConfig({ plugins: [...], ... })` → root app mode
 * - **Module config**: `{ module: { name: "..." }, plugins: [...] }` → module mode
 * - **Package config**: `packageConfig({ modulesDir: "...", ... })` → multi-module orchestration
 *
 * The `module` and `packageConfig` fields are only used for package-internal
 * codegen (dev-time only, not distributed). When `packageConfig` is detected,
 * the caller should iterate over module subdirectories.
 *
 * @param configPath — absolute path to the resolved questpie.config.ts
 */
export async function loadConfigForCodegen(
	configPath: string,
): Promise<ConfigLoadResult> {
	try {
		const configModule = await import(/* @vite-ignore */ configPath);
		const config = configModule.default || configModule.config || configModule;

		// PackageConfig mode: iterate over modulesDir subdirectories
		if (isPackageConfig(config)) {
			return {
				plugins: Array.isArray(config.plugins) ? config.plugins : [],
				packageConfig: config,
			};
		}

		const plugins: CodegenPlugin[] =
			config && Array.isArray(config.plugins) ? config.plugins : [];

		// Module mode: config has { module: { name: "..." } }
		const moduleOpt =
			config?.module && typeof config.module.name === "string"
				? {
						name: config.module.name as string,
						outputFile: config.module.outputFile as string | undefined,
					}
				: undefined;

		return { plugins, module: moduleOpt };
	} catch (error) {
		// Config import failed (missing deps, syntax error, etc.)
		// Fall back gracefully — codegen can still run without config-defined plugins
		const reason =
			error instanceof Error
				? error.message
				: typeof error === "string"
					? error
					: String(error);
		console.warn(
			`Warning: Could not load plugins from config (${configPath}).\n  Reason: ${reason}`,
		);
		if (error instanceof Error && error.stack) {
			// Show the first relevant stack frame (skip the error line itself)
			const frames = error.stack.split("\n").slice(1, 4);
			if (frames.length > 0) {
				console.warn(
					`  Stack:\n${frames.map((f) => `    ${f.trim()}`).join("\n")}`,
				);
			}
		}
		return { plugins: [] };
	}
}

/**
 * Run codegen once — produces .generated/index.ts (root app) or .generated/module.ts (module).
 *
 * Mode is determined by the config file:
 * - Root app: `runtimeConfig({ ... })` → generates index.ts + factories.ts
 * - Module: `{ module: { name: "..." } }` → generates module.ts only
 * - Package: `packageConfig({ modulesDir: "..." })` → iterates module subdirectories
 */
export async function generateCommand(options: GenerateOptions): Promise<void> {
	const rawConfigPath = resolve(process.cwd(), options.configPath);
	const { configPath, rootDir } = await resolveEntityRoot(rawConfigPath);

	// Load plugins + module/package config from questpie.config.ts
	const {
		plugins,
		module: moduleOpt,
		packageConfig: pkgConfig,
	} = await loadConfigForCodegen(configPath);

	// ── Package mode: iterate over modulesDir subdirectories ──
	if (pkgConfig) {
		await generatePackageModules(rootDir, configPath, pkgConfig, options);
		return;
	}

	// ── Single mode: root app or single module ──
	if (moduleOpt) {
		// Module mode: single-target codegen (always "server")
		const outDir = join(rootDir, ".generated");
		const outputFile = moduleOpt.outputFile ?? "module.ts";

		console.log(`Discovering files for module "${moduleOpt.name}"...`);
		if (options.verbose) {
			console.log(`  Root: ${rootDir}`);
			console.log(`  Config: ${configPath}`);
			console.log(`  Output: ${outDir}/${outputFile}`);
			console.log(`  Mode: module`);
		}

		const result = await runCodegen({
			rootDir,
			configPath,
			outDir,
			plugins,
			dryRun: options.dryRun,
			module: moduleOpt,
		});

		printTargetResult(result, options);
	} else {
		// Root app mode: multi-target codegen (all targets)
		console.log("Discovering files...");
		if (options.verbose) {
			console.log(`  Root: ${rootDir}`);
			console.log(`  Config: ${configPath}`);
		}

		// Pre-pass: extract codegen plugins from modules.ts
		const allPlugins = await extractModulePlugins(rootDir, plugins, options);

		const multiResult = await runAllTargets({
			rootDir,
			configPath,
			plugins: allPlugins,
			dryRun: options.dryRun,
		});

		const hasErrors = printMultiTargetResult(multiResult, options);
		if (hasErrors) {
			process.exitCode = 1;
		}
	}
}

/**
 * Orchestrate multi-module codegen for a PackageConfig.
 *
 * Scans `modulesDir` for subdirectories, derives module names from
 * `${modulePrefix}-${dirName}`, and runs `runCodegen()` in module mode
 * for each one.
 */
async function generatePackageModules(
	configRootDir: string,
	configPath: string,
	pkgConfig: PackageConfig,
	options: GenerateOptions,
): Promise<void> {
	const modulesDir = resolve(configRootDir, pkgConfig.modulesDir);

	// Scan modulesDir for subdirectories
	let entries: import("node:fs").Dirent[];
	try {
		entries = await readdir(modulesDir, { withFileTypes: true });
	} catch {
		console.error(
			`Package modulesDir not found: ${modulesDir}\n` +
				`Check the 'modulesDir' path in your packageConfig().`,
		);
		return;
	}

	const moduleDirs = entries
		.filter((e) => e.isDirectory() && !e.name.startsWith("."))
		.sort((a, b) => a.name.localeCompare(b.name));

	if (moduleDirs.length === 0) {
		console.log(`No module directories found in ${modulesDir}`);
		return;
	}

	const prefix = pkgConfig.modulePrefix ?? "questpie";
	const plugins = Array.isArray(pkgConfig.plugins) ? pkgConfig.plugins : [];

	// Build import rewrite map from package.json
	// When plugin transforms add imports like "@questpie/admin/server", they
	// must be rewritten to the internal subpath alias (e.g. "#questpie/admin/server/index.js")
	// because TypeScript resolves the "types" export condition to stale dist/ types.
	const importRewriteMap = await buildImportRewriteMap(configRootDir);

	// Resolve target graph to discover all targets (server, admin-client, etc.)
	const allPlugins = [coreCodegenPlugin(), ...plugins];
	const targetGraph = resolveTargetGraph(allPlugins);

	console.log(
		`Package mode: generating ${moduleDirs.length} module(s) from ${pkgConfig.modulesDir}/`,
	);

	for (const dir of moduleDirs) {
		const moduleRootDir = join(modulesDir, dir.name);
		const moduleName = `${prefix}-${dir.name}`;

		console.log(`\n  Module: ${moduleName}`);

		// Iterate all resolved targets for this module
		for (const [targetId, target] of targetGraph) {
			// Determine discovery root: use moduleRoot subdirectory if specified
			const discoveryRoot = target.moduleRoot
				? join(moduleRootDir, target.moduleRoot)
				: moduleRootDir;

			// Skip targets whose moduleRoot doesn't exist in this module
			if (target.moduleRoot) {
				try {
					await stat(discoveryRoot);
				} catch {
					if (options.verbose) {
						console.log(
							`    [${targetId}] Skipped (${target.moduleRoot}/ not found)`,
						);
					}
					continue;
				}
			}

			const moduleOutDir = join(discoveryRoot, ".generated");

			if (options.verbose) {
				console.log(`    [${targetId}] Root: ${discoveryRoot}`);
				console.log(`    [${targetId}] Output: ${moduleOutDir}/module.ts`);
			}

			const result = await runCodegen({
				rootDir: discoveryRoot,
				configPath,
				outDir: moduleOutDir,
				plugins,
				dryRun: options.dryRun,
				targetId,
				module: { name: moduleName, importRewriteMap },
			});

			printTargetResult(result, options, "    ");
		}
	}

	console.log(`\nDone: ${moduleDirs.length} module(s) generated.`);
}

/**
 * Build an import rewrite map for self-package imports.
 *
 * Reads `package.json` to find the package name and `tsconfig.json` to find
 * the internal subpath alias. Maps the external package name to the internal
 * alias so generated modules don't reference stale dist/ types.
 *
 * @example
 * package.json: { "name": "@questpie/admin" }
 * tsconfig.json: { "paths": { "#questpie/admin/*": ["./src/*"] } }
 * → { "@questpie/admin": "#questpie/admin" }
 */
async function buildImportRewriteMap(
	packageDir: string,
): Promise<Record<string, string> | undefined> {
	try {
		const pkgJsonPath = join(packageDir, "package.json");
		const pkgJsonContent = await readFile(pkgJsonPath, "utf-8");
		const pkgJson = JSON.parse(pkgJsonContent);
		const pkgName = pkgJson.name;
		if (!pkgName) return undefined;

		// Try to find matching tsconfig paths alias
		const tsconfigPath = join(packageDir, "tsconfig.json");
		let tsconfigContent: string;
		try {
			tsconfigContent = await readFile(tsconfigPath, "utf-8");
		} catch {
			return undefined;
		}

		// Parse tsconfig (strip JSON comments — single-line and block)
		// The regex avoids stripping // inside string values (e.g. URLs)
		const stripped = tsconfigContent.replace(
			/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
			(match, stringLiteral) => stringLiteral ?? "",
		);
		const tsconfig = JSON.parse(stripped);
		const paths = tsconfig?.compilerOptions?.paths;
		if (!paths || typeof paths !== "object") return undefined;

		// Look for a path alias that maps to the package source
		// e.g. "#questpie/admin/*" → ["./src/*"]
		for (const alias of Object.keys(paths)) {
			// Strip trailing /* from alias to get the prefix
			const aliasPrefix = alias.replace(/\/\*$/, "");
			// Check if this alias could be a rewrite target for the package name
			// Convention: "#<scope>/<name>/*" for "@<scope>/<name>"
			// or "#<name>/*" for "<name>"
			if (
				aliasPrefix.startsWith("#") &&
				(pkgName.replace("@", "#") === aliasPrefix ||
					pkgName.replace("@", "") ===
						aliasPrefix.replace("#", "").replace("/", "-"))
			) {
				return { [pkgName]: aliasPrefix };
			}
		}

		return undefined;
	} catch {
		return undefined;
	}
}

/**
 * Print multi-target codegen result summary.
 *
 * @returns `true` if there are hard errors (target errors or validation errors with severity "error")
 */
function printMultiTargetResult(
	result: MultiTargetCodegenResult,
	options: GenerateOptions,
): boolean {
	const targetCount = result.targets.size;
	if (targetCount > 1) {
		console.log(`\nGenerated ${targetCount} target(s):`);
	}

	for (const [targetId, targetResult] of result.targets) {
		if (targetCount > 1) {
			console.log(`\n  Target: ${targetId}`);
		}
		const indent = targetCount > 1 ? "    " : "";
		printTargetResult(targetResult, options, indent);
	}

	// Print target errors
	for (const { targetId, error } of result.errors) {
		console.error(`\nError in target "${targetId}": ${error.message}`);
	}

	// Print validation errors
	let hasValidationErrors = false;
	if (result.validationErrors.length > 0) {
		const errors = result.validationErrors.filter(
			(e) => e.severity === "error",
		);
		const warnings = result.validationErrors.filter(
			(e) => e.severity === "warning",
		);

		if (errors.length > 0) {
			hasValidationErrors = true;
			console.error(
				`\nProjection mismatch: ${errors.length} error(s) found.\n`,
			);
			for (const err of errors) {
				console.error(`  [${err.category}] ${err.message}`);
			}
		}

		if (warnings.length > 0) {
			console.warn(`\nProjection warnings: ${warnings.length}\n`);
			for (const warn of warnings) {
				console.warn(`  [${warn.category}] ${warn.message}`);
			}
		}
	}

	return result.errors.length > 0 || hasValidationErrors;
}

/**
 * Print single target codegen result summary.
 */
function printTargetResult(
	result: import("../codegen/types.js").CodegenResult,
	options: GenerateOptions,
	indent = "",
): void {
	const d = result.discovered;
	const counts: string[] = [];
	for (const [catName, fileMap] of d.categories) {
		if (fileMap.size > 0) counts.push(`${fileMap.size} ${catName}`);
	}
	if (d.singles.has("auth")) counts.push("auth");

	if (counts.length === 0) {
		console.log(
			`${indent}No entity files found. Make sure your files are in the correct directories.`,
		);
		return;
	}

	console.log(`${indent}Found: ${counts.join(", ")}`);

	if (options.dryRun) {
		console.log(`\n${indent}--- Generated code (dry run) ---\n`);
		console.log(result.code);
	} else {
		console.log(`${indent}Generated: ${result.outputPath}`);
	}

	if (options.verbose) {
		printDiscovered(d);
	}
}

// ============================================================================
// dev (watch) command
// ============================================================================

export interface DevOptions {
	/** Path to questpie.config.ts (relative to cwd). */
	configPath: string;
	/** Verbose output. */
	verbose?: boolean;
}

/**
 * Watch mode — regenerate on file add/remove across all targets.
 *
 * Per RFC §16.1:
 * - File added/removed → regenerate all targets
 * - File content modified → NO regeneration (typeof import is stable)
 * - Config modified → full regeneration
 *
 * Multi-target aware: resolves the full target graph, computes watch
 * directories for all targets (including non-server targets with different
 * roots like `../admin`), and regenerates everything on change.
 *
 * @see RFC §16.1 (Watch Mode Granularity)
 * @see PLAN-PLUGIN-CONSISTENCY.md §5 (Codegen Orchestration Model)
 */
export async function devCommand(options: DevOptions): Promise<void> {
	// Run initial generation
	await generateCommand({
		configPath: options.configPath,
		verbose: options.verbose,
	});

	const rawConfigPath = resolve(process.cwd(), options.configPath);
	const { configPath, rootDir } = await resolveEntityRoot(rawConfigPath);
	const {
		plugins: userPlugins,
		module: moduleOpt,
		packageConfig: pkgConfig,
	} = await loadConfigForCodegen(configPath);

	// For package mode, we watch the entire modulesDir and regenerate all modules
	// when any file changes. This is simpler and handles cross-module changes.
	if (pkgConfig) {
		await watchPackageModules(rootDir, configPath, pkgConfig, options);
		return;
	}

	// Module mode — single target, simple watch
	if (moduleOpt) {
		await watchSingleTarget(
			rootDir,
			configPath,
			userPlugins,
			moduleOpt,
			options,
		);
		return;
	}

	// Root app mode — multi-target watch
	// Resolve target graph to know all roots and directories to watch
	const allPlugins = [coreCodegenPlugin(), ...(userPlugins ?? [])];
	const targetGraph = resolveTargetGraph(allPlugins);

	// Collect all watch directories across all targets
	// Key = absolute directory path, Value = set of relative dirs within it
	const watchRoots = new Map<string, Set<string>>();

	for (const [_targetId, target] of targetGraph) {
		const targetRootDir = resolve(rootDir, target.root);

		// Get or create watch dir set for this root
		let watchDirs = watchRoots.get(targetRootDir);
		if (!watchDirs) {
			watchDirs = new Set<string>();
			watchRoots.set(targetRootDir, watchDirs);
		}

		// Add category directories
		for (const cat of Object.values(target.categories)) {
			for (const dir of cat.dirs) {
				watchDirs.add(dir);
			}
		}

		// Add "features" directory (always watched for server root)
		if (target.root === ".") {
			watchDirs.add("features");
		}

		// Add directories from discover patterns
		for (const pattern of Object.values(target.discover)) {
			const patternStr =
				typeof pattern === "string" ? pattern : pattern.pattern;
			const dirMatch = patternStr.match(/^([^/*]+)\//);
			if (dirMatch) {
				watchDirs.add(dirMatch[1]);
			}
		}
	}

	console.log("\nWatching for file changes...");
	if (options.verbose) {
		for (const [root, dirs] of watchRoots) {
			console.log(`  Root: ${root}`);
			console.log(`    Dirs: ${[...dirs].join(", ")}`);
		}
	}
	console.log("  (Press Ctrl+C to stop)\n");

	// Track file sets per directory to detect add/remove
	const fileSets = new Map<string, Set<string>>();

	// Initialize file sets for all watched directories
	for (const [targetRoot, dirs] of watchRoots) {
		for (const dir of dirs) {
			const dirPath = join(targetRoot, dir);
			const files = await listFilesRecursive(dirPath);
			const key = dirPath; // Use absolute path as key for uniqueness
			fileSets.set(key, new Set(files));
		}
	}

	// Debounce timer
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	const scheduleRegenerate = (reason: string) => {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(async () => {
			console.log(`Regenerating all targets... (${reason})`);
			try {
				const multiResult = await runAllTargets({
					rootDir,
					configPath,
					plugins: userPlugins,
				});

				for (const [targetId, result] of multiResult.targets) {
					console.log(`  Updated [${targetId}]: ${result.outputPath}`);
				}
				for (const { targetId, error } of multiResult.errors) {
					console.error(`  Error [${targetId}]: ${error.message}`);
				}
				for (const err of multiResult.validationErrors) {
					const prefix = err.severity === "error" ? "Error" : "Warning";
					console.error(`  ${prefix} [${err.category}]: ${err.message}`);
				}
			} catch (error) {
				console.error("Codegen error:", error);
			}
		}, 100);
	};

	// Watch config file for any change
	const configWatcher = watch(configPath, () => {
		scheduleRegenerate("config changed");
	});

	// Watch entity directories for file add/remove across all target roots
	const watchers: ReturnType<typeof watch>[] = [configWatcher];

	for (const [targetRoot, dirs] of watchRoots) {
		for (const dir of dirs) {
			const dirPath = join(targetRoot, dir);
			try {
				await stat(dirPath);
			} catch {
				continue; // Directory doesn't exist, skip
			}

			const watcher = watch(
				dirPath,
				{ recursive: true },
				async (_event, filename) => {
					if (!filename) return;
					// Ignore .generated directory and non-TS files
					if (filename.includes(".generated")) return;
					if (!/\.(ts|tsx|mts)$/.test(filename)) return;

					// Check if file set changed (add/remove)
					const currentFiles = await listFilesRecursive(dirPath);
					const currentSet = new Set(currentFiles);
					const previousSet = fileSets.get(dirPath) || new Set();

					const added = [...currentSet].filter((f) => !previousSet.has(f));
					const removed = [...previousSet].filter((f) => !currentSet.has(f));

					if (added.length > 0 || removed.length > 0) {
						fileSets.set(dirPath, currentSet);
						const changes: string[] = [];
						for (const f of added) changes.push(`+ ${f}`);
						for (const f of removed) changes.push(`- ${f}`);
						scheduleRegenerate(changes.join(", "));
					}
					// Content-only changes → skip (typeof import is stable)
				},
			);

			watchers.push(watcher);
		}
	}

	// Keep process alive
	process.on("SIGINT", () => {
		for (const w of watchers) w.close();
		console.log("\nStopped watching.");
		process.exit(0);
	});

	// Prevent Node from exiting
	await new Promise(() => {});
}

/**
 * Simple watch mode for module codegen — watches a single target root.
 * Used in module mode where multi-target doesn't apply.
 */
async function watchSingleTarget(
	rootDir: string,
	configPath: string,
	plugins: CodegenPlugin[],
	moduleOpt: { name: string; outputFile?: string },
	options: DevOptions,
): Promise<void> {
	const outDir = join(rootDir, ".generated");

	// Build watch dirs from plugin targets
	const watchDirs = new Set([
		"collections",
		"globals",
		"jobs",
		"functions",
		"routes",
		"messages",
		"migrations",
		"seeds",
		"features",
	]);

	const allPlugins = [coreCodegenPlugin(), ...(plugins ?? [])];
	for (const plugin of allPlugins) {
		for (const contribution of Object.values(plugin.targets)) {
			if (!contribution.discover) continue;
			for (const pattern of Object.values(contribution.discover)) {
				const patternStr =
					typeof pattern === "string" ? pattern : pattern.pattern;
				const dirMatch = patternStr.match(/^([^/*]+)\//);
				if (dirMatch) {
					watchDirs.add(dirMatch[1]);
				}
			}
		}
	}

	console.log("\nWatching for file changes...");
	console.log("  (Press Ctrl+C to stop)\n");

	const fileSets = new Map<string, Set<string>>();
	for (const dir of watchDirs) {
		const dirPath = join(rootDir, dir);
		const files = await listFilesRecursive(dirPath);
		fileSets.set(dir, new Set(files));
	}

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	const scheduleRegenerate = (reason: string) => {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(async () => {
			console.log(`Regenerating... (${reason})`);
			try {
				const result = await runCodegen({
					rootDir,
					configPath,
					outDir,
					plugins,
					module: moduleOpt,
				});
				console.log(`Updated: ${result.outputPath}`);
			} catch (error) {
				console.error("Codegen error:", error);
			}
		}, 100);
	};

	const configWatcher = watch(configPath, () => {
		scheduleRegenerate("config changed");
	});

	const watchers: ReturnType<typeof watch>[] = [configWatcher];

	for (const dir of watchDirs) {
		const dirPath = join(rootDir, dir);
		try {
			await stat(dirPath);
		} catch {
			continue;
		}

		const watcher = watch(
			dirPath,
			{ recursive: true },
			async (_event, filename) => {
				if (!filename) return;
				if (filename.includes(".generated")) return;
				if (!/\.(ts|tsx|mts)$/.test(filename)) return;

				const currentFiles = await listFilesRecursive(dirPath);
				const currentSet = new Set(currentFiles);
				const previousSet = fileSets.get(dir) || new Set();

				const added = [...currentSet].filter((f) => !previousSet.has(f));
				const removed = [...previousSet].filter((f) => !currentSet.has(f));

				if (added.length > 0 || removed.length > 0) {
					fileSets.set(dir, currentSet);
					const changes: string[] = [];
					for (const f of added) changes.push(`+ ${f}`);
					for (const f of removed) changes.push(`- ${f}`);
					scheduleRegenerate(changes.join(", "));
				}
			},
		);

		watchers.push(watcher);
	}

	process.on("SIGINT", () => {
		for (const w of watchers) w.close();
		console.log("\nStopped watching.");
		process.exit(0);
	});

	await new Promise(() => {});
}

/**
 * Watch mode for PackageConfig — watches the modulesDir and regenerates
 * all module definitions on file add/remove.
 */
async function watchPackageModules(
	configRootDir: string,
	configPath: string,
	pkgConfig: PackageConfig,
	options: DevOptions,
): Promise<void> {
	const modulesDir = resolve(configRootDir, pkgConfig.modulesDir);
	const prefix = pkgConfig.modulePrefix ?? "questpie";
	const plugins = Array.isArray(pkgConfig.plugins) ? pkgConfig.plugins : [];

	console.log(`\nWatching ${pkgConfig.modulesDir}/ for file changes...`);
	console.log("  (Press Ctrl+C to stop)\n");

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	const scheduleRegenerate = (reason: string) => {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(async () => {
			console.log(`Regenerating all modules... (${reason})`);
			try {
				await generatePackageModules(configRootDir, configPath, pkgConfig, {
					configPath: options.configPath,
					verbose: options.verbose,
				});
			} catch (error) {
				console.error("Codegen error:", error);
			}
		}, 100);
	};

	// Watch config file
	const configWatcher = watch(configPath, () => {
		scheduleRegenerate("config changed");
	});

	// Watch entire modulesDir recursively
	const modulesWatcher = watch(
		modulesDir,
		{ recursive: true },
		async (_event, filename) => {
			if (!filename) return;
			if (filename.includes(".generated")) return;
			if (!/\.(ts|tsx|mts)$/.test(filename)) return;
			scheduleRegenerate(filename);
		},
	);

	process.on("SIGINT", () => {
		configWatcher.close();
		modulesWatcher.close();
		console.log("\nStopped watching.");
		process.exit(0);
	});

	await new Promise(() => {});
}

// ============================================================================
// Helpers
// ============================================================================

function printDiscovered(
	d: import("../codegen/types.js").DiscoveryResult,
): void {
	const printMap = (label: string, map: Map<string, any>) => {
		if (map.size === 0) return;
		console.log(`\n  ${label}:`);
		for (const [key, file] of map) {
			console.log(`    ${key} <- ${file.source}`);
		}
	};

	for (const [catName, fileMap] of d.categories) {
		const label = catName.charAt(0).toUpperCase() + catName.slice(1);
		printMap(label, fileMap);
	}
	for (const [key, file] of d.singles) {
		console.log(`\n  ${key}: ${file.source}`);
	}
}

/**
 * Pre-pass: extract codegen plugins from modules.ts.
 *
 * Module packages (e.g. `@questpie/admin`, `@questpie/openapi`) can declare
 * `plugin` on their module definition. This pre-pass imports modules.ts,
 * traverses the module tree, and extracts all plugins — so they participate
 * in codegen without manual registration in questpie.config.ts.
 *
 * Merge order: module-extracted plugins → runtimeConfig plugins.
 * Core plugin is always prepended by runAllTargets/runCodegen.
 */
async function extractModulePlugins(
	rootDir: string,
	configPlugins: CodegenPlugin[],
	options: GenerateOptions,
): Promise<CodegenPlugin[]> {
	const modulesPath = join(rootDir, "modules.ts");
	try {
		await stat(modulesPath);
	} catch {
		return configPlugins;
	}

	try {
		const modulesExport = await import(/* @vite-ignore */ modulesPath);
		const modules = modulesExport.default ?? [];
		if (!Array.isArray(modules)) return configPlugins;

		const modulePlugins = extractPluginsFromModules(modules);
		if (modulePlugins.length === 0) return configPlugins;

		if (options.verbose) {
			console.log(
				`  Extracted ${modulePlugins.length} plugin(s) from modules.ts: ${modulePlugins.map((p) => p.name).join(", ")}`,
			);
		}

		// Dedupe: module-extracted first, then config plugins (config wins on name collision)
		const seen = new Set<string>();
		const merged: CodegenPlugin[] = [];
		// Config plugins take priority — add them first to the seen set
		for (const p of configPlugins) {
			seen.add(p.name);
			merged.push(p);
		}
		// Then add module-extracted plugins that weren't already in config
		for (const p of modulePlugins) {
			if (!seen.has(p.name)) {
				seen.add(p.name);
				merged.push(p);
			}
		}
		return merged;
	} catch (error) {
		if (options.verbose) {
			const reason =
				error instanceof Error ? error.message : String(error);
			console.warn(`  Could not extract plugins from modules.ts: ${reason}`);
		}
		return configPlugins;
	}
}

/**
 * List all .ts files in a directory recursively.
 */
async function listFilesRecursive(dir: string): Promise<string[]> {
	const results: string[] = [];
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				results.push(...(await listFilesRecursive(fullPath)));
			} else if (/\.(ts|tsx|mts)$/.test(entry.name)) {
				results.push(fullPath);
			}
		}
	} catch {
		// Directory doesn't exist
	}
	return results;
}
