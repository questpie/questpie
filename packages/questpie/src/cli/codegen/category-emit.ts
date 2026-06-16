import type { CategoryDeclaration, DiscoveredFile } from "./types.js";

export function sortedValues(
	map: Map<string, DiscoveredFile>,
): DiscoveredFile[] {
	return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function safeKey(key: string): string {
	if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)) return key;
	return `"${key}"`;
}

export function importStatement(file: DiscoveredFile): string {
	if (file.exportType === "named" && file.namedExportName) {
		return `import { ${file.namedExportName} as ${file.varName} } from "${file.importPath}";`;
	}
	return `import ${file.varName} from "${file.importPath}";`;
}

export function sourceBasename(file: DiscoveredFile): string {
	const source = file.source.replaceAll("\\", "/");
	const filename = source.split("/").pop() ?? file.key;
	return filename.replace(/\.[^.]+$/, "");
}

export function categoryRecordEntry(
	file: DiscoveredFile,
	decl: CategoryDeclaration | undefined,
): string {
	if (file.isBundle) return `...${file.varName}`;
	if (decl?.keyFromProperty)
		return `[${file.varName}.${decl.keyFromProperty}]: ${file.varName}`;
	if (decl?.keyFromSource === "basename")
		return `${JSON.stringify(sourceBasename(file))}: ${file.varName}`;
	return `${safeKey(file.key)}: ${file.varName}`;
}

/**
 * Whether a category contributes a names-only `*Keys` registry.
 *
 * A keyed-entity category is one that (a) participates in the value-typed
 * `Registry` (`registryKey` truthy or a string) AND (b) emits a name-keyed
 * `App*` type (`typeEmit` is the default/`standard`/`services`/`emails` form,
 * i.e. NOT the `messages`/`none` non-entity forms) AND (c) is not an `array`
 * emission (migrations/seeds). This naturally selects
 * {collections, globals, jobs, routes, services, emails, views, components,
 * blocks, fieldTypes, workflows} and excludes messages/migrations/seeds —
 * with no hardcoded category-name list. Single source of truth shared by BOTH
 * halves of the key registry (the module-name half in template.ts and the
 * user-literal half below).
 */
export function isKeyedEntityCat(decl: CategoryDeclaration): boolean {
	if (decl.registryKey === false || decl.registryKey === undefined)
		return false;
	if (decl.emit === "array") return false;
	if (decl.typeEmit === "messages" || decl.typeEmit === "none") return false;
	return true;
}

/**
 * Derive the names-only `*Keys` interface name for a category — the single
 * source of truth shared by both halves of the key registry.
 *
 * The existing 3 names are SINGULAR-stem (`CollectionKeys`, not
 * `CollectionsKeys`), so the rule strips a trailing `s` then capitalizes:
 * collections→CollectionKeys, globals→GlobalKeys, jobs→JobKeys,
 * routes→RouteKeys, services→ServiceKeys, emails→EmailKeys, views→ViewKeys,
 * components→ComponentKeys, blocks→BlockKeys, workflows→WorkflowKeys,
 * fieldTypes→FieldTypeKeys. The `Keys` suffix keeps these collision-free with
 * the value-typed `ViewsRegistry`/`ComponentsRegistry`/`FieldTypesMap`
 * registries (different suffix).
 */
export function keyRegistryInterfaceName(catName: string): string {
	const stem = catName.replace(/s$/, "");
	return `${stem.charAt(0).toUpperCase()}${stem.slice(1)}Keys`;
}

/**
 * Emit the names-only entity key registry augmentation
 * (`Questpie.CollectionKeys` / `GlobalKeys` / `JobKeys` / … one interface per
 * keyed-entity category).
 *
 * Keys come from file discovery alone and the emitted interfaces reference
 * nothing, so the augmentation is acyclic by construction. Interface merging
 * across generated files (root app + each module) tolerates duplicate keys.
 *
 * Consumed by `KnownCollectionKey` / `StrictCollectionKey` & friends (e.g.
 * `relation()` target autocomplete/validation) with a `(string & {})` fallback
 * — names only, never strict.
 *
 * Generic over every keyed category (see {@link isKeyedEntityCat}). Keys are
 * the FILE-derived keys (`safeKey(file.key)`) for EVERY category — a static
 * string that needs no import, so this file stays acyclic (it must NOT
 * reference `typeof _modules` or entity instances). For `keyFromProperty`
 * categories (views/blocks/workflows) the file key can diverge from the
 * runtime `.name`; that divergence is autocomplete-only (the `*Keys` interfaces
 * are name SETS with no value semantics) and the runtime-property names are
 * additionally contributed by the module half over module entities.
 */
export function emitKeyRegistryAugmentation(
	lines: string[],
	discoveredCategories: Map<string, Map<string, DiscoveredFile>>,
	categoryDecls: Record<string, CategoryDeclaration>,
): void {
	const entries: string[] = [];
	for (const [catName, decl] of Object.entries(categoryDecls)) {
		if (!isKeyedEntityCat(decl)) continue;
		const fileMap = discoveredCategories.get(catName);
		if (!fileMap || fileMap.size === 0) continue;
		// Bundles re-export another module's entities — that module's own
		// codegen emits their keys, so skip them here.
		const keys = sortedValues(fileMap)
			.filter((file) => !file.isBundle)
			.map((file) => `${safeKey(file.key)}: unknown`);
		if (keys.length === 0) continue;
		const interfaceName = keyRegistryInterfaceName(catName);
		entries.push(`\t\tinterface ${interfaceName} { ${keys.join("; ")} }`);
	}

	if (entries.length === 0) return;

	lines.push(
		"// ── Entity key registry (names only — acyclic by construction) ─────",
	);
	lines.push("declare global {");
	lines.push("\tnamespace Questpie {");
	for (const entry of entries) {
		lines.push(entry);
	}
	lines.push("\t}");
	lines.push("}");
	lines.push("");
}

export function categoryTypeEntry(
	file: DiscoveredFile,
	decl: CategoryDeclaration | undefined,
	catName?: string,
): string {
	const valueType =
		catName === "jobs"
			? `Omit<typeof ${file.varName}, "handler"> & { handler: (args: unknown) => Promise<unknown> }`
			: catName === "workflows"
				? `Omit<typeof ${file.varName}, "handler" | "onFailure"> & { handler: (args: unknown) => Promise<unknown>; onFailure?: (args: unknown) => Promise<void> }`
				: `typeof ${file.varName}`;
	if (decl?.keyFromProperty)
		return `[K in typeof ${file.varName}.${decl.keyFromProperty}]: ${valueType}`;
	return `${safeKey(file.key)}: ${valueType}`;
}
