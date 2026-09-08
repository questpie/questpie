import { readFile } from "node:fs/promises";
import { createRequire, isBuiltin } from "node:module";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type { PluginBuilder } from "bun";

/** Keep application module identity independent of its checkout directory. */
export function applicationSource(
	builder: PluginBuilder,
	root: string,
	packageEntries: ReadonlyMap<string, string>,
) {
	const namespace = "questpie-application-source";
	const files = new Map<string, string>();
	const resolved = (path: string) => {
		const name = relative(root, path).replaceAll("\\", "/");
		if (
			isAbsolute(name) ||
			name === ".." ||
			name.startsWith("../") ||
			name.split("/").includes("node_modules") ||
			!/\.(?:[cm]?[jt]s|[jt]sx|json)$/.test(name)
		)
			return { path };
		files.set(name, path);
		return { path: name, namespace };
	};
	builder.onLoad({ filter: /.*/, namespace }, async ({ path, loader }) => ({
		contents: await readFile(files.get(path)!),
		loader,
	}));
	builder.onResolve({ filter: /.*/ }, (args) => {
		const importer = files.get(args.importer);
		if (importer === undefined) return undefined;
		if (isBuiltin(args.path)) return { path: args.path, external: true };
		if (
			args.path === "questpie" ||
			args.path === "questpie/internal/observability"
		)
			return { path: args.path, external: true };
		// Framework virtual imports remain owned by the existing bundle plugin.
		if (args.path.startsWith("#questpie/")) return undefined;
		const packageEntry = packageEntries.get(args.path);
		if (packageEntry) return { path: packageEntry };
		return resolved(
			args.kind === "require-call" || args.kind === "require-resolve"
				? createRequire(importer).resolve(args.path)
				: Bun.resolveSync(args.path, dirname(importer)),
		);
	});
	return (path: string) => resolved(Bun.resolveSync(resolve(path), root));
}
