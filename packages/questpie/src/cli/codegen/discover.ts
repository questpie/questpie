/**
 * File Discovery
 *
 * Scans the questpie root directory for entity files matching
 * the file convention patterns. Supports both by-type and by-feature layouts.
 *
 * @see RFC-MODULE-ARCHITECTURE §4 (Plugin Resolution Patterns)
 */

import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import type {
	CodegenPlugin,
	DiscoveredFile,
	DiscoverPattern,
} from "./types.js";

// ============================================================================
// Key Derivation
// ============================================================================

/**
 * Convert a kebab-case filename to camelCase key.
 * `send-newsletter.ts` → `sendNewsletter`
 * `site-settings.ts` → `siteSettings`
 *
 * @see RFC §2.4 (Key Derivation)
 */
export function kebabToCamelCase(filename: string): string {
	// Remove extension
	const name = filename.replace(/\.(ts|tsx|js|jsx|mts|mjs)$/, "");
	return name.replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase());
}

/**
 * Create a safe TypeScript variable name from a key.
 * Prefixed with underscore + category to avoid collisions.
 */
function toVarName(prefix: string, key: string): string {
	// Replace dots and dashes with underscores
	const safe = key.replace(/[.\-/]/g, "_");
	return `_${prefix}_${safe}`;
}

// ============================================================================
// Glob-like directory scanner
// ============================================================================

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts"]);
const IGNORE_FILES = new Set(["index.ts", "index.mts", "index.tsx"]);

/** Files starting with _ are considered private/utility and skipped. */
function isPrivateFile(name: string): boolean {
	return name.startsWith("_");
}

/**
 * Recursively scan a directory for TypeScript files.
 * Returns relative paths from the base directory.
 */
async function scanDir(
	dir: string,
	base: string,
	recursive: boolean,
): Promise<string[]> {
	const results: string[] = [];
	let entries: Dirent[];
	try {
		entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
	} catch {
		return results; // Directory doesn't exist
	}
	for (const entry of entries) {
		const name = String(entry.name);
		const fullPath = join(dir, name);
		if (entry.isDirectory() && recursive) {
			const nested = await scanDir(fullPath, base, true);
			results.push(...nested);
		} else if (entry.isFile()) {
			const ext = extname(name);
			if (
				TS_EXTENSIONS.has(ext) &&
				!IGNORE_FILES.has(name) &&
				!isPrivateFile(name)
			) {
				results.push(relative(base, fullPath));
			}
		}
	}
	return results;
}

/**
 * Check if a single file exists.
 */
async function fileExists(path: string): Promise<boolean> {
	try {
		const s = await stat(path);
		return s.isFile();
	} catch {
		return false;
	}
}

// ============================================================================
// Core discovery patterns
// ============================================================================

interface DiscoveryCategory {
	/** Category name (e.g. "collections"). */
	category: string;
	/** Glob-like pattern description for logging. */
	patterns: string[];
	/** Directories to scan (relative to root). */
	dirs: string[];
	/** Whether to scan recursively (only for functions and routes). */
	recursive: boolean;
	/** Variable name prefix. */
	prefix: string;
}

const CORE_CATEGORIES: DiscoveryCategory[] = [
	{
		category: "collections",
		patterns: ["collections/*.ts", "features/*/collections/*.ts"],
		dirs: ["collections"],
		recursive: false,
		prefix: "coll",
	},
	{
		category: "globals",
		patterns: ["globals/*.ts", "features/*/globals/*.ts"],
		dirs: ["globals"],
		recursive: false,
		prefix: "glob",
	},
	{
		category: "jobs",
		patterns: ["jobs/*.ts", "features/*/jobs/*.ts"],
		dirs: ["jobs"],
		recursive: false,
		prefix: "job",
	},
	{
		category: "functions",
		patterns: ["functions/**/*.ts", "features/*/functions/**/*.ts"],
		dirs: ["functions"],
		recursive: true,
		prefix: "fn",
	},
	{
		category: "routes",
		patterns: ["routes/**/*.ts", "features/*/routes/**/*.ts"],
		dirs: ["routes"],
		recursive: true,
		prefix: "route",
	},
	{
		category: "messages",
		patterns: ["messages/*.ts"],
		dirs: ["messages"],
		recursive: false,
		prefix: "msg",
	},
	{
		category: "services",
		patterns: ["services/*.ts", "features/*/services/*.ts"],
		dirs: ["services"],
		recursive: false,
		prefix: "svc",
	},
	{
		category: "emails",
		patterns: ["emails/*.ts", "emails/*.tsx", "features/*/emails/*.ts", "features/*/emails/*.tsx"],
		dirs: ["emails"],
		recursive: false,
		prefix: "email",
	},
	{
		category: "migrations",
		patterns: ["migrations/*.ts"],
		dirs: ["migrations"],
		recursive: false,
		prefix: "mig",
	},
	{
		category: "seeds",
		patterns: ["seeds/*.ts"],
		dirs: ["seeds"],
		recursive: false,
		prefix: "seed",
	},
];

// ============================================================================
// Feature layout discovery
// ============================================================================

/**
 * Scan features/ directory for feature-specific entity files.
 */
async function discoverFeatures(
	rootDir: string,
	category: DiscoveryCategory,
): Promise<Array<{ relPath: string; featureName: string }>> {
	const results: Array<{ relPath: string; featureName: string }> = [];
	const featuresDir = join(rootDir, "features");
	let featureDirs: Dirent[];
	try {
		featureDirs = (await readdir(featuresDir, { withFileTypes: true })) as Dirent[];
	} catch {
		return results;
	}
	for (const fDir of featureDirs) {
		if (!fDir.isDirectory()) continue;
		const featureName = String(fDir.name);
		for (const dir of category.dirs) {
			const scanPath = join(featuresDir, featureName, dir);
			const files = await scanDir(scanPath, scanPath, category.recursive);
			for (const f of files) {
				results.push({
					relPath: join("features", featureName, dir, f),
					featureName,
				});
			}
		}
	}
	return results;
}

// ============================================================================
// Main discovery function
// ============================================================================

export interface DiscoveryResult {
	collections: Map<string, DiscoveredFile>;
	globals: Map<string, DiscoveredFile>;
	jobs: Map<string, DiscoveredFile>;
	functions: Map<string, DiscoveredFile>;
	routes: Map<string, DiscoveredFile>;
	messages: Map<string, DiscoveredFile>;
	services: Map<string, DiscoveredFile>;
	emails: Map<string, DiscoveredFile>;
	migrations: Map<string, DiscoveredFile>;
	seeds: Map<string, DiscoveredFile>;
	auth: DiscoveredFile | null;
	custom: Map<string, Map<string, DiscoveredFile>>;
	/** Plugin-discovered single-file items (branding.ts, adminLocale.ts, etc.) */
	singles: Map<string, DiscoveredFile>;
	/**
	 * Plugin-discovered spread items (sidebar.ts, dashboard.ts, etc.).
	 * Each entry is an ordered list: root file first, then feature files alphabetically.
	 * Used when the plugin declares `mergeStrategy: "spread"` — codegen spreads all
	 * into a single array: `sidebar: [..._sidebar_root, ..._sidebar_admin]`.
	 */
	spreads: Map<string, DiscoveredFile[]>;
}

/**
 * Discover all entity files in the questpie root directory.
 *
 * @param rootDir — Directory containing questpie.config.ts
 * @param outDir — .generated output directory (for computing relative import paths)
 * @param plugins — Optional codegen plugins that register additional discovery patterns
 */
export async function discoverFiles(
	rootDir: string,
	outDir: string,
	plugins?: CodegenPlugin[],
): Promise<DiscoveryResult> {
	const result: DiscoveryResult = {
		collections: new Map(),
		globals: new Map(),
		jobs: new Map(),
		functions: new Map(),
		routes: new Map(),
		messages: new Map(),
		services: new Map(),
		emails: new Map(),
		migrations: new Map(),
		seeds: new Map(),
		auth: null,
		custom: new Map(),
		singles: new Map(),
		spreads: new Map(),
	};

	// Discover core categories
	for (const category of CORE_CATEGORIES) {
		const map = result[
			category.category as keyof Omit<
				DiscoveryResult,
				"auth" | "custom" | "singles"
			>
		] as Map<string, DiscoveredFile> | undefined;
		if (!map) continue;

		// Scan by-type layout
		for (const dir of category.dirs) {
			const scanPath = join(rootDir, dir);
			const files = await scanDir(scanPath, scanPath, category.recursive);
			for (const relFile of files) {
				const file = await processFile(
					rootDir,
					outDir,
					join(dir, relFile),
					category,
				);
				checkConflict(map, file, category.category);
				map.set(file.key, file);
			}
		}

		// Scan by-feature layout
		const featureFiles = await discoverFeatures(rootDir, category);
		for (const { relPath } of featureFiles) {
			const file = await processFile(rootDir, outDir, relPath, category);
			checkConflict(map, file, category.category);
			map.set(file.key, file);
		}
	}

	// Discover auth.ts (single file)
	for (const authFile of ["auth.ts", "auth.mts"]) {
		const authPath = join(rootDir, authFile);
		if (await fileExists(authPath)) {
			const importPath = relativeImport(outDir, join(rootDir, authFile));
			const exportInfo = await detectExportType(authPath);
			result.auth = {
				absolutePath: authPath,
				key: "auth",
				importPath,
				varName: "_auth",
				source: authFile,
				exportType: exportInfo.type,
				namedExportName: exportInfo.namedExportName,
			};
			break;
		}
	}

	// Discover core single files (modules.ts, locale.ts, hooks.ts, access.ts, context.ts)
	// These are discovered by the core, not a plugin, since they are always relevant.
	// The `key` matches the property name on AppDefinition.
	const coreSingleFiles: Array<{ key: string; filenames: string[] }> = [
		{ key: "modules", filenames: ["modules.ts", "modules.mts"] },
		{ key: "locale", filenames: ["locale.ts", "locale.mts"] },
		{ key: "hooks", filenames: ["hooks.ts", "hooks.mts"] },
		{ key: "defaultAccess", filenames: ["access.ts", "access.mts"] },
		{ key: "contextResolver", filenames: ["context.ts", "context.mts"] },
	];

	for (const { key, filenames } of coreSingleFiles) {
		for (const filename of filenames) {
			const filePath = join(rootDir, filename);
			if (await fileExists(filePath)) {
				const importPath = relativeImport(outDir, filePath);
				const exportInfo = await detectExportType(filePath);
				result.singles.set(key, {
					absolutePath: filePath,
					key,
					importPath,
					varName: `_${key}`,
					source: filename,
					exportType: exportInfo.type,
					namedExportName: exportInfo.namedExportName,
				});
				break;
			}
		}
	}

	// Discover plugin patterns
	if (plugins) {
		for (const plugin of plugins) {
			if (!plugin.discover) continue;
			for (const [stateKey, rawPattern] of Object.entries(plugin.discover)) {
				const resolved = resolveDiscoverPattern(rawPattern);

				if (resolved.cardinality === "single") {
					if (resolved.mergeStrategy === "spread") {
						// Spread pattern — collect root + features/*/pattern into an ordered array
						await discoverSpreadFile(
							rootDir,
							outDir,
							stateKey,
							resolved,
							result.spreads,
						);
					} else {
						// Default single — only the root-level file is used
						await discoverSingleFile(
							rootDir,
							outDir,
							stateKey,
							resolved,
							result.singles,
						);
					}
				} else {
					// Directory pattern (e.g. "blocks/*.ts")
					const pluginMap = new Map<string, DiscoveredFile>();
					await discoverDirectoryPattern(
						rootDir,
						outDir,
						stateKey,
						resolved,
						pluginMap,
					);

					if (pluginMap.size > 0) {
						const existing = result.custom.get(stateKey);
						if (existing) {
							// Merge with existing
							for (const [k, v] of pluginMap) {
								checkConflict(existing, v, stateKey);
								existing.set(k, v);
							}
						} else {
							result.custom.set(stateKey, pluginMap);
						}
					}
				}
			}
		}
	}

	return result;
}

// ============================================================================
// Pattern Resolution
// ============================================================================

interface ResolvedPattern {
	pattern: string;
	resolve: "default" | "named" | "all" | "auto";
	keyFrom: "filename" | "exportName";
	cardinality: "single" | "map";
	mergeStrategy: "replace" | "spread";
}

/**
 * Resolve a DiscoverPattern string or object into a fully resolved pattern.
 */
function resolveDiscoverPattern(pattern: DiscoverPattern): ResolvedPattern {
	if (typeof pattern === "string") {
		const isSingleFile =
			!pattern.includes("*") &&
			!pattern.includes("/") &&
			pattern.endsWith(".ts");
		return {
			pattern,
			resolve: "auto",
			keyFrom: "filename",
			cardinality: isSingleFile ? "single" : "map",
			mergeStrategy: "replace",
		};
	}
	const isSingleFile =
		!pattern.pattern.includes("*") &&
		!pattern.pattern.includes("/") &&
		pattern.pattern.endsWith(".ts");
	return {
		pattern: pattern.pattern,
		resolve: pattern.resolve ?? "auto",
		keyFrom: pattern.keyFrom ?? "filename",
		cardinality: pattern.cardinality ?? (isSingleFile ? "single" : "map"),
		mergeStrategy: pattern.mergeStrategy ?? "replace",
	};
}

// ============================================================================
// Single-file discovery
// ============================================================================

/**
 * Discover a single-file pattern (e.g. "sidebar.ts", "dashboard.ts").
 */
async function discoverSingleFile(
	rootDir: string,
	outDir: string,
	stateKey: string,
	resolved: ResolvedPattern,
	singles: Map<string, DiscoveredFile>,
): Promise<void> {
	// Try the exact filename and .mts variant
	const candidates = [resolved.pattern];
	if (resolved.pattern.endsWith(".ts")) {
		candidates.push(resolved.pattern.replace(/\.ts$/, ".mts"));
	}

	for (const filename of candidates) {
		const fullPath = join(rootDir, filename);
		if (await fileExists(fullPath)) {
			const importPath = relativeImport(outDir, fullPath);
			const exportInfo = await detectExportType(fullPath);
			singles.set(stateKey, {
				absolutePath: fullPath,
				key: stateKey,
				importPath,
				varName: `_${stateKey}`,
				source: filename,
				exportType: exportInfo.type,
				namedExportName: exportInfo.namedExportName,
			});
			break;
		}
	}
}

// ============================================================================
// Spread-file discovery
// ============================================================================

/**
 * Discover a spread-file pattern (sidebar.ts with mergeStrategy "spread").
 *
 * Collects matching files from:
 * 1. rootDir/pattern - the root-level file (first in array)
 * 2. rootDir/features/NAME/pattern - one file per feature, sorted alphabetically
 *
 * VarName: "_<stateKey>_root" for root, "_<stateKey>_<featureName>" for features.
 *
 * All found files are appended to the spreads map for the stateKey so multiple
 * plugins can contribute to the same spread key without overwriting each other.
 */
async function discoverSpreadFile(
	rootDir: string,
	outDir: string,
	stateKey: string,
	resolved: ResolvedPattern,
	spreads: Map<string, DiscoveredFile[]>,
): Promise<void> {
	const collected: DiscoveredFile[] = [];

	// Helper to try a path and add to collected if it exists
	async function tryAdd(fullPath: string, varSuffix: string, source: string): Promise<void> {
		if (await fileExists(fullPath)) {
			const importPath = relativeImport(outDir, fullPath);
			const exportInfo = await detectExportType(fullPath);
			collected.push({
				absolutePath: fullPath,
				key: stateKey,
				importPath,
				varName: `_${stateKey}_${varSuffix}`,
				source,
				exportType: exportInfo.type,
				namedExportName: exportInfo.namedExportName,
			});
		}
	}

	// 1. Root-level file (and .mts fallback)
	const candidates = [resolved.pattern];
	if (resolved.pattern.endsWith(".ts")) {
		candidates.push(resolved.pattern.replace(/\.ts$/, ".mts"));
	}
	for (const filename of candidates) {
		const fullPath = join(rootDir, filename);
		if (await fileExists(fullPath)) {
			await tryAdd(fullPath, "root", filename);
			break; // don't add both .ts and .mts
		}
	}

	// 2. Feature-level files: features/*/{pattern}
	const featuresDir = join(rootDir, "features");
	let featureDirs: Dirent[];
	try {
		featureDirs = (await readdir(featuresDir, { withFileTypes: true })) as Dirent[];
	} catch {
		featureDirs = [];
	}

	// Sort features alphabetically for deterministic output
	featureDirs.sort((a, b) => String(a.name).localeCompare(String(b.name)));

	for (const fDir of featureDirs) {
		if (!fDir.isDirectory()) continue;
		const featureName = String(fDir.name);
		const featureSuffix = kebabToCamelCase(`${featureName}.ts`); // strips fake .ts, converts kebab

		for (const filename of candidates) {
			const fullPath = join(featuresDir, featureName, filename);
			if (await fileExists(fullPath)) {
				await tryAdd(
					fullPath,
					featureSuffix,
					join("features", featureName, filename),
				);
				break;
			}
		}
	}

	if (collected.length > 0) {
		const existing = spreads.get(stateKey) ?? [];
		spreads.set(stateKey, [...existing, ...collected]);
	}
}

// ============================================================================
// Directory pattern discovery
// ============================================================================

/**
 * Discover files from a directory pattern (e.g. "blocks/*.ts").
 */
async function discoverDirectoryPattern(
	rootDir: string,
	outDir: string,
	stateKey: string,
	resolved: ResolvedPattern,
	pluginMap: Map<string, DiscoveredFile>,
): Promise<void> {
	// Parse pattern: "blocks/*.ts" → dir="blocks", recursive=false
	// "blocks/**/*.ts" → dir="blocks", recursive=true
	const parts = resolved.pattern.split("/");
	const baseDir = parts[0];
	const recursive = resolved.pattern.includes("**");

	const category: DiscoveryCategory = {
		category: stateKey,
		patterns: [resolved.pattern],
		dirs: [baseDir],
		recursive,
		prefix: stateKey.slice(0, 4),
	};

	// By-type scan
	const scanPath = join(rootDir, baseDir);
	const files = await scanDir(scanPath, scanPath, recursive);
	for (const relFile of files) {
		const file = await processFile(
			rootDir,
			outDir,
			join(baseDir, relFile),
			category,
		);
		checkConflict(pluginMap, file, stateKey);
		pluginMap.set(file.key, file);
	}

	// By-feature scan
	const featuresDir = join(rootDir, "features");
	let featureDirs: Dirent[];
	try {
		featureDirs = (await readdir(featuresDir, {
			withFileTypes: true,
		})) as Dirent[];
	} catch {
		return;
	}
	for (const fDir of featureDirs) {
		if (!fDir.isDirectory()) continue;
		const fDirName = String(fDir.name);
		const featureScanPath = join(featuresDir, fDirName, baseDir);
		const featureFiles = await scanDir(
			featureScanPath,
			featureScanPath,
			recursive,
		);
		for (const relFile of featureFiles) {
			const file = await processFile(
				rootDir,
				outDir,
				join("features", fDirName, baseDir, relFile),
				category,
			);
			checkConflict(pluginMap, file, stateKey);
			pluginMap.set(file.key, file);
		}
	}
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Process a discovered file into a DiscoveredFile object.
 * Detects export type (default vs named) for import generation.
 */
async function processFile(
	rootDir: string,
	outDir: string,
	relPath: string,
	category: DiscoveryCategory,
): Promise<DiscoveredFile> {
	const absolutePath = join(rootDir, relPath);
	const importPath = relativeImport(outDir, absolutePath);

	// Derive key based on category
	let key: string;
	if (category.recursive) {
		// Functions/routes: path segments become nested keys
		// functions/admin/stats.ts → "admin.stats"
		// routes/webhooks/stripe.ts → "webhooks/stripe"
		const dir = category.dirs[0];
		let innerPath: string;
		if (relPath.startsWith("features/")) {
			const parts = relPath.split("/");
			const dirIdx = parts.indexOf(dir);
			innerPath = parts.slice(dirIdx + 1).join("/");
		} else {
			innerPath = relPath.slice(dir.length + 1);
		}

		if (category.category === "routes") {
			// Routes use slash-separated keys to match URL paths
			key = innerPath.replace(/\.(ts|tsx|mts|mjs|js|jsx)$/, "");
		} else {
			// Functions use dot-separated keys
			const segments = innerPath
				.replace(/\.(ts|tsx|mts|mjs|js|jsx)$/, "")
				.split("/")
				.map(kebabToCamelCase);
			key = segments.join(".");
		}
	} else {
		// Simple: filename → camelCase key
		key = kebabToCamelCase(basename(relPath));
	}

	const varName = toVarName(category.prefix, key);

	// Detect export type
	const exportInfo = await detectExportType(absolutePath);

	return {
		absolutePath,
		key,
		importPath,
		varName,
		source: relPath,
		exportType: exportInfo.type,
		namedExportName: exportInfo.namedExportName,
	};
}

/**
 * Compute a relative import path from the output directory to a target file.
 * Strips the .ts extension and ensures it starts with "../".
 */
function relativeImport(fromDir: string, toFile: string): string {
	let rel = relative(fromDir, toFile);
	// Remove extension
	rel = rel.replace(/\.(ts|tsx|mts|mjs|js|jsx)$/, "");
	// Ensure it starts with ./ or ../
	if (!rel.startsWith(".")) {
		rel = `./${rel}`;
	}
	return rel;
}

// ============================================================================
// Export detection
// ============================================================================

/**
 * Detect what kind of export a TypeScript file has.
 * Reads the file and checks for `export default` vs named exports.
 *
 * Returns { type, namedExportName? }
 */
export async function detectExportType(absolutePath: string): Promise<{
	type: "default" | "named" | "unknown";
	namedExportName?: string;
}> {
	let content: string;
	try {
		content = await readFile(absolutePath, "utf-8");
	} catch {
		return { type: "unknown" };
	}

	// Check for default export patterns:
	// - export default ...
	// - export { X as default }
	if (
		/\bexport\s+default\b/.test(content) ||
		/\bexport\s*\{[^}]*\bas\s+default\b/.test(content)
	) {
		return { type: "default" };
	}

	// Look for named exports: export const X, export function X, export class X, export { X }
	const namedMatch = content.match(
		/\bexport\s+(?:const|let|var|function|class)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/,
	);
	if (namedMatch) {
		return { type: "named", namedExportName: namedMatch[1] };
	}

	const reExportMatch = content.match(
		/\bexport\s*\{\s*([a-zA-Z_$][a-zA-Z0-9_$]*)/,
	);
	if (reExportMatch) {
		return { type: "named", namedExportName: reExportMatch[1] };
	}

	return { type: "unknown" };
}

/**
 * Check for duplicate key conflicts and throw an error if found.
 * @see RFC §2.4 — "Conflict resolution: duplicate key → error"
 */
function checkConflict(
	map: Map<string, DiscoveredFile>,
	file: DiscoveredFile,
	category: string,
): void {
	const existing = map.get(file.key);
	if (existing) {
		throw new Error(
			`Codegen conflict: duplicate ${category} key "${file.key}" found in:\n` +
				`  - ${existing.source}\n` +
				`  - ${file.source}\n` +
				`Each key must be unique across by-type and by-feature layouts.`,
		);
	}
}
