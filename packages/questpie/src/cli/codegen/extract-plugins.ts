/**
 * Plugin Extraction from Modules
 *
 * Pre-pass that extracts codegen plugins from module definitions.
 * Modules can declare `plugin` (single or array) to contribute codegen
 * plugins. This is extracted at codegen time from modules.ts so that
 * module packages can contribute file conventions without requiring
 * manual plugin registration in questpie.config.ts.
 *
 * @see ModuleDefinition.plugin
 */

import type { CodegenPlugin } from "./types.js";

interface ModuleLike {
	name?: string;
	modules?: ModuleLike[];
	plugin?: CodegenPlugin | CodegenPlugin[];
	[key: string]: unknown;
}

/**
 * Extract codegen plugins from a module tree.
 *
 * Traverses modules depth-first (same order as `resolveModules` in create-app.ts)
 * and collects all `plugin` entries. Deduplicates by plugin name — first occurrence wins.
 *
 * @param modules - Top-level modules array (from modules.ts default export)
 * @returns Deduplicated array of codegen plugins in depth-first order
 */
export function extractPluginsFromModules(
	modules: ModuleLike[],
): CodegenPlugin[] {
	const seen = new Set<string>();
	const plugins: CodegenPlugin[] = [];

	function walk(mod: ModuleLike): void {
		// Depth-first: process sub-modules before self
		if (mod.modules) {
			for (const sub of mod.modules) {
				walk(sub);
			}
		}
		const modPlugins = Array.isArray(mod.plugin)
			? mod.plugin
			: mod.plugin
				? [mod.plugin]
				: [];
		for (const p of modPlugins) {
			if (!seen.has(p.name)) {
				seen.add(p.name);
				plugins.push(p);
			}
		}
	}

	for (const m of modules) {
		walk(m);
	}

	return plugins;
}
