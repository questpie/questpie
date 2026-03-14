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
	CategoryDeclaration,
	DiscoveredFile,
	DiscoverPattern,
	DiscoveryResult,
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
				!name.endsWith(".d.ts") &&
				!name.endsWith(".d.mts") &&
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
// Category discovery helpers
// ============================================================================

/**
 * Internal representation used during discovery — derived from CategoryDeclaration.
 * Kept as an internal type to avoid exposing discovery internals.
 */
interface DiscoveryCategory {
	/** Category name (e.g. "collections"). */
	category: string;
	/** Directories to scan (relative to root). */
	dirs: string[];
	/** Whether to scan directories recursively. */
	recursive: boolean;
	/** Variable name prefix. */
	prefix: string;
	/** Key separator for recursive categories. */
	keySeparator?: "." | "/";
	/** Factory function names for multi-export discovery. */
	factoryFunctions?: string[];
}

/**
 * Convert a CategoryDeclaration from a plugin into a DiscoveryCategory
 * used internally by the discovery loop.
 */
function toDiscoveryCategory(
	name: string,
	decl: CategoryDeclaration,
): DiscoveryCategory {
	return {
		category: name,
		dirs: decl.dirs,
		recursive: decl.recursive ?? false,
		prefix: decl.prefix,
		keySeparator: decl.keySeparator,
		factoryFunctions: decl.factoryFunctions,
	};
}

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
		featureDirs = (await readdir(featuresDir, {
			withFileTypes: true,
		})) as Dirent[];
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

/**
 * Options for file discovery, extracted from a resolved target.
 */
export interface DiscoverFilesOptions {
	/** Merged category declarations from all contributing plugins. */
	categories?: Record<string, CategoryDeclaration>;
	/** Merged discover patterns from all contributing plugins. */
	discover?: Record<string, DiscoverPattern>;
}

/**
 * Discover all entity files in the questpie root directory.
 *
 * Iterates over merged `categories` (directory-pattern categories)
 * and `discover` (single/spread/custom patterns) to build a unified
 * DiscoveryResult.
 *
 * @param rootDir — Directory containing questpie.config.ts
 * @param outDir — .generated output directory (for computing relative import paths)
 * @param options — Merged categories and discover patterns from the resolved target
 */
export async function discoverFiles(
	rootDir: string,
	outDir: string,
	options?: DiscoverFilesOptions,
): Promise<DiscoveryResult> {
	const result: DiscoveryResult = {
		categories: new Map(),
		singles: new Map(),
		spreads: new Map(),
	};

	// ── Phase 1: Discover all category-declared directories ──────
	// Categories are directory-pattern categories like collections, globals, blocks, etc.
	if (options?.categories) {
		for (const [name, decl] of Object.entries(options.categories)) {
			const category = toDiscoveryCategory(name, decl);
			const map =
				result.categories.get(name) ?? new Map<string, DiscoveredFile>();

			// Scan by-type layout
			for (const dir of category.dirs) {
				const scanPath = join(rootDir, dir);
				const files = await scanDir(scanPath, scanPath, category.recursive);
				for (const relFile of files) {
					const discovered = await processFile(
						rootDir,
						outDir,
						join(dir, relFile),
						category,
					);
					for (const file of discovered) {
						checkConflict(map, file, category.category);
						map.set(file.key, file);
					}
				}
			}

			// Scan by-feature layout
			const featureFiles = await discoverFeatures(rootDir, category);
			for (const { relPath } of featureFiles) {
				const discovered = await processFile(
					rootDir,
					outDir,
					relPath,
					category,
				);
				for (const file of discovered) {
					checkConflict(map, file, category.category);
					map.set(file.key, file);
				}
			}

			result.categories.set(name, map);
		}
	}

	// ── Phase 2: Discover plugin discover patterns ────────────
	// These are single-file, spread, and directory patterns from the merged target.
	if (options?.discover) {
		for (const [stateKey, rawPattern] of Object.entries(options.discover)) {
			const resolved = resolveDiscoverPattern(rawPattern);

			if (resolved.cardinality === "single") {
				if (resolved.mergeStrategy === "spread") {
					// Spread pattern — collect root + features/{name}/pattern into an ordered array
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
				// Directory pattern (e.g. "blocks/*.ts") — goes into categories
				const existing =
					result.categories.get(stateKey) ?? new Map<string, DiscoveredFile>();
				await discoverDirectoryPattern(
					rootDir,
					outDir,
					stateKey,
					resolved,
					existing,
				);

				if (existing.size > 0) {
					result.categories.set(stateKey, existing);
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
				isBundle: exportInfo.isBundle,
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
	async function tryAdd(
		fullPath: string,
		varSuffix: string,
		source: string,
	): Promise<void> {
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
				isBundle: exportInfo.isBundle,
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
		featureDirs = (await readdir(featuresDir, {
			withFileTypes: true,
		})) as Dirent[];
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
		dirs: [baseDir],
		recursive,
		prefix: stateKey.slice(0, 4),
	};

	// By-type scan
	const scanPath = join(rootDir, baseDir);
	const files = await scanDir(scanPath, scanPath, recursive);
	for (const relFile of files) {
		const discovered = await processFile(
			rootDir,
			outDir,
			join(baseDir, relFile),
			category,
		);
		for (const file of discovered) {
			checkConflict(pluginMap, file, stateKey);
			pluginMap.set(file.key, file);
		}
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
			const discovered = await processFile(
				rootDir,
				outDir,
				join("features", fDirName, baseDir, relFile),
				category,
			);
			for (const file of discovered) {
				checkConflict(pluginMap, file, stateKey);
				pluginMap.set(file.key, file);
			}
		}
	}
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Derive the filename-based key for a file in a category.
 * Handles recursive categories (routes use path segments as keys)
 * and simple categories (filename → camelCase).
 */
function deriveFileKey(relPath: string, category: DiscoveryCategory): string {
	if (category.recursive) {
		// Recursive categories: path segments become keys
		// routes/webhooks/stripe.ts → "webhooks/stripe" (keySeparator: "/")

		// Determine which dir this file came from
		let innerPath: string;
		if (relPath.startsWith("features/")) {
			const parts = relPath.split("/");
			// Find which category dir appears in the path
			const dirIdx = parts.findIndex((p) => category.dirs.includes(p));
			innerPath = parts.slice(dirIdx + 1).join("/");
		} else {
			// relPath is like "routes/webhook.ts"
			// Strip the leading dir segment
			const matchedDir = category.dirs.find((d) => relPath.startsWith(d + "/"));
			if (matchedDir) {
				innerPath = relPath.slice(matchedDir.length + 1);
			} else {
				innerPath = relPath;
			}
		}

		const sep = category.keySeparator ?? ".";
		const segments = innerPath
			.replace(/\.(ts|tsx|mts|mjs|js|jsx)$/, "")
			.split("/")
			.map(kebabToCamelCase);
		return segments.join(sep);
	}
	// Simple: filename → camelCase key
	return kebabToCamelCase(basename(relPath));
}

/**
 * Process a discovered file into one or more DiscoveredFile objects.
 *
 * When the category declares `factoryFunctions`, uses two-pass regex
 * detection to find all exported factory calls. Each match becomes
 * a separate DiscoveredFile. Files without matching factory calls
 * are skipped (returns empty array) — this filters out utility files.
 *
 * When `factoryFunctions` is not set, falls back to single-entity
 * detection (backward compatible).
 */
async function processFile(
	rootDir: string,
	outDir: string,
	relPath: string,
	category: DiscoveryCategory,
): Promise<DiscoveredFile[]> {
	const absolutePath = join(rootDir, relPath);
	const importPath = relativeImport(outDir, absolutePath);

	// Read file content once — used by both factory and legacy detection
	let content: string;
	try {
		content = await readFile(absolutePath, "utf-8");
	} catch {
		return [];
	}

	// ── Multi-export mode (factory-aware) ───────────────────────
	if (category.factoryFunctions && category.factoryFunctions.length > 0) {
		const matches = detectFactoryExports(content, category.factoryFunctions);
		if (matches.length === 0) {
			// No factory calls found → skip file (utility/types file)
			return [];
		}

		const results: DiscoveredFile[] = [];
		const namedMatches = matches.filter((m) => !m.isDefault);
		const defaultMatch = matches.find((m) => m.isDefault);

		if (namedMatches.length > 0) {
			// Named factory exports found — each becomes a separate entity
			for (const m of namedMatches) {
				const key = m.entityKey
					? kebabToCamelCase(`${m.entityKey}.ts`)
					: m.exportName;
				results.push({
					absolutePath,
					key,
					importPath,
					varName: toVarName(category.prefix, key),
					source: relPath,
					exportType: "named",
					namedExportName: m.exportName,
				});
			}
		} else if (defaultMatch) {
			// Only a default factory export — single entity
			const key = defaultMatch.entityKey
				? kebabToCamelCase(`${defaultMatch.entityKey}.ts`)
				: deriveFileKey(relPath, category);
			results.push({
				absolutePath,
				key,
				importPath,
				varName: toVarName(category.prefix, key),
				source: relPath,
				exportType: "default",
			});
		}

		return results;
	}

	// ── Legacy single-entity mode ───────────────────────────────
	const key = deriveFileKey(relPath, category);
	const exportInfo = detectExportTypeFromContent(content);

	return [
		{
			absolutePath,
			key,
			importPath,
			varName: toVarName(category.prefix, key),
			source: relPath,
			exportType: exportInfo.type,
			namedExportName: exportInfo.namedExportName,
			isBundle: exportInfo.isBundle,
		},
	];
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
 * Result of export type detection.
 */
export interface ExportDetection {
	type: "default" | "named" | "unknown";
	namedExportName?: string;
	/**
	 * When true, the named export is an object literal bundle
	 * (e.g. `export const fns = { fn1, fn2 }`).
	 */
	isBundle?: boolean;
}

/**
 * Detect what kind of export a TypeScript file has from its content string.
 * Pure function — no I/O.
 *
 * Detection priority:
 * 1. `export default` → default export (no bundle check)
 * 2. `export const X = {` (object literal) → named bundle export
 * 3. `export const/function/class X` → single named export
 *
 * The bundle detection distinguishes:
 * - `export const bundle = {` (object literal value) → isBundle: true
 * - `export const myFn = fn({` (function call) → isBundle: false
 */
export function detectExportTypeFromContent(content: string): ExportDetection {
	// Check for default export patterns:
	// - export default ...
	// - export { X as default }
	if (
		/\bexport\s+default\b/.test(content) ||
		/\bexport\s*\{[^}]*\bas\s+default\b/.test(content)
	) {
		return { type: "default" };
	}

	// Check for bundle export: export const X = { (object literal, NOT a function call)
	// Matches `export const fns = {` but not `export const x = fn({`
	// because `fn(` appears between `=` and `{` in the latter.
	const bundleMatch = content.match(
		/\bexport\s+const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*\{/m,
	);
	if (bundleMatch) {
		return {
			type: "named",
			namedExportName: bundleMatch[1],
			isBundle: true,
		};
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
 * Detect what kind of export a TypeScript file has.
 * Reads the file and delegates to `detectExportTypeFromContent`.
 */
export async function detectExportType(
	absolutePath: string,
): Promise<ExportDetection> {
	let content: string;
	try {
		content = await readFile(absolutePath, "utf-8");
	} catch {
		return { type: "unknown" };
	}
	return detectExportTypeFromContent(content);
}

// ============================================================================
// Factory export detection (multi-export discovery)
// ============================================================================

/**
 * Result of a factory export match in a file.
 */
interface FactoryExportMatch {
	/** Export name used in the export statement (for import generation). */
	exportName: string;
	/** Which factory function was called. */
	factoryName: string;
	/** Entity key extracted from the factory's first string argument, or null. */
	entityKey: string | null;
	/** Whether this is a default export. */
	isDefault: boolean;
}

/**
 * Detect all exported factory function calls in a file's content.
 *
 * Uses a two-pass regex approach (no AST parsing):
 *
 * **Pass 1** — Build a map of all variable assignments that call a factory function.
 * Matches both exported and non-exported assignments:
 * `const hero = block("hero")`, `export const hero = block("hero")`
 *
 * **Pass 2** — Cross-reference with export statements to find which
 * factory variables are actually exported:
 * - `export const X` → direct export
 * - `export { X }` or `export { X as Y }` → re-export (excluding `from "..."`)
 * - `export default X` → default re-export of factory variable
 * - `export default factory(...)` → inline default factory call
 *
 * @param content — File content string
 * @param factoryFunctions — Factory function names to match (e.g. ["block", "view"])
 * @returns Array of matched factory exports. Empty if no factory calls found.
 */
export function detectFactoryExports(
	content: string,
	factoryFunctions: string[],
): FactoryExportMatch[] {
	if (factoryFunctions.length === 0) return [];

	const factoryAlt = factoryFunctions
		.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
		.join("|");

	// ── Pass 1: Build factory variable map ──────────────────────
	// Matches: [export] const/let/var X = factory(...) or factory<T>(...)
	// Captures: [1] varName, [2] factoryName, [3] first string arg (optional)
	const assignRe = new RegExp(
		`(?:const|let|var)\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=\\s*(${factoryAlt})\\s*(?:<[^>]*>)?\\s*\\(\\s*(?:["']([^"']+)["'])?`,
		"gm",
	);

	const factoryVars = new Map<
		string,
		{ factoryName: string; entityKey: string | null }
	>();
	let match: RegExpExecArray | null;
	while ((match = assignRe.exec(content)) !== null) {
		factoryVars.set(match[1], {
			factoryName: match[2],
			entityKey: match[3] ?? null,
		});
	}

	// ── Pass 2: Cross-reference with export statements ──────────
	const results: FactoryExportMatch[] = [];
	const seen = new Set<string>(); // avoid duplicates

	// 2a. Direct exports: export const/let/var X
	const directExportRe =
		/\bexport\s+(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/gm;
	while ((match = directExportRe.exec(content)) !== null) {
		const name = match[1];
		const info = factoryVars.get(name);
		if (info && !seen.has(name)) {
			seen.add(name);
			results.push({
				exportName: name,
				factoryName: info.factoryName,
				entityKey: info.entityKey,
				isDefault: false,
			});
		}
	}

	// 2b. Re-exports: export { X } or export { X as Y }
	// Exclude re-exports from other modules: export { X } from "..."
	const reExportBlockRe = /\bexport\s*\{([^}]+)\}(?!\s*from\s)/gm;
	while ((match = reExportBlockRe.exec(content)) !== null) {
		const specifiers = match[1];
		// Parse individual specifiers: "X" or "X as Y"
		const specRe =
			/([a-zA-Z_$][a-zA-Z0-9_$]*)(?:\s+as\s+([a-zA-Z_$][a-zA-Z0-9_$]*))?/g;
		let specMatch: RegExpExecArray | null;
		while ((specMatch = specRe.exec(specifiers)) !== null) {
			const localName = specMatch[1];
			const exportedAs = specMatch[2]; // may be undefined
			// Skip "as default" — handled separately
			if (exportedAs === "default") continue;
			const info = factoryVars.get(localName);
			if (info) {
				const name = exportedAs ?? localName;
				if (!seen.has(name)) {
					seen.add(name);
					results.push({
						exportName: name,
						factoryName: info.factoryName,
						entityKey: info.entityKey,
						isDefault: false,
					});
				}
			}
		}
	}

	// 2c. Default re-export of a factory variable: export default X
	const defaultVarRe =
		/\bexport\s+default\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[;\n]/m;
	const defaultVarMatch = content.match(defaultVarRe);
	if (defaultVarMatch) {
		const name = defaultVarMatch[1];
		const info = factoryVars.get(name);
		if (info && !seen.has(`default:${name}`)) {
			seen.add(`default:${name}`);
			results.push({
				exportName: name,
				factoryName: info.factoryName,
				entityKey: info.entityKey,
				isDefault: true,
			});
		}
	}

	// 2d. Inline default: export default factory(...)
	const inlineDefaultRe = new RegExp(
		`\\bexport\\s+default\\s+(${factoryAlt})\\s*(?:<[^>]*>)?\\s*\\(\\s*(?:["']([^"']+)["'])?`,
		"m",
	);
	const inlineMatch = content.match(inlineDefaultRe);
	if (inlineMatch && !defaultVarMatch) {
		results.push({
			exportName: "",
			factoryName: inlineMatch[1],
			entityKey: inlineMatch[2] ?? null,
			isDefault: true,
		});
	}

	return results;
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
		if (category === "routes") {
			const message = buildRouteCollisionMessage(existing.source, file.source);
			if (message) {
				throw new Error(message);
			}
		}

		throw new Error(
			`Codegen conflict: duplicate ${category} key "${file.key}" found in:\n` +
				`  - ${existing.source}\n` +
				`  - ${file.source}\n` +
				`Each key must be unique across by-type and by-feature layouts.`,
		);
	}
}

function routeSourceDir(source: string): "functions" | "routes" | null {
	for (const segment of source.split("/")) {
		if (segment === "functions" || segment === "routes") {
			return segment;
		}
	}

	return null;
}

function routeNameFromSource(source: string): string | null {
	const segments = source.split("/");
	const dirIndex = segments.findIndex(
		(segment) => segment === "functions" || segment === "routes",
	);

	if (dirIndex === -1) return null;

	const routePath = segments.slice(dirIndex + 1).join("/");
	if (!routePath) return null;

	return routePath.replace(/\.(ts|tsx|mts|mjs|js|jsx)$/, "");
}

function buildRouteCollisionMessage(
	existingSource: string,
	incomingSource: string,
): string | null {
	const existingDir = routeSourceDir(existingSource);
	const incomingDir = routeSourceDir(incomingSource);

	if (!existingDir || !incomingDir || existingDir === incomingDir) {
		return null;
	}

	const routeName =
		routeNameFromSource(incomingSource) ??
		routeNameFromSource(existingSource) ??
		"(unknown)";

	return (
		`[codegen] Route name collision: '${routeName}' found in both functions/ and routes/.\n` +
		`  - ${existingSource}\n` +
		`  - ${incomingSource}\n` +
		"Route names must be unique across functions/ and routes/."
	);
}
