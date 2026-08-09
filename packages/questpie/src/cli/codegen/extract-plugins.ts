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

import {
	resolveNamedGraph,
	resolveNamedOccurrences,
} from "#questpie/shared/named-graph.js";

import type { CodegenPlugin } from "./types.js";

interface ModuleLike {
	name?: string;
	modules?: ModuleLike[];
	plugin?: CodegenPlugin | CodegenPlugin[];
	[key: string]: unknown;
}

export type CodegenPluginOccurrence = {
	plugin: CodegenPlugin;
	source: string;
};

/** Deduplicate repeated identities and reject ambiguous plugin names. */
export function resolveCodegenPluginOccurrences(
	occurrences: readonly CodegenPluginOccurrence[],
): CodegenPlugin[] {
	return resolveNamedOccurrences(occurrences, {
		kind: "plugin",
		node: (occurrence) => occurrence.plugin,
		name: (plugin) => plugin.name,
		source: (occurrence) => occurrence.source,
	});
}

/**
 * Extract codegen plugins from a module tree.
 *
 * Traverses modules depth-first (same order as `resolveModules` in create-app.ts)
 * and collects all `plugin` entries. Repeated object identities deduplicate;
 * different modules or plugins sharing one name are rejected.
 *
 * @param modules - Top-level modules array (from modules.ts default export)
 * @returns Deduplicated array of codegen plugins in depth-first order
 */
export function extractPluginsFromModules(
	modules: ModuleLike[],
): CodegenPlugin[] {
	const resolvedModules = resolveNamedGraph(modules, {
		kind: "module",
		name: (module) => module.name,
		children: (module) => module.modules ?? [],
	});
	const occurrences: CodegenPluginOccurrence[] = [];

	for (const mod of resolvedModules) {
		const modPlugins = Array.isArray(mod.plugin)
			? mod.plugin
			: mod.plugin
				? [mod.plugin]
				: [];
		for (const plugin of modPlugins) {
			occurrences.push({
				plugin,
				source: `module ${mod.name ?? "<anonymous>"}`,
			});
		}
	}

	return resolveCodegenPluginOccurrences(occurrences);
}
