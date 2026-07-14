import { join } from "node:path";

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
	const seen = new Set<ModuleLike>();
	const result: FactoryArgumentMetadata[] = [];

	function walk(module: ModuleLike): void {
		if (seen.has(module)) return;
		seen.add(module);

		for (const child of module.modules ?? []) walk(child);

		const metadata = module[symbol] as StoredModuleMetadata | undefined;
		for (const entry of metadata?.factoryArguments ?? []) {
			result.push({
				...entry,
				source: `${module.name ?? "anonymous-module"}:${entry.source}`,
			});
		}
	}

	for (const module of modules) walk(module);
	return result;
}

/** Load generated metadata from the root's modules.ts when it is importable. */
export async function loadModuleFactoryArguments(
	rootDir: string,
): Promise<FactoryArgumentMetadata[]> {
	try {
		const modulesExport = await import(join(rootDir, "modules.ts"));
		const modules = modulesExport.default;
		return Array.isArray(modules)
			? extractFactoryArgumentsFromModules(modules)
			: [];
	} catch {
		return [];
	}
}
