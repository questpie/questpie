import { resolveNamedGraph } from "../../shared/named-graph.js";
import { findModulesFile, toFileImportSpecifier } from "../utils.js";
import type { FactoryArgumentMetadata } from "./types.js";

export const CODEGEN_MODULE_METADATA_SYMBOL =
	"questpie.codegen.module-metadata.v1";

type StoredFactoryArgument = Omit<FactoryArgumentMetadata, "source"> & {
	source: string;
};

type ModuleLike = {
	name?: string;
	modules?: ModuleLike[];
	[key: symbol]: unknown;
};

type StoredModuleMetadata = {
	factoryArguments?: StoredFactoryArgument[];
};

/** Extract source-qualified factory metadata from a generated module tree. */
export function extractFactoryArgumentsFromModules(
	modules: ModuleLike[],
): FactoryArgumentMetadata[] {
	const symbol = Symbol.for(CODEGEN_MODULE_METADATA_SYMBOL);
	const result: FactoryArgumentMetadata[] = [];
	const resolvedModules = resolveNamedGraph(modules, {
		kind: "module",
		name: (module) => module.name,
		children: (module) => module.modules ?? [],
	});

	for (const module of resolvedModules) {
		const metadata = module[symbol] as StoredModuleMetadata | undefined;
		for (const entry of metadata?.factoryArguments ?? []) {
			result.push({
				...entry,
				source: `${module.name ?? "anonymous-module"}:${entry.source}`,
			});
		}
	}
	return result;
}

/**
 * Load generated factory metadata from the root's modules.ts.
 *
 * The result feeds `validateFactoryArguments`, which is what catches an app
 * block colliding with a module block. Nothing is emitted from it, so an
 * unimportable modules.ts costs a check rather than the artifact, and this
 * warns instead of throwing the way the plugin pre-pass does. It still says
 * what was lost, because the old silent catch turned a dropped uniqueness
 * check into a duplicate that only shows up at runtime.
 *
 * This runs for every target, including ones whose modules.ts is a client
 * file, so throwing here would fail codegen on apps that generate correctly.
 *
 * No modules file returns empty, and so does a default export that is not an
 * array. The admin target's modules.ts legitimately exports one merged client
 * module object rather than a list, and it carries no factory metadata.
 */
export async function loadModuleFactoryArguments(
	rootDir: string,
): Promise<FactoryArgumentMetadata[]> {
	const modulesPath = await findModulesFile(rootDir);
	if (!modulesPath) return [];

	let modulesExport: Record<string, unknown>;
	try {
		// Import by file URL. A bare Windows path like C:\app\modules.ts parses as
		// a URL with scheme "c:" and throws ERR_UNSUPPORTED_ESM_URL_SCHEME.
		modulesExport = await import(
			/* @vite-ignore */ toFileImportSpecifier(modulesPath)
		);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		console.warn(
			`⚠  Could not import ${modulesPath} (${reason}).\n` +
				"   Module-contributed names are not checked for collisions this run,\n" +
				"   so a duplicate block or field type would reach runtime unreported.",
		);
		return [];
	}

	const modules = modulesExport.default;
	return Array.isArray(modules)
		? extractFactoryArgumentsFromModules(modules)
		: [];
}
