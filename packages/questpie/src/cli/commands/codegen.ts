/**
 * Codegen CLI Commands
 *
 * `questpie generate` — one-shot codegen
 * `questpie dev` — watch mode, regenerate on file add/remove
 *
 * @see RFC §16 (CLI Commands), §16.1 (Watch Mode Granularity)
 */

import { watch } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { adminCodegenPlugin, runCodegen } from "../codegen/index.js";
import type { CodegenPlugin } from "../codegen/types.js";

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
 * Run codegen once — produces .generated/index.ts.
 */
export async function generateCommand(options: GenerateOptions): Promise<void> {
	const rawConfigPath = resolve(process.cwd(), options.configPath);
	const { configPath, rootDir } = await resolveEntityRoot(rawConfigPath);
	const outDir = join(rootDir, ".generated");

	// Auto-detect plugins based on config contents
	// For now, always include the admin plugin (blocks discovery)
	const plugins: CodegenPlugin[] = [adminCodegenPlugin()];

	console.log("Discovering files...");
	if (options.verbose) {
		console.log(`  Root: ${rootDir}`);
		console.log(`  Config: ${configPath}`);
		console.log(`  Output: ${outDir}/index.ts`);
	}

	const result = await runCodegen({
		rootDir,
		configPath,
		outDir,
		plugins,
		dryRun: options.dryRun,
	});

	// Print summary
	const d = result.discovered;
	const counts: string[] = [];
	if (d.collections.size > 0)
		counts.push(`${d.collections.size} collection(s)`);
	if (d.globals.size > 0) counts.push(`${d.globals.size} global(s)`);
	if (d.jobs.size > 0) counts.push(`${d.jobs.size} job(s)`);
	if (d.functions.size > 0) counts.push(`${d.functions.size} function(s)`);
	if (d.messages.size > 0) counts.push(`${d.messages.size} locale(s)`);
	if (d.auth) counts.push("auth");
	if (d.migrations.size > 0) counts.push(`${d.migrations.size} migration(s)`);
	if (d.seeds.size > 0) counts.push(`${d.seeds.size} seed(s)`);
	for (const [key, map] of d.custom) {
		if (map.size > 0) counts.push(`${map.size} ${key}`);
	}

	if (counts.length === 0) {
		console.log(
			"No entity files found. Make sure your files are in the correct directories.",
		);
		return;
	}

	console.log(`Found: ${counts.join(", ")}`);

	if (options.dryRun) {
		console.log("\n--- Generated code (dry run) ---\n");
		console.log(result.code);
	} else {
		console.log(`Generated: ${result.outputPath}`);
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
 * Watch mode — regenerate .generated/index.ts on file add/remove.
 *
 * Per RFC §16.1:
 * - File added/removed → regenerate
 * - File content modified → NO regeneration (typeof import is stable)
 * - Config modified → full regeneration
 *
 * @see RFC §16.1 (Watch Mode Granularity)
 */
export async function devCommand(options: DevOptions): Promise<void> {
	// Run initial generation
	await generateCommand({
		configPath: options.configPath,
		verbose: options.verbose,
	});

	const rawConfigPath = resolve(process.cwd(), options.configPath);
	const { configPath, rootDir } = await resolveEntityRoot(rawConfigPath);
	const outDir = join(rootDir, ".generated");
	const plugins: CodegenPlugin[] = [adminCodegenPlugin()];

	// Directories to watch for file add/remove
	const watchDirs = [
		"collections",
		"globals",
		"jobs",
		"functions",
		"messages",
		"migrations",
		"seeds",
		"blocks",
		"features",
	];

	console.log("\nWatching for file changes...");
	console.log("  (Press Ctrl+C to stop)\n");

	// Track file sets per directory to detect add/remove
	const fileSets = new Map<string, Set<string>>();

	// Initialize file sets
	for (const dir of watchDirs) {
		const dirPath = join(rootDir, dir);
		const files = await listFilesRecursive(dirPath);
		fileSets.set(dir, new Set(files));
	}

	// Debounce timer
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
				});
				console.log(`Updated: ${result.outputPath}`);
			} catch (error) {
				console.error("Codegen error:", error);
			}
		}, 100);
	};

	// Watch config file for any change
	const configWatcher = watch(configPath, () => {
		scheduleRegenerate("config changed");
	});

	// Watch entity directories for file add/remove
	const watchers: ReturnType<typeof watch>[] = [configWatcher];

	for (const dir of watchDirs) {
		const dirPath = join(rootDir, dir);
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
				// Content-only changes → skip (typeof import is stable)
			},
		);

		watchers.push(watcher);
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

// ============================================================================
// Helpers
// ============================================================================

function printDiscovered(d: {
	collections: Map<string, any>;
	globals: Map<string, any>;
	jobs: Map<string, any>;
	functions: Map<string, any>;
	messages: Map<string, any>;
	migrations: Map<string, any>;
	seeds: Map<string, any>;
	auth: any;
	custom: Map<string, Map<string, any>>;
}): void {
	const printMap = (label: string, map: Map<string, any>) => {
		if (map.size === 0) return;
		console.log(`\n  ${label}:`);
		for (const [key, file] of map) {
			console.log(`    ${key} <- ${file.source}`);
		}
	};

	printMap("Collections", d.collections);
	printMap("Globals", d.globals);
	printMap("Jobs", d.jobs);
	printMap("Functions", d.functions);
	printMap("Messages", d.messages);
	printMap("Migrations", d.migrations);
	printMap("Seeds", d.seeds);
	if (d.auth) {
		console.log(`\n  Auth:`);
		console.log(`    ${d.auth.source}`);
	}
	for (const [key, map] of d.custom) {
		printMap(key.charAt(0).toUpperCase() + key.slice(1), map);
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
