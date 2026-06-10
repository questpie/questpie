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
